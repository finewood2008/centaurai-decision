/**
 * CI-covered proof of the video workbench reverse proxy through the real static
 * server: /workbench/video/* is forwarded (full path, unchanged) to the host
 * opencut origin, cookies round-trip both ways (opencut owns its session),
 * hop-by-hop headers are stripped, and the auth gate fences it when LAN-exposed.
 * (Route A is also verified end-to-end against a real opencut + a real browser.)
 */
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startStaticServer, type StaticServerHandle } from '../../../packages/web-host/src/static-server.js';

type Stub = { port: number; close: () => Promise<void> };

function rawRequest(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string> }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

type Opencut = Stub & { hits: Array<{ url?: string; headers: http.IncomingHttpHeaders }> };

function startMockOpencut(): Promise<Opencut> {
  const hits: Opencut['hits'] = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'opencut_session=abc; Path=/workbench/video' });
    res.end(`<!doctype html>opencut ${req.url}`);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        hits,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    )
  );
}

const STATIC_DIR = mkdtempSync(join(tmpdir(), 'vidwb-it-'));
writeFileSync(join(STATIC_DIR, 'index.html'), '<!doctype html><title>main</title>');
afterAll(() => rmSync(STATIC_DIR, { recursive: true, force: true }));

describe('video workbench — reverse proxy to host opencut', () => {
  let opencut: Opencut;
  let handle: StaticServerHandle;
  let base: string;
  beforeAll(async () => {
    opencut = await startMockOpencut();
    handle = await startStaticServer({
      staticDir: STATIC_DIR,
      backendPort: 1,
      port: 0,
      allowRemote: false,
      videoUpstreamUrl: `http://localhost:${opencut.port}`,
    });
    base = `http://127.0.0.1:${handle.port}`;
  });
  afterAll(async () => {
    await handle.stop();
    await opencut.close();
  });

  it('forwards the FULL path (with the /workbench/video prefix) unchanged', async () => {
    const r = await fetch(`${base}/workbench/video/projects`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('opencut /workbench/video/projects');
    expect(opencut.hits.at(-1)!.url).toBe('/workbench/video/projects');
  });

  it('forwards cookies up and round-trips opencut set-cookie back down', async () => {
    const port = Number(new URL(base).port);
    const r = await rawRequest(port, '/workbench/video/editor/x', {
      headers: { cookie: 'webui_gate=secret; opencut_session=abc', connection: 'x-hop', 'x-hop': 'v' },
    });
    expect(r.status).toBe(200);
    const hit = opencut.hits.at(-1)!;
    // The WebUI auth token is stripped; opencut's own cookie passes through.
    expect(hit.headers.cookie).toBe('opencut_session=abc');
    expect(hit.headers.cookie).not.toContain('webui_gate');
    expect(hit.headers['x-hop']).toBeUndefined(); // hop-by-hop token dropped
    expect(String(r.headers['set-cookie'])).toContain('opencut_session=abc'); // set-cookie round-trips
  });
});

describe('video workbench — auth gate', () => {
  let opencut: Opencut;
  afterEach(async () => {
    if (opencut) await opencut.close();
  });
  it('blocks unauthenticated /workbench/video/* with 401 when LAN-exposed', async () => {
    opencut = await startMockOpencut();
    const handle = await startStaticServer({
      staticDir: STATIC_DIR,
      backendPort: 1,
      port: 0,
      allowRemote: true,
      videoUpstreamUrl: `http://localhost:${opencut.port}`,
    });
    try {
      expect((await fetch(`http://127.0.0.1:${handle.port}/workbench/video/projects`)).status).toBe(401);
      expect(opencut.hits.length).toBe(0); // never reached the upstream
    } finally {
      await handle.stop();
    }
  });
});
