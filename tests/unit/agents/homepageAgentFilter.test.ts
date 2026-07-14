import { describe, expect, it } from 'vitest';
import {
  filterSupersededHomepageAgents,
  type AgentMetadata,
} from '../../../packages/desktop/src/renderer/utils/model/agentTypes';

function agent(overrides: Partial<AgentMetadata>): AgentMetadata {
  return {
    id: 'agent-id',
    name: 'Agent',
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    available: true,
    ...overrides,
  };
}

describe('filterSupersededHomepageAgents', () => {
  it('hides the legacy OpenClaw gateway when ACP OpenClaw is present', () => {
    const acpOpenClaw = agent({ id: 'new', name: 'OpenClaw', backend: 'openclaw' });
    const legacyOpenClaw = agent({
      id: 'legacy',
      name: 'OpenClaw',
      agent_type: 'openclaw-gateway',
    });

    expect(filterSupersededHomepageAgents([acpOpenClaw, legacyOpenClaw])).toEqual([acpOpenClaw]);
  });

  it('keeps the legacy gateway as a fallback when ACP OpenClaw is absent', () => {
    const legacyOpenClaw = agent({ id: 'legacy', agent_type: 'openclaw-gateway' });

    expect(filterSupersededHomepageAgents([legacyOpenClaw])).toEqual([legacyOpenClaw]);
  });

  it('does not hide a user-defined OpenClaw gateway', () => {
    const acpOpenClaw = agent({ id: 'new', backend: 'openclaw' });
    const customGateway = agent({
      id: 'custom',
      agent_type: 'openclaw-gateway',
      agent_source: 'custom',
    });

    expect(filterSupersededHomepageAgents([acpOpenClaw, customGateway])).toEqual([acpOpenClaw, customGateway]);
  });
});
