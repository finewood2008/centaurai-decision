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
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import path from 'node:path';
import serveHandler from 'serve-handler';
import { handleDownloadGet, handleDownloadsList } from './downloads.js';
import { handleAppDownloadGet, handleAppDownloadsList, handleAppstoreList } from './app-downloads.js';
import {
  handleSharedCategories,
  handleSharedDownload,
  handleSharedList,
  handleSharedPreview,
  handleSharedRemove,
  handleSharedUpload,
} from './shared-drive.js';
import {
  handleContentAssetArchive,
  handleContentAssetDiscardDraft,
  handleContentAssetDownload,
  handleContentAssetIndex,
  handleContentAssetPreview,
  handleContentAssetPromoteDraft,
  handleContentAssetsList,
  handleContentAssetUpload,
} from './content-assets.js';
import {
  handleNasDownload,
  handleNasList,
  handleNasMkdir,
  handleNasMove,
  handleNasPreview,
  handleNasRemove,
  handleNasUpload,
} from './nas-drive.js';
import { handleImageWorkbenchProxy, handleImageWorkbenchStatic } from './image-workbench.js';
import { handleVideoWorkbenchProxy } from './video-workbench.js';
import { type AuthGate, createAuthGate } from './webui-auth-gate.js';
import { createEntryGuard, type EntryGuard } from './entry-html-guard.js';

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
  /** Managed personal-workspace manifest and blob directory. */
  contentAssetsDir?: string;
  /**
   * Root of the enterprise LAN network drive (the company's large shared disk),
   * browsed read-only at /api/nas/*. Omit to disable (list returns []).
   */
  nasRootDir?: string;
  /** Trusted loopback origin for the local knowledge worker. */
  knowledgeEndpoint?: string;
  /** Server-held worker token; never accepted from a browser request. */
  knowledgeToken?: string;
  /**
   * Directory holding the image workbench SPA dist, served to browser/LAN users
   * at /workbench/image/*. Defaults to `<staticDir>/centaur-image-workbench`
   * (where the desktop build copies it); set explicitly for tests.
   */
  imageWorkbenchDir?: string;
  /**
   * Server-held API key for the image workbench's upstream model API, injected
   * by the /workbench/image/__proxy/* reverse proxy so it never reaches the
   * browser. Omit to pass the client's Authorization through instead.
   */
  imageKey?: string;
  /**
   * Origin of the host's opencut server (run with basePath=/workbench/video),
   * reverse-proxied at /workbench/video/* for browser/LAN users. Defaults to
   * http://localhost:3000. Omit to use the default / env override.
   */
  videoUpstreamUrl?: string;
  /**
   * When true, return 403 for the aioncore team/meeting API (`/api/teams*`).
   * Set by the Team edition: 智囊团 (decision meetings) is removed from the Team
   * product, but the bundled backend still exposes the route — this blocks LAN
   * employees from running a meeting by calling the API directly. The boss's
   * Decision box talks to the backend over IPC, not through this proxy.
   */
  blockTeamRoutes?: boolean;
  /**
   * Development only: Vite renderer origin to proxy non-API page/assets from.
   * Keeps LAN/WebUI usable under `electron-vite dev`, where out/renderer may
   * not exist yet while the desktop renderer is served from Vite.
   */
  rendererDevUrl?: string;
};

