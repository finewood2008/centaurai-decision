import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startStaticServer, type StaticServerHandle } from './static-server.js';

async function mkRendererFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-static-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>root</title>');
  await fs.mkdir(path.join(dir, 'assets'));
  await fs.writeFile(path.join(dir, 'assets', 'main.js'), 'console.log("hi")');
  return dir;
}

async function startMockBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('static-server', () => {
  let handle: StaticServerHandle | null = null;
  let stopBackend: (() => Promise<void>) | null = null;
  let staticDir = '';

  beforeEach(async () => {
    staticDir = await mkRendererFixture();
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    if (stopBackend) {
      await stopBackend();
      stopBackend = null;
    }
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  it('serves static index.html at /', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('<title>root</title>');
  });

  it('SPA fallback: /chat/123 returns index.html', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/chat/123`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>root</title>');
  });

  it('static asset /assets/main.js served', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/assets/main.js`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('hi');
  });

  it('/api/* reverse-proxies to backend', async () => {
    const backend = await startMockBackend((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/anything`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { path: string };
    expect(json.path).toBe('/api/anything');
  });

  it('GET /api/providers strips API keys before returning provider metadata to WebUI clients', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/providers' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              {
                id: 'p1',
                name: 'Provider 1',
                api_key: 'sk-secret',
                nested: { apiKey: 'camel-secret' },
              },
              {
                id: 'p2',
                name: 'Provider 2',
                api_key: '',
              },
            ],
          })
        );
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/api/providers`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as {
      data: Array<{ api_key: string; has_api_key?: boolean; nested?: { apiKey: string; hasApiKey?: boolean } }>;
    };
    expect(json.data[0].api_key).toBe('');
    expect(json.data[0].has_api_key).toBe(true);
    expect(json.data[0].nested?.apiKey).toBe('');
    expect(json.data[0].nested?.hasApiKey).toBe(true);
    expect(json.data[1].api_key).toBe('');
    expect(json.data[1].has_api_key).toBe(false);
    expect(JSON.stringify(json)).not.toContain('sk-secret');
    expect(JSON.stringify(json)).not.toContain('camel-secret');
  });

  it('GET /api/providers/:id strips API keys before returning single provider metadata', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/providers/p1' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'p1', name: 'Provider 1', api_key: 'sk-single-secret' }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/api/providers/p1`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { api_key: string; has_api_key?: boolean };
    expect(json.api_key).toBe('');
    expect(json.has_api_key).toBe(true);
    expect(JSON.stringify(json)).not.toContain('sk-single-secret');
  });

  it('rejects WebUI provider writes as read-only', async () => {
    const backend = await startMockBackend((_req, res) => {
      res.writeHead(500).end('should not reach backend');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/api/providers/p1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'changed' }),
    });
    expect(r.status).toBe(403);
    const json = (await r.json()) as { error: string };
    expect(json.error).toBe('READ_ONLY');
  });

  it('/login reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/login' && req.method === 'POST') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'aionui-session=backend-token; Path=/; HttpOnly',
        });
        res.end(JSON.stringify({ success: true, proxied: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'anything' }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/aionui-session=backend-token/);
    const json = (await r.json()) as { proxied: boolean };
    expect(json.proxied).toBe(true);
  });

  it('/api/auth/user reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/user' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { username: 'from-backend', id: 'from-backend' } }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/api/auth/user`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { user: { username: string } };
    expect(json.user.username).toBe('from-backend');
  });

  it('LAN auth gate allows /api/auth/status before login', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/status' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ needs_setup: false }));
        return;
      }
      res.writeHead(500).end('should not reach fallback');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: true,
    });

    const r = await fetch(`${handle.localUrl}/api/auth/status`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ needs_setup: false });
  });

  it('/logout reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/logout' && req.method === 'POST') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'aionui-session=; Path=/; Max-Age=0',
        });
        res.end(JSON.stringify({ success: true, proxied: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/logout`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('/api proxy returns 502 when backend unreachable', async () => {
    // allocate a port then free it
    const placeholder = await startMockBackend((_req, res) => res.end());
    const freePort = placeholder.port;
    await placeholder.close();

    handle = await startStaticServer({ staticDir, backendPort: freePort, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/anything`);
    expect(r.status).toBe(502);
  });

  it('/ws WebSocket upgrade is spliced to backend and 101 is relayed', async () => {
    // Mock backend that accepts any WebSocket upgrade and replies with 101.
    // We don't run a real ws protocol — just verify the upgrade response makes
    // it back through the TCP-splice proxy. This is the exact regression path
    // that bun 1.3's http-compat upgrade handler broke.
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      // Send a single 0-length WS text frame as a liveness marker then close.
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    // Speak raw HTTP/1.1 upgrade over a TCP socket against the public listener.
    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /ws HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('network URL populated only when allowRemote=true', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    const h1 = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: false,
    });
    expect(h1.networkUrl).toBeUndefined();
    await h1.stop();

    const h2 = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: true,
    });
    // may still be undefined on CI machines without a LAN interface
    expect(typeof h2.networkUrl === 'string' || h2.networkUrl === undefined).toBe(true);
    await h2.stop();
  });

  it('POST /api/vector-search forwards to the configured vector DB endpoint', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;

    let seenSearchBody: unknown = null;
    const vectorDb = await startMockBackend((req, res) => {
      if (req.method === 'POST' && req.url === '/api/search') {
        const chunks: Buffer[] = [];
        req.on('data', (d) => chunks.push(d as Buffer));
        req.on('end', () => {
          seenSearchBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ results: [{ text: 'hit', metadata: { file_name: 'a.md' } }], total: 1 }));
        });
        return;
      }
      res.writeHead(404).end();
    });

    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/vector-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: `http://127.0.0.1:${vectorDb.port}`,
        query: 'hello',
        n_results: 3,
        mode: 'text',
      }),
    });
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.results).toHaveLength(1);
    expect(seenSearchBody).toEqual({ query: 'hello', n_results: 3, mode: 'text' });
    await vectorDb.close();
  });

  it('POST /api/vector-search rejects a non-http endpoint with 400', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/vector-search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'file:///etc/passwd', query: 'x' }),
    });
    expect(r.status).toBe(400);
  });

  it('self-heals a 0-byte index.html: LAN users still get the real page', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    // A healthy launch seeds the backup, then the file gets truncated to 0 bytes
    // (the exact failure that blank-screened LAN users).
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    await fetch(`${handle.localUrl}/`); // warm the guard's cache + .bak
    await fs.writeFile(path.join(staticDir, 'index.html'), '');

    const r = await fetch(`${handle.localUrl}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>root</title>');
    // The on-disk file was restored, not just the response.
    expect((await fs.readFile(path.join(staticDir, 'index.html'), 'utf8')).length).toBeGreaterThan(0);
  });

  it('serves a 503 recovery page when index.html is empty and no backup exists', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    // Empty entry, no .bak anywhere → unrecoverable, must not be a blank 200.
    await fs.writeFile(path.join(staticDir, 'index.html'), '');
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/`);
    expect(r.status).toBe(503);
    const text = await r.text();
    expect(text).toContain('正在恢复');
    expect(text.length).toBeGreaterThan(0);
  });
});
