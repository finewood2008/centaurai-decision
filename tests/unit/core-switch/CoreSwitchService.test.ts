import { describe, expect, it, vi } from 'vitest';
import {
  CoreSwitchRollbackError,
  CoreSwitchService,
  type BackupDescriptor,
  type CoreSwitchState,
  type CoreSwitchStorage,
  type ManagedCoreProcess,
} from '@process/services/core-switch';

const BACKUP: BackupDescriptor = {
  rootDir: '/control/backups/rollback-1',
  dataDir: '/control/backups/rollback-1/data',
  manifestPath: '/control/backups/rollback-1/manifest.json',
  aggregateSha256: 'a'.repeat(64),
  fileCount: 12,
};

type Harness = ReturnType<typeof createHarness>;

class FakeCore implements ManagedCoreProcess {
  port = 0;
  status: ManagedCoreProcess['status'] = 'stopped';
  private active = false;

  constructor(
    readonly name: string,
    private readonly harness: Harness,
    private readonly startFailure?: Error,
    private readonly stopFailure?: Error
  ) {}

  async start(dataDir: string): Promise<number> {
    this.harness.events.push(`${this.name}:start:${dataDir}`);
    this.status = 'starting';
    if (this.startFailure) {
      this.status = 'error';
      throw this.startFailure;
    }
    this.active = true;
    this.harness.activeCount += 1;
    this.harness.maxActiveCount = Math.max(this.harness.maxActiveCount, this.harness.activeCount);
    this.status = 'running';
    this.port = this.name.includes('legacy') ? 42000 : 41000 + this.harness.centaurManagers.length;
    this.harness.migrationCounts.set(dataDir, 26);
    return this.port;
  }

  async stop(): Promise<void> {
    this.harness.events.push(`${this.name}:stop`);
    if (this.stopFailure) throw this.stopFailure;
    if (this.active) {
      this.active = false;
      this.harness.activeCount -= 1;
    }
    this.status = 'stopped';
  }

  crash(): void {
    this.status = 'error';
    this.harness.events.push(`${this.name}:crash`);
  }
}

function createStorage(initialState?: CoreSwitchState): CoreSwitchStorage & {
  audits: Array<{ outcome: string; reason?: string }>;
  completionWritten: boolean;
  state: CoreSwitchState | undefined;
} {
  const storage = {
    audits: [] as Array<{ outcome: string; reason?: string }>,
    completionWritten: false,
    state: initialState,
    acquireLock: vi.fn(async () => async () => {}),
    hasCompletionMarker: vi.fn(async () => false),
    readCompletionMarker: vi.fn(async () => undefined),
    clearCompletionMarker: vi.fn(async () => {}),
    writeCompletionMarker: vi.fn(async () => {
      storage.completionWritten = true;
    }),
    readState: vi.fn(async () => storage.state),
    writeState: vi.fn(async (_dataDir: string, state: CoreSwitchState) => {
      storage.state = state;
    }),
    clearState: vi.fn(async () => {
      storage.state = undefined;
    }),
    createPreflightCopy: vi.fn(async () => '/control/preflight-data'),
    removePreflightCopy: vi.fn(async () => {}),
    createBackup: vi.fn(async () => BACKUP),
    restoreBackup: vi.fn(async () => {}),
    pruneBackups: vi.fn(async () => {}),
    writeAudit: vi.fn(async (_dataDir: string, audit: { outcome: string; reason?: string }) => {
      storage.audits.push(audit);
    }),
  };
  return storage;
}

function createHarness(options: { centaurStartFailures?: Array<Error | undefined>; state?: CoreSwitchState } = {}) {
  const harness = {
    activeCount: 0,
    maxActiveCount: 0,
    events: [] as string[],
    migrationCounts: new Map<string, number>(),
    centaurManagers: [] as FakeCore[],
    legacyManagers: [] as FakeCore[],
    centaurStartFailures: [...(options.centaurStartFailures ?? [])],
    centaurStopFailures: [] as Array<Error | undefined>,
    legacyStartFailures: [] as Array<Error | undefined>,
    storage: createStorage(options.state),
  };
  return harness;
}

