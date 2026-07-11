import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CoreSwitchFileStorage, CoreSwitchLockedError } from '@process/services/core-switch';

describe('CoreSwitchFileStorage', () => {
  let rootDir: string;
  let dataDir: string;
  let sequence: number;
  let storage: CoreSwitchFileStorage;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decision-core-switch-storage-'));
    dataDir = path.join(rootDir, 'data');
    await fs.mkdir(path.join(dataDir, 'skills', 'advisor'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'aionui-backend.db'), 'database-before');
    await fs.writeFile(path.join(dataDir, 'channel.json'), '{"channel":"before"}');
    await fs.writeFile(path.join(dataDir, 'config.json'), '{"config":"before"}');
    await fs.writeFile(path.join(dataDir, 'cron.json'), '{"cron":"before"}');
    await fs.writeFile(path.join(dataDir, 'mcp.json'), '{"mcp":"before"}');
    await fs.writeFile(path.join(dataDir, 'skills', 'advisor', 'SKILL.md'), 'skill-before');
    await fs.writeFile(path.join(dataDir, 'provider.json'), '{"provider":"before"}');
    await fs.writeFile(path.join(dataDir, 'team.json'), '{"team":"before"}');
    sequence = 0;
    storage = new CoreSwitchFileStorage({
      isProcessAlive: () => false,
      now: () => new Date('2026-07-12T00:00:00.000Z'),
      pid: 4242,
      randomId: () => `id-${sequence++}`,
    });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('creates a complete SHA-256 manifest and restores every data file', async () => {
    const backup = await storage.createBackup(dataDir);
    const manifest = JSON.parse(await fs.readFile(backup.manifestPath, 'utf8')) as {
      aggregateSha256: string;
      files: Array<{ path: string }>;
    };

    expect(manifest.aggregateSha256).toBe(backup.aggregateSha256);
    expect(manifest.files.map((entry) => entry.path)).toEqual([
      'aionui-backend.db',
      'channel.json',
      'config.json',
      'cron.json',
      'mcp.json',
      'provider.json',
      'skills/advisor/SKILL.md',
      'team.json',
    ]);

    await fs.writeFile(path.join(dataDir, 'aionui-backend.db'), 'migrated-database');
    await fs.rm(path.join(dataDir, 'skills'), { recursive: true });
    await fs.writeFile(path.join(dataDir, 'new-after-migration'), 'remove-me');
    await storage.restoreBackup(dataDir, backup);

    await expect(fs.readFile(path.join(dataDir, 'aionui-backend.db'), 'utf8')).resolves.toBe('database-before');
    await expect(fs.readFile(path.join(dataDir, 'skills', 'advisor', 'SKILL.md'), 'utf8')).resolves.toBe(
      'skill-before'
    );
    await expect(fs.stat(path.join(dataDir, 'new-after-migration'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a tampered rollback package before replacing live data', async () => {
    const backup = await storage.createBackup(dataDir);
    await fs.writeFile(path.join(backup.dataDir, 'provider.json'), 'tampered');
    await fs.writeFile(path.join(dataDir, 'aionui-backend.db'), 'still-live');

    await expect(storage.restoreBackup(dataDir, backup)).rejects.toThrow('SHA-256 verification failed');
    await expect(fs.readFile(path.join(dataDir, 'aionui-backend.db'), 'utf8')).resolves.toBe('still-live');
  });

  it.runIf(process.platform !== 'win32')('backs up and restores symlinks without dereferencing them', async () => {
    await fs.symlink('provider.json', path.join(dataDir, 'provider-link.json'));
    const backup = await storage.createBackup(dataDir);
    const manifest = JSON.parse(await fs.readFile(backup.manifestPath, 'utf8')) as {
      files: Array<{ path: string; type: string }>;
    };

    expect(manifest.files).toContainEqual(expect.objectContaining({ path: 'provider-link.json', type: 'symlink' }));
    await fs.rm(path.join(dataDir, 'provider-link.json'));
    await storage.restoreBackup(dataDir, backup);
    await expect(fs.readlink(path.join(dataDir, 'provider-link.json'))).resolves.toBe('provider.json');
  });

  it('rejects a missing or file-count-inconsistent backup manifest', async () => {
    const backup = await storage.createBackup(dataDir);

    await expect(storage.restoreBackup(dataDir, { ...backup, fileCount: backup.fileCount + 1 })).rejects.toThrow(
      'file count verification failed'
    );
    await fs.rm(backup.manifestPath);
    await expect(storage.restoreBackup(dataDir, backup)).rejects.toThrow('manifest is missing');
  });

  it('finishes a restore after power loss displaced the live directory', async () => {
    const backup = await storage.createBackup(dataDir);
    const displaced = `${dataDir}.centaur-migrated.failed`;
    await fs.rename(dataDir, displaced);

    await storage.restoreBackup(dataDir, backup);

    await expect(fs.readFile(path.join(dataDir, 'provider.json'), 'utf8')).resolves.toBe('{"provider":"before"}');
    await expect(fs.stat(displaced)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reclaims a stale crash lock and releases only its own token', async () => {
    const controlDir = path.join(rootDir, '.data-core-switch');
    const lockFile = path.join(controlDir, 'switch.lock');
    await fs.mkdir(controlDir, { recursive: true });
    await fs.writeFile(lockFile, JSON.stringify({ pid: 9999, token: 'stale' }));

    const release = await storage.acquireLock(dataDir);
    await expect(fs.readFile(lockFile, 'utf8')).resolves.toContain('id-0');
    await release();
    await expect(fs.stat(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not remove a lock token that was replaced by another owner', async () => {
    const controlDir = path.join(rootDir, '.data-core-switch');
    const lockFile = path.join(controlDir, 'switch.lock');
    const release = await storage.acquireLock(dataDir);
    await fs.writeFile(lockFile, JSON.stringify({ pid: 9191, token: 'new-owner' }));

    await release();

    await expect(fs.stat(lockFile)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it('rejects a live switch lock without starting another migration', async () => {
    const controlDir = path.join(rootDir, '.data-core-switch');
    await fs.mkdir(controlDir, { recursive: true });
    await fs.writeFile(path.join(controlDir, 'switch.lock'), JSON.stringify({ pid: 9999, token: 'live' }));
    const lockedStorage = new CoreSwitchFileStorage({ isProcessAlive: () => true });

    await expect(lockedStorage.acquireLock(dataDir)).rejects.toBeInstanceOf(CoreSwitchLockedError);
  });

  it('atomically replaces durable state and completion markers', async () => {
    await expect(storage.hasCompletionMarker(dataDir)).resolves.toBe(false);
    await storage.writeState(dataDir, {
      schemaVersion: 1,
      phase: 'preflight_copying',
      dataDir,
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    await storage.writeState(dataDir, {
      schemaVersion: 1,
      phase: 'formal_starting',
      dataDir,
      updatedAt: '2026-07-12T00:00:01.000Z',
      backup: {
        rootDir: '/rollback',
        dataDir: '/rollback/data',
        manifestPath: '/rollback/manifest.json',
        aggregateSha256: 'a'.repeat(64),
        fileCount: 1,
      },
    });

    await expect(storage.readState(dataDir)).resolves.toMatchObject({ phase: 'formal_starting' });
    await storage.writeCompletionMarker(dataDir, {
      schemaVersion: 1,
      completedAt: '2026-07-12T00:00:02.000Z',
      coreVersion: 'v0.1.48',
      legacyVersion: 'v0.1.24',
      backup: {
        rootDir: '/rollback',
        dataDir: '/rollback/data',
        manifestPath: '/rollback/manifest.json',
        aggregateSha256: 'a'.repeat(64),
        fileCount: 1,
      },
    });
    await expect(storage.hasCompletionMarker(dataDir)).resolves.toBe(true);
    await expect(storage.readCompletionMarker(dataDir)).resolves.toMatchObject({ coreVersion: 'v0.1.48' });
    await storage.clearCompletionMarker(dataDir);
    await expect(storage.readCompletionMarker(dataDir)).resolves.toBeUndefined();
  });

  it('creates and removes the isolated preflight copy', async () => {
    const preflightDir = await storage.createPreflightCopy(dataDir);
    await expect(fs.readFile(path.join(preflightDir, 'aionui-backend.db'), 'utf8')).resolves.toBe('database-before');

    await storage.removePreflightCopy(dataDir);

    await expect(fs.stat(preflightDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps only the requested rollback package and tolerates an empty backup directory', async () => {
    const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'decision-core-switch-empty-'));
    try {
      const emptyData = path.join(emptyRoot, 'data');
      await fs.mkdir(emptyData);
      await storage.pruneBackups(emptyData, '/does-not-exist');
    } finally {
      await fs.rm(emptyRoot, { recursive: true, force: true });
    }

    const first = await storage.createBackup(dataDir);
    const second = await storage.createBackup(dataDir);
    await storage.pruneBackups(dataDir, second.rootDir);

    await expect(fs.stat(first.rootDir)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(second.rootDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it('durably appends audit history and supports default storage dependencies', async () => {
    await storage.writeAudit(dataDir, {
      schemaVersion: 1,
      at: '2026-07-12T00:00:00.000Z',
      outcome: 'preflight_failed',
      reason: 'fixture',
    });
    const controlDir = path.join(rootDir, '.data-core-switch');
    await expect(fs.readFile(path.join(controlDir, 'audit-latest.json'), 'utf8')).resolves.toContain(
      'preflight_failed'
    );
    await expect(fs.readFile(path.join(controlDir, 'audit.jsonl'), 'utf8')).resolves.toContain('"reason":"fixture"');

    const defaultStorage = new CoreSwitchFileStorage();
    const release = await defaultStorage.acquireLock(dataDir);
    await release();
  });

  it('surfaces corrupt markers and non-ENOENT filesystem failures', async () => {
    const controlDir = path.join(rootDir, '.data-core-switch');
    await fs.mkdir(controlDir, { recursive: true });
    await fs.writeFile(path.join(controlDir, 'switch-state.json'), '{not-json');
    await expect(storage.readState(dataDir)).rejects.toBeInstanceOf(SyntaxError);

    const blockedDataDir = path.join(rootDir, 'blocked-data');
    await fs.writeFile(path.join(rootDir, '.blocked-data-core-switch'), 'not-a-directory');
    await expect(storage.hasCompletionMarker(blockedDataDir)).rejects.toMatchObject({ code: 'ENOTDIR' });

    const pruneDataDir = path.join(rootDir, 'prune-data');
    const pruneControlDir = path.join(rootDir, '.prune-data-core-switch');
    await fs.mkdir(pruneControlDir);
    await fs.writeFile(path.join(pruneControlDir, 'backups'), 'not-a-directory');
    await expect(storage.pruneBackups(pruneDataDir, '/keep')).rejects.toMatchObject({ code: 'ENOTDIR' });

    await expect(storage.createBackup(path.join(rootDir, 'missing-data'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
