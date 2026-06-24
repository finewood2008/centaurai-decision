import { useEffect, useState } from 'react';
import { mutate as globalMutate } from 'swr';
import { Message } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { retrieveKnowledgeContext } from '@/renderer/services/knowledgeBaseSearch';
import { emitter } from '@/renderer/utils/emitter';
import type { IConversationTurnCompletedEvent, IResponseMessage } from '@/common/adapter/ipcBridge';
import { joinPath, transformMessage } from '@/common/chat/chatLib';
import type { TMessage, IMessageText } from '@/common/chat/chatLib';
import type { TTeam, TeamAgent } from '@/common/types/team/teamTypes';
import { buildCliAgentParams } from '@/renderer/pages/conversation/utils/createConversationParams';
import { getAgents } from '@/renderer/hooks/agent/useAgents';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import {
  EMPTY_MEETING_STATE,
  type MeetingForm,
  type MeetingRecord,
  type MeetingResolutionOption,
  type MeetingState,
  type MeetingTurn,
} from './meetingTypes';
import { decisionDocxBase64, decisionFileName } from '@/renderer/services/meetingPlanDocx';
import {
  addGuest as storeAddGuest,
  readGuests,
  removeGuest as storeRemoveGuest,
  type MeetingGuest,
} from './meetingGuests';
import {
  PANEL_LENSES,
  buildClusterPrompt,
  buildConvergePrompt,
  buildDivergePrompt,
  buildDraftPrompt,
  buildExportTask,
  buildLocalSynthesisPrompt,
  buildModeratorOpeningPrompt,
  buildPanelistDebatePrompt,
  buildPanelistPositionPrompt,
  buildProposalPrompt,
  buildRedTeamPrompt,
  buildReferenceContext,
  buildRevisePrompt,
  buildRoundPausePrompt,
  parsePlan,
  parseResolutionOptions,
  stripResolutionMarkers,
  type PanelistBrief,
} from './meetingPrompts';

const STORAGE_KEY = 'team-meeting-state';
const HISTORY_KEY = 'team-meeting-history';
/** Per-turn safety timeout for a single agent's ACP reply, ms. */
const TURN_TIMEOUT_MS = 5 * 60 * 1000;
/** Keep the most recent N meetings per team in "我的会议". */
const HISTORY_LIMIT = 30;

/** One participant in the renderer-orchestrated debate — every agent is an equal expert. */
type Participant = {
  /** slot_id (team member) or extra participant id (openclaw/hermes/直连模型专家). */
  id: string;
  name: string;
  icon?: string;
  agent_type: string;
  isModerator: boolean;
  conversationId: string;
};

type StoredMap = Record<string, Partial<MeetingState>>;
type HistoryMap = Record<string, MeetingRecord[]>;

export type StartMeetingOptions = {
  /** Retrieve the local knowledge base for the topic and fold it into the brief. */
  useKnowledgeBase?: boolean;
  /** Local paths of shared-library files to hand the panel as reference material. */
  attachments?: string[];
  /** Discussion format for this session; falls back to the current state form. */
  form?: MeetingForm;
};

export type MeetingOrchestrator = {
  state: MeetingState;
  moderator: TeamAgent | null;
  panelists: TeamAgent[];
  /** Side-channel guest panelists (non-team-capable backends + 直连模型专家). */
  guests: MeetingGuest[];
  /** True when the team has a moderator + at least one panelist. */
  canStart: boolean;
  /** Past meetings for this team ("我的会议"). */
  history: MeetingRecord[];
  startMeeting: (topic: string, opts?: StartMeetingOptions) => void;
  /** Boss interjects mid-run; surfaced as a transcript turn the moderator will see. */
  interject: (text: string) => void;
  /** Resume the next round after a between-round pause (boss clicks 继续讨论). */
  continueMeeting: () => void;
  /** Cancel the in-flight debate. */
  cancel: () => void;
  /** Boss picks a final option. */
  decide: (optionId: string) => void;
  /** Ask the leader to archive the 方案书 as docx/pptx/md into the Content Hub. */
  exportPlan: () => boolean;
  /** Reopen a past meeting's 方案书 from history. */
  openRecord: (rec: MeetingRecord) => void;
  /** Invite a non-team-capable agent / 直连模型专家 as an extra expert. */
  addGuest: (guest: MeetingGuest) => void;
  /** Remove an extra expert by id. */
  removeGuest: (guest_id: string) => void;
  /** Tear the meeting down (cancels any live run). */
  reset: () => void;
};

// ---- persistence helpers ---------------------------------------------------

