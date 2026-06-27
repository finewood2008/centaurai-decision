import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Message, Popover, Spin } from '@arco-design/web-react';
import { Copy, Download, Notes, PeoplePlus, Plus, RightOne, VideoConference } from '@icon-park/react';
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
 * Meeting room: the boss throws a topic; CentaurAI orchestrates a moderated debate
 * among ALL experts — team-capable (claude/codex/aionrs) AND openclaw/hermes — each
 * driven as a single-turn ACP conversation. We render the live transcript + who's
 * speaking, and surface the moderator's final options for the boss to pick.
 */
const MeetingRoomView: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const orchestrator = useMeetingOrchestrator(team);
  const { state, moderator, panelists, guests } = orchestrator;
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

  const isIdle = state.phase === 'idle';
  const atResolution = state.phase === 'resolution' || state.phase === 'decided';
  const showPlan = atResolution && state.plan.trim().length > 0;
  const showResolution = state.options.length > 0 && atResolution;

  return (
    <div className='centaur-brand flex flex-col h-full bg-[var(--bg-base)]'>
      <div className='shrink-0 flex items-center gap-10px px-20px h-52px border-b border-solid border-[color:var(--border-light)]'>
        <span className='centaur-mark w-26px h-26px shrink-0' aria-hidden='true'>
          <VideoConference theme='outline' size='14' fill='var(--primary)' />
        </span>
        <div className='flex flex-col min-w-0'>
          <span className='centaur-title centaur-title-sm leading-tight'>
            {t(IS_DECISION ? 'decision.roomTitle' : 'team.meeting.boardTitle', { defaultValue: '智囊团' })}
          </span>
          <span className='text-11px text-[color:var(--bg-6)] leading-tight'>
            {t(IS_DECISION ? 'decision.roomSubtitle' : 'team.meeting.boardSubtitle', { defaultValue: 'AI 圆桌会议' })}
          </span>
        </div>
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
            {t('team.meeting.extraExpertLabel', { defaultValue: '加专家' })}
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
          {t('team.meeting.newShort', { defaultValue: '新会议' })}
        </Button>
      </div>
      <MeetingRoster
        moderator={moderator}
        panelists={panelists}
        activeSlotId={state.activeSlotId}
        guests={guests}
        compact={!isIdle}
      />

      {!isIdle && state.topic && (
        <div className='shrink-0 px-24px py-10px border-b border-solid border-[color:var(--border-light)]'>
          <div className='flex items-baseline gap-6px'>
            <span className='shrink-0 text-12px font-semibold text-[color:var(--primary)]'>
              {t('team.meeting.topicLabel', { defaultValue: '议题：' })}
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
              {t(IS_DECISION ? 'decision.emptyTitle' : 'team.meeting.emptyTitle', { defaultValue: '智囊团 · 召集 AI 专家开会' })}
            </span>
            <span className='text-14px leading-relaxed max-w-420px text-[color:var(--text-secondary)]'>
              {t('team.meeting.emptyHint', {
                defaultValue:
                  '让不同模型的 AI 专家围绕你的议题结构化研讨、互相博弈，最后合成一份比单个 AI 更高质量的《方案书》。',
              })}
            </span>
            <div className='flex items-center gap-10px text-12px text-[color:var(--bg-6)] mt-2px'>
              <span className='centaur-chip px-10px py-3px'>
                {t('team.meeting.step1', { defaultValue: '① 在下方输入主题' })}
              </span>
              <span className='text-[color:var(--bg-5)]'>›</span>
              <span className='centaur-chip px-10px py-3px'>
                {t('team.meeting.step3', { defaultValue: '② 开始讨论' })}
              </span>
            </div>
            <div className='w-full max-w-520px mt-8px'>
              <MeetingGuestPanel guests={guests} onAdd={orchestrator.addGuest} onRemove={orchestrator.removeGuest} />
            </div>
          </div>
        ) : (
          <div className='flex flex-col gap-16px py-20px px-24px'>
            {transcript.map((turn) =>
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
                      {turn.isModerator
                        ? t('team.meeting.role.moderator', { defaultValue: '主持人' })
                        : turn.phaseLabel}
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
              ) : null
            )}
            {showPlan && (
              <div data-testid='meeting-plan' className='centaur-surface my-8px overflow-hidden'>
                <div className='centaur-rail h-3px w-full' aria-hidden='true' />
                <div className='flex items-center gap-8px px-20px h-52px border-b border-solid border-[color:var(--border-light)]'>
                  <Notes theme='outline' size='18' fill='var(--primary)' />
                  <span className='centaur-title centaur-title-md'>
                    {t('team.meeting.planTitle', { defaultValue: '本场方案书' })}
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
                              defaultValue: '已请主持人导出 Word/PPT 并归档到内容中心，稍后可在内容中心查看',
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
                  {t('team.meeting.continue', { defaultValue: '继续讨论 →' })}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {!isIdle && (
        <MeetingPhaseBar
          phase={state.phase}
          form={state.form}
          departmentId={state.departmentId}
          reachedLabels={reachedLabels}
          turnsCompleted={state.turnsCompleted}
        />
      )}
      <MeetingControlBar orchestrator={orchestrator} topic={topicDraft} onTopicChange={setTopicDraft} />
    </div>
  );
};

export default MeetingRoomView;
