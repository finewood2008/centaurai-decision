/**
 * Persistent AI generated asset registry.
 *
 * This is a managed manifest + blob store for generated artifacts. It is not a
 * second shared drive: all lifecycle operations remain within the app-managed
 * personal workspace.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeFileResponseHeaders, safeInlineContentType } from './safe-preview.js';
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type ContentAssetKind = 'image' | 'document' | 'code' | 'other';
export type ContentAssetVisibility = 'private' | 'team' | 'public';
export type ContentAssetStorageProvider = 'workspace' | 'personal_content' | 'nas' | 'shared_drive' | 'knowledge';
export type ContentAssetStatusFlag =
  | 'draft'
  | 'saved'
  | 'shared'
  | 'stored_in_nas'
  | 'indexed'
  | 'archived'
  | 'missing';

export type ContentAsset = {
  id: string;
  title: string;
  kind: ContentAssetKind;
  ownerUserId: string;
  teamId?: string;
  visibility: ContentAssetVisibility;
  sourceConversationId?: string;
  sourceWorkspacePath: string;
  storageProvider: ContentAssetStorageProvider;
  storagePath: string;
  tags: string[];
  category?: string;
  statusFlags: ContentAssetStatusFlag[];
  createdAt: number;
  updatedAt: number;
  size: number;
  sharedDriveId?: string;
  nasStoragePath?: string;
  draftProvenance?: 'registered-generated-artifact' | 'meeting-output' | 'uploaded-draft';
};

export type ContentAssetSaveInput = {
  sourcePath: string;
  name: string;
  ownerUserId: string;
  sourceConversationId?: string;
  category?: string;
  kind?: ContentAssetKind;
  tags?: string[];
  draftProvenance?: ContentAsset['draftProvenance'];
};

export type ContentAssetStageInput = ContentAssetSaveInput;

export type ContentAssetIndexOptions = {
  endpoint: string;
  token?: string;
  /** Poll cadence for asynchronous media indexing. Primarily overridden by tests. */
  pollIntervalMs?: number;
  /** Maximum time to wait for the vector worker to finish an asynchronous job. */
  pollTimeoutMs?: number;
};

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 100 * 1024 * 1024;
const MAX_NAS_SEGMENT_BYTES = 180;
const DEFAULT_INDEX_POLL_INTERVAL_MS = 1_000;
const DEFAULT_INDEX_POLL_TIMEOUT_MS = 30 * 60 * 1_000;
const MANIFEST_FILE = 'manifest.json';
const UNSAFE_NAME_CHARS = /[/\\:*?"<>|]/g;
const UNSAFE_SEGMENT_CHARS = /[/\\:*?"<>|]+/g;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function now(): number {
  return Date.now();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function rejectForgedOwner(url: URL, res: ServerResponse, ownerUserId: string): boolean {
  const requestedOwner = url.searchParams.get('owner')?.trim();
  if (!requestedOwner || requestedOwner === ownerUserId) return false;
  sendJson(res, 403, { success: false, error: 'FORBIDDEN' });
  return true;
}

function manifestPath(dir: string): string {
  return path.join(dir, MANIFEST_FILE);
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function mimeOf(name: string): string {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream';
}

function sanitizeName(name: string): string {
  const base = path.basename(name).replace(UNSAFE_NAME_CHARS, '_').replace(/^\.+/, '').trim();
  return base || 'asset';
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = '';
  let size = 0;
  for (const character of value) {
    const nextSize = size + Buffer.byteLength(character);
    if (nextSize > maxBytes) break;
    result += character;
    size = nextSize;
  }
  return result;
}

function safeSegment(value: string | undefined, fallback: string): string {
  const cleaned = (value || fallback).replace(UNSAFE_SEGMENT_CHARS, '_').replace(/^\.+/, '').trim();
  return truncateUtf8(cleaned || fallback, MAX_NAS_SEGMENT_BYTES) || fallback;
}

function safeKind(value: unknown, name: string): ContentAssetKind {
  if (value === 'image' || value === 'document' || value === 'code' || value === 'other') return value;
  const ext = extOf(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'md', 'txt'].includes(ext)) return 'document';
  if (['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'py', 'go', 'rs', 'java', 'sh'].includes(ext)) return 'code';
  return 'other';
}

function normalizeAsset(value: unknown): ContentAsset | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const title = typeof raw.title === 'string' ? raw.title : '';
  const ownerUserId = typeof raw.ownerUserId === 'string' ? raw.ownerUserId : '';
  const storagePath = typeof raw.storagePath === 'string' ? raw.storagePath : '';
  const sourceWorkspacePath = typeof raw.sourceWorkspacePath === 'string' ? raw.sourceWorkspacePath : storagePath;
  if (!id || !title || !ownerUserId || !storagePath) return null;
  const statusFlags: ContentAssetStatusFlag[] = Array.isArray(raw.statusFlags)
    ? raw.statusFlags.filter((flag): flag is ContentAssetStatusFlag =>
        ['draft', 'saved', 'shared', 'stored_in_nas', 'indexed', 'archived', 'missing'].includes(String(flag))
      )
    : ['saved'];
  return {
    id,
    title,
    kind: safeKind(raw.kind, title),
    ownerUserId,
    teamId: typeof raw.teamId === 'string' ? raw.teamId : undefined,
    visibility:
      raw.visibility === 'team' || raw.visibility === 'public' || raw.visibility === 'private'
        ? raw.visibility
        : 'private',
    sourceConversationId: typeof raw.sourceConversationId === 'string' ? raw.sourceConversationId : undefined,
    sourceWorkspacePath,
    storageProvider:
      raw.storageProvider === 'workspace' ||
      raw.storageProvider === 'personal_content' ||
      raw.storageProvider === 'shared_drive' ||
      raw.storageProvider === 'nas' ||
      raw.storageProvider === 'knowledge'
        ? raw.storageProvider
        : 'personal_content',
    storagePath,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    category: typeof raw.category === 'string' ? raw.category : undefined,
    statusFlags: statusFlags.length ? [...new Set<ContentAssetStatusFlag>(statusFlags)] : ['saved'],
    createdAt: Number(raw.createdAt) || now(),
    updatedAt: Number(raw.updatedAt) || now(),
    size: Math.max(0, Number(raw.size) || 0),
    sharedDriveId: typeof raw.sharedDriveId === 'string' ? raw.sharedDriveId : undefined,
    nasStoragePath: typeof raw.nasStoragePath === 'string' ? raw.nasStoragePath : undefined,
    draftProvenance:
      raw.draftProvenance === 'registered-generated-artifact' ||
      raw.draftProvenance === 'meeting-output' ||
      raw.draftProvenance === 'uploaded-draft'
        ? raw.draftProvenance
        : undefined,
  };
}

async function readManifest(dir: string): Promise<ContentAsset[]> {
  try {
    const raw = await fs.promises.readFile(manifestPath(dir), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.map(normalizeAsset).filter((asset): asset is ContentAsset => asset !== null)
      : [];
  } catch {
    return [];
  }
}

async function writeManifest(dir: string, assets: ContentAsset[]): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.manifest.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  await fs.promises.writeFile(tmp, JSON.stringify(assets, null, 2), 'utf-8');
  await fs.promises.rename(tmp, manifestPath(dir));
}

const writeChains = new Map<string, Promise<unknown>>();
const indexChains = new Map<string, Promise<ContentAsset | null>>();

type KnowledgeUploadResponse = {
  success?: boolean;
  queued?: boolean;
  doc_id?: string;
};

type KnowledgeJobResponse = {
  state?: string;
  error?: string;
};

function knowledgeHeaders(token?: string): Record<string, string> {
  return {
    'X-Requested-By': 'centaur-vdb',
    ...(token
      ? {
          authorization: `Bearer ${token}`,
          'x-centaurai-knowledge-token': token,
        }
      : {}),
  };
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const detail = await response.text().catch(() => '');
  return new Error(detail || fallback);
}

async function waitForKnowledgeJob(endpoint: string, docId: string, options: ContentAssetIndexOptions): Promise<void> {
  const interval = Math.max(0, options.pollIntervalMs ?? DEFAULT_INDEX_POLL_INTERVAL_MS);
  const timeout = Math.max(1, options.pollTimeoutMs ?? DEFAULT_INDEX_POLL_TIMEOUT_MS);
  const deadline = Date.now() + timeout;

  /* eslint-disable no-await-in-loop -- job states must be polled sequentially */
  while (Date.now() < deadline) {
    if (interval > 0) await new Promise((resolve) => setTimeout(resolve, interval));
    const response = await fetch(`${endpoint}/api/jobs/${encodeURIComponent(docId)}`, {
      headers: knowledgeHeaders(options.token),
    });
    if (!response.ok) throw await responseError(response, `KNOWLEDGE_INDEX_JOB_HTTP_${response.status}`);
    const job = (await response.json()) as KnowledgeJobResponse;
    if (job.state === 'done') return;
    if (job.state === 'failed') throw new Error(job.error || 'KNOWLEDGE_INDEX_FAILED');
    if (job.state === 'unknown') throw new Error('KNOWLEDGE_INDEX_JOB_UNKNOWN');
  }
  /* eslint-enable no-await-in-loop */

  throw new Error('KNOWLEDGE_INDEX_TIMEOUT');
}

function withManifestLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(dir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeChains.set(
    dir,
    next.catch(() => {})
  );
  return next;
}

async function upsertAsset(dir: string, asset: ContentAsset): Promise<ContentAsset> {
  return withManifestLock(dir, async () => {
    const assets = await readManifest(dir);
    const next = [asset, ...assets.filter((item) => item.id !== asset.id)].toSorted(
      (a, b) => b.updatedAt - a.updatedAt
    );
    await writeManifest(dir, next);
    return asset;
  });
}

function assetBlobPath(dir: string, ownerUserId: string, id: string, name: string): string {
  const safeOwner = safeSegment(ownerUserId, 'user');
  return path.join(dir, 'blobs', safeOwner, `${id}__${sanitizeName(name)}`);
}

function assetDraftPath(dir: string, ownerUserId: string, id: string, name: string): string {
  const safeOwner = safeSegment(ownerUserId, 'user');
  return path.join(dir, 'drafts', safeOwner, `${id}__${sanitizeName(name)}`);
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function relativeToDir(dir: string, fullPath: string): string {
  return path.relative(dir, fullPath).replace(/\\/g, '/');
}

function withLifecycle(asset: ContentAsset, status: 'draft' | 'saved' | 'archived', patch: Partial<ContentAsset> = {}) {
  const lifecycle = new Set<ContentAssetStatusFlag>(['draft', 'saved', 'archived']);
  return {
    ...asset,
    ...patch,
    statusFlags: [...asset.statusFlags.filter((flag) => !lifecycle.has(flag)), status],
    updatedAt: now(),
  };
}

export async function contentAssetsList(dir: string | undefined, ownerUserId?: string): Promise<ContentAsset[]> {
  if (!dir) return [];
  const assets = await readManifest(dir);
  const filtered = ownerUserId ? assets.filter((asset) => asset.ownerUserId === ownerUserId) : assets;
  return filtered.toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export async function contentAssetSaveFromPath(dir: string, input: ContentAssetSaveInput): Promise<ContentAsset> {
  const sourceStat = await fs.promises.stat(input.sourcePath);
  if (!sourceStat.isFile()) throw new Error('SOURCE_NOT_FILE');
  const name = sanitizeName(input.name);
  const id = crypto.randomUUID();
  const full = assetBlobPath(dir, input.ownerUserId, id, name);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.copyFile(input.sourcePath, full);
  const at = now();
  const asset: ContentAsset = {
    id,
    title: name,
    kind: safeKind(input.kind, name),
    ownerUserId: input.ownerUserId,
    visibility: 'private',
    sourceConversationId: input.sourceConversationId,
    sourceWorkspacePath: input.sourcePath,
    storageProvider: 'personal_content',
    storagePath: full,
    tags: input.tags ?? [],
    category: input.category,
    statusFlags: ['saved'],
    createdAt: at,
    updatedAt: at,
    size: sourceStat.size,
    draftProvenance: input.draftProvenance,
  };
  return upsertAsset(dir, asset);
}

export async function contentAssetStageFromPath(dir: string, input: ContentAssetStageInput): Promise<ContentAsset> {
  const source = await fs.promises.realpath(input.sourcePath);
  const sourceStat = await fs.promises.stat(source);
  if (!sourceStat.isFile()) throw new Error('SOURCE_NOT_FILE');
  const name = sanitizeName(input.name);
  const id = crypto.randomUUID();
  const full = assetDraftPath(dir, input.ownerUserId, id, name);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.copyFile(source, full);
  const at = now();
  return upsertAsset(dir, {
    id,
    title: name,
    kind: safeKind(input.kind, name),
    ownerUserId: input.ownerUserId,
    visibility: 'private',
    sourceConversationId: input.sourceConversationId,
    sourceWorkspacePath: source,
    storageProvider: 'personal_content',
    storagePath: full,
    tags: input.tags ?? [],
    category: input.category,
    statusFlags: ['draft'],
    createdAt: at,
    updatedAt: at,
    size: sourceStat.size,
    draftProvenance: input.draftProvenance ?? 'registered-generated-artifact',
  });
}

export async function contentAssetPromoteDraft(
  dir: string,
  id: string,
  ownerUserId: string
): Promise<ContentAsset | null> {
  return withManifestLock(dir, async () => {
    const assets = await readManifest(dir);
    const asset = assets.find((item) => item.id === id && item.ownerUserId === ownerUserId);
    if (!asset || !asset.statusFlags.includes('draft')) return null;
    const draftsRoot = path.join(dir, 'drafts', safeSegment(ownerUserId, 'user'));
    if (!isWithin(draftsRoot, asset.storagePath)) throw new Error('UNMANAGED_DRAFT');
    const full = assetBlobPath(dir, ownerUserId, asset.id, asset.title);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.copyFile(asset.storagePath, full);
    await fs.promises.rm(asset.storagePath, { force: true });
    const updated = withLifecycle(asset, 'saved', { storagePath: full });
    await writeManifest(dir, [updated, ...assets.filter((item) => item.id !== id)]);
    return updated;
  });
}

export async function contentAssetDiscardDraft(dir: string, id: string, ownerUserId: string): Promise<boolean> {
  return withManifestLock(dir, async () => {
    const assets = await readManifest(dir);
    const asset = assets.find((item) => item.id === id && item.ownerUserId === ownerUserId);
    if (!asset || !asset.statusFlags.includes('draft')) return false;
    const draftsRoot = path.join(dir, 'drafts', safeSegment(ownerUserId, 'user'));
    if (!isWithin(draftsRoot, asset.storagePath)) throw new Error('UNMANAGED_DRAFT');
    await fs.promises.rm(asset.storagePath, { force: true });
    await writeManifest(
      dir,
      assets.filter((item) => item.id !== id)
    );
    return true;
  });
}

export async function contentAssetArchive(dir: string, id: string, ownerUserId?: string): Promise<ContentAsset | null> {
  return withManifestLock(dir, async () => {
    const assets = await readManifest(dir);
    const asset = assets.find((item) => item.id === id && (!ownerUserId || item.ownerUserId === ownerUserId));
    if (!asset) return null;
    if (!asset.statusFlags.includes('saved')) return null;
    const updated = withLifecycle(asset, 'archived');
    await writeManifest(dir, [updated, ...assets.filter((item) => item.id !== id)]);
    return updated;
  });
}

/**
 * Copy a saved personal asset into the configured vector knowledge base and
 * remember the successful hand-off. The managed personal copy is retained so
 * a vector-index rebuild never destroys the user's source asset.
 */
export function contentAssetIndex(
  dir: string,
  id: string,
  ownerUserId: string,
  options: ContentAssetIndexOptions
): Promise<ContentAsset | null> {
  const key = `${dir}\n${ownerUserId}\n${id}`;
  const running = indexChains.get(key);
  if (running) return running;

  const task = (async () => {
    const asset = await findAsset(dir, id, ownerUserId);
    if (!asset || (!asset.statusFlags.includes('saved') && !asset.statusFlags.includes('archived'))) return null;
    if (asset.statusFlags.includes('indexed')) return asset;

    const endpoint = options.endpoint.trim().replace(/\/+$/, '');
    const parsed = new URL(endpoint);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('INVALID_KNOWLEDGE_ENDPOINT');

    const data = await fs.promises.readFile(asset.storagePath);
    const form = new FormData();
    form.append('file', new Blob([data]), asset.title);
    const response = await fetch(`${endpoint}/api/upload`, {
      method: 'POST',
      headers: knowledgeHeaders(options.token),
      body: form,
    });
    if (!response.ok) throw await responseError(response, `KNOWLEDGE_INDEX_HTTP_${response.status}`);
    const upload = (await response.json()) as KnowledgeUploadResponse;
    if (upload.success === false) throw new Error('KNOWLEDGE_INDEX_FAILED');
    if (upload.queued) {
      if (!upload.doc_id) throw new Error('KNOWLEDGE_INDEX_INVALID_RESPONSE');
      await waitForKnowledgeJob(endpoint, upload.doc_id, options);
    }

    return withManifestLock(dir, async () => {
      const assets = await readManifest(dir);
      const current = assets.find((item) => item.id === id && item.ownerUserId === ownerUserId);
      if (!current) return null;
      const updated: ContentAsset = {
        ...current,
        statusFlags: [
          ...current.statusFlags.filter(
            (flag) => flag !== 'archived' && flag !== 'draft' && flag !== 'saved' && flag !== 'indexed'
          ),
          'saved',
          'indexed',
        ],
        updatedAt: now(),
      };
      await writeManifest(dir, [updated, ...assets.filter((item) => item.id !== id)]);
      return updated;
    });
  })().finally(() => indexChains.delete(key));

  indexChains.set(key, task);
  return task;
}

async function findAsset(dir: string | undefined, id: string, ownerUserId: string): Promise<ContentAsset | null> {
  if (!dir) return null;
  return (await readManifest(dir)).find((asset) => asset.id === id && asset.ownerUserId === ownerUserId) ?? null;
}

async function streamAsset(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string,
  disposition: 'attachment' | 'inline'
): Promise<void> {
  if (!dir) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  if (rejectForgedOwner(url, res, ownerUserId)) return;
  const id = url.searchParams.get('id') || '';
  const asset = id ? await findAsset(dir, id, ownerUserId) : null;
  if (!asset) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(asset.storagePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    sendJson(res, 404, { success: false, error: 'FILE_NOT_FOUND' });
    return;
  }
  if (disposition === 'inline' && stat.size > MAX_PREVIEW_BYTES) {
    sendJson(res, 413, { success: false, error: 'PREVIEW_TOO_LARGE' });
    return;
  }
  res.writeHead(200, {
    'content-type': disposition === 'inline' ? safeInlineContentType(mimeOf(asset.title)) : 'application/octet-stream',
    'content-length': String(stat.size),
    'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.title)}`,
    'cache-control': 'no-store',
    ...safeFileResponseHeaders(disposition === 'inline'),
  });
  const stream = fs.createReadStream(asset.storagePath);
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { success: false, error: 'READ_ERROR' });
    else res.destroy();
  });
  stream.pipe(res);
}

export async function handleContentAssetsList(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost');
  if (rejectForgedOwner(url, res, ownerUserId)) return;

  const data = await contentAssetsList(dir, ownerUserId);
  sendJson(res, 200, { success: true, data });
}

export async function handleContentAssetUpload(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string,
  initialStatus: 'draft' | 'saved' = 'saved'
): Promise<void> {
  if (!dir) {
    sendJson(res, 503, { success: false, error: 'CONTENT_ASSETS_DISABLED' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  if (rejectForgedOwner(url, res, ownerUserId)) return;
  const rawName = url.searchParams.get('name') || '';
  if (!rawName) {
    sendJson(res, 400, { success: false, error: 'MISSING_METADATA' });
    return;
  }
  const name = sanitizeName(rawName);
  const id = crypto.randomUUID();
  const full =
    initialStatus === 'draft' ? assetDraftPath(dir, ownerUserId, id, name) : assetBlobPath(dir, ownerUserId, id, name);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  let size = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(full);
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        out.destroy();
        fs.promises.rm(full, { force: true }).finally(() => reject(err));
      };
      out.on('error', fail);
      req.on('error', fail);
      req.on('aborted', () => fail(new Error('ABORTED')));
      req.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) {
          fail(new Error('TOO_LARGE'));
          return;
        }
        if (!out.write(chunk)) {
          req.pause();
          out.once('drain', () => req.resume());
        }
      });
      req.on('end', () => {
        if (settled) return;
        out.end(() => {
          settled = true;
          resolve();
        });
      });
    });
  } catch (err) {
    await fs.promises.rm(full, { force: true }).catch(() => {});
    const tooLarge = err instanceof Error && err.message === 'TOO_LARGE';
    sendJson(res, tooLarge ? 413 : 500, { success: false, error: tooLarge ? 'TOO_LARGE' : 'WRITE_ERROR' });
    return;
  }

  const at = now();
  const asset: ContentAsset = {
    id,
    title: name,
    kind: safeKind(url.searchParams.get('kind'), name),
    ownerUserId,
    visibility: 'private',
    sourceConversationId: url.searchParams.get('conversation_id') || undefined,
    sourceWorkspacePath: full,
    storageProvider: 'personal_content',
    storagePath: full,
    tags: [],
    category: url.searchParams.get('category') || undefined,
    statusFlags: [initialStatus],
    createdAt: at,
    updatedAt: at,
    size,
    draftProvenance: initialStatus === 'draft' ? 'uploaded-draft' : undefined,
  };
  sendJson(res, 200, { success: true, data: await upsertAsset(dir, asset), relPath: relativeToDir(dir, full) });
}

