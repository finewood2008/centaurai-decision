/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  resolveAppInstallerDir,
  handleAppDownloadsList,
  handleAppDownloadGet,
  handleAppstoreList,
} from '../../../packages/web-host/src/app-downloads';

const mockRes = () => {
  const r = {
    statusCode: 0,
    headers: {} as Record<string, unknown>,
    body: '',
    writeHead(s: number, h?: Record<string, unknown>) {
      r.statusCode = s;
      if (h) r.headers = h;
      return r;
    },
    end(b?: string) {
      if (b) r.body += b;
      return r;
    },
  };
  return r;
};

const req = (url: string): IncomingMessage => ({ url }) as IncomingMessage;
const json = (r: ReturnType<typeof mockRes>) => JSON.parse(r.body || '{}');

let base: string;
const APP = 'centaur-image-workbench';
const FILE = 'CentaurImageStudio-1.0.0-windows-x64.exe';

beforeAll(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'appstore-dl-'));
  await mkdir(path.join(base, APP), { recursive: true });
  await writeFile(path.join(base, APP, FILE), 'dummy-installer-bytes', 'utf-8');
  process.env.AIONUI_APPSTORE_INSTALLER_DIR = base;
});

afterAll(async () => {
  delete process.env.AIONUI_APPSTORE_INSTALLER_DIR;
  await rm(base, { recursive: true, force: true });
});

describe('resolveAppInstallerDir', () => {
  it('joins a valid appId under the env base', () => {
    expect(resolveAppInstallerDir(APP)).toBe(path.join(base, APP));
  });
  it('rejects appIds with separators / traversal', () => {
    expect(resolveAppInstallerDir('../client-installers')).toBeUndefined();
    expect(resolveAppInstallerDir('a/b')).toBeUndefined();
    expect(resolveAppInstallerDir('Foo')).toBeUndefined();
  });
});

describe('handleAppstoreList', () => {
  it('returns an empty catalog while the App Store has no published content', async () => {
    const previous = process.env.AIONUI_APPSTORE_DIR;
    try {
      process.env.AIONUI_APPSTORE_DIR = path.resolve(process.cwd(), 'resources/appstore');
      const r = mockRes();
      await handleAppstoreList(req('/api/appstore/list'), r as unknown as ServerResponse);
      expect(r.statusCode).toBe(200);
      expect(json(r)).toEqual({ apps: [] });
    } finally {
      if (previous === undefined) delete process.env.AIONUI_APPSTORE_DIR;
      else process.env.AIONUI_APPSTORE_DIR = previous;
    }
  });
});

describe('handleAppDownloadsList', () => {
  it('lists artifacts in the app dir', async () => {
    const r = mockRes();
    await handleAppDownloadsList(req(`/api/appstore/downloads/list?appId=${APP}`), r as unknown as ServerResponse);
    expect(r.statusCode).toBe(200);
    const data = json(r).data as Array<{ file: string; os: string }>;
    expect(data.map((d) => d.file)).toContain(FILE);
    expect(data.find((d) => d.file === FILE)?.os).toBe('windows');
  });

  it('400s on a bad appId', async () => {
    const r = mockRes();
    await handleAppDownloadsList(req('/api/appstore/downloads/list?appId=../x'), r as unknown as ServerResponse);
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toBe('INVALID_APP_ID');
  });
});

describe('handleAppDownloadGet', () => {
  it('400s on a bad appId', async () => {
    const r = mockRes();
    await handleAppDownloadGet(req('/api/appstore/downloads/get?appId=..&file=x.exe'), r as unknown as ServerResponse);
    expect(r.statusCode).toBe(400);
  });

  it('404s when the env base is unset (no installers)', async () => {
    const saved = process.env.AIONUI_APPSTORE_INSTALLER_DIR;
    delete process.env.AIONUI_APPSTORE_INSTALLER_DIR;
    const r = mockRes();
    await handleAppDownloadGet(
      req(`/api/appstore/downloads/get?appId=${APP}&file=${FILE}`),
      r as unknown as ServerResponse
    );
    expect(r.statusCode).toBe(404);
    process.env.AIONUI_APPSTORE_INSTALLER_DIR = saved;
  });
});
