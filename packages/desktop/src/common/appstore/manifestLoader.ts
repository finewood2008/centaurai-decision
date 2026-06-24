/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CentaurAI App Store — manifest validation (validate-before-act).
 *
 * Turns raw parsed JSON into a typed {@link AppManifest} or a structured
 * rejection. Pure and dependency-free (no zod, no Node APIs) so it runs in both
 * the main process (bootstrap/migration) and the renderer.
 *
 * Hard-reject rules (see CENTAURAI_APPSTORE_DESIGN.md §5-H5):
 *  - `permissions.shell === true` is schema-forbidden.
 *  - `routePrefix` must match {@link APP_ROUTE_PREFIX_RE} and contain none of
 *    {@link FORBIDDEN_PATH_SEGMENTS}.
 *  - `type` must be MVP-supported; `local-service`/`remote-url` are deferred.
 *  - `agent.bridge.kind` must be MVP-supported (`backend-mcp`).
 *  - no id / routePrefix collision against already-loaded apps.
 */

import type { AppCategory, AppManifest, AppNetworkPolicy, AppTrust, AppType, LocalizedText } from './appManifest';

/** A `routePrefix` must be exactly `/apps/<lowercase-kebab-id>`. */
export const APP_ROUTE_PREFIX_RE = /^\/apps\/[a-z0-9-]+$/;

/**
 * Dangerous substrings that must never appear in a routePrefix — and, more
 * importantly, the SHARED canonical list that the web-host default-deny gate
 * (`normalizeGatePath`, SEC-1) must reject in an incoming request path.
 *
 * NOTE: SEC-1 lives in `packages/web-host` (which `packages/desktop` depends
 * on), so the eventual cross-package share is resolved when SEC-1 lands — by
 * relocating this constant or mirroring it with an equality test — to keep the
 * two lists from diverging.
 */
export const FORBIDDEN_PATH_SEGMENTS = ['..', '%2e', '%2f', '\\'] as const;

/** App types runnable now. `remote-url` parses-then-rejects as "deferred". */
export const MVP_SUPPORTED_APP_TYPES = ['static-spa', 'native-panel', 'local-service'] as const;

/** Agent bridge kinds runnable in MVP-A. */
export const SUPPORTED_BRIDGE_KINDS = ['backend-mcp'] as const;

const APP_CATEGORIES: readonly AppCategory[] = ['media', 'productivity', 'utility', 'developer', 'other'];
const APP_TRUST_VALUES: readonly AppTrust[] = ['first-party', 'verified-third-party', 'community'];
const APP_NETWORK_POLICIES: readonly AppNetworkPolicy[] = ['none', 'proxy-only'];

/** Why a manifest was rejected. */
export type ManifestRejectReason =
  | 'not-object'
  | 'missing-field'
  | 'bad-type'
  | 'shell-forbidden'
  | 'route-prefix-invalid'
  | 'route-prefix-collision'
  | 'id-collision'
  | 'app-type-unsupported'
  | 'bridge-kind-unsupported';

/**
 * Result of validating one raw manifest. Flat (not a discriminated union)
 * on purpose: the project's `tsc` runs without `strictNullChecks`, where
 * `if (!result.ok)` does NOT narrow a `{ok:true}|{ok:false}` union, so a flat
 * shape with optional fields type-checks cleanly for consumers under both
 * strict and non-strict settings. `manifest` is set iff `ok`; `reason`/`message`
 * are set iff not `ok`.
 */
export type ManifestValidationResult = {
  ok: boolean;
  manifest?: AppManifest;
  reason?: ManifestRejectReason;
  message?: string;
};

