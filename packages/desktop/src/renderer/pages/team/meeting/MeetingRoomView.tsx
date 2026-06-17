import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin } from '@arco-design/web-react';
import { VideoConference } from '@icon-park/react';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { IMessageText } from '@/common/chat/chatLib';
import MessageText from '@/renderer/pages/conversation/Messages/components/MessageText';
import { useTeamAggregatedMessages, type TeamMessage } from '../hooks/useTeamAggregatedMessages';
import MeetingRoster from './MeetingRoster';
import MeetingPhaseBar from './MeetingPhaseBar';
import MeetingControlBar from './MeetingControlBar';
import MeetingResolutionCard from './MeetingResolutionCard';
import MeetingExpertMatch from './MeetingExpertMatch';
import { stripResolutionMarkers } from './meetingPrompts';
import { useMeetingOrchestrator } from './useMeetingOrchestrator';

type Props = {
  team: TTeam;
};

const isRenderableTextMessage = (m: TeamMessage): m is TeamMessage & IMessageText => {
  if (m.type !== 'text') return false;
  const content = m.content?.content;
  return typeof content === 'string' && content.trim().length > 0;
};

/**
 * Meeting room: the boss throws a topic to the team; the backend team_run runs a
 * roundtable among the agents (leader = moderator). We render the live debate +
 * who's speaking, and surface the leader's final options for the boss to pick.
 */
const MeetingRoomView: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const orchestrator = useMeetingOrchestrator(team);
  const { state, moderator, panelists } = orchestrator;
  const { messages, isLoading } = useTeamAggregatedMessages(team);
  const [topicDraft, setTopicDraft] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastCountRef = useRef(0);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (messages.length === lastCountRef.current) return;
    lastCountRef.current = messages.length;
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length]);

  const textMessages = useMemo(() => messages.filter(isRenderableTextMessage), [messages]);
  const isIdle = state.phase === 'idle';
  const showResolution = state.options.length > 0 && (state.phase === 'resolution' || state.phase === 'decided');

  return (
    <div className='flex flex-col h-full bg-[var(--color-bg-1)]'>
      <MeetingRoster moderator={moderator} panelists={panelists} activeSlotId={state.activeSlotId} />
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
        {isLoading && messages.length === 0 ? (
          <div className='flex items-center justify-center h-full'>
            <Spin loading />
          </div>
        ) : isIdle && textMessages.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-[color:var(--color-text-3)] gap-12px px-24px text-center'>
            <VideoConference theme='outline' size='40' fill='currentColor' />
            <span className='text-14px text-[color:var(--color-text-2)]'>
              {t('team.meeting.emptyTitle', { defaultValue: '和一群 AI 开个会' })}
            </span>
            <span className='text-12px max-w-360px'>
              {t('team.meeting.emptyHint', {
                defaultValue: '抛出一个议题，主持人会带着各位专家从不同角度论证、交锋，最后给你几个方案来拍板。',
              })}
            </span>
            <MeetingExpertMatch
              team={team}
              topic={topicDraft}
              moderatorConversationId={moderator?.conversation_id ?? null}
            />
          </div>
        ) : (
          <div className='flex flex-col gap-8px py-16px px-16px'>
            {textMessages.map((msg) => {
              const raw = typeof msg.content?.content === 'string' ? msg.content.content : '';
              const stripped = stripResolutionMarkers(raw);
              if (!stripped.trim()) return null;
              const display = stripped === raw ? msg : { ...msg, content: { ...msg.content, content: stripped } };
              return (
                <div key={msg.id} className='w-full'>
                  <MessageText message={display} />
                </div>
              );
            })}
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
