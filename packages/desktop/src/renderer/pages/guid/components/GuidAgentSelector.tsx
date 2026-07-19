/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Plus, Robot } from '@icon-park/react';
import { Tooltip } from '@arco-design/web-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { getAgentDisplayName, type AgentSource } from '@/renderer/utils/model/agentTypes';
import type { AvailableAgent } from '../types';
import styles from '../index.module.css';

type GuidAgentSelectorProps = {
  availableAgents: AvailableAgent[];
  selectedAgentKey: string;
  getAgentKey: (agent: {
    agent_type: string;
    agent_source?: AgentSource;
    backend?: string;
    id?: string;
    custom_agent_id?: string;
  }) => string;
  onSelectAgent: (key: string) => void;
};

const isCentaurAI = (agent: AvailableAgent) => {
  const key = (agent.backend || agent.agent_type || '').toLowerCase();
  return key === 'aionrs' || key === 'aion-cli';
};

const GuidAgentSelector: React.FC<GuidAgentSelectorProps> = ({
  availableAgents,
  selectedAgentKey,
  getAgentKey,
  onSelectAgent,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const agents = availableAgents.filter((agent) => !agent.is_preset && agent.enabled !== false);
  const regularAgents = agents.filter((agent) => !isCentaurAI(agent));
  const centaurAgents = agents.filter(isCentaurAI);

  const renderAgent = (agent: AvailableAgent) => {
    const key = getAgentKey(agent);
    const isSelected = selectedAgentKey === key;
    const displayName = isCentaurAI(agent) ? 'CentaurAI' : getAgentDisplayName(agent);
    const extensionAvatar = resolveExtensionAssetUrl(agent.isExtension ? agent.avatar : undefined);
    const usesEmoji = (agent.agent_type === 'remote' || agent.agent_source === 'custom') && Boolean(agent.avatar);
    const emojiAvatar = usesEmoji ? agent.avatar : undefined;
    const logoSrc =
      extensionAvatar ||
      (!emojiAvatar
        ? resolveAgentLogo({
            icon: agent.icon,
            backend: agent.backend || agent.agent_type,
            custom_agent_id: agent.custom_agent_id,
            isExtension: agent.isExtension,
          })
        : undefined);
    return (
      <button
        key={key}
        type='button'
        data-testid={`agent-pill-${agent.backend}`}
        data-agent-selected={isSelected ? 'true' : 'false'}
        className={`${styles.agentSegment} ${isSelected ? styles.agentSegmentSelected : ''}`}
        onClick={() => onSelectAgent(key)}
      >
        <span className={styles.agentSegmentIcon} aria-hidden='true'>
          {emojiAvatar ? (
            <span className={styles.agentSegmentEmoji}>{emojiAvatar}</span>
          ) : logoSrc ? (
            <img src={logoSrc} alt='' width={18} height={18} />
          ) : (
            <Robot theme='outline' size={18} fill='currentColor' />
          )}
        </span>
        <span className={styles.agentSegmentName}>{displayName}</span>
      </button>
    );
  };

  return (
    <div className={styles.agentSegmentBar}>
      {regularAgents.map(renderAgent)}
      <Tooltip content={t('settings.agentManagement.discoverMoreAgents', { defaultValue: '发现更多 Agent' })}>
        <button
          type='button'
          className={styles.agentSegmentAdd}
          onClick={() => navigate('/settings/agent')}
          aria-label={t('settings.agentManagement.discoverMoreAgents', { defaultValue: '发现更多 Agent' })}
        >
          <Plus theme='outline' size={16} fill='currentColor' />
        </button>
      </Tooltip>
      {centaurAgents.map(renderAgent)}
    </div>
  );
};

export default GuidAgentSelector;
