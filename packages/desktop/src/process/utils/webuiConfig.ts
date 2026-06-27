/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { networkInterfaces } from 'os';
import { getSystemDir } from './initStorage';
import { httpRequest } from '@/common/adapter/httpBridge';
import { startWebHost, type WebHostHandle } from '@aionui/web-host';
import { getDataPath } from './utils';
import { IS_TEAM, MULTI_USER_ENABLED } from '@/common/config/constants';

const WEBUI_CONFIG_FILE = 'webui.config.json';

/**
 * Resolve the directory that holds the bundled native client installers served
 * at /api/downloads/*. Honors an explicit AIONUI_INSTALLER_DIR override; in a
 * packaged app the installers ship via electron-builder extraResources at
 * `<resources>/client-installers`; in dev they live in the repo's
 * `resources/client-installers`.
 */
function resolveInstallerDir(): string {
  const override = process.env.AIONUI_INSTALLER_DIR;
  if (override) return override;
  if (app.isPackaged) return path.join(process.resourcesPath, 'client-installers');
  return path.join(process.cwd(), 'resources', 'client-installers');
}
const DESKTOP_WEBUI_ENABLED_KEY = 'webui.desktop.enabled';
const DESKTOP_WEBUI_ALLOW_REMOTE_KEY = 'webui.desktop.allowRemote';
const DESKTOP_WEBUI_PORT_KEY = 'webui.desktop.port';
const DESKTOP_NAS_ROOT_KEY = 'webui.desktop.nasRootDir';

/**
 * Resolve the enterprise network-drive root browsed read-only at /api/nas/*.
 * The admin points this at the company's large shared disk via Settings; an
 * AIONUI_NAS_ROOT env override wins for headless/test setups. Returns undefined
 * (NAS disabled) when unset or the configured path is not an existing dir.
 *
 * Exported so the admin-desktop IPC bridge (nasDriveBridge) resolves the same
 * root the WebUI static-server serves. Uses async stat — a synchronous stat on
 * a hung NFS/SMB mount would stall the whole main process at startup.
 */
export async function resolveNasRootDir(): Promise<string | undefined> {
  let candidate = process.env.AIONUI_NAS_ROOT?.trim();
  if (!candidate) {
    try {
      const settings = await httpRequest<Record<string, unknown>>('GET', '/api/settings/client');
      const raw = settings?.[DESKTOP_NAS_ROOT_KEY];
      if (typeof raw === 'string' && raw.trim()) candidate = raw.trim();
    } catch (error) {
      console.error('[WebUI] Failed to read NAS root from backend:', error);
    }
  }
  if (!candidate) return undefined;
  try {
    if ((await fs.promises.stat(candidate)).isDirectory()) return candidate;
  } catch {
    // Configured path missing / unreadable — disable rather than crash startup.
  }
  return undefined;
}

/**
 * Resolve the server-held image workbench API key for browser/LAN users.
 *
 * Best-effort: an explicit `AIONUI_IMAGE_WORKBENCH_KEY` env wins, else we reuse
 * the configured image-generation model's key. Undefined → the /workbench/image
 * proxy passes the client's own Authorization through (the desktop behavior), so
 * the feature still works; injecting a shared key just spares each LAN user from
 * pasting one and keeps the key off the wire.
 */
async function resolveImageWorkbenchKey(): Promise<string | undefined> {
  const fromEnv = process.env.AIONUI_IMAGE_WORKBENCH_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const settings = await httpRequest<Record<string, unknown>>('GET', '/api/settings/client');
    const model = settings?.['tools.imageGenerationModel'] as { api_key?: string } | undefined;
    const key = model?.api_key?.trim();
    if (key) return key;
  } catch (error) {
    console.error('[WebUI] Failed to read image workbench key from backend:', error);
  }
  return undefined;
}

type WebUIDesktopPreferences = {
  enabled: boolean;
  allowRemote: boolean;
  port: number | undefined;
};

/**
 * Read WebUI preferences from the backend's /api/settings/client store.
 *
 * Returns `null` when the backend could not be reached — deliberately distinct
 * from `{ enabled: false }`. Conflating the two was the bug behind "LAN access
 * dies on every restart": at boot the backend is often still starting (health
 * check pending) when auto-restore runs, the read threw, and the old code
 * swallowed that as `enabled:false`, so the WebUI silently never came back up
 * until the user re-toggled it in Settings. The caller now retries on `null`
 * instead of giving up. See {@link restoreDesktopWebUIFromPreferences}.
 *
 * Historical note: this used to read from `ProcessConfig` (a local JSON file).
 * The renderer's `configService` was migrated to the backend HTTP store, but
 * this main-process path was not, so `webui.desktop.enabled` that the user
 * toggled via Settings was only ever persisted to SQLite — the next launch's
 * auto-restore always read `undefined` from the local file and did nothing,
 * yet the Settings page still showed the Switch as "on" (reading the SQLite
 * value), so users clicked the saved URL and got ERR_CONNECTION_REFUSED.
 */
