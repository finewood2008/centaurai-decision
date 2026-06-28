/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEntryGuard, isValidEntryHtml, RECOVERY_HTML } from './entry-html-guard.js';

const GOOD =
  '<!doctype html><html><head><title>CentaurAI</title></head><body><div id="root"></div><script src="/assets/index-abc.js"></script></body></html>';

describe('isValidEntryHtml', () => {
  it('accepts a real entry document', () => {
    expect(isValidEntryHtml(GOOD)).toBe(true);
  });
  it('accepts a minimal but valid html doc', () => {
    expect(isValidEntryHtml('<!doctype html><title>root</title>')).toBe(true);
  });
  it('rejects empty / whitespace / null', () => {
    expect(isValidEntryHtml('')).toBe(false);
    expect(isValidEntryHtml('   \n  ')).toBe(false);
    expect(isValidEntryHtml(null)).toBe(false);
    expect(isValidEntryHtml(undefined)).toBe(false);
  });
  it('rejects a non-html fragment', () => {
    expect(isValidEntryHtml('not html at all, just some text payload')).toBe(false);
  });
});

describe('createEntryGuard', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'entry-guard-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const entry = (): string => path.join(dir, 'index.html');
  const backup = (): string => path.join(dir, 'index.html.bak');

  it('serves the live file and snapshots a backup when healthy', async () => {
    await fs.writeFile(entry(), GOOD);
    const guard = await createEntryGuard(dir);
    const r = await guard.getEntryHtml();
    expect(r.healed).toBe(false);
    expect(r.recovered).toBe(false);
    expect(r.html).toBe(GOOD);
    // A build-consistent backup was written.
    expect(await fs.readFile(backup(), 'utf8')).toBe(GOOD);
  });

  it('heals an empty index.html from the in-memory cache and restores the file', async () => {
    await fs.writeFile(entry(), GOOD);
    const guard = await createEntryGuard(dir); // seeds cache + backup from GOOD
    // Simulate the build truncating index.html to 0 bytes post-launch.
    await fs.writeFile(entry(), '');
    const r = await guard.getEntryHtml();
    expect(r.healed).toBe(true);
    expect(r.recovered).toBe(false);
    expect(r.html).toBe(GOOD);
    // On-disk file was restored so static/asset fetches recover too.
    expect(await fs.readFile(entry(), 'utf8')).toBe(GOOD);
  });

  it('heals from the on-disk backup when the guard has no cache (cold start, empty live)', async () => {
    // Backup from a prior good build exists, but the live file booted empty.
    await fs.writeFile(backup(), GOOD);
    await fs.writeFile(entry(), '');
    const guard = await createEntryGuard(dir);
    const r = await guard.getEntryHtml();
    expect(r.healed).toBe(true);
    expect(r.html).toBe(GOOD);
    expect(await fs.readFile(entry(), 'utf8')).toBe(GOOD);
  });

  it('serves the recovery page when nothing valid exists anywhere', async () => {
    await fs.writeFile(entry(), '');
    const guard = await createEntryGuard(dir);
    const r = await guard.getEntryHtml();
    expect(r.recovered).toBe(true);
    expect(r.healed).toBe(false);
    expect(r.html).toBe(RECOVERY_HTML);
  });

  it('handles a missing index.html (file absent) without throwing', async () => {
    const guard = await createEntryGuard(dir);
    const r = await guard.getEntryHtml();
    expect(r.recovered).toBe(true);
    expect(r.html).toBe(RECOVERY_HTML);
  });

  it('inspect() reports healthy without modifying disk', async () => {
    await fs.writeFile(entry(), GOOD);
    const guard = await createEntryGuard(dir);
    const h = await guard.inspect();
    expect(h.status).toBe('healthy');
    expect(h.liveOk).toBe(true);
    expect(h.healedCount).toBe(0);
    expect(h.hasBackup).toBe(true);
  });

  it('inspect() reports healed (with count) after a heal occurred', async () => {
    await fs.writeFile(entry(), GOOD);
    const guard = await createEntryGuard(dir);
    await fs.writeFile(entry(), ''); // corrupt
    await guard.getEntryHtml(); // heals, healedCount -> 1
    const h = await guard.inspect();
    expect(h.status).toBe('healed');
    expect(h.healedCount).toBe(1);
    expect(h.liveOk).toBe(true); // file was restored
  });

  it('inspect() reports unavailable when nothing valid exists', async () => {
    await fs.writeFile(entry(), '');
    const guard = await createEntryGuard(dir);
    const h = await guard.inspect();
    expect(h.status).toBe('unavailable');
    expect(h.hasBackup).toBe(false);
    expect(h.liveOk).toBe(false);
  });

  it('repair() heals a corrupt file and returns healthy/healed status', async () => {
    await fs.writeFile(entry(), GOOD);
    const guard = await createEntryGuard(dir);
    await fs.writeFile(entry(), ''); // corrupt after launch
    const h = await guard.repair();
    expect(h.status).toBe('healed');
    expect(h.liveOk).toBe(true);
    expect(await fs.readFile(entry(), 'utf8')).toBe(GOOD);
  });

  it('repair() on an already-healthy server is a safe no-op', async () => {
    await fs.writeFile(entry(), GOOD);
    const guard = await createEntryGuard(dir);
    const h = await guard.repair();
    expect(h.status).toBe('healthy');
    expect(h.healedCount).toBe(0);
  });

  it('repair() reports unavailable when there is nothing to restore', async () => {
    await fs.writeFile(entry(), '');
    const guard = await createEntryGuard(dir);
    const h = await guard.repair();
    expect(h.status).toBe('unavailable');
  });

  it('recovers automatically once a healthy file reappears', async () => {
    await fs.writeFile(entry(), '');
    const guard = await createEntryGuard(dir);
    expect((await guard.getEntryHtml()).recovered).toBe(true);
    // A rebuild lands a valid index.html.
    await fs.writeFile(entry(), GOOD);
    const r = await guard.getEntryHtml();
    expect(r.recovered).toBe(false);
    expect(r.healed).toBe(false);
    expect(r.html).toBe(GOOD);
  });
});
