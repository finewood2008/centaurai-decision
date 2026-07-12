import path from 'node:path';
import type { BackendDirConfig, BackendStartOptions } from '@aionui/web-host';
import { runCentaurConsumerContract, verifyCoreMigrationCount } from './consumerContract';
import { CoreSwitchFileStorage } from './storage';
import type {
  BackupDescriptor,
  CoreSwitchAudit,
  CoreSwitchCompletion,
  CoreSwitchPhase,
  CoreSwitchState,
  CoreSwitchStorage,
  ManagedCoreProcess,
} from './types';

type CoreSwitchServiceDependencies = {
  createCentaurCore: () => ManagedCoreProcess;
  createLegacyCore: () => ManagedCoreProcess;
  coreVersion?: string;
  legacyVersion?: string;
  now?: () => Date;
  prepareLegacyDatabase?: (dataDir: string) => Promise<void>;
  runConsumerContract?: (port: number) => Promise<void>;
  storage?: CoreSwitchStorage;
  verifyForwardMigrations?: (dataDir: string) => Promise<void>;
};

const UNSAFE_INTERRUPTED_PHASES = new Set<CoreSwitchPhase>([
  'backup_ready',
  'formal_starting',
  'formal_contract',
  'restoring',
]);

export class CoreSwitchRollbackError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CoreSwitchRollbackError';
    this.cause = cause;
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

/**
 * First-run Core switch orchestrator. It owns sequencing and rollback, while
 * BackendLifecycleManager remains responsible only for one child process.
 */
export class CoreSwitchService {
  private activeCore: ManagedCoreProcess | undefined;
  private readonly coreVersion: string;
  private readonly legacyVersion: string;
  private readonly now: () => Date;
  private readonly prepareLegacyDatabase: (dataDir: string) => Promise<void>;
  private readonly runConsumerContract: (port: number) => Promise<void>;
  private readonly storage: CoreSwitchStorage;
  private readonly verifyForwardMigrations: (dataDir: string) => Promise<void>;

  constructor(private readonly dependencies: CoreSwitchServiceDependencies) {
    this.coreVersion = dependencies.coreVersion ?? 'v0.2.2';
    this.legacyVersion = dependencies.legacyVersion ?? 'v0.1.24';
    this.now = dependencies.now ?? (() => new Date());
    this.prepareLegacyDatabase = dependencies.prepareLegacyDatabase ?? (async () => {});
    this.runConsumerContract = dependencies.runConsumerContract ?? runCentaurConsumerContract;
    this.storage = dependencies.storage ?? new CoreSwitchFileStorage();
    this.verifyForwardMigrations = dependencies.verifyForwardMigrations ?? verifyCoreMigrationCount;
  }

  get port(): number {
    return this.activeCore?.port ?? 0;
  }

  get status(): ManagedCoreProcess['status'] {
    return this.activeCore?.status ?? 'stopped';
  }

  async start(
    dataDir: string,
    logDir?: string,
    dirs?: BackendDirConfig,
    options?: BackendStartOptions,
    preferredPort?: number
  ): Promise<number> {
    if (this.activeCore && this.activeCore.status !== 'stopped') {
      throw new Error('CoreSwitchService cannot start while another Core process is active');
    }

    const releaseLock = await this.storage.acquireLock(dataDir);
    try {
      const completion = await this.storage.readCompletionMarker(dataDir);
      if (completion) {
        if (completion.coreVersion !== this.coreVersion || completion.legacyVersion !== this.legacyVersion) {
          await this.storage.clearCompletionMarker(dataDir);
          return await this.runFirstSwitch(dataDir, logDir, dirs, preferredPort);
        }
        return await this.startCompletedCore(dataDir, logDir, dirs, options, preferredPort, completion);
      }

      const recoveredPort = await this.recoverInterruptedSwitch(dataDir, logDir, dirs, preferredPort);
      if (recoveredPort !== undefined) return recoveredPort;

      return await this.runFirstSwitch(dataDir, logDir, dirs, preferredPort);
    } finally {
      await releaseLock().catch(() => {});
    }
  }

  async stop(): Promise<void> {
    const active = this.activeCore;
    this.activeCore = undefined;
    await active?.stop();
  }

