import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startStaticServer, type StaticServerHandle } from './static-server.js';

const NO_KEEPALIVE = { headers: { connection: 'close' } } as const;

// Full-path integration: prove /api/shared-drive/* is intercepted by the
// static-server (TCP peek + splice → internal HTTP server) and that a real
// streamed POST body is consumed correctly.
describe('static-server + shared-drive (integration)', () => {
  let sharedDriveDir = '';
  let backend: http.Server;
  let handle: StaticServerHandle;
  let base = '';

  beforeAll(async () => {
    sharedDriveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-sd-int-'));
    backend = http.createServer((_req, res) => res.end('{"proxied":true}'));
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', () => r()));
    const backendPort = (backend.address() as AddressInfo).port;
    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-sd-static-'));
    await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>x</title>');
    handle = await startStaticServer({ staticDir, backendPort, port: 0, allowRemote: false, sharedDriveDir });
    base = handle.localUrl;
  });

  afterAll(async () => {
    await handle.stop();
    await new Promise<void>((r) => backend.close(() => r()));
    await fs.rm(sharedDriveDir, { recursive: true, force: true });
  });

  it('uploads a large body through the splice and lists it', async () => {
    const body = Buffer.alloc(300_000, 7); // 300KB — multi-chunk streamed body
    const up = await fetch(`${base}/api/shared-drive/upload?name=big.bin&category=t`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', connection: 'close' },
      body,
    });
    expect(up.status).toBe(200);
    const { id } = (await up.json()).data as { id: string };

    const list = await fetch(`${base}/api/shared-drive/list`, NO_KEEPALIVE);
    const files = (await list.json()).data as Array<{ id: string; size: number }>;
    expect(files).toHaveLength(1);
    expect(files[0].size).toBe(300_000);

    const dl = await fetch(`${base}/api/shared-drive/download?id=${id}`, NO_KEEPALIVE);
    expect(Buffer.from(await dl.arrayBuffer())).toHaveLength(300_000);
  });
});
