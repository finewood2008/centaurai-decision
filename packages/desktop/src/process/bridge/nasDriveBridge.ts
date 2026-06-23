/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { nasFileInfo, nasList } from '@aionui/web-host';
import { ipcBridge } from '@/common';
import { resolveNasRootDir } from '../utils/webuiConfig';

/**
 * Enterprise network drive (read-only) — main-process IPC for the admin desktop
 * renderer. It reads the configured nasRootDir on this machine directly, so the
 * admin's "网盘" tab works whether or not the WebUI server is running and
 * regardless of LAN exposure. (When `allowRemote` is on, the desktop renderer
 * holds no auth-gate cookie, so the HTTP /api/nas/* routes would 401 — the
 * browser / distributed clients, which DO log in, use those routes instead.)
 *
 * Path containment (and symlink-escape rejection) is enforced inside nasList /
 * nasFileInfo, identical to the HTTP path.
 */
export function initNasDriveBridge(): void {
  ipcBridge.nasDriveLocal.list.provider(async ({ path }) => {
    const root = await resolveNasRootDir();
    if (!root) return { path: '', entries: [], disabled: true };
    try {
      const listing = await nasList(root, path);
      return { ...listing, disabled: false };
    } catch {
      // Containment violation or unreadable dir — surface an empty listing
      // rather than a hard error.
      return { path: path ?? '', entries: [], disabled: false };
    }
  });

  ipcBridge.nasDriveLocal.fileInfo.provider(async ({ path }) => {
    const root = await resolveNasRootDir();
    if (!root) return null;
    return nasFileInfo(root, path);
  });
}
