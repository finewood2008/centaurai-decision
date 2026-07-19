import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  attach: vi.fn(),
}));

vi.mock('@/renderer/services/knowledgeBaseSearch', () => ({
  hasKnowledgeContext: (value: string) =>
    value.includes('【CentaurAI 检索上下文】') || value.includes('【知识库检索结果】'),
  retrieveKnowledge: mocks.retrieve,
  attachKnowledgeContext: mocks.attach,
}));
vi.mock('@/renderer/services/i18n', () => ({
  default: { t: (key: string) => key },
}));

import { maybeAttachLocalVectorContext } from '@/renderer/pages/conversation/platforms/acp/localVectorDbContext';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.retrieve.mockResolvedValue({ query: 'x', scope: 'memory', mode: 'text', hits: [], count: 0, reranked: false });
  mocks.attach.mockImplementation((question: string) => `attached:${question}`);
});

describe('ACP automatic private retrieval', () => {
  it('does not retrieve again when the explicit-send path already attached context', async () => {
    const message = '【CentaurAI 检索上下文】\n资料\n\n---\n用户问题：公司章程是什么？';

    await expect(maybeAttachLocalVectorContext(message, 'codex')).resolves.toBe(message);
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('uses the unified memory scope for profile questions', async () => {
    await expect(maybeAttachLocalVectorContext('你知道我是谁吗？', 'codex')).resolves.toBe('attached:你知道我是谁吗？');

    expect(mocks.retrieve).toHaveBeenCalledWith(expect.objectContaining({ scope: 'memory', limit: 5, mode: 'text' }));
    expect(mocks.attach).toHaveBeenCalledTimes(1);
  });
});
