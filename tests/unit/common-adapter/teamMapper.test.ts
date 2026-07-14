/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { fromBackendTeam, toBackendAgent } from '@/common/adapter/teamMapper';
import type { TeamAgent } from '@/common/types/team/teamTypes';

function agent(overrides: Partial<TeamAgent> = {}): Omit<TeamAgent, 'slot_id' | 'conversation_id'> {
  return {
    role: 'leader',
    agent_type: 'claude',
    agent_name: '主持人',
    conversation_type: 'acp',
    status: 'pending',
    custom_agent_id: 'assistant-1',
    model: 'sonnet',
    ...overrides,
  };
}

describe('teamMapper Core 0.2 team contract', () => {
  it('sends assistant identity without rejected legacy fields', () => {
    expect(toBackendAgent(agent())).toEqual({
      name: '主持人',
      role: 'lead',
      model: 'sonnet',
      assistant_id: 'assistant-1',
    });
  });

  it('does not invent an assistant identity when the frontend record has none', () => {
    expect(toBackendAgent(agent({ custom_agent_id: undefined }))).toEqual({
      name: '主持人',
      role: 'lead',
      model: 'sonnet',
    });
  });

  it('reads the latest assistants and leader_assistant_id response fields', () => {
    const team = fromBackendTeam({
      id: 'team-1',
      name: '决策会',
      assistants: [
        {
          slot_id: 'slot-1',
          conversation_id: 'conversation-1',
          name: '主持人',
          role: 'lead',
          backend: 'claude',
          model: 'sonnet',
          assistant_id: 'assistant-1',
          status: 'idle',
        },
      ],
      leader_assistant_id: 'slot-1',
      created_at: 1,
      updated_at: 2,
    });

    expect(team.leader_agent_id).toBe('slot-1');
    expect(team.agents).toHaveLength(1);
    expect(team.agents[0].custom_agent_id).toBe('assistant-1');
  });
});
