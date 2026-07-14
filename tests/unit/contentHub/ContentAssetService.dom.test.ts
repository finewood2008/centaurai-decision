import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentAssetDTO } from '@/common/adapter/ipcBridge';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  stage: vi.fn(),
  save: vi.fn(),
  promote: vi.fn(),
  archive: vi.fn(),
  discard: vi.fn(),
  readFileBuffer: vi.fn(),
  getStatus: vi.fn(),
  getBaseUrl: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    contentAssetsLocal: {
      list: { invoke: mocks.list },
      stageFromPath: { invoke: mocks.stage },
      saveFromPath: { invoke: mocks.save },
      promoteDraft: { invoke: mocks.promote },
      archive: { invoke: mocks.archive },
      discardDraft: { invoke: mocks.discard },
    },
    fs: { readFileBuffer: { invoke: mocks.readFileBuffer } },
    webui: { getStatus: { invoke: mocks.getStatus } },
  },
}));
vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: mocks.getBaseUrl }));

import {
  archiveContentAsset,
  contentAssetUrl,
  discardContentAssetDraft,
  listContentAssets,
  migrateLegacyContentAssets,
  promoteContentAsset,
  saveContentAsset,
  stageContentAsset,
} from '@/renderer/services/ContentAssetService';

const asset = (overrides: Partial<ContentAssetDTO> = {}): ContentAssetDTO => ({
  id: 'asset-1',
  title: 'report.pdf',
  kind: 'document',
  ownerUserId: 'system_default_user',
  visibility: 'private',
  sourceWorkspacePath: '/tmp/report.pdf',
  storageProvider: 'personal_content',
  storagePath: '/managed/report.pdf',
  tags: [],
  statusFlags: ['saved'],
  createdAt: 1,
  updatedAt: 1,
  size: 10,
  ...overrides,
});

function setDesktop(host = '127.0.0.1') {
  Object.assign(window, { __backendPort: 25812, __backendHost: host });
}

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  delete (window as Window & { __backendPort?: number }).__backendPort;
  delete (window as Window & { __backendHost?: string }).__backendHost;
  mocks.getBaseUrl.mockResolvedValue('https://remote.example');
  mocks.getStatus.mockResolvedValue({ running: true, localUrl: 'http://127.0.0.1:25812/' });
  mocks.readFileBuffer.mockResolvedValue(btoa('payload'));
  mocks.list.mockResolvedValue([asset()]);
  mocks.stage.mockResolvedValue(asset({ statusFlags: ['draft'] }));
  mocks.save.mockResolvedValue(asset());
  mocks.promote.mockResolvedValue(asset());
  mocks.archive.mockResolvedValue(asset({ statusFlags: ['archived'] }));
  mocks.discard.mockResolvedValue(true);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, data: asset() })));
});

