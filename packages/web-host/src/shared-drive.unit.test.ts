import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  handleSharedCategories,
  handleSharedDownload,
  handleSharedList,
  handleSharedPreview,
  handleSharedRemove,
  handleSharedUpload,
  type SharedFile,
} from './shared-drive.js';

/**
 * Spin up a real http server routing /api/shared-drive/* through the handlers,
 * so pipe()/stream behavior and the manifest mutex run against genuine I/O.
 */
async function startServer(dir: string | undefined): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/api/shared-drive/list')) void handleSharedList(req, res, dir);
    else if (url.startsWith('/api/shared-drive/categories')) void handleSharedCategories(res, dir);
    else if (url.startsWith('/api/shared-drive/upload')) void handleSharedUpload(req, res, dir);
    else if (url.startsWith('/api/shared-drive/download')) void handleSharedDownload(req, res, dir);
    else if (url.startsWith('/api/shared-drive/preview')) void handleSharedPreview(req, res, dir);
    else if (url.startsWith('/api/shared-drive/remove')) void handleSharedRemove(req, res, dir);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function upload(port: number, name: string, body: string, category?: string): Promise<Response> {
  const params = new URLSearchParams({ name });
  if (category != null) params.set('category', category);
  return fetch(`http://127.0.0.1:${port}/api/shared-drive/upload?${params.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  });
}

async function list(port: number, category?: string): Promise<SharedFile[]> {
  const q = category != null ? `?category=${encodeURIComponent(category)}` : '';
  const resp = await fetch(`http://127.0.0.1:${port}/api/shared-drive/list${q}`);
  return (await resp.json()).data as SharedFile[];
}

describe('shared-drive endpoints', () => {
  let dir: string | null = null;
  let srv: { port: number; close: () => Promise<void> } | null = null;
  afterEach(async () => {
    if (srv) await srv.close();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    srv = null;
    dir = null;
  });

  it('list returns [] when the shared dir is unset', async () => {
    srv = await startServer(undefined);
    expect(await list(srv.port)).toEqual([]);
  });

  it('uploads a file, lists it, and downloads the same bytes', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-shared-'));
    srv = await startServer(dir);

    const up = await upload(srv.port, 'report.pdf', 'hello world', 'marketing');
    expect(up.status).toBe(200);
    const { id } = (await up.json()).data as { id: string };
    expect(id).toBeTruthy();

    const files = await list(srv.port);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ name: 'report.pdf', category: 'marketing', size: 11 });

    const dl = await fetch(`http://127.0.0.1:${srv.port}/api/shared-drive/download?id=${id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toContain('report.pdf');
    expect(await dl.text()).toBe('hello world');
  });

  it('preview serves the mime type inline', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-shared-'));
    srv = await startServer(dir);
    const up = await upload(srv.port, 'pic.png', 'PNGDATA');
    const { id } = (await up.json()).data as { id: string };
    const prev = await fetch(`http://127.0.0.1:${srv.port}/api/shared-drive/preview?id=${id}`);
    expect(prev.headers.get('content-type')).toBe('image/png');
    expect(prev.headers.get('content-disposition')).toContain('inline');
  });

  it('keeps colliding display names as distinct blobs', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-shared-'));
    srv = await startServer(dir);
    await upload(srv.port, 'same.txt', 'A');
    await upload(srv.port, 'same.txt', 'BB');
    const files = await list(srv.port);
    expect(files).toHaveLength(2);
    expect(new Set(files.map((f) => f.id)).size).toBe(2);
    expect(new Set(files.map((f) => f.relPath)).size).toBe(2);
  });

  it('filters by category and reports category counts', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-shared-'));
    srv = await startServer(dir);
    await upload(srv.port, 'a.txt', 'a', 'sales');
    await upload(srv.port, 'b.txt', 'b', 'sales');
    await upload(srv.port, 'c.txt', 'c', 'ops');

    expect(await list(srv.port, 'sales')).toHaveLength(2);
    expect(await list(srv.port, 'ops')).toHaveLength(1);

    const cats = (await (await fetch(`http://127.0.0.1:${srv.port}/api/shared-drive/categories`)).json()).data as Array<{
      key: string;
      count: number;
    }>;
    expect(cats.find((c) => c.key === 'sales')?.count).toBe(2);
    expect(cats.find((c) => c.key === 'ops')?.count).toBe(1);
  });

  it('serializes concurrent uploads without losing manifest entries', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-shared-'));
    srv = await startServer(dir);
    await Promise.all(Array.from({ length: 12 }, (_, i) => upload(srv!.port, `f${i}.txt`, String(i))));
    expect(await list(srv.port)).toHaveLength(12);
  });

  it('download rejects an unknown id with 404', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-shared-'));
    srv = await startServer(dir);
    const resp = await fetch(`http://127.0.0.1:${srv.port}/api/shared-drive/download?id=does-not-exist`);
    expect(resp.status).toBe(404);
  });

  it('removes a file and its blob', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-shared-'));
    srv = await startServer(dir);
    const up = await upload(srv.port, 'gone.txt', 'x');
    const { id } = (await up.json()).data as { id: string };

    const del = await fetch(`http://127.0.0.1:${srv.port}/api/shared-drive/remove?id=${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(await list(srv.port)).toHaveLength(0);
    const dl = await fetch(`http://127.0.0.1:${srv.port}/api/shared-drive/download?id=${id}`);
    expect(dl.status).toBe(404);
  });
});
