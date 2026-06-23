import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  handleNasDownload,
  handleNasList,
  handleNasPreview,
  resolveWithinRoot,
  nasRemove,
  nasTrashList,
  nasTrashRestore,
  nasTrashRemove,
  nasTrashEmpty,
  nasWalk,
  type NasListing,
} from './nas-drive.js';

/**
 * Spin up a real http server routing /api/nas/* through the handlers so the
 * stream / Range behaviour runs against genuine file I/O.
 */
async function startServer(root: string | undefined): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/api/nas/list')) void handleNasList(req, res, root);
    else if (url.startsWith('/api/nas/download')) void handleNasDownload(req, res, root);
    else if (url.startsWith('/api/nas/preview')) void handleNasPreview(req, res, root);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

async function makeRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-test-'));
  await fs.mkdir(path.join(dir, 'marketing'), { recursive: true });
  await fs.writeFile(path.join(dir, 'readme.txt'), 'hello world');
  await fs.writeFile(path.join(dir, '.secret'), 'hidden');
  await fs.writeFile(path.join(dir, 'marketing', 'plan.md'), '# Q3\nplan body');
  return dir;
}

const servers: Array<() => Promise<void>> = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((c) => c()));
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

async function withServer(root: string | undefined): Promise<number> {
  const srv = await startServer(root);
  servers.push(srv.close);
  return srv.port;
}

async function listAt(port: number, p?: string): Promise<NasListing> {
  const q = p != null ? `?path=${encodeURIComponent(p)}` : '';
  const resp = await fetch(`http://127.0.0.1:${port}/api/nas/list${q}`);
  return (await resp.json()).data as NasListing;
}

describe('resolveWithinRoot (path containment)', () => {
  it('resolves a normal sub-path inside root', () => {
    expect(resolveWithinRoot('/srv/nas', 'a/b.txt')).toBe(path.resolve('/srv/nas/a/b.txt'));
  });
  it('rejects parent traversal', () => {
    expect(resolveWithinRoot('/srv/nas', '../etc/passwd')).toBeNull();
    expect(resolveWithinRoot('/srv/nas', 'a/../../b')).toBeNull();
  });
  it('treats a leading slash as relative to root, not OS root', () => {
    expect(resolveWithinRoot('/srv/nas', '/etc/passwd')).toBe(path.resolve('/srv/nas/etc/passwd'));
  });
  it('maps empty path to root itself', () => {
    expect(resolveWithinRoot('/srv/nas', '')).toBe(path.resolve('/srv/nas'));
  });
});

describe('/api/nas/list', () => {
  it('lists the root: dirs before files, hidden entries skipped', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    const listing = await listAt(port);
    expect(listing.path).toBe('');
    const names = listing.entries.map((e) => e.name);
    expect(names).toEqual(['marketing', 'readme.txt']); // dir first, no .secret
    expect(listing.entries[0].isDir).toBe(true);
    expect(listing.entries[1].size).toBe('hello world'.length);
  });

  it('lists a sub-directory with POSIX relPath', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    const listing = await listAt(port, 'marketing');
    expect(listing.path).toBe('marketing');
    expect(listing.entries.map((e) => e.relPath)).toEqual(['marketing/plan.md']);
  });

  it('returns 403 on traversal', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    const resp = await fetch(`http://127.0.0.1:${port}/api/nas/list?path=${encodeURIComponent('../..')}`);
    expect(resp.status).toBe(403);
  });

  it('reports disabled when no root is configured', async () => {
    const port = await withServer(undefined);
    const resp = await fetch(`http://127.0.0.1:${port}/api/nas/list`);
    const body = await resp.json();
    expect(body.disabled).toBe(true);
    expect(body.data.entries).toEqual([]);
  });
});

describe('/api/nas/download & preview', () => {
  it('downloads a file as an attachment', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    const resp = await fetch(`http://127.0.0.1:${port}/api/nas/download?path=readme.txt`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-disposition')).toContain('attachment');
    expect(await resp.text()).toBe('hello world');
  });

  it('previews a markdown file inline with its mime', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    const resp = await fetch(`http://127.0.0.1:${port}/api/nas/preview?path=marketing/plan.md`);
    expect(resp.headers.get('content-disposition')).toContain('inline');
    expect(resp.headers.get('content-type')).toContain('text/markdown');
  });

  it('serves a byte range as 206 with the right slice', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    const resp = await fetch(`http://127.0.0.1:${port}/api/nas/download?path=readme.txt`, {
      headers: { Range: 'bytes=0-4' },
    });
    expect(resp.status).toBe(206);
    expect(resp.headers.get('content-range')).toBe(`bytes 0-4/${'hello world'.length}`);
    expect(resp.headers.get('content-length')).toBe('5');
    expect(await resp.text()).toBe('hello');
  });

  it('serves a suffix range (last N bytes)', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    const resp = await fetch(`http://127.0.0.1:${port}/api/nas/download?path=readme.txt`, {
      headers: { Range: 'bytes=-5' },
    });
    expect(resp.status).toBe(206);
    expect(await resp.text()).toBe('world');
  });

  it('404s a missing file and a directory', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    expect((await fetch(`http://127.0.0.1:${port}/api/nas/download?path=nope.txt`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/api/nas/download?path=marketing`)).status).toBe(404);
  });

  it('404s a traversal attempt on download', async () => {
    const root = await makeRoot();
    roots.push(root);
    const port = await withServer(root);
    const resp = await fetch(`http://127.0.0.1:${port}/api/nas/download?path=${encodeURIComponent('../../etc/hosts')}`);
    expect(resp.status).toBe(404);
  });
});

