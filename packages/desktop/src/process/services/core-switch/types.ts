import type { BackendDirConfig, BackendStartOptions } from '@aionui/web-host';

export type CoreProcessStatus = 'stopped' | 'starting' | 'running' | 'error';

export type ManagedCoreProcess = {
  readonly port: number;
  readonly status: CoreProcessStatus;
  start(
    dataDir: string,
    logDir?: string,
    dirs?: BackendDirConfig,
    options?: BackendStartOptions,
    preferredPort?: number
  ): Promise<number>;
  stop(): Promise<void>;
};

export type BackupManifestEntry = {
  path: string;
  sha256: string;
  size: number;
  type: 'file' | 'symlink';
};

export type BackupManifest = {
  schemaVersion: 1;
  createdAt: string;
  dataDir: string;
  files: BackupManifestEntry[];
  aggregateSha256: string;
};

export type BackupDescriptor = {
  rootDir: string;
  dataDir: string;
  manifestPath: string;
  aggregateSha256: string;
  fileCount: number;
};

export type CoreSwitchPhase =
  | 'preflight_copying'
  | 'preflight_starting'
  | 'preflight_contract'
  | 'preflight_passed'
  | 'backup_creating'
  | 'backup_ready'
  | 'formal_starting'
  | 'formal_contract'
  | 'restoring';

export type CoreSwitchState = {
  schemaVersion: 1;
  phase: CoreSwitchPhase;
  dataDir: string;
  updatedAt: string;
  stagingDir?: string;
  backup?: BackupDescriptor;
};

export type CoreSwitchCompletion = {
  schemaVersion: 1;
  completedAt: string;
  coreVersion: string;
  legacyVersion: string;
  backup: BackupDescriptor;
};

export type CoreSwitchAudit = {
  schemaVersion: 1;
  at: string;
  outcome:
    | 'switched'
    | 'rolled_back'
    | 'preflight_failed'
    | 'backup_failed'
    | 'restore_failed'
    | 'interrupted_switch_recovered';
  reason?: string;
  backup?: BackupDescriptor;
  preservedSnapshot?: BackupDescriptor;
};

export type CoreSwitchStorage = {
  acquireLock(dataDir: string): Promise<() => Promise<void>>;
  hasCompletionMarker(dataDir: string): Promise<boolean>;
  readCompletionMarker(dataDir: string): Promise<CoreSwitchCompletion | undefined>;
  clearCompletionMarker(dataDir: string): Promise<void>;
  writeCompletionMarker(dataDir: string, marker: CoreSwitchCompletion): Promise<void>;
  readState(dataDir: string): Promise<CoreSwitchState | undefined>;
  writeState(dataDir: string, state: CoreSwitchState): Promise<void>;
  clearState(dataDir: string): Promise<void>;
  createPreflightCopy(dataDir: string): Promise<string>;
  removePreflightCopy(dataDir: string): Promise<void>;
  createBackup(dataDir: string): Promise<BackupDescriptor>;
  restoreBackup(dataDir: string, backup: BackupDescriptor): Promise<void>;
  pruneBackups(dataDir: string, keepRootDir: string): Promise<void>;
  writeAudit(dataDir: string, audit: CoreSwitchAudit): Promise<void>;
};
