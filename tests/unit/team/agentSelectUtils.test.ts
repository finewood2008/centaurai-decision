/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import { cliAgentToOption } from '@/renderer/pages/team/components/agentSelectUtils';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';

const gemini = {
  id: 'cc126dd5',
  name: 'Gemini CLI',
  backend: 'gemini',
  agent_type: 'acp',
  behavior_policy: { supports_team: true },
  team_capable: true,
} as AgentMetadata;

describe('team agent selection identity', () => {
  it('uses the Core assistant identity and authoritative team capability', () => {
    const option = cliAgentToOption(gemini, { id: 'bare:cc126dd5', team_selectable: true });

    expect(option.id).toBe('bare:cc126dd5');
    expect(option.team_capable).toBe(true);
  });

  it('prevents an unmatched management agent from being sent to team creation', () => {
    const option = cliAgentToOption(gemini, null);

    expect(option.id).toBe('cc126dd5');
    expect(option.team_capable).toBe(false);
  });
});
