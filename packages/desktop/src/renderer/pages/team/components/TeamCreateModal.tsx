import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Input, Message } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input/interface';
import { Check, Close, Crown, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TTeam, TeamAgent } from '@/common/types/team/teamTypes';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import AionModal from '@renderer/components/base/AionModal';
import { WorkspaceFolderSelect } from '@renderer/components/workspace';
import { getConversationCreateErrorMessage } from '@renderer/pages/conversation/utils/conversationCreateError';
import {
  agentKey,
  resolveConversationType,
  resolveTeamAgentType,
  filterTeamSupportedAgents,
  AgentOptionLabel,
  cliAgentToOption,
} from './agentSelectUtils';
import type { TeamAgentOption } from './agentSelectUtils';
import { resolveDefaultTeamAgentModel } from './teamCreateModelResolver';

// [E2E SYNC] 修改此组件的 DOM 结构（class、标题、关闭按钮等）时，
// 必须同步更新 tests/e2e/cases/teams/team-create.e2e.ts 和 team-whitelist.e2e.ts 中的 selector，
// 并立即向上汇报改动情况。
const FormItem = Form.Item;

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (team: TTeam) => void;
};

const AgentMultiSelectRow: React.FC<{
  agent: TeamAgentOption;
  isSelected: boolean;
  isLeader: boolean;
  onToggle: () => void;
  onPromoteLeader: () => void;
  makeLeaderTitle: string;
  leaderBadge: string;
}> = ({ agent, isSelected, isLeader, onToggle, onPromoteLeader, makeLeaderTitle, leaderBadge }) => (
  <div
    className={`flex cursor-pointer items-center gap-12px rounded-8px px-12px py-9px transition-colors ${
      isSelected ? 'bg-aou-1' : 'hover:bg-fill-2'
    }`}
    style={isSelected ? { boxShadow: 'inset 0 0 0 1px var(--aou-6)' } : undefined}
    onClick={onToggle}
    data-testid={`team-create-agent-option-${agentKey(agent)}`}
  >
    <div
      className='h-16px w-16px flex-shrink-0 rounded-4px flex items-center justify-center transition-all'
      style={{
        boxSizing: 'border-box',
        background: isSelected ? 'var(--aou-6)' : 'transparent',
        border: isSelected ? '1.5px solid var(--aou-6)' : '1.5px solid var(--color-border-3)',
      }}
    >
      {isSelected && <Check theme='outline' size='12' fill='#fff' />}
    </div>
    <div className='flex-1 overflow-hidden'>
      <AgentOptionLabel agent={agent} />
    </div>
    {isSelected &&
      (isLeader ? (
        <span
          className='shrink-0 flex items-center gap-3px text-11px font-500 text-[color:var(--aou-6)] px-6px py-2px rd-10px bg-[color:var(--aou-1)] border border-solid border-[color:var(--aou-6)]'
          title={leaderBadge}
        >
          <Crown theme='filled' size='11' fill='currentColor' />
          {leaderBadge}
        </span>
      ) : (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation();
            onPromoteLeader();
          }}
          title={makeLeaderTitle}
          className='shrink-0 flex items-center gap-3px text-11px text-[color:var(--color-text-3)] hover:text-[color:var(--aou-6)] px-6px py-2px rd-10px border border-solid border-[color:var(--color-border-3)] hover:border-[color:var(--aou-6)] bg-transparent cursor-pointer transition-colors'
          data-testid={`team-create-promote-${agentKey(agent)}`}
        >
          <Crown theme='outline' size='11' fill='currentColor' />
          {makeLeaderTitle}
        </button>
      ))}
  </div>
);

