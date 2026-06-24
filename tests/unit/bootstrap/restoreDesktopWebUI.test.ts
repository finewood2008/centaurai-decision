import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreDesktopWebUIFromPreferences } from '@/process/utils/webuiConfig';

const { httpRequestMock, startWebHostMock } = vi.hoisted(() => ({
  httpRequestMock: vi.fn(),
  startWebHostMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: httpRequestMock,
}));

vi.mock('@aionui/web-host', () => ({
  startWebHost: startWebHostMock,
}));

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    getAppPath: () => '/app',
    getPath: () => '/userData',
  },
}));

vi.mock('@/process/utils/initStorage', () => ({
  getSystemDir: () => ({ cacheDir: '/c', workDir: '/w', logDir: '/l' }),
}));

vi.mock('@/process/utils/utils', () => ({
  getDataPath: () => '/data',
}));

const okHandle = {
  port: 25808,
  localUrl: 'http://127.0.0.1:25808',
  networkUrl: 'http://192.168.1.2:25808',
  lanIP: '192.168.1.2',
  backendPort: 51441,
  stop: vi.fn().mockResolvedValue(undefined),
};

const ENABLED_REMOTE = {
  'webui.desktop.enabled': true,
  'webui.desktop.allowRemote': true,
  'webui.desktop.port': 25808,
};

describe('restoreDesktopWebUIFromPreferences', () => {
  beforeEach(() => {
    httpRequestMock.mockReset();
    startWebHostMock.mockReset();
    startWebHostMock.mockResolvedValue(okHandle);
    (globalThis as { __backendPort?: number }).__backendPort = 51441;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { __backendPort?: number }).__backendPort;
  });

  it('starts the WebUI immediately when the backend answers on the first read', async () => {
    httpRequestMock.mockResolvedValueOnce(ENABLED_REMOTE);

    await restoreDesktopWebUIFromPreferences();

    expect(startWebHostMock).toHaveBeenCalledTimes(1);
    expect(startWebHostMock.mock.calls[0][0]).toMatchObject({ allowRemote: true, port: 25808 });
  });

  it('retries instead of disabling when the backend is not yet reachable (the restart regression)', async () => {
    // Backend still starting: first two reads throw (ERR_CONNECTION_REFUSED),
    // third succeeds with the persisted "enabled + allowRemote" preference.
    httpRequestMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(ENABLED_REMOTE);

    const done = restoreDesktopWebUIFromPreferences();
    // Advance past the two 1s retry gaps so the third read runs.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    // 3 preference reads (2 refused + 1 success) prove the retry-not-disable
    // behavior; startDesktopWebUI then makes 2 more /api/settings/client reads
    // (resolveNasRootDir + resolveImageWorkbenchKey) on the start path → 5 total.
    expect(httpRequestMock).toHaveBeenCalledTimes(5);
    expect(startWebHostMock).toHaveBeenCalledTimes(1);
    expect(startWebHostMock.mock.calls[0][0]).toMatchObject({ allowRemote: true });
  });

  it('does not start the WebUI when the preference is genuinely disabled', async () => {
    httpRequestMock.mockResolvedValueOnce({ 'webui.desktop.enabled': false });

    await restoreDesktopWebUIFromPreferences();

    expect(startWebHostMock).not.toHaveBeenCalled();
  });
});
