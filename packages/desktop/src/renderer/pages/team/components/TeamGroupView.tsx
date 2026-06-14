import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin } from '@arco-design/web-react';
import { Comments } from '@icon-park/react';
import type { TTeam } from '@/common/types/team/teamTypes';
import type { IMessageText } from '@/common/chat/chatLib';
import MessageText from '@/renderer/pages/conversation/Messages/components/MessageText';
import { useTeamAggregatedMessages, type TeamMessage } from '../hooks/useTeamAggregatedMessages';
import TeamBroadcastSendBox from './TeamBroadcastSendBox';
import TeamAgentIdentity from './TeamAgentIdentity';

type Props = {
  team: TTeam;
};

/**
 * Compact placeholder for non-text message types (tool calls, permissions, etc).
 * Full detail stays in the per-agent column view (split mode).
 */
const NonTextPlaceholder: React.FC<{ message: TeamMessage }> = ({ message }) => {
  const { t } = useTranslation();
  const agent_name = message.team_agent_name ?? t('team.broadcast.unknownAgent', { defaultValue: 'Agent' });
  const label = (() => {
    switch (message.type) {
      case 'tool_call':
      case 'acp_tool_call':
        return t('team.group.usingTool', { name: agent_name, defaultValue: `${agent_name} is using a tool…` });
      case 'permission':
      case 'acp_permission':
        return t('team.group.awaitingPermission', {
          name: agent_name,
          defaultValue: `${agent_name} is awaiting permission`,
        });
      case 'thinking':
        return t('team.group.thinking', { name: agent_name, defaultValue: `${agent_name} is thinking…` });
      case 'agent_status':
        return null; // status events would create too much noise in the timeline
      case 'tips':
        return null;
      default:
        return t('team.group.workingType', {
          name: agent_name,
          type: message.type,
          defaultValue: `${agent_name}: ${message.type}`,
        });
    }
  })();
  if (!label) return null;
  return (
    <div className='flex items-center gap-6px px-12px py-4px text-12px text-[color:var(--color-text-3)] italic'>
      <Comments theme='outline' size='12' fill='currentColor' />
      <span>{label}</span>
    </div>
  );
};

const isRenderableTextMessage = (m: TeamMessage): m is TeamMessage & IMessageText => {
  if (m.type !== 'text') return false;
  const content = m.content?.content;
  return typeof content === 'string' && content.trim().length > 0;
};

/**
 * Group chat view: a single merged timeline showing every agent's reply with
 * sender avatar + name. Broadcast user messages dedupe to one bubble. Non-text
 * messages (tool calls, permissions, thinking) appear as italic activity
 * placeholders — full detail stays in the per-agent split view.
 */
const TeamGroupView: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const { messages, isLoading } = useTeamAggregatedMessages(team);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastMessageCountRef = useRef(0);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  };

  // Auto-scroll to bottom when new messages arrive, unless user scrolled away.
  useEffect(() => {
    if (messages.length === lastMessageCountRef.current) return;
    lastMessageCountRef.current = messages.length;
    if (!stickToBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length]);

  const rosterAgents = useMemo(() => team.agents.filter((a) => a.conversation_id), [team.agents]);

  return (
    <div className='flex flex-col h-full bg-[var(--color-bg-1)]'>
      <div
        data-testid='team-group-roster'
        className='shrink-0 flex items-center gap-12px px-16px h-36px border-b border-solid border-[color:var(--border-base)] overflow-x-auto [scrollbar-width:none]'
      >
        <span className='text-12px text-[color:var(--color-text-3)] shrink-0'>
          {t('team.group.participants', { defaultValue: 'Participants:' })}
        </span>
        {rosterAgents.map((agent) => (
          <div key={agent.slot_id} className='flex items-center gap-4px shrink-0'>
            <TeamAgentIdentity
              agent_name={agent.agent_name}
              agent_type={agent.agent_type}
              icon={agent.icon}
              conversation_id={agent.conversation_id}
              isLeader={agent.role === 'leader'}
              className='min-w-0 max-w-160px'
              logoClassName='w-14px h-14px object-contain rounded-2px'
              avatarClassName='w-14px h-14px rounded-2px flex items-center justify-center text-11px leading-none bg-fill-2 shrink-0'
              nameClassName='text-12px text-[color:var(--color-text-2)] whitespace-nowrap overflow-hidden text-ellipsis'
            />
          </div>
        ))}
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className='flex-1 min-h-0 overflow-y-auto'>
        {isLoading && messages.length === 0 ? (
          <div className='flex items-center justify-center h-full'>
            <Spin loading />
          </div>
        ) : messages.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-[color:var(--color-text-3)] gap-8px'>
            <Comments theme='outline' size='32' fill='currentColor' />
            <span className='text-13px'>
              {t('team.group.empty', {
                defaultValue: 'No messages yet. Broadcast something to start the conversation.',
              })}
            </span>
          </div>
        ) : (
          <div className='flex flex-col gap-8px py-16px px-16px'>
            {messages.map((msg) => {
              if (isRenderableTextMessage(msg)) {
                return (
                  <div key={msg.id} className='w-full'>
                    <MessageText message={msg} />
                  </div>
                );
              }
              return <NonTextPlaceholder key={msg.id} message={msg} />;
            })}
          </div>
        )}
      </div>
      <TeamBroadcastSendBox agents={team.agents} />
    </div>
  );
};

export default TeamGroupView;