const TeamCreateModal: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { cliAgents } = useConversationAgents();
  const [name, setName] = useState('');
  // Ordered selection — first entry is the team leader; the rest are teammates.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const nameInputRef = useRef<RefInputType | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const handleToggleSearch = () => {
    if (searchExpanded) {
      setSearch('');
      setSearchExpanded(false);
    } else {
      setSearchExpanded(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  };

  // Only show real CLI agents — preset assistants are LLM-config wrappers,
  // not standalone team-capable agent processes. The user explicitly asked us
  // not to mix them into team creation.
  const allAgents = useMemo(() => filterTeamSupportedAgents(cliAgents.map(cliAgentToOption)), [cliAgents]);

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allAgents;
    return allAgents.filter((a) => a.name.toLowerCase().includes(q));
  }, [allAgents, search]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const leaderKey = selectedKeys[0];

  useEffect(() => {
    if (visible) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [visible]);

  const handleClose = () => {
    setName('');
    setSelectedKeys([]);
    setWorkspace('');
    setSearch('');
    setSearchExpanded(false);
    onClose();
  };

  const handleToggleAgent = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handlePromoteLeader = (key: string) => {
    setSelectedKeys((prev) => {
      if (!prev.includes(key) || prev[0] === key) return prev;
      return [key, ...prev.filter((k) => k !== key)];
    });
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Message.warning(t('team.create.nameRequired', { defaultValue: 'Please enter a team name' }));
      nameInputRef.current?.focus();
      return;
    }
    if (selectedKeys.length === 0) {
      Message.warning(t('team.create.membersRequired', { defaultValue: 'Please select at least one agent' }));
      return;
    }
    const user_id = user?.id ?? 'system_default_user';
    setLoading(true);
    try {
      // Build agents in selection order — first is the leader, rest are teammates.
      const orderedAgents = selectedKeys
        .map((key) => allAgents.find((a) => agentKey(a) === key))
        .filter((a): a is TeamAgentOption => Boolean(a));

      const agents: TeamAgent[] = await Promise.all(
        orderedAgents.map(async (agentOption, index) => {
          const agentType = resolveTeamAgentType(agentOption, 'acp');
          const conversationType = resolveConversationType(agentType);
          const resolvedModel = await resolveDefaultTeamAgentModel({
            agent_type: agentType,
            conversation_type: conversationType,
          });
          const isLeader = index === 0;
          return {
            slot_id: '',
            conversation_id: '',
            role: isLeader ? 'leader' : 'teammate',
            status: 'pending',
            agent_type: agentType,
            agent_name: isLeader ? 'Leader' : agentOption.name,
            icon: agentOption.icon,
            conversation_type: conversationType,
            custom_agent_id: agentOption.id,
            model: resolvedModel,
          };
        })
      );

      const team = await ipcBridge.team.create.invoke({
        user_id,
        name,
        workspace,
        workspace_mode: 'shared',
        agents,
      });

      // The platform bridge swallows provider errors and returns a sentinel object
      const result = team as unknown as { __bridgeError?: boolean; message?: string };
      if (result.__bridgeError) {
        Message.error(getConversationCreateErrorMessage(result.message ?? t('team.create.error'), t));
        return;
      }

      onCreated(team);
      handleClose();
    } catch (error) {
      Message.error(getConversationCreateErrorMessage(error, t));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AionModal
      visible={visible}
      onCancel={handleClose}
      className='team-create-modal'
      style={{ width: 560 }}
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
      autoFocus={false}
      unmountOnExit={false}
      contentStyle={{
        background: 'var(--dialog-fill-0)',
        padding: 0,
        overflow: 'hidden',
      }}
      header={{
        render: () => (
          <div className='flex items-center justify-between border-b border-border-2 bg-dialog-fill-0 px-24px py-18px'>
            <h3 className='m-0 text-16px font-600 text-t-primary'>
              {t('team.create.title', { defaultValue: 'Create Team' })}
            </h3>
            <Button
              type='text'
              icon={<Close size='18' fill='currentColor' className='text-t-secondary' />}
              onClick={handleClose}
              className='!h-28px !w-28px !min-w-28px !p-0 !rd-8px hover:!bg-fill-2'
            />
          </div>
        ),
      }}
      footer={
        <div className='flex justify-end gap-10px border-t border-border-2 bg-dialog-fill-0 px-24px py-16px'>
          <Button onClick={handleClose} className='min-w-80px' style={{ borderRadius: 8 }}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type='primary'
            onClick={handleCreate}
            loading={loading}
            disabled={!name.trim() || selectedKeys.length === 0}
            className='min-w-80px'
            style={{ borderRadius: 8 }}
          >
            {t('team.create.confirm', { defaultValue: 'Create Team' })}
          </Button>
        </div>
      }
    >
      <div className='px-24px py-20px' style={{ maxHeight: 'min(72vh, 640px)', overflowY: 'auto' }}>
        <Form layout='vertical'>
          {/* Team name */}
          <FormItem
            label={
              <span className='text-12px font-500 text-t-secondary'>
                {t('team.create.namePlaceholder', { defaultValue: 'Team name' })}
                <span className='ml-4px text-danger-6'>*</span>
              </span>
            }
          >
            <Input
              ref={nameInputRef}
              placeholder={t('team.create.namePlaceholder', { defaultValue: 'Team name' })}
              value={name}
              onChange={setName}
              data-testid='team-create-name-input'
            />
          </FormItem>

          {/* Team Members */}
          <FormItem
            label={
              <div className='flex flex-col gap-2px'>
                <div className='flex items-center justify-between gap-8px'>
                  <span className='text-12px font-500 text-t-secondary'>
                    {t('team.create.step.members', { defaultValue: 'Team Members' })}
                    <span className='ml-4px text-danger-6'>*</span>
                    {selectedKeys.length > 0 && (
                      <span className='ml-6px text-11px font-normal text-t-tertiary'>
                        {t('team.create.selectedCount', {
                          count: selectedKeys.length,
                          defaultValue: `${selectedKeys.length} selected`,
                        })}
                      </span>
                    )}
                  </span>
                  {allAgents.length > 0 && (
                    <button
                      type='button'
                      onClick={handleToggleSearch}
                      title={t('team.create.searchPlaceholder', { defaultValue: 'Search agents...' })}
                      aria-label={t('team.create.searchPlaceholder', { defaultValue: 'Search agents...' })}
                      className='shrink-0 flex items-center justify-center w-20px h-20px rd-4px text-[color:var(--color-text-3)] hover:text-[color:var(--color-text-1)] hover:bg-[var(--fill-2)] cursor-pointer border-none bg-transparent transition-colors'
                      style={{ lineHeight: 0 }}
                      data-testid='team-create-search-toggle'
                    >
                      <Search size='13' fill='currentColor' />
                    </button>
                  )}
                </div>
                <span className='text-11px font-normal leading-16px text-t-tertiary'>
                  {t('team.create.membersDesc', {
                    defaultValue: 'Pick one or more agents. The first selected becomes the team leader.',
                  })}
                </span>
              </div>
            }
          >
            {allAgents.length === 0 ? (
              <div className='flex items-center justify-center rounded-10px border border-dashed border-border-2 bg-fill-1 py-20px text-12px text-t-tertiary'>
                {t('team.create.noSupportedAgents', { defaultValue: 'No supported agents installed' })}
              </div>
            ) : (
              <div className='relative flex flex-col gap-8px'>
                {/* 搜索框（点搜索图标后展开） */}
                {searchExpanded && (
                  <div className='flex items-center gap-8px rounded-8px border border-border-2 bg-bg-2 px-12px py-8px focus-within:border-primary-6'>
                    <Search size='14' fill='currentColor' className='flex-shrink-0 text-t-tertiary' />
                    <input
                      ref={searchInputRef}
                      className='flex-1 border-none bg-transparent text-13px text-t-primary outline-none placeholder:text-t-tertiary'
                      placeholder={t('team.create.searchPlaceholder', { defaultValue: 'Search agents...' })}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      data-testid='team-create-leader-search'
                    />
                  </div>
                )}

                {/* 列表 —— 根据 agent 数量自适应，最大 320px */}
                <div className='max-h-320px overflow-y-auto rounded-12px border border-border-2 bg-fill-1 p-6px'>
                  {filteredAgents.length === 0 ? (
                    <div className='flex items-center justify-center py-20px text-12px text-t-tertiary'>
                      {t('team.create.noSearchResults', { defaultValue: 'No results found' })}
                    </div>
                  ) : (
                    filteredAgents.map((agent) => {
                      const key = agentKey(agent);
                      return (
                        <AgentMultiSelectRow
                          key={key}
                          agent={agent}
                          isSelected={selectedKeySet.has(key)}
                          isLeader={leaderKey === key}
                          onToggle={() => handleToggleAgent(key)}
                          onPromoteLeader={() => handlePromoteLeader(key)}
                          makeLeaderTitle={t('team.create.makeLeader', { defaultValue: 'Set as leader' })}
                          leaderBadge={t('team.create.leaderBadge', { defaultValue: 'Leader' })}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </FormItem>

          {/* Project / Workspace */}
          <FormItem
            label={
              <span className='text-12px font-500 text-t-secondary'>
                {t('team.create.step.workspace', { defaultValue: 'Project' })}
                <span className='ml-4px text-11px font-normal text-t-tertiary'>
                  {t('common.optional', { defaultValue: '(optional)' })}
                </span>
              </span>
            }
          >
            <WorkspaceFolderSelect
              value={workspace}
              onChange={setWorkspace}
              placeholder={t('team.create.selectFolder', { defaultValue: 'Select folder' })}
              input_placeholder={t('team.create.workspacePlaceholder', {
                defaultValue: 'Project folder path (optional)',
              })}
              recentLabel={t('team.create.recentLabel', { defaultValue: 'Recent' })}
              chooseDifferentLabel={t('team.create.chooseDifferentFolder', {
                defaultValue: 'Choose a different folder',
              })}
              triggerTestId='team-create-workspace-trigger'
              menuTestId='team-create-workspace-menu'
            />
          </FormItem>
        </Form>
      </div>
    </AionModal>
  );
};

export default TeamCreateModal;
