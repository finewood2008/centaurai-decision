// Renderer-side types for the team "meeting" (AI roundtable) mode.
//
// As of aioncore 0.1.29 the team is orchestrated by the BACKEND: we post the
// topic to the team (`/api/teams/:id/messages`), the leader runs a roundtable
// among the teammates via mailboxes, and the backend streams `team.run*` /
// `team.childTurn*` events. The meeting UI is a VIEW over that run plus the
// boss's decision step — it no longer drives turns itself.

/** Coarse meeting phase, derived from the backend team_run lifecycle. */
export type MeetingPhase =
  | 'idle' // no run; boss picks a topic
  | 'running' // team_run in progress (agents debating)
  | 'resolution' // run finished; options on the table for the boss
  | 'decided'; // boss picked an option

/**
 * Discussion format — each is a different strategy for squeezing higher quality
 * out of a heterogeneous panel of agents. Encoded as the team_run leader task.
 */
export type MeetingForm =
  | 'roundtable' // multi-angle debate + rebuttal
  | 'redteam' // one drafts, others red-team, then revise
  | 'tournament' // each agent produces a full plan → judged → synthesized
  | 'diverge' // independent divergence → cluster → converge
  | 'department'; // Decision edition: data-driven preset-department flow (phases from presetDepartments.ts)

/** A candidate solution the boss can pick from at the resolution stage. */
export type MeetingResolutionOption = {
  id: string;
  title: string;
  /** Core idea, pros, cons/risk, fit. Markdown allowed. */
  body: string;
};

export type MeetingRunState = 'stopped' | 'running' | 'awaiting_decision';

/** Live status of a participant's turn in the debate. */
export type MeetingTurnStatus = 'speaking' | 'done' | 'error';

/**
 * One participant's turn in the CentaurAI-orchestrated roundtable. EVERY agent —
 * team-capable (claude/codex/aionrs) AND non-team-capable (openclaw/hermes) — is
 * an equal expert here; each is driven as a single-turn ACP conversation by the
 * renderer-side moderator loop, and its streamed reply becomes one transcript turn.
 */
export type MeetingTurn = {
  /** Unique per turn. */
  id: string;
  /** slot_id (team member) or extra participant id (openclaw/hermes). */
  participantId: string;
  name: string;
  icon?: string;
  agent_type: string;
  isModerator: boolean;
  /** Which phase this turn belongs to: 开场 / 立论 / 交锋 / 收敛 / 综合. */
  phaseLabel: string;
  /** Streamed reply text so far. */
  text: string;
  status: MeetingTurnStatus;
};

/** Live + persisted meeting state for one team. */
export type MeetingState = {
  phase: MeetingPhase;
  runState: MeetingRunState;
  /** The boss's question. */
  topic: string;
  /** Chosen discussion format for the session. */
  form: MeetingForm;
  /** Preset department id (Decision edition, when form==='department') — drives the phases. */
  departmentId?: string;
  /** Synthesized 方案书 (markdown) produced by the synthesizer at the end. */
  plan: string;
  /** Backend team_run id (needed to cancel). */
  runId: string | null;
  /** slot_id of the agent currently holding a child turn, or null. */
  activeSlotId: string | null;
  /** Completed child turns so far (progress indicator). */
  turnsCompleted: number;
  /** Candidate options parsed from the leader's final summary. */
  options: MeetingResolutionOption[];
  /** id of the option the boss picked, or null. */
  decidedOptionId: string | null;
  /** The live debate transcript — one turn per participant statement (all equal experts). */
  transcript: MeetingTurn[];
  /**
   * True when the moderator has summarized a round and the discussion is PAUSED,
   * waiting for the boss to read / interject and click 继续讨论. Live-only (not persisted).
   */
  awaitingContinue: boolean;
  /**
   * Workspace path of the auto-archived 方案书 (.md) once the meeting concludes.
   * The file lands in the team's 临时空间 file tree and syncs to the Content Hub.
   */
  archivedPath: string | null;
  /** Monotonic counter — bumped on every state change to drive re-renders. */
  revision: number;
};

/** A finished meeting saved to "我的会议" history for revisiting its 方案书. */
export type MeetingRecord = {
  id: string;
  topic: string;
  form: MeetingForm;
  plan: string;
  options: MeetingResolutionOption[];
  /** epoch ms */
  ts: number;
};

export const EMPTY_MEETING_STATE: MeetingState = {
  phase: 'idle',
  runState: 'stopped',
  topic: '',
  form: 'roundtable',
  plan: '',
  runId: null,
  activeSlotId: null,
  turnsCompleted: 0,
  options: [],
  decidedOptionId: null,
  transcript: [],
  awaitingContinue: false,
  archivedPath: null,
  revision: 0,
};
