/**
 * knowledgeApi — read-only access to the local vector DB (knowledge base).
 *
 * Desktop runs co-located with the vector DB and reaches it directly. A WebUI
 * browser client cannot (the DB binds loopback on the server host), so it goes
 * through the WebUI server's proxy routes, which forward to the configured
 * endpoint. Mirrors the search recipe in pages/guid/hooks/useGuidSend.ts.
 */
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { getBaseUrl } from '@/common/adapter/httpBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { blobToDataUrl } from '../components/view/imageThumb';

export type KnowledgeDoc = {
  id: string;
  name: string;
  path: string;
  fileType: string;
  size: number;
  mtime: number;
  chunkCount: number;
};

export function vectorEndpoint(): string {
  return (configService.get('vectorDB.endpoint') ?? 'http://127.0.0.1:8618').replace(/\/+$/, '');
}

type RawDoc = { id: string; chunk_count?: number; metadata?: Record<string, unknown> };

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function normalize(raw: RawDoc): KnowledgeDoc {
  const m = raw.metadata ?? {};
  return {
    id: raw.id,
    name: String(m.file_name ?? raw.id.split(/[\\/]/).pop() ?? raw.id),
    path: String(m.source_path ?? m.file_path ?? raw.id),
    fileType: String(m.file_type ?? ''),
    size: num(m.file_size),
    mtime: Math.floor(num(m.modified_time)),
    chunkCount: num(raw.chunk_count ?? m.chunk_count),
  };
}

export async function fetchKnowledgeDocs(limit = 300, offset = 0): Promise<{ total: number; docs: KnowledgeDoc[] }> {
  const endpoint = vectorEndpoint();
  const resp = isElectronDesktop()
    ? await fetch(`${endpoint}/api/documents?limit=${limit}&offset=${offset}`)
    : await fetch(`${getBaseUrl()}/api/vector-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, limit, offset }),
      });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const items: RawDoc[] = Array.isArray(data.items) ? data.items : [];
  return { total: num(data.total) || items.length, docs: items.map(normalize) };
}

function imageUrl(path: string): string {
  const endpoint = vectorEndpoint();
  return isElectronDesktop()
    ? `${endpoint}/api/image?path=${encodeURIComponent(path)}`
    : `${getBaseUrl()}/api/vector-image?endpoint=${encodeURIComponent(endpoint)}&path=${encodeURIComponent(path)}`;
}

/**
 * Resolve a knowledge-base image to a `data:` URL — the same format the rest of
 * the hub uses for thumbnails, which avoids any img-src / blob: / cross-origin
 * surprises. Desktop reads the local file directly (the doc path is local to the
 * DB host); WebUI fetches through the server proxy and inlines the bytes.
 */
export async function loadKnowledgeImage(path: string): Promise<string | null> {
  try {
    if (isElectronDesktop()) {
      return await ipcBridge.fs.getImageBase64.invoke({ path });
    }
    const resp = await fetch(imageUrl(path));
    if (!resp.ok) return null;
    return await blobToDataUrl(await resp.blob());
  } catch {
    return null;
  }
}
