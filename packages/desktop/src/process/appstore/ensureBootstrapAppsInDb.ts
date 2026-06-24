/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CentaurAI App Store — bootstrap seed (insert-only).
 *
 * Reconciles the bundled app manifests ({@link getApps}) into the ConfigFile
 * app-records map: every bundled app missing a record gets seeded **disabled**
 * (LAN OFF by default; an admin opts an app in later). Insert-only — an existing
 * record (including an admin's enable/disable choice) is never clobbered. Runs
 * every launch so newly-bundled apps appear automatically; a launch with nothing
 * missing is a no-op. Mirrors `seedBundledExperts`' ConfigFile + insert-only
 * shape, registered as a `MIGRATION_STEPS` entry.
 *
 * Main-process only.
 */

import type { ProcessConfig as ProcessConfigType } from '@/process/utils/initStorage';
import { getApps } from './registry';
import { listAppRecords, writeAppRecords } from './appState';

type ConfigFile = typeof ProcessConfigType;

/**
 * Seed missing bundled apps as disabled records. Returns `true` on success
 * (including the no-op cases). `appstoreDir` overrides the scanned directory
 * (tests pass a fixture dir).
 */
export async function ensureBootstrapAppsInDb(configFile: ConfigFile, appstoreDir?: string | null): Promise<boolean> {
  const apps = await getApps(appstoreDir);
  if (apps.length === 0) return true;

  const records = await listAppRecords(configFile);
  const seeded: string[] = [];
  for (const app of apps) {
    if (!(app.id in records)) {
      records[app.id] = { enabled: false };
      seeded.push(app.id);
    }
  }

  if (seeded.length > 0) {
    await writeAppRecords(configFile, records);
    console.info(`[Migration] App Store seeded ${seeded.length} new app record(s) (disabled): ${seeded.join(', ')}`);
  }
  return true;
}
