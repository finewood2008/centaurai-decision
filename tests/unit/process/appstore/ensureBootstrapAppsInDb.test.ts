/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ensureBootstrapAppsInDb } from '@/process/appstore/ensureBootstrapAppsInDb';
import { listAppRecords, setAppEnabled, APPSTORE_APPS_KEY } from '@/process/appstore/appState';

type Cfg = Parameters<typeof listAppRecords>[0];

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

const validManifest = (id: string): Record<string, unknown> => ({
  manifestVersion: '1.0',
  id,
  version: '1.0.0',
  name: { 'en-US': id },
  description: { 'en-US': `${id} description` },
  icon: 'icon.svg',
  category: 'utility',
  trust: 'first-party',
  type: 'static-spa',
  runtime: { bundleDir: '.', entry: 'index.html' },
  routePrefix: `/apps/${id}`,
  permissions: { network: 'none', spawnProcess: false, agentOperable: false, shell: false },
});

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'appstore-seed-'));
  for (const id of ['alpha-app', 'beta-app']) {
    await mkdir(path.join(root, id), { recursive: true });
    await writeFile(path.join(root, id, 'manifest.json'), JSON.stringify(validManifest(id)), 'utf-8');
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ensureBootstrapAppsInDb', () => {
  it('seeds every bundled app as a disabled record', async () => {
    const { cfg } = makeConfig();
    expect(await ensureBootstrapAppsInDb(cfg, root)).toBe(true);
    expect(await listAppRecords(cfg)).toEqual({ 'alpha-app': { enabled: false }, 'beta-app': { enabled: false } });
  });

  it('is idempotent on re-run', async () => {
    const { cfg, store } = makeConfig();
    await ensureBootstrapAppsInDb(cfg, root);
    const afterFirst = JSON.stringify(store.get(APPSTORE_APPS_KEY));
    await ensureBootstrapAppsInDb(cfg, root);
    expect(JSON.stringify(store.get(APPSTORE_APPS_KEY))).toBe(afterFirst);
  });

  it('never clobbers an admin-set record (insert-only)', async () => {
    const { cfg } = makeConfig();
    await setAppEnabled(cfg, 'alpha-app', true);
    await ensureBootstrapAppsInDb(cfg, root);
    const records = await listAppRecords(cfg);
    expect(records['alpha-app']).toEqual({ enabled: true }); // preserved
    expect(records['beta-app']).toEqual({ enabled: false }); // newly seeded
  });

  it('is a no-op (returns true, writes nothing) when no apps are bundled', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'appstore-empty-'));
    const { cfg, store } = makeConfig();
    expect(await ensureBootstrapAppsInDb(cfg, empty)).toBe(true);
    expect(store.get(APPSTORE_APPS_KEY)).toBeUndefined();
    await rm(empty, { recursive: true, force: true });
  });
});
