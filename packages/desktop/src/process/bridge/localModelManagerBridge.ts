/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Desktop IPC bridge that launches the standalone Local Model Manager app
 * (a separate Tauri binary, `local-model-manager`). All local-model
 * management (pull / delete / run / hardware-fit) lives in that app; CentaurAI
 * only spawns it as its own detached window and consumes the resulting ollama
 * models via an OpenAI-compatible provider. The spawned child is killed on
 * app quit.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import type { ILocalModelManagerStatus } from '@/common/adapter/ipcBridge';

let child: ChildProcess | null = null;

/** Platform-specific binary filename. */
function binaryName(): string {
  return process.platform === 'win32' ? 'local-model-manager.exe' : 'local-model-manager';
}

/**
 * Resolve the manager binary across dev / packaged installs.
 * Order: explicit env override → bundled resources → known dev build path → PATH.
 * Returns null when no existing binary is found, so callers can surface a clear
 * "not installed" error instead of spawning a non-existent path silently.
 *
 * NOTE: for packaged/distributable builds the binary must be bundled — add a
 * `local-model-manager-bin/` entry to electron-builder.yml extraResources so
 * the `resourcesPath` probe below resolves. Dev runs use the dev build path.
 */
function resolveBinary(): string | null {
  const name = binaryName();

  const envBin = process.env.LOCAL_MODEL_MANAGER_BIN;
  if (envBin && existsSync(envBin)) return envBin;

  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'local-model-manager-bin', name);
    if (existsSync(bundled)) return bundled;
  }

  // Known local dev build location.
  const devPath = '/home/user/桌面/local-model-manager/src-tauri/target/release/local-model-manager';
  if (existsSync(devPath)) return devPath;

  // PATH lookup — only accept a hit that actually resolves to a file.
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const out = spawnSync(finder, [name], { encoding: 'utf8' });
    if (out.status === 0) {
      const hit = out.stdout.split(/\r?\n/)[0]?.trim();
      if (hit && existsSync(hit)) return hit;
    }
  } catch {
    // ignore — fall through to not-found
  }

  return null;
}

function isAlive(): boolean {
  return !!child && !child.killed;
}

function stopManager(): void {
  const proc = child;
  child = null;
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch {
        // already gone
      }
    }, 3000);
  }
}

function startManager(): ILocalModelManagerStatus {
  if (isAlive()) return { running: true, pid: child?.pid };

  const binaryPath = resolveBinary();
  if (!binaryPath) {
    return { running: false, error: 'Local Model Manager binary not found' };
  }

  try {
    const proc = spawn(binaryPath, [], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    proc.unref();
    child = proc;
    proc.on('exit', () => {
      if (child === proc) child = null;
      ipcBridge.localModelManager.statusChanged.emit({ running: false });
    });
    proc.on('error', (err) => {
      if (child === proc) child = null;
      ipcBridge.localModelManager.statusChanged.emit({ running: false, error: err.message });
    });
    return { running: true, pid: proc.pid };
  } catch (err) {
    child = null;
    return { running: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function initLocalModelManagerBridge(): void {
  ipcBridge.localModelManager.start.provider(async () => {
    const status = startManager();
    ipcBridge.localModelManager.statusChanged.emit(status);
    return status;
  });

  ipcBridge.localModelManager.status.provider(async () => ({
    running: isAlive(),
    pid: child?.pid,
  }));

  app.on('before-quit', stopManager);
}