export async function handleContentAssetArchive(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  if (!dir) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  if (rejectForgedOwner(url, res, ownerUserId)) return;
  const asset = await contentAssetArchive(dir, url.searchParams.get('id') || '', ownerUserId);
  if (!asset) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  sendJson(res, 200, { success: true, data: asset });
}

export async function handleContentAssetIndex(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string,
  options: ContentAssetIndexOptions
): Promise<void> {
  if (!dir) return sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
  const url = new URL(req.url || '/', 'http://localhost');
  if (rejectForgedOwner(url, res, ownerUserId)) return;
  try {
    const asset = await contentAssetIndex(dir, url.searchParams.get('id') || '', ownerUserId, options);
    if (!asset) return sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    sendJson(res, 200, { success: true, data: asset });
  } catch (error) {
    sendJson(res, 502, {
      success: false,
      error: error instanceof Error ? error.message : 'KNOWLEDGE_INDEX_FAILED',
    });
  }
}

export async function handleContentAssetPromoteDraft(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  if (!dir) return sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
  const url = new URL(req.url || '/', 'http://localhost');
  if (rejectForgedOwner(url, res, ownerUserId)) return;
  const id = url.searchParams.get('id') || '';
  const asset = await contentAssetPromoteDraft(dir, id, ownerUserId);
  if (!asset) return sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
  sendJson(res, 200, { success: true, data: asset });
}

export async function handleContentAssetDiscardDraft(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  if (!dir) return sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
  const url = new URL(req.url || '/', 'http://localhost');
  if (rejectForgedOwner(url, res, ownerUserId)) return;
  const id = url.searchParams.get('id') || '';
  const discarded = await contentAssetDiscardDraft(dir, id, ownerUserId);
  if (!discarded) return sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
  sendJson(res, 200, { success: true, data: true });
}

export function handleContentAssetDownload(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  return streamAsset(req, res, dir, ownerUserId, 'attachment');
}

export function handleContentAssetPreview(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  ownerUserId: string
): Promise<void> {
  return streamAsset(req, res, dir, ownerUserId, 'inline');
}
