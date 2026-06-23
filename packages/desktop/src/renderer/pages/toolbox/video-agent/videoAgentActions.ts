/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Action vocabulary + execution glue for the Video Workbench AI assistant.
 *
 * The embedded editor exposes `window.__centaurVideoAgent` (see opencut-classic
 * src/agent/centaur-agent.ts). We describe that vocabulary to the chosen agent,
 * parse the JSON action plan it returns, and run each action inside the webview
 * via the `WebviewControl.executeScript` channel.
 */

import type { WebviewControl } from '@/renderer/components/media/WebviewHost';

export type VideoAction = { name: string; args?: Record<string, unknown> };
export type VideoActionResult = { name: string; ok: boolean; detail: unknown };

/** Human/LLM-readable description of every action the editor supports. */
export const VIDEO_ACTION_VOCAB = `Available actions (each takes a single JSON object argument):
- getState() -> { state } : read the full timeline (tracks, elements with id/startSec/durationSec, media assets, playhead).
- addText({ text, atSec?, durationSec?, color?, fontSize? }) : add a text/title overlay.
- addClip({ mediaId, atSec? }) : place an imported media asset on the timeline.
- importMediaFromUrl({ url, name? }) : import a media file from a URL.
- splitAt({ elementId, atSec }) : split a clip at a time.
- setClipDuration({ elementId, durationSec }) : trim a clip's length.
- setSpeed({ elementId, rate }) : change playback speed (1=normal, 2=2x).
- moveClip({ elementId, toSec, toTrackId? }) : move a clip.
- deleteClip({ elementId }) : remove a clip.
- addEffect({ elementId, effectType }) : add an effect (e.g. "blur").
- seek({ sec }) / undo({}) / redo({}) / export({ format? }).
All times are in SECONDS. Use element ids taken from getState.`;

/** Build the system instruction sent to the agent for a turn. */
export function buildVideoAgentPrompt(stateJson: string, userMessage: string): string {
  return [
    'You are the editing assistant inside Centaur AI Video Workbench. You operate a real video editor on the user’s behalf.',
    '',
    VIDEO_ACTION_VOCAB,
    '',
    'Current timeline state (JSON):',
    '```json',
    stateJson,
    '```',
    '',
    `User request: ${userMessage}`,
    '',
    'Reply with: (1) one short sentence describing what you will do, then (2) a fenced ```json code block containing {"actions":[{"name":"<action>","args":{...}}, ...]}.',
    'Only use actions and element ids that exist. Do NOT call any other tools or edit files. If no edit is needed, return {"actions":[]}.',
  ].join('\n');
}

/** Extract the {"actions":[...]} plan from the agent’s reply text. */
export function parseActions(text: string): VideoAction[] {
  const tryParse = (raw: string): VideoAction[] | null => {
    try {
      const obj = JSON.parse(raw) as { actions?: VideoAction[] };
      if (obj && Array.isArray(obj.actions)) return obj.actions;
    } catch {
      // ignore
    }
    return null;
  };
  // Prefer a fenced ```json block.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const parsed = tryParse(fence[1].trim());
    if (parsed) return parsed;
  }
  // Fall back to the first {...} that contains "actions".
  const brace = text.match(/\{[\s\S]*"actions"[\s\S]*\}/);
  if (brace) {
    const parsed = tryParse(brace[0]);
    if (parsed) return parsed;
  }
  return [];
}

/** Run one action inside the embedded editor and return its result. */
export async function runVideoAction(control: WebviewControl, action: VideoAction): Promise<VideoActionResult> {
  const name = action.name;
  const args = action.args ?? {};
  const code = `(async () => {
    try {
      const api = window.__centaurVideoAgent;
      if (!api || typeof api[${JSON.stringify(name)}] !== 'function') {
        return JSON.stringify({ ok: false, error: 'unknown_action:' + ${JSON.stringify(name)} });
      }
      const r = await api[${JSON.stringify(name)}](${JSON.stringify(args)});
      return JSON.stringify(r);
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e) });
    }
  })()`;
  try {
    const raw = await control.executeScript(code);
    const detail = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ok = Boolean((detail as { ok?: boolean })?.ok);
    return { name, ok, detail };
  } catch (e) {
    return { name, ok: false, detail: { error: e instanceof Error ? e.message : String(e) } };
  }
}

/** Read the current editor state as a JSON string (for the prompt). */
export async function readStateJson(control: WebviewControl): Promise<string> {
  const result = await runVideoAction(control, { name: 'getState' });
  try {
    return JSON.stringify((result.detail as { state?: unknown })?.state ?? {}, null, 0);
  } catch {
    return '{}';
  }
}
