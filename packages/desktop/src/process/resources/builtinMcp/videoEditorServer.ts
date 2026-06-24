/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for the Centaur Video Workbench.
 *
 * Runs as a standalone stdio process spawned by the agent's MCP client. It does
 * NOT touch the editor directly (the editor lives in a browser webview the agent
 * cannot reach); instead each tool POSTs an action to the editor's command bus
 * at http://localhost:3000/api/agent-bridge/command, which the editor client
 * picks up, runs via window.__centaurVideoAgent, and answers with the result.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BRIDGE_URL = process.env.AIONUI_VIDEO_BRIDGE_URL || 'http://localhost:3000/api/agent-bridge/command';

type BridgeReply = { ok: boolean; result?: unknown; error?: string };

/** POST one action to the editor command bus and return its textual result. */
async function callEditor(action: string, args: Record<string, unknown>) {
  try {
    const res = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, args }),
    });
    const json = (await res.json()) as BridgeReply;
    const payload = json.result ?? json;
    return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
  } catch (e) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error reaching the video editor. Make sure the Video Workbench is open. (${String(e)})`,
        },
      ],
      isError: true,
    };
  }
}

async function main() {
  const server = new McpServer({ name: 'centaur-video-editor', version: '1.0.0' });

  server.tool(
    'video_get_state',
    `Read the current video timeline: tracks, clips (id, startSec, durationSec, type), imported media, playhead and total duration.

WORKFLOW — follow this for EVERY video editing request before changing anything:
1. UNDERSTAND the user's intent. Call this tool first and use the returned timeline + media as context.
2. If the request is AMBIGUOUS or missing key details (which clip? what text/duration/order? which media?), infer the most likely intent from the timeline state; if still unclear, ASK the user ONE short clarifying question and STOP — do not edit yet.
3. Once clear, tell the user a brief one- or two-sentence PLAN of the edits you will make.
4. THEN perform the edits with the other video_* tools, using ids from this state. Report what you did.
Prefer small, reversible steps; the editor supports video_undo.`,
    {},
    () => callEditor('getState', {})
  );

  server.tool(
    'video_add_text',
    'Add a text / title overlay to the timeline.',
    {
      text: z.string().describe('The text to show.'),
      atSec: z.number().optional().describe('Start time in seconds (default 0).'),
      durationSec: z.number().optional().describe('Duration in seconds (default 3).'),
      color: z.string().optional().describe('Hex color, e.g. "#ffffff".'),
      fontSize: z.number().optional(),
    },
    (a) => callEditor('addText', a)
  );

  server.tool(
    'video_add_clip',
    'Place an imported media asset (by mediaId from video_get_state) onto the timeline.',
    {
      mediaId: z.string(),
      atSec: z.number().optional(),
    },
    (a) => callEditor('addClip', a)
  );

  server.tool(
    'video_import_media',
    'Import a media file into the project from a URL.',
    { url: z.string(), name: z.string().optional() },
    (a) => callEditor('importMediaFromUrl', a)
  );

  server.tool(
    'video_split_clip',
    'Split a clip at a given time (seconds). Use an elementId from video_get_state.',
    { elementId: z.string(), atSec: z.number() },
    (a) => callEditor('splitAt', a)
  );

  server.tool(
    'video_set_clip_duration',
    'Trim a clip to a given duration in seconds.',
    { elementId: z.string(), durationSec: z.number() },
    (a) => callEditor('setClipDuration', a)
  );

  server.tool(
    'video_set_speed',
    'Change a clip playback speed (1 = normal, 2 = 2x).',
    { elementId: z.string(), rate: z.number() },
    (a) => callEditor('setSpeed', a)
  );

  server.tool('video_delete_clip', 'Remove a clip from the timeline.', { elementId: z.string() }, (a) =>
    callEditor('deleteClip', a)
  );

  server.tool(
    'video_add_effect',
    'Add an effect (e.g. "blur") to a clip.',
    { elementId: z.string(), effectType: z.string() },
    (a) => callEditor('addEffect', a)
  );

  server.tool('video_undo', 'Undo the last edit.', {}, () => callEditor('undo', {}));
  server.tool('video_redo', 'Redo the last undone edit.', {}, () => callEditor('redo', {}));

  server.tool(
    'video_export',
    'Export the current timeline to a video file (downloads it).',
    { format: z.string().optional().describe('"mp4" (default) or "webm".') },
    (a) => callEditor('export', a)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[VideoEditorMCP] Fatal error:', error);
  process.exit(1);
});
