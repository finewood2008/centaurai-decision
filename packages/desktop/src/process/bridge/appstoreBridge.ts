/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * App Store IPC bridge — exposes the bundled app catalog (manifest registry ⨉
 * ConfigFile enabled-state) to the renderer.
 */

import { ipcBridge } from '@/common';
import { getApps } from '@process/appstore/registry';
import { listAppRecords } from '@process/appstore/appState';
import { ProcessConfig } from '@process/utils/initStorage';

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
        })),
      };
    } catch (error) {
      console.error('[AppStore] Failed to list apps:', error);
      return { apps: [] };
    }
  });
}
