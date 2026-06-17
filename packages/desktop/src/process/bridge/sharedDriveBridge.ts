/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { sharedAddFromPath, sharedBlobInfo, sharedCategories, sharedList, sharedRemove } from '@aionui/web-host';
import { ipcBridge } from '@/common';
import { getDataPath } from '../utils/utils';

/**
 * Shared library — main-process IPC for the admin desktop renderer.
 *
 * The shared library is hosted in <dataDir>/sharedDrive on this machine. The
 * admin renderer reaches it directly via these IPC handlers, so sharing works
 * whether or not the WebUI server is running. Browser / distributed clients use
 * the HTTP routes served by web-host's static-server instead. Both operate on
 * the same directory and manifest.
 */
function sharedDir(): string {
  return path.join(getDataPath(), 'sharedDrive');
}

export function initSharedDriveBridge(): void {
  ipcBridge.sharedDriveLocal.list.provider(async ({ category }) => sharedList(sharedDir(), category));

  ipcBridge.sharedDriveLocal.listCategories.provider(async () => sharedCategories(sharedDir()));

  ipcBridge.sharedDriveLocal.addFromPath.provider(async (input) => {
    const entry = await sharedAddFromPath(sharedDir(), input.sourcePath, {
      name: input.name,
      category: input.category,
      uploaderId: input.uploaderId,
      uploaderName: input.uploaderName,
      conversationId: input.conversationId,
    });
    return { id: entry.id };
  });

  ipcBridge.sharedDriveLocal.remove.provider(async ({ id }) => sharedRemove(sharedDir(), id));

  ipcBridge.sharedDriveLocal.blobInfo.provider(async ({ id }) => sharedBlobInfo(sharedDir(), id));
}
