import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LARGE_TEXT_PREVIEW_MAX_LENGTH } from '@/renderer/pages/conversation/Preview/constants';

const mocks = vi.hoisted(() => ({
  isDesktop: vi.fn(() => false),
  isRemoteClient: vi.fn(() => false),
  openPreview: vi.fn(),
  downloadFileFromPath: vi.fn(),
  shellOpenFile: vi.fn(),
  shellShowItemInFolder: vi.fn(),
  readFile: vi.fn(),
  getImageBase64: vi.fn(),
}));

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: mocks.isDesktop }));
vi.mock('@/common/adapter/httpBridge', () => ({ isRemoteClientBridgeMode: mocks.isRemoteClient }));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ openPreview: mocks.openPreview }),
}));
vi.mock('@/renderer/utils/file/download', () => ({ downloadFileFromPath: mocks.downloadFileFromPath }));
vi.mock('@/common', () => ({
  ipcBridge: {
    shell: {
      openFile: { invoke: mocks.shellOpenFile },
      showItemInFolder: { invoke: mocks.shellShowItemInFolder },
    },
    fs: {
      readFile: { invoke: mocks.readFile },
      getImageBase64: { invoke: mocks.getImageBase64 },
    },
  },
}));

import { useFileActions } from '@/renderer/hooks/file/useFileActions';

describe('useFileActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDesktop.mockReturnValue(false);
    mocks.isRemoteClient.mockReturnValue(false);
    mocks.readFile.mockResolvedValue('hello');
    mocks.getImageBase64.mockResolvedValue('data:image/png;base64,AA==');
  });

  it('previews Office files in WebUI mode', async () => {
    const { result } = renderHook(() => useFileActions());
    await act(() => result.current.openFile({ path: '/srv/work/report.xlsx', name: 'report.xlsx' }));
    expect(mocks.openPreview).toHaveBeenCalledWith(
      '',
      'excel',
      expect.objectContaining({ file_path: '/srv/work/report.xlsx' }),
      {
        replace: true,
      }
    );
    expect(mocks.shellOpenFile).not.toHaveBeenCalled();
  });

  it('downloads ordinary files in WebUI mode', async () => {
    const { result } = renderHook(() => useFileActions());
    await act(() => result.current.openFile({ path: '/srv/work/archive.zip', name: '' }));
    expect(mocks.downloadFileFromPath).toHaveBeenCalledWith('/srv/work/archive.zip', 'archive.zip', undefined);
  });

  it('opens files with the system handler on local desktop', async () => {
    mocks.isDesktop.mockReturnValue(true);
    const { result } = renderHook(() => useFileActions());
    await act(() => result.current.openFile({ path: '/srv/work/report.xlsx', name: 'report.xlsx' }));
    expect(mocks.shellOpenFile).toHaveBeenCalledWith('/srv/work/report.xlsx');
  });

  it('never invokes server shell routes from a distributed client', async () => {
    mocks.isDesktop.mockReturnValue(true);
    mocks.isRemoteClient.mockReturnValue(true);
    const { result } = renderHook(() => useFileActions());
    await act(() => result.current.openFile({ path: '/srv/work/archive.zip', name: 'archive.zip' }));
    expect(result.current.canReveal).toBe(false);
    expect(mocks.shellOpenFile).not.toHaveBeenCalled();
    await expect(result.current.revealFile({ path: '/srv/work/archive.zip', name: 'archive.zip' })).rejects.toThrow(
      'only available in the desktop app'
    );
  });

  it('reveals a file only on the local desktop', async () => {
    mocks.isDesktop.mockReturnValue(true);
    const { result } = renderHook(() => useFileActions());
    await act(() => result.current.revealFile({ path: '/srv/work/report.pdf', name: 'report.pdf' }));
    expect(result.current.canReveal).toBe(true);
    expect(mocks.shellShowItemInFolder).toHaveBeenCalledWith('/srv/work/report.pdf');
  });

  it('previews images through authenticated file reads', async () => {
    const { result } = renderHook(() => useFileActions());
    await act(() =>
      result.current.previewFile({ path: '/srv/work/chart.png', name: 'chart.png', workspace: '/srv/work' })
    );
    expect(mocks.getImageBase64).toHaveBeenCalledWith({ path: '/srv/work/chart.png', workspace: '/srv/work' });
    expect(mocks.openPreview).toHaveBeenCalledWith(
      'data:image/png;base64,AA==',
      'image',
      expect.objectContaining({ editable: false }),
      { replace: true }
    );
  });

  it('renders active document formats as bounded, read-only source text', async () => {
    mocks.readFile.mockResolvedValue('<script>x</script>'.repeat(100_000));
    const { result } = renderHook(() => useFileActions());
    await act(() => result.current.previewFile({ path: '/srv/work/page.html', name: 'page.html' }, { replace: false }));
    const [content, type, metadata, options] = mocks.openPreview.mock.calls.at(-1)!;
    expect(content).toHaveLength(LARGE_TEXT_PREVIEW_MAX_LENGTH);
    expect(type).toBe('code');
    expect(metadata).toMatchObject({ language: 'html', truncated: true, editable: false });
    expect(options).toEqual({ replace: false });
  });

  it('surfaces failed reads instead of mounting an empty preview', async () => {
    mocks.readFile.mockResolvedValue(null);
    const { result } = renderHook(() => useFileActions());
    await expect(result.current.previewFile({ path: '/srv/work/missing.txt', name: 'missing.txt' })).rejects.toBeNull();
    expect(mocks.openPreview).not.toHaveBeenCalled();
  });

  it('delegates explicit downloads with workspace metadata', async () => {
    const { result } = renderHook(() => useFileActions());
    await act(() =>
      result.current.downloadFile({ path: '/srv/work/report.pdf', name: 'report.pdf', workspace: '/srv/work' })
    );
    expect(mocks.downloadFileFromPath).toHaveBeenCalledWith('/srv/work/report.pdf', 'report.pdf', '/srv/work');
  });
});
