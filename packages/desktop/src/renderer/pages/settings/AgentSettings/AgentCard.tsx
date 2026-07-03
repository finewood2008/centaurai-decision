/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Avatar, Button, Switch, Typography } from '@arco-design/web-react';
import { Delete, EditTwo, Robot } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { getAgentDisplayName } from '@/renderer/utils/model/agentTypes';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';

type DetectedAgent = {
  agent_type: string;
  backend?: string;
  icon?: string;
  name: string;
  custom_agent_id?: string;
  isExtension?: boolean;
  avatar?: string;
};

/** Minimal custom-agent fields consumed by the 'custom' card variant. */
type CustomAgentCardData = {
  id: string;
  name: string;
  /** User-picked emoji or avatar URL (maps to `AgentMetadata.icon`). */
  icon?: string;
  /** Spawn command for the CLI. */
  command?: string;
  /** Launch arguments for the CLI. */
  args?: string[];
  enabled: boolean;
};

type AgentCardProps =
  | {
      type: 'detected';
      agent: DetectedAgent;
      onGoToChat: () => void;
      enabled: boolean;
      onToggle: (enabled: boolean) => void;
    }
  | {
      type: 'custom';
      agent: CustomAgentCardData;
      onGoToChat: () => void;
      onEdit: () => void;
      onDelete: () => void;
      onToggle: (enabled: boolean) => void;
    };

const AgentCard: React.FC<AgentCardProps> = (props) => {
  const { t } = useTranslation();

  if (props.type === 'detected') {
    const { agent, onGoToChat, enabled, onToggle } = props;
    const displayName = getAgentDisplayName(agent);
    const extensionAvatar = resolveExtensionAssetUrl(agent.isExtension ? agent.avatar : undefined);
    const logo =
      extensionAvatar ||
      resolveAgentLogo({
        icon: agent.icon,
        backend: agent.backend || agent.agent_type,
        custom_agent_id: agent.custom_agent_id,
        isExtension: agent.isExtension,
      });

    return (
      <div
        className={`flex items-center justify-between px-16px py-10px rd-8px bg-aou-1 hover:bg-aou-2 transition-opacity ${!enabled ? 'opacity-50' : ''}`}
      >
        <div className='flex items-center gap-12px min-w-0 flex-1'>
          <Avatar size={32} shape='square' style={{ flexShrink: 0, backgroundColor: 'transparent' }}>
            {logo ? (
              <img src={logo} alt={displayName} className='h-full w-full object-contain' />
            ) : (
              <Robot theme='outline' size='20' />
            )}
          </Avatar>
          <div className='min-w-0 flex-1'>
            <Typography.Text className='font-medium text-14px'>{displayName}</Typography.Text>
            <Typography.Text className='block text-11px text-t-secondary'>
              {enabled ? t('settings.agentManagement.detected') : t('settings.agentManagement.disabled')}
            </Typography.Text>
          </div>
        </div>
        <div className='flex items-center gap-8px'>
          <Switch size='small' checked={enabled} onChange={onToggle} />
          <Button size='small' type='text' onClick={onGoToChat} disabled={!enabled}>
            {t('settings.agentManagement.goToChat')}
          </Button>
        </div>
      </div>
    );
  }

  const { agent, onGoToChat, onEdit, onDelete, onToggle } = props;

  return (
    <div className='flex items-center justify-between px-16px py-10px rd-8px bg-aou-1 hover:bg-aou-2'>
      <div className='flex items-center gap-12px min-w-0 flex-1'>
        <Avatar
          size={32}
          shape='square'
          style={{ flexShrink: 0, backgroundColor: agent.icon ? 'var(--color-fill-2)' : 'transparent', fontSize: 18 }}
        >
          {agent.icon || <Robot theme='outline' size='20' />}
        </Avatar>
        <div className='min-w-0 flex-1'>
          <Typography.Text className='font-medium text-14px'>
            {agent.name || t('settings.agentManagement.custom')}
          </Typography.Text>
          <div className='text-12px text-t-secondary truncate'>
            {agent.command}
            {agent.args && agent.args.length > 0 ? ` ${agent.args.join(' ')}` : ''}
          </div>
        </div>
      </div>
      <div className='flex items-center gap-8px'>
        <Switch size='small' checked={agent.enabled !== false} onChange={onToggle} />
        <Button size='small' type='text' onClick={onGoToChat} disabled={agent.enabled === false}>
          {t('settings.agentManagement.goToChat')}
        </Button>
        <Button size='small' type='text' icon={<EditTwo theme='outline' size='14' />} onClick={onEdit} />
        <Button
          size='small'
          type='text'
          status='danger'
          icon={<Delete theme='outline' size='14' />}
          onClick={onDelete}
        />
      </div>
    </div>
  );
};

export default AgentCard;
