import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Form, Input, Message, Radio, Select } from '@arco-design/web-react';
import type { RefInputType } from '@arco-design/web-react/es/Input';
import { Check, Close, Crown, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TTeam, TeamAgent } from '@/common/types/team/teamTypes';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import { useModelProviderList } from '@renderer/hooks/agent/useModelProviderList';
import AionModal from '@renderer/components/base/AionModal';
import { WorkspaceFolderSelect } from '@renderer/components/workspace';
import { addGuest as storeAddGuest, buildModelExpertOptions, optionToGuest } from '../meeting/meetingGuests';
import { getConversationCreateErrorMessage } from '@renderer/pages/conversation/utils/conversationCreateError';
import {
  agentKey,
  resolveConversationType,
  resolveTeamAgentType,
  AgentOptionLabel,
  cliAgentToOption,
} from './agentSelectUtils';
import type { TeamAgentOption } from './agentSelectUtils';
import { resolveDefaultTeamAgentModel } from './teamCreateModelResolver';
import { IS_DECISION } from '@/common/config/constants';
import { PRESET_DEPARTMENTS } from '../meeting/presetDepartments';
import { setTeamMeetingForm } from '../meeting/useMeetingOrchestrator';
import { MEETING_FORMS } from '../meeting/meetingPrompts';
import type { MeetingForm } from '../meeting/meetingTypes';

