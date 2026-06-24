/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CentaurAI App Store — app manifest type definitions.
 *
 * An **app** is "a bundle of agent-callable capabilities with an optional
 * embedded UI". The `AppManifest` is the single source of truth for one app
 * and replaces the special-cased workbench wiring in `ToolboxPage.tsx`,
 * `index.ts` (the `centaur-image-workbench://` protocol), `build-mcp-servers.js`
 * and `runBackendMigrations.ts`.
 *
 * This file is **types only** (plus pure literal unions) so it can be imported
 * by BOTH the main process (bootstrap/migration) and the renderer (registry/UI)
 * without pulling in any Node.js dependency.
 *
 * MVP scope is annotated per field. Fields marked **INERT** are parsed and
 * stored but never enforced in MVP-A — they exist as cheap forward-compatible
 * seams (see CENTAURAI_APPSTORE_DESIGN.md §2).
 */

/**
 * Inline localized text: BCP-47 locale tag → display string. These are literal
 * strings carried in the manifest, NOT i18n keys — an app's display name is
 * decoupled from the `appstore` i18n module's per-locale parity.
 */
export type LocalizedText = Record<string, string>;

/**
 * How an app is rendered/hosted.
 * - `static-spa` — a bundled static SPA (desktop: `centaur-app://`; LAN: served
 *   same-origin under `routePrefix`). **Supported in MVP-A.**
 * - `native-panel` — an in-renderer React surface, no embedding. **Supported in
 *   MVP-A** (e.g. the existing form-driven image tools grid).
 * - `local-service` — a spawned local web service (e.g. opencut). **Deferred to
 *   MVP-B**; the loader rejects it for now.
 * - `remote-url` — a remote third-party web app. **Deferred to v3**; rejected.
 */
export type AppType = 'static-spa' | 'native-panel' | 'local-service' | 'remote-url';

/**
 * Provenance tier. **INERT in MVP** — only `first-party` apps ship through v2;
 * the value is recorded but no trust enforcement (signing/verification) runs
 * until the v3 marketplace pipeline.
 */
export type AppTrust = 'first-party' | 'verified-third-party' | 'community';

/**
 * Content integrity descriptor. **INERT in MVP** — present so a future
 * verify-before-parse/verify-before-spawn pipeline (v3) is additive, never
 * verified today.
 */
export type AppIntegrity = {
  sha256?: string;
  /** e.g. `ed25519:...`. Never checked in MVP. */
  signature?: string;
};

/** Grouping bucket for the store catalog card grid. */
export type AppCategory = 'media' | 'productivity' | 'utility' | 'developer' | 'other';

/**
 * An app's network egress policy (deny-by-default).
 * - `none` — the app makes no network calls (display-only apps).
 * - `proxy-only` — the app may only reach declared upstreams via the host proxy;
 *   never direct browser egress, never a raw key in the browser.
 */
export type AppNetworkPolicy = 'none' | 'proxy-only';

/**
 * Declared capabilities, deny-by-default. `shell` is typed as the literal
 * `false`: a manifest must never request shell access, and the loader
 * (manifestLoader) additionally HARD-REJECTS any raw JSON carrying `shell: true`.
 */
export type AppPermissions = {
  network: AppNetworkPolicy;
  /**
   * `true` ⇒ the app spawns a local process (a `local-service` app). Such apps
   * are DESKTOP-ADMIN-ONLY and never LAN-installable. Always `false` in MVP-A.
   */
  spawnProcess: boolean;
  /** Whether the app exposes agent-callable tools (see {@link AppAgent}). */
  agentOperable: boolean;
  /** Schema-forbidden. Must be `false`; the loader rejects `true`. */
  shell: false;
};

/** Where a credential's secret may come from. */
export type AppCredentialSource = 'byok' | 'platform';

/** How a resolved credential is injected into proxied upstream requests (host-side). */
export type AppCredentialInject = {
  via: 'header' | 'query';
  /** Header or query-param name, e.g. `Authorization`. */
  name: string;
  /** Optional scheme prefix, e.g. `Bearer` → `Authorization: Bearer <key>`. */
  scheme?: string;
};

/**
 * One credential an app needs. In MVP the secret is resolved and injected
 * HOST-SIDE (browser never sees it): a CentaurAI platform key (admin-capped,
 * LAN off by default) or a desktop-admin BYOK value. Per-user LAN BYOK is v2.
 */
export type AppCredential = {
  /** Stable key referenced by {@link AppUpstream.credential}, e.g. `imageApi`. */
  key: string;
  label: LocalizedText;
  /**
   * Capability used to resolve a CentaurAI `IProvider` for the platform-key
   * path, e.g. `image-generation`.
   */
  providerCapability?: string;
  sources: AppCredentialSource[];
  inject: AppCredentialInject;
};

/**
 * A declared upstream the app's proxy may reach.
 *
 * `originRef` indexes a COMPILED, host-side upstream allowlist (baked into the
 * shipped bundle) — it is NOT a free-text origin. This prevents an altered
 * manifest from pointing a platform-key-injected proxy at an attacker host.
 */
