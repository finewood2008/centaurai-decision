import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getDesktopWebUIStatus,
  healDesktopWebUIIfNeeded,
  repairDesktopWebUIEntry,
  restoreDesktopWebUIFromPreferences,
  startDesktopWebUI,
  stopDesktopWebUI,
} from '@/process/utils/webuiConfig';

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

vi.mock('os', () => ({
  networkInterfaces: () => ({
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.2' }],
  }),
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
  inspectEntry: vi.fn().mockResolvedValue({ status: 'healthy', healedCount: 0, hasBackup: true, liveOk: true }),
  repairEntry: vi.fn().mockResolvedValue({ status: 'healthy', healedCount: 0, hasBackup: true, liveOk: true }),
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
    okHandle.stop.mockClear();
    okHandle.inspectEntry.mockClear();
    okHandle.repairEntry.mockClear();
    startWebHostMock.mockResolvedValue(okHandle);
    (globalThis as { __backendPort?: number }).__backendPort = 51441;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ needs_setup: false }),
      })
    );
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await stopDesktopWebUI();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (globalThis as { __backendPort?: number }).__backendPort;
  });

  it('starts the WebUI immediately when the backend answers on the first read', async () => {
    httpRequestMock.mockResolvedValueOnce(ENABLED_REMOTE);

    await restoreDesktopWebUIFromPreferences();

    expect(startWebHostMock).toHaveBeenCalledTimes(1);
    expect(startWebHostMock.mock.calls[0][0]).toMatchObject({ allowRemote: true, port: 25808 });
  });

  it('notifies the caller with the restored handle so LAN discovery can be advertised', async () => {
    httpRequestMock.mockResolvedValueOnce(ENABLED_REMOTE);
    const onRestored = vi.fn();

    await restoreDesktopWebUIFromPreferences({ onRestored });

    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledWith(
      expect.objectContaining({
        allowRemote: true,
        networkUrl: 'http://192.168.1.2:25808',
        lanIP: '192.168.1.2',
      })
    );
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
    // behavior; startDesktopWebUI then makes 3 more /api/settings/client reads
    // (NAS root + image key + trusted knowledge endpoint) → 6 total.
    expect(httpRequestMock).toHaveBeenCalledTimes(6);
    expect(startWebHostMock).toHaveBeenCalledTimes(1);
    expect(startWebHostMock.mock.calls[0][0]).toMatchObject({ allowRemote: true });
  });

  it('does not start the WebUI when the preference is genuinely disabled', async () => {
    httpRequestMock.mockResolvedValueOnce({ 'webui.desktop.enabled': false });

    await restoreDesktopWebUIFromPreferences();

    expect(startWebHostMock).not.toHaveBeenCalled();
  });

  it('self-heals a running WebUI when the backend port changes', async () => {
    httpRequestMock.mockResolvedValue({});
    await startDesktopWebUI({ port: 25808, allowRemote: true });
    expect(startWebHostMock).toHaveBeenCalledTimes(1);

    (globalThis as { __backendPort?: number }).__backendPort = 51442;
    startWebHostMock.mockResolvedValueOnce({
      ...okHandle,
      backendPort: 51442,
      lanIP: '192.168.1.3',
      networkUrl: 'http://192.168.1.3:25808',
    });

    const healed = await healDesktopWebUIIfNeeded();

    expect(healed).toMatchObject({ lanIP: '192.168.1.3', networkUrl: 'http://192.168.1.3:25808' });
    expect(okHandle.stop).toHaveBeenCalledTimes(1);
    expect(startWebHostMock).toHaveBeenCalledTimes(2);
    expect(startWebHostMock.mock.calls[1][0]).toMatchObject({ allowRemote: true, port: 25808 });
    expect(startWebHostMock.mock.calls[1][0].backend).toMatchObject({ port: 51442 });
  });

  it('does not restart a healthy running WebUI', async () => {
    httpRequestMock.mockResolvedValue({});
    await startDesktopWebUI({ port: 25808, allowRemote: true });

    const healed = await healDesktopWebUIIfNeeded();

    expect(healed).toBeNull();
    expect(startWebHostMock).toHaveBeenCalledTimes(1);
    expect(okHandle.stop).not.toHaveBeenCalled();
  });

  it('repair connection self-heals before returning connectivity diagnostics', async () => {
    httpRequestMock.mockResolvedValue({});
    await startDesktopWebUI({ port: 25808, allowRemote: true });
    (globalThis as { __backendPort?: number }).__backendPort = 51442;
    const healedHandle = {
      ...okHandle,
      backendPort: 51442,
      lanIP: '192.168.1.4',
      networkUrl: 'http://192.168.1.4:25808',
      repairEntry: vi.fn().mockResolvedValue({ status: 'healed', healedCount: 1, hasBackup: true, liveOk: true }),
    };
    startWebHostMock.mockResolvedValueOnce(healedHandle);

    const result = await repairDesktopWebUIEntry();
    const status = getDesktopWebUIStatus();

    expect(result.entryHealth?.status).toBe('healed');
    expect(result.connectivity.backendReachable).toBe(true);
    expect(status.lanIP).toBe('192.168.1.4');
    expect(healedHandle.repairEntry).toHaveBeenCalledTimes(1);
  });
});
