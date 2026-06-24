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
import path from 'path';
import { handleDownloadGet, handleDownloadsList } from './downloads.js';

/** App ids are validated as a single safe path segment (no separators / traversal). */
const APP_ID_RE = /^[a-z0-9-]+$/;

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
