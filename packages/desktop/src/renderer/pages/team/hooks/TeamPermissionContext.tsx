import { ipcBridge } from '@/common';
import type { ISendMessageResult } from '@/common/adapter/ipcBridge';
import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';

type AgentSlot = { slot_id: string; conversation_id: string };

type TeamPermissionContextValue = {
  /** Whether we are in team mode */
  isTeamMode: true;
  /** Whether the current active agent is the team leader */
  isLeaderAgent: boolean;
  /** Conversation ID of the leader agent */
  leaderConversationId: string;
  /** All agent conversation IDs in this team (for centralized confirmation listening) */
  allConversationIds: string[];
  /** Propagate a permission mode change from the leader to all member agents */
  propagateMode: (mode: string) => void;
  /** Trigger session warmup (idempotent, returns cached promise) */
  warmupSession: () => Promise<void>;
  /**
   * Send a message to a team-owned conversation. aioncore (≥0.1.29) rejects the
   * ordinary `POST /conversations/:id/messages` for team-owned conversations
   * ("must be sent through Team API"), so route through the team endpoint by
   * resolving the conversation's slot. Falls back to the ordinary send if the
   * conversation isn't a known team member.
   */
  sendToConversation: (conversation_id: string, input: string, files?: string[]) => Promise<ISendMessageResult>;
};

const TeamPermissionContext = createContext<TeamPermissionContextValue | null>(null);

export const TeamPermissionProvider: React.FC<{
  children: React.ReactNode;
  team_id: string;
  isLeaderAgent: boolean;
  leaderConversationId: string;
  allConversationIds: string[];
  agentSlots: AgentSlot[];
}> = ({ children, team_id, isLeaderAgent, leaderConversationId, allConversationIds, agentSlots }) => {
  const warmupPromiseRef = useRef<Promise<void> | null>(null);

  const propagateMode = useCallback(
    (mode: string) => {
      // Persist session_mode on the team record so newly spawned agents inherit it
      void ipcBridge.team.setSessionMode.invoke({ team_id, session_mode: mode }).catch(() => {
        // Best-effort: if this fails, agents still get mode via per-conversation setMode below
      });
    },
    [team_id]
  );

  const warmupSession = useCallback((): Promise<void> => {
    if (warmupPromiseRef.current) {
      return warmupPromiseRef.current;
    }

    const promise = ipcBridge.team.ensureSession.invoke({ team_id });
    // Fire-and-forget callers only use warmup as a hint; attach a no-op catch
    // so rejected warmups do not surface as unhandled promise rejections.
    void promise.catch(() => {});
    warmupPromiseRef.current = promise.finally(() => {
      warmupPromiseRef.current = null;
    });
    return warmupPromiseRef.current;
  }, [team_id]);

  const slotByConversation = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agentSlots) if (a.conversation_id) m.set(a.conversation_id, a.slot_id);
    return m;
  }, [agentSlots]);

  const sendToConversation = useCallback(
    (conversation_id: string, input: string, files?: string[]): Promise<ISendMessageResult> => {
      const slot_id = slotByConversation.get(conversation_id);
      if (slot_id) return ipcBridge.team.sendAgentMessage.invoke({ team_id, slot_id, input, files });
      return ipcBridge.acpConversation.sendMessage.invoke({ conversation_id, input, files });
    },
    [slotByConversation, team_id]
  );

  const value = useMemo<TeamPermissionContextValue>(
    () => ({
      isTeamMode: true,
      isLeaderAgent,
      leaderConversationId,
      allConversationIds,
      propagateMode,
      warmupSession,
      sendToConversation,
    }),
    [isLeaderAgent, leaderConversationId, allConversationIds, propagateMode, warmupSession, sendToConversation]
  );

  return <TeamPermissionContext.Provider value={value}>{children}</TeamPermissionContext.Provider>;
};

/**
 * Returns team permission context if inside a team, or null for standalone conversations.
 * This ensures all team-only logic is gated behind a null check — no impact on single agent mode.
 */
export const useTeamPermission = (): TeamPermissionContextValue | null => {
  return useContext(TeamPermissionContext);
};
