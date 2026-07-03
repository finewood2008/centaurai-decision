/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Desktop IPC bridge for WebUI lifecycle (start/stop/getStatus).
 *
 * WebUI credential operations (change-password / change-username / reset-password /
 * generate-qr-token) are NOT handled here — those are HTTP routes on aioncore's
 * local-only /api/webui/*, called directly by the renderer via ipcBridge HTTP.
 *
 * This bridge owns only the lifecycle + status snapshot, because spawning a
 * WebUI instance requires Electron's app.* / Node child_process — aioncore
 * has no way to start a WebUI wrapper around itself.
 */

import os from 'os';
import { ipcBridge } from '@/common';
import {
  startDesktopWebUI,
  stopDesktopWebUI,
  getDesktopWebUIStatus,
  getDesktopWebUIEntryHealth,
  healDesktopWebUIIfNeeded,
  repairDesktopWebUIEntry,
  setDesktopWebUIInitialPassword,
} from '@process/utils/webuiConfig';
import { advertiseServer, discoverServersOnce, type AdvertiseHandle } from '@process/discovery/lanDiscovery';

type AdminUsernameResult = { username?: string };

/** Active LAN advertisement while the WebUI server runs (for the distributed
 *  client's auto-discovery). Started on WebUI start, stopped on WebUI stop. */
let advertiseHandle: AdvertiseHandle | null = null;

async function stopAdvertising(): Promise<void> {
  if (advertiseHandle) {
    const handle = advertiseHandle;
    advertiseHandle = null;
    await handle.stop().catch(() => {});
  }
}

export async function announceDesktopWebUIStarted(handle: {
  port: number;
  allowRemote: boolean;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  initialPassword?: string;
}): Promise<void> {
  ipcBridge.webui.statusChanged.emit({
    running: true,
    port: handle.port,
    allowRemote: handle.allowRemote,
    localUrl: handle.localUrl,
    networkUrl: handle.networkUrl,
    lanIP: handle.lanIP,
    initialPassword: handle.initialPassword,
  });

  await stopAdvertising();
  if (!handle.allowRemote) return;

  try {
    advertiseHandle = advertiseServer({
      name: `CentaurAI · ${os.hostname()}`,
      port: handle.port,
      // share='1' tells distributed clients this server hosts the LAN shared library.
      info: {
        ver: process.env.npm_package_version || '',
        os: process.platform,
        lanIP: handle.lanIP || '',
        share: '1',
      },
    });
  } catch {
    // Non-fatal: discovery is a convenience; manual connect still works.
  }
}

function getBackendPort(): number | undefined {
  return (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
}

async function fetchAdminUsername(): Promise<string> {
  const port = getBackendPort();
  if (!port) return 'admin';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/internal/users/system`);
    if (!res.ok) return 'admin';
    const json = (await res.json()) as { data?: AdminUsernameResult | null };
    return json.data?.username ?? 'admin';
  } catch {
    return 'admin';
  }
}

/**
 * On first Enable-WebUI click after a fresh install, the backend's users table
 * holds the seeded `system_default_user` row with an empty password_hash.
 * Probe /api/auth/status; if `needs_setup === true`, ask backend to generate
 * and persist a random password, then stash the plaintext for Settings to show
 * once. When the backend already has credentials (upgrade path handled by
 * ensureAdminUser, or a prior Enable-WebUI), this is a no-op.
 */
async function maybeSeedInitialPassword(): Promise<void> {
  const port = getBackendPort();
  if (!port) {
    throw new Error('[WebUI] Cannot start: aioncore is not running (globalThis.__backendPort unset)');
  }
  const statusRes = await fetch(`http://127.0.0.1:${port}/api/auth/status`);
  if (!statusRes.ok) {
    throw new Error(`[WebUI] /api/auth/status returned ${statusRes.status}`);
  }
  const statusJson = (await statusRes.json()) as { needs_setup?: boolean; data?: { needs_setup?: boolean } };
  const needsSetup = statusJson.needs_setup ?? statusJson.data?.needs_setup ?? false;
  if (!needsSetup) {
    setDesktopWebUIInitialPassword(undefined);
    return;
  }
  const resetRes = await fetch(`http://127.0.0.1:${port}/api/webui/reset-password`, { method: 'POST' });
  if (!resetRes.ok) {
    throw new Error(`[WebUI] /api/webui/reset-password returned ${resetRes.status}`);
  }
  const resetJson = (await resetRes.json()) as { data?: { new_password?: string }; new_password?: string };
  const newPassword = resetJson.data?.new_password ?? resetJson.new_password;
  if (!newPassword) {
    throw new Error('[WebUI] /api/webui/reset-password returned no new_password');
  }
  setDesktopWebUIInitialPassword(newPassword);
}

export function initWebuiBridge(): void {
  ipcBridge.webui.getStatus.provider(async () => {
    const healedHandle = await healDesktopWebUIIfNeeded();
    if (healedHandle) await announceDesktopWebUIStarted(healedHandle);
    const snapshot = getDesktopWebUIStatus();
    const adminUsername = await fetchAdminUsername();
    // Entry-page health only exists while the server runs; null otherwise.
    const entryHealth = snapshot.running ? await getDesktopWebUIEntryHealth() : null;
    return { ...snapshot, adminUsername, entryHealth };
  });

  // "Repair connection": force a re-check + heal of the WebUI entry page.
  ipcBridge.webui.repairConnection.provider(async () => {
    const result = await repairDesktopWebUIEntry();
    const snapshot = getDesktopWebUIStatus();
    if (snapshot.running) await announceDesktopWebUIStarted(snapshot);
    return result;
  });

  ipcBridge.webui.start.provider(async (params) => {
    await maybeSeedInitialPassword();
    const handle = await startDesktopWebUI({
      port: params?.port,
      allowRemote: params?.allowRemote,
    });
    await announceDesktopWebUIStarted(handle);
    return handle;
  });

  ipcBridge.webui.stop.provider(async () => {
    await stopAdvertising();
    await stopDesktopWebUI();
    ipcBridge.webui.statusChanged.emit({ running: false });
  });

  // LAN discovery: let the renderer (distributed client's "select server"
  // screen) browse for CentaurAI servers advertised on the network.
  ipcBridge.discovery.list.provider(async (params: { timeoutMs?: number } | undefined) => {
    return discoverServersOnce(params?.timeoutMs ?? 3000);
  });
}