describe('ContentAssetService desktop transport', () => {
  it('uses local IPC for every lifecycle operation on the admin desktop', async () => {
    setDesktop();
    const input = { sourcePath: '/tmp/report.pdf', name: 'report.pdf' };
    await expect(listContentAssets()).resolves.toEqual([asset()]);
    await stageContentAsset(input);
    await saveContentAsset(input);
    await promoteContentAsset('asset 1');
    await archiveContentAsset('asset 1');
    await discardContentAssetDraft('asset 1');
    expect(mocks.stage).toHaveBeenCalledWith(input);
    expect(mocks.save).toHaveBeenCalledWith(input);
    expect(mocks.promote).toHaveBeenCalledWith({ id: 'asset 1' });
    expect(mocks.archive).toHaveBeenCalledWith({ id: 'asset 1' });
    expect(mocks.discard).toHaveBeenCalledWith({ id: 'asset 1' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('builds local preview URLs and rejects unavailable WebUI', async () => {
    setDesktop('localhost');
    await expect(contentAssetUrl('a/b', 'preview')).resolves.toBe(
      'http://127.0.0.1:25812/api/content-assets/preview?id=a%2Fb'
    );
    mocks.getStatus.mockResolvedValueOnce({ running: false });
    await expect(contentAssetUrl('a', 'download')).rejects.toThrow('PERSONAL_WORKSPACE_UNAVAILABLE');
  });
});

describe('ContentAssetService WebUI transport', () => {
  it('lists assets through the same-origin owner-scoped endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, data: [asset()] }));
    await expect(listContentAssets()).resolves.toEqual([asset()]);
    expect(fetch).toHaveBeenCalledWith('/api/content-assets/list', { credentials: 'include' });
  });

  it.each([
    ['draft', stageContentAsset, 'draft-upload'],
    ['saved', saveContentAsset, 'upload'],
  ] as const)('uploads a %s copy with encoded metadata', async (_status, operation, endpoint) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, data: asset() }));
    await operation({
      sourcePath: '/tmp/report.pdf',
      name: 'quarterly report.pdf',
      kind: 'document',
      sourceConversationId: 'conversation/1',
      category: 'Board',
    });
    const [url, options] = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(String(url)).toContain(`/api/content-assets/${endpoint}?`);
    expect(String(url)).toContain('name=quarterly+report.pdf');
    expect(String(url)).toContain('conversation_id=conversation%2F1');
    expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(options?.body).toBeInstanceOf(Blob);
  });

  it('accepts data-URL buffers and rejects unreadable files', async () => {
    mocks.readFileBuffer.mockResolvedValueOnce('data:application/pdf;base64,cGRm');
    await saveContentAsset({ sourcePath: '/tmp/a.pdf', name: 'a.pdf' });
    mocks.readFileBuffer.mockResolvedValueOnce(null);
    await expect(saveContentAsset({ sourcePath: '/tmp/missing.pdf', name: 'missing.pdf' })).rejects.toThrow(
      'FILE_NOT_READABLE'
    );
  });

  it('uses authenticated mutations and reports server errors', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ success: true, data: asset() }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: asset({ statusFlags: ['archived'] }) }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: true }))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'NOT_FOUND' }, { status: 404 }));
    await promoteContentAsset('a/b');
    await archiveContentAsset('a/b');
    await discardContentAssetDraft('a/b');
    await expect(listContentAssets()).rejects.toThrow('NOT_FOUND');
    expect(fetch).toHaveBeenCalledWith('/api/content-assets/discard?id=a%2Fb', {
      method: 'DELETE',
      credentials: 'include',
    });
  });

  it('uses the authenticated remote base for a distributed client', async () => {
    setDesktop('192.168.1.20');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
    await listContentAssets();
    expect(fetch).toHaveBeenCalledWith('https://remote.example/api/content-assets/list', { credentials: 'include' });
  });
});

describe('legacy content asset migration', () => {
  it('imports only usable, unknown source paths and marks the migration complete', async () => {
    setDesktop();
    mocks.list.mockResolvedValueOnce([asset({ sourceWorkspacePath: 'C:/known/report.pdf' })]);
    localStorage.setItem(
      'centaurai.content-assets.v1',
      JSON.stringify([
        null,
        'invalid',
        { storagePath: 'C:\\known\\report.pdf', title: 'known.pdf' },
        { storagePath: '/tmp/new.pdf', title: 'New report.pdf', sourceConversationId: 'c1' },
        { storagePath: '/tmp/fallback.docx' },
        { title: 'missing path' },
      ])
    );
    await migrateLegacyContentAssets();
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledWith({
      sourcePath: '/tmp/new.pdf',
      name: 'New report.pdf',
      sourceConversationId: 'c1',
    });
    expect(localStorage.getItem('centaurai.content-assets.migrated.v2')).toBe('1');
  });

  it('is idempotent and safely handles invalid legacy JSON or failed reads', async () => {
    localStorage.setItem('centaurai.content-assets.migrated.v2', '1');
    await migrateLegacyContentAssets();
    expect(mocks.list).not.toHaveBeenCalled();

    localStorage.removeItem('centaurai.content-assets.migrated.v2');
    localStorage.setItem('centaurai.content-assets.v1', '{bad json');
    await migrateLegacyContentAssets();
    expect(localStorage.getItem('centaurai.content-assets.migrated.v2')).toBe('1');

    localStorage.removeItem('centaurai.content-assets.migrated.v2');
    localStorage.setItem('centaurai.content-assets.v1', JSON.stringify([{ storagePath: '/tmp/new.pdf' }]));
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await migrateLegacyContentAssets();
    expect(localStorage.getItem('centaurai.content-assets.migrated.v2')).toBe('1');
  });
});
