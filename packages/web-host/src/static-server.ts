/**
 * WebUI static server.
 *
 * Serves out/renderer/ as the SPA and reverse-proxies /api/*, /ws, /login and
 * /logout to aioncore. /login and /logout are aionui-auth's top-level paths,
 * the rest live under /api/auth/*.
 *
 * Credential verification lives in the backend's aionui-auth crate, but that
 * backend runs in --local mode (no per-request auth on protected /api/* routes),
 * so a LAN-exposed (allowRemote) proxy MUST gate backend access itself — see
 * webui-auth-gate.ts. Loopback-only deployments keep the backend's trust model.
 *
 * Design: Node native http + serve-handler. No Express. No business routes.
 */

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import serveHandler from 'serve-handler';
import { handleDownloadGet, handleDownloadsList } from './downloads.js';
import {
  handleSharedCategories,
  handleSharedDownload,
  handleSharedList,
  handleSharedPreview,
  handleSharedRemove,
  handleSharedUpload,
} from './shared-drive.js';
import { type AuthGate, createAuthGate } from './webui-auth-gate.js';

export type StaticServerOptions = {
  staticDir: string;
  backendPort: number;
  port?: number;
  allowRemote?: boolean;
  /**
   * Directory holding bundled native client installers, served at
   * /api/downloads/*. Omit to disable the download endpoints (list returns []).
   */
  installerDir?: string;
  /**
   * Directory hosting the enterprise LAN shared library, served at
   * /api/shared-drive/*. Omit to disable sharing (list returns []).
   */
  sharedDriveDir?: string;
};

export type StaticServerHandle = {
  port: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};

const DEFAULT_PORT = 25808;

/**
 * Assistant ids that are desktop/admin-only and must not be exposed to WebUI
 * browser clients. The CentaurAI 管家 (butler) can mutate global config via its
 * config skill, so — like admin model management — it is hidden from the WebUI,
 * preserving the "admin manages, WebUI users read-only" split. Desktop talks to
 * the backend directly (not through this proxy), so it still sees the butler.
 */
const ADMIN_ONLY_ASSISTANT_IDS = new Set<string>(['centaurai-butler']);

function getLanIP(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function forwardToBackend(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

/**
 * Proxy `POST /login` to the backend and, on a 2xx response, mint the gate
 * session cookie alongside whatever the backend set. The backend's login
 * handler verifies the WebUI password even under `--local`, so a non-2xx means
 * bad credentials and we mint nothing.
 */
function proxyLoginWithGate(req: IncomingMessage, res: ServerResponse, gate: AuthGate, backendPort: number): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
  };
  const proxy = http.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    const status = proxyRes.statusCode ?? 502;
    if (status >= 200 && status < 300) {
      const existing = headers['set-cookie'];
      const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
      headers['set-cookie'] = [...list, gate.mintCookie()];
    }
    res.writeHead(status, headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

/**
 * Enforce the WebUI auth gate for LAN-exposed deployments. Returns true when the
 * response was fully handled (the caller must then stop processing the request).
 *
 * Reachable without a session: `POST /login` (mints a session on success),
 * `GET /api/auth/csrf-token` (needed before logging in) and `/api/downloads/*`
 * (public client installers). Everything else under `/api/*` requires a valid
 * session; `/logout` additionally clears it. Static assets are never gated, so
 * the login page itself always loads.
 */
function enforceGate(req: IncomingMessage, res: ServerResponse, gate: AuthGate, backendPort: number): boolean {
  const path = (req.url ?? '').split('?')[0] ?? '';

  if (req.method === 'POST' && path === '/login') {
    proxyLoginWithGate(req, res, gate, backendPort);
    return true;
  }
  if (path === '/logout' || path === '/api/auth/logout') {
    res.setHeader('Set-Cookie', gate.clearCookie());
    forwardToBackend(req, res, backendPort);
    return true;
  }
  // Bootstrap endpoints reachable before a session exists.
  if (req.method === 'GET' && path === '/api/auth/csrf-token') return false;
  if (path.startsWith('/api/downloads/')) return false;

  const isApi = path === '/api' || path.startsWith('/api/');
  if (isApi && !gate.isAuthorized(req.headers.cookie)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'UNAUTHENTICATED' }));
    return true;
  }
  return false;
}

