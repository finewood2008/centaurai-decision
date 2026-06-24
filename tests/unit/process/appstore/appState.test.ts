/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  listAppRecords,
  isAppEnabled,
  isAppInstalled,
  setAppEnabled,
  setAppInstalled,
  APPSTORE_APPS_KEY,
} from '@/process/appstore/appState';

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

  it('setAppEnabled writes and listAppRecords reads back (with installed default false)', async () => {
    const { cfg, store } = makeConfig();
    await setAppEnabled(cfg, 'app-a', true);
    expect(await listAppRecords(cfg)).toEqual({ 'app-a': { enabled: true, installed: false } });
    expect(store.get(APPSTORE_APPS_KEY)).toEqual({ 'app-a': { enabled: true, installed: false } });
  });

  it('setAppInstalled and setAppEnabled merge (preserve the other field)', async () => {
    const { cfg } = makeConfig();
    await setAppInstalled(cfg, 'app-a', true);
    expect(await listAppRecords(cfg)).toEqual({ 'app-a': { enabled: false, installed: true } });
    await setAppEnabled(cfg, 'app-a', true);
    expect(await listAppRecords(cfg)).toEqual({ 'app-a': { enabled: true, installed: true } });
  });

  it('setAppEnabled preserves other records', async () => {
    const { cfg } = makeConfig({ [APPSTORE_APPS_KEY]: { 'app-a': { enabled: true, installed: true } } });
    await setAppEnabled(cfg, 'app-b', false);
    expect(await listAppRecords(cfg)).toEqual({
      'app-a': { enabled: true, installed: true },
      'app-b': { enabled: false, installed: false },
    });
  });

  it('isAppEnabled / isAppInstalled honor stored value and fallback', async () => {
    const { cfg } = makeConfig({ [APPSTORE_APPS_KEY]: { 'app-a': { enabled: true, installed: true } } });
    expect(await isAppEnabled(cfg, 'app-a')).toBe(true);
    expect(await isAppInstalled(cfg, 'app-a')).toBe(true);
    expect(await isAppEnabled(cfg, 'missing')).toBe(false);
    expect(await isAppInstalled(cfg, 'missing')).toBe(false);
    expect(await isAppEnabled(cfg, 'missing', true)).toBe(true);
  });

  it('normalizes legacy/partial records and tolerates non-object config', async () => {
    const garbage = makeConfig({ [APPSTORE_APPS_KEY]: 'garbage' });
    expect(await listAppRecords(garbage.cfg)).toEqual({});
    // a legacy record with only `enabled` → installed defaults false; bad-typed values coerce to false
    const legacy = makeConfig({ [APPSTORE_APPS_KEY]: { a: { enabled: true }, b: { installed: 'yes' } } });
    expect(await listAppRecords(legacy.cfg)).toEqual({
      a: { enabled: true, installed: false },
      b: { enabled: false, installed: false },
    });
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
