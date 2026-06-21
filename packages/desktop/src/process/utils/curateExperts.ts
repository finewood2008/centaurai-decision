/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { promises as fs } from 'fs';
import path from 'path';
import { resolveExpertsDir } from './seedBundledExperts';
import type { ProcessConfig as ProcessConfigType } from './initStorage';

/**
 * Curate the bundled expert library for the product's audience (Chinese SMEs)
 * by disabling the experts that don't fit — Western-only platforms, deep
 * infrastructure/engineering roles, academic/game/XR specialists, etc. The
 * keep/cut decision lives in `resources/experts/curated-out.json` (an array of
 * assistant ids), shipped alongside `experts.json`.
 *
 * "Disable" — not "delete": each cut id is flipped to `enabled=false` via the
 * backend `assistant_overrides` table (`PATCH /api/assistants/{id}/state`),
 * exactly like the Settings → Experts toggle. The expert vanishes from the home
 * showcase and the `/advisors` catalog (both filter `enabled !== false`) but its
 * data is untouched and an admin can re-enable it any time. This works on both
 * fresh installs (seed imports all, then this disables the cut set) and existing
 * installs (experts already present, this disables the cut set on next launch).
 *
 * Runs after {@link seedBundledExperts} and is gated by {@link CURATE_VERSION}
 * so it normally applies once; bump the version to re-apply when the curated set
 * changes. Re-enables an admin made by hand are preserved because the flag stops
 * the migration from re-running.
 */

const CURATE_VERSION = 1;
const CURATE_FLAG = 'migration.expertsCurated';

type ConfigFile = typeof ProcessConfigType;

type ConfigAccessor = {
  get: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown) => Promise<unknown>;
};

/**
 * Disable the bundled "curated-out" experts. Returns `true` on success
 * (including the no-op cases: already applied, or no dataset present); `false`
 * on a partial failure or when none of the target experts exist yet (e.g. the
 * seed step has not completed) so the caller leaves the flag unset and retries
 * on the next launch.
 */
export async function curateExperts(configFile: ConfigFile): Promise<boolean> {
  const accessor = configFile as unknown as ConfigAccessor;

  let appliedVersion = 0;
  try {
    const raw = await accessor.get(CURATE_FLAG);
    if (typeof raw === 'number') appliedVersion = raw;
  } catch {
    // Treat read errors as "not applied yet".
  }
  if (appliedVersion >= CURATE_VERSION) return true;

  const expertsDir = resolveExpertsDir();
  if (!expertsDir) {
    console.warn('[AionUi] Bundled experts dataset not found; skipping expert curation');
    return true;
  }

  let cutIds: string[];
  try {
    const raw = await fs.readFile(path.join(expertsDir, 'curated-out.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    cutIds = Array.isArray(parsed) ? (parsed.filter((id) => typeof id === 'string') as string[]) : [];
  } catch (error) {
    console.error('[AionUi] Failed to read curated-out experts list:', error);
    return false;
  }

  if (cutIds.length === 0) {
    await persistFlag(accessor);
    return true;
  }

  // Disable each cut expert. 404 = the id is not in the backend yet (seed hasn't
  // run, or a retired id) — count as skipped, not failed.
  const results = await Promise.allSettled(
    cutIds.map((id) => ipcBridge.assistants.setState.invoke({ id, enabled: false }))
  );

  let failed = 0;
  let skipped = 0;
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const reason = result.reason;
      if (isBackendHttpError(reason) && reason.status === 404) {
        skipped += 1;
        return;
      }
      failed += 1;
      console.error(`[AionUi] Failed to disable curated-out expert '${cutIds[index]}':`, reason);
    }
  });

  const applied = cutIds.length - failed - skipped;

  // Nothing applied and everything 404'd → the experts aren't present yet (seed
  // pending). Don't burn the flag; retry next launch once seeding succeeds.
  if (applied === 0 && skipped === cutIds.length) {
    console.warn('[AionUi] Expert curation deferred: no target experts present yet (seed pending?)');
    return false;
  }

  if (failed > 0) {
    console.error(`[AionUi] Expert curation partial: ${failed}/${cutIds.length} failed, ${skipped} skipped`);
    return false;
  }

  console.log(`[AionUi] Curated experts: disabled ${applied} (skipped ${skipped} not-present)`);
  await persistFlag(accessor);
  return true;
}

async function persistFlag(accessor: ConfigAccessor): Promise<void> {
  if (typeof accessor.set !== 'function') return;
  try {
    await accessor.set(CURATE_FLAG, CURATE_VERSION);
  } catch (error) {
    console.warn('[AionUi] Failed to persist expert curation flag', error);
  }
}
