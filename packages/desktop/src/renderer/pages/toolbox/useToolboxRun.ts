/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IConversationTurnCompletedEvent, IDirOrFile } from '@/common/adapter/ipcBridge';
import { getFullAutoMode } from '@/common/types/agent/agentModes';
import { buildCliAgentParams } from '@/renderer/pages/conversation/utils/createConversationParams';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import { buildToolPrompt, collectUploadPaths } from './toolboxPrompt';
import type { ToolDef, ToolFormValues, ToolImageResult, ToolRunResult } from './types';

/** Terminal wait for a run, in milliseconds. Image generation can be slow. */
const RUN_TIMEOUT_MS = 6 * 60 * 1000;
/** Max directory depth to scan for generated images. */
const MAX_SCAN_DEPTH = 2;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

type RunStatus = 'idle' | 'running' | 'done' | 'error';

export type UseToolboxRun = {
  status: RunStatus;
  result: ToolRunResult | null;
  error: string | null;
  run: (tool: ToolDef, agent: AgentMetadata | null, values: ToolFormValues) => Promise<void>;
  reset: () => void;
};

/** Recursively collect image files in a workspace, bounded by depth. */
async function scanImages(conversation_id: string, workspace: string, path: string, depth: number): Promise<string[]> {
  if (!workspace) return [];
  let nodes: IDirOrFile[];
  try {
    nodes = await ipcBridge.conversation.getWorkspace.invoke({ conversation_id, workspace, path });
  } catch {
    return [];
  }
  const found: string[] = [];
  const dirScans: Array<Promise<string[]>> = [];
  for (const node of nodes) {
    if (node.isFile && IMAGE_EXT.test(node.name)) {
      found.push(node.fullPath);
    } else if (node.isDir && depth < MAX_SCAN_DEPTH) {
      dirScans.push(scanImages(conversation_id, workspace, node.fullPath, depth + 1));
    }
  }
  for (const nested of await Promise.all(dirScans)) found.push(...nested);
  return found;
}

/**
 * Headless execution hook for the Common AI Toolbox.
 *
 * Creates a conversation for the chosen agent (in full-auto mode, with the
 * builtin image-generation MCP attached when the tool needs it), sends the
 * composed prompt, waits for the turn to finish, then collects any newly
 * generated images from the workspace for inline display. The created
 * conversation persists so the user can also open it in the normal chat view.
 */
export function useToolboxRun(): UseToolboxRun {
  const [status, setStatus] = useState<RunStatus>('idle');
  const [result, setResult] = useState<ToolRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  const run = useCallback(async (tool: ToolDef, agent: AgentMetadata | null, values: ToolFormValues) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus('running');
    setResult(null);
    setError(null);

    const unsubscribers: Array<() => void> = [];
    try {
      const input = buildToolPrompt(tool, values);
      const files = collectUploadPaths(tool, values);

      // Image tools generate directly with the configured image model — no agent,
      // no tool-calling. Deterministic and reliable regardless of agent choice.
      if (tool.requires === 'image-model') {
        const image_uris = files.length ? files : undefined;
        const rawCount = Number(values.count);
        const count = Number.isFinite(rawCount) ? Math.min(Math.max(Math.trunc(rawCount), 1), 4) : 1;

        const results = await Promise.all(
          Array.from({ length: count }, () =>
            ipcBridge.imageGen.generate.invoke({ prompt: input, image_uris, workspace: '' })
          )
        );
        const paths = results.filter((r) => r.success && r.imagePath).map((r) => r.imagePath as string);
        if (paths.length === 0) {
          throw new Error(results.find((r) => !r.success)?.error || 'generation_failed');
        }
        const loaded = await Promise.all(
          paths.map((path) =>
            ipcBridge.fs.getImageBase64.invoke({ path }).then((dataUrl) => (dataUrl ? { path, dataUrl } : null))
          )
        );
        const images = loaded.filter((item): item is ToolImageResult => item !== null);
        setResult({ conversation_id: '', text: results.find((r) => r.text)?.text ?? '', images });
        setStatus('done');
        return;
      }

      if (!agent) throw new Error('no_agent');
      const backend = agent.backend || agent.agent_type;

      const params = await buildCliAgentParams(agent, '');
      params.name = input.slice(0, 40) || tool.id;
      params.extra.session_mode = getFullAutoMode(backend);

      const conversation = await ipcBridge.conversation.create.invoke(params);
      if (!conversation?.id) throw new Error('conversation_create_failed');
      const conversationId = conversation.id;
      const initialWorkspace = (conversation.extra?.workspace as string | undefined) || '';

      // Snapshot pre-existing images so we only surface freshly generated ones.
      const baseline = new Set(await scanImages(conversationId, initialWorkspace, initialWorkspace, 0));

      const completion = new Promise<IConversationTurnCompletedEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('run_timeout')), RUN_TIMEOUT_MS);
        unsubscribers.push(
          ipcBridge.conversation.turnCompleted.on((event: IConversationTurnCompletedEvent) => {
            if (event.session_id !== conversationId) return;
            if (event.status === 'finished' || event.can_send_message === true) {
              clearTimeout(timer);
              resolve(event);
            }
          })
        );
      });

      await ipcBridge.conversation.sendMessage.invoke({
        conversation_id: conversationId,
        input,
        files,
        ...(tool.injectSkills?.length ? { inject_skills: tool.injectSkills } : {}),
      });
      const finished = await completion;

      const lastContent = finished.last_message?.content;
      const finalText = typeof lastContent === 'string' ? lastContent : '';

      const workspace = finished.workspace || initialWorkspace;
      const allImages = await scanImages(conversationId, workspace, workspace, 0);
      const newImagePaths = allImages.filter((p) => !baseline.has(p));

      const loaded = await Promise.all(
        newImagePaths.map((path) =>
          ipcBridge.fs.getImageBase64
            .invoke({ path, workspace })
            .then((dataUrl) => (dataUrl ? { path, dataUrl } : null))
        )
      );
      const images: ToolImageResult[] = loaded.filter((item): item is ToolImageResult => item !== null);

      setResult({ conversation_id: conversationId, text: finalText, images });
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    } finally {
      unsubscribers.forEach((off) => off());
      runningRef.current = false;
    }
  }, []);

  return { status, result, error, run, reset };
}
