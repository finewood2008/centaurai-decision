/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Self-healing guard for the SPA entry document (out/renderer/index.html).
 *
 * Why this exists: the WebUI is the only way LAN/browser users reach CentaurAI,
 * and it always serves `staticDir/index.html`. We have seen the renderer build
 * intermittently emit (or a post-build step truncate) a 0-byte index.html while
 * every hashed asset under assets/ stayed intact. serve-handler then returns an
 * empty `200`, so LAN users type the address and get a blank page that looks
 * like "the site won't open". The fix that ships is the same one we apply by
 * hand — keep a known-good copy and serve/restore it — but automated.
 *
 * Two cooperating writers keep the backup build-consistent (its asset hashes
 * must match the assets actually on disk, or healing would reference files that
 * no longer exist):
 *   1. Build time — the renderer build writes `index.html.bak` right after a
 *      valid index.html is emitted, in the SAME build (see electron.vite.config).
 *   2. Run time — this guard refreshes `index.html.bak` whenever it observes a
 *      valid live index.html, which by definition belongs to the current build.
 *
 * Healing precedence on a bad live file: in-memory cache → on-disk `.bak` →
 * a built-in recovery page (503) telling the admin to rebuild. The recovery
 * page is the last resort for the genuinely-unrecoverable case (no good copy
 * has ever been seen); it is strictly better than a blank document.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const ENTRY_FILE = 'index.html';
const BACKUP_FILE = 'index.html.bak';

/**
 * Decide whether an index.html payload is a usable SPA entry document.
 *
 * Deliberately lenient: the only failure mode observed in the wild is an empty
 * or truncated file, so we reject empty/whitespace/too-short payloads and ones
 * that carry no HTML document marker at all. We do NOT require `id="root"` or a
 * `<script>` tag — those vary across builds and minimal pages, and a stricter
 * check would risk false positives that replace a working page with the
 * recovery screen.
 */
