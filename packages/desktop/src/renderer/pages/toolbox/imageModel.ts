/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import type { IProvider } from '@/common/config/storage';
import {
  buildImageGenerationModelProviders,
  getImageModelValue,
  parseImageModelValue,
  setImageGenerationModelSelection,
  type ImageGenerationModelProvider,
  type ImageModelRegistry,
} from '@/renderer/utils/model/imageGenerationModels';

/** The currently configured image-model select value. */
export function getCurrentImageModelValue(): string {
  const cfg = configService.get('tools.imageGenerationModel');
  return cfg?.id && cfg.use_model ? getImageModelValue(cfg.id, cfg.use_model) : '';
}

/** Eligible image-model providers shown in toolbox selectors. */
export function getImageModelOptions(
  providers: IProvider[] | undefined,
  registry?: ImageModelRegistry
): ImageGenerationModelProvider[] {
  return buildImageGenerationModelProviders(providers, registry, configService.get('tools.imageGenerationModel'));
}

/** Persist a new image-model choice and sync the builtin image MCP env. */
export async function applyImageModelSelection(value: string, providers: IProvider[] | undefined): Promise<void> {
  const parsed = parseImageModelValue(value);
  if (!parsed) return;
  const provider = providers?.find((item) => item.id === parsed.providerId);
  if (!provider) return;
  await setImageGenerationModelSelection(provider, parsed.modelName, providers);
}
