/**
 * CI-covered proof of the LAN image workbench surface driven through the real
 * static server: the SPA is served at /workbench/image/*, the upstream proxy
 * injects the server key + strips the session cookie + hop-by-hop headers, and
 * the auth gate fences both when (and only when) the WebUI is LAN-exposed.
 *
 * (Lives under tests/integration so root `vitest run` — and thus CI — executes
 * it; packages/web-host/src/*.unit.test.ts run only via the web-host package.)
 */
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startStaticServer, type StaticServerHandle } from '../../../packages/web-host/src/static-server.js';
import { GATE_COOKIE_NAME } from '../../../packages/web-host/src/webui-auth-gate.js';

type Stub = { port: number; close: () => Promise<void> };

/** Raw http.request client — fetch (undici) forbids setting hop-by-hop headers like Connection/Transfer-Encoding. */
function rawRequest(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function startStubBackend(): Promise<Stub> {
  const server = http.createServer((req, res) => {
    if (req.url === '/login' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: [] }));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    )
  );
}

type Upstream = Stub & { hits: Array<{ url?: string; headers: http.IncomingHttpHeaders; body: string }> };

function startMockUpstream(): Promise<Upstream> {
  const hits: Upstream['hits'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hits.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf-8') });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echo: req.url }));
    });
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

function makeSpaDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'imgwb-it-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>img</title><script src="./assets/app.js"></script>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

const SPA_DIR = makeSpaDir();
const STATIC_DIR = makeSpaDir();
afterAll(() => {
  rmSync(SPA_DIR, { recursive: true, force: true });
  rmSync(STATIC_DIR, { recursive: true, force: true });
});

describe('image workbench — loopback (allowRemote=false) keeps the workbench open', () => {
  let backend: Stub;
  let handle: StaticServerHandle;
  let base: string;
  beforeAll(async () => {
    backend = await startStubBackend();
    handle = await startStaticServer({
      staticDir: STATIC_DIR,
      backendPort: backend.port,
      port: 0,
      allowRemote: false,
      imageWorkbenchDir: SPA_DIR,
    });
    base = `http://127.0.0.1:${handle.port}`;
  });
  afterAll(async () => {
    await handle.stop();
    await backend.close();
  });

  it('serves the SPA entry with no session', async () => {
    const r = await fetch(`${base}/workbench/image/index.html`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
  });
  it('serves a SPA asset', async () => {
    const r = await fetch(`${base}/workbench/image/assets/app.js`);
    expect(r.status).toBe(200);
  });
  it('blocks traversal out of the dist dir', async () => {
    const r = await fetch(`${base}/workbench/image/..%2f..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(r.status);
    expect(await r.text()).not.toContain('root:');
  });
});

describe('image workbench — LAN-exposed (allowRemote=true) requires login', () => {
  let backend: Stub;
  let handle: StaticServerHandle;
  let base: string;
  beforeAll(async () => {
    backend = await startStubBackend();
    handle = await startStaticServer({
      staticDir: STATIC_DIR,
      backendPort: backend.port,
      port: 0,
      allowRemote: true,
      imageWorkbenchDir: SPA_DIR,
      imageKey: 'K',
    });
    base = `http://127.0.0.1:${handle.port}`;
  });
  afterAll(async () => {
    await handle.stop();
    await backend.close();
  });

  it('rejects the unauthenticated SPA and proxy with 401', async () => {
    expect((await fetch(`${base}/workbench/image/index.html`)).status).toBe(401);
    expect((await fetch(`${base}/workbench/image/__proxy/v1/models`)).status).toBe(401);
  });

  it('serves the SPA after login mints a gate cookie', async () => {
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0] ?? '')
      .find((c) => c.startsWith(`${GATE_COOKIE_NAME}=`));
    expect(cookie).toBeTruthy();
    const r = await fetch(`${base}/workbench/image/index.html`, { headers: { cookie: cookie! } });
    expect(r.status).toBe(200);
  });
});

describe('image workbench — upstream proxy (key injection, cookie & hop-by-hop stripping)', () => {
  let backend: Stub;
  let upstream: Upstream;
  const prev = process.env.AIONUI_IMAGE_UPSTREAM_URL;
  afterEach(async () => {
    if (prev === undefined) delete process.env.AIONUI_IMAGE_UPSTREAM_URL;
    else process.env.AIONUI_IMAGE_UPSTREAM_URL = prev;
  });

  async function withServer(imageKey: string | undefined, fn: (base: string) => Promise<void>) {
    backend = await startStubBackend();
    upstream = await startMockUpstream();
    process.env.AIONUI_IMAGE_UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
    const handle = await startStaticServer({
      staticDir: STATIC_DIR,
      backendPort: backend.port,
      port: 0,
      allowRemote: false,
      imageWorkbenchDir: SPA_DIR,
      imageKey,
    });
    try {
      await fn(`http://127.0.0.1:${handle.port}`);
    } finally {
      await handle.stop();
      await upstream.close();
      await backend.close();
    }
  }

  it('injects the server key, strips cookie + hop-by-hop headers, forwards path & body', async () => {
    await withServer('SERVER_KEY', async (base) => {
      const port = Number(new URL(base).port);
      const r = await rawRequest(port, '/workbench/image/__proxy/v1/images/generations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer CLIENT',
          cookie: 'webui_gate=secret',
          connection: 'x-smuggle',
          'x-smuggle': 'v',
        },
        body: JSON.stringify({ prompt: 'cat' }),
      });
      expect(r.status).toBe(200);
      const hit = upstream.hits.find((h) => h.url === '/v1/images/generations')!;
      expect(hit.headers.authorization).toBe('Bearer SERVER_KEY'); // client key overridden
      expect(hit.headers.cookie).toBeUndefined(); // session cookie not leaked
      // hop-by-hop: the token listed in the client's Connection header is dropped,
      // and the client's Connection value is not forwarded verbatim.
      expect(hit.headers['x-smuggle']).toBeUndefined();
      expect(hit.headers.connection).not.toBe('x-smuggle');
      expect(hit.body).toBe(JSON.stringify({ prompt: 'cat' }));
    });
  });

  it('passes the client Authorization through when no server key is set', async () => {
    await withServer(undefined, async (base) => {
      await fetch(`${base}/workbench/image/__proxy/v1/models`, {
        headers: { authorization: 'Bearer CLIENT', cookie: 'webui_gate=secret' },
      });
      const hit = upstream.hits.find((h) => h.url === '/v1/models')!;
      expect(hit.headers.authorization).toBe('Bearer CLIENT');
      expect(hit.headers.cookie).toBeUndefined();
    });
  });
});
