import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  desktop: false,
  getBaseUrl: vi.fn(() => 'https://memory-host.example'),
}));

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => mocks.desktop }));
vi.mock('@/common/adapter/httpBridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/httpBridge')>()),
  getBaseUrl: mocks.getBaseUrl,
}));
vi.mock('@/common/config/configService', () => ({
  configService: { get: vi.fn(() => 'http://127.0.0.1:8618/') },
}));
vi.mock('@/common', () => ({
  ipcBridge: { fs: { getImageBase64: { invoke: vi.fn() } } },
}));

import {
  fetchKnowledgeDocs,
  knowledgeFileUrl,
  recycleKnowledgeDoc,
  uploadKnowledgeFile,
  waitForKnowledgeJob,
} from '@/renderer/pages/contentHub/knowledge/knowledgeApi';

type Listener = (...args: unknown[]) => void;

class FakeXMLHttpRequest {
  static current: FakeXMLHttpRequest;
  method = '';
  url = '';
  status = 0;
  responseText = '';
  withCredentials = false;
  headers: Record<string, string> = {};
  listeners = new Map<string, Listener>();
  uploadListeners = new Map<string, Listener>();
  sentBody?: Document | XMLHttpRequestBodyInit | null;
  upload = {
    addEventListener: (name: string, listener: Listener) => this.uploadListeners.set(name, listener),
  };

  constructor() {
    FakeXMLHttpRequest.current = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  addEventListener(name: string, listener: Listener) {
    this.listeners.set(name, listener);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.sentBody = body;
  }

  progress(loaded: number, total: number) {
    this.uploadListeners.get('progress')?.({ lengthComputable: true, loaded, total });
  }

  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.listeners.get('load')?.();
  }
}

beforeEach(() => {
  mocks.desktop = false;
  vi.clearAllMocks();
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
  vi.stubGlobal('fetch', vi.fn());
});

describe('knowledge WebUI transport', () => {
  it('uploads multipart files through the authenticated LAN proxy and reports progress', async () => {
    const progress = vi.fn();
    const pending = uploadKnowledgeFile(new File(['hello'], 'notes.md'), progress);
    const xhr = FakeXMLHttpRequest.current;

    xhr.progress(5, 10);
    xhr.respond(200, { success: true, doc_id: '/watch/notes.md' });

    await expect(pending).resolves.toMatchObject({ doc_id: '/watch/notes.md' });
    expect(xhr.url).toBe('https://memory-host.example/api/vector-upload');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.sentBody).toBeInstanceOf(FormData);
    expect(progress).toHaveBeenCalledWith(45);
  });

  it('surfaces worker upload errors without reporting success', async () => {
    const pending = uploadKnowledgeFile(new File(['bad'], 'bad.exe'), vi.fn());
    FakeXMLHttpRequest.current.respond(400, { detail: 'unsupported extension' });

    await expect(pending).rejects.toThrow('unsupported extension');
  });

  it('builds same-origin preview and download URLs for LAN users', () => {
    expect(knowledgeFileUrl('/watch/a b.pdf', 'inline')).toBe(
      'https://memory-host.example/api/vector-file?path=%2Fwatch%2Fa%20b.pdf&disposition=inline'
    );
  });

  it('does not expose destructive knowledge actions to WebUI clients', async () => {
    await expect(recycleKnowledgeDoc('/watch/a.md')).rejects.toThrow('DESKTOP_ADMIN_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('knowledge indexing states', () => {
  it('preserves failed inventory state so the UI can offer retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          total: 1,
          items: [
            {
              id: '/watch/broken.pdf',
              status: 'failed',
              indexed: false,
              on_disk: true,
              job: { state: 'failed', error: 'parse failed' },
              metadata: { file_name: 'broken.pdf', file_size: 12 },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await fetchKnowledgeDocs();

    expect(result.docs[0]).toMatchObject({ status: 'failed', indexed: false, onDisk: true });
    expect(result.docs[0]?.job?.error).toBe('parse failed');
  });

  it('waits through processing and resolves only after indexing finishes', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'processing' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'done' }), { status: 200 }));

    await expect(waitForKnowledgeJob('/watch/video.mp4', { intervalMs: 0 })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns the worker failure instead of polling forever', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ state: 'failed', error: 'transcription failed' }), { status: 200 })
    );

    await expect(waitForKnowledgeJob('/watch/video.mp4', { intervalMs: 0 })).rejects.toThrow('transcription failed');
  });
});
