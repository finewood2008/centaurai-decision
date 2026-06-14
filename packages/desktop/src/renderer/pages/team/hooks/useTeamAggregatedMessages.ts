import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { composeMessage, transformMessage } from '@/common/chat/chatLib';
import type { TMessage, IMessageText } from '@/common/chat/chatLib';
import type { TTeam, TeamAgent } from '@/common/types/team/teamTypes';

/** Message tagged with which team agent it came from. */
export type TeamMessage = TMessage & {
  team_slot_id?: string;
  team_agent_name?: string;
  team_agent_type?: string;
};

const USER_DEDUP_WINDOW_MS = 2000;

/**
 * Tag an agent's outbound (left-position) message with sender info so the
 * existing MessageText renderer shows the agent's name + avatar.
 */
function tagAgentMessage(msg: TMessage, agent: TeamAgent): TeamMessage {
  const tagged: TeamMessage = {
    ...msg,
    team_slot_id: agent.slot_id,
    team_agent_name: agent.agent_name,
    team_agent_type: agent.agent_type,
  };
  if (msg.type === 'text' && msg.position === 'left') {
    const textMsg = msg as IMessageText;
    const existing = textMsg.content ?? ({} as IMessageText['content']);
    (tagged as IMessageText).content = {
      ...existing,
      teammateMessage: true,
      senderName: existing.senderName || agent.agent_name,
      senderAgentType: existing.senderAgentType || agent.agent_type,
      senderConversationId: existing.senderConversationId || agent.conversation_id,
    };
  }
  return tagged;
}

/**
 * Dedupe user (right-position) text messages across agents.
 *
 * When the user broadcasts a single message to N agents we end up with N user
 * messages in N separate conversations — same content, sent within a couple
 * hundred ms. Collapse them to a single bubble in the merged timeline.
 */
function dedupeUserMessages(messages: TeamMessage[]): TeamMessage[] {
  const out: TeamMessage[] = [];
  const recentUserBuckets: Array<{ content: string; ts: number; index: number }> = [];

  for (const msg of messages) {
    if (msg.position !== 'right' || msg.type !== 'text') {
      out.push(msg);
      continue;
    }
    const content = typeof msg.content?.content === 'string' ? msg.content.content : JSON.stringify(msg.content);
    const ts = msg.created_at ?? 0;

    const dup = recentUserBuckets.find((b) => b.content === content && Math.abs(b.ts - ts) <= USER_DEDUP_WINDOW_MS);
    if (dup) continue;

    recentUserBuckets.push({ content, ts, index: out.length });
    // Cheap GC — bucket only needs items within the dedup window of the most recent.
    while (recentUserBuckets.length > 0 && ts - recentUserBuckets[0].ts > USER_DEDUP_WINDOW_MS * 4) {
      recentUserBuckets.shift();
    }
    out.push(msg);
  }

  return out;
}

function sortMessages(messages: TeamMessage[]): TeamMessage[] {
  return messages.toSorted((a, b) => {
    const ta = a.created_at ?? 0;
    const tb = b.created_at ?? 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Subscribe to messages from every agent in the team and return a single
 * merged + sorted timeline.
 *
 * Each agent's text replies are tagged with sender info so the existing
 * MessageText renderer shows their name and avatar. Broadcast user messages
 * (same content sent to multiple conversations) are deduped.
 *
 * Pure renderer-side aggregation — does not touch the ACP protocol or the
 * team backend.
 */
export function useTeamAggregatedMessages(team: TTeam): {
  messages: TeamMessage[];
  isLoading: boolean;
} {
  // Per-agent state keyed by slot_id. Stored in refs so handlers can read
  // current state without re-subscribing on every change.
  const perAgentRef = useRef<Map<string, TMessage[]>>(new Map());
  const [version, setVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const agents = team.agents;
  // Stable key based on conversation_ids so we only re-subscribe when the
  // membership actually changes.
  const conversationKey = useMemo(() => agents.map((a) => a.conversation_id).join(','), [agents]);

  const conversationToSlotMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      if (a.conversation_id) map.set(a.conversation_id, a.slot_id);
    }
    return map;
  }, [agents]);

  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  // Initial load: fetch each agent's history in parallel.
  useEffect(() => {
    if (!conversationKey) {
      perAgentRef.current = new Map();
      bumpVersion();
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    Promise.all(
      agents
        .filter((a) => a.conversation_id)
        .map(async (a) => {
          try {
            const result = await ipcBridge.database.getConversationMessages.invoke({
              conversation_id: a.conversation_id,
              page: 0,
              page_size: 10000,
              content_mode: 'compact',
            });
            return { slot_id: a.slot_id, items: result?.items ?? [] };
          } catch {
            return { slot_id: a.slot_id, items: [] as TMessage[] };
          }
        })
    )
      .then((bundles) => {
        if (cancelled) return;
        const next = new Map<string, TMessage[]>();
        for (const b of bundles) next.set(b.slot_id, b.items);
        perAgentRef.current = next;
        bumpVersion();
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationKey, agents, bumpVersion]);

  // Live stream: subscribe once to the global response stream, filter by team
  // membership, and merge into the appropriate agent's list.
  useEffect(() => {
    if (!conversationKey) return;

    const unsubStream = ipcBridge.conversation.responseStream.on((payload) => {
      const slot_id = conversationToSlotMap.get(payload.conversation_id);
      if (!slot_id) return;
      const transformed = transformMessage(payload);
      if (!transformed) return;
      const prevList = perAgentRef.current.get(slot_id) ?? [];
      const nextList = composeMessage(transformed, prevList);
      if (nextList !== prevList) {
        const next = new Map(perAgentRef.current);
        next.set(slot_id, nextList);
        perAgentRef.current = next;
        bumpVersion();
      }
    });

    const unsubUserCreated = ipcBridge.conversation.userCreated.on((payload) => {
      const slot_id = conversationToSlotMap.get(payload.conversation_id);
      if (!slot_id) return;
      if (payload.hidden) return;
      const userMsg: TMessage = {
        id: payload.msg_id,
        msg_id: payload.msg_id,
        conversation_id: payload.conversation_id,
        type: 'text',
        position: 'right',
        status: payload.status,
        created_at: payload.created_at,
        content: { content: payload.content },
      };
      const prevList = perAgentRef.current.get(slot_id) ?? [];
      // Skip if we already have a message with this msg_id
      if (prevList.some((m) => m.msg_id === payload.msg_id || m.id === payload.msg_id)) return;
      const next = new Map(perAgentRef.current);
      next.set(slot_id, [...prevList, userMsg]);
      perAgentRef.current = next;
      bumpVersion();
    });

    return () => {
      unsubStream();
      unsubUserCreated();
    };
  }, [conversationKey, conversationToSlotMap, bumpVersion]);

  // Merge, tag, dedupe, sort whenever underlying state bumps.
  const messages = useMemo(() => {
    void version; // re-run on bump
    const acc: TeamMessage[] = [];
    for (const agent of agents) {
      const list = perAgentRef.current.get(agent.slot_id);
      if (!list) continue;
      for (const m of list) acc.push(tagAgentMessage(m, agent));
    }
    return dedupeUserMessages(sortMessages(acc));
  }, [version, agents]);

  return { messages, isLoading };
}