export type AppUpstream = {
  /** Key into the compiled host-side allowlist, e.g. `tokenclub-image`. */
  originRef: string;
  /** {@link AppCredential.key} to inject when proxying to this upstream. */
  credential?: string;
};

/** Runtime/entry configuration. Required for `static-spa`; omitted for `native-panel`. */
export type AppRuntimeConfig = {
  /** Directory (relative to the app's bundle root) holding the SPA build. */
  bundleDir: string;
  /** Entry HTML file within `bundleDir`, e.g. `index.html`. */
  entry: string;
  /**
   * Query string appended to the entry URL (replaces the hardcoded
   * `IMAGE2_WORKBENCH_PROFILE`), e.g. `model=gpt-image-2&...`.
   */
  queryProfile?: string;
};

/** Same-origin proxy mount for a `static-spa` app's upstream calls. */
export type AppProxyConfig = {
  /** e.g. `/apps/<id>/__proxy`. */
  prefix: string;
};

/**
 * How the app's agent tools are driven.
 * - `backend-mcp` — tools are backed by a headless backend MCP capability that
 *   needs no open tab (e.g. image generation via `imageGenServer.ts`).
 *   **Supported in MVP-A** and the marquee "your AI workforce uses this for
 *   you" path.
 * - `service-httpbus` — an HTTP command bus inside a `local-service` app (the
 *   opencut pattern). **Deferred to MVP-B** (requires per-spawn auth +
 *   per-session queue scoping).
 * - `static-spa-postmessage` — a SPA driven via the runtime `controlRef`.
 *   **Deferred to v2.**
 */
export type AppAgentBridgeKind = 'backend-mcp' | 'service-httpbus' | 'static-spa-postmessage';

/** The agent bridge descriptor for an app. */
export type AppAgentBridge = {
  kind: AppAgentBridgeKind;
};

/** A property within an agent tool's input schema. */
export type AppToolInputProperty = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: Array<string | number>;
  items?: AppToolInputProperty;
};

/** A minimal JSON-Schema object describing one agent tool's input. */
export type AppToolInputSchema = {
  type: 'object';
  properties?: Record<string, AppToolInputProperty>;
  required?: string[];
};

/**
 * One agent-callable tool. At build time these become MCP tools named
 * `app_<appId>_<name>` (single source of truth for both the in-app SDK and the
 * generated MCP server).
 */
export type AppAgentTool = {
  /** Logical tool name, e.g. `image_generate`. */
  name: string;
  /** Action verb dispatched to the app's bridge, e.g. `generate`. */
  action: string;
  description: string;
  inputSchema: AppToolInputSchema;
  /**
   * `false` ⇒ headless: the tool runs with no UI tab open (backend-mcp).
   * `true` ⇒ requires the app to be open (service-httpbus, MVP-B).
   */
  requiresAppOpen: boolean;
  /** Per-call timeout in milliseconds. */
  timeoutMs: number;
};

/** The agent-operability section of a manifest (present when `permissions.agentOperable`). */
export type AppAgent = {
  bridge: AppAgentBridge;
  tools: AppAgentTool[];
};

/**
 * The complete, self-describing manifest for one App Store app.
 *
 * Required for every app: `manifestVersion`, `id`, `version`, `name`,
 * `description`, `icon`, `category`, `trust`, `type`, `permissions`.
 * `runtime`/`routePrefix`/`proxy`/`upstreams`/`credentials`/`agent` are present
 * only for the app types/capabilities that need them.
 */
export type AppManifest = {
  /** Manifest schema version. **INERT in MVP** — stored, not negotiated until v3. */
  manifestVersion: string;
  /** Stable app id, e.g. `centaur-image-workbench`. */
  id: string;
  /** Semantic version of the app bundle. */
  version: string;
  name: LocalizedText;
  description: LocalizedText;
  /** Icon file (relative to the bundle), e.g. `icon.svg`. */
  icon: string;
  category: AppCategory;

  /** Provenance — **INERT in MVP** (first-party only). */
  trust: AppTrust;
  /** Content integrity — **INERT in MVP**. */
  integrity?: AppIntegrity;

  type: AppType;
  /** Runtime/entry — required for `static-spa`, omitted for `native-panel`. */
  runtime?: AppRuntimeConfig;

  /**
   * LAN serving namespace, e.g. `/apps/<id>`. Required for `static-spa` (the
   * loader validates it against `^/apps/[a-z0-9-]+$`); omitted for
   * `native-panel`, which renders in the renderer SPA on both desktop and LAN.
   */
  routePrefix?: string;
  /** Whether the runtime must stay mounted off-route. Defaults to `false`. */
  keepAlive?: boolean;

  permissions: AppPermissions;

  /** Credentials the app needs (BYOK / platform). Absent for `network: 'none'` apps. */
  credentials?: AppCredential[];
  /** Declared upstreams keyed by a logical name, e.g. `image`. */
  upstreams?: Record<string, AppUpstream>;
  /** Same-origin proxy mount (for `static-spa` apps that call upstreams). */
  proxy?: AppProxyConfig;

  /** Agent-operability — present when `permissions.agentOperable` is `true`. */
  agent?: AppAgent;
};