function readHistory(team_id: string): MeetingRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as HistoryMap) : {};
    return Array.isArray(parsed[team_id]) ? parsed[team_id] : [];
  } catch {
    return [];
  }
}

/** Public reader for the workspace-sider "会议产出" list (one team's records). */
export function readMeetingHistory(team_id: string): MeetingRecord[] {
  return readHistory(team_id);
}

function appendHistory(team_id: string, record: MeetingRecord): void {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as HistoryMap) : {};
    const list = Array.isArray(parsed[team_id]) ? parsed[team_id] : [];
    parsed[team_id] = [record, ...list].slice(0, HISTORY_LIMIT);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(parsed));
    emitter.emit('meeting.outputs.changed');
  } catch {
    // ignore quota errors
  }
}

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

/**
 * Hydrate persisted meeting state for a COLD engine (first visit this session, or
 * after an app reload). A run that was live when the app last closed can't be
 * resumed — its renderer loop is gone — so we park it back to idle. Within a
 * session this never runs on navigation, because the in-memory engine is reused.
 */
function hydrate(team_id: string, teamName: string): MeetingState {
  const stored = readStore()[team_id];
  const base: MeetingState = stored ? { ...EMPTY_MEETING_STATE, ...stored, revision: 0 } : { ...EMPTY_MEETING_STATE };
  if (base.phase === 'running') return { ...EMPTY_MEETING_STATE, topic: base.topic || teamName };
  if (!base.topic) base.topic = teamName;
  return base;
}

// ---- global stream routing -------------------------------------------------
// A SINGLE responseStream listener routes each chunk to whichever engine owns
// that conversation's current turn. This keeps exactly one global listener no
// matter how many team engines are alive across the session.
const STREAM_ROUTES = new Map<string, MeetingEngine>();
let streamListenerAttached = false;

function ensureStreamListener(): void {
  if (streamListenerAttached) return;
  streamListenerAttached = true;
  ipcBridge.conversation.responseStream.on((payload) => {
    const engine = STREAM_ROUTES.get(payload.conversation_id);
    if (engine) engine.handleStream(payload);
  });
}

/**
 * The meeting orchestration engine for ONE team. It lives at module scope (in
 * the registry below), NOT inside a React component, so a running roundtable
 * keeps going when the user navigates away from the team page and is shown
 * exactly as-is when they navigate back — no interruption, no reset.
 *
 * The React hook (`useMeetingOrchestrator`) is a thin subscriber: it forces a
 * re-render whenever the engine commits new state, and forwards the latest
 * `team` snapshot in. Unmounting only unsubscribes; it never cancels the run.
 */
class MeetingEngine {
  private team: TTeam;
  private state: MeetingState;
  private readonly subscribers = new Set<() => void>();

  private warmup: Promise<void> | null = null;

  /** Extra participants (non-team-capable backends + 直连模型专家), persisted per team. */
  private extras: MeetingGuest[];
  /** conversation_id → current turn id (routes streamed chunks); turn id → accumulated text. */
  private readonly turnConv = new Map<string, string>();
  private readonly turnText = new Map<string, string>();
  private readonly loopUnsubs: Array<() => void> = [];
  /** Monotonic run id; bumped on start/cancel/reset so a stale loop frame goes inert. */
  private runSeq = 0;
  private running = false;
  /** Tear down the ACTIVE run's fresh conversations (set while a run is live). */
  private activeTeardown: ((stop: boolean) => void) | null = null;
  /** Resolves the between-round PAUSE when the boss clicks 继续讨论 (or the run is torn down). */
  private continueGate: (() => void) | null = null;

  constructor(team: TTeam) {
    this.team = team;
    this.state = hydrate(team.id, team.name);
    this.extras = readGuests(team.id);
    ensureStreamListener();
  }

  // ---- subscription + team snapshot ----------------------------------------

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private notify(): void {
    this.subscribers.forEach((cb) => cb());
  }

  /** Keep the engine's `team` snapshot current (called from the hook each render). */
  updateTeam(team: TTeam): void {
    this.team = team;
  }

  hasSubscribers(): boolean {
    return this.subscribers.size > 0;
  }

  isRunning(): boolean {
    return this.running;
  }

  private get moderator(): TeamAgent | null {
    return this.team.agents.find((a) => a.role === 'leader' && a.conversation_id) ?? null;
  }

  private get teamPanelists(): TeamAgent[] {
    return this.team.agents.filter((a) => a.role === 'teammate' && a.conversation_id);
  }

  private get canStart(): boolean {
    return Boolean(this.moderator) && this.teamPanelists.length + this.extras.length >= 1;
  }

  // ---- state commit --------------------------------------------------------

