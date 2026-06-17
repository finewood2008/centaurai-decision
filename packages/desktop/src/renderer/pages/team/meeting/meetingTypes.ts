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

/** A candidate solution the boss can pick from at the resolution stage. */
export type MeetingResolutionOption = {
  id: string;
  title: string;
  /** Core idea, pros, cons/risk, fit. Markdown allowed. */
  body: string;
};

export type MeetingRunState = 'stopped' | 'running' | 'awaiting_decision';

/** Live + persisted meeting state for one team. */
export type MeetingState = {
  phase: MeetingPhase;
  runState: MeetingRunState;
  /** The boss's question. */
  topic: string;
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
  /** Monotonic counter — bumped on every state change to drive re-renders. */
  revision: number;
};

export const EMPTY_MEETING_STATE: MeetingState = {
  phase: 'idle',
  runState: 'stopped',
  topic: '',
  runId: null,
  activeSlotId: null,
  turnsCompleted: 0,
  options: [],
  decidedOptionId: null,
  revision: 0,
};
