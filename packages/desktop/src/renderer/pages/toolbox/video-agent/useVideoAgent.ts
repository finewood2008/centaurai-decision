/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IConversationTurnCompletedEvent, IResponseMessage } from '@/common/adapter/ipcBridge';
import { transformMessage } from '@/common/chat/chatLib';
import { getFullAutoMode } from '@/common/types/agent/agentModes';
import { buildCliAgentParams } from '@/renderer/pages/conversation/utils/createConversationParams';
import { ensureBackendMcpCatalog, toSessionMcpServer } from '@/renderer/hooks/mcp/catalog';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { buildVideoAgentPrompt } from './videoAgentActions';

const TURN_TIMEOUT_MS = 4 * 60 * 1000;
/** Stable name of the built-in Video Workbench MCP server (see runBackendMigrations). */
const VIDEO_EDITOR_MCP_NAME = 'centaur-video-editor';

export type VideoChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
};

export type UseVideoAgent = {
  messages: VideoChatMessage[];
  busy: boolean;
  send: (text: string, agent: AgentMetadata) => Promise<void>;
  reset: () => void;
};

let seq = 0;
const nextId = () => `vc-${Date.now()}-${seq++}`;

/**
 * Runs the chosen CentaurAI agent against the embedded video editor. The agent
 * performs edits by CALLING the video_* MCP tools (built-in `centaur-video-editor`
 * server), which POST to the editor command bus — so editing is reliable and we
 * never parse JSON from the reply. We just surface the agent's text.
 */
export function useVideoAgent(): UseVideoAgent {
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
    // Keep these ephemeral assistant runs out of the main history sidebar.
    (params.extra as Record<string, unknown>).hidden_from_sidebar = true;
    // Attach the built-in Video Workbench MCP (centaur-video-editor) to THIS
    // session, so the agent actually has the video_* tools. Built-in servers must
    // ride on `selected_session_mcp_servers` — `selected_mcp_server_ids` excludes
    // built-ins. This mirrors how the main composer wires MCP in useGuidSend.
    try {
      const { allServers } = await ensureBackendMcpCatalog();
      const videoServer = allServers.find((server) => server.name === VIDEO_EDITOR_MCP_NAME);
      if (videoServer) {
        params.extra.selected_session_mcp_servers = [toSessionMcpServer(videoServer)];
      }
    } catch {
      // Non-fatal: without it the agent will simply report it lacks the tools.
    }
    const conversation = await ipcBridge.conversation.create.invoke(params);
    if (!conversation?.id) throw new Error('conversation_create_failed');
    convRef.current = { id: conversation.id, agentId: agent.id };
    return conversation.id;
  }, []);

  const runTurn = useCallback(async (conversationId: string, input: string): Promise<string> => {
    const unsub: Array<() => void> = [];
    // ACP agents stream their reply via responseStream; last_message.content is
    // often null. Accumulate the streamed assistant text and use that.
    let streamed = '';
    try {
      unsub.push(
        ipcBridge.acpConversation.responseStream.on((message: IResponseMessage) => {
          if (message.conversation_id !== conversationId) return;
          const tm = transformMessage(message);
          if (tm && tm.type === 'text') {
            const piece = (tm.content as { content?: string })?.content ?? '';
            streamed = message.replace ? piece : streamed + piece;
          }
        })
      );
      const completion = new Promise<IConversationTurnCompletedEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('turn_timeout')), TURN_TIMEOUT_MS);
        unsub.push(
          ipcBridge.conversation.turnCompleted.on((event: IConversationTurnCompletedEvent) => {
            if (event.session_id !== conversationId) return;
            if (event.status === 'finished') {
              clearTimeout(timer);
              resolve(event);
            }
          })
        );
      });
      await ipcBridge.conversation.sendMessage.invoke({ conversation_id: conversationId, input, files: [] });
      const finished = await completion;
      if (streamed.trim()) return streamed;
      const content = finished.last_message?.content;
      return typeof content === 'string' ? content : '';
    } finally {
      unsub.forEach((off) => off());
    }
  }, []);

  const send = useCallback(
    async (text: string, agent: AgentMetadata) => {
      if (runningRef.current || !text.trim()) return;
      runningRef.current = true;
      setBusy(true);
      setMessages((m) => [...m, { id: nextId(), role: 'user', text }]);
      try {
        const conversationId = await ensureConversation(agent);
        const reply = await runTurn(conversationId, buildVideoAgentPrompt(text));
        setMessages((m) => [...m, { id: nextId(), role: 'assistant', text: reply.trim() || '完成。' }]);
      } catch (e) {
        setMessages((m) => [...m, { id: nextId(), role: 'error', text: e instanceof Error ? e.message : String(e) }]);
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [ensureConversation, runTurn]
  );

  return { messages, busy, send, reset };
}