/**
 * Read a single header value (case-insensitive) from a raw HTTP request head.
 * Used by the WS-upgrade path, which splices raw TCP and never builds an
 * `IncomingMessage`.
 */
function rawHeader(head: Buffer, name: string): string | undefined {
  const text = head.toString('latin1');
  const end = text.indexOf('\r\n\r\n');
  const headerBlock = end >= 0 ? text.slice(0, end) : text;
  const lower = name.toLowerCase();
  for (const line of headerBlock.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() === lower) return line.slice(colon + 1).trim();
  }
  return undefined;
}

/**
 * Proxy `GET /api/assistants` but strip desktop/admin-only assistants
 * ({@link ADMIN_ONLY_ASSISTANT_IDS}) from the JSON before returning it to a
 * WebUI client. Accept-encoding is forced to identity so the body is plain JSON
 * to rewrite; on any non-JSON/parse failure the original bytes pass through.
 */
function proxyAssistantsFiltered(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${backendPort}`, 'accept-encoding': 'identity' },
  };
  const proxy = http.request(options, (proxyRes) => {
    const chunks: Buffer[] = [];
    proxyRes.on('data', (c: Buffer) => chunks.push(c));
    proxyRes.on('end', () => {
      const status = proxyRes.statusCode ?? 502;
      const headers = { ...proxyRes.headers };
      // We send a fixed buffer with our own Content-Length, so drop any framing
      // headers from the upstream response (chunked + length can't coexist).
      delete headers['content-length'];
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];
      let body = Buffer.concat(chunks);
      if (status >= 200 && status < 300) {
        try {
          const json = JSON.parse(body.toString('utf-8')) as { data?: unknown };
          const keep = (a: unknown): boolean => !ADMIN_ONLY_ASSISTANT_IDS.has((a as { id?: string })?.id ?? '');
          const data = json.data as unknown;
          if (Array.isArray(data)) {
            json.data = data.filter(keep);
          } else if (data && Array.isArray((data as { items?: unknown[] }).items)) {
            (data as { items: unknown[] }).items = (data as { items: unknown[] }).items.filter(keep);
          }
          body = Buffer.from(JSON.stringify(json), 'utf-8');
        } catch {
          // Non-JSON or unexpected shape — pass the original bytes through.
        }
      }
      res.writeHead(status, { ...headers, 'content-length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Search queries are tiny; cap the body so a stray large POST can't buffer unbounded.
    if (size > 256 * 1024) throw new Error('vector-search body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/**
 * Proxy a knowledge-base search to the local vector DB on behalf of a WebUI
 * browser client. The renderer cannot reach the vector DB itself: it binds
 * loopback on the *server* host, so a LAN client's `127.0.0.1:8618` points at
 * the wrong machine. The server runs co-located with the vector DB and can
 * reach it, so the browser POSTs here and we forward the search. The client
 * supplies the endpoint it has configured (default http://127.0.0.1:8618);
 * only http/https URLs are honored.
 */
async function handleVectorSearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sendJson = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const body = await readJsonBody(req);
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim().replace(/\/+$/, '') : '';
    const query = typeof body.query === 'string' ? body.query : '';
    if (!/^https?:\/\//i.test(endpoint)) {
      sendJson(400, { error: 'INVALID_ENDPOINT' });
      return;
    }
    if (!query.trim()) {
      sendJson(400, { error: 'EMPTY_QUERY' });
      return;
    }
    const nResults = typeof body.n_results === 'number' && body.n_results > 0 ? body.n_results : 5;
    const mode = body.mode === 'visual' || body.mode === 'hybrid' ? body.mode : 'text';

    const upstream = await fetch(`${endpoint}/api/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, n_results: nResults, mode }),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(text);
  } catch {
    sendJson(502, { error: 'VECTOR_DB_UNREACHABLE' });
  }
}

