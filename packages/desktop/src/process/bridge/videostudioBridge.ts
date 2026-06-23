/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Desktop IPC bridge that lazily spawns the local Centaur Video Workbench
 * (opencut-classic / Next.js) dev server so the embedded webview in the
 * Toolbox "Video Workbench" card has a backing origin.
 *
 * A server already listening healthily on the port (e.g. started by the
 * standalone desktop launcher) is reused instead of spawned. The spawned
 * child is killed on app quit.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { app } from 'electron';
import { ipcBridge } from '@/common';
import type { IVideoStudioStatus } from '@/common/adapter/ipcBridge';

/** opencut-classic web app directory and the bun binary used to run it. */
const VIDEO_DIR = '/home/user/opencut-classic/apps/web';
const BUN_BIN = '/home/user/.bun/bin/bun';
const VIDEO_PORT = 3000;
const VIDEO_URL = `http://localhost:${VIDEO_PORT}`;
const READY_TIMEOUT_MS = 60_000;

let child: ChildProcess | null = null;
let startInflight: Promise<IVideoStudioStatus> | null = null;

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${VIDEO_URL}/`, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForHealthy(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // Sequential polling: each probe must await the previous one (and the delay).
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    if (await isHealthy()) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function stopVideoStudio(): void {
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

async function startVideoStudio(): Promise<IVideoStudioStatus> {
  // Reuse an already-running healthy server (standalone launcher / manual dev).
  if (await isHealthy()) {
    return { running: true, port: VIDEO_PORT, url: VIDEO_URL, reused: true };
  }
  if (!existsSync(VIDEO_DIR)) {
    return { running: false, error: `Video workbench project not found at ${VIDEO_DIR}` };
  }
  if (!child || child.killed) {
    const proc = spawn(BUN_BIN, ['run', 'dev'], {
      cwd: VIDEO_DIR,
      env: { ...process.env, PORT: String(VIDEO_PORT), NODE_ENV: 'development' },
      stdio: 'ignore',
    });
    child = proc;
    proc.on('exit', () => {
      if (child === proc) child = null;
    });
    proc.on('error', () => {
      if (child === proc) child = null;
    });
  }
  const ok = await waitForHealthy(READY_TIMEOUT_MS);
  if (!ok) {
    stopVideoStudio();
    return { running: false, error: 'Video workbench did not become ready in time' };
  }
  return { running: true, port: VIDEO_PORT, url: VIDEO_URL };
}

export function initVideostudioBridge(): void {
  ipcBridge.videostudio.getStatus.provider(async () => {
    const healthy = await isHealthy();
    return {
      running: healthy,
      port: healthy ? VIDEO_PORT : undefined,
      url: healthy ? VIDEO_URL : undefined,
    };
  });

  ipcBridge.videostudio.start.provider(async () => {
    if (!startInflight) {
      startInflight = startVideoStudio().finally(() => {
        startInflight = null;
      });
    }
    const status = await startInflight;
    ipcBridge.videostudio.statusChanged.emit(status);
    return status;
  });

  ipcBridge.videostudio.stop.provider(async () => {
    stopVideoStudio();
    ipcBridge.videostudio.statusChanged.emit({ running: false });
  });

  app.on('before-quit', stopVideoStudio);
}
