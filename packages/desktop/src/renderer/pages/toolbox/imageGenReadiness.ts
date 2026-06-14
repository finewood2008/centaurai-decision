/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import type { ToolDef } from './types';

/** Route to the settings page where the image generation model is configured. */
export const IMAGE_MODEL_SETTINGS_ROUTE = '/settings/capabilities?tab=tools';

/** Whether the image generation model has been configured by the user. */
export function isImageGenerationReady(): boolean {
  const model = configService.get('tools.imageGenerationModel');
  if (!model) return false;
  return Boolean(model.id) && Boolean(model.use_model);
}

/**
 * Resolve whether a tool's preconditions are met.
 * Returns `{ ready: true }` or `{ ready: false, reason }` where `reason` is an
 * i18n key describing what the user must configure first.
 */
export function checkToolReadiness(
  tool: ToolDef
): { ready: true } | { ready: false; reasonKey: string; settingsRoute: string } {
  if (tool.requires === 'image-model' && !isImageGenerationReady()) {
    return {
      ready: false,
      reasonKey: 'toolbox.readiness.imageModelMissing',
      settingsRoute: IMAGE_MODEL_SETTINGS_ROUTE,
    };
  }
  return { ready: true };
}