/** Proxy a read-only knowledge-base document list to the local vector DB. */
async function handleVectorDocuments(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sendJson = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const body = await readJsonBody(req);
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim().replace(/\/+$/, '') : '';
    if (!/^https?:\/\//i.test(endpoint)) {
      sendJson(400, { error: 'INVALID_ENDPOINT' });
      return;
    }
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 500) : 300;
    const offset = typeof body.offset === 'number' && body.offset >= 0 ? body.offset : 0;
    const upstream = await fetch(`${endpoint}/api/documents?limit=${limit}&offset=${offset}`);
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(text);
  } catch {
    sendJson(502, { error: 'VECTOR_DB_UNREACHABLE' });
  }
}

/** Proxy a knowledge-base image thumbnail to the local vector DB's /api/image. */
async function handleVectorImage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const endpoint = (url.searchParams.get('endpoint') || '').trim().replace(/\/+$/, '');
    const path = url.searchParams.get('path') || '';
    if (!/^https?:\/\//i.test(endpoint) || !path) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'INVALID_REQUEST' }));
      return;
    }
    const upstream = await fetch(`${endpoint}/api/image?path=${encodeURIComponent(path)}`);
    if (!upstream.ok || !upstream.body) {
      res.writeHead(upstream.status || 502).end();
      return;
    }
    res.writeHead(200, { 'content-type': upstream.headers.get('content-type') || 'application/octet-stream' });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'VECTOR_DB_UNREACHABLE' }));
  }
}

// Max bytes we peek before forcing a routing decision. An HTTP request-line
// on its own is typically < 100 bytes; a full header block is < 2 KB. If we
// haven't seen a newline after 4 KB the client is sending something weird —
// hand it to the internal HTTP server and let it return 400.
const PEEK_LIMIT_BYTES = 4096;

/**
 * Splice `client` to a TCP endpoint on `targetPort`. Any bytes already read
 * from `client` during peek are replayed to the upstream as the first write,
 * so the endpoint sees the full HTTP request as-sent.
 */