function createService(
  harness: Harness,
  runConsumerContract: (port: number) => Promise<void> = async () => {}
): CoreSwitchService {
  return new CoreSwitchService({
    createCentaurCore: () => {
      const manager = new FakeCore(
        `centaur-${harness.centaurManagers.length + 1}`,
        harness,
        harness.centaurStartFailures.shift(),
        harness.centaurStopFailures.shift()
      );
      harness.centaurManagers.push(manager);
      return manager;
    },
    createLegacyCore: () => {
      const manager = new FakeCore(
        `legacy-${harness.legacyManagers.length + 1}`,
        harness,
        harness.legacyStartFailures.shift()
      );
      harness.legacyManagers.push(manager);
      return manager;
    },
    now: () => new Date('2026-07-12T00:00:00.000Z'),
    prepareLegacyDatabase: async (dataDir) => {
      harness.events.push(`prepare-legacy-db:${dataDir}`);
    },
    runConsumerContract,
    storage: harness.storage,
    verifyForwardMigrations: async (dataDir) => {
      expect(harness.migrationCounts.get(dataDir)).toBe(26);
      harness.events.push(`verify-migrations:${dataDir}`);
    },
  });
}

describe('CoreSwitchService', () => {
  it('uses startup to apply all 26 migrations on a copy before the formal switch', async () => {
    const harness = createHarness();
    const service = createService(harness);

    expect(service.port).toBe(0);
    expect(service.status).toBe('stopped');
    await service.stop();

    await expect(service.start('/live-data')).resolves.toBe(41002);

    expect(harness.events).toContain('centaur-1:start:/control/preflight-data');
    expect(harness.events).toContain('prepare-legacy-db:/control/preflight-data');
    expect(harness.events).toContain('verify-migrations:/control/preflight-data');
    expect(harness.events).toContain('centaur-2:start:/live-data');
    expect(harness.events).toContain('prepare-legacy-db:/live-data');
    expect(harness.events).toContain('verify-migrations:/live-data');
    expect(harness.maxActiveCount).toBe(1);
    expect(harness.storage.completionWritten).toBe(true);
    expect(harness.storage.audits.at(-1)?.outcome).toBe('switched');
    expect(service.port).toBe(41002);
    expect(service.status).toBe('running');
    await expect(service.start('/live-data')).rejects.toThrow('another Core process is active');
    await service.stop();
    expect(service.status).toBe('stopped');
  });

  it('does not mask a successful switch when durable lock cleanup fails', async () => {
    const harness = createHarness();
    vi.mocked(harness.storage.acquireLock).mockResolvedValueOnce(async () => {
      throw new Error('stale lock cleanup failed');
    });
    const service = createService(harness);

    await expect(service.start('/live-data')).resolves.toBe(41002);
  });

  it('keeps the live directory untouched and starts legacy when copying fails', async () => {
    const harness = createHarness();
    vi.mocked(harness.storage.createPreflightCopy).mockRejectedValueOnce(new Error('copy failed'));
    const service = createService(harness);

    await expect(service.start('/live-data')).resolves.toBe(42000);

    expect(harness.centaurManagers).toHaveLength(0);
    expect(harness.legacyManagers).toHaveLength(1);
    expect(harness.storage.createBackup).not.toHaveBeenCalled();
    expect(harness.storage.restoreBackup).not.toHaveBeenCalled();
    expect(harness.storage.audits.at(-1)).toMatchObject({ outcome: 'preflight_failed' });
  });

  it('stops a new Core that fails health and falls back to legacy', async () => {
    const harness = createHarness({ centaurStartFailures: [new Error('health timeout')] });
    const service = createService(harness);

    await expect(service.start('/live-data')).resolves.toBe(42000);

    expect(harness.events).toContain('centaur-1:stop');
    expect(harness.storage.createBackup).not.toHaveBeenCalled();
    expect(harness.legacyManagers).toHaveLength(1);
  });

  it('starts legacy when the durable backup cannot be created', async () => {
    const harness = createHarness();
    vi.mocked(harness.storage.createBackup).mockRejectedValueOnce(new Error('backup disk full'));
    const service = createService(harness);

    await expect(service.start('/live-data')).resolves.toBe(42000);

    expect(harness.centaurManagers).toHaveLength(1);
    expect(harness.storage.audits.at(-1)).toMatchObject({ outcome: 'backup_failed' });
  });

  it('rejects a preflight consumer contract and starts legacy without migrating live data', async () => {
    const harness = createHarness();
    const service = createService(harness, async () => {
      throw new Error('consumer contract mismatch');
    });

    await expect(service.start('/live-data')).resolves.toBe(42000);

    expect(harness.events).toContain('centaur-1:stop');
    expect(harness.events).not.toContain('centaur-2:start:/live-data');
    expect(harness.storage.restoreBackup).not.toHaveBeenCalled();
  });

  it('stops formal Core, restores atomically, then starts legacy after contract failure', async () => {
    const harness = createHarness();
    let contractCall = 0;
    const service = createService(harness, async () => {
      contractCall += 1;
      if (contractCall === 2) throw new Error('formal contract mismatch');
    });
    vi.mocked(harness.storage.restoreBackup).mockImplementation(async () => {
      harness.events.push('restore');
      expect(harness.activeCount).toBe(0);
    });

    await expect(service.start('/live-data')).resolves.toBe(42000);

    const stopIndex = harness.events.indexOf('centaur-2:stop');
    const restoreIndex = harness.events.indexOf('restore');
    const legacyIndex = harness.events.indexOf('legacy-1:start:/live-data');
    expect(stopIndex).toBeLessThan(restoreIndex);
    expect(restoreIndex).toBeLessThan(legacyIndex);
    expect(harness.maxActiveCount).toBe(1);
    expect(harness.storage.audits.at(-1)).toMatchObject({ outcome: 'rolled_back' });
  });

  it('recovers when formal Core crashes during the post-migration contract', async () => {
    const harness = createHarness();
    let contractCall = 0;
    const service = createService(harness, async () => {
      contractCall += 1;
      if (contractCall === 2) {
        harness.centaurManagers[1].crash();
        throw new Error('connection reset after Core crash');
      }
    });

    await expect(service.start('/live-data')).resolves.toBe(42000);

    expect(harness.events).toContain('centaur-2:crash');
    expect(harness.events).toContain('centaur-2:stop');
    expect(harness.storage.restoreBackup).toHaveBeenCalledWith('/live-data', BACKUP);
  });

  it('fails closed and never starts legacy when restoring the backup fails', async () => {
    const harness = createHarness();
    let contractCall = 0;
    const service = createService(harness, async () => {
      contractCall += 1;
      if (contractCall === 2) throw new Error('formal contract mismatch');
    });
    vi.mocked(harness.storage.restoreBackup).mockRejectedValueOnce(new Error('restore disk error'));

    await expect(service.start('/live-data')).rejects.toBeInstanceOf(CoreSwitchRollbackError);

    expect(harness.legacyManagers).toHaveLength(0);
    expect(harness.activeCount).toBe(0);
    expect(harness.storage.audits.at(-1)).toMatchObject({ outcome: 'restore_failed' });
  });

  it('refuses to restore while formal Core cannot be confirmed stopped', async () => {
    const harness = createHarness();
    harness.centaurStopFailures.push(undefined, new Error('kill failed'));
    let contractCall = 0;
    const service = createService(harness, async () => {
      contractCall += 1;
      if (contractCall === 2) throw new Error('formal contract mismatch');
    });

    await expect(service.start('/live-data')).rejects.toThrow('Refusing to restore');

    expect(harness.storage.restoreBackup).not.toHaveBeenCalled();
    expect(harness.legacyManagers).toHaveLength(0);
  });

  it('does not create a process when the inter-process switch lock is held', async () => {
    const harness = createHarness();
    vi.mocked(harness.storage.acquireLock).mockRejectedValueOnce(new Error('switch locked'));
    const service = createService(harness);

    await expect(service.start('/live-data')).rejects.toThrow('switch locked');
    expect(harness.centaurManagers).toHaveLength(0);
    expect(harness.legacyManagers).toHaveLength(0);
  });

  it('restores an interrupted formal marker before starting legacy after power loss', async () => {
    const interrupted: CoreSwitchState = {
      schemaVersion: 1,
      phase: 'formal_starting',
      dataDir: '/live-data',
      updatedAt: '2026-07-11T23:59:00.000Z',
      backup: BACKUP,
    };
    const harness = createHarness({ state: interrupted });
    const service = createService(harness);
    vi.mocked(harness.storage.restoreBackup).mockImplementation(async () => {
      harness.events.push('restore-interrupted');
    });

    await expect(service.start('/live-data')).resolves.toBe(42000);

    expect(harness.centaurManagers).toHaveLength(0);
    expect(harness.events.indexOf('restore-interrupted')).toBeLessThan(
      harness.events.indexOf('legacy-1:start:/live-data')
    );
    expect(harness.storage.audits.at(-1)).toMatchObject({ outcome: 'interrupted_switch_recovered' });
  });

  it('cleans a safe interrupted preflight marker and retries the switch', async () => {
    const harness = createHarness({
      state: {
        schemaVersion: 1,
        phase: 'preflight_starting',
        dataDir: '/live-data',
        updatedAt: '2026-07-11T23:59:00.000Z',
      },
    });
    const service = createService(harness);

    await expect(service.start('/live-data')).resolves.toBe(41002);

    expect(harness.storage.removePreflightCopy).toHaveBeenCalledWith('/live-data');
    expect(harness.centaurManagers).toHaveLength(2);
  });

  it('fails closed when power-loss backup restoration fails', async () => {
    const harness = createHarness({
      state: {
        schemaVersion: 1,
        phase: 'formal_contract',
        dataDir: '/live-data',
        updatedAt: '2026-07-11T23:59:00.000Z',
        backup: BACKUP,
      },
    });
    vi.mocked(harness.storage.restoreBackup).mockRejectedValueOnce(new Error('recovery restore failed'));
    const service = createService(harness);

    await expect(service.start('/live-data')).rejects.toThrow('interrupted Core switch backup');

    expect(harness.legacyManagers).toHaveLength(0);
    expect(harness.storage.audits.at(-1)).toMatchObject({ outcome: 'restore_failed' });
  });

  it('preserves current data before using the retained rollback package after a later startup failure', async () => {
    const harness = createHarness({ centaurStartFailures: [new Error('new Core no longer starts')] });
    vi.mocked(harness.storage.readCompletionMarker).mockResolvedValueOnce({
      schemaVersion: 1,
      completedAt: '2026-07-12T00:00:00.000Z',
      coreVersion: 'v0.2.2',
      legacyVersion: 'v0.1.24',
      backup: BACKUP,
    });
    const service = createService(harness);

    await expect(service.start('/live-data')).resolves.toBe(42000);

    expect(harness.storage.createPreflightCopy).not.toHaveBeenCalled();
    expect(harness.storage.createBackup).toHaveBeenCalledWith('/live-data');
    expect(harness.storage.restoreBackup).toHaveBeenCalledWith('/live-data', BACKUP);
    expect(harness.storage.clearCompletionMarker).toHaveBeenCalledWith('/live-data');
    expect(harness.legacyManagers).toHaveLength(1);
  });

  it('validates a completed switch without repeating preflight', async () => {
    const harness = createHarness();
    vi.mocked(harness.storage.readCompletionMarker).mockResolvedValueOnce({
      schemaVersion: 1,
      completedAt: '2026-07-12T00:00:00.000Z',
      coreVersion: 'v0.2.2',
      legacyVersion: 'v0.1.24',
      backup: BACKUP,
    });
    const contract = vi.fn(async () => {});
    const service = createService(harness, contract);

    await expect(service.start('/live-data')).resolves.toBe(41001);

    expect(contract).toHaveBeenCalledTimes(1);
    expect(harness.storage.createPreflightCopy).not.toHaveBeenCalled();
    expect(harness.storage.restoreBackup).not.toHaveBeenCalled();
  });

  it('runs a new preflight and backup when the completed Core version is outdated', async () => {
    const harness = createHarness();
    vi.mocked(harness.storage.readCompletionMarker).mockResolvedValueOnce({
      schemaVersion: 1,
      completedAt: '2026-07-12T00:00:00.000Z',
      coreVersion: 'v0.1.48',
      legacyVersion: 'v0.1.24',
      backup: BACKUP,
    });
    const service = createService(harness);

    await expect(service.start('/live-data')).resolves.toBe(41002);

    expect(harness.storage.clearCompletionMarker).toHaveBeenCalledWith('/live-data');
    expect(harness.storage.createPreflightCopy).toHaveBeenCalledWith('/live-data');
    expect(harness.storage.createBackup).toHaveBeenCalledWith('/live-data');
    expect(harness.storage.completionWritten).toBe(true);
  });

  it('fails closed when a completed Core cannot be stopped before recovery', async () => {
    const harness = createHarness({ centaurStartFailures: [new Error('completed Core failed')] });
    harness.centaurStopFailures.push(new Error('completed Core kill failed'));
    vi.mocked(harness.storage.readCompletionMarker).mockResolvedValueOnce({
      schemaVersion: 1,
      completedAt: '2026-07-12T00:00:00.000Z',
      coreVersion: 'v0.2.2',
      legacyVersion: 'v0.1.24',
      backup: BACKUP,
    });
    const service = createService(harness);

    await expect(service.start('/live-data')).rejects.toThrow('Refusing completed-switch recovery');

    expect(harness.storage.restoreBackup).not.toHaveBeenCalled();
  });

  it('audits and fails closed when retained completed-switch recovery is unsafe', async () => {
    const harness = createHarness({ centaurStartFailures: [new Error('completed Core failed')] });
    vi.mocked(harness.storage.readCompletionMarker).mockResolvedValueOnce({
      schemaVersion: 1,
      completedAt: '2026-07-12T00:00:00.000Z',
      coreVersion: 'v0.2.2',
      legacyVersion: 'v0.1.24',
      backup: BACKUP,
    });
    vi.mocked(harness.storage.createBackup).mockRejectedValueOnce(new Error('cannot preserve current data'));
    const service = createService(harness);

    await expect(service.start('/live-data')).rejects.toThrow('retained rollback recovery was not safe');

    expect(harness.storage.restoreBackup).not.toHaveBeenCalled();
    expect(harness.storage.audits.at(-1)).toMatchObject({ outcome: 'restore_failed' });
  });

  it('propagates a legacy startup failure after cleaning failed preflight state', async () => {
    const harness = createHarness({ centaurStartFailures: [new Error('preflight health failed')] });
    harness.legacyStartFailures.push(new Error('legacy also failed'));
    vi.mocked(harness.storage.removePreflightCopy).mockRejectedValueOnce(new Error('cleanup copy failed'));
    vi.mocked(harness.storage.clearState).mockRejectedValueOnce(new Error('cleanup marker failed'));
    const service = createService(harness);

    await expect(service.start('/live-data')).rejects.toThrow('legacy also failed');

    expect(harness.legacyManagers[0].status).toBe('stopped');
  });
});
