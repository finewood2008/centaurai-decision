import { describe, expect, it, vi } from 'vitest';
import {
  collectKnowledgeDocs,
  displayKnowledgeName,
  type KnowledgeDoc,
} from '@/renderer/pages/contentHub/knowledge/knowledgeApi';

describe('knowledge document names', () => {
  it('hides the vector worker upload prefix from users', () => {
    expect(displayKnowledgeName('a1b2c3d4_quarterly-plan.pdf')).toBe('quarterly-plan.pdf');
  });

  it('keeps ordinary file names unchanged', () => {
    expect(displayKnowledgeName('quarterly-plan.pdf')).toBe('quarterly-plan.pdf');
    expect(displayKnowledgeName('1234567_report.pdf')).toBe('1234567_report.pdf');
  });
});

describe('knowledge document pagination', () => {
  it('loads subsequent pages until the reported total is reached', async () => {
    const docs = Array.from(
      { length: 3 },
      (_, index): KnowledgeDoc => ({
        id: String(index),
        name: `${index}.md`,
        path: `/kb/${index}.md`,
        fileType: 'document',
        size: 1,
        mtime: 1,
        chunkCount: 1,
      })
    );
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ total: 3, docs: docs.slice(0, 2) })
      .mockResolvedValueOnce({ total: 3, docs: docs.slice(2) });

    await expect(collectKnowledgeDocs(fetchPage, 2)).resolves.toEqual({ total: 3, docs });
    expect(fetchPage).toHaveBeenNthCalledWith(1, 2, 0);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it('stops when a backend returns an empty page before its stale total', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ total: 10, docs: [] });

    await expect(collectKnowledgeDocs(fetchPage, 5)).resolves.toEqual({ total: 10, docs: [] });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
