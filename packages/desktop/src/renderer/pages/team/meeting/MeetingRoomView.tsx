import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Message, Popover, Spin } from '@arco-design/web-react';
import {
  Checklist,
  Copy,
  Crown,
  Download,
  Notes,
  PeoplePlus,
  Plus,
  RightOne,
  Scale,
  VideoConference,
} from '@icon-park/react';
import type { TTeam } from '@/common/types/team/teamTypes';
import MarkdownView from '@/renderer/components/Markdown';
import { emitter } from '@/renderer/utils/emitter';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import { resolveBackendAssetUrl } from '@renderer/utils/platform';
import MeetingRoster from './MeetingRoster';
import MeetingPhaseBar from './MeetingPhaseBar';
import MeetingControlBar from './MeetingControlBar';
import MeetingResolutionCard from './MeetingResolutionCard';
import MeetingGuestPanel from './MeetingGuestPanel';
import { stripResolutionMarkers } from './meetingPrompts';
import { useMeetingOrchestrator } from './useMeetingOrchestrator';
import type { MeetingTurn } from './meetingTypes';
import { IS_DECISION } from '@/common/config/constants';

type Props = {
  team: TTeam;
};

/**
 * Small speaker avatar for a transcript turn — makes a multi-model debate easy
 * to scan. Resolves an explicit icon (asset/url), emoji, or backend logo, with a
 * monogram fallback. (MeetingTurn already carries icon + agent_type.)
 */
const TurnAvatar: React.FC<{ icon?: string; agentType: string; name: string }> = ({ icon, agentType, name }) => {
  const direct =
    icon && (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(icon) || /\.(svg|png|jpe?g|gif|webp)$/i.test(icon))
      ? (resolveBackendAssetUrl(icon) ?? icon)
      : undefined;
  const isEmoji = Boolean(icon && !direct);
  const logo = getAgentLogo(agentType);
  const imgCls = 'w-22px h-22px rounded-6px object-contain shrink-0';
  const boxCls =
    'w-22px h-22px rounded-6px flex items-center justify-center text-12px leading-none bg-[var(--bg-2)] text-[color:var(--text-secondary)] shrink-0';
  if (direct) return <img src={direct} alt='' className={imgCls} />;
  if (isEmoji) return <span className={`${boxCls} text-13px`}>{icon}</span>;
  if (logo) return <img src={logo} alt='' className={imgCls} />;
  return <span className={boxCls}>{name.charAt(0).toUpperCase()}</span>;
};

/**
 * Legacy 并行立场 presentation: historical parallel turns still render as a dense
 * grid of LIVE-streaming cards (each glowing while speaking), so the
 * boss can scan the expert field while the leader later summarizes the useful parts.
 * old first round remains readable; current meetings render sequential full cards.
 */
