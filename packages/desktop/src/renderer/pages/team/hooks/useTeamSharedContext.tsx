import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { transformMessage } from '@/common/chat/chatLib';
import type { TMessage, IMessageText } from '@/common/chat/chatLib';
import type { TTeam, ITeamAgentStatusEvent } from '@/common/types/team/teamTypes';

const STORAGE_KEY = 'team-shared-context-enabled';

type StoredMap = Record<string, boolean>;

function readStore(): StoredMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as StoredMap;
  } catch {
    // ignore malformed storage
  }
  return {};
}

function writeStore(map: StoredMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

type SharedContextValue = {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /**
   * Mark an agent slot as "the next reply should be forwarded to teammates".
   * Called by the broadcast send box when the user broadcasts a message.
   * Forwarded replies do NOT mark their recipients — that's the loop break.
   */
  markAwaitingResponse: (slot_id: string) => void;
};

const TeamSharedContext = React.createContext<SharedContextValue | null>(null);

/**
 * Safe consumer hook — returns null when no team shared-context provider is
 * mounted (e.g. for non-team conversations).
 */
export function useTeamSharedContext(): SharedContextValue | null {
  return useContext(TeamSharedContext);
}

type ProviderProps = {
  team: TTeam;
  children: React.ReactNode;
};

/**
 * Phase 3: cross-agent visibility.
 *
 * When enabled, each agent's reply gets forwarded to every other agent in the
 * team as `[AgentName]: <reply>` (a user-side message in their private
 * conversation). This lets the agents "hear" each other and react.
 *
 * Loop break: only replies whose triggering input was a user broadcast get
 * forwarded. A reply that was triggered by an incoming forward does NOT
 * forward again — depth is always 1.
 *
 * Pure renderer-side orchestration. Each forward is just another
 * `acpConversation.sendMessage` call; the ACP protocol and the team backend
 * are untouched.
 */
export const TeamSharedContextRoot: React.FC<ProviderProps> = ({ team, children }) => {
  const [enabled, setEnabledState] = useState<boolean>(() => readStore()[team.id] ?? false);

  useEffect(() => {
    setEnabledState(readStore()[team.id] ?? false);
  }, [team.id]);

  const setEnabled = useCallback(
    (v: boolean) => {
      setEnabledState(v);
      const next = readStore();
      next[team.id] = v;
      writeStore(next);
    },
    [team.id]
  );

  // Refs let the WS handlers read live state without forcing re-subscription
  // on every change.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // slot_id → true: agents whose next completion should be forwarded.
  const awaitingRef = useRef<Set<string>>(new Set());
  // conversation_id → { msg_id, text }: rolling accumulator for the latest
  // text reply per agent. Updated on every text chunk in responseStream.
  const latestTextRef = useRef<Map<string, { msg_id: string; text: string }>>(new Map());

  const markAwaitingResponse = useCallback((slot_id: string) => {
    awaitingRef.current.add(slot_id);
  }, []);

  // Agents/conversation membership is stable per team; recompute only when
  // the agent list changes shape.
  const conversationIdToAgent = useMemo(() => {
    const m = new Map<string, { slot_id: string; agent_name: string; conversation_id: string }>();
    for (const a of team.agents) {
      if (a.conversation_id) {
        m.set(a.conversation_id, {
          slot_id: a.slot_id,
          agent_name: a.agent_name,
          conversation_id: a.conversation_id,
        });
      }
    }
    return m;
  }, [team.agents]);

  // Subscribe to the global response stream and roll up the latest text per
  // agent. We track by (conversation_id, msg_id) and accumulate chunks like
  // composeMessage would — so when status flips to idle/completed we have the
  // final assembled reply.
  useEffect(() => {
    const conversationIds = new Set(conversationIdToAgent.keys());
    if (conversationIds.size === 0) return;

    const unsub = ipcBridge.conversation.responseStream.on((payload) => {
      if (!conversationIds.has(payload.conversation_id)) return;
      const transformed = transformMessage(payload) as TMessage | undefined;
      if (!transformed) return;
      if (transformed.type !== 'text' || transformed.position !== 'left') return;
      const textMsg = transformed as IMessageText;
      const chunk = textMsg.content?.content;
      if (typeof chunk !== 'string') return;
      const replace = Boolean(textMsg.content?.replace) || Boolean(payload.replace);
      const msg_id = transformed.msg_id;
      if (!msg_id) return;

      const prev = latestTextRef.current.get(payload.conversation_id);
      if (prev?.msg_id === msg_id && !replace) {
        latestTextRef.current.set(payload.conversation_id, { msg_id, text: prev.text + chunk });
      } else {
        latestTextRef.current.set(payload.conversation_id, { msg_id, text: chunk });
      }
    });

    return () => {
      unsub();
    };
  }, [conversationIdToAgent]);

  // Subscribe to agent status events; when an awaiting agent's status flips to
  // idle/completed, fan out their latest text to every other agent.
  useEffect(() => {
    const unsub = ipcBridge.team.agentStatusChanged.on((event: ITeamAgentStatusEvent) => {
      if (event.team_id !== team.id) return;
      if (!enabledRef.current) return;
      if (event.status !== 'idle' && event.status !== 'completed') return;
      if (!awaitingRef.current.has(event.slot_id)) return;

      const sourceAgent = team.agents.find((a) => a.slot_id === event.slot_id);
      if (!sourceAgent || !sourceAgent.conversation_id) {
        awaitingRef.current.delete(event.slot_id);
        return;
      }

      const latest = latestTextRef.current.get(sourceAgent.conversation_id);
      // Clear the awaiting flag regardless — one user broadcast turn = at most
      // one forward fan-out. If we got no text (e.g. the agent only used tools)
      // we just skip the forward.
      awaitingRef.current.delete(event.slot_id);
      const text = latest?.text?.trim();
      if (!text) return;

      const recipients = team.agents.filter((a) => a.slot_id !== event.slot_id && a.conversation_id);
      if (recipients.length === 0) return;

      const formatted = `[${sourceAgent.agent_name}]: ${text}`;
      // Fire-and-forget; per-recipient failure does not block the others.
      // Team-owned conversations must go through the Team API (aioncore ≥0.1.29).
      void Promise.allSettled(
        recipients.map((r) =>
          ipcBridge.team.sendAgentMessage.invoke({
            team_id: team.id,
            slot_id: r.slot_id,
            input: formatted,
          })
        )
      );
    });

    return () => {
      unsub();
    };
  }, [team.id, team.agents]);

  const value = useMemo<SharedContextValue>(
    () => ({ enabled, setEnabled, markAwaitingResponse }),
    [enabled, setEnabled, markAwaitingResponse]
  );

  return <TeamSharedContext.Provider value={value}>{children}</TeamSharedContext.Provider>;
};
