/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TeamAgent } from '@/common/types/team/teamTypes';
import MeetingRoster from '@/renderer/pages/team/meeting/MeetingRoster';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: undefined }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

const agent = (slot_id: string, name: string, role: TeamAgent['role']): TeamAgent => ({
  slot_id,
  agent_type: 'aionrs',
  agent_name: name,
  conversation_id: `conv-${slot_id}`,
  role,
  status: 'idle',
  model: 'default',
});

describe('MeetingRoster', () => {
  it('uses the full seat layout before a meeting starts', () => {
    render(
      <MeetingRoster
        moderator={agent('leader', 'Leader', 'leader')}
        panelists={[agent('member', 'CentaurAI', 'teammate')]}
        activeSlotId={null}
        guests={[]}
      />
    );

    const roster = screen.getByTestId('meeting-roster');
    expect(roster).not.toHaveAttribute('data-compact');
    expect(screen.getByText('主持人')).toBeInTheDocument();
    expect(screen.getAllByText('aionrs').length).toBeGreaterThan(0);
  });

  it('uses a compact participant strip after a meeting starts', () => {
    render(
      <MeetingRoster
        moderator={agent('leader', 'Leader', 'leader')}
        panelists={[agent('member', 'CentaurAI', 'teammate')]}
        activeSlotId='member'
        guests={[]}
        compact
      />
    );

    const roster = screen.getByTestId('meeting-roster');
    expect(roster).toHaveAttribute('data-compact', 'true');
    expect(screen.getByText('主持')).toBeInTheDocument();
    expect(screen.getByText('发言中')).toBeInTheDocument();
    expect(screen.queryByText('aionrs')).not.toBeInTheDocument();
  });
});
