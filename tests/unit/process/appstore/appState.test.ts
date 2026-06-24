/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { listAppRecords, isAppEnabled, setAppEnabled, APPSTORE_APPS_KEY } from '@/process/appstore/appState';

type Cfg = Parameters<typeof listAppRecords>[0];

/** In-memory ConfigFile stand-in. */
const makeConfig = (initial: Record<string, unknown> = {}) => {
  const store = new Map<string, unknown>(Object.entries(initial));
  const cfg = {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
  return { cfg: cfg as unknown as Cfg, store };
};

describe('appState', () => {
  it('returns {} when no records exist', async () => {
    const { cfg } = makeConfig();
    expect(await listAppRecords(cfg)).toEqual({});
  });

  it('setAppEnabled writes and listAppRecords reads back', async () => {
    const { cfg, store } = makeConfig();
    await setAppEnabled(cfg, 'app-a', true);
    expect(await listAppRecords(cfg)).toEqual({ 'app-a': { enabled: true } });
    expect(store.get(APPSTORE_APPS_KEY)).toEqual({ 'app-a': { enabled: true } });
  });

  it('setAppEnabled preserves other records', async () => {
    const { cfg } = makeConfig({ [APPSTORE_APPS_KEY]: { 'app-a': { enabled: true } } });
    await setAppEnabled(cfg, 'app-b', false);
    expect(await listAppRecords(cfg)).toEqual({ 'app-a': { enabled: true }, 'app-b': { enabled: false } });
  });

  it('isAppEnabled honors stored value and fallback', async () => {
    const { cfg } = makeConfig({ [APPSTORE_APPS_KEY]: { 'app-a': { enabled: true } } });
    expect(await isAppEnabled(cfg, 'app-a')).toBe(true);
    expect(await isAppEnabled(cfg, 'missing')).toBe(false);
    expect(await isAppEnabled(cfg, 'missing', true)).toBe(true);
  });

  it('tolerates corrupt config shapes', async () => {
    const garbage = makeConfig({ [APPSTORE_APPS_KEY]: 'garbage' });
    expect(await listAppRecords(garbage.cfg)).toEqual({});
    const badShape = makeConfig({ [APPSTORE_APPS_KEY]: { x: { enabled: 'yes' } } });
    expect(await listAppRecords(badShape.cfg)).toEqual({});
  });

  it('tolerates a get() that throws', async () => {
    const cfg = {
      get: async () => {
        throw new Error('boom');
      },
    } as unknown as Cfg;
    expect(await listAppRecords(cfg)).toEqual({});
  });
});
