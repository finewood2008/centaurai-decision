/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App Store standalone-app downloads. Serves per-OS installers for an app from
 * an admin-populated EXTERNAL directory (env AIONUI_APPSTORE_INSTALLER_DIR/<appId>),
 * reusing the client-installer list/get logic. Routed AFTER the auth gate (unlike
 * /api/downloads/*, these require login).
 *
 *   GET /api/appstore/downloads/list?appId=<id>            → InstallerInfo[]
 *   GET /api/appstore/downloads/get?appId=<id>&file=<name> → the installer file
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { existsSync, promises as fsp } from 'fs';
import path from 'path';
import { handleDownloadGet, handleDownloadsList } from './downloads.js';

/** App ids are validated as a single safe path segment (no separators / traversal). */
const APP_ID_RE = /^[a-z0-9-]+$/;

/**
 * Locate the bundled App Store MANIFEST dir (resources/appstore). web-host runs
 * in the main process, so process.resourcesPath / cwd resolve like the desktop
 * registry. Env AIONUI_APPSTORE_DIR overrides.
 */
function resolveAppstoreManifestDir(): string | null {
  const candidates: string[] = [];
  if (process.env.AIONUI_APPSTORE_DIR) candidates.push(process.env.AIONUI_APPSTORE_DIR);
  const rp = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (rp) candidates.push(path.join(rp, 'appstore'));
  candidates.push(path.join(process.cwd(), 'resources', 'appstore'));
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

/**
 * GET /api/appstore/list — the app catalog for LAN/WebUI browsers (where the
 * Electron-main ipcBridge providers are unreachable). Reads the bundled
 * manifests directly. Same shape as ipcBridge.appstore.list.
 */
export async function handleAppstoreList(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const dir = resolveAppstoreManifestDir();
  const apps: unknown[] = [];
  if (dir) {
    try {
      const entries = (await fsp.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      for (const id of entries) {
        try {
          const m = JSON.parse(await fsp.readFile(path.join(dir, id, 'manifest.json'), 'utf-8'));
          if (m && typeof m.id === 'string') {
            apps.push({
              id: m.id,
              name: m.name || {},
              description: m.description || {},
              icon: m.icon || '',
              category: m.category || '',
              type: m.type || '',
              enabled: false,
              installed: false,
              artifacts: (m.distribution && m.distribution.artifacts) || [],
            });
          }
        } catch {
          // skip unreadable manifest
        }
      }
    } catch {
      // dir unreadable
    }
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ apps }));
}

/** Resolve the per-app installer dir from the (external) base env var, or undefined. */
export function resolveAppInstallerDir(appId: string): string | undefined {
  if (!APP_ID_RE.test(appId)) return undefined;
  const base = process.env.AIONUI_APPSTORE_INSTALLER_DIR;
  if (!base) return undefined;
  return path.join(base, appId);
}

function appIdOf(req: IncomingMessage): string {
  return new URL(req.url || '/', 'http://localhost').searchParams.get('appId') || '';
}

function rejectBadAppId(res: ServerResponse): void {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: 'INVALID_APP_ID' }));
}

/** GET /api/appstore/downloads/list?appId=<id> */
export async function handleAppDownloadsList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const appId = appIdOf(req);
  if (!APP_ID_RE.test(appId)) return rejectBadAppId(res);
  await handleDownloadsList(res, resolveAppInstallerDir(appId));
}

/** GET /api/appstore/downloads/get?appId=<id>&file=<name> */
export async function handleAppDownloadGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const appId = appIdOf(req);
  if (!APP_ID_RE.test(appId)) return rejectBadAppId(res);
  await handleDownloadGet(req, res, resolveAppInstallerDir(appId));
}
