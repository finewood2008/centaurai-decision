/**
 * End-to-end proof of the WebUI auth gate: drives the real static server with a
 * stub backend and asserts that a LAN-exposed (allowRemote) deployment refuses
 * anonymous access to backend-bound surfaces, while loopback-only stays open.
 */
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startStaticServer, type StaticServerHandle } from '../../../packages/web-host/src/static-server.js';
import { GATE_COOKIE_NAME } from '../../../packages/web-host/src/webui-auth-gate.js';

type StubBackend = { port: number; close: () => Promise<void> };

function startStubBackend(): Promise<StubBackend> {
  const server = http.createServer((req, res) => {
    if (req.url === '/login' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=backendjwt; Path=/' });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    if (req.url?.startsWith('/api/assistants')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          data: [
            { id: 'centaurai-butler', name: 'Butler' },
            { id: 'normal-assistant', name: 'Normal' },
          ],
        })
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: [], path: req.url }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

/** Send a raw WS upgrade and resolve with whatever the server writes back. */
function rawWsProbe(port: number, cookie?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const lines = [
        'GET /ws HTTP/1.1',
        'Host: 127.0.0.1',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
      ];
      if (cookie) lines.push(`Cookie: ${cookie}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    let buf = '';
    socket.on('data', (d) => {
      buf += d.toString('latin1');
    });
    socket.on('close', () => resolve(buf));
    socket.on('error', reject);
    setTimeout(() => {
      socket.destroy();
      resolve(buf);
    }, 1000);
  });
}

function makeStaticDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
  return dir;
}

describe('static-server auth gate (allowRemote)', () => {
  let backend: StubBackend;
  let handle: StaticServerHandle;
  let base: string;

  beforeAll(async () => {
    backend = await startStubBackend();
    handle = await startStaticServer({
      staticDir: makeStaticDir('webui-gate-'),
      backendPort: backend.port,
      port: 0,
      allowRemote: true,
    });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.stop();
    await backend.close();
  });

  it('rejects unauthenticated /api/* with 401', async () => {
    const r = await fetch(`${base}/api/assistants`);
    expect(r.status).toBe(401);
  });

  it('allows the csrf-token bootstrap endpoint without a session', async () => {
    const r = await fetch(`${base}/api/auth/csrf-token`);
    expect(r.status).toBe(200);
  });

  it('mints a gate cookie on login, then authorizes /api/*', async () => {
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(login.status).toBe(200);

    const gateCookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0] ?? '')
      .find((c) => c.startsWith(`${GATE_COOKIE_NAME}=`));
    expect(gateCookie).toBeTruthy();

    const authed = await fetch(`${base}/api/assistants`, { headers: { cookie: gateCookie! } });
    expect(authed.status).toBe(200);
  });

  it('rejects a forged gate cookie with 401', async () => {
    const r = await fetch(`${base}/api/assistants`, { headers: { cookie: `${GATE_COOKIE_NAME}=forged.signature` } });
    expect(r.status).toBe(401);
  });

  it('rejects an unauthenticated /ws upgrade at the proxy', async () => {
    expect(await rawWsProbe(handle.port)).toContain('401');
  });
});

describe('static-server without allowRemote keeps loopback trust', () => {
  it('forwards /api/* without a session', async () => {
    const backend = await startStubBackend();
    const handle = await startStaticServer({
      staticDir: makeStaticDir('webui-nogate-'),
      backendPort: backend.port,
      port: 0,
      allowRemote: false,
    });
    try {
      const r = await fetch(`http://127.0.0.1:${handle.port}/api/assistants`);
      expect(r.status).toBe(200);
    } finally {
      await handle.stop();
      await backend.close();
    }
  });
});

describe('static-server hides desktop-only assistants from WebUI', () => {
  it('strips the butler from GET /api/assistants but keeps normal assistants', async () => {
    const backend = await startStubBackend();
    const handle = await startStaticServer({
      staticDir: makeStaticDir('webui-butler-'),
      backendPort: backend.port,
      port: 0,
      allowRemote: false,
    });
    try {
      const r = await fetch(`http://127.0.0.1:${handle.port}/api/assistants`);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { data: Array<{ id: string }> };
      const ids = body.data.map((a) => a.id);
      expect(ids).toContain('normal-assistant');
      expect(ids).not.toContain('centaurai-butler');
    } finally {
      await handle.stop();
      await backend.close();
    }
  });
});
