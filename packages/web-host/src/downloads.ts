/**
 * Client-installer downloads for the WebUI.
 *
 * The native client installers are NOT distributed from any public site — they
 * ship bundled inside the admin server (see electron-builder extraResources
 * `client-installers`). Browser users log into the WebUI and pull the matching
 * installer from Settings → Download Client, served by these two endpoints:
 *
 *   GET /api/downloads/list           → JSON { data: InstallerInfo[] }
 *   GET /api/downloads/get?file=<name> → the installer file (attachment)
 *
 * Both are handled locally by static-server (NOT proxied to aioncore).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type InstallerOs = 'windows' | 'macos' | 'linux' | 'unknown';
export type InstallerArch = 'x64' | 'arm64' | 'unknown';

export type InstallerInfo = {
  /** Filename — also the `?file=` value for the download endpoint. */
  file: string;
  os: InstallerOs;
  arch: InstallerArch;
  /** Lowercased extension without the dot (exe, dmg, appimage, deb, zip…). */
  ext: string;
  /** Size in bytes. */
  size: number;
  /** Semver parsed from the filename, or '' when not found. */
  version: string;
};

// Extensions we are willing to list and serve. Anything else in the directory
// (e.g. .DS_Store, README) is ignored.
const ALLOWED_EXTS = new Set(['exe', 'msi', 'zip', 'dmg', 'pkg', 'appimage', 'deb', 'rpm']);

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function inferOs(name: string, ext: string): InstallerOs {
  const n = name.toLowerCase();
  if (ext === 'exe' || ext === 'msi') return 'windows';
  if (ext === 'dmg' || ext === 'pkg') return 'macos';
  if (ext === 'appimage' || ext === 'deb' || ext === 'rpm') return 'linux';
  if (ext === 'zip') {
    if (n.includes('mac') || n.includes('darwin') || n.includes('osx')) return 'macos';
    if (n.includes('win')) return 'windows';
    if (n.includes('linux')) return 'linux';
  }
  return 'unknown';
}

function inferArch(name: string): InstallerArch {
  const n = name.toLowerCase();
  if (n.includes('arm64') || n.includes('aarch64')) return 'arm64';
  if (n.includes('x64') || n.includes('x86_64') || n.includes('amd64')) return 'x64';
  return 'unknown';
}

function inferVersion(name: string): string {
  // Match a bare semver core (e.g. 2.1.14). We deliberately stop at the patch
  // number so trailing os/arch tokens (…-win-x64) are not swallowed.
  const m = name.match(/\d+\.\d+\.\d+/);
  return m ? m[0] : '';
}

/**
 * List installer files in `installerDir`. Returns [] when the directory is
 * unset, missing, or holds no recognized installers — the UI then tells the
 * user to contact their admin rather than erroring.
 */
export async function listInstallers(installerDir: string | undefined): Promise<InstallerInfo[]> {
  if (!installerDir) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(installerDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries.filter((e) => e.isFile() && ALLOWED_EXTS.has(extOf(e.name)));
  const sized = await Promise.all(
    candidates.map(async (entry) => {
      try {
        const { size } = await fs.promises.stat(path.join(installerDir, entry.name));
        const ext = extOf(entry.name);
        return {
          file: entry.name,
          os: inferOs(entry.name, ext),
          arch: inferArch(entry.name),
          ext,
          size,
          version: inferVersion(entry.name),
        } satisfies InstallerInfo;
      } catch {
        return null;
      }
    })
  );
  const out: InstallerInfo[] = sized.filter((x): x is InstallerInfo => x !== null);
  // Stable, predictable order: by OS then arch then name.
  out.sort((a, b) => a.os.localeCompare(b.os) || a.arch.localeCompare(b.arch) || a.file.localeCompare(b.file));
  return out;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** GET /api/downloads/list */
export async function handleDownloadsList(res: ServerResponse, installerDir: string | undefined): Promise<void> {
  const installers = await listInstallers(installerDir);
  sendJson(res, 200, { success: true, data: installers });
}

/**
 * GET /api/downloads/get?file=<name>
 *
 * `file` must be a bare filename present in `installerDir`. We reject anything
 * containing a path separator (path.basename mismatch) and re-verify the
 * resolved path stays inside the directory — defense in depth against traversal.
 */
export async function handleDownloadGet(
  req: IncomingMessage,
  res: ServerResponse,
  installerDir: string | undefined
): Promise<void> {
  if (!installerDir) {
    sendJson(res, 404, { success: false, error: 'NO_INSTALLERS' });
    return;
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const requested = url.searchParams.get('file') || '';
  const base = path.basename(requested);
  if (!requested || base !== requested || !ALLOWED_EXTS.has(extOf(base))) {
    sendJson(res, 400, { success: false, error: 'INVALID_FILE' });
    return;
  }
  const dir = path.resolve(installerDir);
  const full = path.resolve(dir, base);
  if (path.dirname(full) !== dir) {
    sendJson(res, 400, { success: false, error: 'INVALID_FILE' });
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
    'content-type': 'application/octet-stream',
    'content-length': String(stat.size),
    'content-disposition': `attachment; filename="${base}"`,
    'cache-control': 'no-store',
  });
  const stream = fs.createReadStream(full);
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, { success: false, error: 'READ_ERROR' });
    else res.destroy();
  });
  stream.pipe(res);
}
