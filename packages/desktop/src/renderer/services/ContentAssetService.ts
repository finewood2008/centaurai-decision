/** Personal workspace transport shared by desktop and WebUI. */
import { ipcBridge } from '@/common';
import type { ContentAssetDTO, ContentAssetPathInput } from '@/common/adapter/ipcBridge';
import { getBaseUrl } from '@/common/adapter/httpBridge';

type Win = Window & { __backendPort?: number; __backendHost?: string };

function isBrowserMode(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as Win).__backendPort;
}

function backendHost(): string {
  return (typeof window !== 'undefined' && (window as Win).__backendHost) || '127.0.0.1';
}

function isAdminElectron(): boolean {
  if (isBrowserMode()) return false;
  const host = backendHost();
  return host === '127.0.0.1' || host === 'localhost';
}

async function resolveBase(): Promise<string> {
  if (isBrowserMode()) return '';
  if (!isAdminElectron()) return getBaseUrl();
  const status = await ipcBridge.webui.getStatus.invoke();
  if (!status.running || !status.localUrl) throw new Error('PERSONAL_WORKSPACE_UNAVAILABLE');
  return status.localUrl.replace(/\/$/, '');
}

async function responseData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { success?: boolean; data?: T; error?: string };
  if (!response.ok || body.success === false || body.data === undefined) {
    throw new Error(body.error || `HTTP_${response.status}`);
  }
  return body.data;
}

async function uploadFromPath(input: ContentAssetPathInput, status: 'draft' | 'saved'): Promise<ContentAssetDTO> {
  const base64 = await ipcBridge.fs.readFileBuffer.invoke({ path: input.sourcePath });
  if (!base64) throw new Error('FILE_NOT_READABLE');
  const binary = atob(base64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const query = new URLSearchParams({ name: input.name });
  if (input.kind) query.set('kind', input.kind);
  if (input.sourceConversationId) query.set('conversation_id', input.sourceConversationId);
  if (input.category) query.set('category', input.category);
  const endpoint = status === 'draft' ? 'draft-upload' : 'upload';
  const response = await fetch(`${await resolveBase()}/api/content-assets/${endpoint}?${query}`, {
    method: 'POST',
    credentials: 'include',
    body: new Blob([bytes]),
  });
  return responseData<ContentAssetDTO>(response);
}

export async function listContentAssets(): Promise<ContentAssetDTO[]> {
  if (isAdminElectron()) return ipcBridge.contentAssetsLocal.list.invoke();
  const response = await fetch(`${await resolveBase()}/api/content-assets/list`, { credentials: 'include' });
  return responseData<ContentAssetDTO[]>(response);
}

export function stageContentAsset(input: ContentAssetPathInput): Promise<ContentAssetDTO> {
  return isAdminElectron() ? ipcBridge.contentAssetsLocal.stageFromPath.invoke(input) : uploadFromPath(input, 'draft');
}

export function saveContentAsset(input: ContentAssetPathInput): Promise<ContentAssetDTO> {
  return isAdminElectron() ? ipcBridge.contentAssetsLocal.saveFromPath.invoke(input) : uploadFromPath(input, 'saved');
}

async function mutate<T>(endpoint: string, id: string, method = 'POST'): Promise<T> {
  const response = await fetch(`${await resolveBase()}/api/content-assets/${endpoint}?id=${encodeURIComponent(id)}`, {
    method,
    credentials: 'include',
  });
  return responseData<T>(response);
}

export function promoteContentAsset(id: string): Promise<ContentAssetDTO | null> {
  return isAdminElectron() ? ipcBridge.contentAssetsLocal.promoteDraft.invoke({ id }) : mutate('promote', id);
}

export function archiveContentAsset(id: string): Promise<ContentAssetDTO | null> {
  return isAdminElectron() ? ipcBridge.contentAssetsLocal.archive.invoke({ id }) : mutate('archive', id);
}

export function discardContentAssetDraft(id: string): Promise<boolean> {
  return isAdminElectron() ? ipcBridge.contentAssetsLocal.discardDraft.invoke({ id }) : mutate('discard', id, 'DELETE');
}

export async function contentAssetUrl(id: string, disposition: 'preview' | 'download'): Promise<string> {
  return `${await resolveBase()}/api/content-assets/${disposition}?id=${encodeURIComponent(id)}`;
}

const LEGACY_KEY = 'centaurai.content-assets.v1';
const MIGRATION_KEY = 'centaurai.content-assets.migrated.v2';

/** Best-effort import of the renderer-only v1 registry into managed storage. */
export async function migrateLegacyContentAssets(): Promise<void> {
  if (typeof localStorage === 'undefined' || localStorage.getItem(MIGRATION_KEY) === '1') return;
  let legacy: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]') as unknown;
    if (Array.isArray(parsed))
      legacy = parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  } catch {
    localStorage.setItem(MIGRATION_KEY, '1');
    return;
  }
  const existing = await listContentAssets().catch((): ContentAssetDTO[] => []);
  const known = new Set(existing.map((asset) => asset.sourceWorkspacePath.replace(/\\/g, '/')));
  const candidates = legacy.flatMap((item) => {
    const sourcePath = typeof item.storagePath === 'string' ? item.storagePath : '';
    if (!sourcePath || known.has(sourcePath.replace(/\\/g, '/'))) return [];
    const name = typeof item.title === 'string' && item.title ? item.title : sourcePath.split(/[\\/]/).pop() || 'asset';
    return [
      {
        sourcePath,
        name,
        sourceConversationId: typeof item.sourceConversationId === 'string' ? item.sourceConversationId : undefined,
      },
    ];
  });
  // Missing old files are intentionally skipped; migration is best effort.
  await Promise.allSettled(candidates.map((candidate) => saveContentAsset(candidate)));
  localStorage.setItem(MIGRATION_KEY, '1');
}
