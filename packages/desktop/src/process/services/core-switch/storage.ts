import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type {
  BackupDescriptor,
  BackupManifest,
  BackupManifestEntry,
  CoreSwitchAudit,
  CoreSwitchCompletion,
  CoreSwitchState,
  CoreSwitchStorage,
} from './types';

type StorageDependencies = {
  isProcessAlive?: (pid: number) => boolean;
  now?: () => Date;
  pid?: number;
  randomId?: () => string;
};

type ControlPaths = {
  auditLatest: string;
  auditLog: string;
  backupsDir: string;
  completionMarker: string;
  controlDir: string;
  lockFile: string;
  preflightDir: string;
  stateMarker: string;
};

export class CoreSwitchLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreSwitchLockedError';
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined;
}

async function fsyncDirectory(dirPath: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(dirPath, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'EISDIR', 'EPERM'].includes(errorCode(error) ?? '')) throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tempPath, filePath);
  await fsyncDirectory(dir);
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

async function collectManifestEntries(rootDir: string, relativeDir = ''): Promise<BackupManifestEntry[]> {
  const absoluteDir = path.join(rootDir, relativeDir);
  const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
  const entries: BackupManifestEntry[] = [];
  for (const dirent of dirents.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDir, dirent.name);
    const absolutePath = path.join(rootDir, relativePath);
    if (dirent.isDirectory()) {
      entries.push(...(await collectManifestEntries(rootDir, relativePath)));
      continue;
    }
    if (dirent.isSymbolicLink()) {
      const target = await fs.readlink(absolutePath);
      entries.push({
        path: relativePath.split(path.sep).join('/'),
        sha256: createHash('sha256').update(target).digest('hex'),
        size: Buffer.byteLength(target),
        type: 'symlink',
      });
      continue;
    }
    if (!dirent.isFile()) continue;
    const stat = await fs.stat(absolutePath);
    entries.push({
      path: relativePath.split(path.sep).join('/'),
      sha256: await hashFile(absolutePath),
      size: stat.size,
      type: 'file',
    });
  }
  return entries;
}

function aggregateManifest(entries: BackupManifestEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(`${entry.type}\0${entry.path}\0${entry.size}\0${entry.sha256}\n`);
  }
  return hash.digest('hex');
}

