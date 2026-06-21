/**
 * Enterprise LAN shared library ("共享盘").
 *
 * One node (the admin server that hosts the WebUI) owns a shared directory.
 * Any user — admin Electron renderer, browser WebUI, or distributed Electron
 * client — can push a generated artifact to it with one click and everyone can
 * browse / download / preview it. Visibility is "everyone on the LAN"; the only
 * organizing dimension is a free-form category (a folder/tag).
 *
 * Like downloads.ts, these routes are served LOCALLY by static-server (NOT
 * proxied to aioncore) so they are reachable identically by:
 *   - the admin's own Electron renderer (127.0.0.1),
 *   - browser WebUI clients (same-origin),
 *   - distributed Electron clients (http://<serverIP>:<port>).
 *
 *   GET    /api/shared-drive/list?category=<slug>   → { data: SharedFile[] }
 *   GET    /api/shared-drive/categories             → { data: SharedCategory[] }
 *   POST   /api/shared-drive/upload?name=&category=&conversation_id=&uploader=&uploaderId=
 *                                                   (raw body = file bytes)
 *   GET    /api/shared-drive/download?id=<id>       → the file (attachment)
 *   GET    /api/shared-drive/preview?id=<id>        → the file (inline)
 *   DELETE /api/shared-drive/remove?id=<id>         → { ok: true }
 *
 * Storage layout under <sharedDriveDir>:
 *   manifest.json
 *   blobs/<categorySlug>/<id>__<sanitizedName>
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type SharedFile = {
  id: string;
  /** Original display name (may collide across uploaders — that is fine). */
  name: string;
  /** Path relative to the shared-drive dir, e.g. blobs/marketing/<id>__a.png. */
  relPath: string;
  /** Display category (free-form, may be empty). */
  category: string;
  size: number;
  mime: string;
  uploaderId?: string;
  uploaderName?: string;
  conversationId?: string;
  /** Epoch milliseconds. */
  createdAt: number;
};

