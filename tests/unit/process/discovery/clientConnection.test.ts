/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_REMOTE_SERVER_KEY,
  loadClientRemoteServer,
  loadReachableClientRemoteServer,
  normalizeClientRemoteServer,
  saveClientRemoteServer,
} from '@/process/discovery/clientConnection';

vi.mock('@/process/discovery/lanDiscovery', () => ({
  probeLanServer: vi.fn(),
}));

type Config = Parameters<typeof loadClientRemoteServer>[0];

const makeConfig = (initial?: unknown) => {
  const store = new Map<string, unknown>();
  if (initial !== undefined) store.set(CLIENT_REMOTE_SERVER_KEY, initial);
  const config = {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
  return { config: config as unknown as Config, store };
};

describe('clientConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('normalizes valid saved LAN server config', () => {
    expect(normalizeClientRemoteServer({ host: ' 192.168.1.76 ', port: '25809', updatedAt: 42 })).toEqual({
      host: '192.168.1.76',
      port: 25809,
      updatedAt: 42,
    });
  });

  it('rejects missing host and invalid ports', () => {
    expect(normalizeClientRemoteServer({ host: '', port: 25809 })).toBeNull();
    expect(normalizeClientRemoteServer({ host: '192.168.1.76', port: 0 })).toBeNull();
    expect(normalizeClientRemoteServer({ host: '192.168.1.76', port: 70000 })).toBeNull();
  });

  it('loads null when the local config is absent or unreadable', async () => {
    const { config } = makeConfig();
    expect(await loadClientRemoteServer(config)).toBeNull();

    const throwingConfig = {
      get: async () => {
        throw new Error('boom');
      },
    } as unknown as Config;
    expect(await loadClientRemoteServer(throwingConfig)).toBeNull();
  });

  it('saves a normalized server for the next client launch', async () => {
    const { config, store } = makeConfig();

    await expect(saveClientRemoteServer(config, ' 192.168.1.76 ', 25809)).resolves.toEqual({
      host: '192.168.1.76',
      port: 25809,
      updatedAt: Date.now(),
    });
    expect(store.get(CLIENT_REMOTE_SERVER_KEY)).toEqual({
      host: '192.168.1.76',
      port: 25809,
      updatedAt: Date.now(),
    });
  });

  it('restores a saved server only when it is reachable', async () => {
    const { probeLanServer } = await import('@/process/discovery/lanDiscovery');
    vi.mocked(probeLanServer).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const reachable = makeConfig({ host: '192.168.1.76', port: 25809, updatedAt: 1 });
    await expect(loadReachableClientRemoteServer(reachable.config)).resolves.toEqual({
      host: '192.168.1.76',
      port: 25809,
      updatedAt: 1,
    });

    const stale = makeConfig({ host: '192.168.1.99', port: 25809, updatedAt: 1 });
    await expect(loadReachableClientRemoteServer(stale.config)).resolves.toBeNull();
  });
});
