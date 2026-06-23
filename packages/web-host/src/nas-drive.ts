/**
 * Enterprise LAN network drive ("共享盘 · 文件") — READ-ONLY (P1).
 *
 * Unlike the artifact board in shared-drive.ts (a managed blob store keyed by a
 * manifest), this surface maps 1:1 onto a real directory tree on the server —
 * the admin points `nasRootDir` at the company's large shared disk (e.g. a 2TB
 * mount) and every LAN user can browse / download / preview it. No manifest, no
 * id indirection: scales to tens of thousands of files because listing is just
 * `readdir` of a sub-path.
 *
 * Like shared-drive.ts and downloads.ts these routes are served LOCALLY by
 * static-server (NOT proxied to aioncore) so they are reachable identically by
 * the admin Electron renderer, browser WebUI, and distributed Electron clients.
 *
 *   GET /api/nas/list?path=<relPath>      → { data: { path, entries: NasEntry[] } }
 *   GET /api/nas/download?path=<relPath>  → the file (attachment, Range-capable)
 *   GET /api/nas/preview?path=<relPath>   → the file (inline, Range-capable)
 *
 * Visibility is "everyone on the LAN" (no per-user access control — by product
 * decision). The one non-negotiable boundary is PATH CONTAINMENT: every request
 * path is resolved and rejected unless it stays inside `nasRootDir`, so `..`
 * can never escape to the rest of the server's filesystem. Writes are out of
 * scope for P1 — this module never mutates anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Per-file upload cap. A NAS holds large media/datasets, so this is generous. */
const NAS_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
/** Hidden recycle folder; deletes move here instead of hard-unlinking. */
const TRASH_DIR = '.nas-trash';
// Path separators and Windows-reserved characters (spaces/unicode survive).
const UNSAFE_NAME_CHARS = /[/\\:*?"<>|]/g;

export type NasEntry = {
  /** Display name (a single path segment, never contains a separator). */
  name: string;
  /** Path relative to nasRootDir, POSIX-separated, e.g. "marketing/q3/plan.pdf". */
  relPath: string;
  isDir: boolean;
  /** Bytes; 0 for directories. */
  size: number;
  /** Epoch milliseconds of last modification. */
  modifiedAt: number;
};

export type NasListing = {
  /** The directory listed, relative to root ("" for the root itself). */
  path: string;
  entries: NasEntry[];
};

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
  webm: 'video/webm',
  zip: 'application/zip',
};

