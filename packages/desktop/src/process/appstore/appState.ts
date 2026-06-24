/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CentaurAI App Store — per-app enabled state, persisted in ConfigFile.
 *
 * The "app record" is the admin-intent source of truth: `configFile['appstore.apps']`
 * maps app id → `{ enabled }`. There is NO new backend table (mirrors how
 * `seedBundledExperts` stores its seed flag in ConfigFile). This intent record
 * is read by the bootstrap seed ({@link ensureBootstrapAppsInDb}), the web-host
 * config builder, and the kill-switch; each surface derives its own runtime
 * enforcement from it.
 *
 * Main-process only.
 */

import type { ProcessConfig as ProcessConfigType } from '@/process/utils/initStorage';

type ConfigFile = typeof ProcessConfigType;

/** ConfigFile carries typed keys; `appstore.apps` is accessed via this loose view. */
type ConfigAccessor = {
  get: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown) => Promise<unknown>;
};

/** ConfigFile key holding the app-records map. */
export const APPSTORE_APPS_KEY = 'appstore.apps';

/** Admin intent for one app. */
export type AppRecord = { enabled: boolean };

/** All app records, keyed by app id. */
export type AppRecords = Record<string, AppRecord>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read the app-records map, tolerating absent/corrupt config (→ `{}`). */
export async function listAppRecords(configFile: ConfigFile): Promise<AppRecords> {
  const accessor = configFile as unknown as ConfigAccessor;
  let raw: unknown;
  try {
    raw = await accessor.get(APPSTORE_APPS_KEY);
  } catch {
    return {};
  }
  if (!isRecord(raw)) return {};

  const records: AppRecords = {};
  for (const [id, rec] of Object.entries(raw)) {
    if (isRecord(rec) && typeof rec.enabled === 'boolean') {
      records[id] = { enabled: rec.enabled };
    }
  }
  return records;
}

/** Persist the full app-records map (no-op if the config is read-only). */
export async function writeAppRecords(configFile: ConfigFile, records: AppRecords): Promise<void> {
  const accessor = configFile as unknown as ConfigAccessor;
  if (typeof accessor.set !== 'function') return;
  await accessor.set(APPSTORE_APPS_KEY, records);
}

/** Whether an app is enabled; `fallback` (default `false`) when it has no record. */
export async function isAppEnabled(configFile: ConfigFile, id: string, fallback = false): Promise<boolean> {
  const records = await listAppRecords(configFile);
  const record = records[id];
  return record ? record.enabled : fallback;
}

/** Set one app's enabled state, preserving all other records. */
export async function setAppEnabled(configFile: ConfigFile, id: string, enabled: boolean): Promise<void> {
  const records = await listAppRecords(configFile);
  records[id] = { enabled };
  await writeAppRecords(configFile, records);
}
