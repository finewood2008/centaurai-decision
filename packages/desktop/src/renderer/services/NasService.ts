/**
 * NasService — client for the enterprise LAN network drive (read-only, P1).
 *
 * The network drive is the company's large shared disk, mounted by the admin
 * server and browsed by every LAN user. Unlike SharedDriveService (which has a
 * main-process IPC path for the admin), the network drive is served only over
 * the host's web-host static-server at /api/nas/*. Those routes are NOT served
 * by aioncore, so callers resolve their own base URL — identical to the base
 * resolution SharedDriveService uses.
 */
import { getBaseUrl } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';

type Win = Window & { __backendPort?: number; __backendHost?: string };

export type NasEntry = {
  name: string;
  /** Path relative to the drive root, POSIX-separated. */
  relPath: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
};

export type NasListing = {
  path: string;
  entries: NasEntry[];
};

/** Thrown when the network drive is unreachable (WebUI server not running). */
export const NAS_UNAVAILABLE = 'NAS_UNAVAILABLE';

function isBrowserMode(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as Win).__backendPort;
}

function backendHost(): string {
  return (typeof window !== 'undefined' && (window as Win).__backendHost) || '127.0.0.1';
}

/** Resolve the origin serving /api/nas/* (same logic as SharedDriveService). */
async function resolveBase(): Promise<string> {
  if (isBrowserMode()) return '';
  const host = backendHost();
  if (host !== '127.0.0.1' && host !== 'localhost') return getBaseUrl();
  const status = await ipcBridge.webui.getStatus.invoke();
  if (!status.running || !status.localUrl) throw new Error(NAS_UNAVAILABLE);
  return status.localUrl.replace(/\/$/, '');
}

export type NasListResult = { listing: NasListing; disabled: boolean };

export async function listNas(relPath = ''): Promise<NasListResult> {
  const base = await resolveBase();
  const q = relPath ? `?path=${encodeURIComponent(relPath)}` : '';
  const resp = await fetch(`${base}/api/nas/list${q}`);
  if (!resp.ok) throw new Error(`nas list failed: ${resp.status}`);
  const body = (await resp.json()) as { data?: NasListing; disabled?: boolean };
  return {
    listing: body.data ?? { path: relPath, entries: [] },
    disabled: body.disabled === true,
  };
}

export async function nasDownloadUrl(relPath: string): Promise<string> {
  const base = await resolveBase();
  return `${base}/api/nas/download?path=${encodeURIComponent(relPath)}`;
}

export async function nasPreviewUrl(relPath: string): Promise<string> {
  const base = await resolveBase();
  return `${base}/api/nas/preview?path=${encodeURIComponent(relPath)}`;
}

/** Open a file for viewing in a new tab (inline preview). */
export async function openNasFile(relPath: string): Promise<void> {
  window.open(await nasPreviewUrl(relPath), '_blank');
}

/** Trigger a browser download of a file. */
export async function downloadNasFile(relPath: string): Promise<void> {
  window.open(await nasDownloadUrl(relPath), '_blank');
}
