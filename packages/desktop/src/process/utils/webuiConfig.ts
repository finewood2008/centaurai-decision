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
import { startWebHost, type WebHostHandle, type EntryHealth } from '@aionui/web-host';
import { getDataPath } from './utils';
import { IS_TEAM, REMOTE_ACCESS_ENABLED } from '@/common/config/constants';

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

async function resolveKnowledgeProxyConfig(): Promise<{ endpoint: string; token?: string }> {
  const envEndpoint = process.env.CENTAURAI_KNOWLEDGE_ENDPOINT?.trim();
  let endpoint = envEndpoint || 'http://127.0.0.1:8618';
  if (!envEndpoint) {
    try {
      const settings = await httpRequest<Record<string, unknown>>('GET', '/api/settings/client');
      const configured = settings?.['vectorDB.endpoint'];
      if (typeof configured === 'string' && configured.trim()) endpoint = configured.trim();
    } catch (error) {
      console.error('[WebUI] Failed to read knowledge endpoint from backend:', error);
    }
  }
  const token =
    process.env.CENTAURAI_KNOWLEDGE_TOKEN?.trim() || process.env.AIONUI_KNOWLEDGE_TOKEN?.trim() || undefined;
  return { endpoint, token };
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
  tailscale: { detected: boolean; ip: string | null; accessUrl: string | null };
  primaryAccessUrl: string | null;
};

type DesktopWebUIRuntimeOptions = {
  port: number;
  allowRemote: boolean;
};

let currentHandle: (WebHostHandle & { allowRemote: boolean }) | null = null;
let currentRuntimeOptions: DesktopWebUIRuntimeOptions | null = null;
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

// Interface names that are virtual / VPN / tunnel / VM — never a real LAN NIC.
// `utun` is the macOS tunnel device used by Clash/mihomo (TUN mode), Tailscale,
// WireGuard, etc.; bridge/vmnet/vboxnet are VM bridges; awdl/llw are Apple
// peer-to-peer Wi-Fi. Picking any of these as "the LAN IP" yields an address no
// other device on the office network can reach.
const VIRTUAL_IFACE_RE = /^(utun|tun|tap|ppp|ipsec|wg|awdl|llw|bridge|vmnet|vboxnet|gif|stf|ap\d)/i;

/**
 * Addresses that are technically non-internal IPv4 but are NOT a usable office
 * LAN IP — handing these to clients would silently break remote access:
 *  - 169.254.0.0/16  link-local (APIPA, no DHCP)
 *  - 198.18.0.0/15   benchmarking range hijacked by Clash/mihomo TUN (e.g. 198.18.0.1)
 *  - 100.64.0.0/10   CGNAT range used by Tailscale
 */
const isProxyOrCgnatAddr = (addr: string): boolean => {
  if (/^198\.1[89]\./.test(addr)) return true;
  const cgnat = /^100\.(\d+)\./.exec(addr);
  if (cgnat && Number(cgnat[1]) >= 64 && Number(cgnat[1]) <= 127) return true;
  return false;
};

const isUsableLanAddr = (addr: string): boolean => !addr.startsWith('169.254.') && !isProxyOrCgnatAddr(addr);