/** Remembered agent panel to pre-fill the next 智囊团. */
const LAST_PANEL_KEY = 'roundtable-last-panel';

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
  /** Whether this agent can moderate (team-capable). Model experts / openclaw / hermes can't. */
  canLead: boolean;
  onToggle: () => void;
  onPromoteLeader: () => void;
  makeLeaderTitle: string;
  leaderBadge: string;
  expertTag: string;
}> = ({ agent, isSelected, isLeader, canLead, onToggle, onPromoteLeader, makeLeaderTitle, leaderBadge, expertTag }) => (
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
    {/* 直连模型专家 — a model, not a moderating backend; tag it so the mix is clear. */}
    {agent.isModelExpert && (
      <span
        className='shrink-0 text-10px text-[color:var(--color-text-3)] px-5px py-1px rd-8px bg-[var(--fill-2)]'
        title={expertTag}
      >
        {expertTag}
      </span>
    )}
    {isSelected &&
      canLead &&
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
  const { providers, getAvailableModels } = useModelProviderList();
  // The 智囊团's name (a team, not a single discussion — the topic is set later in the room).
  const [name, setName] = useState('');
  // Ordered selection — first entry is the team leader/moderator; the rest are panelists.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  // Optional project folder (kept for users who want a fixed workspace per 智囊团).
  const [workspace, setWorkspace] = useState('');
  // Decision edition: discussion method (manual) + optional department template.
  const [method, setMethod] = useState<MeetingForm>('roundtable');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const nameInputRef = useRef<RefInputType | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Seed the panel from last-used once per open (after agents have loaded).
  const seededRef = useRef(false);

  const handleToggleSearch = () => {
    if (searchExpanded) {
      setSearch('');
      setSearchExpanded(false);
    } else {
      setSearchExpanded(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  };

  // ALL experts are selectable here — no "guest" tier:
  //  • CLI-agent backends (CentaurAI / Claude / Codex / OpenClaw / Hermes …)
  //  • 直连模型专家: each configured provider model, incl. the user's SiliconFlow 国产模型
  // On submit, team-capable backends form the aioncore team (first = moderator); the
  // rest (openclaw/hermes + every 直连模型专家) join via the renderer-orchestrated extras.
  const allAgents = useMemo(() => {
    const backends = cliAgents.map(cliAgentToOption);
    const modelExperts = buildModelExpertOptions(providers, getAvailableModels);
    return [...backends, ...modelExperts];
  }, [cliAgents, providers, getAvailableModels]);

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allAgents;
    return allAgents.filter((a) => a.name.toLowerCase().includes(q));
  }, [allAgents, search]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  // Only a team-capable backend can moderate (a 直连模型专家 / openclaw / hermes can't
  // run the aioncore team). The moderator is the first selected team-capable agent.
  const leaderKey = useMemo(
    () => selectedKeys.find((k) => allAgents.find((a) => agentKey(a) === k)?.team_capable),
    [selectedKeys, allAgents]
  );

  useEffect(() => {
    if (visible) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [visible]);

  // Pre-fill the agent panel from the user's last 智囊团, once per open.
  useEffect(() => {
    if (!visible) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || allAgents.length === 0) return;
    seededRef.current = true;
    try {
      const raw = localStorage.getItem(LAST_PANEL_KEY);
      if (!raw) return;
      const last = JSON.parse(raw) as { agentKeys?: string[] };
      const validKeys = (last.agentKeys ?? []).filter((k) => allAgents.some((a) => agentKey(a) === k));
      if (validKeys.length > 0) setSelectedKeys(validKeys);
    } catch {
      // ignore malformed storage
    }
  }, [visible, allAgents]);

  const handleClose = () => {
    setName('');
    setSelectedKeys([]);
    setWorkspace('');
    setMethod('roundtable');
    setDepartmentId('');
    setSearch('');
    setSearchExpanded(false);
    onClose();
  };

  const handleToggleAgent = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handlePromoteLeader = (key: string) => {
    // Only a team-capable backend can moderate.
    if (!allAgents.find((a) => agentKey(a) === key)?.team_capable) return;
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
    // Selected agents in order. Split: team-capable → the aioncore team (first = the
    // moderator/host); non-team-capable (openclaw/hermes) → the renderer-orchestrated
    // extras. Both are equal experts in the debate — the split is only because
    // aioncore's team.create rejects non-MCP backends.
    const orderedAgents = selectedKeys
      .map((key) => allAgents.find((a) => agentKey(a) === key))
      .filter((a): a is TeamAgentOption => Boolean(a));
    const teamCapable = orderedAgents.filter((a) => a.team_capable);
    const extraAgents = orderedAgents.filter((a) => !a.team_capable);
    if (teamCapable.length === 0) {
      Message.warning(
        t('team.create.needTeamCapable', {
          defaultValue: '请至少选择一个支持团队的模型作为主持人（如 CentaurAI / Claude）',
        })
      );
      return;
    }
    setLoading(true);
    try {
      const agents: TeamAgent[] = await Promise.all(
        teamCapable.map(async (agentOption, index) => {
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

      // The non-team-capable picks (openclaw / hermes + every 直连模型专家) join the
      // debate via the renderer-orchestrated extras. optionToGuest preserves the
      // provider+model pin for 直连模型专家.
      extraAgents.map(optionToGuest).forEach((g) => storeAddGuest(team.id, g));

      // Decision edition: fix the discussion method (+ optional department template) now;
      // hydrate() reads it into state.form/departmentId — the room has no runtime picker.
      if (IS_DECISION) setTeamMeetingForm(team.id, method, departmentId || undefined);

      // Remember this panel for the next 智囊团. Creating only sets up the team — the
      // room opens blank (idle) and the user sets the topic + starts the discussion there.
      try {
        localStorage.setItem(LAST_PANEL_KEY, JSON.stringify({ agentKeys: selectedKeys }));
      } catch {
        // ignore storage failures
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
              {t(IS_DECISION ? 'decision.createTitle' : 'team.create.title', { defaultValue: '新建智囊团' })}
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
            {t('team.create.confirm', { defaultValue: '创建' })}
          </Button>
        </div>
      }
    >
      <div className='px-24px py-20px' style={{ maxHeight: 'min(72vh, 640px)', overflowY: 'auto' }}>
        <Form layout='vertical'>
          {/* Decision edition: manually pick a discussion method; optionally start from a department template. */}
          {IS_DECISION && (
            <>
              <FormItem
                label={<span className='text-12px font-500 text-t-secondary'>{t('decision.methodLabel', { defaultValue: '讨论方式' })}</span>}
              >
                <Radio.Group
                  type='button'
                  value={method}
                  onChange={(v) => setMethod(v as MeetingForm)}
                  data-testid='team-create-method-picker'
                >
                  {MEETING_FORMS.map((f) => (
                    <Radio key={f.id} value={f.id}>
                      {f.label}
                    </Radio>
                  ))}
                </Radio.Group>
                <div className='mt-6px text-11px text-t-tertiary'>{MEETING_FORMS.find((f) => f.id === method)?.hint}</div>
              </FormItem>
              <FormItem
                label={<span className='text-12px font-500 text-t-secondary'>{t('decision.templateLabel', { defaultValue: '预设模板（可选）' })}</span>}
              >
                <Select
                  placeholder={t('decision.templatePlaceholder', { defaultValue: '可选：套用一个部门模板（自动设好讨论方式与领域提示词）' })}
                  allowClear
                  value={departmentId || undefined}
                  onChange={(v) => {
                    const id = (v as string) || '';
                    setDepartmentId(id);
                    const dept = PRESET_DEPARTMENTS.find((d) => d.id === id);
                    if (dept) {
                      setMethod(dept.form);
                      if (!name.trim()) setName(t(dept.nameKey, { defaultValue: dept.id }));
                    }
                  }}
                  data-testid='team-create-department-picker'
                >
                  {PRESET_DEPARTMENTS.map((d) => (
                    <Select.Option key={d.id} value={d.id}>
                      {t(d.nameKey, { defaultValue: d.id })}
                    </Select.Option>
                  ))}
                </Select>
                {(() => {
                  const dept = PRESET_DEPARTMENTS.find((d) => d.id === departmentId);
                  if (!dept) return null;
                  return <div className='mt-6px text-11px text-t-tertiary'>{t(dept.hintKey, { defaultValue: '' })}</div>;
                })()}
              </FormItem>
            </>
          )}
          {/* 智囊团 name (a team — the discussion topic is set later in the room). */}
          <FormItem
            label={
              <span className='text-12px font-500 text-t-secondary'>
                {t('team.create.nameLabel', { defaultValue: '团队名称' })}
                <span className='ml-4px text-danger-6'>*</span>
              </span>
            }
          >
            <Input
              ref={nameInputRef}
              placeholder={t(IS_DECISION ? 'decision.namePlaceholder' : 'team.create.namePlaceholder', {
                defaultValue: '给你的智囊团起个名字，如「增长策略组」「产品方向智囊团」…',
              })}
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
                          canLead={Boolean(agent.team_capable)}
                          onToggle={() => handleToggleAgent(key)}
                          onPromoteLeader={() => handlePromoteLeader(key)}
                          makeLeaderTitle={t('team.create.makeLeader', { defaultValue: 'Set as leader' })}
                          leaderBadge={t('team.create.leaderBadge', { defaultValue: 'Leader' })}
                          expertTag={t('team.create.modelExpertTag', { defaultValue: '直连模型' })}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </FormItem>

          {/* Project / Workspace (optional) */}
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
