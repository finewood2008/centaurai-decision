/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => {
      const handlerMap = new Map<string, Function>();
      return {
        provider: vi.fn((handler: Function) => {
          handlerMap.set('handler', handler);
          return vi.fn();
        }),
        invoke: vi.fn(),
        _getHandler: () => handlerMap.get('handler'),
      };
    }),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
  },
  storage: {
    buildStorage: () => ({
      getSync: () => undefined,
      setSync: () => {},
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    }),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path'),
    isPackaged: true,
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const makeGitHubReleaseResponse = () => [
  {
    tag_name: 'v2.5.1',
    name: 'v2.5.1',
    body: 'release notes',
    html_url: 'https://github.com/finewood2008/centaurai-station/releases/tag/v2.5.1',
    published_at: '2026-04-29T00:00:00Z',
    prerelease: false,
    draft: false,
    assets: [
      {
        name: 'CentaurAI-2.5.1-mac-arm64.dmg',
        browser_download_url:
          'https://github.com/finewood2008/centaurai-station/releases/download/v2.5.1/CentaurAI-2.5.1-mac-arm64.dmg',
        size: 123,
        content_type: 'application/x-apple-diskimage',
      },
      {
        name: 'CentaurAI-2.5.1-win-x64.exe',
        browser_download_url:
          'https://github.com/finewood2008/centaurai-station/releases/download/v2.5.1/CentaurAI-2.5.1-win-x64.exe',
        size: 456,
        content_type: 'application/vnd.microsoft.portable-executable',
      },
      {
        name: 'CentaurAI-2.5.1-linux-amd64.deb',
        browser_download_url:
          'https://github.com/finewood2008/centaurai-station/releases/download/v2.5.1/CentaurAI-2.5.1-linux-amd64.deb',
        size: 789,
      },
    ],
  },
];

const getCheckHandler = async () => {
  vi.resetModules();
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');

  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.update.check.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('update.check handler not registered');
  return lastCall[0];
};

describe('updateBridge release URLs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses GitHub release assets by default and does not rewrite to the legacy AionUi CDN', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeGitHubReleaseResponse(),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandler();
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/finewood2008/centaurai-station/releases',
        expect.any(Object)
      );
      const assets = result.data?.latest?.assets ?? [];
      expect(assets.length).toBe(3);

      const macAsset = assets.find((a: { name: string }) => a.name === 'CentaurAI-2.5.1-mac-arm64.dmg');
      expect(macAsset).toBeDefined();
      expect(macAsset?.url).toBe(
        'https://github.com/finewood2008/centaurai-station/releases/download/v2.5.1/CentaurAI-2.5.1-mac-arm64.dmg'
      );
      expect(macAsset?.fallbackUrl).toBeUndefined();

      const linuxAsset = assets.find((a: { name: string }) => a.name === 'CentaurAI-2.5.1-linux-amd64.deb');
      expect(linuxAsset?.url).not.toContain('static.aionui.com');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rewrites through a configured release CDN and keeps GitHub as fallback', async () => {
    vi.stubEnv('CENTAURAI_RELEASE_CDN_BASE', 'https://static.centaurloop.com/releases');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeGitHubReleaseResponse(),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandler();
      const result = await handler({ repo: 'finewood2008/centaurai-station' });
      const asset = result.data?.latest?.assets?.[0];
      expect(asset?.url).toBe('https://static.centaurloop.com/releases/2.5.1/CentaurAI-2.5.1-mac-arm64.dmg');
      expect(asset?.fallbackUrl).toBe(
        'https://github.com/finewood2008/centaurai-station/releases/download/v2.5.1/CentaurAI-2.5.1-mac-arm64.dmg'
      );
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});

describe('updateBridge allowlist includes CDN host', () => {
  it('accepts configured release CDN URLs for download', async () => {
    vi.stubEnv('CENTAURAI_RELEASE_CDN_BASE', 'https://static.centaurloop.com/releases');
    vi.resetModules();
    vi.clearAllMocks();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '0' }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { initUpdateBridge } = await import('@process/bridge/updateBridge');
      const { ipcBridge } = await import('@/common');

      initUpdateBridge();

      const provider = vi.mocked(ipcBridge.update.download.provider);
      const lastCall = provider.mock.calls.at(-1);
      if (!lastCall) throw new Error('update.download handler not registered');
      const handler = lastCall[0];

      const result = await handler({
        url: 'https://static.centaurloop.com/releases/2.5.1/CentaurAI-2.5.1-mac-arm64.dmg',
        file_name: 'CentaurAI-2.5.1-mac-arm64.dmg',
      });

      expect(result.success).toBe(true);
      expect(result.data?.downloadId).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('rejects non-allowlisted hosts', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const { initUpdateBridge } = await import('@process/bridge/updateBridge');
    const { ipcBridge } = await import('@/common');

    initUpdateBridge();

    const provider = vi.mocked(ipcBridge.update.download.provider);
    const lastCall = provider.mock.calls.at(-1);
    if (!lastCall) throw new Error('update.download handler not registered');
    const handler = lastCall[0];

    const result = await handler({
      url: 'https://evil.example.com/fake.dmg',
      file_name: 'fake.dmg',
    });

    // Download is refused before any network I/O; exact error text comes from i18n and isn't asserted here.
    expect(result.success).toBe(false);
  });
});