export type StaticServerHandle = {
  port: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
  /** Read-only health of the SPA entry document (for the remote-access UI). */
  inspectEntry: EntryGuard['inspect'];
  /** Force a check + heal of the entry document; returns the resulting health. */
  repairEntry: EntryGuard['repair'];
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
const VIRTUAL_IFACE_RE = /^(utun|tun|tap|ppp|ipsec|wg|awdl|llw|bridge|vmnet|vboxnet|gif|stf|ap\d)/i;

const isProxyOrCgnatAddr = (addr: string): boolean => {
  if (/^198\.1[89]\./.test(addr)) return true;
  const cgnat = /^100\.(\d+)\./.exec(addr);
  if (cgnat && Number(cgnat[1]) >= 64 && Number(cgnat[1]) <= 127) return true;
  return false;
};

const isUsableLanAddr = (addr: string): boolean => !addr.startsWith('169.254.') && !isProxyOrCgnatAddr(addr);

const lanAddrScore = (addr: string): number => {
  if (addr.startsWith('192.168.')) return 3;
  if (addr.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 2;
  return 1;
};

function getLanIPCandidates(): string[] {
  const nets = networkInterfaces();
  const found: { iface: string; address: string }[] = [];
  for (const name of Object.keys(nets)) {
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    for (const iface of nets[name] || []) {
      const isIPv4 = iface.family === 'IPv4' || (iface.family as unknown) === 4;
      if (!isIPv4 || iface.internal || !isUsableLanAddr(iface.address)) continue;
      found.push({ iface: name, address: iface.address });
    }
  }
  found.sort((a, b) => {
    const byScore = lanAddrScore(b.address) - lanAddrScore(a.address);
    if (byScore !== 0) return byScore;
    const physicalA = /^en\d/i.test(a.iface) ? 0 : 1;
    const physicalB = /^en\d/i.test(b.iface) ? 0 : 1;
    return physicalA - physicalB;
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of found) {
    if (seen.has(item.address)) continue;
    seen.add(item.address);
    out.push(item.address);
  }
  return out;
}

function getLanIP(): string | null {
  return getLanIPCandidates()[0] ?? null;
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

function proxyToOrigin(req: IncomingMessage, res: ServerResponse, origin: string): void {
  let target: URL;
  try {
    target = new URL(req.url ?? '/', origin);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const headers = { ...req.headers, host: target.host };
  const proxy = (target.protocol === 'https:' ? https.request : http.request)(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Renderer dev server unreachable');
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
      const gateToken = gate.mintToken();
      headers['set-cookie'] = [...list, gate.mintCookie()];
      headers['x-webui-gate-token'] = gateToken;
      headers['access-control-expose-headers'] = appendCsvHeader(headers['access-control-expose-headers'], [
        'X-WebUI-Gate-Token',
      ]);
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

function appendCsvHeader(value: string | string[] | number | undefined, additions: string[]): string {
  const existing = Array.isArray(value) ? value.join(',') : value === undefined ? '' : String(value);
  const parts = new Set(
    existing
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  );
  for (const addition of additions) parts.add(addition);
  return [...parts].join(', ');
}

function requestGateToken(req: IncomingMessage): string | undefined {
  const header = req.headers['x-webui-gate-token'];
  if (Array.isArray(header)) return header[0];
  return header;
}

function isGateAuthorized(gate: AuthGate, req: IncomingMessage): boolean {
  return gate.isAuthorized(req.headers.cookie) || gate.isAuthorizedToken(requestGateToken(req));
}

/**
 * Enforce the WebUI auth gate for LAN-exposed deployments. Returns true when the
 * response was fully handled (the caller must then stop processing the request).
 *
 * Reachable without a session: `POST /login` (mints a session on success),
 * `GET /api/auth/status` (lets the app decide whether to show login/setup),
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
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: backendPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
    };
    const proxy = http.request(options, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      const existing = headers['set-cookie'];
      const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
      headers['set-cookie'] = [...list, gate.clearCookie()];
      res.writeHead(proxyRes.statusCode ?? 502, headers);
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
    return true;
  }
  // Bootstrap endpoints reachable before a session exists.
  if (req.method === 'GET' && path === '/api/auth/status') return false;
  if (req.method === 'GET' && path === '/api/auth/csrf-token') return false;
  if (path.startsWith('/api/downloads/')) return false;

  const isApi = path === '/api' || path.startsWith('/api/');
  if (isApi && !isGateAuthorized(gate, req)) {
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

function rawGateToken(head: Buffer): string | undefined {
  const fromHeader = rawHeader(head, 'x-webui-gate-token');
  if (fromHeader) return fromHeader;

  const newlineIdx = head.indexOf(0x0a);
  if (newlineIdx < 0) return undefined;
  const firstLine = head.slice(0, newlineIdx).toString('ascii');
  const match = /^GET\s+([^\s]+)\s+HTTP\/1\.[01]\r?$/.exec(firstLine);
  if (!match) return undefined;
  try {
    return new URL(match[1] ?? '/', 'http://127.0.0.1').searchParams.get('gate') ?? undefined;
  } catch {
    return undefined;
  }
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

function stripProviderSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProviderSecrets);
  if (!value || typeof value !== 'object') return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (key === 'api_key' || key === 'apiKey') {
      const hasKey = typeof child === 'string' && child.trim().length > 0;
      output[key] = '';
      output[key === 'api_key' ? 'has_api_key' : 'hasApiKey'] = hasKey;
      continue;
    }
    output[key] = stripProviderSecrets(child);
  }
  return output;
}

/**
 * Proxy provider reads for WebUI/browser clients without exposing stored API
 * keys. Desktop renderers bypass WebHost and still talk to the backend directly.
 */
function proxyProvidersSanitized(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
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
      delete headers['content-length'];
      delete headers['content-encoding'];
      delete headers['transfer-encoding'];

      let body = Buffer.concat(chunks);
      if (status >= 200 && status < 300) {
        try {
          body = Buffer.from(JSON.stringify(stripProviderSecrets(JSON.parse(body.toString('utf-8')))), 'utf-8');
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
 * uses a server-owned endpoint. Browser-supplied endpoints are deliberately
 * ignored so this route cannot be repurposed as an SSRF proxy.
 */
async function handleVectorSearch(
  req: IncomingMessage,
  res: ServerResponse,
  endpoint: string | undefined,
  token: string | undefined
): Promise<void> {
  const sendJson = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const body = await readJsonBody(req);
    const query = typeof body.query === 'string' ? body.query : '';
    if (!endpoint) {
      sendJson(503, { error: 'KNOWLEDGE_UNAVAILABLE' });
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
      headers: knowledgeHeaders(token, true),
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
async function handleVectorDocuments(
  req: IncomingMessage,
  res: ServerResponse,
  endpoint: string | undefined,
  token: string | undefined
): Promise<void> {
  const sendJson = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const body = await readJsonBody(req);
    if (!endpoint) {
      sendJson(503, { error: 'KNOWLEDGE_UNAVAILABLE' });
      return;
    }
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 500) : 300;
    const offset = typeof body.offset === 'number' && body.offset >= 0 ? body.offset : 0;
    const upstream = await fetch(`${endpoint}/api/documents?limit=${limit}&offset=${offset}`, {
      headers: knowledgeHeaders(token),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(text);
  } catch {
    sendJson(502, { error: 'VECTOR_DB_UNREACHABLE' });
  }
}

/** Proxy a knowledge-base image thumbnail to the local vector DB's /api/image. */
async function handleVectorImage(
  req: IncomingMessage,
  res: ServerResponse,
  endpoint: string | undefined,
  token: string | undefined
): Promise<void> {
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const path = url.searchParams.get('path') || '';
    if (!endpoint) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'KNOWLEDGE_UNAVAILABLE' }));
      return;
    }
    if (!path) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'INVALID_REQUEST' }));
      return;
    }
    const upstream = await fetch(`${endpoint}/api/image?path=${encodeURIComponent(path)}`, {
      headers: knowledgeHeaders(token),
    });
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

function knowledgeHeaders(token: string | undefined, json = false): Record<string, string> {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    ...(token
      ? {
          authorization: `Bearer ${token}`,
          'x-centaurai-knowledge-token': token,
        }
      : {}),
  };
}

function normalizeKnowledgeEndpoint(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = new URL(raw.trim());
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (!['http:', 'https:'].includes(parsed.protocol) || !loopbackHosts.has(parsed.hostname)) return undefined;
    if (parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '')) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
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
  const knowledgeEndpoint = normalizeKnowledgeEndpoint(opts.knowledgeEndpoint);
  const knowledgeToken = opts.knowledgeToken?.trim() || undefined;
  const remoteKnowledgeEndpoint = allowRemote && !knowledgeToken ? undefined : knowledgeEndpoint;

  // The image workbench SPA dist lives under the served static dir by default
  // (the desktop build copies it to out/renderer/centaur-image-workbench).
  const imageWorkbenchDir = opts.imageWorkbenchDir ?? path.join(opts.staticDir, 'centaur-image-workbench');

  // Self-healing guard for the SPA entry document. The WebUI is the only way LAN
  // users reach the app and it always serves staticDir/index.html; an empty or
  // truncated index.html (seen intermittently from the build) would otherwise
  // hand every LAN user a blank 200. The guard serves/restores a known-good copy
  // and falls back to a friendly recovery page instead of a blank screen.
  const entryGuard: EntryGuard = await createEntryGuard(opts.staticDir);

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

      if (req.url === '/api/webui-host/health' || req.url.startsWith('/api/webui-host/health?')) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Auth gate (LAN-exposed only). Handles /login + /logout and rejects
      // unauthenticated /api/* before any backend-bound or local API handler.
      if (requireAuth && enforceGate(req, res, gate, opts.backendPort)) return;

      // /workbench/* (browser image/video workbench) lives outside /api/, so the
      // gate above skips it — gate it explicitly when LAN-exposed.
      if (requireAuth && req.url.startsWith('/workbench/') && !isGateAuthorized(gate, req)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'UNAUTHENTICATED' }));
        return;
      }

      // Team edition: 智囊团 (decision meetings) is a Decision-only feature. Its UI
      // is removed from the Team renderer, but the bundled aioncore still serves
      // /api/teams* — block it here so LAN employees can't run a meeting by calling
      // the API directly. (Decision uses IPC, not this proxy, so it's unaffected.)
      if (
        opts.blockTeamRoutes &&
        (req.url === '/api/teams' || req.url.startsWith('/api/teams/') || req.url.startsWith('/api/teams?'))
      ) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'EDITION_DISABLED' }));
        return;
      }

      // Hide desktop/admin-only assistants (the 管家) from WebUI browser clients.
      // Always applied in WebUI mode — the butler is desktop-only regardless of
      // LAN exposure. Desktop talks to the backend directly, bypassing this.
      if (req.method === 'GET' && (req.url === '/api/assistants' || req.url.startsWith('/api/assistants?'))) {
        proxyAssistantsFiltered(req, res, opts.backendPort);
        return;
      }

      // Provider config is admin/desktop-owned. WebUI browser clients may read
      // provider metadata, but stored API keys must not leave the server. Desktop
      // bypasses this server and still receives full provider rows from backend.
      if (
        req.method === 'GET' &&
        (req.url === '/api/providers' || req.url.startsWith('/api/providers?') || req.url.startsWith('/api/providers/'))
      ) {
        proxyProvidersSanitized(req, res, opts.backendPort);
        return;
      }
      if (
        req.method !== 'GET' &&
        (req.url === '/api/providers' || req.url.startsWith('/api/providers?') || req.url.startsWith('/api/providers/'))
      ) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'READ_ONLY' }));
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

      // /api/appstore/downloads/* — standalone App Store app installers, served
      // from an external admin dir. Reaches here only AFTER the auth gate (these
      // require login, unlike /api/downloads/* which is pre-login allowed).
      if (req.url.startsWith('/api/appstore/downloads/list')) {
        await handleAppDownloadsList(req, res);
        return;
      }
      if (req.url.startsWith('/api/appstore/downloads/get')) {
        await handleAppDownloadGet(req, res);
        return;
      }
      // /api/appstore/list — app catalog for LAN/WebUI browsers (ipcBridge
      // appstore.* providers live in the Electron main, unreachable from WebUI).
      if (req.url.startsWith('/api/appstore/list')) {
        await handleAppstoreList(req, res);
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

      // Decision is single-user: bind every request to the server-owned user
      // instead of trusting a caller-supplied owner query parameter.
      if (req.url.startsWith('/api/content-assets/')) {
        const ownerUserId = 'system_default_user';
        if (req.url.startsWith('/api/content-assets/list') && req.method === 'GET')
          await handleContentAssetsList(req, res, opts.contentAssetsDir, ownerUserId);
        else if (req.url.startsWith('/api/content-assets/draft-upload') && req.method === 'POST')
          await handleContentAssetUpload(req, res, opts.contentAssetsDir, ownerUserId, 'draft');
        else if (req.url.startsWith('/api/content-assets/upload') && req.method === 'POST')
          await handleContentAssetUpload(req, res, opts.contentAssetsDir, ownerUserId, 'saved');
        else if (req.url.startsWith('/api/content-assets/promote') && req.method === 'POST')
          await handleContentAssetPromoteDraft(req, res, opts.contentAssetsDir, ownerUserId);
        else if (req.url.startsWith('/api/content-assets/index') && req.method === 'POST')
          await handleContentAssetIndex(req, res, opts.contentAssetsDir, ownerUserId, {
            endpoint: remoteKnowledgeEndpoint || '',
            token: knowledgeToken,
          });
        else if (req.url.startsWith('/api/content-assets/archive') && req.method === 'POST')
          await handleContentAssetArchive(req, res, opts.contentAssetsDir, ownerUserId);
        else if (req.url.startsWith('/api/content-assets/discard') && req.method === 'DELETE')
          await handleContentAssetDiscardDraft(req, res, opts.contentAssetsDir, ownerUserId);
        else if (req.url.startsWith('/api/content-assets/download'))
          await handleContentAssetDownload(req, res, opts.contentAssetsDir, ownerUserId);
        else if (req.url.startsWith('/api/content-assets/preview'))
          await handleContentAssetPreview(req, res, opts.contentAssetsDir, ownerUserId);
        else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'NOT_FOUND' }));
        }
        return;
      }

      // /api/nas/* — enterprise LAN network drive (read-only), served LOCALLY
      // (NOT proxied to aioncore). Must come before the generic /api/* proxy.
      if (req.url.startsWith('/api/nas/')) {
        if (req.url.startsWith('/api/nas/list')) await handleNasList(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/download')) await handleNasDownload(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/preview')) await handleNasPreview(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/upload') && req.method === 'POST')
          await handleNasUpload(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/mkdir') && req.method === 'POST')
          await handleNasMkdir(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/move') && req.method === 'POST')
          await handleNasMove(req, res, opts.nasRootDir);
        else if (req.url.startsWith('/api/nas/remove') && req.method === 'DELETE')
          await handleNasRemove(req, res, opts.nasRootDir);
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
        await handleVectorSearch(req, res, remoteKnowledgeEndpoint, knowledgeToken);
        return;
      }

      // /api/vector-documents — read-only knowledge-base document list, proxied
      // to the vector DB the same way as vector-search above.
      if (req.url.startsWith('/api/vector-documents') && req.method === 'POST') {
        await handleVectorDocuments(req, res, remoteKnowledgeEndpoint, knowledgeToken);
        return;
      }

      // /api/vector-image — knowledge-base image thumbnail, proxied to the vector
      // DB's /api/image. Endpoint + path come as query params.
      if (req.url.startsWith('/api/vector-image') && req.method === 'GET') {
        await handleVectorImage(req, res, remoteKnowledgeEndpoint, knowledgeToken);
        return;
      }

      // /workbench/image/* — image workbench for browser/LAN users. The desktop
      // uses the centaur-image-workbench:// custom protocol instead; this serves
      // the same SPA over HTTP plus a key-injecting proxy. The __proxy sub-route
      // must be checked before the static catch (it is a sub-path), and matched
      // WITH a trailing slash so the upstream path always starts with '/'.
      if (req.url.startsWith('/workbench/image/__proxy/')) {
        handleImageWorkbenchProxy(req, res, opts.imageKey);
        return;
      }
      if (req.url === '/workbench/image') {
        res.writeHead(301, { Location: '/workbench/image/' });
        res.end();
        return;
      }
      if (req.url.startsWith('/workbench/image/')) {
        await handleImageWorkbenchStatic(req, res, imageWorkbenchDir);
        return;
      }

      // /workbench/video/* — reverse proxy to the host opencut server (Next.js
      // with basePath=/workbench/video). The full path is forwarded unchanged.
      if (req.url.startsWith('/workbench/video/') || req.url === '/workbench/video') {
        handleVideoWorkbenchProxy(req, res, opts.videoUpstreamUrl);
        return;
      }

      // /api/* — reverse proxy to backend (includes /api/auth/*).
      // POST /login and POST /logout are aionui-auth's top-level auth endpoints.
      // Browser GETs for /login and /logout are SPA routes and must fall through
      // to index.html; otherwise LAN users can land on a backend 405 page.
      const requestPath = (req.url.split('?')[0] || '/').split('#')[0];
      if (
        req.url.startsWith('/api/') ||
        req.url.startsWith('/api?') ||
        (req.method === 'POST' && (requestPath === '/login' || requestPath === '/logout'))
      ) {
        forwardToBackend(req, res, opts.backendPort);
        return;
      }

      const isHtmlEntry =
        requestPath === '/' || requestPath === '/index.html' || !requestPath.split('/').pop()?.includes('.');

      if (opts.rendererDevUrl) {
        proxyToOrigin(req, res, opts.rendererDevUrl);
        return;
      }

      if (isHtmlEntry || requestPath === '/sw.js') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }

      // SPA entry + client-route fallback: serve through the self-healing guard
      // rather than serve-handler, so an empty/corrupt index.html never reaches
      // a LAN user as a blank page. The guard restores the file from a backup
      // when possible and otherwise returns a recovery page (HTTP 503).
      if (isHtmlEntry && req.method !== 'HEAD') {
        const { html, healed, recovered } = await entryGuard.getEntryHtml();
        if (healed) {
          console.warn('[WebUI] index.html was empty/corrupt — self-healed from backup copy');
        }
        if (recovered) {
          console.error(
            '[WebUI] index.html missing and no valid backup — serving recovery page. Rebuild the renderer: bun run package'
          );
        }
        res.statusCode = recovered ? 503 : 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        if (recovered) res.setHeader('Retry-After', '10');
        res.end(html);
        return;
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
        if (!gate.isAuthorized(rawHeader(peeked, 'cookie')) && !gate.isAuthorizedToken(rawGateToken(peeked))) {
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
    inspectEntry: entryGuard.inspect,
    repairEntry: entryGuard.repair,
  };
}

export async function stopStaticServer(handle: StaticServerHandle): Promise<void> {
  await handle.stop();
}
