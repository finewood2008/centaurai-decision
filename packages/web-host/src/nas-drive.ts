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
import type { IncomingMessage, ServerResponse } from 'node:http';

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
    return a.name.localeCompare(b.name);
  });
  return { path: toRelPosix(rootDir, dir), entries };
}

export type NasFileInfo = { path: string; name: string; mime: string; size: number };

/** Resolve a relative path to a regular file inside root, or null. */
export async function nasFileInfo(rootDir: string, relPath: string | null | undefined): Promise<NasFileInfo | null> {
  const full = resolveWithinRoot(rootDir, relPath);
  if (full == null) return null;
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

/**
 * Parse a single-range "bytes=start-end" header against a known size. Returns
 * null for absent/unsupported/unsatisfiable ranges (caller falls back to 200).
 */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  let start: number;
  let end: number;
  if (hasStart) {
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : size - 1;
  } else if (hasEnd) {
    // Suffix range: last N bytes.
    const n = parseInt(m[2], 10);
    if (n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    return null;
  }
  end = Math.min(end, size - 1);
  if (start > end || start < 0) return null;
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

  const filename = encodeURIComponent(info.name);
  const contentType = disposition === 'inline' ? info.mime : 'application/octet-stream';
  const range = parseRange(req.headers.range, info.size);

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
