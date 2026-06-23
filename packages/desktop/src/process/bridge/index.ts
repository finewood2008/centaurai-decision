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
  initUserManagementBridge();
  initSharedDriveBridge();
  initNasDriveBridge();
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
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
