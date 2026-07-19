/**
 * Unified retrieval client for the private knowledge and memory service.
 *
 * Local desktop renderers call the loopback worker directly. LAN browsers and
 * distributed desktop clients call the authenticated Web Host proxy so they
 * always search the private store on the server machine.
 */
import { getBaseUrl, getWebuiGateHeaders, isRemoteClientBridgeMode } from '@/common/adapter/httpBridge';
import { configService } from '@/common/config/configService';
import { isElectronDesktop } from '@/renderer/utils/platform';
import i18n from '@/renderer/services/i18n';

export const KNOWLEDGE_CONTEXT_MARK = '【CentaurAI 检索上下文】';
const LEGACY_CONTEXT_MARKS = ['【local-vector-db 检索结果】', '【知识库检索结果】'];
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_CONTEXT_CHARS = 6_000;
const DEFAULT_MAX_HIT_CHARS = 900;

export type KnowledgeRetrievalScope = 'knowledge' | 'memory' | 'all';
export type KnowledgeRetrievalMode = 'text' | 'visual' | 'hybrid';
export type KnowledgeSourceType = 'document' | 'wiki' | 'memory' | 'image';

export type KnowledgeRetrievalRequest = {
  query: string;
  scope?: KnowledgeRetrievalScope;
  limit?: number;
  mode?: KnowledgeRetrievalMode;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type KnowledgeRetrievalHit = {
  id: string;
  sourceType: KnowledgeSourceType;
  title: string;
  sourcePath?: string;
  text: string;
  score: number;
  fileType?: string;
  matchType?: string;
};

export type KnowledgeRetrievalResult = {
  query: string;
  scope: KnowledgeRetrievalScope;
  mode: KnowledgeRetrievalMode;
  hits: KnowledgeRetrievalHit[];
  count: number;
  reranked: boolean;
};

export type KnowledgeSearchResult = {
  /** Pre-formatted hit list retained for meeting/conversation compatibility. */
  context: string | null;
  count: number;
  hits: KnowledgeRetrievalHit[];
};

type RawRetrievalHit = {
  id?: unknown;
  source_type?: unknown;
  title?: unknown;
  source_path?: unknown;
  text?: unknown;
  score?: unknown;
  file_type?: unknown;
  match_type?: unknown;
};

type RawRetrievalResponse = {
  query?: unknown;
  scope?: unknown;
  mode?: unknown;
  hits?: unknown;
  reranked?: unknown;
};

const clip = (value: string, maxChars: number): string =>
  value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : value;

const isSourceType = (value: unknown): value is KnowledgeSourceType =>
  value === 'document' || value === 'wiki' || value === 'memory' || value === 'image';

const normalizeHit = (raw: RawRetrievalHit, index: number): KnowledgeRetrievalHit | null => {
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text || text === '#' || text === '---' || text.length <= 2) return null;
  const sourceType = isSourceType(raw.source_type) ? raw.source_type : 'document';
  const score = Number(raw.score);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `${sourceType}:${index}`,
    sourceType,
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim()
        : i18n.t('messages.knowledgeRetrieval.unknownSource'),
    sourcePath: typeof raw.source_path === 'string' && raw.source_path ? raw.source_path : undefined,
    text,
    score: Number.isFinite(score) ? score : 0,
    fileType: typeof raw.file_type === 'string' ? raw.file_type : undefined,
    matchType: typeof raw.match_type === 'string' ? raw.match_type : undefined,
  };
};

const isLocalKnowledgeHost = (): boolean => isElectronDesktop() && !isRemoteClientBridgeMode();

/** True when a prompt already contains current or legacy retrieval context. */
export function hasKnowledgeContext(value: string): boolean {
  return [KNOWLEDGE_CONTEXT_MARK, ...LEGACY_CONTEXT_MARKS].some((mark) => value.includes(mark));
}

