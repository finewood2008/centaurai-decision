/**
 * SharedDriveService — client for the enterprise LAN shared library.
 *
 * Two transports, chosen by context:
 *   - Admin desktop renderer (Electron, loopback backend) → main-process IPC
 *     (ipcBridge.sharedDriveLocal.*). Reads/writes the local shared dir
 *     directly, so sharing works whether or not the WebUI server is running.
 *   - Browser WebUI / distributed client → HTTP routes on the host's
 *     web-host static-server, reached via resolveBase().
 *
 * The shared-drive routes are NOT served by aioncore, so HTTP callers must
 * resolve their own base URL (getBaseUrl() points at aioncore in Electron).
 */
import { ipcBridge } from '@/common';
import { getBaseUrl } from '@/common/adapter/httpBridge';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { uploadFileViaHttp } from '@/renderer/services/FileService';
import type { SharedFileEntry, SharedCategoryEntry } from '@/common/adapter/ipcBridge';

type Win = Window & { __backendPort?: number; __backendHost?: string };

function isBrowserMode(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as Win).__backendPort;
}

function backendHost(): string {
  return (typeof window !== 'undefined' && (window as Win).__backendHost) || '127.0.0.1';
}

/** Admin host: Electron renderer whose backend is local → use main-process IPC. */
function isAdminElectron(): boolean {
  if (isBrowserMode()) return false;
  const host = backendHost();
  return host === '127.0.0.1' || host === 'localhost';
}

/** Custom DnD mime carrying a shared item, set by SharedFileCard.onDragStart. */
export const SHARED_DND_MIME = 'application/x-centaur-shared';
/** Thrown when the shared library is unreachable (HTTP mode, WebUI not running). */
export const SHARED_DRIVE_UNAVAILABLE = 'SHARED_DRIVE_UNAVAILABLE';

/** Resolve the origin serving /api/shared-drive/* (HTTP transport only). */
export async function resolveBase(): Promise<string> {
  if (isBrowserMode()) return '';
  const host = backendHost();
  if (host !== '127.0.0.1' && host !== 'localhost') return getBaseUrl();
  const status = await ipcBridge.webui.getStatus.invoke();
  if (!status.running || !status.localUrl) throw new Error(SHARED_DRIVE_UNAVAILABLE);
  return status.localUrl.replace(/\/$/, '');
}

async function getJson<T>(pathAndQuery: string): Promise<T> {
  const base = await resolveBase();
  const resp = await fetch(`${base}${pathAndQuery}`);
  if (!resp.ok) throw new Error(`shared-drive ${pathAndQuery} failed: ${resp.status}`);
  const body = (await resp.json()) as { success?: boolean; data?: T };
  return (body.data ?? ([] as unknown)) as T;
}

export async function listShared(category?: string): Promise<SharedFileEntry[]> {
  if (isAdminElectron()) return ipcBridge.sharedDriveLocal.list.invoke({ category });
  const q = category != null ? `?category=${encodeURIComponent(category)}` : '';
  return getJson<SharedFileEntry[]>(`/api/shared-drive/list${q}`);
}

export async function listSharedCategories(): Promise<SharedCategoryEntry[]> {
  if (isAdminElectron()) return ipcBridge.sharedDriveLocal.listCategories.invoke();
  return getJson<SharedCategoryEntry[]>('/api/shared-drive/categories');
}