  private async startCompletedCore(
    dataDir: string,
    logDir: string | undefined,
    dirs: BackendDirConfig | undefined,
    options: BackendStartOptions | undefined,
    preferredPort: number | undefined,
    completion: CoreSwitchCompletion
  ): Promise<number> {
    const core = this.dependencies.createCentaurCore();
    this.activeCore = core;
    try {
      const port = await core.start(
        dataDir,
        logDir,
        dirs,
        {
          ...options,
          allowPendingOnHealthTimeout: false,
          requireDualListeningHandshake: true,
        },
        preferredPort
      );
      await this.runConsumerContract(port);
      await this.verifyForwardMigrations(dataDir);
      return port;
    } catch (error) {
      this.activeCore = undefined;
      try {
        await core.stop();
      } catch (stopError) {
        throw new CoreSwitchRollbackError(
          'Refusing completed-switch recovery while the new Core may be running',
          stopError
        );
      }

      let preservedSnapshot: BackupDescriptor;
      try {
        // Preserve any post-switch user data before restoring the retained
        // legacy-compatible rollback package.
        preservedSnapshot = await this.storage.createBackup(dataDir);
        await this.storage.restoreBackup(dataDir, completion.backup);
        await this.storage.clearCompletionMarker(dataDir);
        await this.storage.clearState(dataDir).catch(() => {});
      } catch (restoreError) {
        await this.writeAudit(dataDir, {
          outcome: 'restore_failed',
          reason: errorMessage(restoreError),
          backup: completion.backup,
        });
        throw new CoreSwitchRollbackError(
          'Completed Core failed and retained rollback recovery was not safe',
          restoreError
        );
      }

      const legacyPort = await this.startLegacyCore(dataDir, logDir, dirs, preferredPort);
      await this.writeAudit(dataDir, {
        outcome: 'rolled_back',
        reason: `Completed Core startup failed: ${errorMessage(error)}`,
        backup: completion.backup,
        preservedSnapshot,
      });
      return legacyPort;
    }
  }

  private async recoverInterruptedSwitch(
    dataDir: string,
    logDir: string | undefined,
    dirs: BackendDirConfig | undefined,
    preferredPort: number | undefined
  ): Promise<number | undefined> {
    const state = await this.storage.readState(dataDir);
    if (!state) return undefined;

    if (!UNSAFE_INTERRUPTED_PHASES.has(state.phase) || !state.backup) {
      await this.storage.removePreflightCopy(dataDir);
      await this.storage.clearState(dataDir);
      return undefined;
    }

    try {
      await this.writeState(dataDir, 'restoring', state.stagingDir, state.backup);
      await this.storage.restoreBackup(dataDir, state.backup);
      await this.storage.removePreflightCopy(dataDir);
      await this.storage.clearState(dataDir);
      await this.writeAudit(dataDir, {
        outcome: 'interrupted_switch_recovered',
        reason: `Recovered interrupted phase ${state.phase}`,
        backup: state.backup,
      });
    } catch (error) {
      await this.writeAudit(dataDir, {
        outcome: 'restore_failed',
        reason: errorMessage(error),
        backup: state.backup,
      });
      throw new CoreSwitchRollbackError('Could not restore the interrupted Core switch backup', error);
    }

    return await this.startLegacyCore(dataDir, logDir, dirs, preferredPort);
  }

  private async runFirstSwitch(
    dataDir: string,
    logDir: string | undefined,
    dirs: BackendDirConfig | undefined,
    preferredPort: number | undefined
  ): Promise<number> {
    let stagingDir: string;
    try {
      await this.writeState(dataDir, 'preflight_copying');
      stagingDir = await this.storage.createPreflightCopy(dataDir);
      await this.writeState(dataDir, 'preflight_starting', stagingDir);
      await this.runPreflight(stagingDir);
      await this.writeState(dataDir, 'preflight_passed', stagingDir);
    } catch (error) {
      await this.cleanupPreflight(dataDir);
      await this.writeAudit(dataDir, { outcome: 'preflight_failed', reason: errorMessage(error) });
      return await this.startLegacyCore(dataDir, logDir, dirs, preferredPort);
    }

    let backup: BackupDescriptor;
    try {
      await this.writeState(dataDir, 'backup_creating', stagingDir);
      backup = await this.storage.createBackup(dataDir);
      await this.writeState(dataDir, 'backup_ready', stagingDir, backup);
    } catch (error) {
      await this.cleanupPreflight(dataDir);
      await this.writeAudit(dataDir, { outcome: 'backup_failed', reason: errorMessage(error) });
      return await this.startLegacyCore(dataDir, logDir, dirs, preferredPort);
    }

    await this.storage.removePreflightCopy(dataDir);
    return await this.startFormalCore(dataDir, logDir, dirs, preferredPort, backup);
  }

