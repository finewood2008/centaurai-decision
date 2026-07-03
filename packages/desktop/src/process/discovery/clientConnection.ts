/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProcessConfig as ProcessConfigType } from '@process/utils/initStorage';
import { probeLanServer } from './lanDiscovery';

export const CLIENT_REMOTE_SERVER_KEY = 'client.remoteServer';

export type ClientRemoteServer = {
  host: string;
  port: number;
  updatedAt: number;
};

type ConfigFile = typeof ProcessConfigType;

export const normalizeClientRemoteServer = (value: unknown): ClientRemoteServer | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { host?: unknown; port?: unknown; updatedAt?: unknown };
  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  const port = typeof raw.port === 'number' ? raw.port : Number(raw.port);
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, updatedAt };
};

export async function loadClientRemoteServer(config: ConfigFile): Promise<ClientRemoteServer | null> {
  try {
    return normalizeClientRemoteServer(await config.get(CLIENT_REMOTE_SERVER_KEY));
  } catch {
    return null;
  }
}

export async function saveClientRemoteServer(
  config: ConfigFile,
  host: string,
  port: number
): Promise<ClientRemoteServer> {
  const normalized = normalizeClientRemoteServer({ host, port, updatedAt: Date.now() });
  if (!normalized) {
    throw new Error('Invalid LAN server address');
  }
  await config.set(CLIENT_REMOTE_SERVER_KEY, normalized);
  return normalized;
}

export async function loadReachableClientRemoteServer(config: ConfigFile): Promise<ClientRemoteServer | null> {
  const saved = await loadClientRemoteServer(config);
  if (!saved) return null;
  const reachable = await probeLanServer(saved.host, saved.port);
  return reachable ? saved : null;
}