const reject = (reason: ManifestRejectReason, message: string): ManifestValidationResult => ({
  ok: false,
  reason,
  message,
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** A non-empty map whose every value is a string (inline localized text). */
const isLocalizedText = (v: unknown): v is LocalizedText => {
  if (!isRecord(v)) return false;
  const values = Object.values(v);
  return values.length > 0 && values.every((val) => typeof val === 'string');
};

const containsForbiddenSegment = (value: string): boolean => {
  const lower = value.toLowerCase();
  return FORBIDDEN_PATH_SEGMENTS.some((seg) => lower.includes(seg));
};

/**
 * Validate one raw (parsed-JSON) manifest against the App Store rules.
 *
 * @param raw      the parsed JSON value (untrusted, `unknown`).
 * @param existing manifests already accepted in this load pass — used to detect
 *                 id / routePrefix collisions. Pass the accumulating list.
 */
export const validateManifest = (raw: unknown, existing: readonly AppManifest[] = []): ManifestValidationResult => {
  if (!isRecord(raw)) {
    return reject('not-object', 'Manifest must be a JSON object.');
  }

  // ---- required identity / display fields ----
  if (!isNonEmptyString(raw.id))
    return reject('missing-field', 'Manifest "id" is required and must be a non-empty string.');
  if (!isNonEmptyString(raw.manifestVersion))
    return reject('missing-field', `App "${raw.id}": "manifestVersion" is required.`);
  if (!isNonEmptyString(raw.version)) return reject('missing-field', `App "${raw.id}": "version" is required.`);
  if (!isLocalizedText(raw.name))
    return reject('bad-type', `App "${raw.id}": "name" must be a non-empty localized-text map.`);
  if (!isLocalizedText(raw.description))
    return reject('bad-type', `App "${raw.id}": "description" must be a non-empty localized-text map.`);
  if (!isNonEmptyString(raw.icon)) return reject('missing-field', `App "${raw.id}": "icon" is required.`);
  if (!APP_CATEGORIES.includes(raw.category as AppCategory))
    return reject('bad-type', `App "${raw.id}": "category" must be one of ${APP_CATEGORIES.join(', ')}.`);
  if (!APP_TRUST_VALUES.includes(raw.trust as AppTrust))
    return reject('bad-type', `App "${raw.id}": "trust" must be one of ${APP_TRUST_VALUES.join(', ')}.`);

  // ---- app type (MVP gate) ----
  if (typeof raw.type !== 'string') return reject('missing-field', `App "${raw.id}": "type" is required.`);
  if (!(MVP_SUPPORTED_APP_TYPES as readonly string[]).includes(raw.type)) {
    const deferred = raw.type === 'remote-url';
    return reject(
      'app-type-unsupported',
      deferred
        ? `App "${raw.id}": app type "remote-url" is deferred (v3) and not runnable yet.`
        : `App "${raw.id}": unknown app type "${raw.type}".`
    );
  }
  const appType = raw.type as AppType;

  // ---- permissions (deny-by-default; shell schema-forbidden) ----
  if (!isRecord(raw.permissions)) return reject('missing-field', `App "${raw.id}": "permissions" is required.`);
  const perms = raw.permissions;
  if (perms.shell === true)
    return reject('shell-forbidden', `App "${raw.id}": "permissions.shell" must never be true (schema-forbidden).`);
  if (perms.shell !== false)
    return reject('bad-type', `App "${raw.id}": "permissions.shell" must be present and false.`);
  if (!APP_NETWORK_POLICIES.includes(perms.network as AppNetworkPolicy))
    return reject(
      'bad-type',
      `App "${raw.id}": "permissions.network" must be one of ${APP_NETWORK_POLICIES.join(', ')}.`
    );
  if (typeof perms.spawnProcess !== 'boolean')
    return reject('bad-type', `App "${raw.id}": "permissions.spawnProcess" must be a boolean.`);
  if (typeof perms.agentOperable !== 'boolean')
    return reject('bad-type', `App "${raw.id}": "permissions.agentOperable" must be a boolean.`);

  // ---- routePrefix (required for static-spa, forbidden for native-panel) ----
  if (raw.routePrefix !== undefined) {
    if (
      typeof raw.routePrefix !== 'string' ||
      !APP_ROUTE_PREFIX_RE.test(raw.routePrefix) ||
      containsForbiddenSegment(raw.routePrefix)
    ) {
      return reject(
        'route-prefix-invalid',
        `App "${raw.id}": "routePrefix" must match /apps/<lowercase-id> (got ${JSON.stringify(raw.routePrefix)}).`
      );
    }
  } else if (appType === 'static-spa') {
    return reject('missing-field', `App "${raw.id}": "routePrefix" is required for static-spa apps.`);
  }

  // ---- agent bridge kind (MVP gate) ----
  if (raw.agent !== undefined) {
    if (!isRecord(raw.agent) || !isRecord(raw.agent.bridge))
      return reject('bad-type', `App "${raw.id}": "agent.bridge" must be an object.`);
    const kind = raw.agent.bridge.kind;
    if (typeof kind !== 'string') return reject('bad-type', `App "${raw.id}": "agent.bridge.kind" is required.`);
    if (!(SUPPORTED_BRIDGE_KINDS as readonly string[]).includes(kind)) {
      return reject(
        'bridge-kind-unsupported',
        `App "${raw.id}": agent bridge kind "${kind}" is deferred (service-httpbus → MVP-B, static-spa-postmessage → v2); only "backend-mcp" runs in MVP-A.`
      );
    }
  }

  // ---- collisions against already-loaded apps ----
  for (const other of existing) {
    if (other.id === raw.id) return reject('id-collision', `App "${raw.id}": duplicate app id.`);
    if (raw.routePrefix !== undefined && other.routePrefix === raw.routePrefix) {
      return reject(
        'route-prefix-collision',
        `App "${raw.id}": routePrefix "${raw.routePrefix}" collides with app "${other.id}".`
      );
    }
  }

  return { ok: true, manifest: raw as AppManifest };
};
