import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startStaticServer, type StaticServerHandle } from './static-server.js';

// `connection: close` so fetch does not keep sockets alive — otherwise the
// TCP-splice server's close() would block on lingering keep-alive connections.
const NO_KEEPALIVE = { headers: { connection: 'close' } } as const;

// Full-path integration: prove /api/downloads/* is intercepted by static-server
// BEFORE the generic /api/* reverse-proxy to the backend.
describe('static-server + downloads (integration)', () => {
  let installerDir = '';
  let backend: http.Server;
  let backendHits = 0;
  let handle: StaticServerHandle;
  let base = '';

  beforeAll(async () => {
    installerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-int-'));
    await fs.writeFile(path.join(installerDir, 'CentaurAI-2.1.14-win-x64.exe'), Buffer.alloc(2048));
    await fs.writeFile(path.join(installerDir, 'CentaurAI-2.0.9-mac-arm64.dmg'), Buffer.alloc(1024));

    backend = http.createServer((_req, res) => {
      backendHits++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"proxied":true}');
    });
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', () => r()));
    const backendPort = (backend.address() as AddressInfo).port;

    const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-static-'));
    await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>x</title>');

    handle = await startStaticServer({ staticDir, backendPort, port: 0, allowRemote: false, installerDir });
    base = handle.localUrl;
  });

  afterAll(async () => {
    await handle.stop();
    await new Promise<void>((r) => backend.close(() => r()));
    await fs.rm(installerDir, { recursive: true, force: true });
  });

  it('serves /api/downloads/list locally (not proxied)', async () => {
    const res = await fetch(`${base}/api/downloads/list`, NO_KEEPALIVE);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(backendHits).toBe(0); // proves it was NOT forwarded to the backend
  });

  it('downloads a file via /api/downloads/get', async () => {
    const res = await fetch(`${base}/api/downloads/get?file=CentaurAI-2.1.14-win-x64.exe`, NO_KEEPALIVE);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('CentaurAI-2.1.14-win-x64.exe');
    expect(Buffer.from(await res.arrayBuffer())).toHaveLength(2048);
    expect(backendHits).toBe(0);
  });

  it('still proxies other /api/* to the backend', async () => {
    const res = await fetch(`${base}/api/whoami`, NO_KEEPALIVE);
    expect(res.status).toBe(200);
    expect((await res.json()).proxied).toBe(true);
    expect(backendHits).toBeGreaterThan(0); // confirms the proxy path still works
  });
});
