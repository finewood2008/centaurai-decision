/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { mcpService } from '@/common/adapter/ipcBridge';
import { configService } from '@/common/config/configService';
import type { ConfigKeyMap } from '@/common/config/configKeys';
import { removeImageGenerationEnvKeys, resolveImageGenerationMcpEnv } from '@/common/config/imageGenerationMcpEnv';
import { BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME, type IProvider } from '@/common/config/storage';
import { isImageGenSupported } from '@/common/utils/imageModelAllowlist';

export type ImageModelRegistry = NonNullable<ConfigKeyMap['tools.imageGenerationModels']>;
export type ImageGenerationModelSelection = ConfigKeyMap['tools.imageGenerationModel'];
export type ImageGenerationModelProvider = IProvider & { models: string[] };

const normalizeModelName = (name: string): string => name.trim();

const uniqueModels = (models: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawModel of models) {
    const model = normalizeModelName(rawModel);
    if (!model || seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }
  return result;
};

export const getImageModelValue = (providerId: string, modelName: string): string =>
  JSON.stringify([providerId, modelName]);

export const parseImageModelValue = (value: string): { providerId: string; modelName: string } | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [providerId, modelName] = parsed;
    if (typeof providerId !== 'string' || typeof modelName !== 'string') return null;
    return { providerId, modelName };
  } catch {
    return null;
  }
};

export const getImageModelRegistry = (): ImageModelRegistry => configService.get('tools.imageGenerationModels') ?? {};

export const isExplicitImageModel = (
  providerId: string,
  modelName: string,
  registry: ImageModelRegistry | undefined = getImageModelRegistry()
): boolean => {
  return Boolean(registry?.[providerId]?.includes(modelName));
};

export const buildImageGenerationModelProviders = (
  providers: IProvider[] | undefined,
  registry: ImageModelRegistry | undefined = getImageModelRegistry(),
  selected: Partial<ImageGenerationModelSelection> | undefined = configService.get('tools.imageGenerationModel')
): ImageGenerationModelProvider[] => {
  return (providers ?? [])
    .map((provider) => {
      const explicitModels = registry?.[provider.id] ?? [];
      const detectedModels = (provider.models ?? []).filter(
        (modelName) => isImageGenSupported(provider, modelName) || explicitModels.includes(modelName)
      );
      const selectedModel = selected?.id === provider.id && selected.use_model ? [selected.use_model] : [];
      return {
        ...provider,
        models: uniqueModels([...detectedModels, ...explicitModels, ...selectedModel]),
      };
    })
    .filter((provider) => provider.models.length > 0);
};

export const createImageGenerationSelection = (
  provider: IProvider,
  modelName: string,
  previous?: Partial<ImageGenerationModelSelection>
): ImageGenerationModelSelection => ({
  ...provider,
  base_url: '',
  api_key: '',
  use_model: modelName,
  switch: previous?.switch,
});

const isBuiltinImageGenServer = (server: { builtin?: boolean; id?: string; name?: string }): boolean =>
  server.builtin === true && (server.id === BUILTIN_IMAGE_GEN_ID || server.name === BUILTIN_IMAGE_GEN_NAME);

export async function syncImageGenerationMcpEnv(
  selection: Partial<ImageGenerationModelSelection>,
  providers?: IProvider[]
): Promise<void> {
  const servers = await mcpService.listServers.invoke();
  const builtinServer = servers.find(isBuiltinImageGenServer);
  if (!builtinServer || builtinServer.transport.type !== 'stdio') return;

  const providerList = providers ?? (await ipcBridge.mode.listProviders.invoke());
  const existingEnv = builtinServer.transport.env || {};
  let env: Record<string, string>;

  if (!selection.id && !selection.use_model) {
    env = removeImageGenerationEnvKeys(existingEnv);
  } else {
    const resolution = resolveImageGenerationMcpEnv(selection, providerList, existingEnv);
    if (resolution.ok === false) {
      throw new Error(resolution.message);
    }
    env = {
      ...removeImageGenerationEnvKeys(existingEnv),
      ...resolution.env,
    };
  }

  const sameEnv =
    Object.keys(existingEnv).length === Object.keys(env).length &&
    Object.keys(existingEnv).every((key) => existingEnv[key] === env[key]);
  if (sameEnv) return;

  const updatedTransport = { ...builtinServer.transport, env };
  const original_json = JSON.stringify(
    {
      mcpServers: {
        [builtinServer.name]: {
          command: updatedTransport.command,
          args: updatedTransport.args || [],
          env,
        },
      },
    },
    null,
    2
  );

  await mcpService.updateServer.invoke({
    id: builtinServer.id,
    data: {
      transport: updatedTransport,
      original_json,
    },
  });
}

export async function setImageGenerationModelSelection(
  provider: IProvider,
  modelName: string,
  providers?: IProvider[]
): Promise<ImageGenerationModelSelection> {
  const current = configService.get('tools.imageGenerationModel');
  const selection = createImageGenerationSelection(provider, modelName, current);
  await configService.set('tools.imageGenerationModel', selection);
  await syncImageGenerationMcpEnv(selection, providers);
  return selection;
}

export async function registerImageGenerationModel(providerId: string, modelName: string): Promise<ImageModelRegistry> {
  const name = normalizeModelName(modelName);
  if (!providerId || !name) return getImageModelRegistry();

  const registry = getImageModelRegistry();
  const nextModels = uniqueModels([...(registry[providerId] ?? []), name]);
  const next = {
    ...registry,
    [providerId]: nextModels,
  };
  await configService.set('tools.imageGenerationModels', next);
  return next;
}

export async function unregisterImageGenerationModel(
  providerId: string,
  modelName: string
): Promise<ImageModelRegistry | undefined> {
  const registry = getImageModelRegistry();
  const nextModels = (registry[providerId] ?? []).filter((item) => item !== modelName);
  const next = { ...registry };
  if (nextModels.length > 0) {
    next[providerId] = nextModels;
  } else {
    delete next[providerId];
  }
  const hasModels = Object.keys(next).length > 0;
  if (hasModels) {
    await configService.set('tools.imageGenerationModels', next);
    return next;
  }
  await configService.remove('tools.imageGenerationModels');
  return undefined;
}