function mimeOf(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Resolve a client-supplied relative path against the root and verify it never
 * escapes. Returns the absolute path, or null when the input is unsafe (parent
 * traversal, absolute path, or anything resolving outside root). The root
 * itself resolves to itself ("" / "." / "/").
 */
export function resolveWithinRoot(rootDir: string, relPath: string | null | undefined): string | null {
  const root = path.resolve(rootDir);
  // Normalise the client path into a relative POSIX-ish segment list. Strip a
  // leading slash so an "absolute" looking input is still treated as relative
  // to root rather than the OS root.
  const cleaned = (relPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(root, cleaned);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/** POSIX-style relative path from root, for stable URLs across platforms. */
function toRelPosix(rootDir: string, full: string): string {
  const rel = path.relative(path.resolve(rootDir), full);
  return rel.split(path.sep).join('/');
}

/**
 * Containment check after symlink resolution. `resolveWithinRoot` only inspects
 * the path STRING, so a symlink that lives inside the root but points outside it
 * would otherwise let `..`-free requests read arbitrary server files. We resolve
 * the real (symlink-followed) path of both the target and the root and require
 * the target to stay inside. Symlinks that stay within the root are still
 * allowed. Returns true only when `full` exists and is contained.
 */
async function isRealContained(rootDir: string, full: string): Promise<boolean> {
  try {
    const realRoot = await fs.promises.realpath(path.resolve(rootDir));
    const real = await fs.promises.realpath(full);
    return real === realRoot || real.startsWith(realRoot + path.sep);
  } catch {
    // Missing path or broken symlink — treat as not contained / not found.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Write-side helpers (P2). Every mutation is confined to the root and never
// touches the recycle folder; create/upload targets are validated via their
// (existing) parent dir + a sanitized single-segment name, since the target
// itself does not yet exist and so cannot be realpath-checked directly.
// ---------------------------------------------------------------------------

/** Collapse a user-supplied name to a safe single path segment. */
function sanitizeSegment(name: string): string {
  // Trim FIRST, then strip leading/trailing dots, so a whitespace-padded
  // "  .. " can never survive as a relative segment.
  const base = path
    .basename(name)
    .replace(UNSAFE_NAME_CHARS, '_')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return base || 'untitled';
}

/**
 * True if `p` already names something on disk. Uses lstat (NOT stat) so a
 * symlink — even a broken one pointing outside the root — counts as occupied.
 * Critical: were this stat(), a broken in-root symlink would look "free" and an
 * upload would be written THROUGH it to outside the root.
 */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Append " (n)" before the extension until the name is free (bounded). */
async function uniqueTarget(dir: string, name: string): Promise<string> {
  const first = path.join(dir, name);
  if (!(await exists(first))) return first;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  return path.join(dir, `${base} (${crypto.randomBytes(4).toString('hex')})${ext}`);
}

/**
 * Real path of an EXISTING, contained target that is neither the root itself nor
 * inside the recycle folder. Null otherwise. Used by delete/move sources.
 */
async function resolveExisting(rootDir: string, relPath: string | null | undefined): Promise<string | null> {
  const full = resolveWithinRoot(rootDir, relPath);
  if (full == null) return null;
  try {
    const realRoot = await fs.promises.realpath(path.resolve(rootDir));
    const real = await fs.promises.realpath(full);
    if (real === realRoot) return null; // never operate on the root itself
    if (!real.startsWith(realRoot + path.sep)) return null;
    const trash = path.join(realRoot, TRASH_DIR);
    if (real === trash || real.startsWith(trash + path.sep)) return null;
    return real;
  } catch {
    return null;
  }
}

/**
 * Real path of an EXISTING, contained directory usable as a create/upload/move
 * destination parent. Rejects the recycle folder. Null otherwise.
 */
async function resolveParentDir(rootDir: string, parentRel: string | null | undefined): Promise<string | null> {
  const full = resolveWithinRoot(rootDir, parentRel);
  if (full == null) return null;
  try {
    const realRoot = await fs.promises.realpath(path.resolve(rootDir));
    const real = await fs.promises.realpath(full);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    if (!(await fs.promises.stat(real)).isDirectory()) return null;
    const trash = path.join(realRoot, TRASH_DIR);
    if (real === trash || real.startsWith(trash + path.sep)) return null;
    return real;
  } catch {
    return null;
  }
}

/** Split a POSIX-ish relPath into [parentRel, name]. */
function splitRel(relPath: string): { parentRel: string; name: string } {
  const cleaned = (relPath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const slash = cleaned.lastIndexOf('/');
  if (slash < 0) return { parentRel: '', name: cleaned };
  return { parentRel: cleaned.slice(0, slash), name: cleaned.slice(slash + 1) };
}

/** Create a sub-directory under `parentRel`. Returns its relPath, or null if forbidden. */
export async function nasMkdir(
  rootDir: string,
  parentRel: string | null | undefined,
  name: string
): Promise<string | null> {
  const parent = await resolveParentDir(rootDir, parentRel);
  if (parent == null) return null;
  const safe = sanitizeSegment(name);
  const target = path.join(parent, safe);
  await fs.promises.mkdir(target, { recursive: true });
  return toRelPosix(rootDir, target);
}

/** Soft-delete a file/folder by moving it into the hidden recycle folder. */
export async function nasRemove(rootDir: string, relPath: string | null | undefined): Promise<boolean> {
  const real = await resolveExisting(rootDir, relPath);
  if (real == null) return false;
  const realRoot = await fs.promises.realpath(path.resolve(rootDir));
  const trash = path.join(realRoot, TRASH_DIR);
  await fs.promises.mkdir(trash, { recursive: true });
  // uniqueTarget + a wide random token so a second deletion of a same-named
  // file in the same millisecond can never clobber the earlier one in trash.
  const stamp = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const dest = await uniqueTarget(trash, `${stamp}__${path.basename(real)}`);
  await fs.promises.rename(real, dest);
  return true;
}

/** Move/rename `fromRel` to `toRel` (parent + name). Auto-renames on collision. */
export async function nasMove(rootDir: string, fromRel: string, toRel: string): Promise<boolean> {
  const src = await resolveExisting(rootDir, fromRel);
  if (src == null) return false;
  const { parentRel, name } = splitRel(toRel);
  const destParent = await resolveParentDir(rootDir, parentRel);
  if (destParent == null) return false;
  const safe = sanitizeSegment(name);
  let dest = path.join(destParent, safe);
  if (dest === src) return true; // no-op rename
  // Refuse moving a directory into itself or a descendant (rename would EINVAL).
  if (destParent === src || destParent.startsWith(src + path.sep)) return false;
  if (await exists(dest)) dest = await uniqueTarget(destParent, safe);
  await fs.promises.rename(src, dest);
  return true;
}

/** Copy a server-side file into `destParentRel` (admin IPC upload). Returns relPath. */
export async function nasUploadFromPath(
  rootDir: string,
  destParentRel: string | null | undefined,
  sourcePath: string,
  name: string
): Promise<string | null> {
  const parent = await resolveParentDir(rootDir, destParentRel);
  if (parent == null) return null;
  const safe = sanitizeSegment(name);
  // COPYFILE_EXCL → never overwrite (and never copy THROUGH a symlink at the
  // destination name); re-pick a free name on the rare concurrent collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const dest = await uniqueTarget(parent, safe);
    try {
      await fs.promises.copyFile(sourcePath, dest, fs.constants.COPYFILE_EXCL);
      return toRelPosix(rootDir, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw err;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core operations — shared by the HTTP handlers and the admin IPC bridge.
// ---------------------------------------------------------------------------

/**
 * List a directory under the NAS root. Hidden entries (leading dot) are skipped
 * so internal/dotfiles never leak. Directories sort before files, then by name.
 * Throws on a path-containment violation; returns [] when the dir is missing.
 */
export async function nasList(rootDir: string, relPath?: string | null): Promise<NasListing> {
  const dir = resolveWithinRoot(rootDir, relPath);
  if (dir == null) throw new Error('NAS_PATH_FORBIDDEN');
  // The dir may be reached via a symlink that escapes the root — readdir would
  // then leak an outside directory's contents. Reject unless it really stays in.
  if (!(await isRealContained(rootDir, dir))) throw new Error('NAS_PATH_FORBIDDEN');

  let dirents: fs.Dirent[];
  try {
    dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return { path: toRelPosix(rootDir, dir), entries: [] };
  }

  // Stat every visible entry in parallel — a NAS directory can hold thousands
  // of files and a sequential walk would dominate the response time.
  const statted = await Promise.all(
    dirents
      .filter((d) => !d.name.startsWith('.'))
      .map(async (dirent): Promise<NasEntry | null> => {
        const full = path.join(dir, dirent.name);
        try {
          // Skip entries whose real path escapes the root (escaping symlinks).
          if (!(await isRealContained(rootDir, full))) return null;
          const st = await fs.promises.stat(full);
          const isDir = st.isDirectory();
          return {
            name: dirent.name,
            relPath: toRelPosix(rootDir, full),
            isDir,
            size: isDir ? 0 : st.size,
            modifiedAt: st.mtimeMs,
          };
        } catch {
          // Broken symlink or permission error — skip rather than fail the listing.
          return null;
        }
      })
  );
  const entries = statted.filter((e): e is NasEntry => e != null);

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    // Pin the collation so ordering is stable regardless of the server's
    // LANG/LC_* locale; numeric so "file2" sorts before "file10".
    return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
  });
  return { path: toRelPosix(rootDir, dir), entries };
}

export type NasFileInfo = { path: string; name: string; mime: string; size: number };

/** Resolve a relative path to a regular file inside root, or null. */
export async function nasFileInfo(rootDir: string, relPath: string | null | undefined): Promise<NasFileInfo | null> {
  const full = resolveWithinRoot(rootDir, relPath);
  if (full == null) return null;
  // Reject files whose real (symlink-resolved) path escapes the root, so a
  // symlink inside the drive cannot be used to read arbitrary server files.
  if (!(await isRealContained(rootDir, full))) return null;
  try {
    const st = await fs.promises.stat(full);
    if (!st.isFile()) return null;
    return { path: full, name: path.basename(full), mime: mimeOf(full), size: st.size };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP handlers (browser / distributed clients, and admin when WebUI running).
// ---------------------------------------------------------------------------

function relPathFromUrl(req: IncomingMessage): string {
  const url = new URL(req.url ?? '', 'http://localhost');
  return url.searchParams.get('path') ?? '';
}

export async function handleNasList(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string | undefined
): Promise<void> {
  if (!rootDir) {
    sendJson(res, 200, { success: true, data: { path: '', entries: [] }, disabled: true });
    return;
  }
  try {
    const listing = await nasList(rootDir, relPathFromUrl(req));
    sendJson(res, 200, { success: true, data: listing });
  } catch (err) {
    const forbidden = err instanceof Error && err.message === 'NAS_PATH_FORBIDDEN';
    sendJson(res, forbidden ? 403 : 500, { success: false, error: forbidden ? 'FORBIDDEN' : 'LIST_FAILED' });
  }
}

type RangeResult = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * Parse a single "bytes=start-end" range header against a known size, per
 * RFC 7233:
 *   - null            → no/garbage range header; caller serves 200 (full body).
 *   - 'unsatisfiable' → well-formed but cannot be met; caller serves 416.
 *   - { start, end }  → a satisfiable range; caller serves 206.
 * Multi-range ("bytes=0-1,2-3") is not supported and is treated as garbage
 * (ignored → 200) rather than mis-served.
 */
function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // malformed / multi-range → ignore, serve full body
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  if (!hasStart && !hasEnd) return null; // "bytes=-" → ignore
  let start: number;
  let end: number;
  if (hasStart) {
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : size - 1;
  } else {
    // Suffix range: last N bytes. N === 0 is unsatisfiable.
    const n = parseInt(m[1] === '' ? m[2] : m[2], 10);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  // A start past EOF, or an inverted range, is well-formed but unsatisfiable.
  if (start >= size || start > end || start < 0) return 'unsatisfiable';
  return { start, end };
}

async function streamNasFile(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string | undefined,
  disposition: 'attachment' | 'inline'
): Promise<void> {
  if (!rootDir) {
    sendJson(res, 404, { success: false, error: 'NAS_DISABLED' });
    return;
  }
  const info = await nasFileInfo(rootDir, relPathFromUrl(req));
  if (!info) {
    sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
    return;
  }

  // HEAD: answer with metadata headers only — never open a read stream (avoids
  // an fd / first-byte read on a slow network mount).
  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'content-type': disposition === 'inline' ? info.mime : 'application/octet-stream',
      'accept-ranges': 'bytes',
      'content-length': String(info.size),
    });
    res.end();
    return;
  }

  const filename = encodeURIComponent(info.name);
  const contentType = disposition === 'inline' ? info.mime : 'application/octet-stream';
  const range = parseRange(req.headers.range, info.size);

  if (range === 'unsatisfiable') {
    // RFC 7233 §4.4: well-formed but out-of-bounds range → 416 + the full size.
    res.writeHead(416, { 'content-range': `bytes */${info.size}`, 'accept-ranges': 'bytes' });
    res.end();
    return;
  }

  if (range) {
    const { start, end } = range;
    res.writeHead(206, {
      'content-type': contentType,
      'content-disposition': `${disposition}; filename*=UTF-8''${filename}`,
      'content-range': `bytes ${start}-${end}/${info.size}`,
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
    });
    const stream = fs.createReadStream(info.path, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return;
  }

  res.writeHead(200, {
    'content-type': contentType,
    'content-disposition': `${disposition}; filename*=UTF-8''${filename}`,
    'accept-ranges': 'bytes',
    'content-length': String(info.size),
  });
  const stream = fs.createReadStream(info.path);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

export function handleNasDownload(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string | undefined
): Promise<void> {
  return streamNasFile(req, res, rootDir, 'attachment');
}

export function handleNasPreview(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string | undefined
): Promise<void> {
  return streamNasFile(req, res, rootDir, 'inline');
}

// ---------------------------------------------------------------------------
// Write handlers (P2). All mutate under nasRootDir only and are auth-gated by
// static-server when the WebUI is LAN-exposed (allowRemote).
// ---------------------------------------------------------------------------

function queryParam(req: IncomingMessage, key: string): string {
  return new URL(req.url ?? '', 'http://localhost').searchParams.get(key) ?? '';
}

/** POST /api/nas/upload?path=<dir>&name=<file> — body = raw file bytes. */
export async function handleNasUpload(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string | undefined
): Promise<void> {
  if (!rootDir) {
    sendJson(res, 503, { success: false, error: 'NAS_DISABLED' });
    return;
  }
  const rawName = queryParam(req, 'name');
  if (!rawName) {
    sendJson(res, 400, { success: false, error: 'MISSING_NAME' });
    return;
  }
  const parent = await resolveParentDir(rootDir, queryParam(req, 'path'));
  if (parent == null) {
    sendJson(res, 403, { success: false, error: 'FORBIDDEN' });
    return;
  }

  // Atomically claim a fresh name with O_EXCL ('wx'). This both prevents two
  // concurrent same-name uploads from clobbering each other (the loser retries)
  // AND refuses to follow a symlink, so an upload can never be written THROUGH
  // a dangling in-root symlink to a path outside the root.
  const safe = sanitizeSegment(rawName);
  let fh: Awaited<ReturnType<typeof fs.promises.open>> | null = null;
  let full = '';
  for (let attempt = 0; attempt < 5 && !fh; attempt++) {
    full = await uniqueTarget(parent, safe);
    try {
      fh = await fs.promises.open(full, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      sendJson(res, 500, { success: false, error: 'WRITE_ERROR' });
      return;
    }
  }
  if (!fh) {
    sendJson(res, 500, { success: false, error: 'WRITE_ERROR' });
    return;
  }

  // Stream the body to the claimed fd with a size cap. Manual write+backpressure
  // (not pipe + a 'data' listener) — the static-server TCP peek/splice layer
  // stalls when both are mixed (see shared-drive.ts). autoClose:false: we own
  // the FileHandle and close it exactly once in the finally below.
  let size = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream('', { fd: fh.fd, autoClose: false });
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        out.destroy();
        reject(err);
      };
      out.on('error', fail);
      req.on('error', fail);
      req.on('aborted', () => fail(new Error('ABORTED')));
      req.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > NAS_MAX_UPLOAD_BYTES) {
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
    await fh.close().catch(() => {});
    await fs.promises.rm(full, { force: true }).catch(() => {});
    const tooLarge = err instanceof Error && err.message === 'TOO_LARGE';
    sendJson(res, tooLarge ? 413 : 500, { success: false, error: tooLarge ? 'TOO_LARGE' : 'WRITE_ERROR' });
    return;
  }
  await fh.close().catch(() => {});
  sendJson(res, 200, { success: true, data: { relPath: toRelPosix(rootDir, full), size } });
}

/** POST /api/nas/mkdir?path=<parent>&name=<folder> */
export async function handleNasMkdir(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string | undefined
): Promise<void> {
  if (!rootDir) {
    sendJson(res, 503, { success: false, error: 'NAS_DISABLED' });
    return;
  }
  const name = queryParam(req, 'name');
  if (!name) {
    sendJson(res, 400, { success: false, error: 'MISSING_NAME' });
    return;
  }
  try {
    const relPath = await nasMkdir(rootDir, queryParam(req, 'path'), name);
    if (relPath == null) {
      sendJson(res, 403, { success: false, error: 'FORBIDDEN' });
      return;
    }
    sendJson(res, 200, { success: true, data: { relPath } });
  } catch {
    sendJson(res, 500, { success: false, error: 'MKDIR_FAILED' });
  }
}

/** POST /api/nas/move?from=<rel>&to=<rel> */
export async function handleNasMove(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string | undefined
): Promise<void> {
  if (!rootDir) {
    sendJson(res, 503, { success: false, error: 'NAS_DISABLED' });
    return;
  }
  const from = queryParam(req, 'from');
  const to = queryParam(req, 'to');
  if (!from || !to) {
    sendJson(res, 400, { success: false, error: 'MISSING_ARG' });
    return;
  }
  try {
    const ok = await nasMove(rootDir, from, to);
    sendJson(res, ok ? 200 : 403, { success: ok, ...(ok ? {} : { error: 'FORBIDDEN' }) });
  } catch {
    sendJson(res, 500, { success: false, error: 'MOVE_FAILED' });
  }
}

/** DELETE /api/nas/remove?path=<rel> — soft-delete to the recycle folder. */
export async function handleNasRemove(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string | undefined
): Promise<void> {
  if (!rootDir) {
    sendJson(res, 503, { success: false, error: 'NAS_DISABLED' });
    return;
  }
  try {
    const ok = await nasRemove(rootDir, queryParam(req, 'path'));
    sendJson(res, ok ? 200 : 404, { success: ok, ...(ok ? {} : { error: 'NOT_FOUND' }) });
  } catch {
    sendJson(res, 500, { success: false, error: 'REMOVE_FAILED' });
  }
}
