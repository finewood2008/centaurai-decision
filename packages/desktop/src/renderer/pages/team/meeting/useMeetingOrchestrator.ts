import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { transformMessage } from '@/common/chat/chatLib';
import type { TMessage, IMessageText } from '@/common/chat/chatLib';
import type { TTeam, TeamAgent, ITeamRunEvent, ITeamChildTurnEvent } from '@/common/types/team/teamTypes';
import { EMPTY_MEETING_STATE, type MeetingState } from './meetingTypes';
import { buildTeamRunTask, parseResolutionOptions, type PanelistBrief } from './meetingPrompts';

const STORAGE_KEY = 'team-meeting-state';

type StoredMap = Record<string, Partial<MeetingState>>;

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

/** Hydrate persisted meeting; a run that was live can't be resumed, so park it. */
function hydrate(team_id: string): MeetingState {
  const stored = readStore()[team_id];
  if (!stored) return { ...EMPTY_MEETING_STATE };
  const merged: MeetingState = { ...EMPTY_MEETING_STATE, ...stored, revision: 0 };
  // The in-memory run subscription can't survive a reload. Keep a finished
  // resolution/decided state; otherwise reset to idle.
  if (merged.phase === 'running') return { ...EMPTY_MEETING_STATE, topic: merged.topic };
  return merged;
}

export type MeetingOrchestrator = {
  state: MeetingState;
  moderator: TeamAgent | null;
  panelists: TeamAgent[];
  /** True when the team has a moderator + at least one panelist. */
  canStart: boolean;
  startMeeting: (topic: string) => void;
  /** Boss interjects mid-run; injected into the live team_run. */
  interject: (text: string) => void;
  /** Cancel the in-flight team_run. */
  cancel: () => void;
  /** Boss picks a final option. */
  decide: (optionId: string) => void;
  /** Tear the meeting down (cancels any live run). */
  reset: () => void;
};

/**
 * Renderer-side meeting controller — a VIEW over the backend team_run.
 *
 * Sends the topic to the team (`sendTeamMessage`), which the leader runs as a
 * roundtable among the teammates. We subscribe to the backend's `team.run*` /
 * `team.childTurn*` events to drive the meeting UI (who's speaking, progress,
 * completion) and parse the leader's final summary into decision options.
 *
 * Orchestration lives in the backend (aioncore ≥ 0.1.29); we no longer drive
 * turns from the renderer.
 */
