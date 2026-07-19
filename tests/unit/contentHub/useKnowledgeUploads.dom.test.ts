import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  wait: vi.fn(),
}));

vi.mock('@/renderer/pages/contentHub/knowledge/knowledgeApi', () => ({
  uploadKnowledgeFile: mocks.upload,
  waitForKnowledgeJob: mocks.wait,
}));

import { useKnowledgeUploads } from '@/renderer/pages/contentHub/knowledge/useKnowledgeUploads';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wait.mockResolvedValue(undefined);
});

describe('knowledge upload queue', () => {
  it('runs no more than two imports concurrently and starts the next after one completes', async () => {
    const resolvers: Array<(value: { success: boolean }) => void> = [];
    mocks.upload.mockImplementation(() => new Promise<{ success: boolean }>((resolve) => resolvers.push(resolve)));
    const changed = vi.fn();
    const { result } = renderHook(() => useKnowledgeUploads(changed));

    act(() => {
      result.current.enqueue(new File(['a'], 'a.md'));
      result.current.enqueue(new File(['b'], 'b.md'));
      result.current.enqueue(new File(['c'], 'c.md'));
    });

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    await act(async () => resolvers[0]?.({ success: true }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(3));
    expect(result.current.tasks.filter((task) => task.phase === 'uploading')).toHaveLength(2);
  });

  it('keeps a failed file for an explicit retry and then completes it', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('worker unavailable')).mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useKnowledgeUploads(vi.fn()));

    act(() => result.current.enqueue(new File(['a'], 'a.md')));
    await waitFor(() => expect(result.current.tasks[0]?.phase).toBe('error'));
    expect(result.current.tasks[0]?.error).toBe('worker unavailable');

    act(() => result.current.retry(result.current.tasks[0]!.id));
    await waitFor(() => expect(result.current.tasks[0]?.phase).toBe('done'));
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });
});
