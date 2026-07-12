import { describe, expect, it } from 'vitest';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { isLegacyOpenClawGateway } from '@/renderer/utils/model/agentTypes';

const agent = (overrides: Partial<AgentMetadata>): AgentMetadata => ({
  id: 'agent-1',
  name: 'Agent',
  agent_type: 'acp',
  agent_source: 'builtin',
  enabled: true,
  installed: true,
  status: 'unchecked',
  available: true,
  sort_order: 1000,
  ...overrides,
});

describe('Core agent catalog compatibility', () => {
  it('identifies only the historical OpenClaw Gateway row', () => {
    expect(isLegacyOpenClawGateway(agent({ agent_type: 'openclaw-gateway' }))).toBe(true);
    expect(isLegacyOpenClawGateway(agent({ backend: 'openclaw' }))).toBe(false);
    expect(isLegacyOpenClawGateway(agent({ agent_type: 'openclaw-gateway', agent_source: 'custom' }))).toBe(false);
  });
});