const ParallelTurnWall: React.FC<{ turns: MeetingTurn[] }> = ({ turns }) => {
  const { t } = useTranslation();
  const speaking = turns.filter((tn) => tn.status === 'speaking').length;
  return (
    <div className='flex flex-col gap-10px'>
      <div className='flex items-center gap-7px text-12px font-medium text-[color:var(--primary)]'>
        <span
          className={`w-7px h-7px rd-full bg-[var(--primary)] ${speaking > 0 ? 'animate-pulse' : ''}`}
          aria-hidden='true'
        />
        <span>
          {turns.length} {t('team.meeting.parallelWall', { defaultValue: '位 AI 专家同时发言中，群策群力' })}
        </span>
      </div>
      <div className='grid grid-cols-1 xl:grid-cols-2 gap-12px'>
        {turns.map((turn) => {
          const isSpeaking = turn.status === 'speaking';
          return (
            <div
              key={turn.id}
              data-testid={`meeting-turn-${turn.participantId}`}
              className={`flex flex-col rd-14px border border-solid overflow-hidden transition-shadow bg-[var(--bg-1)] ${
                isSpeaking || turn.isModerator
                  ? 'border-[color:var(--color-primary-light-3)]'
                  : 'border-[color:var(--border-light)]'
              }`}
              style={
                isSpeaking || turn.isModerator
                  ? {
                      boxShadow: '0 0 0 2px var(--color-primary-light-2), 0 6px 24px -6px var(--color-primary-light-3)',
                    }
                  : undefined
              }
            >
              <div className='flex items-center gap-8px px-12px h-40px shrink-0 border-b border-solid border-[color:var(--border-light)]'>
                <TurnAvatar icon={turn.icon} agentType={turn.agent_type} name={turn.name} />
                <span className='text-13px font-semibold text-[color:var(--text-primary)] truncate flex-1'>
                  {turn.name}
                </span>
                {turn.isModerator && (
                  <span className='shrink-0 px-7px h-18px flex items-center rd-full text-11px leading-none bg-[var(--color-primary-light-1)] text-[color:var(--primary)] font-medium'>
                    {t(IS_DECISION ? 'decision.createLeaderBadge' : 'team.meeting.role.moderator', {
                      defaultValue: '主持人',
                    })}
                  </span>
                )}
                {isSpeaking ? (
                  <Spin loading size={12} className='shrink-0' />
                ) : turn.status === 'error' ? (
                  <span className='shrink-0 text-11px text-[color:var(--danger)]'>
                    {t('team.meeting.turn.failed', { defaultValue: '未发言' })}
                  </span>
                ) : null}
              </div>
              <div className='px-14px py-11px text-13px leading-[1.7] overflow-y-auto max-h-340px min-h-150px [scrollbar-width:thin]'>
                {turn.text.trim() ? (
                  <MarkdownView>{stripResolutionMarkers(turn.text)}</MarkdownView>
                ) : (
                  <span className='text-[color:var(--bg-6)]'>
                    {t('team.meeting.thinking', { defaultValue: '思考中…' })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Meeting room: the boss throws a topic; CentaurAI orchestrates a moderated debate
 * among ALL experts — team-capable (claude/codex/aionrs) AND openclaw/hermes — each
 * driven as a single-turn ACP conversation. We render the live transcript + who's
 * speaking, and surface the moderator's final options for the boss to pick.
 */
const MeetingRoomView: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const orchestrator = useMeetingOrchestrator(team);
  const { state, guests } = orchestrator;
  // Show ALL selected team members in the roster immediately — even before their
  // conversation provisions (rendered as 连接中) — so a freshly created team never
  // looks like the selection was lost. canStart / who actually speaks still use the
  // orchestrator's conversation-gated lists (so a meeting only runs warmed agents).
  const rosterModerator = useMemo(() => team.agents.find((a) => a.role === 'leader') ?? null, [team.agents]);
  const rosterPanelists = useMemo(() => team.agents.filter((a) => a.role === 'teammate'), [team.agents]);
  const transcript = state.transcript;
  const [topicDraft, setTopicDraft] = useState('');

  // The 会议产出 list lives in the workspace sider (TeamPage). Clicking an entry
  // there emits this event; the room reopens that record's 方案书 here.
  const orchestratorRef = useRef(orchestrator);
  orchestratorRef.current = orchestrator;
  useEffect(() => {
    const handler = (payload: { teamId: string; recordId: string }) => {
      if (payload.teamId !== team.id) return;
      const rec = orchestratorRef.current.history.find((r) => r.id === payload.recordId);
      if (rec) orchestratorRef.current.openRecord(rec);
    };
    emitter.on('meeting.open.record', handler);
    return () => {
      emitter.off('meeting.open.record', handler);
    };
  }, [team.id]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastCountRef = useRef(0);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Re-stick to bottom as the transcript grows (and as the active turn streams).
  const streamLen = transcript.reduce((n, tn) => n + tn.text.length, 0);
  useEffect(() => {
    if (transcript.length === lastCountRef.current && stickToBottomRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      return;
    }
    lastCountRef.current = transcript.length;
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [transcript.length, streamLen]);

  // Distinct phaseLabels seen so far — drives the stage tracker's progress.
  const reachedLabels = useMemo(() => [...new Set(transcript.map((tn) => tn.phaseLabel))], [transcript]);

  // Group contiguous step-① parallel turns so they render side-by-side as columns
  // (every model answering the topic at once); other turns stay full-width.
  const turnGroups = useMemo(() => {
    const groups: MeetingTurn[][] = [];
    for (const turn of transcript) {
      const last = groups[groups.length - 1];
      if (turn.parallel && last && last[0].parallel) last.push(turn);
      else groups.push([turn]);
    }
    return groups;
  }, [transcript]);

  const renderTurnCard = (turn: MeetingTurn) =>
    turn.text.trim() || turn.status === 'speaking' ? (
      <div
        key={turn.id}
        data-testid={`meeting-turn-${turn.participantId}`}
        className={`rd-16px border border-solid overflow-hidden transition-colors ${
          turn.isModerator
            ? 'border-[color:var(--color-primary-light-3)] bg-[color:var(--color-primary-light-1)]'
            : 'border-[color:var(--border-light)] bg-[var(--bg-1)]'
        }`}
      >
        <div className='flex items-center gap-8px px-16px h-44px'>
          <TurnAvatar icon={turn.icon} agentType={turn.agent_type} name={turn.name} />
          <span className='text-14px font-semibold text-[color:var(--text-primary)] truncate max-w-220px'>
            {turn.name}
          </span>
          <span className='shrink-0 px-7px h-18px flex items-center rd-full text-11px leading-none bg-[var(--bg-2)] text-[color:var(--bg-6)]'>
            {turn.isModerator ? t('team.meeting.role.moderator', { defaultValue: '主持人' }) : turn.phaseLabel}
          </span>
          <div className='flex-1' />
          {turn.status === 'speaking' && <Spin loading size={13} className='shrink-0' />}
          {turn.status === 'error' && (
            <span className='shrink-0 text-11px text-[color:var(--danger)]'>
              {t('team.meeting.turn.failed', { defaultValue: '未发言' })}
            </span>
          )}
        </div>
        {turn.text.trim() && (
          <div className='px-18px pb-14px pt-2px text-14px leading-[1.75]'>
            <MarkdownView>{stripResolutionMarkers(turn.text)}</MarkdownView>
          </div>
        )}
      </div>
    ) : null;

  const isIdle = state.phase === 'idle';
  const isDecisionFocus = IS_DECISION && !isIdle;
  const atResolution = state.phase === 'resolution' || state.phase === 'decided';
  const showPlan = atResolution && state.plan.trim().length > 0;
  const showResolution = state.options.length > 0 && atResolution;
  const statusKey = state.awaitingContinue && state.phase === 'running' ? 'awaiting' : state.phase;
  const decisionStatus = t(`decision.room.status.${statusKey}`, {
    defaultValue:
      statusKey === 'idle'
        ? '待发起'
        : statusKey === 'running'
          ? '交锋中'
          : statusKey === 'awaiting'
            ? '等待你的方向'
            : statusKey === 'resolution'
              ? '待拍板'
              : '已拍板',
  });
  const advisorCount = (rosterModerator ? 1 : 0) + rosterPanelists.length + guests.length;

  const renderDecisionAuthorityCards = (compact = false) => {
    const items = [
      {
        key: 'boss',
        icon: <Crown theme='outline' size={compact ? '15' : '17'} fill='currentColor' />,
        iconClass: 'bg-[var(--color-primary-light-1)] text-[color:var(--primary)]',
        title: t('decision.authority.bossSeat', { defaultValue: '主位' }),
        desc: t('decision.authority.bossHint', { defaultValue: '最终决定权在你手上' }),
      },
      {
        key: 'dispute',
        icon: <Scale theme='outline' size={compact ? '15' : '17'} fill='currentColor' />,
        iconClass: 'bg-[var(--centaur-gold-tint)] text-[color:var(--accent-gold-deep)]',
        title: t('decision.authority.disputeTitle', { defaultValue: '交锋进度' }),
        desc: t('decision.authority.disputeDesc', {
          count: state.turnsCompleted,
          defaultValue: `已完成 ${state.turnsCompleted} 段顾问发言`,
        }),
      },
      {
        key: 'verdict',
        icon: <Checklist theme='outline' size={compact ? '15' : '17'} fill='currentColor' />,
        iconClass: 'bg-[var(--accent-green-tint)] text-[color:var(--success)]',
        title: t('decision.authority.verdictTitle', { defaultValue: '决策台' }),
        desc: t('decision.authority.verdictDesc', {
          count: state.options.length,
          defaultValue:
            state.options.length > 0 ? `${state.options.length} 个候选方案待拍板` : '等待主持人形成候选方案',
        }),
      },
    ];

    return (
      <div className={`grid grid-cols-1 ${compact ? 'gap-8px lg:grid-cols-3' : 'lg:grid-cols-3 gap-10px'}`}>
        {items.map((item) => (
          <div
            key={item.key}
            className={`flex items-center gap-10px rd-12px border border-solid border-[color:var(--border-light)] bg-[var(--bg-1)] ${
              compact ? 'px-10px py-8px' : 'px-14px py-10px'
            }`}
          >
            <span
              className={`${compact ? 'w-28px h-28px rd-9px' : 'w-32px h-32px rd-10px'} flex items-center justify-center ${item.iconClass} shrink-0`}
            >
              {item.icon}
            </span>
            <div className='min-w-0'>
              <div className='text-12px text-[color:var(--bg-6)]'>{item.title}</div>
              <div
                className={`${compact ? 'text-13px' : 'text-14px'} font-semibold text-[color:var(--text-primary)] truncate`}
              >
                {item.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const decisionDetails = (
    <div className='w-620px max-w-[calc(100vw-96px)] flex flex-col gap-12px py-2px'>
      <div className='flex items-center gap-8px'>
        <span className='w-26px h-26px rd-8px flex items-center justify-center bg-[var(--color-primary-light-1)] text-[color:var(--primary)] shrink-0'>
          <Checklist theme='outline' size='15' fill='currentColor' />
        </span>
        <div className='min-w-0'>
          <div className='text-14px font-semibold text-[color:var(--text-primary)]'>
            {t('decision.room.detailsTitle', { defaultValue: '会议详情' })}
          </div>
          <div className='text-12px text-[color:var(--bg-6)] truncate'>
            {t('decision.advisors.count', { count: advisorCount, defaultValue: `${advisorCount} 位待命` })}
          </div>
        </div>
      </div>
      {state.topic && (
        <div className='rd-12px border border-solid border-[color:var(--border-light)] bg-[var(--bg-1)] px-12px py-10px'>
          <div className='text-11px font-semibold text-[color:var(--primary)] mb-4px'>
            {t('decision.room.topicLabel', { defaultValue: '决策议题：' })}
          </div>
          <div className='text-13px leading-relaxed text-[color:var(--text-primary)]'>{state.topic}</div>
        </div>
      )}
      <div className='overflow-hidden rd-12px border border-solid border-[color:var(--border-light)] bg-[var(--bg-1)]'>
        <MeetingRoster
          moderator={rosterModerator}
          panelists={rosterPanelists}
          activeSlotId={state.activeSlotId}
          guests={guests}
          compact
        />
      </div>
      <div className='overflow-hidden rd-12px border border-solid border-[color:var(--border-light)] bg-[var(--bg-1)]'>
        <MeetingPhaseBar
          phase={state.phase}
          form={state.form}
          reachedLabels={reachedLabels}
          turnsCompleted={state.turnsCompleted}
        />
      </div>
      {renderDecisionAuthorityCards(true)}
    </div>
  );

  return (
    <div className='centaur-brand flex flex-col h-full bg-[var(--bg-base)]'>
      {isDecisionFocus ? (
        <div className='shrink-0 flex items-center gap-10px px-18px h-48px border-b border-solid border-[color:var(--border-light)] bg-[var(--bg-base)]'>
          <span className='centaur-mark w-26px h-26px shrink-0' aria-hidden='true'>
            <Crown theme='outline' size='14' fill='var(--primary)' />
          </span>
          <span className='shrink-0 px-9px h-24px inline-flex items-center rd-full text-12px font-medium bg-[var(--color-primary-light-1)] text-[color:var(--centaur-clay-deep)]'>
            {decisionStatus}
          </span>
          <div className='min-w-0 flex-1 flex items-center gap-7px'>
            <span className='shrink-0 text-12px font-semibold text-[color:var(--primary)]'>
              {t('decision.room.topicLabel', { defaultValue: '决策议题：' })}
            </span>
            <span className='truncate text-14px font-semibold text-[color:var(--text-primary)]' title={state.topic}>
              {state.topic}
            </span>
          </div>
          {state.turnsCompleted > 0 && (
            <span className='hidden xl:inline-flex shrink-0 text-11px text-[color:var(--bg-6)]'>
              {t('decision.room.turns', {
                count: state.turnsCompleted,
                defaultValue: `已完成 ${state.turnsCompleted} 段顾问发言`,
              })}
            </span>
          )}
          <Popover trigger='click' position='br' content={decisionDetails}>
            <Button
              size='small'
              shape='round'
              icon={<Checklist theme='outline' size='13' fill='currentColor' />}
              data-testid='meeting-details-btn'
            >
              {t('decision.room.details', { defaultValue: '顾问席' })}
            </Button>
          </Popover>
          <Popover
            trigger='click'
            position='br'
            content={
              <MeetingGuestPanel
                guests={guests}
                onAdd={orchestrator.addGuest}
                onRemove={orchestrator.removeGuest}
                variant='compact'
              />
            }
          >
            <Button
              size='small'
              shape='round'
              icon={<PeoplePlus theme='outline' size='13' fill='currentColor' />}
              data-testid='meeting-guest-btn'
              title={t('decision.room.addAdvisor', { defaultValue: '加顾问' })}
            >
              {t('decision.room.addAdvisor', { defaultValue: '加顾问' })}
              {guests.length > 0 ? `（${guests.length}）` : ''}
            </Button>
          </Popover>
          <Button
            size='small'
            shape='round'
            type='outline'
            icon={<Plus theme='outline' size='13' fill='currentColor' />}
            onClick={orchestrator.reset}
            data-testid='meeting-new-btn'
          >
            {t('decision.room.newDecision', { defaultValue: '新决策' })}
          </Button>
        </div>
      ) : (
        <div className='shrink-0 flex items-center gap-10px px-20px h-52px border-b border-solid border-[color:var(--border-light)]'>
          <span className='centaur-mark w-26px h-26px shrink-0' aria-hidden='true'>
            <VideoConference theme='outline' size='14' fill='var(--primary)' />
          </span>
          <div className='flex flex-col min-w-0'>
            <span className='centaur-title centaur-title-sm leading-tight'>
              {t(IS_DECISION ? 'decision.roomTitle' : 'team.meeting.boardTitle', { defaultValue: '智囊团' })}
            </span>
            <span className='text-11px text-[color:var(--bg-6)] leading-tight'>
              {t(IS_DECISION ? 'decision.roomSubtitle' : 'team.meeting.boardSubtitle', {
                defaultValue: 'AI 圆桌会议',
              })}
            </span>
          </div>
          {IS_DECISION && (
            <span className='shrink-0 ml-4px px-9px h-24px inline-flex items-center rd-full text-12px font-medium bg-[var(--color-primary-light-1)] text-[color:var(--centaur-clay-deep)]'>
              {decisionStatus}
            </span>
          )}
          <div className='flex-1' />
          <Popover
            trigger='click'
            position='br'
            content={
              <MeetingGuestPanel
                guests={guests}
                onAdd={orchestrator.addGuest}
                onRemove={orchestrator.removeGuest}
                variant='compact'
              />
            }
          >
            <Button
              size='small'
              shape='round'
              icon={<PeoplePlus theme='outline' size='13' fill='currentColor' />}
              data-testid='meeting-guest-btn'
            >
              {t(IS_DECISION ? 'decision.room.addAdvisor' : 'team.meeting.extraExpertLabel', {
                defaultValue: '加专家',
              })}
              {guests.length > 0 ? `（${guests.length}）` : ''}
            </Button>
          </Popover>
          <Button
            size='small'
            shape='round'
            type='outline'
            icon={<Plus theme='outline' size='13' fill='currentColor' />}
            onClick={orchestrator.reset}
            data-testid='meeting-new-btn'
          >
            {t(IS_DECISION ? 'decision.room.newDecision' : 'team.meeting.newShort', { defaultValue: '新会议' })}
          </Button>
        </div>
      )}
      {!isDecisionFocus && (
        <MeetingRoster
          moderator={rosterModerator}
          panelists={rosterPanelists}
          activeSlotId={state.activeSlotId}
          guests={guests}
          compact={!isIdle}
        />
      )}

      {IS_DECISION && !isDecisionFocus && (
        <div
          className='shrink-0 px-20px py-12px border-b border-solid border-[color:var(--border-light)]'
          style={{ background: 'color-mix(in srgb, var(--bg-1) 72%, transparent)' }}
        >
          {renderDecisionAuthorityCards()}
        </div>
      )}

      {!isDecisionFocus && !isIdle && state.topic && (
        <div className='shrink-0 px-24px py-10px border-b border-solid border-[color:var(--border-light)]'>
          <div className='flex items-baseline gap-6px'>
            <span className='shrink-0 text-12px font-semibold text-[color:var(--primary)]'>
              {t(IS_DECISION ? 'decision.room.topicLabel' : 'team.meeting.topicLabel', { defaultValue: '议题：' })}
            </span>
            <span className='text-14px text-[color:var(--text-primary)] leading-relaxed'>{state.topic}</span>
          </div>
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className='flex-1 min-h-0 overflow-y-auto'>
        {isIdle && transcript.length === 0 ? (
          <div className='flex flex-col items-center justify-center min-h-full text-[color:var(--bg-6)] gap-16px px-24px py-32px text-center'>
            <span className='centaur-mark w-64px h-64px' aria-hidden='true'>
              <VideoConference theme='outline' size='30' fill='var(--primary)' />
            </span>
            <span className='centaur-title centaur-title-lg'>
              {t(IS_DECISION ? 'decision.emptyTitle' : 'team.meeting.emptyTitle', {
                defaultValue: '智囊团 · 召集 AI 专家开会',
              })}
            </span>
            <span className='text-14px leading-relaxed max-w-420px text-[color:var(--text-secondary)]'>
              {t(IS_DECISION ? 'decision.emptyHint' : 'team.meeting.emptyHint', {
                defaultValue:
                  '让不同模型的 AI 专家围绕你的议题结构化研讨、互相博弈，最后合成一份比单个 AI 更高质量的《方案书》。',
              })}
            </span>
            <div className='flex items-center gap-10px text-12px text-[color:var(--bg-6)] mt-2px'>
              <span className='centaur-chip px-10px py-3px'>
                {t(IS_DECISION ? 'decision.room.stepIssue' : 'team.meeting.step1', {
                  defaultValue: '① 在下方输入主题',
                })}
              </span>
              <span className='text-[color:var(--bg-5)]'>›</span>
              <span className='centaur-chip px-10px py-3px'>
                {t(IS_DECISION ? 'decision.room.stepDebate' : 'team.meeting.step3', {
                  defaultValue: '② 开始讨论',
                })}
              </span>
            </div>
            <div className='w-full max-w-520px mt-8px'>
              <MeetingGuestPanel guests={guests} onAdd={orchestrator.addGuest} onRemove={orchestrator.removeGuest} />
            </div>
          </div>
        ) : (
          <div
            className={
              isDecisionFocus ? 'flex flex-col gap-12px py-14px px-18px' : 'flex flex-col gap-16px py-20px px-24px'
            }
          >
            {turnGroups.map((group, gi) =>
              group[0].parallel ? <ParallelTurnWall key={`pg-${gi}`} turns={group} /> : renderTurnCard(group[0])
            )}
            {showPlan && (
              <div data-testid='meeting-plan' className='centaur-surface my-8px overflow-hidden'>
                <div className='centaur-rail h-3px w-full' aria-hidden='true' />
                <div className='flex items-center gap-8px px-20px h-52px border-b border-solid border-[color:var(--border-light)]'>
                  <Notes theme='outline' size='18' fill='var(--primary)' />
                  <span className='centaur-title centaur-title-md'>
                    {t(IS_DECISION ? 'decision.room.planTitle' : 'team.meeting.planTitle', {
                      defaultValue: '本场方案书',
                    })}
                  </span>
                  <div className='ml-auto flex items-center gap-8px'>
                    <Button
                      size='small'
                      shape='round'
                      icon={<Copy theme='outline' size='13' fill='currentColor' />}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(state.plan);
                          Message.success(t('team.meeting.export.copied', { defaultValue: '已复制方案书' }));
                        } catch {
                          Message.error(t('team.meeting.export.copyFailed', { defaultValue: '复制失败' }));
                        }
                      }}
                      data-testid='meeting-plan-copy'
                    >
                      {t('team.meeting.export.copy', { defaultValue: '复制' })}
                    </Button>
                    <Button
                      size='small'
                      shape='round'
                      type='primary'
                      icon={<Download theme='outline' size='13' fill='currentColor' />}
                      onClick={() => {
                        if (orchestrator.exportPlan())
                          Message.success(
                            t('team.meeting.export.archiving', {
                              defaultValue: '已请主持人导出 Word/Markdown 并归档到内容中心，稍后可在内容中心查看',
                            })
                          );
                      }}
                      data-testid='meeting-plan-export'
                    >
                      {t('team.meeting.export.archive', { defaultValue: '导出归档' })}
                    </Button>
                  </div>
                </div>
                {state.archivedPath && (
                  <div className='flex items-center gap-6px px-20px py-8px text-12px text-[color:var(--bg-6)] bg-[color:var(--accent-green-tint)] border-b border-solid border-[color:var(--border-light)]'>
                    <Notes theme='outline' size='13' fill='var(--success)' />
                    <span className='truncate'>
                      {t('team.meeting.export.archivedToWorkspace', {
                        defaultValue: '已存入临时空间，并同步到内容中心',
                      })}
                    </span>
                    <Button
                      size='mini'
                      type='text'
                      className='ml-auto shrink-0'
                      onClick={() => navigate('/files')}
                      data-testid='meeting-open-hub'
                    >
                      {t('team.meeting.export.openHub', { defaultValue: '在内容中心查看' })}
                    </Button>
                  </div>
                )}
                <div className='px-22px py-18px text-14px leading-[1.75]'>
                  <MarkdownView>{state.plan}</MarkdownView>
                </div>
              </div>
            )}
            {showResolution && (
              <MeetingResolutionCard
                options={state.options}
                decidedOptionId={state.decidedOptionId}
                onDecide={orchestrator.decide}
              />
            )}
            {/* Between-round CTA lives INSIDE the conversation, right under the
                moderator's recap, so the boss continues from where they're reading. */}
            {state.awaitingContinue && state.phase === 'running' && (
              <div className='flex justify-center py-6px'>
                <Button
                  type='primary'
                  shape='round'
                  size='large'
                  icon={<RightOne theme='filled' size='15' fill='currentColor' />}
                  onClick={orchestrator.continueMeeting}
                  data-testid='meeting-continue'
                >
                  {t(IS_DECISION ? 'decision.room.continue' : 'team.meeting.continue', {
                    defaultValue: '继续讨论 →',
                  })}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {!isIdle && !isDecisionFocus && (
        <MeetingPhaseBar
          phase={state.phase}
          form={state.form}
          reachedLabels={reachedLabels}
          turnsCompleted={state.turnsCompleted}
        />
      )}
      <MeetingControlBar orchestrator={orchestrator} topic={topicDraft} onTopicChange={setTopicDraft} />
    </div>
  );
};

export default MeetingRoomView;
