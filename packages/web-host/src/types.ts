// Core types for @aionui/web-host (M3 interface contract, locked for M4-M8)

/**
 * App metadata injected by host environment (Electron or Node)
 */
export type AppMetadata = {
  version: string;
  isPackaged: boolean;
  resourcesPath: string;
  userDataPath: string;
};

/**
 * Backend binary resolver function injected by host environment
 */
export type BackendBinaryResolver = () => string;

/**
 * System dirs exported to the backend via AIONUI_{CACHE,WORK,LOG}_DIR env.
 * Backend surfaces these on `/api/system/info`. Omit and the backend inherits
 * process.env, which may carry stale values from the parent shell — better to
 * be explicit.
 */
export type BackendSystemDirs = {
  cacheDir: string;
  workDir: string;
  logDir: string;
};

/**
 * Options for starting WebHost
 */
export type WebHostOptions = {
  app: AppMetadata;
  staticDir: string;
  port?: number;
  allowRemote?: boolean;
  /** Directory of bundled native client installers, served at /api/downloads/*. */
  installerDir?: string;
  /** Directory hosting the enterprise LAN shared library, served at /api/shared-drive/*. */
  sharedDriveDir?: string;
  /** Root of the enterprise LAN network drive, browsed read-only at /api/nas/*. */
  nasRootDir?: string;
  /** Image workbench SPA dist dir, served to browser/LAN users at /workbench/image/*. */
  imageWorkbenchDir?: string;
  /** Server-held image API key, injected by the /workbench/image/__proxy/* proxy. */
  imageKey?: string;
  /** Host opencut origin reverse-proxied at /workbench/video/* (default localhost:3000). */
  videoUpstreamUrl?: string;
  /**
   * When true, the WebUI proxy returns 403 for the aioncore team/meeting API
   * (`/api/teams*`). Set by the Team edition so LAN employees can't run 智囊团
   * (decision meetings) by hitting the backend directly. The feature's UI is
   * already removed from the Team renderer; this closes the API-level hole.
   */
  blockTeamRoutes?: boolean;
  dataDir?: string;
  logDir?: string;
  dirs?: BackendSystemDirs;
  backend: { kind: 'ownBackend'; resolveBackend: BackendBinaryResolver } | { kind: 'useExistingBackend'; port: number };
};

/**
 * Handle returned by startWebHost
 */
export type WebHostHandle = {
  port: number;
  backendPort: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};
