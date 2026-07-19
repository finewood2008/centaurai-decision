/**
 * knowledgeApi — shared desktop/WebUI access to the local vector DB.
 *
 * Desktop runs co-located with the vector DB and reaches it directly. A WebUI
 * browser client cannot (the DB binds loopback on the server host), so it goes
 * through the WebUI server's proxy routes, which forward to the configured
 * endpoint. Mirrors the search recipe in pages/guid/hooks/useGuidSend.ts.
 */
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { getBaseUrl, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { blobToDataUrl } from '../components/view/imageThumb';

export type KnowledgeDoc = {
  id: string;
  name: string;
  path: string;
  fileType: string;
  size: number;
  mtime: number;
  chunkCount: number;
  status: KnowledgeDocumentStatus;
  indexed: boolean;
  onDisk: boolean;
  job?: KnowledgeJob;
};

export type KnowledgeDocumentStatus = 'indexed' | 'queued' | 'processing' | 'failed' | 'unindexed' | 'missing';

export type KnowledgeJob = {
  state: 'queued' | 'processing' | 'done' | 'failed' | 'unknown';
  error?: string;
};

export type KnowledgeUploadResponse = {
  success?: boolean;
  queued?: boolean;
  doc_id?: string;
  file_name?: string;
  detail?: string;
};

export type KnowledgeTrashEntry = {
  id: string;
  original_path: string;
  trash_path: string;
  file_name: string;
  size: number;
  deleted_at: string;
};

export const KNOWLEDGE_FILE_ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.xlsm,.xls,.md,.txt,.jpg,.jpeg,.png,.bmp,.gif,.webp,.mp4,.mov,.mkv,.webm,.avi,.m4v,.m4a,.mp3,.wav,.aac,.ogg,.opus,.flac';

export function vectorEndpoint(): string {
  return (configService.get('vectorDB.endpoint') ?? 'http://127.0.0.1:8618').replace(/\/+$/, '');
}

/** True only for the Electron renderer attached to its own local backend. */
export function isKnowledgeAdmin(): boolean {
  return isElectronDesktop() && !isRemoteClientBridgeMode();
}

type RawDoc = {
  id: string;
  chunk_count?: number;
  metadata?: Record<string, unknown>;
  status?: KnowledgeDocumentStatus;
  indexed?: boolean;
  on_disk?: boolean;
  job?: KnowledgeJob | null;
};

/** The vector worker prefixes uploaded files with 8 random hex characters. */
export function displayKnowledgeName(name: string): string {
  return name.replace(/^[a-f\d]{8}_/i, '');
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function normalize(raw: RawDoc): KnowledgeDoc {
  const m = raw.metadata ?? {};
  const rawName = String(m.file_name ?? raw.id.split(/[\\/]/).pop() ?? raw.id);
  return {
    id: raw.id,
    name: displayKnowledgeName(rawName),
    path: String(m.source_path ?? m.file_path ?? raw.id),
    fileType: String(m.file_type ?? ''),
    size: num(m.file_size),
    mtime: Math.floor(num(m.modified_time)),
    chunkCount: num(raw.chunk_count ?? m.chunk_count),
    status: raw.status ?? (raw.indexed === false ? 'unindexed' : 'indexed'),
    indexed: raw.indexed !== false,
    onDisk: raw.on_disk !== false,
    job: raw.job ?? undefined,
  };
}

export async function fetchKnowledgeDocs(limit = 300, offset = 0): Promise<{ total: number; docs: KnowledgeDoc[] }> {
  const endpoint = vectorEndpoint();
  const resp = isKnowledgeAdmin()
    ? await fetch(`${endpoint}/api/documents?limit=${limit}&offset=${offset}`)
    : await fetch(`${getBaseUrl()}/api/vector-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit, offset }),
      });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const items: RawDoc[] = Array.isArray(data.items) ? data.items : [];
  return { total: num(data.total) || items.length, docs: items.map(normalize) };
}

type KnowledgePageFetcher = (limit: number, offset: number) => Promise<{ total: number; docs: KnowledgeDoc[] }>;

/** Collect every page without relying on a fixed knowledge-base size. */
export async function collectKnowledgeDocs(
  fetchPage: KnowledgePageFetcher,
  pageSize = 500
): Promise<{ total: number; docs: KnowledgeDoc[] }> {
  const docs: KnowledgeDoc[] = [];
  let total = 0;

  /* eslint-disable no-await-in-loop -- each offset depends on the preceding page size */
  do {
    const page = await fetchPage(pageSize, docs.length);
    total = page.total;
    docs.push(...page.docs);
    if (page.docs.length === 0) break;
  } while (docs.length < total);
  /* eslint-enable no-await-in-loop */

  return { total, docs };
}

/** Load every document page so counts, search, and all view modes cover the full knowledge base. */
export function fetchAllKnowledgeDocs(pageSize = 500): Promise<{ total: number; docs: KnowledgeDoc[] }> {
  return collectKnowledgeDocs(fetchKnowledgeDocs, pageSize);
}

function imageUrl(path: string): string {
  const endpoint = vectorEndpoint();
  return isKnowledgeAdmin()
    ? `${endpoint}/api/image?path=${encodeURIComponent(path)}`
    : `${getBaseUrl()}/api/vector-image?path=${encodeURIComponent(path)}`;
}

/**
 * Resolve a knowledge-base image to a `data:` URL — the same format the rest of
 * the hub uses for thumbnails, which avoids any img-src / blob: / cross-origin
 * surprises. Desktop reads the local file directly (the doc path is local to the
 * DB host); WebUI fetches through the server proxy and inlines the bytes.
 */
export async function loadKnowledgeImage(path: string): Promise<string | null> {
  try {
    if (isKnowledgeAdmin()) {
      return await ipcBridge.fs.getImageBase64.invoke({ path });
    }
    const resp = await fetch(imageUrl(path));
    if (!resp.ok) return null;
    return await blobToDataUrl(await resp.blob());
  } catch {
    return null;
  }
}

function knowledgeRoute(directPath: string, proxyPath: string): string {
  return isKnowledgeAdmin() ? `${vectorEndpoint()}${directPath}` : `${getBaseUrl()}${proxyPath}`;
}

function requestedByHeaders(json = false): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(isKnowledgeAdmin() ? { 'X-Requested-By': 'centaur-vdb' } : {}),
  };
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { error?: string; detail?: string };
    return body.detail || body.error || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

/** Upload one source file with progress without buffering it in renderer memory. */
export function uploadKnowledgeFile(
  file: File,
  onProgress: (percent: number) => void
): Promise<KnowledgeUploadResponse> {
  const url = knowledgeRoute('/api/upload', '/api/vector-upload');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = !isKnowledgeAdmin();
    if (isKnowledgeAdmin()) xhr.setRequestHeader('X-Requested-By', 'centaur-vdb');
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 90));
    });
    xhr.addEventListener('error', () => reject(new Error('VECTOR_DB_UNREACHABLE')));
    xhr.addEventListener('abort', () => reject(new Error('UPLOAD_ABORTED')));
    xhr.addEventListener('load', () => {
      let body: KnowledgeUploadResponse & { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText || '{}') as KnowledgeUploadResponse & { error?: string };
      } catch {
        // Preserve the HTTP fallback below for non-JSON worker failures.
      }
      if (xhr.status < 200 || xhr.status >= 300 || body.success === false) {
        reject(new Error(body.detail || body.error || xhr.responseText || `HTTP ${xhr.status}`));
        return;
      }
      onProgress(body.queued ? 95 : 100);
      resolve(body);
    });
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

export async function fetchKnowledgeJob(docId: string): Promise<KnowledgeJob> {
  const url = knowledgeRoute(
    `/api/jobs/${encodeURIComponent(docId)}`,
    `/api/vector-jobs?doc_id=${encodeURIComponent(docId)}`
  );
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(await errorMessage(response));
  return (await response.json()) as KnowledgeJob;
}

export async function waitForKnowledgeJob(
  docId: string,
  options: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<void> {
  const intervalMs = Math.max(0, options.intervalMs ?? 2_000);
  const deadline = Date.now() + Math.max(1, options.timeoutMs ?? 30 * 60 * 1_000);
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  /* eslint-disable no-await-in-loop -- job state is sequential */
  while (Date.now() < deadline) {
    if (intervalMs) await sleep(intervalMs);
    const job = await fetchKnowledgeJob(docId);
    if (job.state === 'done') return;
    if (job.state === 'failed') throw new Error(job.error || 'KNOWLEDGE_INDEX_FAILED');
    if (job.state === 'unknown') throw new Error('KNOWLEDGE_INDEX_JOB_UNKNOWN');
  }
  /* eslint-enable no-await-in-loop */
  throw new Error('KNOWLEDGE_INDEX_TIMEOUT');
}

export async function reindexKnowledgeDoc(path: string): Promise<void> {
  const url = knowledgeRoute('/api/documents/reindex', '/api/vector-reindex');
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: requestedByHeaders(true),
    body: JSON.stringify({ source_paths: [path], force: true }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  await waitForKnowledgeJob(path);
}

export function knowledgeFileUrl(path: string, disposition: 'inline' | 'attachment'): string {
  const query = `path=${encodeURIComponent(path)}&disposition=${disposition}`;
  return knowledgeRoute(`/api/file?${query}`, `/api/vector-file?${query}`);
}

function requireDesktopAdmin(): void {
  if (!isKnowledgeAdmin()) throw new Error('DESKTOP_ADMIN_REQUIRED');
}

export async function recycleKnowledgeDoc(path: string): Promise<void> {
  requireDesktopAdmin();
  const response = await fetch(`${vectorEndpoint()}/api/documents/${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: requestedByHeaders(),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export async function fetchKnowledgeTrash(): Promise<KnowledgeTrashEntry[]> {
  requireDesktopAdmin();
  const response = await fetch(`${vectorEndpoint()}/api/trash?limit=500`);
  if (!response.ok) throw new Error(await errorMessage(response));
  const body = (await response.json()) as { items?: KnowledgeTrashEntry[] };
  return body.items ?? [];
}

export async function restoreKnowledgeTrash(trashId: string): Promise<void> {
  requireDesktopAdmin();
  const response = await fetch(`${vectorEndpoint()}/api/trash/${encodeURIComponent(trashId)}/restore`, {
    method: 'POST',
    headers: requestedByHeaders(),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}