describe('NAS recycle-bin management (admin core)', () => {
  it('lists, restores, purges, and empties the recycle folder', async () => {
    const root = await makeRoot();
    roots.push(root);
    // Soft-delete two files.
    await fs.writeFile(path.join(root, 'a.txt'), 'A');
    await fs.writeFile(path.join(root, 'b.txt'), 'B');
    expect(await nasRemove(root, 'a.txt')).toBe(true);
    expect(await nasRemove(root, 'b.txt')).toBe(true);

    let trash = await nasTrashList(root);
    expect(trash.map((e) => e.originalName).sort()).toEqual(['a.txt', 'b.txt']);
    expect(trash.every((e) => e.deletedAt > 0)).toBe(true);

    // Restore a.txt → reappears in the root.
    const a = trash.find((e) => e.originalName === 'a.txt')!;
    const rel = await nasTrashRestore(root, a.trashName);
    expect(rel).toBe('a.txt');
    expect(await fs.readFile(path.join(root, 'a.txt'), 'utf8')).toBe('A');

    // Purge b.txt permanently.
    const b = (await nasTrashList(root)).find((e) => e.originalName === 'b.txt')!;
    expect(await nasTrashRemove(root, b.trashName)).toBe(true);
    expect(await nasTrashList(root)).toHaveLength(0);

    // Empty is a no-op on an already-empty bin.
    expect(await nasTrashEmpty(root)).toBe(true);
  });

  it('restore auto-renames when the original name is taken', async () => {
    const root = await makeRoot();
    roots.push(root);
    await fs.writeFile(path.join(root, 'dup.txt'), 'old');
    await nasRemove(root, 'dup.txt');
    await fs.writeFile(path.join(root, 'dup.txt'), 'new'); // recreate same name
    const t = (await nasTrashList(root))[0];
    const rel = await nasTrashRestore(root, t.trashName);
    expect(rel).not.toBe('dup.txt'); // current file preserved
    expect(await fs.readFile(path.join(root, 'dup.txt'), 'utf8')).toBe('new');
  });

  it('rejects trash names that try to escape the recycle folder', async () => {
    const root = await makeRoot();
    roots.push(root);
    await fs.writeFile(path.join(root, 'victim.txt'), 'V');
    expect(await nasTrashRestore(root, '../victim.txt')).toBeNull();
    expect(await nasTrashRemove(root, '../victim.txt')).toBe(false);
    expect(await nasTrashRemove(root, 'sub/x')).toBe(false);
    expect(await fs.readFile(path.join(root, 'victim.txt'), 'utf8')).toBe('V'); // untouched
  });
});

describe('nasWalk (knowledge-base indexing enumeration)', () => {
  it('recurses, filters to indexable types, skips dotfiles and videos by default', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-walk-'));
    roots.push(root);
    await fs.mkdir(path.join(root, 'docs/sub'), { recursive: true });
    await fs.mkdir(path.join(root, '.nas-trash'), { recursive: true });
    await fs.writeFile(path.join(root, 'a.md'), '# a');
    await fs.writeFile(path.join(root, 'notes.txt'), 'n');
    await fs.writeFile(path.join(root, 'pic.png'), 'p');
    await fs.writeFile(path.join(root, 'ignore.log'), 'x'); // unsupported ext
    await fs.writeFile(path.join(root, 'docs/sub/deep.pdf'), 'd');
    await fs.writeFile(path.join(root, 'clip.mp4'), 'v'); // video
    await fs.writeFile(path.join(root, '.nas-trash', 'gone.md'), 'trashed'); // must be skipped

    const noVideo = await nasWalk(root, '');
    const rels = noVideo.map((f) => f.relPath).sort();
    expect(rels).toEqual(['a.md', 'docs/sub/deep.pdf', 'notes.txt', 'pic.png']);
    expect(rels).not.toContain('ignore.log');
    expect(rels.some((r) => r.includes('.nas-trash'))).toBe(false);

    const withVideo = await nasWalk(root, '', { includeVideo: true });
    expect(withVideo.map((f) => f.relPath)).toContain('clip.mp4');
  });

  it('throws on a traversal path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nas-walk2-'));
    roots.push(root);
    await expect(nasWalk(root, '../..')).rejects.toThrow();
  });
});