export type SharedCategory = {
  /** Sanitized slug used in URLs / on disk; '' for uncategorized. */
  key: string;
  /** Display label (original category text, or empty). */
  label: string;
  count: number;
};

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512MB safety cap
const UNCATEGORIZED = '';
// Path separators, Windows-reserved characters and ASCII control characters.
const UNSAFE_NAME_CHARS = /[/\\:*?"<>|]/g;
const UNSAFE_SLUG_CHARS = /[/\\:*?"<>|\s.]+/g;

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
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  zip: 'application/zip',
};

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function mimeOf(name: string): string {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream';
}

/**
 * Strip path separators, reserved and control characters but keep the name
 * readable (spaces, dashes, unicode letters survive). Leading dots are dropped
 * so an upload can never create a hidden / dotfile entry.
 */
function sanitizeName(name: string): string {
  const base = path.basename(name).replace(UNSAFE_NAME_CHARS, '_').replace(/^\.+/, '').trim();
  return base || 'file';
}

/** Category → filesystem-safe slug (keeps unicode letters, collapses the rest). */
function slugifyCategory(category: string | null | undefined): string {
  if (!category) return UNCATEGORIZED;
  return category
    .replace(UNSAFE_SLUG_CHARS, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function manifestPath(dir: string): string {
  return path.join(dir, 'manifest.json');
}

async function readManifest(dir: string): Promise<SharedFile[]> {
  try {
    const raw = await fs.promises.readFile(manifestPath(dir), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SharedFile[]) : [];
  } catch {
    return [];
  }
}

/** Atomic write: tmp file + rename, so a crash never leaves a half-written manifest. */
async function writeManifest(dir: string, entries: SharedFile[]): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.manifest.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  await fs.promises.writeFile(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  await fs.promises.rename(tmp, manifestPath(dir));
}

// Per-directory write mutex: serialize manifest mutations (single process, so an
// in-memory promise chain is sufficient — no cross-process locking needed).
const writeChains = new Map<string, Promise<unknown>>();

function withManifestLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(dir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeChains.set(
    dir,
    next.catch(() => {})
  );
  return next;
}

/** Resolve an entry's blob path and verify it stays inside the shared dir. */
function resolveBlob(dir: string, entry: SharedFile): string | null {
  const root = path.resolve(dir);
  const full = path.resolve(root, entry.relPath);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

// ---------------------------------------------------------------------------
// Core operations — shared by the HTTP handlers (browser / distributed clients)
// and the main-process IPC bridge (admin desktop renderer, which talks to its
// own machine and must not depend on the WebUI server being running).
// ---------------------------------------------------------------------------

export type SharedAddInput = {
  name: string;
  category?: string;
  uploaderId?: string;
  uploaderName?: string;
  conversationId?: string;
};

export async function sharedList(dir: string, category?: string | null): Promise<SharedFile[]> {
  const entries = await readManifest(dir);
  const filtered = category != null ? entries.filter((e) => slugifyCategory(e.category) === category) : entries;
  return [...filtered].toSorted((a, b) => b.createdAt - a.createdAt);
}

export async function sharedCategories(dir: string): Promise<SharedCategory[]> {
  const entries = await readManifest(dir);
  const map = new Map<string, SharedCategory>();
  for (const e of entries) {
    const key = slugifyCategory(e.category);
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { key, label: e.category || '', count: 1 });
  }
  return [...map.values()].toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function sharedRemove(dir: string, id: string): Promise<boolean> {
  return withManifestLock(dir, async () => {
    const entries = await readManifest(dir);
    const entry = entries.find((e) => e.id === id);
    if (!entry) return false;
    const full = resolveBlob(dir, entry);
    if (full) await fs.promises.rm(full, { force: true }).catch(() => {});
    await writeManifest(
      dir,
      entries.filter((e) => e.id !== id)
    );
    return true;
  });
}

/** Resolve a shared entry to its on-disk blob (for local open / attach). */
export async function sharedBlobInfo(
  dir: string,
  id: string
): Promise<{ path: string; name: string; mime: string } | null> {
  const entry = (await readManifest(dir)).find((e) => e.id === id);
  if (!entry) return null;
  const full = resolveBlob(dir, entry);
  if (!full) return null;
  return { path: full, name: entry.name, mime: entry.mime };
}

/**
 * Add a file to the shared library by copying it from a local path. Used by the
 * admin desktop app, where the source artifact already lives on this machine —
 * no byte round-trip needed.
 */
export async function sharedAddFromPath(dir: string, sourcePath: string, input: SharedAddInput): Promise<SharedFile> {
  const name = sanitizeName(input.name);
  const category = input.category || '';
  const categorySlug = slugifyCategory(category) || 'uncategorized';
  const id = crypto.randomUUID();
  const storedName = `${id}__${name}`;
  const blobDir = path.join(dir, 'blobs', categorySlug);
  const relPath = path.join('blobs', categorySlug, storedName);
  const full = path.join(blobDir, storedName);
  await fs.promises.mkdir(blobDir, { recursive: true });
  await fs.promises.copyFile(sourcePath, full);
  const { size } = await fs.promises.stat(full);
  const entry: SharedFile = {
    id,
    name,
    relPath,
    category,
    size,
    mime: mimeOf(name),
    uploaderId: input.uploaderId,
    uploaderName: input.uploaderName,
    conversationId: input.conversationId,
    createdAt: Date.now(),
  };
  await withManifestLock(dir, async () => {
    const entries = await readManifest(dir);
    entries.push(entry);
    await writeManifest(dir, entries);
  });
  return entry;
}

/** GET /api/shared-drive/list?category=<slug> */
export async function handleSharedList(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined
): Promise<void> {
  if (!dir) {
    sendJson(res, 200, { success: true, data: [] });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  sendJson(res, 200, { success: true, data: await sharedList(dir, url.searchParams.get('category')) });
}

/** GET /api/shared-drive/categories */
export async function handleSharedCategories(res: ServerResponse, dir: string | undefined): Promise<void> {
  if (!dir) {
    sendJson(res, 200, { success: true, data: [] });
    return;
  }
  sendJson(res, 200, { success: true, data: await sharedCategories(dir) });
}

/**
 * POST /api/shared-drive/upload?name=&category=&conversation_id=&uploader=&uploaderId=
 * Body = raw file bytes. We never read a client-supplied server path (avoids a
 * traversal / arbitrary-read boundary); the client always streams the bytes.
 */
export async function handleSharedUpload(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined
): Promise<void> {
  if (!dir) {
    sendJson(res, 503, { success: false, error: 'SHARED_DRIVE_DISABLED' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const rawName = url.searchParams.get('name') || '';
  if (!rawName) {
    sendJson(res, 400, { success: false, error: 'MISSING_NAME' });
    return;
  }
  const name = sanitizeName(rawName);
  const category = url.searchParams.get('category') || '';
  const categorySlug = slugifyCategory(category) || 'uncategorized';
  const id = crypto.randomUUID();
  const storedName = `${id}__${name}`;
  const blobDir = path.join(dir, 'blobs', categorySlug);
  const relPath = path.join('blobs', categorySlug, storedName);
  const full = path.join(blobDir, storedName);

  await fs.promises.mkdir(blobDir, { recursive: true });

  // Stream the request body to disk with a size cap. Write manually (with
  // backpressure) rather than pipe()+a separate 'data' listener — mixing the
  // two stalls the request when this route is reached via the static-server's
  // TCP peek/splice layer.
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

  const entry: SharedFile = {
    id,
    name,
    relPath,
    category,
    size,
    mime: mimeOf(name),
    uploaderId: url.searchParams.get('uploaderId') || undefined,
    uploaderName: url.searchParams.get('uploader') || undefined,
    conversationId: url.searchParams.get('conversation_id') || undefined,
    createdAt: Date.now(),
  };

  await withManifestLock(dir, async () => {
    const entries = await readManifest(dir);
    entries.push(entry);
    await writeManifest(dir, entries);
  });

  sendJson(res, 200, { success: true, data: { id, url: `/api/shared-drive/download?id=${id}` } });
}

async function streamEntry(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined,
  disposition: 'attachment' | 'inline'
): Promise<void> {
  if (!dir) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('id') || '';
  if (!id) {
    sendJson(res, 400, { success: false, error: 'MISSING_ID' });
    return;
  }
  const entry = (await readManifest(dir)).find((e) => e.id === id);
  if (!entry) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  const full = resolveBlob(dir, entry);
  if (!full) {
    sendJson(res, 400, { success: false, error: 'INVALID_PATH' });
    return;
  }
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(full);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    sendJson(res, 404, { success: false, error: 'FILE_NOT_FOUND' });
    return;
  }
  res.writeHead(200, {
    'content-type': disposition === 'inline' ? entry.mime : 'application/octet-stream',
    'content-length': String(stat.size),
    'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
    'cache-control': 'no-store',
  });
  const stream = fs.createReadStream(full);
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { success: false, error: 'READ_ERROR' });
    else res.destroy();
  });
  stream.pipe(res);
}

/** GET /api/shared-drive/download?id=<id> */
export function handleSharedDownload(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined
): Promise<void> {
  return streamEntry(req, res, dir, 'attachment');
}

/** GET /api/shared-drive/preview?id=<id> */
export function handleSharedPreview(req: IncomingMessage, res: ServerResponse, dir: string | undefined): Promise<void> {
  return streamEntry(req, res, dir, 'inline');
}

/** DELETE /api/shared-drive/remove?id=<id> */
export async function handleSharedRemove(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string | undefined
): Promise<void> {
  if (!dir) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const id = url.searchParams.get('id') || '';
  if (!id) {
    sendJson(res, 400, { success: false, error: 'MISSING_ID' });
    return;
  }
  const result = await sharedRemove(dir, id);
  if (!result) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }
  sendJson(res, 200, { success: true });
}