  private async runPreflight(stagingDir: string): Promise<void> {
    const core = this.dependencies.createCentaurCore();
    const isolatedRoot = path.join(stagingDir, '.core-switch-runtime');
    try {
      await this.prepareLegacyDatabase(stagingDir);
      const port = await core.start(
        stagingDir,
        path.join(isolatedRoot, 'logs'),
        {
          cacheDir: path.join(isolatedRoot, 'cache'),
          workDir: path.join(isolatedRoot, 'work'),
          logDir: path.join(isolatedRoot, 'logs'),
        },
        {
          allowPendingOnHealthTimeout: false,
          requireDualListeningHandshake: true,
        },
        0
      );
      await this.runConsumerContract(port);
    } finally {
      await core.stop();
    }
    await this.verifyForwardMigrations(stagingDir);
  }

  private async startFormalCore(
    dataDir: string,
    logDir: string | undefined,
    dirs: BackendDirConfig | undefined,
    preferredPort: number | undefined,
    backup: BackupDescriptor
  ): Promise<number> {
    const core = this.dependencies.createCentaurCore();
    try {
      await this.writeState(dataDir, 'formal_starting', undefined, backup);
      await this.prepareLegacyDatabase(dataDir);
      const port = await core.start(
        dataDir,
        logDir,
        dirs,
        {
          allowPendingOnHealthTimeout: false,
          requireDualListeningHandshake: true,
        },
        preferredPort
      );
      this.activeCore = core;
      await this.writeState(dataDir, 'formal_contract', undefined, backup);
      await this.runConsumerContract(port);
      await this.verifyForwardMigrations(dataDir);
      await this.storage.pruneBackups(dataDir, backup.rootDir);
      await this.writeAudit(dataDir, { outcome: 'switched', backup });
      await this.storage.writeCompletionMarker(dataDir, {
        schemaVersion: 1,
        completedAt: this.now().toISOString(),
        coreVersion: this.coreVersion,
        legacyVersion: this.legacyVersion,
        backup,
      });
      await this.storage.clearState(dataDir).catch(() => {});
      return port;
    } catch (switchError) {
      this.activeCore = undefined;
      try {
        await core.stop();
      } catch (stopError) {
        await this.writeAudit(dataDir, {
          outcome: 'restore_failed',
          reason: `New Core could not be stopped: ${errorMessage(stopError)}`,
          backup,
        });
        throw new CoreSwitchRollbackError('Refusing to restore while the new Core may still be running', stopError);
      }

      try {
        await this.writeState(dataDir, 'restoring', undefined, backup);
        await this.storage.restoreBackup(dataDir, backup);
      } catch (restoreError) {
        await this.writeAudit(dataDir, {
          outcome: 'restore_failed',
          reason: errorMessage(restoreError),
          backup,
        });
        throw new CoreSwitchRollbackError('New Core failed and the rollback data could not be restored', restoreError);
      }

      await this.storage.clearState(dataDir).catch(() => {});
      const legacyPort = await this.startLegacyCore(dataDir, logDir, dirs, preferredPort);
      await this.writeAudit(dataDir, {
        outcome: 'rolled_back',
        reason: errorMessage(switchError),
        backup,
      });
      return legacyPort;
    }
  }

  private async startLegacyCore(
    dataDir: string,
    logDir: string | undefined,
    dirs: BackendDirConfig | undefined,
    preferredPort: number | undefined
  ): Promise<number> {
    const legacy = this.dependencies.createLegacyCore();
    try {
      const port = await legacy.start(dataDir, logDir, dirs, { allowPendingOnHealthTimeout: false }, preferredPort);
      this.activeCore = legacy;
      return port;
    } catch (error) {
      await legacy.stop();
      throw error;
    }
  }

  private async cleanupPreflight(dataDir: string): Promise<void> {
    await this.storage.removePreflightCopy(dataDir).catch(() => {});
    await this.storage.clearState(dataDir).catch(() => {});
  }

  private async writeState(
    dataDir: string,
    phase: CoreSwitchPhase,
    stagingDir?: string,
    backup?: BackupDescriptor
  ): Promise<void> {
    const state: CoreSwitchState = {
      schemaVersion: 1,
      phase,
      dataDir,
      updatedAt: this.now().toISOString(),
    };
    if (stagingDir) state.stagingDir = stagingDir;
    if (backup) state.backup = backup;
    await this.storage.writeState(dataDir, state);
  }

  private async writeAudit(dataDir: string, audit: Omit<CoreSwitchAudit, 'schemaVersion' | 'at'>): Promise<void> {
    await this.storage.writeAudit(dataDir, {
      schemaVersion: 1,
      at: this.now().toISOString(),
      ...audit,
    });
  }
}
