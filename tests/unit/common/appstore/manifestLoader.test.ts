/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { AppManifest } from '@/common/appstore/appManifest';
import { validateManifest } from '@/common/appstore/manifestLoader';

/** A fresh, fully-valid raw manifest object for each case to mutate. */
const validRaw = (): Record<string, unknown> => ({
  manifestVersion: '1.0',
  id: 'centaur-image-workbench',
  version: '1.0.0',
  name: { 'zh-CN': '半人马 AI 图形工作台', 'en-US': 'Centaur Image Studio' },
  description: { 'en-US': 'Prompt-to-image and editing' },
  icon: 'icon.svg',
  category: 'media',
  trust: 'first-party',
  type: 'static-spa',
  runtime: { bundleDir: '.', entry: 'index.html', queryProfile: 'model=gpt-image-2' },
  routePrefix: '/apps/centaur-image-workbench',
  keepAlive: false,
  permissions: { network: 'proxy-only', spawnProcess: false, agentOperable: true, shell: false },
  credentials: [
    {
      key: 'imageApi',
      label: { 'en-US': 'Image model API key' },
      providerCapability: 'image-generation',
      sources: ['byok', 'platform'],
      inject: { via: 'header', name: 'Authorization', scheme: 'Bearer' },
    },
  ],
  upstreams: { image: { originRef: 'tokenclub-image', credential: 'imageApi' } },
  proxy: { prefix: '/apps/centaur-image-workbench/__proxy' },
  agent: {
    bridge: { kind: 'backend-mcp' },
    tools: [
      {
        name: 'image_generate',
        action: 'generate',
        description: 'Generate an image',
        inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
        requiresAppOpen: false,
        timeoutMs: 120000,
      },
    ],
  },
});

describe('validateManifest — accept', () => {
  it('accepts a well-formed static-spa manifest and round-trips it', () => {
    const result = validateManifest(validRaw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe('centaur-image-workbench');
      expect(result.manifest.routePrefix).toBe('/apps/centaur-image-workbench');
    }
  });

  it('accepts a native-panel manifest with no routePrefix', () => {
    const raw = validRaw();
    raw.type = 'native-panel';
    delete raw.routePrefix;
    delete raw.proxy;
    expect(validateManifest(raw).ok).toBe(true);
  });
});

describe('validateManifest — hard rejects', () => {
  it('rejects a non-object', () => {
    for (const bad of [null, undefined, 42, 'x', [validRaw()]]) {
      const r = validateManifest(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not-object');
    }
  });

  it('rejects a missing required field (id)', () => {
    const raw = validRaw();
    delete raw.id;
    const r = validateManifest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-field');
  });

  it('rejects permissions.shell === true', () => {
    const raw = validRaw();
    (raw.permissions as Record<string, unknown>).shell = true;
    const r = validateManifest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('shell-forbidden');
  });

  it('rejects bad routePrefix values', () => {
    const cases = ['/api/x', '/apps/a..b', '/apps/a%2e', '/apps/Foo', '//apps/x', '/apps/a/b', '/apps/'];
    for (const prefix of cases) {
      const raw = validRaw();
      raw.routePrefix = prefix;
      const r = validateManifest(raw);
      expect(r.ok, `expected ${prefix} to reject`).toBe(false);
      if (!r.ok) expect(r.reason).toBe('route-prefix-invalid');
    }
  });

  it('requires routePrefix for static-spa', () => {
    const raw = validRaw();
    delete raw.routePrefix;
    const r = validateManifest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-field');
  });

  it('rejects the deferred app type (remote-url)', () => {
    const raw = validRaw();
    raw.type = 'remote-url';
    const r = validateManifest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('app-type-unsupported');
  });

  it('accepts local-service apps (e.g. the video workbench)', () => {
    const raw = validRaw();
    raw.type = 'local-service';
    expect(validateManifest(raw).ok).toBe(true);
  });

  it('rejects deferred agent bridge kinds', () => {
    for (const kind of ['service-httpbus', 'static-spa-postmessage']) {
      const raw = validRaw();
      (raw.agent as Record<string, unknown>).bridge = { kind };
      const r = validateManifest(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('bridge-kind-unsupported');
    }
  });
});

describe('validateManifest — collisions against the accumulator', () => {
  const accepted = (): AppManifest => {
    const r = validateManifest(validRaw());
    if (!r.ok) throw new Error('fixture should be valid');
    return r.manifest;
  };

  it('rejects a duplicate id', () => {
    const raw = validRaw();
    raw.routePrefix = '/apps/other-prefix';
    const r = validateManifest(raw, [accepted()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('id-collision');
  });

  it('rejects a duplicate routePrefix', () => {
    const raw = validRaw();
    raw.id = 'a-different-app';
    const r = validateManifest(raw, [accepted()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('route-prefix-collision');
  });

  it('accepts a distinct app alongside an existing one', () => {
    const raw = validRaw();
    raw.id = 'a-different-app';
    raw.routePrefix = '/apps/a-different-app';
    expect(validateManifest(raw, [accepted()]).ok).toBe(true);
  });
});
