/**
 * Enterprise LAN network drive ("共享盘 · 文件") — read + write.
 *
 * Unlike the artifact board in shared-drive.ts (a managed blob store keyed by a
 * manifest), this surface maps 1:1 onto a real directory tree on the server —
 * the admin points `nasRootDir` at the company's large shared disk (e.g. a 2TB
 * mount) and every LAN user can browse / download / preview / upload / organize
 * it. No manifest, no id indirection: scales to tens of thousands of files
 * because listing is just `readdir` of a sub-path.
 *
 * Like shared-drive.ts and downloads.ts these routes are served LOCALLY by
 * static-server (NOT proxied to aioncore) so they are reachable identically by
 * the admin Electron renderer, browser WebUI, and distributed Electron clients.
 *
 *   GET    /api/nas/list?path=<relPath>          → { data: { path, entries } }
 *   GET    /api/nas/download|preview?path=<rel>  → the file (Range-capable)
 *   POST   /api/nas/upload?path=<dir>&name=      → raw body, auto-renames
 *   POST   /api/nas/mkdir?path=<parent>&name=
 *   POST   /api/nas/move?from=<rel>&to=<rel>
 *   DELETE /api/nas/remove?path=<rel>            → soft-delete to .nas-trash
 *
 * Visibility is "everyone on the LAN" (no per-user access control — by product
 * decision); writes are auth-gated on LAN exactly like reads. The one
 * non-negotiable boundary is PATH CONTAINMENT: no read OR write may touch
 * anything outside `nasRootDir` — `..` is rejected, symlinks are resolved and
 * re-checked, and writes use lstat + O_EXCL so an upload can never be written
 * through a symlink to outside the root. Deletes are soft (recoverable).
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

export type NasTrashEntry = {
  /** The on-disk name inside .nas-trash ("<stamp>__<originalName>"). */
  trashName: string;
  /** The name the entry had before deletion. */
  originalName: string;
  isDir: boolean;
  size: number;
  /** Epoch milliseconds the entry was deleted (parsed from the stamp). */
  deletedAt: number;
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
/** True if `real` is, or lives inside, a reserved internal dir (.nas-trash / .nas-index). */
function isReservedPath(realRoot: string, real: string): boolean {
  for (const reserved of [TRASH_DIR, INDEX_DIR]) {
    const dir = path.join(realRoot, reserved);
    if (real === dir || real.startsWith(dir + path.sep)) return true;
  }
  return false;
}

