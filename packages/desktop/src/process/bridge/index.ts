/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { initApplicationBridge } from './applicationBridge';
import { initDialogBridge } from './dialogBridge';
import { initUpdateBridge } from './updateBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initWindowControlsBridge } from './windowControlsBridge';
import { initNotificationBridge } from './notificationBridge';
import { initWebuiBridge } from './webuiBridge';
import { initThemeBridge } from './themeBridge';
import { initImageGenBridge } from './imageGenBridge';
import { initUserManagementBridge } from './userManagementBridge';
import { initSharedDriveBridge } from './sharedDriveBridge';
import { initNasDriveBridge } from './nasDriveBridge';
import { initVideostudioBridge } from './videostudioBridge';
import { initAppstoreBridge } from './appstoreBridge';
import { initLocalModelManagerBridge } from './localModelManagerBridge';
import { initContentAssetsBridge } from './contentAssetsBridge';
import { MULTI_USER_ENABLED } from '@/common/config/constants';

export type BridgeDependencies = Record<string, never>;

export function initAllBridges(_deps: BridgeDependencies = {}): void {
  initDialogBridge();
  initApplicationBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initWebuiBridge();
  initThemeBridge();
  initImageGenBridge();
  // Multi-user CRUD IPC — full + Team. Never registering it on the Decision box
  // makes it structurally impossible to create a second account (single-user).
  if (MULTI_USER_ENABLED) initUserManagementBridge();
  initSharedDriveBridge();
  initNasDriveBridge();
  initVideostudioBridge();
  initAppstoreBridge();
  initLocalModelManagerBridge();
  initContentAssetsBridge();
}

export {
  initApplicationBridge,
  initDialogBridge,
  initNotificationBridge,
  initSystemSettingsBridge,
  initThemeBridge,
  initUpdateBridge,
  initWindowControlsBridge,
  initWebuiBridge,
  initImageGenBridge,
  initUserManagementBridge,
  initSharedDriveBridge,
  initNasDriveBridge,
  initVideostudioBridge,
  initAppstoreBridge,
  initLocalModelManagerBridge,
  initContentAssetsBridge,
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
