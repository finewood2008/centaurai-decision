/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import {
  indexNasFolder,
  nasFileInfo,
  nasList,
  nasMkdir,
  nasMove,
  nasRemove,
  nasTrashEmpty,
  nasTrashList,
  nasTrashRemove,
  nasTrashRestore,
  nasUploadFromPath,
  type NasIndexProgress,
} from '@aionui/web-host';
import { ipcBridge } from '@/common';
import { resolveNasRootDir } from '../utils/webuiConfig';

// In-memory index-job registry. Admin-desktop only; jobs live for the session.
type IndexJob = NasIndexProgress & { cancelled?: boolean };
const indexJobs = new Map<string, IndexJob>();

/**
 * Enterprise network drive (read-only) — main-process IPC for the admin desktop
 * renderer. It reads the configured nasRootDir on this machine directly, so the
 * admin's "网盘" tab works whether or not the WebUI server is running and
 * regardless of LAN exposure. (When `allowRemote` is on, the desktop renderer
 * holds no auth-gate cookie, so the HTTP /api/nas/* routes would 401 — the
 * browser / distributed clients, which DO log in, use those routes instead.)
 *
 * Path containment (and symlink-escape rejection) is enforced inside nasList /
 * nasFileInfo, identical to the HTTP path.
 */
export function initNasDriveBridge(): void {
  ipcBridge.nasDriveLocal.list.provider(async ({ path }) => {
    const root = await resolveNasRootDir();
    if (!root) return { path: '', entries: [], disabled: true };
    try {
      const listing = await nasList(root, path);
      return { ...listing, disabled: false };
    } catch {
      // Containment violation or unreadable dir — surface an empty listing
      // rather than a hard error.
      return { path: path ?? '', entries: [], disabled: false };
    }
  });

  ipcBridge.nasDriveLocal.fileInfo.provider(async ({ path }) => {
    const root = await resolveNasRootDir();
    if (!root) return null;
    return nasFileInfo(root, path);
  });

  ipcBridge.nasDriveLocal.mkdir.provider(async ({ path, name }) => {
    const root = await resolveNasRootDir();
    if (!root) return null;
    const relPath = await nasMkdir(root, path, name);
    return relPath == null ? null : { relPath };
  });

  ipcBridge.nasDriveLocal.remove.provider(async ({ path }) => {
    const root = await resolveNasRootDir();
    if (!root) return false;
    return nasRemove(root, path);
  });

  ipcBridge.nasDriveLocal.move.provider(async ({ from, to }) => {
    const root = await resolveNasRootDir();
    if (!root) return false;
    return nasMove(root, from, to);
  });

  ipcBridge.nasDriveLocal.uploadFromPath.provider(async ({ path, sourcePath, name }) => {
    const root = await resolveNasRootDir();
    if (!root) return null;
    const relPath = await nasUploadFromPath(root, path, sourcePath, name);
    return relPath == null ? null : { relPath };
  });

  ipcBridge.nasDriveLocal.trashList.provider(async () => {
    const root = await resolveNasRootDir();
    if (!root) return [];
    return nasTrashList(root);
  });

  ipcBridge.nasDriveLocal.trashRestore.provider(async ({ trashName }) => {
    const root = await resolveNasRootDir();
    if (!root) return null;
    const relPath = await nasTrashRestore(root, trashName);
    return relPath == null ? null : { relPath };
  });

  ipcBridge.nasDriveLocal.trashRemove.provider(async ({ trashName }) => {
    const root = await resolveNasRootDir();
    if (!root) return false;
    return nasTrashRemove(root, trashName);
  });

  ipcBridge.nasDriveLocal.trashEmpty.provider(async () => {
    const root = await resolveNasRootDir();
    if (!root) return false;
    return nasTrashEmpty(root);
  });

  ipcBridge.nasDriveLocal.indexFolder.provider(async ({ path: relPath, endpoint, includeVideo }) => {
    const root = await resolveNasRootDir();
    const jobId = crypto.randomUUID();
    if (!root) {
      indexJobs.set(jobId, {
        phase: 'error',
        total: 0,
        done: 0,
        failed: 0,
        skipped: 0,
        pruned: 0,
        error: 'NAS_DISABLED',
      });
      return { jobId };
    }
    indexJobs.set(jobId, { phase: 'walking', total: 0, done: 0, failed: 0, skipped: 0, pruned: 0 });
    // Fire and forget; the renderer polls indexStatus.
    void indexNasFolder(root, relPath, {
      endpoint: endpoint || 'http://127.0.0.1:8618',
      includeVideo,
      onProgress: (p) => {
        const cancelled = indexJobs.get(jobId)?.cancelled;
        indexJobs.set(jobId, { ...p, cancelled });
      },
      isCancelled: () => indexJobs.get(jobId)?.cancelled === true,
    }).catch((err) => {
      const prev = indexJobs.get(jobId);
      indexJobs.set(jobId, {
        phase: 'error',
        total: prev?.total ?? 0,
        done: prev?.done ?? 0,
        failed: prev?.failed ?? 0,
        skipped: prev?.skipped ?? 0,
        pruned: prev?.pruned ?? 0,
        error: String((err as Error)?.message ?? err),
      });
    });
    return { jobId };
  });

  ipcBridge.nasDriveLocal.indexStatus.provider(async ({ jobId }) => indexJobs.get(jobId) ?? null);

  ipcBridge.nasDriveLocal.indexCancel.provider(async ({ jobId }) => {
    const job = indexJobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    return true;
  });
}
