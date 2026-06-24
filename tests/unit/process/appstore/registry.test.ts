/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { getApps, getAppById } from '@/process/appstore/registry';

/** Minimal valid static-spa manifest for an id. */
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
  root = await mkdtemp(path.join(os.tmpdir(), 'appstore-registry-'));
  const writeApp = async (dir: string, manifest: unknown) => {
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
  };
  await writeApp('beta-app', validManifest('beta-app'));
  await writeApp('alpha-app', validManifest('alpha-app'));
  // Invalid: schema-forbidden shell:true → must be skipped.
  await writeApp('bad-shell', {
    ...validManifest('bad-shell'),
    permissions: { network: 'none', spawnProcess: false, agentOperable: false, shell: true },
  });
  // A directory with no manifest.json → silently skipped.
  await mkdir(path.join(root, 'empty-dir'), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('getApps', () => {
  it('loads valid manifests id-sorted and skips invalid / empty ones', async () => {
    const apps = await getApps(root);
    expect(apps.map((a) => a.id)).toEqual(['alpha-app', 'beta-app']);
  });

  it('returns [] when the directory is absent', async () => {
    expect(await getApps(null)).toEqual([]);
  });

  it('returns [] for a missing directory path', async () => {
    expect(await getApps(path.join(root, 'does-not-exist'))).toEqual([]);
  });
});

describe('getAppById', () => {
  it('finds an app by id', async () => {
    const app = await getAppById('alpha-app', root);
    expect(app?.id).toBe('alpha-app');
    expect(app?.routePrefix).toBe('/apps/alpha-app');
  });

  it('returns null for an unknown id', async () => {
    expect(await getAppById('nope', root)).toBeNull();
  });
});

describe('bundled seed manifest', () => {
  it('the shipped centaur-image-workbench manifest is valid and loads', async () => {
    const apps = await getApps(path.resolve(process.cwd(), 'resources/appstore'));
    const image = apps.find((a) => a.id === 'centaur-image-workbench');
    expect(image).toBeTruthy();
    expect(image?.type).toBe('static-spa');
    expect(image?.routePrefix).toBe('/apps/centaur-image-workbench');
    expect(image?.permissions.agentOperable).toBe(true);
  });
});