function spliceToTcpEndpoint(client: Socket, targetPort: number, initialBytes: Buffer): void {
  client.setNoDelay(true);
  client.setKeepAlive(true);
  client.setTimeout(0);
  // Pause synchronously: the peek loop just removed its 'data' listener, so
  // without this any body bytes arriving before `connect` (below) fires would
  // be emitted to no consumer and lost. Pausing buffers them in the socket;
  // `client.pipe(upstream)` resumes delivery once upstream is ready. Only large
  // POST bodies (split across TCP reads) hit this — small ones fit in the peek.
  client.pause();
  const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true);
  upstream.once('connect', () => {
    if (initialBytes.length > 0) upstream.write(initialBytes);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const tearDown = (): void => {
    client.destroy();
    upstream.destroy();
  };
  upstream.on('error', tearDown);
  client.on('error', tearDown);
  upstream.on('close', tearDown);
  client.on('close', tearDown);
}

/**
 * Decide routing from the first chunk of an incoming HTTP connection:
 *  - `true`  → `GET /ws[...] HTTP/1.x` (WebSocket upgrade), splice to backend
 *  - `false` → any other HTTP method / path, hand to internal HTTP server
 *  - `null`  → need more bytes (no CRLF yet)
 *
 * We only check the request-line; `Upgrade: websocket` is not strictly
 * required — the backend will reject a non-upgrade `GET /ws` on its own.
 * Keeping the rule simple means we can decide after the first ~50 bytes
 * instead of waiting for the full header block.
 */
function peekWsRoute(buf: Buffer): boolean | null {
  const newlineIdx = buf.indexOf(0x0a); // \n
  if (newlineIdx < 0) return null;
  const firstLine = buf.slice(0, newlineIdx).toString('ascii');
  return /^GET\s+\/ws(?:\?[^\s]*)?\s+HTTP\/1\.[01]\r?$/.test(firstLine);
}

export async function startStaticServer(opts: StaticServerOptions): Promise<StaticServerHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const allowRemote = opts.allowRemote === true;
  const host = allowRemote ? '0.0.0.0' : '127.0.0.1';

  // When the WebUI is exposed beyond loopback, the reverse proxy is the trust
  // boundary: the backend runs in --local mode and does not authenticate
  // /api/* itself, so we gate every backend-bound request behind a WebUI login.
  // Loopback-only deployments keep the existing (backend-trusted) behavior.
  const requireAuth = allowRemote;
  const gate = createAuthGate();

  // The HTTP server listens only on loopback — user traffic hits the outer
  // net.Server first. We route to this server for everything except WS
  // upgrades, which go straight to the backend via a raw TCP splice.
  //
  // Why two listeners instead of using `http.Server`'s native `upgrade` event:
  // bun 1.3's http-compat layer does not faithfully forward writes on the
  // socket delivered to the `upgrade` handler, so the backend's 101 response
  // never reaches the browser (see #2824). Making the outer listener pure
  // TCP avoids touching that code path on both bun and node.
  const http_server: Server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        res.writeHead(400).end();
        return;
      }

      // Auth gate (LAN-exposed only). Handles /login + /logout and rejects
      // unauthenticated /api/* before any backend-bound or local API handler.
      if (requireAuth && enforceGate(req, res, gate, opts.backendPort)) return;

      // Hide desktop/admin-only assistants (the 管家) from WebUI browser clients.
      // Always applied in WebUI mode — the butler is desktop-only regardless of
      // LAN exposure. Desktop talks to the backend directly, bypassing this.
      if (req.method === 'GET' && (req.url === '/api/assistants' || req.url.startsWith('/api/assistants?'))) {
        proxyAssistantsFiltered(req, res, opts.backendPort);
        return;
      }

      // /api/downloads/* — client installer downloads, served LOCALLY from the
      // bundled installer dir (NOT proxied to aioncore). Must come before the
      // generic /api/* proxy below.
      if (req.url.startsWith('/api/downloads/list')) {
        await handleDownloadsList(res, opts.installerDir);
        return;
      }
      if (req.url.startsWith('/api/downloads/get')) {
        await handleDownloadGet(req, res, opts.installerDir);
        return;
      }

      // /api/shared-drive/* — enterprise LAN shared library, served LOCALLY
      // (NOT proxied to aioncore). Must come before the generic /api/* proxy.
      if (req.url.startsWith('/api/shared-drive/')) {
        if (req.url.startsWith('/api/shared-drive/list')) await handleSharedList(req, res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/categories'))
          await handleSharedCategories(res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/upload') && req.method === 'POST')
          await handleSharedUpload(req, res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/download'))
          await handleSharedDownload(req, res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/preview'))
          await handleSharedPreview(req, res, opts.sharedDriveDir);
        else if (req.url.startsWith('/api/shared-drive/remove') && req.method === 'DELETE')
          await handleSharedRemove(req, res, opts.sharedDriveDir);
        else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
        }
        return;
      }

      // /api/vector-search — knowledge-base search proxied LOCALLY to the vector
      // DB (NOT aioncore). The browser can't reach the loopback-bound vector DB
      // on the server host, so we forward on its behalf. Must come before the
      // generic /api/* proxy below.
      if (req.url.startsWith('/api/vector-search') && req.method === 'POST') {
        await handleVectorSearch(req, res);
        return;
      }

      // /api/vector-documents — read-only knowledge-base document list, proxied
      // to the vector DB the same way as vector-search above.
      if (req.url.startsWith('/api/vector-documents') && req.method === 'POST') {
        await handleVectorDocuments(req, res);
        return;
      }

      // /api/vector-image — knowledge-base image thumbnail, proxied to the vector
      // DB's /api/image. Endpoint + path come as query params.
      if (req.url.startsWith('/api/vector-image') && req.method === 'GET') {
        await handleVectorImage(req, res);
        return;
      }

      // /api/* — reverse proxy to backend (includes /api/auth/*).
      // /login and /logout are aionui-auth's top-level auth endpoints: proxy them too
      // so WebUI browser clients reach the backend without a path-rewrite.
      if (req.url.startsWith('/api/') || req.url.startsWith('/api?') || req.url === '/login' || req.url === '/logout') {
        forwardToBackend(req, res, opts.backendPort);
        return;
      }

      const requestPath = (req.url.split('?')[0] || '/').split('#')[0];
      const isHtmlEntry =
        requestPath === '/' || requestPath === '/index.html' || !requestPath.split('/').pop()?.includes('.');
      if (isHtmlEntry || requestPath === '/sw.js') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }

      // static files + SPA fallback
      await serveHandler(req, res, {
        public: opts.staticDir,
        rewrites: [{ source: '**', destination: '/index.html' }],
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
      } else {
        res.destroy();
      }
    }
  });

  // Internal HTTP server — 127.0.0.1 ephemeral port, never visible to the user.
  await new Promise<void>((resolve, reject) => {
    http_server.once('error', reject);
    http_server.listen(0, '127.0.0.1', () => {
      http_server.off('error', reject);
      resolve();
    });
  });
  const internalPort = (http_server.address() as { port: number } | null)?.port;
  if (!internalPort) {
    throw new Error('internal HTTP server failed to bind to a port');
  }

  // User-facing listener: inspect the first line of every TCP connection and
  // route to either the backend (for /ws upgrades) or the internal HTTP
  // server (everything else). Both routes use raw TCP splice — no reliance
  // on http.Server's upgrade event.
  const tcp_server = net.createServer((client: Socket) => {
    let peeked = Buffer.alloc(0);
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      client.removeListener('data', onData);
      client.removeListener('error', onEarlyError);
      client.removeListener('end', onEarlyEnd);
    };
    const onData = (chunk: Buffer): void => {
      peeked = Buffer.concat([peeked, chunk]);
      const decision = peekWsRoute(peeked);
      if (decision === null && peeked.length < PEEK_LIMIT_BYTES) return;
      // A /ws upgrade splices raw TCP straight to the backend, bypassing the
      // HTTP gate — so authorize it here too, once the full request head is in
      // (the Cookie header follows the request line).
      if (decision === true && requireAuth) {
        const headEnd = peeked.indexOf('\r\n\r\n');
        if (headEnd < 0 && peeked.length < PEEK_LIMIT_BYTES) return;
        if (!gate.isAuthorized(rawHeader(peeked, 'cookie'))) {
          cleanup();
          client.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
          return;
        }
      }
      cleanup();
      const target = decision === true ? opts.backendPort : internalPort;
      spliceToTcpEndpoint(client, target, peeked);
    };
    const onEarlyError = (): void => {
      cleanup();
      client.destroy();
    };
    const onEarlyEnd = (): void => {
      // Client closed before we saw a request line — nothing to route.
      cleanup();
      client.destroy();
    };
    client.on('data', onData);
    client.on('error', onEarlyError);
    client.on('end', onEarlyEnd);
  });

  await new Promise<void>((resolve, reject) => {
    tcp_server.once('error', reject);
    tcp_server.listen(port, host, () => {
      tcp_server.off('error', reject);
      resolve();
    });
  });

  const actualPort = (tcp_server.address() as { port: number } | null)?.port ?? port;
  const lanIP = allowRemote ? (getLanIP() ?? undefined) : undefined;
  const localUrl = `http://127.0.0.1:${actualPort}`;
  const networkUrl = lanIP ? `http://${lanIP}:${actualPort}` : undefined;

  return {
    port: actualPort,
    url: networkUrl ?? localUrl,
    localUrl,
    networkUrl,
    lanIP,
    stop: () =>
      new Promise<void>((resolve) => {
        tcp_server.close(() => {
          http_server.close(() => resolve());
        });
      }),
  };
}

export async function stopStaticServer(handle: StaticServerHandle): Promise<void> {
  await handle.stop();
}
