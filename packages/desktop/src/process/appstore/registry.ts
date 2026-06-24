/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CentaurAI App Store — bundled manifest registry (main process).
 *
 * Scans the bundled `resources/appstore/<id>/manifest.json` files, validates
 * each via {@link validateManifest}, skips+logs invalid ones, and returns the
 * accepted manifests in a stable (id-sorted) order. Mirrors the
 * `getToolboxTools()` registry shape and the `resolveExpertsDir()` resource
 * resolution from `seedBundledExperts.ts`.
 *
 * Main-process only (uses `fs`/`path`/`process.resourcesPath`). The renderer
 * obtains the app list over IPC (added by a later slice), never by importing
 * this module.
 */

import { existsSync, promises as fs } from 'fs';
import path from 'path';
import type { AppManifest } from '@/common/appstore/appManifest';
import { validateManifest } from '@/common/appstore/manifestLoader';

const APPSTORE_DIR_NAME = 'appstore';

/**
 * Locate the bundled App Store directory. In production electron-builder copies
 * `resources/appstore` → `<resourcesPath>/appstore`; in dev it sits in the repo
 * relative to the main bundle (`out/main`) or the cwd. Returns the first
 * candidate that exists, or null when the dataset is absent.
 */
export function resolveAppstoreDir(): string | null {
  const candidates: string[] = [];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) candidates.push(path.join(resourcesPath, APPSTORE_DIR_NAME));

  const baseDir =
    typeof require !== 'undefined' && require.main?.filename ? path.dirname(require.main.filename) : __dirname;
  candidates.push(path.resolve(baseDir, '../../resources/appstore'));
  candidates.push(path.resolve(baseDir, '../../../resources/appstore'));
  candidates.push(path.resolve(process.cwd(), 'resources/appstore'));

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Load and validate every bundled app manifest.
 *
 * @param rootDir the App Store directory to scan. Defaults to
 *                {@link resolveAppstoreDir}; pass an explicit dir in tests.
 * @returns accepted manifests, id-sorted; invalid ones are skipped (logged).
 */
export async function getApps(rootDir: string | null = resolveAppstoreDir()): Promise<AppManifest[]> {
  if (!rootDir) {
    console.warn('[CentaurAI] App Store: no bundled manifests found; loading zero apps');
    return [];
  }

  let appDirs: string[];
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    appDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (error) {
    console.error('[CentaurAI] App Store: failed to scan directory', error);
    return [];
  }

  const accepted: AppManifest[] = [];
  for (const dirName of appDirs) {
    const manifestPath = path.join(rootDir, dirName, 'manifest.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    } catch (error) {
      console.warn(`[CentaurAI] App Store: skipping '${dirName}' — unreadable manifest.json`, error);
      continue;
    }

    const result = validateManifest(parsed, accepted);
    if (!result.ok || !result.manifest) {
      console.warn(`[CentaurAI] App Store: rejected '${dirName}' (${result.reason}): ${result.message}`);
      continue;
    }
    if (result.manifest.id !== dirName) {
      console.warn(`[CentaurAI] App Store: directory '${dirName}' holds app id '${result.manifest.id}'`);
    }
    accepted.push(result.manifest);
  }
  return accepted;
}

/** Load a single app manifest by id, or null when absent/invalid. */
export async function getAppById(id: string, rootDir?: string | null): Promise<AppManifest | null> {
  const apps = await getApps(rootDir ?? resolveAppstoreDir());
  return apps.find((a) => a.id === id) ?? null;
}
