import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Message, Popover, Spin } from '@arco-design/web-react';
import { Copy, Download, Notes, PeoplePlus, Plus, VideoConference } from '@icon-park/react';
import type { TTeam } from '@/common/types/team/teamTypes';
import MarkdownView from '@/renderer/components/Markdown';
import { emitter } from '@/renderer/utils/emitter';
import MeetingRoster from './MeetingRoster';
import MeetingPhaseBar from './MeetingPhaseBar';
import MeetingControlBar from './MeetingControlBar';
import MeetingResolutionCard from './MeetingResolutionCard';
import MeetingGuestPanel from './MeetingGuestPanel';
import { stripResolutionMarkers } from './meetingPrompts';
import { useMeetingOrchestrator } from './useMeetingOrchestrator';

type Props = {
  team: TTeam;
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

  const isIdle = state.phase === 'idle';
  const atResolution = state.phase === 'resolution' || state.phase === 'decided';
  const showPlan = atResolution && state.plan.trim().length > 0;
  const showResolution = state.options.length > 0 && atResolution;

  return (
    <div className='flex flex-col h-full bg-[var(--color-bg-1)]'>
      <div className='shrink-0 flex items-center gap-8px px-16px h-40px border-b border-solid border-[color:var(--border-base)] bg-[var(--color-bg-2)]'>
        <span className='text-13px font-semibold text-[color:var(--color-text-1)]'>
          {t('team.meeting.boardTitle', { defaultValue: '智囊团' })}
        </span>
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
            size='mini'
            icon={<PeoplePlus theme='outline' size='13' fill='currentColor' />}
            data-testid='meeting-guest-btn'
          >
            {t('team.meeting.extraExpertLabel', { defaultValue: '加专家' })}
            {guests.length > 0 ? `（${guests.length}）` : ''}
          </Button>
        </Popover>
        <Button
          size='mini'
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
      {!isIdle && <MeetingPhaseBar phase={state.phase} turnsCompleted={state.turnsCompleted} />}

      {!isIdle && state.topic && (
        <div className='shrink-0 px-16px py-8px text-13px text-[color:var(--color-text-2)] bg-[color:var(--color-fill-1)] border-b border-solid border-[color:var(--border-base)]'>
          <span className='text-[color:var(--color-text-3)] mr-4px'>
            {t('team.meeting.topicLabel', { defaultValue: '议题：' })}
          </span>
          {state.topic}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className='flex-1 min-h-0 overflow-y-auto'>
        {isIdle && transcript.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-[color:var(--color-text-3)] gap-12px px-24px text-center'>
            <VideoConference theme='outline' size='40' fill='currentColor' />
            <span className='text-14px text-[color:var(--color-text-2)]'>
              {t('team.meeting.emptyTitle', { defaultValue: '智囊团 · 召集 AI 专家开会' })}
            </span>
            <span className='text-12px max-w-380px'>
              {t('team.meeting.emptyHint', {
                defaultValue:
                  '让不同模型的 AI 专家围绕你的议题结构化研讨、互相博弈，最后合成一份比单个 AI 更高质量的《方案书》。',
              })}
            </span>
            <div className='flex items-center gap-8px text-12px text-[color:var(--color-text-3)] mt-2px'>
              <span>{t('team.meeting.step1', { defaultValue: '① 在下方输入主题' })}</span>
              <span className='text-[color:var(--color-text-4)]'>›</span>
              <span>{t('team.meeting.step3', { defaultValue: '② 开始讨论' })}</span>
            </div>
            <MeetingGuestPanel guests={guests} onAdd={orchestrator.addGuest} onRemove={orchestrator.removeGuest} />
          </div>
        ) : (
          <div className='flex flex-col gap-8px py-16px px-16px'>
            {transcript.map((turn) =>
              turn.text.trim() || turn.status === 'speaking' ? (
                <div
                  key={turn.id}
                  data-testid={`meeting-turn-${turn.participantId}`}
                  className={`mx-4px my-4px rd-12px border border-solid overflow-hidden ${
                    turn.isModerator
                      ? 'border-[color:var(--color-primary-6)] bg-[color:var(--color-primary-light-1)]'
                      : 'border-[color:var(--border-base)] bg-[var(--color-bg-2)]'
                  }`}
                >
                  <div className='flex items-center gap-6px px-12px h-32px border-b border-solid border-[color:var(--border-base)]'>
                    <span className='shrink-0 px-6px h-16px flex items-center rd-8px text-10px leading-none bg-[var(--fill-2)] text-[color:var(--color-text-3)]'>
                      {turn.isModerator
                        ? t('team.meeting.role.moderator', { defaultValue: '主持人' })
                        : turn.phaseLabel}
                    </span>
                    <span className='text-13px font-medium text-[color:var(--color-text-1)] truncate'>{turn.name}</span>
                    {turn.status === 'speaking' && <Spin loading size={12} className='ml-auto' />}
                    {turn.status === 'error' && (
                      <span className='ml-auto text-11px text-[color:var(--color-danger-6)]'>
                        {t('team.meeting.turn.failed', { defaultValue: '未发言' })}
                      </span>
                    )}
                  </div>
                  {turn.text.trim() && (
                    <div className='px-14px py-10px text-13px leading-relaxed'>
                      <MarkdownView>{stripResolutionMarkers(turn.text)}</MarkdownView>
                    </div>
                  )}
                </div>
              ) : null
            )}
            {showPlan && (
              <div
                data-testid='meeting-plan'
                className='mx-4px my-8px rd-14px border border-solid border-[color:var(--color-primary-6)] bg-[var(--color-bg-2)] overflow-hidden'
              >
                <div className='flex items-center gap-6px px-16px h-44px border-b border-solid border-[color:var(--border-base)] bg-[color:var(--color-primary-light-1)]'>
                  <Notes theme='outline' size='18' fill='var(--color-primary-6)' />
                  <span className='text-15px font-semibold text-[color:var(--color-text-1)]'>
                    {t('team.meeting.planTitle', { defaultValue: '本场方案书' })}
                  </span>
                  <div className='ml-auto flex items-center gap-6px'>
                    <Button
                      size='mini'
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
                      size='mini'
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
                  <div className='flex items-center gap-6px px-16px py-6px text-12px text-[color:var(--color-text-3)] bg-[color:var(--color-fill-1)] border-b border-solid border-[color:var(--border-base)]'>
                    <Notes theme='outline' size='13' fill='currentColor' />
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
                <div className='px-18px py-14px text-14px leading-relaxed'>
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
          </div>
        )}
      </div>

      <MeetingControlBar orchestrator={orchestrator} topic={topicDraft} onTopicChange={setTopicDraft} />
    </div>
  );
};

export default MeetingRoomView;