async function fsyncTree(rootDir: string): Promise<void> {
  const directories: string[] = [];
  async function visit(dirPath: string): Promise<void> {
    directories.push(dirPath);
    const dirents = await fs.readdir(dirPath, { withFileTypes: true });
    for (const dirent of dirents) {
      const entryPath = path.join(dirPath, dirent.name);
      if (dirent.isDirectory()) {
        await visit(entryPath);
      } else if (dirent.isFile()) {
        const handle = await fs.open(entryPath, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
  }
  await visit(rootDir);
  for (const dirPath of directories.reverse()) await fsyncDirectory(dirPath);
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, {
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  });
  await fsyncTree(target);
  await fsyncDirectory(path.dirname(target));
}

export class CoreSwitchFileStorage implements CoreSwitchStorage {
  private readonly isProcessAlive: (pid: number) => boolean;
  private readonly now: () => Date;
  private readonly pid: number;
  private readonly randomId: () => string;

  constructor(dependencies: StorageDependencies = {}) {
    this.isProcessAlive = dependencies.isProcessAlive ?? defaultIsProcessAlive;
    this.now = dependencies.now ?? (() => new Date());
    this.pid = dependencies.pid ?? process.pid;
    this.randomId = dependencies.randomId ?? randomUUID;
  }

  async acquireLock(dataDir: string): Promise<() => Promise<void>> {
    const paths = await this.controlPaths(dataDir);
    await fs.mkdir(paths.controlDir, { recursive: true });
    const token = this.randomId();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const handle = await fs.open(paths.lockFile, 'wx', 0o600);
        try {
          await handle.writeFile(
            `${JSON.stringify({ schemaVersion: 1, pid: this.pid, token, acquiredAt: this.now().toISOString() })}\n`,
            'utf8'
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fsyncDirectory(paths.controlDir);
        return async () => {
          const lock = await readJson<{ token?: string }>(paths.lockFile);
          if (lock?.token !== token) return;
          await fs.rm(paths.lockFile, { force: true });
          await fsyncDirectory(paths.controlDir);
        };
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        const current = await readJson<{ pid?: unknown }>(paths.lockFile);
        if (typeof current?.pid === 'number' && this.isProcessAlive(current.pid)) {
          throw new CoreSwitchLockedError(`Core switch is already running in process ${current.pid}`);
        }
        await fs.rm(paths.lockFile, { force: true });
        await fsyncDirectory(paths.controlDir);
      }
    }
    throw new CoreSwitchLockedError('Could not acquire the Core switch lock');
  }

  async hasCompletionMarker(dataDir: string): Promise<boolean> {
    const paths = await this.controlPaths(dataDir);
    try {
      const stat = await fs.stat(paths.completionMarker);
      return stat.isFile();
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false;
      throw error;
    }
  }

  async readCompletionMarker(dataDir: string): Promise<CoreSwitchCompletion | undefined> {
    const paths = await this.controlPaths(dataDir);
    return await readJson<CoreSwitchCompletion>(paths.completionMarker);
  }

  async clearCompletionMarker(dataDir: string): Promise<void> {
    const paths = await this.controlPaths(dataDir);
    await fs.rm(paths.completionMarker, { force: true });
    await fsyncDirectory(paths.controlDir);
  }

  async writeCompletionMarker(dataDir: string, marker: CoreSwitchCompletion): Promise<void> {
    const paths = await this.controlPaths(dataDir);
    await atomicWriteJson(paths.completionMarker, marker);
  }

  async readState(dataDir: string): Promise<CoreSwitchState | undefined> {
    const paths = await this.controlPaths(dataDir);
    return await readJson<CoreSwitchState>(paths.stateMarker);
  }

  async writeState(dataDir: string, state: CoreSwitchState): Promise<void> {
    const paths = await this.controlPaths(dataDir);
    await atomicWriteJson(paths.stateMarker, state);
  }

  async clearState(dataDir: string): Promise<void> {
    const paths = await this.controlPaths(dataDir);
    await fs.rm(paths.stateMarker, { force: true });
    await fsyncDirectory(paths.controlDir);
  }

  async createPreflightCopy(dataDir: string): Promise<string> {
    const sourceDataDir = await this.resolveDataDir(dataDir);
    const paths = await this.controlPaths(dataDir);
    await fs.mkdir(paths.controlDir, { recursive: true });
    await copyDirectory(sourceDataDir, paths.preflightDir);
    return paths.preflightDir;
  }

  async removePreflightCopy(dataDir: string): Promise<void> {
    const paths = await this.controlPaths(dataDir);
    await fs.rm(paths.preflightDir, { recursive: true, force: true });
    await fsyncDirectory(paths.controlDir);
  }

  async createBackup(dataDir: string): Promise<BackupDescriptor> {
    const sourceDataDir = await this.resolveDataDir(dataDir);
    const paths = await this.controlPaths(dataDir);
    await fs.mkdir(paths.backupsDir, { recursive: true });
    const backupName = `rollback-${this.now().toISOString().replace(/[:.]/g, '-')}-${this.randomId()}`;
    const finalRoot = path.join(paths.backupsDir, backupName);
    const tempRoot = `${finalRoot}.tmp`;
    const backupDataDir = path.join(tempRoot, 'data');
    await fs.rm(tempRoot, { recursive: true, force: true });
    await copyDirectory(sourceDataDir, backupDataDir);

    const files = await collectManifestEntries(backupDataDir);
    const manifest: BackupManifest = {
      schemaVersion: 1,
      createdAt: this.now().toISOString(),
      dataDir: sourceDataDir,
      files,
      aggregateSha256: aggregateManifest(files),
    };
    const tempManifestPath = path.join(tempRoot, 'manifest.json');
    await atomicWriteJson(tempManifestPath, manifest);
    await fsyncTree(tempRoot);
    await fs.rename(tempRoot, finalRoot);
    await fsyncDirectory(paths.backupsDir);

    return {
      rootDir: finalRoot,
      dataDir: path.join(finalRoot, 'data'),
      manifestPath: path.join(finalRoot, 'manifest.json'),
      aggregateSha256: manifest.aggregateSha256,
      fileCount: files.length,
    };
  }

  async restoreBackup(dataDir: string, backup: BackupDescriptor): Promise<void> {
    const manifest = await this.verifyBackup(backup);
    const targetDataDir = manifest.dataDir;
    const restoreTemp = `${targetDataDir}.centaur-restore.tmp`;
    const displaced = `${targetDataDir}.centaur-migrated.failed`;
    await fs.rm(restoreTemp, { recursive: true, force: true });
    await copyDirectory(backup.dataDir, restoreTemp);
    const restoredFiles = await collectManifestEntries(restoreTemp);
    if (aggregateManifest(restoredFiles) !== manifest.aggregateSha256) {
      throw new Error('Restored data copy does not match the rollback manifest SHA-256');
    }

    let targetExists = true;
    try {
      await fs.stat(targetDataDir);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') targetExists = false;
      else throw error;
    }
    if (targetExists) {
      await fs.rm(displaced, { recursive: true, force: true });
      await fs.rename(targetDataDir, displaced);
      await fsyncDirectory(path.dirname(targetDataDir));
    }
    await fs.rename(restoreTemp, targetDataDir);
    await fsyncDirectory(path.dirname(targetDataDir));
    await fs.rm(displaced, { recursive: true, force: true }).catch(() => {});
    await fsyncDirectory(path.dirname(targetDataDir));
  }

  async pruneBackups(dataDir: string, keepRootDir: string): Promise<void> {
    const paths = await this.controlPaths(dataDir);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(paths.backupsDir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const candidate = path.join(paths.backupsDir, entry.name);
      if (entry.isDirectory() && path.resolve(candidate) !== path.resolve(keepRootDir)) {
        await fs.rm(candidate, { recursive: true, force: true });
      }
    }
    await fsyncDirectory(paths.backupsDir);
  }

  async writeAudit(dataDir: string, audit: CoreSwitchAudit): Promise<void> {
    const paths = await this.controlPaths(dataDir);
    await atomicWriteJson(paths.auditLatest, audit);
    const handle = await fs.open(paths.auditLog, 'a', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(audit)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsyncDirectory(paths.controlDir);
  }

  private async verifyBackup(backup: BackupDescriptor): Promise<BackupManifest> {
    const manifest = await readJson<BackupManifest>(backup.manifestPath);
    if (!manifest || manifest.schemaVersion !== 1) throw new Error('Rollback manifest is missing or unsupported');
    const files = await collectManifestEntries(backup.dataDir);
    const aggregateSha256 = aggregateManifest(files);
    if (aggregateSha256 !== manifest.aggregateSha256 || aggregateSha256 !== backup.aggregateSha256) {
      throw new Error('Rollback manifest SHA-256 verification failed');
    }
    if (files.length !== manifest.files.length || files.length !== backup.fileCount) {
      throw new Error('Rollback manifest file count verification failed');
    }
    return manifest;
  }

  private async resolveDataDir(dataDir: string, requireExisting = true): Promise<string> {
    const resolved = path.resolve(dataDir);
    try {
      return await fs.realpath(resolved);
    } catch (error) {
      if (!requireExisting && errorCode(error) === 'ENOENT') return resolved;
      throw error;
    }
  }

  private async controlPaths(dataDir: string): Promise<ControlPaths> {
    const resolvedDataDir = path.resolve(dataDir);
    const controlDir = path.join(path.dirname(resolvedDataDir), `.${path.basename(resolvedDataDir)}-core-switch`);
    return {
      auditLatest: path.join(controlDir, 'audit-latest.json'),
      auditLog: path.join(controlDir, 'audit.jsonl'),
      backupsDir: path.join(controlDir, 'backups'),
      completionMarker: path.join(controlDir, 'switch-complete.json'),
      controlDir,
      lockFile: path.join(controlDir, 'switch.lock'),
      preflightDir: path.join(controlDir, 'preflight-data'),
      stateMarker: path.join(controlDir, 'switch-state.json'),
    };
  }
}