  private commit(partial: Partial<MeetingState>): void {
    const next: MeetingState = { ...this.state, ...partial, revision: this.state.revision + 1 };
    this.state = next;
    const store = readStore();
    store[this.team.id] = {
      phase: next.phase,
      runState: next.runState,
      topic: next.topic,
      form: next.form,
      plan: next.plan,
      options: next.options,
      decidedOptionId: next.decidedOptionId,
    };
    writeStore(store);
    this.notify();
  }

  ensureWarm = (): Promise<void> => {
    if (!this.warmup) {
      this.warmup = ipcBridge.team.ensureSession
        .invoke({ team_id: this.team.id })
        // A freshly created team's first GET can race agent provisioning, leaving
        // empty conversation_ids (→ canStart stays false → auto-start never fires).
        // Refetch the team once the session is warm so canStart flips true.
        .then(() => {
          void globalMutate(`team/${this.team.id}`);
        })
        .catch(() => {
          this.warmup = null;
        });
    }
    return this.warmup ?? Promise.resolve();
  };

  /**
   * Auto-archive the synthesized 方案书 as a markdown file into the team's
   * workspace, which the Content Hub also indexes. Returns the written path or null.
   */
  private async archivePlan(planText: string, topic: string): Promise<string | null> {
    const moderator = this.moderator;
    if (!planText.trim() || !moderator) return null;
    try {
      const conv = await ipcBridge.conversation.get.invoke({ id: moderator.conversation_id });
      const workspace = this.team.workspace || (conv?.extra as { workspace?: string } | undefined)?.workspace;
      if (!workspace) return null;
      const safe =
        (topic || '方案书')
          .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40) || '方案书';
      const path = joinPath(workspace, `${safe}_方案书.md`);
      const header = `# ${topic || '方案书'}\n\n> 智囊团产出 · ${new Date().toLocaleString('zh-CN')}\n\n`;
      const ok = await ipcBridge.fs.writeFile.invoke({ path, data: header + planText });
      if (!ok) return null;
      emitter.emit('acp.workspace.refresh');
      emitter.emit('codex.workspace.refresh');
      emitter.emit('aionrs.workspace.refresh');
      return path;
    } catch {
      return null;
    }
  }

  /** The team workspace (where archives land → Content Hub), or null. */
  private async resolveWorkspace(): Promise<string | null> {
    if (this.team.workspace) return this.team.workspace;
    const moderator = this.moderator;
    if (!moderator) return null;
    try {
      const conv = await ipcBridge.conversation.get.invoke({ id: moderator.conversation_id });
      return (conv?.extra as { workspace?: string } | undefined)?.workspace ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Generate a well-formatted Word (.docx) of the 方案书 with the boss's chosen
   * option highlighted, and write it to the team workspace (→ Content Hub), falling
   * back to the Downloads folder. Blob downloads are dropped by this app and the
   * aioncore fs.write is text-only, so we route bytes through the Electron main IPC.
   */
  private async exportDecisionDocx(decision: MeetingResolutionOption | null): Promise<void> {
    const topic = this.state.topic;
    const plan = this.state.plan;
    if (!plan.trim()) return;
    try {
      Message.info('正在生成 Word 决策文档…');
      const base64 = await decisionDocxBase64({
        topic,
        teamName: this.team.name,
        plan,
        decision,
        dateLabel: new Date().toLocaleDateString('zh-CN'),
      });
      const fileName = decisionFileName(topic, this.team.name);
      let dir = await this.resolveWorkspace();
      const inWorkspace = Boolean(dir);
      if (!dir) {
        try {
          const downloads = await ipcBridge.application.getPath.invoke({ name: 'downloads' });
          dir = typeof downloads === 'string' && downloads ? downloads : null;
        } catch {
          dir = null;
        }
      }
      if (!dir) {
        Message.error('生成 Word 文档失败：未找到保存位置');
        return;
      }
      const res = await ipcBridge.application.saveBinaryFile.invoke({ dir, fileName, base64 });
      if (res?.success && res.data?.path) {
        if (inWorkspace) {
          emitter.emit('acp.workspace.refresh');
          emitter.emit('codex.workspace.refresh');
          emitter.emit('aionrs.workspace.refresh');
          Message.success(`已生成 Word 决策文档：${fileName}（已存入内容中心）`);
        } else {
          Message.success(`已生成 Word 决策文档：${fileName}（已保存到下载文件夹）`);
        }
      } else {
        Message.error(`生成 Word 文档失败${res?.msg ? '：' + res.msg : ''}`);
      }
    } catch {
      Message.error('生成 Word 文档失败');
    }
  }

  // ---- transcript turns ----------------------------------------------------

  private updateTurn(turnId: string, patch: Partial<MeetingTurn>): void {
    const transcript = this.state.transcript.map((t) => (t.id === turnId ? { ...t, ...patch } : t));
    this.commit({ transcript });
  }

  /** Append a fresh "speaking" turn for a participant; returns its id. */
  private addTurn(p: Participant, phaseLabel: string): string {
    const id = `t-${this.state.transcript.length}-${p.id}`;
    const turn: MeetingTurn = {
      id,
      participantId: p.id,
      name: p.name,
      icon: p.icon,
      agent_type: p.agent_type,
      isModerator: p.isModerator,
      phaseLabel,
      text: '',
      status: 'speaking',
    };
    this.commit({ transcript: [...this.state.transcript, turn], activeSlotId: p.id });
    return id;
  }

  /** Route a streamed chunk (from the global listener) into the matching turn. */
  handleStream(payload: IResponseMessage): void {
    const turnId = this.turnConv.get(payload.conversation_id);
    if (!turnId) return;
    const transformed = transformMessage(payload) as TMessage | undefined;
    if (!transformed || transformed.type !== 'text' || transformed.position !== 'left') return;
    const chunk = (transformed as IMessageText).content?.content;
    if (typeof chunk !== 'string') return;
    const replace = Boolean((transformed as IMessageText).content?.replace) || Boolean(payload.replace);
    const prev = this.turnText.get(turnId) ?? '';
    const next = replace ? chunk : prev + chunk;
    this.turnText.set(turnId, next);
    this.updateTurn(turnId, { text: next, status: 'speaking' });
  }

  /**
   * Drive one participant's single ACP turn: send the prompt, stream chunks into the
   * given transcript turn, resolve with the final text on completion. OpenClaw/Hermes
   * send no `last_message.content`, so we fall back to the streamed text.
   */
  private askTurn(conversationId: string, turnId: string, prompt: string): Promise<string> {
    return new Promise<string>((resolve) => {
      let settled = false;
      this.turnConv.set(conversationId, turnId);
      this.turnText.set(turnId, '');
      STREAM_ROUTES.set(conversationId, this);
      const finish = (text: string) => {
        if (settled) return;
        settled = true;
        off();
        clearTimeout(timer);
        this.turnConv.delete(conversationId);
        STREAM_ROUTES.delete(conversationId);
        resolve(text.trim());
      };
      const off = ipcBridge.conversation.turnCompleted.on((event: IConversationTurnCompletedEvent) => {
        if (event.session_id !== conversationId) return;
        if (!(event.status === 'finished' || event.can_send_message === true)) return;
        const c = event.last_message?.content;
        finish(typeof c === 'string' && c.trim() ? c : (this.turnText.get(turnId) ?? ''));
      });
      const timer = setTimeout(() => finish(this.turnText.get(turnId) ?? ''), TURN_TIMEOUT_MS);
      // A single cleanup that SETTLES the promise (finish also removes the listener +
      // timer + route), so cancel()/reset() can't orphan a pending turn — the awaiting
      // runLocalMeeting frame unwinds and hits its staleness guard.
      this.loopUnsubs.push(() => finish(this.turnText.get(turnId) ?? ''));
      void ipcBridge.conversation.sendMessage
        .invoke({ conversation_id: conversationId, input: prompt })
        .catch(() => finish(this.turnText.get(turnId) ?? ''));
    });
  }

  /** Stop/remove a run's fresh hidden conversations and drop their stream routes. Idempotent. */
  private releaseConvs(convs: Map<string, string>, stop: boolean): void {
    for (const convId of convs.values()) {
      STREAM_ROUTES.delete(convId);
      if (stop) void ipcBridge.conversation.stop.invoke({ conversation_id: convId }).catch(() => {});
      void ipcBridge.conversation.remove.invoke({ id: convId }).catch(() => {});
    }
    convs.clear();
  }

  /**
   * Resolve every participant's conversation: a FRESH hidden one per participant,
   * tracked in a RUN-LOCAL map so each run owns and releases only its own. Aborts
   * (and cleans up what it created) if the run goes stale mid-build.
   */
  private async buildParticipants(
    myRun: number,
    convs: Map<string, string>
  ): Promise<{ mod: Participant; panel: Participant[] } | null> {
    const moderator = this.moderator;
    if (!moderator) return null;
    const stale = () => this.runSeq !== myRun;
    let metas: AgentMetadata[] = [];
    try {
      metas = await getAgents();
    } catch {
      metas = [];
    }
    // 直连模型专家 (e.g. SiliconFlow 国产模型) pin a specific provider model, so we
    // need the live provider list to rebuild the aionrs model descriptor.
    let providers: IProvider[] = [];
    if (this.extras.some((e) => e.provider_id)) {
      try {
        providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
      } catch {
        providers = [];
      }
    }

    // EVERY participant — team-capable (claude/codex/aionrs) AND openclaw/hermes/直连模型 —
    // is driven through a FRESH standalone conversation. Reusing a team member's own
    // conversation routes its turns through team_run events (not plain
    // conversation.turnCompleted), so it would never reply here. The fresh conversation
    // is tagged `extra.team_id` so it stays OUT of the normal 对话 list, and is removed
    // when the meeting ends.
    const make = async (src: {
      id: string;
      name: string;
      icon?: string;
      agent_type: string;
      model?: string;
      provider_id?: string;
      model_name?: string;
      isModerator: boolean;
    }): Promise<Participant | null> => {
      const meta = metas.find((m) => (m.backend ?? m.agent_type) === src.agent_type);
      if (!meta) return null;
      try {
        const params = await buildCliAgentParams(meta, this.team.workspace || '');
        params.name = `${src.isModerator ? '主持人' : '专家'}·${src.name}`;
        params.extra = { ...params.extra, team_id: this.team.id };
        if (src.provider_id && src.model_name) {
          const provider = providers.find((p) => p.id === src.provider_id);
          if (provider) {
            params.model = { ...provider, use_model: src.model_name } as TProviderWithModel;
          }
        } else if (src.model && src.model !== 'default') {
          params.extra.current_model_id = src.model;
        }
        const conv = await ipcBridge.conversation.create.invoke(params);
        if (!conv?.id) return null;
        convs.set(src.id, conv.id);
        return {
          id: src.id,
          name: src.name,
          icon: src.icon,
          agent_type: src.agent_type,
          isModerator: src.isModerator,
          conversationId: conv.id,
        };
      } catch {
        return null;
      }
    };

    const mod = await make({
      id: moderator.slot_id,
      name: moderator.agent_name,
      icon: moderator.icon,
      agent_type: moderator.agent_type,
      model: moderator.model,
      isModerator: true,
    });
    if (!mod || stale()) {
      this.releaseConvs(convs, true);
      return null;
    }
    const panel: Participant[] = [];
    for (const a of this.teamPanelists) {
      if (stale()) break;
      const p = await make({
        id: a.slot_id,
        name: a.agent_name,
        icon: a.icon,
        agent_type: a.agent_type,
        model: a.model,
        isModerator: false,
      });
      if (p) panel.push(p);
    }
    for (const ex of this.extras) {
      if (stale()) break;
      const p = await make({
        id: ex.id,
        name: ex.agent_name,
        icon: ex.icon,
        agent_type: ex.agent_type,
        provider_id: ex.provider_id,
        model_name: ex.model_name,
        isModerator: false,
      });
      if (p) panel.push(p);
    }
    if (stale()) {
      this.releaseConvs(convs, true);
      return null;
    }
    return { mod, panel };
  }

  /**
   * Pause the debate after a round: mark `awaitingContinue` and resolve only when the
   * boss clicks 继续讨论 (continueMeeting) OR the run is torn down (cancel/reset/start,
   * which drains loopUnsubs). Lets the boss read at their own pace and feel involved.
   */
  private waitForContinue(myRun: number): Promise<void> {
    if (this.runSeq !== myRun) return Promise.resolve();
    this.commit({ awaitingContinue: true, activeSlotId: null });
    return new Promise<void>((resolve) => {
      this.continueGate = resolve;
      // cancel()/reset()/startMeeting() drain loopUnsubs → resolve() (idempotent) so the
      // paused frame unwinds and hits its stale() guard.
      this.loopUnsubs.push(resolve);
    });
  }

  /**
   * The renderer-side moderated debate. Drives moderator + all panelists as equal
   * single-turn experts: opening → round 1 (立论) → PAUSE → round 2 (交锋) → PAUSE →
   * synthesis. Every turn streams into the transcript; the boss reads + continues
   * between rounds. Cancellable between turns and during pauses.
   */
  private async runLocalMeeting(myRun: number, topic: string, form: MeetingForm, reference?: string): Promise<void> {
    const stale = () => this.runSeq !== myRun;
    // A run that was already superseded must not touch shared state — nothing is
    // created yet, so just bail (otherwise it would clobber the live run's teardown).
    if (stale()) return;
    // This run's own conversation map. Wire teardown to it BEFORE the build so a
    // cancel during the build window can still stop+remove whatever's created so far.
    const convs = new Map<string, string>();
    this.activeTeardown = (stop: boolean) => this.releaseConvs(convs, stop);
    try {
      const parts = await this.buildParticipants(myRun, convs);
      if (!parts || stale()) return;
      const { mod, panel } = parts;
      // Assign each panelist a DISTINCT angle (round-robin) so the debate has real
      // perspective diversity instead of everyone saying the same thing.
      const lensByPanel = new Map(panel.map((p, i) => [p.id, PANEL_LENSES[i % PANEL_LENSES.length]]));
      const briefs: PanelistBrief[] = panel.map((p) => ({ name: p.name, lens: lensByPanel.get(p.id) }));
      const transcriptText = () =>
        this.state.transcript
          .filter((t) => t.text.trim())
          .map((t) => `${t.name}（${t.phaseLabel}）：${t.text}`)
          .join('\n\n');
      const speak = async (p: Participant, label: string, prompt: string): Promise<void> => {
        if (stale()) return;
        const tid = this.addTurn(p, label);
        const text = await this.askTurn(p.conversationId, tid, prompt);
        if (stale()) return;
        this.updateTurn(tid, { text, status: text ? 'done' : 'error' });
        this.commit({ turnsCompleted: this.state.turnsCompleted + 1, activeSlotId: null });
      };

      // 1) Moderator opens — addressed to the boss, frames the real tension (+ optional 背景资料).
      const openingPrompt = reference
        ? `${buildModeratorOpeningPrompt(topic, briefs)}\n\n${reference}\n\n请在开场时简要提示专家们参考上述背景资料。`
        : buildModeratorOpeningPrompt(topic, briefs);
      await speak(mod, '开场', openingPrompt);
      // 2) Form-specific middle phases. Every form reuses speak / transcriptText /
      //    the moderator recap + PAUSE (boss reads, optionally interjects, clicks
      //    继续讨论), so the meeting is paced like a real one regardless of format.
      const pauseAndWait = async (round: number, stage: string): Promise<boolean> => {
        if (!stale()) {
          await speak(mod, '阶段小结', buildRoundPausePrompt({ topic, round, stage, recentContext: transcriptText() }));
        }
        await this.waitForContinue(myRun);
        return !stale();
      };
      const eachPanelist = async (label: string, prompt: (p: Participant) => string): Promise<void> => {
        for (const p of panel) {
          if (stale()) break;
          await speak(p, label, prompt(p));
        }
      };

      if (form === 'redteam') {
        // 起草 → 红队攻击 →(暂停)→ 修订
        const drafter = panel[0];
        const redTeam = panel.slice(1);
        await speak(drafter, '起草', buildDraftPrompt({ topic, persona: drafter.name, reference }));
        for (const p of redTeam) {
          if (stale()) break;
          await speak(
            p,
            '红队',
            buildRedTeamPrompt({ topic, persona: p.name, lens: lensByPanel.get(p.id), draftContext: transcriptText() })
          );
        }
        if (redTeam.length > 0) {
          if (!(await pauseAndWait(1, '红队攻击'))) return;
          await speak(
            drafter,
            '修订',
            buildRevisePrompt({ topic, persona: drafter.name, critiqueContext: transcriptText() })
          );
        }
      } else if (form === 'tournament') {
        // 各自提案 →(暂停)→（合成阶段由主持人评审打分+嫁接）
        await eachPanelist('提案', (p) =>
          buildProposalPrompt({ topic, persona: p.name, lens: lensByPanel.get(p.id), reference })
        );
        if (!(await pauseAndWait(1, '提案'))) return;
      } else if (form === 'diverge') {
        // 发散 → 主持人聚类 →(暂停)→ 收敛
        await eachPanelist('发散', (p) => buildDivergePrompt({ topic, persona: p.name, lens: lensByPanel.get(p.id) }));
        if (!stale()) {
          await speak(mod, '聚类', buildClusterPrompt({ topic, ideasContext: transcriptText() }));
        }
        if (!(await pauseAndWait(1, '发散'))) return;
        await eachPanelist('收敛', (p) =>
          buildConvergePrompt({
            topic,
            persona: p.name,
            lens: lensByPanel.get(p.id),
            clustersContext: transcriptText(),
          })
        );
        if (!(await pauseAndWait(2, '收敛'))) return;
      } else {
        // roundtable (default): 立论 →(暂停)→ 交锋 →(暂停)
        await eachPanelist('立论', (p) =>
          buildPanelistPositionPrompt({
            topic,
            persona: p.name,
            lens: lensByPanel.get(p.id),
            priorContext: transcriptText(),
          })
        );
        if (!(await pauseAndWait(1, '立论'))) return;
        await eachPanelist('交锋', (p) =>
          buildPanelistDebatePrompt({
            topic,
            persona: p.name,
            lens: lensByPanel.get(p.id),
            round: 2,
            recentContext: transcriptText(),
          })
        );
        if (!(await pauseAndWait(2, '交锋'))) return;
      }

      // 4) Moderator synthesizes the 方案书 + decision options.
      if (!stale()) {
        const tid = this.addTurn(mod, '综合');
        const synth = await this.askTurn(mod.conversationId, tid, buildLocalSynthesisPrompt(topic, transcriptText()));
        if (stale()) return;
        this.updateTurn(tid, { text: synth, status: synth ? 'done' : 'error' });
        const options = parseResolutionOptions(synth);
        // When the model omits @@PLAN@@, fall back to the whole synthesis but strip the
        // machine option markers so the 方案书 (panel/copy/.md/Word export) stays clean.
        const plan = parsePlan(synth) || stripResolutionMarkers(synth);
        this.commit({ phase: 'resolution', runState: 'awaiting_decision', activeSlotId: null, options, plan });
        if (plan.trim() || options.length > 0) {
          const s = this.state;
          appendHistory(this.team.id, {
            id: `m-${Date.now()}`,
            topic: s.topic,
            form: s.form,
            plan,
            options,
            ts: Date.now(),
          });
        }
        if (plan.trim()) {
          void this.archivePlan(plan, this.state.topic).then((archivedPath) => {
            if (!stale() && archivedPath) this.commit({ archivedPath });
          });
        }
      }
    } finally {
      // Only the CURRENT run owns these flags; a superseded stale run must not touch them.
      if (!stale()) {
        this.running = false;
        this.activeTeardown = null;
      }
      // Release this run's own conversations (idempotent; cancel may have already).
      this.releaseConvs(convs, false);
    }
  }

  // ---- public actions ------------------------------------------------------

  startMeeting = (topic: string, opts?: StartMeetingOptions): void => {
    const trimmed = topic.trim();
    if (!trimmed || !this.moderator || this.running) return;
    // Claim the run SYNCHRONOUSLY (running is otherwise set deep inside the async
    // runLocalMeeting, so two starts could slip through the guard before it flips).
    this.running = true;
    // Bump + capture the generation HERE so a later start makes this run stale, and so
    // every runLocalMeeting frame carries its own distinct id.
    const myRun = ++this.runSeq;
    const form = opts?.form ?? this.state.form;
    const attachments = opts?.attachments ?? [];
    // Settle any pending turn/pause + reclaim leftover conversations, then start the debate.
    this.loopUnsubs.forEach((o) => o());
    this.loopUnsubs.length = 0;
    this.continueGate = null;
    this.activeTeardown?.(false);
    this.activeTeardown = null;
    this.turnConv.clear();
    this.turnText.clear();
    this.commit({
      phase: 'running',
      runState: 'running',
      topic: trimmed,
      form,
      runId: null,
      activeSlotId: null,
      turnsCompleted: 0,
      options: [],
      plan: '',
      decidedOptionId: null,
      transcript: [],
      awaitingContinue: false,
      archivedPath: null,
    });
    void this.ensureWarm()
      .then(async () => {
        // ensureWarm()'s promise is memoized, so a superseded start's .then still fires.
        // Bail if cancel/reset/another start has superseded this run (don't churn
        // conversations and don't reach runLocalMeeting for a stale run).
        if (this.runSeq !== myRun) return;
        let knowledgeContext: string | null = null;
        if (opts?.useKnowledgeBase) {
          try {
            knowledgeContext = (await retrieveKnowledgeContext(trimmed)).context;
            if (!knowledgeContext) Message.info('知识库中未找到相关内容，已按原始议题开会');
          } catch {
            Message.warning('知识库检索失败，请确认向量库服务已启动');
          }
        }
        if (this.runSeq !== myRun) return;
        const reference = buildReferenceContext(knowledgeContext, attachments) || undefined;
        return this.runLocalMeeting(myRun, trimmed, form, reference);
      })
      .catch(() => {
        // Only clear the flag if THIS run is still current (don't clobber a newer run).
        if (this.runSeq === myRun) this.running = false;
      });
  };

  interject = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `t-${this.state.transcript.length}-boss`;
    this.commit({
      transcript: [
        ...this.state.transcript,
        {
          id,
          participantId: 'boss',
          name: '老板',
          agent_type: 'boss',
          isModerator: false,
          phaseLabel: '插话',
          text: trimmed,
          status: 'done',
        },
      ],
    });
  };

  /** Boss clicks 继续讨论 during a between-round pause → resume the next round. */
  continueMeeting = (): void => {
    const gate = this.continueGate;
    if (!gate) return;
    this.continueGate = null;
    this.commit({ awaitingContinue: false });
    gate();
  };

  cancel = (): void => {
    this.runSeq++; // invalidate the active run; the awaiting frame unwinds via loopUnsubs
    this.loopUnsubs.forEach((o) => o());
    this.loopUnsubs.length = 0;
    this.continueGate = null;
    this.activeTeardown?.(true); // stop + remove this run's conversations
    this.activeTeardown = null;
    this.running = false;
    // Settle any turn still showing the "speaking" spinner (its streamed partial text
    // is kept; empty → 未发言), so the transcript doesn't spin forever after cancel.
    const transcript: MeetingTurn[] = this.state.transcript.map((t) =>
      t.status === 'speaking' ? { ...t, status: (t.text.trim() ? 'done' : 'error') as MeetingTurn['status'] } : t
    );
    this.commit({
      phase: 'idle',
      runState: 'stopped',
      activeSlotId: null,
      runId: null,
      transcript,
      awaitingContinue: false,
    });
  };

  decide = (optionId: string): void => {
    this.commit({ decidedOptionId: optionId, phase: 'decided', runState: 'stopped', activeSlotId: null });
    // Auto-generate a well-formatted Word doc of the final decision.
    const decision = this.state.options.find((o) => o.id === optionId) ?? null;
    void this.exportDecisionDocx(decision);
  };

  exportPlan = (): boolean => {
    const plan = this.state.plan;
    const moderator = this.moderator;
    if (!plan.trim() || !moderator) return false;
    void ipcBridge.conversation.sendMessage.invoke({
      conversation_id: moderator.conversation_id,
      input: buildExportTask(plan),
    });
    return true;
  };

  openRecord = (rec: MeetingRecord): void => {
    this.commit({
      phase: 'resolution',
      runState: 'awaiting_decision',
      topic: rec.topic,
      form: rec.form,
      plan: rec.plan,
      options: rec.options,
      decidedOptionId: null,
      activeSlotId: null,
      runId: null,
      archivedPath: null,
    });
  };

  addGuest = (guest: MeetingGuest): void => {
    this.extras = storeAddGuest(this.team.id, guest);
    this.notify();
  };

  removeGuest = (guest_id: string): void => {
    this.extras = storeRemoveGuest(this.team.id, guest_id);
    this.notify();
  };

  reset = (): void => {
    this.runSeq++; // invalidate the active run; the awaiting frame unwinds via loopUnsubs
    this.loopUnsubs.forEach((o) => o());
    this.loopUnsubs.length = 0;
    this.continueGate = null;
    this.activeTeardown?.(false); // remove this run's conversations (reset = remove only)
    this.activeTeardown = null;
    this.turnConv.clear();
    this.turnText.clear();
    this.running = false;
    this.commit({ ...EMPTY_MEETING_STATE, form: this.state.form });
  };

  getOrchestrator(): MeetingOrchestrator {
    return {
      state: this.state,
      moderator: this.moderator,
      panelists: this.teamPanelists,
      guests: this.extras,
      canStart: this.canStart,
      history: readHistory(this.team.id),
      startMeeting: this.startMeeting,
      interject: this.interject,
      continueMeeting: this.continueMeeting,
      cancel: this.cancel,
      decide: this.decide,
      exportPlan: this.exportPlan,
      openRecord: this.openRecord,
      addGuest: this.addGuest,
      removeGuest: this.removeGuest,
      reset: this.reset,
    };
  }
}

