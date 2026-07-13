/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IConversationTurnCompletedEvent } from '@/common/adapter/ipcBridge';
import { registerGeneratedArtifactsFromPayload } from '@/renderer/utils/file/generatedArtifacts';
import { emitter } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Tool names that coordinate a team/圆桌会议 round rather than touch the
 * filesystem. Mirrors the filter in the per-conversation Workspace panel so the
 * Content Hub / Recent Files don't refresh on every team-orchestration call.
 */
const isNonFileSystemTool = (name?: string) => !!name && /^mcp__aionui-team-|^team_/.test(name);

/** Trailing window (ms) collapsing a burst of agent tool calls into one reload. */
const REFRESH_THROTTLE_MS = 3000;

/**
 * Auto-refresh a generated-files view (Content Hub, home Recent Files) when any
 * agent finishes a file-mutating tool call.
 *
 * The Content Hub and Recent Files are otherwise snapshot views (load on mount,
 * plus a slow poll), so files produced while they're open don't appear until a
 * reopen/poll. This subscribes to the unified agent response stream
 * (`acpConversation.responseStream`, shared by every backend) and calls
 * `onChange` — throttled — whenever an `edit`/`execute` tool, or any completed
 * non-read / non-team tool, lands. That covers files written by any agent type
 * (办公助理/专家/工具箱/圆桌会议) regardless of which conversation is active.
 */
export function useGeneratedFilesAutoRefresh(onChange: () => void): void {
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef(false);

  const throttled = useCallback(() => {
    if (throttleTimerRef.current) {
      pendingRef.current = true; // fire a trailing refresh after the window
      return;
    }
    onChange();
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;
      if (pendingRef.current) {
        pendingRef.current = false;
        onChange();
      }
    }, REFRESH_THROTTLE_MS);
  }, [onChange]);

  useEffect(() => {
    const handleGeneratedFilesChanged = () => throttled();
    const handleTurnCompleted = (event: IConversationTurnCompletedEvent) => {
      void registerGeneratedArtifactsFromPayload(event.last_message?.content, {
        workspace: event.workspace,
        conversationId: event.session_id,
        source: 'conversation',
      });
      throttled();
    };
    const handleResponse = (data: { type: string; data?: unknown }) => {
      if (data.type === 'acp_tool_call') {
        const acpData = data.data as { update?: { kind?: string; status?: string; title?: string } } | undefined;
        const kind = acpData?.update?.kind;
        const status = acpData?.update?.status;
        const shouldRefresh = kind === 'edit' || kind === 'execute' || (status === 'completed' && kind !== 'read');
        if (shouldRefresh && !isNonFileSystemTool(acpData?.update?.title)) throttled();
      } else if (data.type === 'tool_call') {
        const toolData = data.data as { status?: string; name?: string } | undefined;
        if (toolData?.status === 'completed' && !isNonFileSystemTool(toolData?.name)) throttled();
      }
    };
    emitter.on('generated-files.changed', handleGeneratedFilesChanged);
    const unsubscribe = ipcBridge.acpConversation.responseStream.on(handleResponse);
    const unsubscribeTurnCompleted = ipcBridge.conversation.turnCompleted.on(handleTurnCompleted);
    return () => {
      emitter.off('generated-files.changed', handleGeneratedFilesChanged);
      unsubscribe();
      unsubscribeTurnCompleted();
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, [throttled]);
}