// Rank real RFC1918 private ranges above anything else so a genuine office LAN
// IP always beats a stray public/odd address.
const lanAddrScore = (addr: string): number => {
  if (addr.startsWith('192.168.')) return 3;
  if (addr.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 2;
  return 1;
};

/**
 * All plausible LAN IPv4 addresses for this host, best first. Skips virtual/VPN
 * interfaces and proxy/CGNAT ranges, then prefers RFC1918 + physical `en*` NICs.
 * Robust against the common failure where a TUN proxy's `utun` (198.18.x) or a
 * stale `en0` would otherwise be chosen over the active `en1` LAN address.
 */
export const getLanIPCandidates = (): string[] => {
  const nets = networkInterfaces();
  const found: { iface: string; address: string }[] = [];
  for (const name of Object.keys(nets)) {
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    const netInfo = nets[name];
    if (!netInfo) continue;
    for (const net of netInfo) {
      const isIPv4 = net.family === 'IPv4' || (net.family as unknown) === 4;
      if (!isIPv4 || net.internal) continue;
      if (!isUsableLanAddr(net.address)) continue;
      found.push({ iface: name, address: net.address });
    }
  }
  found.sort((a, b) => {
    const byScore = lanAddrScore(b.address) - lanAddrScore(a.address);
    if (byScore !== 0) return byScore;
    const physicalA = /^en\d/i.test(a.iface) ? 0 : 1;
    const physicalB = /^en\d/i.test(b.iface) ? 0 : 1;
    return physicalA - physicalB;
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of found) {
    if (!seen.has(c.address)) {
      seen.add(c.address);
      out.push(c.address);
    }
  }
  return out;
};

const getLanIP = (): string | null => getLanIPCandidates()[0] ?? null;

/** Tailscale assigns each node an address in 100.64.0.0/10 (CGNAT). */
const isTailscaleAddr = (addr: string): boolean => {
  const m = /^100\.(\d+)\./.exec(addr);
  return !!(m && Number(m[1]) >= 64 && Number(m[1]) <= 127);
};

/** Clash/mihomo TUN mode hijacks traffic via the 198.18.0.0/15 benchmark range. */
const isClashTunAddr = (addr: string): boolean => /^198\.1[89]\./.test(addr);

const TAILSCALE_LOOKUP_CACHE_MS = 5000;
let tailscaleLookupCache: { ip: string | null; expiresAt: number } | null = null;

/**
 * This host's Tailscale node IP (100.64/10), if it is on the tailnet. When the
 * WebUI is bound to 0.0.0.0 this address is reachable from ANY tailnet device —
 * "from anywhere" — so we surface it as the PRIMARY remote-access URL.
 *
 * Detection strategy:
 * 1. Scan os.networkInterfaces() for a 100.64/10 address (kernel TUN mode).
 * 2. Fall back to `tailscale status --json` (userspace-networking mode, no TUN).
 */
const getTailscaleIP = (): string | null => {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netInfo = nets[name];
    if (!netInfo) continue;
    for (const net of netInfo) {
      const isIPv4 = net.family === 'IPv4' || (net.family as unknown) === 4;
      if (isIPv4 && !net.internal && isTailscaleAddr(net.address)) return net.address;
    }
  }
  if (tailscaleLookupCache && tailscaleLookupCache.expiresAt > Date.now()) return tailscaleLookupCache.ip;
  // Fallback: userspace-networking mode — no TUN interface, parse tailscale CLI.
  try {
    const { execSync } = require('node:child_process');
    const home = require('node:os').homedir();
    const sock = `${home}/.local/share/tailscale/tailscaled.sock`;
    const cmd = `/home/user/.local/bin/tailscale --socket=${sock} status --json`;
    console.log('[WebUI] Querying Tailscale IP via:', cmd);
    const out = execSync(cmd, {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const status = JSON.parse(out.toString()) as {
      Self?: { TailscaleIPs?: string[] };
    };
    const ips = status.Self?.TailscaleIPs;
    console.log('[WebUI] Tailscale status JSON parsed, Self.TailscaleIPs:', ips);
    if (ips && ips.length > 0) {
      for (const ip of ips) {
        if (isTailscaleAddr(ip)) {
          console.log('[WebUI] Found Tailscale IP:', ip);
          tailscaleLookupCache = { ip, expiresAt: Date.now() + TAILSCALE_LOOKUP_CACHE_MS };
          return ip;
        }
      }
    }
    console.log('[WebUI] No Tailscale IP found in status output');
  } catch (e) {
    console.error('[WebUI] Tailscale CLI query failed:', e);
    // tailscale CLI not available or not logged in — no Tailscale IP.
  }
  tailscaleLookupCache = { ip: null, expiresAt: Date.now() + TAILSCALE_LOOKUP_CACHE_MS };
  return null;
};

/**
 * Detect a TUN proxy that HIJACKS LAN traffic (Clash/mihomo on 198.18.x). When
 * present, LAN clients that also run such a proxy have requests to this server
 * swallowed by the tunnel unless they bypass the LAN — the #1 cause of "the LAN
 * address won't open". Tailscale (100.64/10) is deliberately NOT flagged: it does
 * not hijack the LAN and is in fact our preferred remote path.
 */
const detectProxyInterference = (): { detected: boolean; interfaces: string[] } => {
  const nets = networkInterfaces();
  const hits: string[] = [];
  for (const name of Object.keys(nets)) {
    const netInfo = nets[name];
    if (!netInfo) continue;
    for (const net of netInfo) {
      const isIPv4 = net.family === 'IPv4' || (net.family as unknown) === 4;
      if (!isIPv4 || net.internal) continue;
      if (isClashTunAddr(net.address)) hits.push(`${name} (${net.address})`);
    }
  }
  return { detected: hits.length > 0, interfaces: hits };
};

const toDesktopHandle = (handle: WebHostHandle, allowRemote: boolean): DesktopWebUIHandle => {
  const tsIP = getTailscaleIP();
  const tsAccessUrl = allowRemote && tsIP ? `http://${tsIP}:${handle.port}` : null;
  const lanUrl = allowRemote && handle.lanIP ? `http://${handle.lanIP}:${handle.port}` : null;
  return {
    port: handle.port,
    allowRemote,
    localUrl: handle.localUrl,
    networkUrl: handle.networkUrl,
    lanIP: handle.lanIP,
    initialPassword: currentInitialPassword,
    tailscale: { detected: tsIP !== null, ip: tsIP, accessUrl: tsAccessUrl },
    primaryAccessUrl: tsAccessUrl ?? lanUrl,
  };
};

const activeBackendPort = (): number | undefined =>
  (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;

const probeHttpOk = async (url: string, timeoutMs = 1500): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

type WebUIHealDecision = {
  needed: boolean;
  reason?: 'listener_unreachable' | 'backend_port_changed' | 'lan_ip_changed';
};

async function getWebUIHealDecision(): Promise<WebUIHealDecision> {
  if (!currentHandle) return { needed: false };

  const backendPort = activeBackendPort();
  if (backendPort && backendPort !== currentHandle.backendPort) {
    return { needed: true, reason: 'backend_port_changed' };
  }

  if (currentHandle.allowRemote) {
    const currentLanIP = getLanIP();
    if (currentLanIP && currentLanIP !== currentHandle.lanIP) {
      return { needed: true, reason: 'lan_ip_changed' };
    }
  }

  const listenerOk = await probeHttpOk(`${currentHandle.localUrl}/api/webui-host/health`);
  if (!listenerOk) return { needed: true, reason: 'listener_unreachable' };

  return { needed: false };
}

/**
 * Restart the active desktop WebUI only when it is already supposed to be
 * running and a concrete reachability check says the current handle is stale.
 */
export async function healDesktopWebUIIfNeeded(): Promise<DesktopWebUIHandle | null> {
  if (!currentHandle || !currentRuntimeOptions) return null;

  const decision = await getWebUIHealDecision();
  if (!decision.needed) return null;

  const opts = currentRuntimeOptions;
  console.warn('[WebUI] Self-healing desktop WebUI by restarting stale handle', {
    reason: decision.reason,
    port: opts.port,
    allowRemote: opts.allowRemote,
  });
  const initialPassword = currentInitialPassword;
  const handle = await startDesktopWebUI(opts);
  currentInitialPassword = initialPassword;
  return { ...handle, initialPassword };
}

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

  // Remote access is available in all editions (decision included — single-user but
  // the owner reaches their own AI over the LAN and/or Tailscale). Binding 0.0.0.0
  // exposes it on the LAN AND on the Tailscale 100.x interface; the auth gate is on
  // whenever allowRemote is true (static-server `requireAuth = allowRemote`).
  const allowRemote = REMOTE_ACCESS_ENABLED && opts.allowRemote === true;
  const preferredPort = parsePortValue(opts.port) ?? DEFAULT_WEBUI_PORT;
  const sysDir = getSystemDir();
  const knowledgeProxy = await resolveKnowledgeProxyConfig();

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
    rendererDevUrl: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
    // Team server only: 403 the aioncore team/meeting API at the WebUI proxy so LAN
    // employees can't run 智囊团 (decision meetings) by hitting /api/teams* directly,
    // even though the bundled backend still exposes it. No-op on full + Decision (both keep 智囊团).
    blockTeamRoutes: IS_TEAM,
    // Native client installers bundled with the server, served at /api/downloads/*.
    installerDir: resolveInstallerDir(),
    // Enterprise LAN shared library, served at /api/shared-drive/*.
    sharedDriveDir: path.join(getDataPath(), 'sharedDrive'),
    contentAssetsDir: path.join(getDataPath(), 'contentAssets'),
    // Enterprise LAN network drive (the company's large shared disk), browsed
    // read-only at /api/nas/*. Undefined when unconfigured → endpoints disabled.
    nasRootDir: await resolveNasRootDir(),
    knowledgeEndpoint: knowledgeProxy.endpoint,
    knowledgeToken: knowledgeProxy.token,
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
  currentRuntimeOptions = { port: preferredPort, allowRemote };
  return toDesktopHandle(handle, allowRemote);
}

/**
 * Stop the currently running WebUI instance, if any. No-op when nothing is running.
 */
export async function stopDesktopWebUI(): Promise<void> {
  const handle = currentHandle;
  if (!handle) return;
  currentHandle = null;
  currentRuntimeOptions = null;
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

/** Compute tailscale info from the running handle (or live query). */
const computeTailscaleInfo = (
  allowRemote: boolean,
  port: number
): { detected: boolean; ip: string | null; accessUrl: string | null } => {
  const tsIP = getTailscaleIP();
  const tsAccessUrl = allowRemote && tsIP ? `http://${tsIP}:${port}` : null;
  return { detected: tsIP !== null, ip: tsIP, accessUrl: tsAccessUrl };
};

/** Compute the primary access URL: Tailscale first if available, else LAN. */
const computePrimaryAccessUrl = (handle: { allowRemote: boolean; port: number; lanIP?: string }): string | null => {
  const tsIP = getTailscaleIP();
  if (handle.allowRemote && tsIP) return `http://${tsIP}:${handle.port}`;
  if (handle.allowRemote && handle.lanIP) return `http://${handle.lanIP}:${handle.port}`;
  return null;
};

export function getDesktopWebUIStatus(): {
  running: boolean;
  port: number;
  allowRemote: boolean;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  initialPassword?: string;
  tailscale: { detected: boolean; ip: string | null; accessUrl: string | null };
  primaryAccessUrl: string | null;
} {
  if (!currentHandle) {
    const lanIP = getLanIP();
    const tsIP = getTailscaleIP();
    return {
      running: false,
      port: DEFAULT_WEBUI_PORT,
      allowRemote: false,
      localUrl: `http://localhost:${DEFAULT_WEBUI_PORT}`,
      lanIP: lanIP ?? undefined,
      tailscale: { detected: tsIP !== null, ip: tsIP, accessUrl: null },
      primaryAccessUrl: null,
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
    tailscale: computeTailscaleInfo(currentHandle.allowRemote, currentHandle.port),
    primaryAccessUrl: computePrimaryAccessUrl(currentHandle),
  };
}

/**
 * Read-only health of the running WebUI's SPA entry document (out/renderer/
 * index.html), surfaced in the remote-access settings panel so the admin can
 * see whether LAN access is serving a real page, was auto-healed, or needs a
 * rebuild. Returns null when no WebUI is running.
 */
export async function getDesktopWebUIEntryHealth(): Promise<EntryHealth | null> {
  if (!currentHandle) return null;
  try {
    return await currentHandle.inspectEntry();
  } catch (error) {
    console.error('[WebUI] entry-health inspect failed:', error);
    return null;
  }
}

/**
 * User-triggered "repair connection": force a check + heal of the entry
 * document and return the resulting health. Returns null when no WebUI runs.
 */
/** Live network reachability picture for the remote-access settings panel. */
export type RemoteAccessConnectivity = {
  running: boolean;
  allowRemote: boolean;
  /** Address the server socket is bound to: '0.0.0.0' = LAN, '127.0.0.1' = loopback only. */
  boundHost: string;
  port: number;
  lanIP: string | null;
  lanIPCandidates: string[];
  /** URL to hand to LAN clients (null when not LAN-exposed or no LAN IP). */
  accessUrl: string | null;
  /** Tailscale node — reachable "from anywhere" on the tailnet; preferred. */
  tailscale: { detected: boolean; ip: string | null; accessUrl: string | null };
  /** The URL to recommend FIRST: Tailscale if present (works anywhere), else LAN. */
  primaryAccessUrl: string | null;
  /** Whether web-host can currently reach the aioncore backend. */
  backendReachable: boolean;
  proxy: { detected: boolean; interfaces: string[] };
};

/** Probe the local aioncore HTTP port. A 401 still proves the backend is up. */
const probeBackendReachable = async (port: number): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/status`, { signal: controller.signal });
    return res.ok || res.status === 401;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Gather an actionable connectivity snapshot for "repair connection". Unlike the
 * entry-HTML self-heal, this answers the question users actually have when a LAN
 * address won't open: is it LAN-exposed, what is the correct URL, is the backend
 * up, and is a local TUN proxy likely hijacking client traffic?
 */
export async function getRemoteAccessConnectivity(): Promise<RemoteAccessConnectivity> {
  const candidates = getLanIPCandidates();
  const lanIP = candidates[0] ?? null;
  const running = currentHandle !== null;
  const allowRemote = currentHandle?.allowRemote ?? false;
  const port = currentHandle?.port ?? DEFAULT_WEBUI_PORT;
  const boundHost = allowRemote ? '0.0.0.0' : '127.0.0.1';
  const accessUrl = allowRemote && lanIP ? `http://${lanIP}:${port}` : null;
  const tsIP = getTailscaleIP();
  // Bound to 0.0.0.0 → the Tailscale interface is served too, so the 100.x node IP
  // is reachable from any tailnet device.
  const tsAccessUrl = allowRemote && tsIP ? `http://${tsIP}:${port}` : null;
  // Priority: Tailscale first (works from anywhere), then LAN (on-LAN only).
  const primaryAccessUrl = tsAccessUrl ?? accessUrl;
  const backendPort = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  const backendReachable = typeof backendPort === 'number' ? await probeBackendReachable(backendPort) : false;
  return {
    running,
    allowRemote,
    boundHost,
    port,
    lanIP,
    lanIPCandidates: candidates,
    accessUrl,
    tailscale: { detected: tsIP !== null, ip: tsIP, accessUrl: tsAccessUrl },
    primaryAccessUrl,
    backendReachable,
    proxy: detectProxyInterference(),
  };
}

/** Result of a user-triggered "repair connection": entry-HTML heal + diagnostics. */
export type WebUIRepairResult = {
  entryHealth: EntryHealth | null;
  connectivity: RemoteAccessConnectivity;
};

export async function repairDesktopWebUIEntry(): Promise<WebUIRepairResult> {
  await healDesktopWebUIIfNeeded();
  const connectivity = await getRemoteAccessConnectivity();
  let entryHealth: EntryHealth | null = null;
  if (currentHandle) {
    try {
      entryHealth = await currentHandle.repairEntry();
    } catch (error) {
      console.error('[WebUI] entry repair failed:', error);
    }
  }
  return { entryHealth, connectivity };
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
