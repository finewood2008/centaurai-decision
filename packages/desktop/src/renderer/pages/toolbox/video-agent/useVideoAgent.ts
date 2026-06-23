/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IConversationTurnCompletedEvent } from '@/common/adapter/ipcBridge';
import { getFullAutoMode } from '@/common/types/agent/agentModes';
import { buildCliAgentParams } from '@/renderer/pages/conversation/utils/createConversationParams';
import type { WebviewControl } from '@/renderer/components/media/WebviewHost';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import {
  buildVideoAgentPrompt,
  parseActions,
  readStateJson,
  runVideoAction,
  type VideoActionResult,
} from './videoAgentActions';

const TURN_TIMEOUT_MS = 4 * 60 * 1000;

export type VideoChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  actions?: VideoActionResult[];
};

export type UseVideoAgent = {
  messages: VideoChatMessage[];
  busy: boolean;
  send: (text: string, agent: AgentMetadata) => Promise<void>;
  reset: () => void;
};

let seq = 0;
const nextId = () => `vc-${Date.now()}-${seq++}`;

/** Strip the JSON action block so only the agent's narration is shown. */
function narration(text: string): string {
  return text.replace(/```(?:json)?[\s\S]*?```/gi, '').trim();
}

/**
 * Drives the chosen CentaurAI agent to operate the embedded video editor.
 * `getControl` returns the live WebviewControl for the editor webview.
 */
export function useVideoAgent(getControl: () => WebviewControl | null): UseVideoAgent {
  const [messages, setMessages] = useState<VideoChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const convRef = useRef<{ id: string; agentId: string } | null>(null);
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    setMessages([]);
    convRef.current = null;
  }, []);

  const ensureConversation = useCallback(async (agent: AgentMetadata): Promise<string> => {
    if (convRef.current && convRef.current.agentId === agent.id) return convRef.current.id;
    const backend = agent.backend || agent.agent_type;
    const params = await buildCliAgentParams(agent, '');
    params.name = 'Video Workbench';
    params.extra.session_mode = getFullAutoMode(backend);
    const conversation = await ipcBridge.conversation.create.invoke(params);
    if (!conversation?.id) throw new Error('conversation_create_failed');
    convRef.current = { id: conversation.id, agentId: agent.id };
    return conversation.id;
  }, []);

  const runTurn = useCallback(async (conversationId: string, input: string): Promise<string> => {
    const unsub: Array<() => void> = [];
    try {
      const completion = new Promise<IConversationTurnCompletedEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('turn_timeout')), TURN_TIMEOUT_MS);
        unsub.push(
          ipcBridge.conversation.turnCompleted.on((event: IConversationTurnCompletedEvent) => {
            if (event.session_id !== conversationId) return;
            if (event.status === 'finished' || event.can_send_message === true) {
              clearTimeout(timer);
              resolve(event);
            }
          })
        );
      });
      await ipcBridge.conversation.sendMessage.invoke({ conversation_id: conversationId, input, files: [] });
      const finished = await completion;
      const content = finished.last_message?.content;
      return typeof content === 'string' ? content : '';
    } finally {
      unsub.forEach((off) => off());
    }
  }, []);

  const send = useCallback(
    async (text: string, agent: AgentMetadata) => {
      if (runningRef.current || !text.trim()) return;
      const control = getControl();
      if (!control) {
        setMessages((m) => [...m, { id: nextId(), role: 'error', text: 'editor_not_ready' }]);
        return;
      }
      runningRef.current = true;
      setBusy(true);
      setMessages((m) => [...m, { id: nextId(), role: 'user', text }]);
      try {
        const conversationId = await ensureConversation(agent);
        const stateJson = await readStateJson(control);
        const reply = await runTurn(conversationId, buildVideoAgentPrompt(stateJson, text));

        const actions = parseActions(reply);
        const results: VideoActionResult[] = [];
        for (const action of actions) {
          // eslint-disable-next-line no-await-in-loop
          results.push(await runVideoAction(control, action));
        }
        setMessages((m) => [
          ...m,
          { id: nextId(), role: 'assistant', text: narration(reply) || '已处理。', actions: results },
        ]);
      } catch (e) {
        setMessages((m) => [...m, { id: nextId(), role: 'error', text: e instanceof Error ? e.message : String(e) }]);
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [ensureConversation, getControl, runTurn]
  );

  return { messages, busy, send, reset };
}
