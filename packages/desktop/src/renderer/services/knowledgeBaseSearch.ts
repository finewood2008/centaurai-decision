/**
 * knowledgeBaseSearch — query the local vector DB and build a context block to
 * prepend to a prompt. Extracted from the normal-conversation recipe
 * (pages/guid/hooks/useGuidSend.ts) so the home composer and the 智囊团 share
 * one implementation. Desktop reaches the DB directly; a WebUI browser client
 * goes through the co-located server proxy (the DB binds loopback server-side).
 */
import { configService } from '@/common/config/configService';
import { getBaseUrl } from '@/common/adapter/httpBridge';
import { isElectronDesktop } from '@/renderer/utils/platform';

export type KnowledgeSearchResult = {
  /** Pre-formatted context block to fold into the prompt, or null when no hits. */
  context: string | null;
  count: number;
};

type VectorHit = { text?: string; metadata?: { file_name?: string } };

/** Run the knowledge-base search for `query`. Throws if the DB is unreachable. */
export async function retrieveKnowledgeContext(query: string): Promise<KnowledgeSearchResult> {
  const q = query.trim();
  if (!q) return { context: null, count: 0 };

  const endpoint = (configService.get('vectorDB.endpoint') ?? 'http://127.0.0.1:8618').replace(/\/+$/, '');
  const nResults = configService.get('vectorDB.searchCount') ?? 5;
  const mode = configService.get('vectorDB.searchMode') ?? 'text';

  const resp = isElectronDesktop()
    ? await fetch(`${endpoint}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, n_results: nResults, mode }),
      })
    : await fetch(`${getBaseUrl()}/api/vector-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, query: q, n_results: nResults, mode }),
      });
  if (!resp.ok) throw new Error(`知识库检索失败 (HTTP ${resp.status})`);

  const data = (await resp.json()) as { results?: VectorHit[] };
  const results = data.results ?? [];
  if (results.length === 0) return { context: null, count: 0 };

  const context = results
    .map((r, i) => `[知识库 ${i + 1}] ${r.metadata?.file_name || '未知'}:\n${r.text || '(无文字)'}`)
    .join('\n\n');
  return { context, count: results.length };
}
