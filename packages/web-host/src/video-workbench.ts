/**
 * Video workbench (LAN / browser) — make the desktop "视频工作台" (opencut) usable
 * from a plain LAN browser, not just the Electron desktop.
 *
 * The desktop loads opencut from http://localhost:3000 inside an Electron
 * <webview>; a LAN browser can't reach the host's localhost. opencut is a Next.js
 * app, so we reverse-proxy it same-origin under a subpath instead of serving a
 * static bundle:
 *
 *   *  /workbench/video/*  → http://<host-opencut>/workbench/video/*  (full path)
 *
 * opencut must run with basePath=/workbench/video (OPENCUT_BASE_PATH) so its
 * pages, /_next assets and router all live under that prefix and survive the
 * proxy. Video editing is fully client-side (mediabunny/WebCodecs), so each
 * browser does its own work — the host server just serves the app + assets.
 *
 * Gated by webui-auth-gate (the /workbench/* check in static-server) when the
 * WebUI is LAN-exposed. Cookies pass through both ways so opencut's own session
 * survives; only hop-by-hop headers are stripped.
 */

import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';

export const VIDEO_STATIC_PREFIX = '/workbench/video';

const DEFAULT_VIDEO_UPSTREAM_URL = 'http://localhost:3000';

/**
 * Host opencut origin. Fixed per server (never client controlled). Resolution
 * order: explicit option → AIONUI_VIDEO_UPSTREAM_URL env → localhost:3000.
 */
function videoUpstreamUrl(option?: string): string {
  return option?.trim() || process.env.AIONUI_VIDEO_UPSTREAM_URL?.trim() || DEFAULT_VIDEO_UPSTREAM_URL;
}

const HOP_BY_HOP = [
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
];

/**
 * Reverse-proxy `/workbench/video/*` to the host opencut server by streaming the
 * request up and the response back. The full request path (including the
 * /workbench/video prefix) is forwarded unchanged — opencut's basePath expects
 * it. The WebUI gate cookie is stripped (opencut must never see the auth token),
 * but opencut's own cookies pass through both ways so its session survives.
 * Hop-by-hop headers are stripped on both request and response.
 */
export function handleVideoWorkbenchProxy(req: IncomingMessage, res: ServerResponse, upstreamOption?: string): void {
  const base = videoUpstreamUrl(upstreamOption);
  let target: URL;
  try {
    target = new URL(`${base}${req.url ?? ''}`);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (target.origin !== new URL(base).origin) {
    res.writeHead(400).end();
    return;
  }

  const headers: OutgoingHttpHeaders = { ...req.headers };
  delete headers.host;
  // Strip the WebUI gate cookie so the auth token never reaches opencut; keep any
  // of opencut's own cookies so its session survives.
  if (req.headers.cookie) {
    const kept = req.headers.cookie
      .split(';')
      .filter((c) => !c.trim().toLowerCase().startsWith('webui_gate='))
      .join('; ')
      .trim();
    if (kept) headers.cookie = kept;
    else delete headers.cookie;
  }
  for (const token of String(req.headers.connection ?? '').split(',')) {
    const name = token.trim().toLowerCase();
    if (name) delete headers[name];
  }
  delete headers.connection;
  for (const h of HOP_BY_HOP) delete headers[h];
  headers.host = target.host;

  const isHttps = target.protocol === 'https:';
  const proxyReq = (isHttps ? https : http).request(
    {
      hostname: target.hostname,
      port: target.port ? Number(target.port) : isHttps ? 443 : 80,
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      // Don't pipe upstream-controlled hop-by-hop / CORS headers straight through.
      const outHeaders = { ...proxyRes.headers };
      for (const k of Object.keys(outHeaders)) {
        const lk = k.toLowerCase();
        if (
          lk === 'connection' ||
          lk === 'keep-alive' ||
          lk === 'transfer-encoding' ||
          lk === 'upgrade' ||
          lk.startsWith('access-control-')
        )
          delete outHeaders[k];
      }
      res.writeHead(proxyRes.statusCode ?? 502, outHeaders);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'VIDEO_UPSTREAM_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxyReq);
}
