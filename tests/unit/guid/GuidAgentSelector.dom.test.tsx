/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AvailableAgent } from '@/renderer/pages/guid/types';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'Discover Agents' }) }));
vi.mock('@/renderer/utils/model/agentLogo', () => ({ resolveAgentLogo: () => undefined }));

import GuidAgentSelector from '@/renderer/pages/guid/components/GuidAgentSelector';

const agent = (backend: string, name: string, enabled = true) =>
  ({
    id: backend,
    backend,
    name,
    agent_type: backend === 'aionrs' ? 'aionrs' : 'acp',
    agent_source: 'builtin',
    enabled,
  }) as AvailableAgent;

describe('GuidAgentSelector', () => {
  it('renders CentaurAI as the final first-row button with the shortened name', () => {
    const { container } = render(
      <GuidAgentSelector
        availableAgents={[agent('aionrs', 'CentaurAI Core'), agent('claude', 'Claude')]}
        selectedAgentKey='claude'
        getAgentKey={(item) => item.backend || item.agent_type}
        onSelectAgent={vi.fn()}
      />
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons.item(buttons.length - 1)).toHaveTextContent('CentaurAI');
    expect(buttons.item(buttons.length - 1)).not.toHaveTextContent('Core');
  });

  it('does not render disabled agents', () => {
    render(
      <GuidAgentSelector
        availableAgents={[agent('aionrs', 'CentaurAI Core'), agent('claude', 'Claude', false)]}
        selectedAgentKey='aionrs'
        getAgentKey={(item) => item.backend || item.agent_type}
        onSelectAgent={vi.fn()}
      />
    );
    expect(screen.queryByTestId('agent-pill-claude')).not.toBeInTheDocument();
  });
});
