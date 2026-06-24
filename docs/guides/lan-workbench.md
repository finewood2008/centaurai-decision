# LAN workbenches (image & video) over the WebUI

The desktop Toolbox workbenches are normally Electron-only (the **image workbench**
uses a `<webview>` + the `centaur-image-workbench://` custom protocol; the **video
workbench** is opencut served on `localhost:3000`). These are unreachable from a
plain LAN browser. The WebUI server makes both usable same-origin, behind the
WebUI auth gate, for browser/LAN users.

Both surfaces live under `/workbench/*` and are **gated by `webui-auth-gate`**
whenever the WebUI is LAN-exposed (`allowRemote`): only a logged-in user reaches
them. Loopback-only deployments serve them without a gate.

## Image workbench — `/workbench/image/*`

Served entirely by the WebUI server; no extra process.

- `GET /workbench/image/*` serves the bundled SPA dist (relative-based, so the
  same build works at the subpath — no rebuild). Dev: `public/centaur-image-workbench`;
  packaged: `out/renderer/centaur-image-workbench`.
- `* /workbench/image/__proxy/*` reverse-proxies the SPA's model-API calls to the
  upstream image service, **injecting the server-held key** so it never reaches the
  browser. The key comes from `AIONUI_IMAGE_WORKBENCH_KEY` or the admin's configured
  image-generation model; with no key it falls back to the client's `Authorization`
  (same as the desktop). Override the upstream with `AIONUI_IMAGE_UPSTREAM_URL`.

No deployment steps beyond running the WebUI — the SPA ships inside the renderer
build.

## Video workbench — `/workbench/video/*` (opencut, Route A)

opencut is a Next.js app, so the WebUI **reverse-proxies a host-run opencut**
instead of bundling it. Video editing is fully client-side (WebCodecs), so each
browser does its own work; the host just serves the app shell + assets.

opencut must run with a **Next `basePath`** so its pages, `/_next` assets and
router survive under the subpath:

1. The opencut checkout the desktop bridge launches (`VIDEO_DIR`,
   `/home/user/opencut-classic/apps/web`) must include the env-gated basePath in
   `next.config.ts` (`basePath: process.env.OPENCUT_BASE_PATH || undefined`) — see
   the `feat/lan-basepath` branch. **Without this in that checkout, the bridge's
   health probe (`/workbench/video/api/health`) 404s and the workbench never
   becomes ready.**
2. The desktop bridge spawns it with `OPENCUT_BASE_PATH=/workbench/video` and
   `NEXT_PUBLIC_BASE_PATH=/workbench/video` (the latter is inlined into the client
   bundle so raw `fetch("/api/...")` calls are prefixed via `withBasePath`).
3. The WebUI reverse-proxies `/workbench/video/*` → the host opencut
   (default `http://localhost:3000`; override with `AIONUI_VIDEO_UPSTREAM_URL`).
4. The **host must keep opencut running** for browser users — the desktop app
   auto-spawns/keeps it; a headless server must start it itself. In a browser the
   card pre-flights `/workbench/video/api/health` and shows an error if it's down.

### Production note

The bridge currently runs `bun run dev` (Next dev). Dev HMR uses a WebSocket that
the HTTP-only proxy does not forward, so **LAN browser users get no hot reload**
(harmless — they don't need it; the app works). For a stable LAN/headless deploy,
run opencut with `next build && next start` (no HMR) and set
`NEXT_PUBLIC_BASE_PATH` **at build time** (it's inlined).

### Limitations

- `withBasePath` covers the tracked absolute `/api` fetches (feedback, sound
  search). Any new absolute `fetch("/api/...")` in opencut must use it too, or it
  404s under basePath.
- The `agent-bridge` routes (CentaurAI↔opencut agent glue), if present, also need
  `withBasePath` on their fetches.