export function isValidEntryHtml(html: string | null | undefined): html is string {
  if (typeof html !== 'string') return false;
  const trimmed = html.trim();
  if (trimmed.length < 20) return false;
  return /<!doctype html|<html|<head|<body|<title|id=["']root["']/i.test(html);
}

/**
 * Built-in fallback served (HTTP 503) only when no valid entry document exists
 * anywhere — live file, in-memory cache, and on-disk backup are all unusable.
 * Auto-retries so users recover without manual refresh once a rebuild lands.
 * Self-contained (no external assets) so it renders even when the bundle is
 * broken — which is exactly when it is needed.
 */
export const RECOVERY_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CentaurAI · 正在恢复</title>
<meta http-equiv="refresh" content="10" />
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#f5efe6;color:#3a342c;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .card{max-width:520px;padding:40px;text-align:center}
  .dot{width:14px;height:14px;border-radius:50%;background:#c8623a;display:inline-block;
       animation:p 1.2s ease-in-out infinite}
  @keyframes p{0%,100%{opacity:.3}50%{opacity:1}}
  h1{font-size:20px;margin:18px 0 8px}
  p{font-size:14px;line-height:1.7;color:#6b6256;margin:4px 0}
  code{background:#ece3d5;padding:2px 6px;border-radius:4px}
</style>
</head>
<body>
  <div class="card">
    <span class="dot"></span>
    <h1>服务正在恢复中</h1>
    <p>页面资源暂时不可用，系统正在尝试自动修复，本页面将每 10 秒自动重试。</p>
    <p>若持续无法访问，请联系管理员在服务端重新构建前端：<code>bun run package</code>。</p>
    <p style="margin-top:16px;color:#9a9081">The app is recovering. This page will retry automatically.</p>
  </div>
</body>
</html>
`;

export type EntryHtmlResult = {
  /** HTML to serve for the SPA entry / fallback request. Always non-empty. */
  html: string;
  /** True when the live file was bad and we served a backup/cache instead. */
  healed: boolean;
  /** True when nothing valid existed and we served {@link RECOVERY_HTML}. */
  recovered: boolean;
};

/** Display-oriented health status surfaced to the remote-access settings UI. */
export type EntryHealthStatus = 'healthy' | 'healed' | 'unavailable';

export type EntryHealth = {
  /**
   * - `healthy`     — live index.html on disk is valid and never needed healing.
   * - `healed`      — self-healing has compensated (either it restored the file
   *                   at least once, or the live file is currently bad but a
   *                   backup exists so the next request/repair will recover it).
   * - `unavailable` — live file is bad AND no backup exists; needs a rebuild.
   */
  status: EntryHealthStatus;
  /** Times the live file was found bad and restored from a backup since boot. */
  healedCount: number;
  /** A known-good copy exists (in-memory cache or on-disk .bak) to heal from. */
  hasBackup: boolean;
  /** Whether the live on-disk index.html is valid right now. */
  liveOk: boolean;
};

export type EntryGuard = {
  /**
   * Resolve the entry document for the current request, healing the on-disk
   * file from a backup when the live copy is empty/corrupt. Never throws and
   * never returns an empty body.
   */
  getEntryHtml: () => Promise<EntryHtmlResult>;
  /** Read-only health snapshot for the settings UI; never modifies disk. */
  inspect: () => Promise<EntryHealth>;
  /**
   * User-triggered "repair connection": force a check + heal of the on-disk
   * index.html, then return the resulting health. Idempotent and safe to call
   * when already healthy (it just re-confirms).
   */
  repair: () => Promise<EntryHealth>;
};

/**
 * Create a guard bound to a renderer `staticDir`. Seeds its in-memory cache and
 * (re)writes the `.bak` snapshot from the live index.html if that is currently
 * valid, so the very first good launch establishes a build-consistent backup.
 */
export async function createEntryGuard(staticDir: string): Promise<EntryGuard> {
  const entryPath = path.join(staticDir, ENTRY_FILE);
  const backupPath = path.join(staticDir, BACKUP_FILE);

  // Last-known-good HTML held in memory so healing survives even if the backup
  // file is also removed mid-flight.
  let cached: string | null = null;
  // Times we found the live file bad and restored it since this guard was made.
  let healedCount = 0;

  const readIfValid = async (p: string): Promise<string | null> => {
    try {
      const html = await fs.readFile(p, 'utf8');
      return isValidEntryHtml(html) ? html : null;
    } catch {
      return null;
    }
  };

  // Best-effort, non-fatal: a write failure (read-only fs, race) must never
  // break request serving — we still have the in-memory cache.
  const writeQuiet = async (p: string, data: string): Promise<void> => {
    try {
      await fs.writeFile(p, data, 'utf8');
    } catch {
      /* ignore */
    }
  };

  // Seed: prefer the live file (it matches the current build's assets); fall
  // back to an existing backup from a prior good build.
  cached = (await readIfValid(entryPath)) ?? (await readIfValid(backupPath));
  if (cached && (await readIfValid(entryPath)) === cached) {
    // Live is good → keep the backup aligned with the current build.
    await writeQuiet(backupPath, cached);
  }

  const getEntryHtml = async (): Promise<EntryHtmlResult> => {
    const live = await readIfValid(entryPath);
    if (live) {
      // Healthy path. Keep cache + backup warm for the current build.
      if (live !== cached) {
        cached = live;
        await writeQuiet(backupPath, live);
      }
      return { html: live, healed: false, recovered: false };
    }

    // Live file is empty/corrupt/missing → heal from cache, then backup.
    const good = cached ?? (await readIfValid(backupPath));
    if (good) {
      cached = good;
      healedCount += 1;
      // Restore the on-disk file so direct asset/static fetches recover too,
      // not just this in-memory response.
      await writeQuiet(entryPath, good);
      return { html: good, healed: true, recovered: false };
    }

    // Nothing valid anywhere — genuinely needs a rebuild.
    return { html: RECOVERY_HTML, healed: false, recovered: true };
  };

  const inspect = async (): Promise<EntryHealth> => {
    const liveOk = (await readIfValid(entryPath)) !== null;
    const hasBackup = isValidEntryHtml(cached) || (await readIfValid(backupPath)) !== null;
    let status: EntryHealthStatus;
    if (liveOk) status = healedCount > 0 ? 'healed' : 'healthy';
    else if (hasBackup) status = 'healed';
    else status = 'unavailable';
    return { status, healedCount, hasBackup, liveOk };
  };

  const repair = async (): Promise<EntryHealth> => {
    // Force the heal path against the on-disk file, then report fresh health.
    await getEntryHtml();
    return inspect();
  };

  return { getEntryHtml, inspect, repair };
}
