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

/**
 * Minimal segmented agent selector — a de-branded replacement for the vendor
 * logo pill bar. Each agent is a neutral dot + name; the selected one gets a
 * brand-colored underline, and hovering scales the segment. Keeps the lively
 * hover feel without the vendor-logo identity.
 */
const GuidAgentSelector: React.FC<GuidAgentSelectorProps> = ({
  availableAgents,
  selectedAgentKey,
  getAgentKey,
  onSelectAgent,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // CentaurAI (the aionrs agent) is pinned to the LAST position of the bar.
  const isCentaurAI = (agent: AvailableAgent) => {
    const key = (agent.backend || agent.agent_type || '').toLowerCase();
    return key === 'aionrs' || key === 'aion-cli';
  };
  const agents = availableAgents
    .filter((agent) => !agent.is_preset)
    .toSorted((a, b) => Number(isCentaurAI(a)) - Number(isCentaurAI(b)));

  return (
    <div className={styles.agentSegmentBar}>
      {agents.map((agent) => {
        const key = getAgentKey(agent);
        const isSelected = selectedAgentKey === key;
        // Resolve each agent's own icon: extension avatar → emoji (remote/custom)
        // → bundled vendor logo → Robot fallback.
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
            <span className={styles.agentSegmentName}>{getAgentDisplayName(agent)}</span>
          </button>
        );
      })}
      <Tooltip content={t('settings.agentManagement.discoverMoreAgents', { defaultValue: '发现更多 Agent' })}>
        <button
          type='button'
          className={styles.agentSegmentAdd}
          onClick={() => navigate('/settings/agent?tab=local')}
          aria-label={t('settings.agentManagement.discoverMoreAgents', { defaultValue: '发现更多 Agent' })}
        >
          <Plus theme='outline' size={16} fill='currentColor' />
        </button>
      </Tooltip>
    </div>
  );
};

export default GuidAgentSelector;