// ---- registry --------------------------------------------------------------
// One engine per team, kept for the whole session so a running roundtable
// survives navigating away from (and back to) the team page.
const ENGINES = new Map<string, MeetingEngine>();

function getMeetingEngine(team: TTeam): MeetingEngine {
  let engine = ENGINES.get(team.id);
  if (!engine) {
    engine = new MeetingEngine(team);
    ENGINES.set(team.id, engine);
  }
  return engine;
}

/**
 * Renderer-side meeting controller — a thin React binding over the per-team
 * {@link MeetingEngine} singleton. Subscribes for re-renders and forwards the
 * latest `team` snapshot; on unmount it ONLY unsubscribes, so an in-flight
 * roundtable keeps running and is shown live when the page is re-entered.
 */
export function useMeetingOrchestrator(team: TTeam): MeetingOrchestrator {
  const engine = getMeetingEngine(team);
  // Keep the engine's team snapshot current (derives moderator/panelists/canStart).
  engine.updateTeam(team);

  const [, force] = useState(0);
  useEffect(() => engine.subscribe(() => force((v) => v + 1)), [engine]);

  // Warm the team session when the meeting view mounts.
  useEffect(() => {
    void engine.ensureWarm();
  }, [engine]);

  return engine.getOrchestrator();
}