async function readWebUIDesktopPreferences(): Promise<WebUIDesktopPreferences | null> {
  try {
    const settings = await httpRequest<Record<string, unknown>>('GET', '/api/settings/client');
    const enabled = settings?.[DESKTOP_WEBUI_ENABLED_KEY] === true;
    const allowRemote = settings?.[DESKTOP_WEBUI_ALLOW_REMOTE_KEY] === true;
    const rawPort = settings?.[DESKTOP_WEBUI_PORT_KEY];
    const port = typeof rawPort === 'number' && rawPort > 0 ? rawPort : undefined;
    return { enabled, allowRemote, port };
  } catch {
    // Backend not reachable yet (still starting) — signal "unknown", not "off".
    return null;
  }
}

/**
 * Poll {@link readWebUIDesktopPreferences} until the backend answers or the
 * deadline elapses. Auto-restore fires right after the main window is created,
 * which on a normally-loaded machine reliably beats the backend's HTTP server
 * coming up; a single read would lose that race every launch. We retry on a
 * fixed interval so a slow backend start just delays restore rather than
 * cancelling it. Returns the preferences once read, or `null` if the backend
 * never became reachable within the deadline.
 */
async function readWebUIDesktopPreferencesWithRetry(
  deadlineMs = 60_000,
  intervalMs = 1_000
): Promise<WebUIDesktopPreferences | null> {
  const deadline = Date.now() + deadlineMs;
  // First attempt is immediate; loop only if the backend is not up yet.
  for (;;) {
    const prefs = await readWebUIDesktopPreferences();
    if (prefs !== null) return prefs;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function writeWebUIDesktopEnabled(enabled: boolean): Promise<void> {
  try {
    await httpRequest<void>('PUT', '/api/settings/client', { [DESKTOP_WEBUI_ENABLED_KEY]: enabled });
  } catch (error) {
    console.error('[WebUI] Failed to reconcile webui.desktop.enabled on backend:', error);
  }
}

export type WebUIUserConfig = {
  port?: number | string;
  allowRemote?: boolean;
  // Legacy fields, retired in favor of SQLite users table. Present only when
  // reading an older webui.config.json; stripped on every rewrite.
  passwordHash?: string;
  passwordUpdatedAt?: string;
  adminUsername?: string;
};

export const parsePortValue = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const portNumber = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(portNumber) || portNumber < 1 || portNumber > 65535) {
    return null;
  }
  return portNumber;
};

export const parseBooleanEnv = (value?: string): boolean | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
};

export const loadUserWebUIConfig = (): { config: WebUIUserConfig; path: string | null; exists: boolean } => {
  try {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, WEBUI_CONFIG_FILE);
    if (!fs.existsSync(configPath)) {
      return { config: {}, path: configPath, exists: false };
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { config: {}, path: configPath, exists: false };
    }
    return { config: parsed as WebUIUserConfig, path: configPath, exists: true };
  } catch {
    return { config: {}, path: null, exists: false };
  }
};

/**
 * Atomic write of webui.config.json into the Electron userData dir.
 * Drops legacy password fields (passwordHash / passwordUpdatedAt); the SQLite
 * users table is now the single source of truth for credentials.
 * Write-to-tmp-then-rename prevents corruption if the process is killed mid-write.
 */
export const saveUserWebUIConfig = async (config: WebUIUserConfig): Promise<void> => {
  const userDataPath = app.getPath('userData');
  const configPath = path.join(userDataPath, WEBUI_CONFIG_FILE);
  const tmpPath = `${configPath}.tmp`;

  const sanitized: WebUIUserConfig = {};
  if (config.port !== undefined) sanitized.port = config.port;
  if (config.allowRemote !== undefined) sanitized.allowRemote = config.allowRemote;
  if (config.adminUsername !== undefined) sanitized.adminUsername = config.adminUsername;

  await fs.promises.mkdir(userDataPath, { recursive: true });
  const payload = JSON.stringify(sanitized, null, 2) + '\n';
  await fs.promises.writeFile(tmpPath, payload, { encoding: 'utf-8', mode: 0o600 });
  await fs.promises.rename(tmpPath, configPath);
};