export async function removeShared(id: string): Promise<void> {
  if (isAdminElectron()) {
    await ipcBridge.sharedDriveLocal.remove.invoke({ id });
    return;
  }
  const base = await resolveBase();
  const resp = await fetch(`${base}/api/shared-drive/remove?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`shared-drive remove failed: ${resp.status}`);
}

/** HTTP download/preview URL — only meaningful in HTTP transport mode. */
export async function sharedDownloadUrl(id: string): Promise<string> {
  const base = await resolveBase();
  return `${base}/api/shared-drive/download?id=${encodeURIComponent(id)}`;
}
export async function sharedPreviewUrl(id: string): Promise<string> {
  const base = await resolveBase();
  return `${base}/api/shared-drive/preview?id=${encodeURIComponent(id)}`;
}

/** Open a shared item for viewing (admin: system handler; web: new tab). */
export async function openShared(id: string): Promise<void> {
  if (isAdminElectron()) {
    const info = await ipcBridge.sharedDriveLocal.blobInfo.invoke({ id });
    if (info) await ipcBridge.shell.openFile.invoke(info.path);
    return;
  }
  window.open(await sharedPreviewUrl(id), '_blank');
}

/** Download a shared item to the user's machine. */
export async function downloadShared(id: string, name: string): Promise<void> {
  if (isAdminElectron()) {
    const info = await ipcBridge.sharedDriveLocal.blobInfo.invoke({ id });
    if (info) await downloadFileFromPath(info.path, name);
    return;
  }
  window.open(await sharedDownloadUrl(id), '_blank');
}

export type ShareToTeamInput = {
  /** Absolute source path on the server (from the user-files listing). */
  path: string;
  name: string;
  category?: string;
  conversationId?: string;
  uploader?: string;
  uploaderId?: string;
};

/** Share a server-side artifact (by path) to the team. */
export async function shareToTeam(input: ShareToTeamInput): Promise<{ id: string }> {
  if (isAdminElectron()) {
    return ipcBridge.sharedDriveLocal.addFromPath.invoke({
      sourcePath: input.path,
      name: input.name,
      category: input.category,
      conversationId: input.conversationId,
      uploaderId: input.uploaderId,
      uploaderName: input.uploader,
    });
  }
  // HTTP transport: read the bytes, then stream them to the host.
  const base64 = await ipcBridge.fs.readFileBuffer.invoke({ path: input.path });
  if (base64 == null) throw new Error('READ_FAILED');
  return uploadBytes(base64ToBytes(base64), input.name, {
    category: input.category,
    conversationId: input.conversationId,
    uploader: input.uploader,
    uploaderId: input.uploaderId,
  });
}

/** Upload an in-browser/OS File into the shared library. */
export async function shareFileToTeam(file: File, category?: string, uploaderId?: string): Promise<{ id: string }> {
  const localPath = (file as File & { path?: string }).path;
  if (isAdminElectron() && localPath) {
    return ipcBridge.sharedDriveLocal.addFromPath.invoke({
      sourcePath: localPath,
      name: file.name,
      category,
      uploaderId,
    });
  }
  return uploadBytes(file, file.name, { category, uploaderId });
}

/** Fetch a shared item back as a File so it can be attached to a conversation. */
export async function fetchSharedAsFile(id: string, name: string): Promise<File> {
  if (isAdminElectron()) {
    const info = await ipcBridge.sharedDriveLocal.blobInfo.invoke({ id });
    if (!info) throw new Error('NOT_FOUND');
    const base64 = await ipcBridge.fs.readFileBuffer.invoke({ path: info.path });
    if (base64 == null) throw new Error('READ_FAILED');
    return new File([base64ToBytes(base64)], name, { type: info.mime });
  }
  const url = await sharedDownloadUrl(id);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`shared-drive fetch failed: ${resp.status}`);
  return new File([await resp.blob()], name, { type: (await resp.blob()).type });
}

/**
 * Resolve a shared item to a local file path usable by the composer / agent.
 *
 * We fetch the bytes and run them through the normal upload path so the stored
 * file keeps its original (clean) name — attaching the raw blob would surface
 * the internal "<uuid>__name" filename in the composer. Works in every context
 * (admin reads its local blob via IPC; browser/distributed download over HTTP).
 */
export async function sharedFileToLocalPath(entry: { id: string; name: string }): Promise<string> {
  const file = await fetchSharedAsFile(entry.id, entry.name);
  return uploadFileViaHttp(file, undefined, undefined, entry.name);
}

// --- HTTP upload helpers (browser / distributed transport) ---

type UploadMeta = { category?: string; conversationId?: string; uploader?: string; uploaderId?: string };

async function uploadBytes(body: BlobPart, name: string, meta: UploadMeta): Promise<{ id: string }> {
  const base = await resolveBase();
  const params = new URLSearchParams({ name });
  if (meta.category) params.set('category', meta.category);
  if (meta.conversationId) params.set('conversation_id', meta.conversationId);
  if (meta.uploader) params.set('uploader', meta.uploader);
  if (meta.uploaderId) params.set('uploaderId', meta.uploaderId);
  const resp = await fetch(`${base}/api/shared-drive/upload?${params.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: body instanceof Blob ? body : new Blob([body]),
  });
  if (!resp.ok) throw new Error(`shared-drive upload failed: ${resp.status}`);
  const json = (await resp.json()) as { success?: boolean; data?: { id: string } };
  if (!json.success || !json.data) throw new Error('UPLOAD_FAILED');
  return json.data;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