export function useMeetingOrchestrator(team: TTeam): MeetingOrchestrator {
  const [, setVersion] = useState(0);
  const stateRef = useRef<MeetingState>(hydrate(team.id));

  // conversation_id → latest assistant text (reset per msg_id) so we can read
  // the leader's final summary when the run completes.
  const latestTextRef = useRef<Map<string, { msg_id: string; text: string }>>(new Map());
  const warmupRef = useRef<Promise<void> | null>(null);

  const moderator = team.agents.find((a) => a.role === 'leader' && a.conversation_id) ?? null;
  const panelists = team.agents.filter((a) => a.role === 'teammate' && a.conversation_id);
  const canStart = Boolean(moderator) && panelists.length >= 1;
  const panelistBriefs: PanelistBrief[] = panelists.map((p) => ({ name: p.agent_name }));
  const teamSlotIds = new Set(team.agents.map((a) => a.slot_id));

  const commit = useCallback(
    (partial: Partial<MeetingState>) => {
      const next: MeetingState = { ...stateRef.current, ...partial, revision: stateRef.current.revision + 1 };
      stateRef.current = next;
      const store = readStore();
      store[team.id] = {
        phase: next.phase,
        runState: next.runState,
        topic: next.topic,
        options: next.options,
        decidedOptionId: next.decidedOptionId,
      };
      writeStore(store);
      setVersion((v) => v + 1);
    },
    [team.id]
  );

  const ensureWarm = useCallback((): Promise<void> => {
    if (!warmupRef.current) {
      warmupRef.current = ipcBridge.team.ensureSession.invoke({ team_id: team.id }).catch(() => {
        warmupRef.current = null;
      });
    }
    return warmupRef.current ?? Promise.resolve();
  }, [team.id]);

  // Accumulate streamed assistant text per conversation so the leader's final
  // summary is available for option parsing when the run completes.
  useEffect(() => {
    const conversationIds = new Set(team.agents.map((a) => a.conversation_id).filter(Boolean));
    if (conversationIds.size === 0) return;
    const unsub = ipcBridge.conversation.responseStream.on((payload) => {
      if (!conversationIds.has(payload.conversation_id)) return;
      const transformed = transformMessage(payload) as TMessage | undefined;
      if (!transformed || transformed.type !== 'text' || transformed.position !== 'left') return;
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
    return () => unsub();
  }, [team.agents]);

  // Drive the meeting from the backend team_run lifecycle.
  useEffect(() => {
    const onRun = (e: ITeamRunEvent) => {
      if (e.team_id !== team.id) return;
      if (e.team_run_id && stateRef.current.runId !== e.team_run_id) commit({ runId: e.team_run_id });
    };
    const finishRun = () => {
      if (stateRef.current.phase !== 'running') return;
      // Find the leader's final summary and parse decision options from it.
      let options = moderator
        ? parseResolutionOptions(latestTextRef.current.get(moderator.conversation_id)?.text ?? '')
        : [];
      if (options.length === 0) {
        for (const { text } of latestTextRef.current.values()) {
          const parsed = parseResolutionOptions(text);
          if (parsed.length) {
            options = parsed;
            break;
          }
        }
      }
      commit({ phase: 'resolution', runState: 'awaiting_decision', activeSlotId: null, options });
    };

    const unsubs = [
      ipcBridge.team.runAccepted.on(onRun),
      ipcBridge.team.runStarted.on(onRun),
      ipcBridge.team.runUpdated.on(onRun),
      ipcBridge.team.childTurnStarted.on((e: ITeamChildTurnEvent) => {
        if (e.team_id !== team.id || !teamSlotIds.has(e.slot_id)) return;
        if (e.team_run_id && stateRef.current.runId !== e.team_run_id)
          commit({ runId: e.team_run_id, activeSlotId: e.slot_id });
        else commit({ activeSlotId: e.slot_id });
      }),
      ipcBridge.team.childTurnCompleted.on((e: ITeamChildTurnEvent) => {
        if (e.team_id !== team.id) return;
        const active = stateRef.current.activeSlotId;
        commit({
          turnsCompleted: stateRef.current.turnsCompleted + 1,
          activeSlotId: e.slot_id === active ? null : active,
        });
      }),
      ipcBridge.team.runCompleted.on((e: ITeamRunEvent) => {
        if (e.team_id !== team.id) return;
        finishRun();
      }),
      ipcBridge.team.runFailed.on((e: ITeamRunEvent) => {
        if (e.team_id !== team.id) return;
        commit({ phase: 'resolution', runState: 'awaiting_decision', activeSlotId: null });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [team.id, commit, moderator, teamSlotIds]);

  // Warm the team session when the meeting view mounts.
  useEffect(() => {
    void ensureWarm();
  }, [ensureWarm]);

  // ---- public actions ---------------------------------------------------

  const startMeeting = (topic: string) => {
    const trimmed = topic.trim();
    if (!trimmed || !moderator) return;
    latestTextRef.current.clear();
    commit({
      phase: 'running',
      runState: 'running',
      topic: trimmed,
      runId: null,
      activeSlotId: null,
      turnsCompleted: 0,
      options: [],
      decidedOptionId: null,
    });
    void ensureWarm().then(() =>
      ipcBridge.team.sendTeamMessage.invoke({ team_id: team.id, input: buildTeamRunTask(trimmed, panelistBriefs) })
    );
  };

  const interject = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    void ensureWarm().then(() =>
      ipcBridge.team.sendTeamMessage.invoke({ team_id: team.id, input: `[老板插话] ${trimmed}` })
    );
  };

  const cancel = () => {
    const runId = stateRef.current.runId;
    if (runId) void ipcBridge.team.cancelRun.invoke({ team_id: team.id, team_run_id: runId }).catch(() => {});
    commit({ phase: 'idle', runState: 'stopped', activeSlotId: null, runId: null });
  };

  const decide = (optionId: string) => {
    commit({ decidedOptionId: optionId, phase: 'decided', runState: 'stopped', activeSlotId: null });
  };

  const reset = () => {
    const runId = stateRef.current.runId;
    if (runId && stateRef.current.phase === 'running')
      void ipcBridge.team.cancelRun.invoke({ team_id: team.id, team_run_id: runId }).catch(() => {});
    latestTextRef.current.clear();
    commit({ ...EMPTY_MEETING_STATE });
  };

  return { state: stateRef.current, moderator, panelists, canStart, startMeeting, interject, cancel, decide, reset };
}