// Keep aligned with renderer's WEBUI_DEFAULT_PORT (common/config/constants.ts):
//   production -> 25808, dev -> 25809, multi-instance dev -> 25810
const DEFAULT_WEBUI_PORT = (() => {
  if (process.env.NODE_ENV === 'production') return 25808;
  if (process.env.AIONUI_MULTI_INSTANCE === '1') return 25810;
  return 25809;
})();

export const resolveWebUIPort = (
  config: WebUIUserConfig,
  getSwitchValue: (flag: string) => string | undefined
): number => {
  const cliPort = parsePortValue(getSwitchValue('port') ?? getSwitchValue('webui-port'));
  if (cliPort) return cliPort;

  const envPort = parsePortValue(process.env.AIONUI_PORT ?? process.env.PORT);
  if (envPort) return envPort;

  const configPort = parsePortValue(config.port);
  if (configPort) return configPort;

  return DEFAULT_WEBUI_PORT;
};

export const resolveRemoteAccess = (config: WebUIUserConfig, isRemoteMode: boolean): boolean => {
  const envRemote = parseBooleanEnv(process.env.AIONUI_ALLOW_REMOTE || process.env.AIONUI_REMOTE);
  const hostHint = process.env.AIONUI_HOST?.trim();
  const hostRequestsRemote = hostHint ? ['0.0.0.0', '::', '::0'].includes(hostHint) : false;
  const configRemote = config.allowRemote === true;

  return isRemoteMode || hostRequestsRemote || envRemote === true || configRemote;
};

// ---------------------------------------------------------------------------
// Desktop-managed WebUI lifecycle
// ---------------------------------------------------------------------------

export type DesktopWebUIHandle = {
  port: number;
  allowRemote: boolean;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  initialPassword?: string;
};

let currentHandle: (WebHostHandle & { allowRemote: boolean }) | null = null;
// First-use plaintext password for the active handle. Set by webui.start IPC
// handler before startDesktopWebUI() when the backend reports needs_setup=true,
// so Settings can display the generated password exactly once. Cleared on stop.
let currentInitialPassword: string | undefined;

/**
 * Stash the plaintext password to surface on the next `getDesktopWebUIStatus()`
 * or IPC start response. Call with `undefined` to clear.
 */
export function setDesktopWebUIInitialPassword(password: string | undefined): void {
  currentInitialPassword = password;
}

const getLanIP = (): string | null => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netInfo = nets[name];
    if (!netInfo) continue;
    for (const net of netInfo) {
      const isIPv4 = net.family === 'IPv4' || (net.family as unknown) === 4;
      if (isIPv4 && !net.internal) return net.address;
    }
  }
  return null;
};

const toDesktopHandle = (handle: WebHostHandle, allowRemote: boolean): DesktopWebUIHandle => ({
  port: handle.port,
  allowRemote,
  localUrl: handle.localUrl,
  networkUrl: handle.networkUrl,
  lanIP: handle.lanIP,
  initialPassword: currentInitialPassword,
});

/**
 * Spawn a WebUI instance (static server + backend) and remember the handle so
 * callers can later stop it or query its status.
 *
 * Shared by the boot-time auto-restore path and the interactive
 * Settings → "Enable WebUI" IPC handler.
 */
