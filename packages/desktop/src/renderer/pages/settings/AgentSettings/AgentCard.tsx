/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Avatar, Button, Switch, Tag, Typography } from '@arco-design/web-react';
import { Delete, EditTwo, Robot } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { getAgentDisplayName, type AgentMetadata } from '@/renderer/utils/model/agentTypes';

type AgentCardProps =
  | {
      type: 'detected';
      agent: AgentMetadata;
      onGoToChat: () => void;
      onToggle: (enabled: boolean) => void;
      onHealthCheck: () => void;
      checking: boolean;
    }
  | {
      type: 'custom';
      agent: AgentMetadata;
      onGoToChat: () => void;
      onEdit: () => void;
      onDelete: () => void;
      onToggle: (enabled: boolean) => void;
      onHealthCheck: () => void;
      checking: boolean;
    };

const statusColor = (agent: AgentMetadata): 'green' | 'orange' | 'red' | 'gray' => {
  if (!agent.enabled) return 'gray';
  if (agent.status === 'online') return 'green';
  if (agent.status === 'unchecked' || (!agent.status && agent.available)) return 'orange';
  return 'red';
};

const AgentCard: React.FC<AgentCardProps> = (props) => {
  const { t } = useTranslation();

  const statusText = (agent: AgentMetadata): string => {
    if (!agent.enabled) return t('settings.agentManagement.disabled');
    if (agent.status === 'online') return t('settings.agentManagement.statusOnline');
    if (agent.status === 'unchecked' || (!agent.status && agent.available)) {
      return t('settings.agentManagement.statusUnchecked');
    }
    if (agent.status === 'offline') return t('settings.agentManagement.statusOffline');
    return t('settings.agentManagement.statusMissing');
  };

  if (props.type === 'detected') {
    const { agent, onGoToChat, onToggle, onHealthCheck, checking } = props;
    const usable = agent.available;
    const displayName = getAgentDisplayName(agent);
    const logo = resolveAgentLogo({
      icon: agent.icon,
      backend: agent.backend || agent.agent_type,
    });

    return (
      <div
        className={`flex items-center justify-between px-16px py-10px rd-8px bg-aou-1 hover:bg-aou-2 transition-opacity ${!agent.enabled ? 'opacity-50' : ''}`}
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
            <div className='flex items-center gap-6px mt-2px'>
              <Tag size='small' color={statusColor(agent)}>
                {statusText(agent)}
              </Tag>
              {agent.last_check_guidance && (
                <Typography.Text className='text-11px text-t-secondary truncate' title={agent.last_check_guidance}>
                  {agent.last_check_guidance}
                </Typography.Text>
              )}
            </div>
          </div>
        </div>
        <div className='flex items-center gap-8px'>
          <Switch size='small' checked={agent.enabled} onChange={onToggle} />
          {(agent.installed ?? agent.available) && agent.enabled && (
            <Button size='small' type='text' loading={checking} onClick={onHealthCheck}>
              {t('settings.agentManagement.testConnection')}
            </Button>
          )}
          <Button size='small' type='text' onClick={onGoToChat} disabled={!usable}>
            {t('settings.agentManagement.goToChat')}
          </Button>
        </div>
      </div>
    );
  }

  const { agent, onGoToChat, onEdit, onDelete, onToggle, onHealthCheck, checking } = props;

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
          <Tag size='small' color={statusColor(agent)} className='mt-2px'>
            {statusText(agent)}
          </Tag>
        </div>
      </div>
      <div className='flex items-center gap-8px'>
        <Switch size='small' checked={agent.enabled !== false} onChange={onToggle} />
        {(agent.installed ?? agent.available) && agent.enabled && (
          <Button size='small' type='text' loading={checking} onClick={onHealthCheck}>
            {t('settings.agentManagement.testConnection')}
          </Button>
        )}
        <Button size='small' type='text' onClick={onGoToChat} disabled={!agent.available}>
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
