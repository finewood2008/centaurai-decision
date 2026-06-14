import { Message } from '@arco-design/web-react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import SendBox from '@/renderer/components/chat/SendBox';
import type { TeamAgent } from '@/common/types/team/teamTypes';
import { useTeamSharedContext } from '../hooks/useTeamSharedContext';

type Props = {
  agents: TeamAgent[];
};

/**
 * Broadcast send box for team "group chat" mode.
 *
 * - Renders recipient chips at the top: [All] [Leader] [Member 1] [Member 2] ...
 *   Default selection is "All". Clicking a single agent narrows the broadcast.
 * - On send, calls `acpConversation.sendMessage` once per selected agent's
 *   private conversation_id, in parallel. Per-agent failures are surfaced
 *   without blocking the others.
 *
 * Lives entirely in the renderer — does not change the ACP protocol or the
 * server-side team model. Each agent still receives the message in its own
 * private conversation, exactly as if the user had typed it in that column.
 */
const TeamBroadcastSendBox: React.FC<Props> = ({ agents }) => {
  const { t } = useTranslation();
  const sharedContext = useTeamSharedContext();
  const [input, setInput] = useState('');
  // selectedSlotIds === null means "broadcast to all"
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string> | null>(null);

  const sendableAgents = useMemo(() => agents.filter((a) => a.conversation_id), [agents]);

  const isAllSelected = selectedSlotIds === null;
  const isSelected = useCallback(
    (slot_id: string) => isAllSelected || (selectedSlotIds?.has(slot_id) ?? false),
    [isAllSelected, selectedSlotIds]
  );

  const toggleAll = useCallback(() => {
    setSelectedSlotIds(null);
  }, []);

  const toggleAgent = useCallback(
    (slot_id: string) => {
      setSelectedSlotIds((prev) => {
        // Coming from "all" → start a fresh set containing just this agent.
        if (prev === null) return new Set([slot_id]);
        const next = new Set(prev);
        if (next.has(slot_id)) next.delete(slot_id);
        else next.add(slot_id);
        // If nothing selected, fall back to "all".
        if (next.size === 0) return null;
        // If user manually re-selected every agent, normalize back to "all".
        if (next.size === sendableAgents.length) return null;
        return next;
      });
    },
    [sendableAgents.length]
  );

  const targetAgents = useMemo(() => {
    if (isAllSelected) return sendableAgents;
    return sendableAgents.filter((a) => selectedSlotIds!.has(a.slot_id));
  }, [isAllSelected, sendableAgents, selectedSlotIds]);

  const handleSend = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      if (targetAgents.length === 0) {
        Message.warning(t('team.broadcast.noRecipient', { defaultValue: 'Pick at least one agent' }));
        return;
      }

      const results = await Promise.allSettled(
        targetAgents.map((agent) => {
          // Mark each recipient as awaiting a reply BEFORE we send — when their
          // turn completes and shared-context is on, that reply will fan out
          // to the other teammates. Forwarded replies do NOT call this, which
          // is what prevents the cycle.
          sharedContext?.markAwaitingResponse(agent.slot_id);
          return ipcBridge.acpConversation.sendMessage.invoke({
            input: trimmed,
            conversation_id: agent.conversation_id,
          });
        })
      );

      const failed: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') failed.push(targetAgents[i].agent_name);
      });

      if (failed.length === results.length) {
        Message.error(
          t('team.broadcast.allFailed', {
            defaultValue: 'Failed to send to all recipients',
          })
        );
      } else if (failed.length > 0) {
        Message.warning(
          t('team.broadcast.partialFailed', {
            names: failed.join(', '),
            defaultValue: `Failed to deliver to: ${failed.join(', ')}`,
          })
        );
      }
      setInput('');
    },
    [targetAgents, t, sharedContext]
  );

  if (sendableAgents.length === 0) return null;

  const chipBaseClass =
    'shrink-0 px-8px h-22px rd-11px text-12px leading-none flex items-center gap-4px cursor-pointer select-none transition-colors border border-solid';

  return (
    <div
      data-testid='team-broadcast-sendbox'
      className='shrink-0 px-12px pt-8px pb-12px border-t border-solid border-[color:var(--border-base)] bg-[var(--color-bg-1)]'
    >
      <div className='flex items-center gap-6px overflow-x-auto pb-6px [scrollbar-width:none]'>
        <span className='shrink-0 text-12px text-[color:var(--color-text-3)] mr-2px'>
          {t('team.broadcast.recipients', { defaultValue: 'Send to:' })}
        </span>
        <button
          type='button'
          data-testid='team-broadcast-chip-all'
          onClick={toggleAll}
          className={`${chipBaseClass} ${
            isAllSelected
              ? 'bg-[color:var(--color-primary-light-1)] border-[color:var(--color-primary-6)] text-[color:var(--color-primary-6)]'
              : 'bg-transparent border-[color:var(--border-base)] text-[color:var(--color-text-2)] hover:bg-[var(--fill-2)]'
          }`}
        >
          {t('team.broadcast.all', { defaultValue: 'All' })}
          <span className='text-11px opacity-70'>({sendableAgents.length})</span>
        </button>
        {sendableAgents.map((agent) => {
          const selected = isSelected(agent.slot_id);
          return (
            <button
              key={agent.slot_id}
              type='button'
              data-testid={`team-broadcast-chip-${agent.slot_id}`}
              onClick={() => toggleAgent(agent.slot_id)}
              title={agent.agent_name}
              className={`${chipBaseClass} max-w-180px ${
                selected
                  ? 'bg-[color:var(--color-primary-light-1)] border-[color:var(--color-primary-6)] text-[color:var(--color-primary-6)]'
                  : 'bg-transparent border-[color:var(--border-base)] text-[color:var(--color-text-2)] hover:bg-[var(--fill-2)]'
              }`}
            >
              <span className='truncate'>{agent.agent_name}</span>
            </button>
          );
        })}
      </div>
      <SendBox
        value={input}
        onChange={setInput}
        onSend={handleSend}
        placeholder={t('team.broadcast.placeholder', {
          count: targetAgents.length,
          defaultValue:
            targetAgents.length === sendableAgents.length
              ? `Message all ${sendableAgents.length} agents...`
              : `Message ${targetAgents.length} agent(s)...`,
        })}
      />
    </div>
  );
};

export default TeamBroadcastSendBox;
