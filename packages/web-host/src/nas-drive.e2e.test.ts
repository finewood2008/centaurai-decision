/**
 * End-to-end verification of /api/nas/* through the REAL static-server stack
 * (outer TCP splice + inner http server + auth gate), not just the bare
 * handlers. This is the integration proof that the route wiring, path
 * containment, HTTP Range, and the LAN auth gate all hold together.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startStaticServer, type StaticServerHandle } from './static-server.js';

let nasRoot: string;
let outsideSecret: string;
let staticDir: string;
const handles: StaticServerHandle[] = [];

beforeEach(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-e2e-'));
  nasRoot = path.join(tmp, 'root');
  staticDir = path.join(tmp, 'static');
  await fs.mkdir(path.join(nasRoot, 'docs'), { recursive: true });
  await fs.mkdir(staticDir, { recursive: true });
  await fs.writeFile(path.join(staticDir, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(nasRoot, 'readme.txt'), 'hello world');
  await fs.writeFile(path.join(nasRoot, 'docs', 'plan.md'), '# plan');
  // A secret file OUTSIDE the root + a symlink inside the root pointing at it.
  outsideSecret = path.join(tmp, 'OUTSIDE_SECRET.txt');
  await fs.writeFile(outsideSecret, 'TOP-SECRET-OUTSIDE-ROOT');
  try {
    await fs.symlink(outsideSecret, path.join(nasRoot, 'escape-link.txt'));
  } catch {
    // symlink unsupported (rare) — the symlink assertions below tolerate absence.
  }
});

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.stop()));
});

async function start(allowRemote: boolean): Promise<StaticServerHandle> {
  // backendPort points nowhere real; /api/nas/* short-circuits before any proxy.
  const handle = await startStaticServer({
    staticDir,
    backendPort: 1,
    port: 0,
    allowRemote,
    nasRootDir: nasRoot,
  });
  handles.push(handle);
  return handle;
}

describe('NAS e2e — loopback (gate inactive), full server stack', () => {
  it('lists the root directory', async () => {
    const { localUrl } = await start(false);
    const resp = await fetch(`${localUrl}/api/nas/list`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    const names = body.data.entries.map((e: { name: string }) => e.name).toSorted();
    // docs (dir) + readme.txt + escape-link.txt (symlink shows in listing).
    expect(names).toContain('docs');
    expect(names).toContain('readme.txt');
  });

  it('downloads a contained file with correct bytes', async () => {
    const { localUrl } = await start(false);
    const resp = await fetch(`${localUrl}/api/nas/download?path=readme.txt`);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('hello world');
  });

  it('serves a byte range as 206', async () => {
    const { localUrl } = await start(false);
    const resp = await fetch(`${localUrl}/api/nas/download?path=readme.txt`, { headers: { Range: 'bytes=0-4' } });
    expect(resp.status).toBe(206);
    expect(await resp.text()).toBe('hello');
  });

  it('returns 416 for an unsatisfiable range (not the full body)', async () => {
    const { localUrl } = await start(false);
    const resp = await fetch(`${localUrl}/api/nas/download?path=readme.txt`, { headers: { Range: 'bytes=9999-' } });
    expect(resp.status).toBe(416);
    expect(resp.headers.get('content-range')).toBe(`bytes */${'hello world'.length}`);
  });

  it('ignores a malformed range and serves 200 full body', async () => {
    const { localUrl } = await start(false);
    const resp = await fetch(`${localUrl}/api/nas/download?path=readme.txt`, { headers: { Range: 'bytes=abc' } });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('hello world');
  });

  it('answers HEAD with size headers and no body', async () => {
    const { localUrl } = await start(false);
    const resp = await fetch(`${localUrl}/api/nas/download?path=readme.txt`, { method: 'HEAD' });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-length')).toBe(String('hello world'.length));
    expect(await resp.text()).toBe('');
  });

  it('blocks parent traversal end-to-end', async () => {
    const { localUrl } = await start(false);
    const list = await fetch(`${localUrl}/api/nas/list?path=${encodeURIComponent('../..')}`);
    expect(list.status).toBe(403);
    const dl = await fetch(`${localUrl}/api/nas/download?path=${encodeURIComponent('../OUTSIDE_SECRET.txt')}`);
    expect(dl.status).toBe(404);
    expect(await dl.text()).not.toContain('TOP-SECRET');
  });

  it('blocks URL-encoded traversal', async () => {
    const { localUrl } = await start(false);
    // %2e%2e%2f == ../  — decoded by the URL parser, then must still be contained.
    const dl = await fetch(`${localUrl}/api/nas/download?path=%2e%2e%2fOUTSIDE_SECRET.txt`);
    expect(dl.status).toBe(404);
    expect(await dl.text()).not.toContain('TOP-SECRET');
  });

  it('does NOT disclose files outside the root via a symlink', async () => {
    const { localUrl } = await start(false);
    const exists = await fs
      .lstat(path.join(nasRoot, 'escape-link.txt'))
      .then(() => true)
      .catch(() => false);
    if (!exists) return; // platform without symlink support
    const dl = await fetch(`${localUrl}/api/nas/download?path=escape-link.txt`);
    const text = dl.ok ? await dl.text() : '';
    expect(text).not.toContain('TOP-SECRET-OUTSIDE-ROOT');
    // The escaping symlink must also be hidden from the listing.
    const list = await (await fetch(`${localUrl}/api/nas/list`)).json();
    expect(list.data.entries.map((e: { name: string }) => e.name)).not.toContain('escape-link.txt');
  });

  it('STILL serves a symlink that stays inside the root', async () => {
    // Symlink within the root → another in-root file must keep working.
    const linkExists = await fs
      .symlink(path.join(nasRoot, 'readme.txt'), path.join(nasRoot, 'inside-link.txt'))
      .then(() => true)
      .catch(() => false);
    if (!linkExists) return;
    const { localUrl } = await start(false);
    const dl = await fetch(`${localUrl}/api/nas/download?path=inside-link.txt`);
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe('hello world');
  });
});

describe('NAS e2e — LAN exposed (gate active)', () => {
  it('rejects unauthenticated /api/nas/list with 401', async () => {
    const { localUrl } = await start(true);
    const resp = await fetch(`${localUrl}/api/nas/list`);
    expect(resp.status).toBe(401);
  });

  it('rejects unauthenticated /api/nas/download with 401', async () => {
    const { localUrl } = await start(true);
    const resp = await fetch(`${localUrl}/api/nas/download?path=readme.txt`);
    expect(resp.status).toBe(401);
  });

  it('rejects unauthenticated WRITE routes with 401', async () => {
    const { localUrl } = await start(true);
    const up = await fetch(`${localUrl}/api/nas/upload?path=&name=x.txt`, { method: 'POST', body: 'data' });
    expect(up.status).toBe(401);
    const mk = await fetch(`${localUrl}/api/nas/mkdir?path=&name=evil`, { method: 'POST' });
    expect(mk.status).toBe(401);
    const rm = await fetch(`${localUrl}/api/nas/remove?path=readme.txt`, { method: 'DELETE' });
    expect(rm.status).toBe(401);
    // The file must still be there.
    expect(await fs.readFile(path.join(nasRoot, 'readme.txt'), 'utf8')).toBe('hello world');
  });
});

describe('NAS e2e — write side (loopback)', () => {
  it('mkdir creates a folder that appears in the listing', async () => {
    const { localUrl } = await start(false);
    const mk = await fetch(`${localUrl}/api/nas/mkdir?path=&name=${encodeURIComponent('新建文件夹')}`, {
      method: 'POST',
    });
    expect(mk.status).toBe(200);
    const list = await (await fetch(`${localUrl}/api/nas/list`)).json();
    expect(list.data.entries.map((e: { name: string }) => e.name)).toContain('新建文件夹');
    expect(await fs.stat(path.join(nasRoot, '新建文件夹')).then((s) => s.isDirectory())).toBe(true);
  });

  it('uploads a file into a sub-folder', async () => {
    const { localUrl } = await start(false);
    const up = await fetch(`${localUrl}/api/nas/upload?path=docs&name=note.txt`, {
      method: 'POST',
      body: 'body bytes',
    });
    expect(up.status).toBe(200);
    expect((await up.json()).data.relPath).toBe('docs/note.txt');
    expect(await fs.readFile(path.join(nasRoot, 'docs', 'note.txt'), 'utf8')).toBe('body bytes');
  });

  it('auto-renames on collision instead of overwriting', async () => {
    const { localUrl } = await start(false);
    const up = await fetch(`${localUrl}/api/nas/upload?path=&name=readme.txt`, { method: 'POST', body: 'NEW' });
    const rel = (await up.json()).data.relPath as string;
    expect(rel).not.toBe('readme.txt'); // original preserved
    expect(rel).toMatch(/readme \(1\)\.txt$/);
    expect(await fs.readFile(path.join(nasRoot, 'readme.txt'), 'utf8')).toBe('hello world'); // untouched
  });

  it('renames a file via move', async () => {
    const { localUrl } = await start(false);
    const mv = await fetch(`${localUrl}/api/nas/move?from=readme.txt&to=${encodeURIComponent('renamed.txt')}`, {
      method: 'POST',
    });
    expect(mv.status).toBe(200);
    expect(await exists(path.join(nasRoot, 'readme.txt'))).toBe(false);
    expect(await fs.readFile(path.join(nasRoot, 'renamed.txt'), 'utf8')).toBe('hello world');
  });

  it('soft-deletes to the recycle folder (recoverable, hidden from listing)', async () => {
    const { localUrl } = await start(false);
    const rm = await fetch(`${localUrl}/api/nas/remove?path=readme.txt`, { method: 'DELETE' });
    expect(rm.status).toBe(200);
    expect(await exists(path.join(nasRoot, 'readme.txt'))).toBe(false);
    // Gone from the listing (trash is a dotfile).
    const list = await (await fetch(`${localUrl}/api/nas/list`)).json();
    expect(list.data.entries.map((e: { name: string }) => e.name)).not.toContain('readme.txt');
    // But recoverable on disk inside .nas-trash.
    const trash = await fs.readdir(path.join(nasRoot, '.nas-trash'));
    expect(trash.some((n) => n.endsWith('__readme.txt'))).toBe(true);
  });

  it('refuses to write outside the root (containment)', async () => {
    const { localUrl } = await start(false);
    const up = await fetch(`${localUrl}/api/nas/upload?path=${encodeURIComponent('../..')}&name=evil.txt`, {
      method: 'POST',
      body: 'x',
    });
    expect(up.status).toBe(403);
    const mk = await fetch(`${localUrl}/api/nas/mkdir?path=${encodeURIComponent('../..')}&name=evil`, {
      method: 'POST',
    });
    expect(mk.status).toBe(403);
    const mv = await fetch(`${localUrl}/api/nas/move?from=readme.txt&to=${encodeURIComponent('../../escaped.txt')}`, {
      method: 'POST',
    });
    expect(mv.status).toBe(403);
    expect(await exists(path.join(nasRoot, 'readme.txt'))).toBe(true); // not moved out
  });

  it('refuses to delete the root itself or escape via traversal', async () => {
    const { localUrl } = await start(false);
    const rmRoot = await fetch(`${localUrl}/api/nas/remove?path=`, { method: 'DELETE' });
    expect(rmRoot.status).toBe(404);
    const rmEsc = await fetch(`${localUrl}/api/nas/remove?path=${encodeURIComponent('../OUTSIDE_SECRET.txt')}`, {
      method: 'DELETE',
    });
    expect(rmEsc.status).toBe(404);
    expect(await fs.readFile(outsideSecret, 'utf8')).toBe('TOP-SECRET-OUTSIDE-ROOT'); // untouched
  });
});

async function exists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
}
