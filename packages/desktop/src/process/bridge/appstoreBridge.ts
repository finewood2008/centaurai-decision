/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App Store IPC bridge — exposes the bundled app catalog (manifest registry ⨉
 * ConfigFile state) and the CentaurAI-MANAGED install/launch of standalone apps:
 * "install" copies the app bundle into a default dir under userData; "launch"
 * spawns it as its own standalone window (a separate process, not embedded in
 * CentaurAI). The launch entry stays in the CentaurAI App Store.
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ipcBridge } from '@/common';
import { getApps } from '@process/appstore/registry';
import { listAppRecords, setAppInstalled } from '@process/appstore/appState';
import { ProcessConfig } from '@process/utils/initStorage';

/**
 * Per-app desktop launch bundle. `source` dirs (`copy`) are placed in the
 * managed install dir; `entry` is the Electron main run there. Dev paths for
 * now (a packaged bundle source replaces these later).
 */
const APP_BUNDLES: Record<string, { source: string; copy: string[]; entry: string }> = {
  'centaur-image-workbench': {
    source: '/home/user/桌面/gpt_image_playground',
    copy: ['electron', 'dist'],
    entry: 'electron/main.cjs',
  },
};

function appInstallDir(id: string): string {
  return path.join(app.getPath('userData'), 'appstore-apps', id);
}

export function initAppstoreBridge(): void {
  ipcBridge.appstore.list.provider(async () => {
    try {
      const [manifests, records] = await Promise.all([getApps(), listAppRecords(ProcessConfig)]);
      return {
        apps: manifests.map((manifest) => ({
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          icon: manifest.icon,
          category: manifest.category,
          type: manifest.type,
          enabled: records[manifest.id]?.enabled ?? false,
          installed: records[manifest.id]?.installed ?? false,
          artifacts: manifest.distribution?.artifacts ?? [],
        })),
      };
    } catch (error) {
      console.error('[AppStore] Failed to list apps:', error);
      return { apps: [] };
    }
  });

  ipcBridge.appstore.setInstalled.provider(async ({ id, installed }) => {
    try {
      await setAppInstalled(ProcessConfig, id, installed);
    } catch (error) {
      console.error('[AppStore] Failed to set installed state:', error);
    }
  });

  // Managed install — copy the app bundle into a default dir under userData.
  ipcBridge.appstore.install.provider(async ({ id }) => {
    const bundle = APP_BUNDLES[id];
    if (!bundle) return { ok: false, error: 'NO_BUNDLE' };
    try {
      const dest = appInstallDir(id);
      await fs.rm(dest, { recursive: true, force: true });
      await fs.mkdir(dest, { recursive: true });
      for (const sub of bundle.copy) {
        await fs.cp(path.join(bundle.source, sub), path.join(dest, sub), { recursive: true });
      }
      await setAppInstalled(ProcessConfig, id, true);
      console.info(`[AppStore] installed '${id}' → ${dest}`);
      return { ok: true };
    } catch (error) {
      console.error('[AppStore] install failed:', error);
      return { ok: false, error: String(error) };
    }
  });

  // Managed launch — spawn the installed app as its own standalone window.
  ipcBridge.appstore.launch.provider(async ({ id }) => {
    const bundle = APP_BUNDLES[id];
    if (!bundle) return { ok: false, error: 'NO_BUNDLE' };
    try {
      const entry = path.join(appInstallDir(id), bundle.entry);
      await fs.access(entry);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE; // ensure the child boots as an Electron app, not node
      const child = spawn(process.execPath, [entry, '--no-sandbox', '--disable-gpu'], {
        detached: true,
        stdio: 'ignore',
        env,
      });
      child.unref();
      console.info(`[AppStore] launched standalone '${id}'`);
      return { ok: true };
    } catch (error) {
      console.error('[AppStore] launch failed:', error);
      return { ok: false, error: String(error) };
    }
  });
}