export async function startDesktopWebUI(opts: { port?: number; allowRemote?: boolean }): Promise<DesktopWebUIHandle> {
  // If already running, tear down first so we honour the new port / allowRemote.
  if (currentHandle) {
    await stopDesktopWebUI();
  }

  // Decision edition is single-user and loopback-only: never expose the WebUI to
  // the LAN, regardless of stored config. full + Team run as multi-user LAN servers.
  const allowRemote = MULTI_USER_ENABLED && opts.allowRemote === true;
  const preferredPort = parsePortValue(opts.port) ?? DEFAULT_WEBUI_PORT;
  const sysDir = getSystemDir();

  // Reuse the backend already spawned by backendManager.start() in src/index.ts.
  // Spawning a second backend here would race the first on the same SQLite file.
  const backendPort = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  if (!backendPort) {
    throw new Error('[WebUI] Cannot start: aioncore is not running (globalThis.__backendPort unset)');
  }

  const handle = await startWebHost({
    app: {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      resourcesPath: app.getAppPath(),
      // webui.config.json must live next to the backend SQLite DB so --resetpass
      // CLI and the runtime settings path read/write the same user record.
      // getDataPath() returns ~/.aionui[-dev] symlink on macOS to sidestep
      // path-with-spaces issues under Application Support.
      userDataPath: getDataPath(),
    },
    // After bundling, this file is out/main/index.js — renderer assets live at ../renderer.
    staticDir: path.join(__dirname, '../renderer'),
    port: preferredPort,
    allowRemote,
    // Team server only: 403 the aioncore team/meeting API at the WebUI proxy so LAN
    // employees can't run 智囊团 (decision meetings) by hitting /api/teams* directly,
    // even though the bundled backend still exposes it. No-op on full + Decision (both keep 智囊团).
    blockTeamRoutes: IS_TEAM,
    // Native client installers bundled with the server, served at /api/downloads/*.
    installerDir: resolveInstallerDir(),
    // Enterprise LAN shared library, served at /api/shared-drive/*.
    sharedDriveDir: path.join(getDataPath(), 'sharedDrive'),
    // Enterprise LAN network drive (the company's large shared disk), browsed
    // read-only at /api/nas/*. Undefined when unconfigured → endpoints disabled.
    nasRootDir: await resolveNasRootDir(),
    // Image workbench for browser/LAN users. Mirror the desktop custom-protocol
    // root (getImageWorkbenchRoot in index.ts): packaged → bundled under the
    // renderer output; dev → the live public/ dist (out/renderer isn't copied
    // until a build). The server injects the key into upstream calls so it never
    // reaches the browser.
    imageWorkbenchDir: app.isPackaged
      ? path.join(__dirname, '../renderer/centaur-image-workbench')
      : path.resolve(process.cwd(), 'public/centaur-image-workbench'),
    imageKey: await resolveImageWorkbenchKey(),
    // Must align with the desktop IPC path's backend dataDir (src/index.ts), otherwise
    // users see divergent SQLite state between desktop app and bundled WebUI.
    dataDir: getDataPath(),
    logDir: sysDir.logDir,
    dirs: {
      cacheDir: sysDir.cacheDir,
      workDir: sysDir.workDir,
      logDir: sysDir.logDir,
    },
    backend: {
      kind: 'useExistingBackend',
      port: backendPort,
    },
  });

  currentHandle = Object.assign(handle, { allowRemote });
  return toDesktopHandle(handle, allowRemote);
}

/**
 * Stop the currently running WebUI instance, if any. No-op when nothing is running.
 */
export async function stopDesktopWebUI(): Promise<void> {
  const handle = currentHandle;
  if (!handle) return;
  currentHandle = null;
  currentInitialPassword = undefined;
  try {
    await handle.stop();
  } catch (err) {
    console.error('[WebUI] stop error:', err);
  }
}

/**
 * Snapshot of the currently running WebUI. Returns a stopped-state descriptor
 * when nothing is running, so callers don't need to branch on null.
 */
export function getDesktopWebUIStatus(): {
  running: boolean;
  port: number;
  allowRemote: boolean;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  initialPassword?: string;
} {
  if (!currentHandle) {
    const lanIP = getLanIP();
    return {
      running: false,
      port: DEFAULT_WEBUI_PORT,
      allowRemote: false,
      localUrl: `http://localhost:${DEFAULT_WEBUI_PORT}`,
      lanIP: lanIP ?? undefined,
    };
  }
  return {
    running: true,
    port: currentHandle.port,
    allowRemote: currentHandle.allowRemote,
    localUrl: currentHandle.localUrl,
    networkUrl: currentHandle.networkUrl,
    lanIP: currentHandle.lanIP,
    initialPassword: currentInitialPassword,
  };
}

export const restoreDesktopWebUIFromPreferences = async (opts?: {
  onRestored?: (handle: DesktopWebUIHandle) => void | Promise<void>;
}): Promise<void> => {
  const prefs = await readWebUIDesktopPreferencesWithRetry();
  if (prefs === null) {
    // Backend never answered within the deadline. Leave the persisted
    // preference untouched (it may well be enabled) so the next launch retries,
    // rather than disabling it and stranding LAN users permanently.
    console.error('[WebUI] Auto-restore: backend did not become reachable in time; will retry next launch');
    return;
  }
  const { enabled, allowRemote, port } = prefs;
  if (!enabled) return;

  const preferredPort = port ?? DEFAULT_WEBUI_PORT;

  try {
    const handle = await startDesktopWebUI({ port: preferredPort, allowRemote });
    await opts?.onRestored?.(handle);
    console.log(
      `[WebUI] Auto-restored from desktop preferences (port=${handle.port}, allowRemote=${handle.allowRemote})`
    );
  } catch (error) {
    // Reconcile the persisted preference with reality. Leaving enabled=true
    // means every subsequent launch will silently re-fail the same way, and
    // the Settings page's Switch would render "on" against an empty 25808.
    console.error('[WebUI] Failed to auto-restore from desktop preferences:', error);
    await writeWebUIDesktopEnabled(false);
  }
};