/** Retrieve typed, bounded hits from the private store. */
export async function retrieveKnowledge(request: KnowledgeRetrievalRequest): Promise<KnowledgeRetrievalResult> {
  const query = request.query.trim();
  const scope = request.scope ?? 'all';
  const configuredLimit = request.limit ?? configService.get('vectorDB.searchCount') ?? 5;
  const limit = Math.max(1, Math.min(Math.trunc(configuredLimit), 20));
  const mode = request.mode ?? configService.get('vectorDB.searchMode') ?? 'text';
  if (!query) return { query: '', scope, mode, hits: [], count: 0, reranked: false };

  const local = isLocalKnowledgeHost();
  const endpoint = (configService.get('vectorDB.endpoint') ?? 'http://127.0.0.1:8618').replace(/\/+$/, '');
  const url = local ? `${endpoint}/api/retrieve` : `${getBaseUrl()}/api/vector-retrieve`;
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(request.signal?.reason);
  if (request.signal?.aborted) abortFromCaller();
  else request.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(local ? {} : getWebuiGateHeaders()) },
      credentials: local ? 'omit' : 'same-origin',
      signal: controller.signal,
      body: JSON.stringify({ query, scope, limit, mode }),
    });
    if (!response.ok) throw new Error(`Knowledge retrieval failed (HTTP ${response.status})`);

    const raw = (await response.json()) as RawRetrievalResponse;
    const rawHits = Array.isArray(raw.hits) ? (raw.hits as RawRetrievalHit[]) : [];
    const hits = rawHits
      .map(normalizeHit)
      .filter((hit): hit is KnowledgeRetrievalHit => Boolean(hit))
      .slice(0, limit);
    return {
      query: typeof raw.query === 'string' ? raw.query : query,
      scope: raw.scope === 'knowledge' || raw.scope === 'memory' || raw.scope === 'all' ? raw.scope : scope,
      mode: raw.mode === 'visual' || raw.mode === 'hybrid' || raw.mode === 'text' ? raw.mode : mode,
      hits,
      count: hits.length,
      reranked: raw.reranked === true,
    };
  } finally {
    globalThis.clearTimeout(timeout);
    request.signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Format hits only at the model-send boundary, with a strict character budget. */
export function formatKnowledgeContext(
  result: Pick<KnowledgeRetrievalResult, 'hits'>,
  options: { maxChars?: number; maxHitChars?: number } = {}
): string | null {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const maxHitChars = options.maxHitChars ?? DEFAULT_MAX_HIT_CHARS;
  const blocks: string[] = [];
  let used = 0;

  for (const [index, hit] of result.hits.entries()) {
    const safeTitle = clip(hit.title.replace(/[<>]/g, ''), 120);
    const safeText = clip(hit.text.replace(/<\/?retrieved_context>/gi, ''), maxHitChars);
    const block = `[${index + 1}] [${hit.sourceType}] ${safeTitle} · score ${hit.score.toFixed(3)}\n${safeText}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length + 2;
  }
  return blocks.length ? blocks.join('\n\n') : null;
}

/** Attach one retrieval block to a question; retrieved text is explicitly untrusted. */
export function attachKnowledgeContext(
  question: string,
  result: KnowledgeRetrievalResult,
  options: { modeLabel?: string; maxChars?: number } = {}
): string {
  if (hasKnowledgeContext(question)) return question;
  const context = formatKnowledgeContext(result, { maxChars: options.maxChars });
  if (!context) return question;
  const modeLine = options.modeLabel
    ? `${i18n.t('messages.knowledgeRetrieval.modeLine', { mode: options.modeLabel })}\n`
    : '';
  const warning = i18n.t('messages.knowledgeRetrieval.promptWarning');
  const userQuestion = i18n.t('messages.knowledgeRetrieval.userQuestion', { question });
  return `${KNOWLEDGE_CONTEXT_MARK}\n${modeLine}${warning}\n<retrieved_context>\n${context}\n</retrieved_context>\n\n---\n${userQuestion}`;
}

/** Compatibility wrapper for existing meeting and explicit knowledge callers. */
export async function retrieveKnowledgeContext(query: string): Promise<KnowledgeSearchResult> {
  const result = await retrieveKnowledge({ query, scope: 'all' });
  return { context: formatKnowledgeContext(result), count: result.count, hits: result.hits };
}
