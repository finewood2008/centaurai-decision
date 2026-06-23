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
import { downloadFileFromPath } from '@/renderer/utils/file/download';

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

/**
 * Admin host: an Electron renderer whose backend is local → use main-process
 * IPC. This reads the drive directly and works even when the WebUI server is
 * off or LAN-exposed (where the desktop renderer holds no gate cookie and the
 * HTTP routes would 401). Browser / distributed clients use HTTP.
 */
function isAdminElectron(): boolean {
  if (isBrowserMode()) return false;
  const host = backendHost();
  return host === '127.0.0.1' || host === 'localhost';
}

/** Resolve the origin serving /api/nas/* (HTTP transport only). */
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
  if (isAdminElectron()) {
    const r = await ipcBridge.nasDriveLocal.list.invoke({ path: relPath });
    return { listing: { path: r.path, entries: r.entries }, disabled: r.disabled };
  }
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

/** Open a file for viewing (admin: system handler; web: new tab). */
export async function openNasFile(relPath: string): Promise<void> {
  if (isAdminElectron()) {
    const info = await ipcBridge.nasDriveLocal.fileInfo.invoke({ path: relPath });
    if (info) await ipcBridge.shell.openFile.invoke(info.path);
    return;
  }
  window.open(await nasPreviewUrl(relPath), '_blank');
}

/** Download a file (admin: native save from local path; web: browser download). */
export async function downloadNasFile(relPath: string): Promise<void> {
  if (isAdminElectron()) {
    const info = await ipcBridge.nasDriveLocal.fileInfo.invoke({ path: relPath });
    if (info) await downloadFileFromPath(info.path, info.name);
    return;
  }
  window.open(await nasDownloadUrl(relPath), '_blank');
}

// --- Mutations (P2). Admin → main-process IPC; browser/distributed → HTTP. ---

/** Create a sub-folder `name` under directory `parentRel`. */
export async function createNasFolder(parentRel: string, name: string): Promise<void> {
  if (isAdminElectron()) {
    const r = await ipcBridge.nasDriveLocal.mkdir.invoke({ path: parentRel, name });
    if (!r) throw new Error('MKDIR_FORBIDDEN');
    return;
  }
  const base = await resolveBase();
  const resp = await fetch(
    `${base}/api/nas/mkdir?path=${encodeURIComponent(parentRel)}&name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
    }
  );
  if (!resp.ok) throw new Error(`nas mkdir failed: ${resp.status}`);
}

/** Soft-delete a file/folder (moved to the recycle folder). */
export async function removeNasEntry(relPath: string): Promise<void> {
  if (isAdminElectron()) {
    await ipcBridge.nasDriveLocal.remove.invoke({ path: relPath });
    return;
  }
  const base = await resolveBase();
  const resp = await fetch(`${base}/api/nas/remove?path=${encodeURIComponent(relPath)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`nas remove failed: ${resp.status}`);
}

/** Rename/move `fromRel` to `toRel` (parent + name). */
export async function moveNasEntry(fromRel: string, toRel: string): Promise<void> {
  if (isAdminElectron()) {
    await ipcBridge.nasDriveLocal.move.invoke({ from: fromRel, to: toRel });
    return;
  }
  const base = await resolveBase();
  const resp = await fetch(`${base}/api/nas/move?from=${encodeURIComponent(fromRel)}&to=${encodeURIComponent(toRel)}`, {
    method: 'POST',
  });
  if (!resp.ok) throw new Error(`nas move failed: ${resp.status}`);
}

/** Upload OS/browser files into directory `parentRel`. */
export async function uploadNasFiles(parentRel: string, files: File[]): Promise<void> {
  for (const file of files) {
    const localPath = (file as File & { path?: string }).path;
    if (isAdminElectron() && localPath) {
      await ipcBridge.nasDriveLocal.uploadFromPath.invoke({ path: parentRel, sourcePath: localPath, name: file.name });
      continue;
    }
    const base = await resolveBase();
    const resp = await fetch(
      `${base}/api/nas/upload?path=${encodeURIComponent(parentRel)}&name=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      }
    );
    if (!resp.ok) throw new Error(`nas upload failed: ${resp.status}`);
  }
}
