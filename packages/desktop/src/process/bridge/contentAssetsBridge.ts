/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import {
  contentAssetArchive,
  contentAssetDiscardDraft,
  contentAssetIndex,
  contentAssetPromoteDraft,
  contentAssetSaveFromPath,
  contentAssetStageFromPath,
  contentAssetsList,
} from '@aionui/web-host';
import { ipcBridge } from '@/common';
import { getDataPath } from '../utils/utils';

const OWNER_USER_ID = 'system_default_user';

function assetsDir(): string {
  return path.join(getDataPath(), 'contentAssets');
}

export function initContentAssetsBridge(): void {
  ipcBridge.contentAssetsLocal.list.provider(async () => contentAssetsList(assetsDir(), OWNER_USER_ID));
  ipcBridge.contentAssetsLocal.stageFromPath.provider(async (input) =>
    contentAssetStageFromPath(assetsDir(), { ...input, ownerUserId: OWNER_USER_ID })
  );
  ipcBridge.contentAssetsLocal.saveFromPath.provider(async (input) =>
    contentAssetSaveFromPath(assetsDir(), { ...input, ownerUserId: OWNER_USER_ID })
  );
  ipcBridge.contentAssetsLocal.promoteDraft.provider(async ({ id }) =>
    contentAssetPromoteDraft(assetsDir(), id, OWNER_USER_ID)
  );
  ipcBridge.contentAssetsLocal.index.provider(async ({ id, endpoint }) =>
    contentAssetIndex(assetsDir(), id, OWNER_USER_ID, { endpoint })
  );
  ipcBridge.contentAssetsLocal.archive.provider(async ({ id }) => contentAssetArchive(assetsDir(), id, OWNER_USER_ID));
  ipcBridge.contentAssetsLocal.discardDraft.provider(async ({ id }) =>
    contentAssetDiscardDraft(assetsDir(), id, OWNER_USER_ID)
  );
}
