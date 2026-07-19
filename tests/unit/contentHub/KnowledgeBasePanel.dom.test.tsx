import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/renderer/utils/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/utils/platform')>()),
  isElectronDesktop: () => mocks.desktop,
}));

import KnowledgeBasePanel from '@/renderer/pages/contentHub/knowledge/KnowledgeBasePanel';
import type { KnowledgeState } from '@/renderer/pages/contentHub/knowledge/useKnowledgeBase';

const state: KnowledgeState = {
  docs: [
    {
      id: '/watch/plan.md',
      name: 'plan.md',
      path: '/watch/plan.md',
      fileType: 'text',
      size: 12,
      mtime: 1,
      chunkCount: 2,
      status: 'indexed',
      indexed: true,
      onDisk: true,
    },
  ],
  total: 1,
  loading: false,
  error: false,
  reload: vi.fn(),
};

beforeEach(() => {
  mocks.desktop = false;
});

afterEach(cleanup);

describe('knowledge base permissions', () => {
  it('lets LAN users import files without exposing destructive controls', () => {
    render(<KnowledgeBasePanel state={state} view='list' size='medium' />);

    expect(screen.getByText('contentHub.knowledge.import')).toBeInTheDocument();
    expect(screen.queryByText('contentHub.knowledge.trash')).not.toBeInTheDocument();
  });

  it('shows the recoverable recycle-bin entry on the desktop administrator', () => {
    mocks.desktop = true;
    render(<KnowledgeBasePanel state={state} view='list' size='medium' />);

    expect(screen.getByText('contentHub.knowledge.trash')).toBeInTheDocument();
  });
});