async function resolveExisting(rootDir: string, relPath: string | null | undefined): Promise<string | null> {
  const full = resolveWithinRoot(rootDir, relPath);
  if (full == null) return null;
  try {
    const realRoot = await fs.promises.realpath(path.resolve(rootDir));
    const real = await fs.promises.realpath(full);
    if (real === realRoot) return null; // never operate on the root itself
    if (!real.startsWith(realRoot + path.sep)) return null;
    if (isReservedPath(realRoot, real)) return null;
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
    if (isReservedPath(realRoot, real)) return null;
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
// Recycle-folder management. ADMIN-ONLY (no HTTP routes): on a "全员共享" drive
// any user may soft-delete (recoverable), but emptying/restoring the shared
// recycle bin is destructive/privileged, so it is reachable solely via the
// admin desktop IPC bridge — never over the LAN HTTP surface.
// ---------------------------------------------------------------------------

function parseTrashName(trashName: string): { originalName: string; deletedAt: number } {
  const idx = trashName.indexOf('__');
  if (idx < 0) return { originalName: trashName, deletedAt: 0 };
  const stamp = trashName.slice(0, idx);
  return { originalName: trashName.slice(idx + 2), deletedAt: parseInt(stamp.split('-')[0], 10) || 0 };
}

/** Resolve a direct child of the recycle folder by its on-disk name, or null. */
async function resolveInTrash(rootDir: string, trashName: string): Promise<string | null> {
  if (!trashName || trashName.includes('/') || trashName.includes('\\') || trashName.includes('\0')) return null;
  if (trashName === '.' || trashName === '..') return null;
  try {
    const realRoot = await fs.promises.realpath(path.resolve(rootDir));
    const trash = path.join(realRoot, TRASH_DIR);
    const real = await fs.promises.realpath(path.join(trash, path.basename(trashName)));
    // Must be a DIRECT child of the trash dir (rejects symlinks pointing out).
    if (path.dirname(real) !== trash) return null;
    return real;
  } catch {
    return null;
  }
}

/** List the recycle folder's contents (most-recently deleted first). */
export async function nasTrashList(rootDir: string): Promise<NasTrashEntry[]> {
  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(path.resolve(rootDir));
  } catch {
    return [];
  }
  const trash = path.join(realRoot, TRASH_DIR);
  let dirents: fs.Dirent[];
  try {
    dirents = await fs.promises.readdir(trash, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries = await Promise.all(
    dirents.map(async (d): Promise<NasTrashEntry | null> => {
      try {
        const st = await fs.promises.lstat(path.join(trash, d.name));
        const { originalName, deletedAt } = parseTrashName(d.name);
        return {
          trashName: d.name,
          originalName,
          isDir: st.isDirectory(),
          size: st.isDirectory() ? 0 : st.size,
          deletedAt,
        };
      } catch {
        return null;
      }
    })
  );
  return entries.filter((e): e is NasTrashEntry => e != null).sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Restore a trashed entry back to the root (auto-renamed on collision). */
export async function nasTrashRestore(rootDir: string, trashName: string): Promise<string | null> {
  const real = await resolveInTrash(rootDir, trashName);
  if (real == null) return null;
  const realRoot = await fs.promises.realpath(path.resolve(rootDir));
  const { originalName } = parseTrashName(path.basename(real));
  const dest = await uniqueTarget(realRoot, sanitizeSegment(originalName));
  await fs.promises.rename(real, dest);
  return toRelPosix(rootDir, dest);
}

/** Permanently delete a single trashed entry. */
export async function nasTrashRemove(rootDir: string, trashName: string): Promise<boolean> {
  const real = await resolveInTrash(rootDir, trashName);
  if (real == null) return false;
  await fs.promises.rm(real, { recursive: true, force: true });
  return true;
}

/** Permanently empty the recycle folder. */
export async function nasTrashEmpty(rootDir: string): Promise<boolean> {
  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(path.resolve(rootDir));
  } catch {
    return false;
  }
  const trash = path.join(realRoot, TRASH_DIR);
  let names: string[];
  try {
    names = await fs.promises.readdir(trash);
  } catch {
    return true; // no trash dir → already empty
  }
  await Promise.all(
    names.map((n) => fs.promises.rm(path.join(trash, n), { recursive: true, force: true }).catch(() => {}))
  );
  return true;
}

// ---------------------------------------------------------------------------
// Knowledge-base indexing (P3a). ADMIN-ONLY (admin desktop IPC, no HTTP route).
// "Index this folder" recursively walks a NAS subtree and POSTs each supported
// file to the local vector DB's /api/upload (copy-in). The vector DB dedups by
// content hash, so re-indexing is idempotent. Never touches /api/reindex (that
// wipes the whole collection, including office-assistant outputs).
// ---------------------------------------------------------------------------

/** File types the local vector DB can ingest (mirrors its config). */
const INDEXABLE_TEXT_EXT = ['pdf', 'docx', 'md', 'txt'];
const INDEXABLE_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp'];
const INDEXABLE_VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'];
/** Per-file cap for indexing uploads — read fully into memory, so kept modest. */
const NAS_INDEX_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
/** Hidden folder holding the index manifest (uploaded doc ids + change keys). */
const INDEX_DIR = '.nas-index';

export type NasWalkFile = { relPath: string; absPath: string; size: number; modifiedAt: number; ext: string };

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Recursively collect indexable files under a NAS sub-path. Reuses the same
 * containment guards as the read path at every level, skips dotfiles (incl.
 * .nas-trash) and any entry whose real path escapes the root.
 */
export async function nasWalk(
  rootDir: string,
  relPath: string | null | undefined,
  opts?: { includeVideo?: boolean }
): Promise<NasWalkFile[]> {
  const start = resolveWithinRoot(rootDir, relPath);
  if (start == null || !(await isRealContained(rootDir, start))) throw new Error('NAS_PATH_FORBIDDEN');
  // Reject a reserved internal dir as the START — the per-entry dotfile skip
  // below only filters CHILDREN, so without this an explicit path=.nas-index /
  // .nas-trash would walk the manifest + recycled files into the knowledge base.
  const realRoot = await fs.promises.realpath(path.resolve(rootDir)).catch(() => path.resolve(rootDir));
  const realStart = await fs.promises.realpath(start).catch(() => start);
  if (isReservedPath(realRoot, realStart)) throw new Error('NAS_PATH_FORBIDDEN');

  const exts = new Set([
    ...INDEXABLE_TEXT_EXT,
    ...INDEXABLE_IMAGE_EXT,
    ...(opts?.includeVideo ? INDEXABLE_VIDEO_EXT : []),
  ]);
  const out: NasWalkFile[] = [];
  // Visited real directory paths — guards against symlink CYCLES (an in-root
  // symlink to an ancestor would otherwise be re-walked ~40× until ELOOP,
  // emitting each file under it many times with distinct relPaths).
  const visited = new Set<string>([realStart]);
  const walk = async (dir: string): Promise<void> => {
    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue; // dotfiles incl. .nas-trash / .nas-index
      const full = path.join(dir, d.name);
      if (!(await isRealContained(rootDir, full))) continue; // escaping symlink
      let st: fs.Stats;
      try {
        st = await fs.promises.stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        const realDir = await fs.promises.realpath(full).catch(() => full);
        if (visited.has(realDir)) continue; // already walked this real dir → cycle
        visited.add(realDir);
        await walk(full);
        continue;
      }
      const ext = extOf(d.name);
      if (!exts.has(ext)) continue;
      out.push({ relPath: toRelPosix(rootDir, full), absPath: full, size: st.size, modifiedAt: st.mtimeMs, ext });
    }
  };
  await walk(start);
  return out;
}

export type NasIndexProgress = {
  phase: 'walking' | 'indexing' | 'done' | 'error';
  total: number;
  done: number;
  failed: number;
  skipped: number;
  /** Entries removed from the index because the source file is gone. */
  pruned: number;
  current?: string;
  error?: string;
};

/** Manifest entry: change key (size+mtime) + the vector-DB doc id we uploaded. */
type IndexManifestEntry = { size: number; mtimeMs: number; docId: string; indexedAt: number };
type IndexManifest = {
  version: number;
  files: Record<string, IndexManifestEntry>;
  /** Doc ids whose delete failed (orphans) — retried at the next sync. */
  pendingDeletes?: string[];
};

async function readIndexManifest(rootDir: string): Promise<IndexManifest> {
  try {
    const realRoot = await fs.promises.realpath(path.resolve(rootDir));
    const raw = await fs.promises.readFile(path.join(realRoot, INDEX_DIR, 'manifest.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.files) return parsed as IndexManifest;
  } catch {
    // missing / corrupt → start fresh
  }
  return { version: 1, files: {} };
}

async function writeIndexManifest(rootDir: string, manifest: IndexManifest): Promise<void> {
  const realRoot = await fs.promises.realpath(path.resolve(rootDir));
  const dir = path.join(realRoot, INDEX_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.manifest.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  await fs.promises.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf-8');
  await fs.promises.rename(tmp, path.join(dir, 'manifest.json'));
}

/**
 * DELETE a previously-uploaded doc. Returns true only when the doc is gone
 * (2xx) or already absent (404). A network/5xx failure returns false so the
 * caller can keep the id for a retry instead of silently orphaning it.
 */
async function deleteVectorDoc(endpoint: string, docId: string): Promise<boolean> {
  if (!docId) return true;
  try {
    const resp = await fetch(`${endpoint}/api/documents/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
      headers: { 'X-Requested-By': 'centaur-vdb' },
    });
    return resp.ok || resp.status === 404;
  } catch {
    return false;
  }
}

/**
 * For a queued (video) upload, poll the job until it leaves the queue. Returns
 * 'done' / 'failed', or 'pending' if it is still processing after a bounded
 * wait (we then optimistically accept it — the server keeps working on it). A
 * synchronous upload (no job) is treated as 'done' by the caller and never
 * reaches here. Honors cancellation.
 */
async function waitForVectorJob(
  endpoint: string,
  docId: string,
  isCancelled?: () => boolean
): Promise<'done' | 'failed' | 'pending'> {
  const deadline = Date.now() + 45_000; // bound: catch fast failures, don't block hours
  while (Date.now() < deadline) {
    if (isCancelled?.()) return 'pending';
    try {
      const resp = await fetch(`${endpoint}/api/jobs/${encodeURIComponent(docId)}`, {
        headers: { 'X-Requested-By': 'centaur-vdb' },
      });
      const state = resp.ok ? ((await resp.json()) as { state?: string }).state : undefined;
      if (state === 'done') return 'done';
      if (state === 'failed') return 'failed';
    } catch {
      // transient; keep polling until the deadline
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return 'pending';
}

/**
 * Sync a NAS subtree into the vector DB knowledge base at `endpoint`.
 *
 * Because /api/upload UUID-prefixes every file, re-POSTing the same file creates
 * a DUPLICATE (its content-hash dedup is keyed on the unique saved path, so it
 * never fires across uploads). We therefore keep our own manifest of what we've
 * indexed (change key = size+mtime, plus the vector-DB doc id) under
 * `<root>/.nas-index/` and make indexing a proper SYNC:
 *   - unchanged file (same size+mtime) → skip
 *   - new / changed file → (delete the old doc if any) + upload, record doc id
 *   - file that disappeared from the subtree → delete its doc, drop from manifest
 * Serialized (the vector DB indexer is single-worker). Honors `isCancelled`.
 */
export async function indexNasFolder(
  rootDir: string,
  relPath: string | null | undefined,
  opts: {
    endpoint: string;
    includeVideo?: boolean;
    onProgress?: (p: NasIndexProgress) => void;
    isCancelled?: () => boolean;
  }
): Promise<NasIndexProgress> {
  const endpoint = opts.endpoint.trim().replace(/\/+$/, '');
  const prog: NasIndexProgress = { phase: 'walking', total: 0, done: 0, failed: 0, skipped: 0, pruned: 0 };
  const emit = () => opts.onProgress?.({ ...prog });
  emit();
  if (!/^https?:\/\//i.test(endpoint)) {
    prog.phase = 'error';
    prog.error = 'INVALID_ENDPOINT';
    emit();
    return prog;
  }

  // Canonical subtree prefix, for scoping the prune pass to what we walked.
  const startAbs = resolveWithinRoot(rootDir, relPath);
  if (startAbs == null) {
    prog.phase = 'error';
    prog.error = 'NAS_PATH_FORBIDDEN';
    emit();
    return prog;
  }
  const scope = toRelPosix(rootDir, startAbs);
  const inScope = (rel: string) => scope === '' || rel === scope || rel.startsWith(scope + '/');

  let files: NasWalkFile[];
  try {
    files = await nasWalk(rootDir, relPath, { includeVideo: opts.includeVideo });
  } catch {
    prog.phase = 'error';
    prog.error = 'NAS_PATH_FORBIDDEN';
    emit();
    return prog;
  }
  const manifest = await readIndexManifest(rootDir);
  prog.total = files.length;
  prog.phase = 'indexing';
  emit();

  // Orphans whose delete failed on a prior run — retry, keep the ones that fail.
  const pending = new Set<string>(manifest.pendingDeletes ?? []);
  const orphan = async (docId: string | undefined) => {
    if (!docId) return;
    if (await deleteVectorDoc(endpoint, docId)) pending.delete(docId);
    else pending.add(docId);
  };
  for (const docId of Array.from(pending)) await orphan(docId);

  const seen = new Set<string>();
  for (const f of files) {
    if (opts.isCancelled?.()) break;
    seen.add(f.relPath);
    prog.current = f.relPath;
    emit();
    const prev = manifest.files[f.relPath];
    if (prev && prev.size === f.size && prev.mtimeMs === f.modifiedAt) {
      prog.skipped++; // unchanged since last index
      emit();
      continue;
    }
    if (f.size > NAS_INDEX_MAX_BYTES) {
      prog.skipped++;
      emit();
      continue;
    }
    try {
      const buf = await fs.promises.readFile(f.absPath);
      const form = new FormData();
      form.append('file', new Blob([buf]), path.basename(f.absPath));
      const resp = await fetch(`${endpoint}/api/upload`, {
        method: 'POST',
        headers: { 'X-Requested-By': 'centaur-vdb' },
        body: form,
      });
      if (!resp.ok) {
        prog.failed++;
        emit();
        continue;
      }
      const body = (await resp.json().catch(() => ({}))) as { doc_id?: string; saved_path?: string; queued?: boolean };
      const docId = body.doc_id || body.saved_path || '';
      // Queued (video) uploads index in the background — confirm they don't
      // fail outright before counting them as done.
      if (body.queued && docId) {
        const state = await waitForVectorJob(endpoint, docId, opts.isCancelled);
        if (state === 'failed') {
          await orphan(docId); // remove the failed partial; next run retries
          prog.failed++;
          emit();
          continue;
        }
      }
      // New version landed → drop the previous one (retry-tracked on failure).
      if (prev?.docId && prev.docId !== docId) await orphan(prev.docId);
      manifest.files[f.relPath] = { size: f.size, mtimeMs: f.modifiedAt, docId, indexedAt: Date.now() };
      prog.done++;
    } catch {
      prog.failed++;
    }
    emit();
  }

  // Prune: files we had indexed under this subtree that are gone now.
  if (!opts.isCancelled?.()) {
    for (const rel of Object.keys(manifest.files)) {
      if (!inScope(rel) || seen.has(rel)) continue;
      await orphan(manifest.files[rel].docId);
      delete manifest.files[rel];
      prog.pruned++;
      emit();
    }
  }

  manifest.pendingDeletes = [...pending];
  try {
    await writeIndexManifest(rootDir, manifest);
  } catch {
    // manifest write failed — index still happened; next run may re-add dupes
  }
  prog.phase = 'done';
  prog.current = undefined;
  emit();
  return prog;
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
