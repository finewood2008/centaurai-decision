import { useEffect, useState } from 'react';
import { mutate as globalMutate } from 'swr';
import { Message } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { retrieveKnowledgeContext } from '@/renderer/services/knowledgeBaseSearch';
import i18n from '@/renderer/services/i18n';
import { emitter } from '@/renderer/utils/emitter';
import { registerGeneratedArtifacts } from '@/renderer/utils/file/generatedArtifacts';
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
  type MeetingParticipantSnapshot,
  type MeetingQuestion,
  type MeetingRecord,
  type MeetingResolutionOption,
  type MeetingState,
  type MeetingTurn,
} from './meetingTypes';
import {
  decisionDocxBase64,
  decisionFileName,
  decisionMarkdownContent,
  decisionMarkdownFileName,
} from '@/renderer/services/meetingPlanDocx';
import {
  addGuest as storeAddGuest,
  readGuests,
  removeGuest as storeRemoveGuest,
  type MeetingGuest,
} from './meetingGuests';
import { resolveDepartment } from './presetDepartments';
import {
  PANEL_LENSES,
  buildDiscussionNotesPrompt,
  buildDynamicAdvisorPrompt,
  buildDynamicModeratorPrompt,
  buildExportTask,
  buildFallbackMeetingQuestion,
  buildModeratorActionRepairPrompt,
  buildReferenceContext,
  hasValidMeetingSpeech,
  parseDynamicModeratorAction,
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
  answerQuestion: (answer: { optionId?: string; text?: string }) => void;
  pauseMeeting: () => void;
  finishMeeting: () => void;
  resumeMeeting: (recordId: string) => void;
  /** Re-query the knowledge base mid-meeting and inject results as a transcript turn. */
  refreshKnowledge: () => void;
  /** Cancel the in-flight debate. */
  cancel: () => void;
  /** Boss picks a final option. */
  decide: (optionId: string) => void;
  /** Ask the leader to archive the 方案书 as docx/md into the Content Hub. */
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

function patchHistoryRecord(team_id: string, recordId: string, patch: Partial<MeetingRecord>): void {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as HistoryMap) : {};
    const list = Array.isArray(parsed[team_id]) ? parsed[team_id] : [];
    const index = list.findIndex((record) => record.id === recordId);
    if (index >= 0) {
      list[index] = { ...list[index], ...patch };
      parsed[team_id] = list;
    }
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
 * Seed a team's fixed workflow (+ optional preset department) into the meeting
 * store at create time. The Decision edition fixes the 流程 when the 决策会议室 is
 * created — there is no runtime picker — so hydrate() reads this back into
 * state.form / state.departmentId and startMeeting falls back to state.form.
 */
export function setTeamMeetingForm(team_id: string, form: MeetingForm, departmentId?: string): void {
  const store = readStore();
  const prev = store[team_id] ?? {};
  store[team_id] = departmentId ? { ...prev, form, departmentId } : { ...prev, form };
  writeStore(store);
}

/**
 * Hydrate persisted meeting state for a COLD engine (first visit this session, or
 * after an app reload). A run that was live when the app last closed can't be
 * resumed — its renderer loop is gone — so we stop the spinner but keep the
 * transcript visible. Within a session this never runs on navigation, because
 * the in-memory engine is reused.
 */
function hydrate(team_id: string, teamName: string): MeetingState {
  const stored = readStore()[team_id];
  const base: MeetingState = stored ? { ...EMPTY_MEETING_STATE, ...stored, revision: 0 } : { ...EMPTY_MEETING_STATE };
  if (base.phase === 'running') {
    const resumable = Boolean(base.activeRecordId && base.participantSnapshot.length > 0);
    const legacyResolution = !resumable && (base.plan.trim() || base.options.length > 0);
    const transcript: MeetingTurn[] = base.transcript.map((turn) =>
      turn.status === 'speaking'
        ? { ...turn, status: (turn.text.trim() ? 'done' : 'error') as MeetingTurn['status'] }
        : turn
    );
    return {
      ...base,
      phase: resumable ? 'paused' : legacyResolution ? 'resolution' : 'idle',
      runState: legacyResolution ? 'awaiting_decision' : 'stopped',
      activeSlotId: null,
      runId: null,
      transcript,
      awaitingContinue: false,
      pendingQuestion: null,
      activity: resumable ? 'paused' : null,
    };
  }
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
  private questionGate: ((answer: string) => void) | null = null;
  private pauseRequested = false;
  private finishRequested = false;
  /** Reference material available to every subsequent moderator and panelist turn. */
  private referenceContext = '';

  constructor(team: TTeam) {
    this.team = team;
    this.state = hydrate(team.id, team.name);
    this.extras = readGuests(team.id);
    if (this.state.phase === 'paused' && this.state.activeRecordId) {
      patchHistoryRecord(team.id, this.state.activeRecordId, {
        status: 'paused',
        transcript: this.state.transcript,
        discussionState: this.state.discussionState,
        participantSnapshot: this.state.participantSnapshot,
      });
    }
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
      departmentId: next.departmentId,
      plan: next.plan,
      options: next.options,
      decidedOptionId: next.decidedOptionId,
      transcript: next.transcript,
      archivedPath: next.archivedPath,
      pendingQuestion: next.pendingQuestion,
      discussionState: next.discussionState,
      activity: next.activity,
      activeRecordId: next.activeRecordId,
      participantSnapshot: next.participantSnapshot,
    };
    writeStore(store);
    this.notify();
  }

  ensureWarm = (): Promise<void> => {
    if (!this.warmup) {
      this.warmup = ipcBridge.team.ensureSession
        .invoke({ team_id: this.team.id })
        // A freshly created team provisions agent conversations ASYNCHRONOUSLY — and
        // teammate conversation_ids often land AFTER ensureSession resolves. A single
        // refetch can therefore miss them, so a selected teammate stays invisible in
        // the roster (moderator/panelists require a conversation_id) and the boss thinks
        // their pick was lost. Poll the team until every agent has a conversation_id,
        // pushing each fresh snapshot into the SWR cache so the roster fills in.
        .then(async () => {
          for (let i = 0; i < 8; i++) {
            const fresh: TTeam | null = await ipcBridge.team.get.invoke({ id: this.team.id }).catch((): null => null);
            if (fresh) {
              await globalMutate(`team/${this.team.id}`, fresh, false);
              const agents = fresh.agents ?? [];
              if (agents.length > 0 && agents.every((a) => a.conversation_id)) break;
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
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
      await registerGeneratedArtifacts({
        paths: [path],
        conversationId: moderator.conversation_id,
        source: 'meeting',
        standaloneLabel: this.team.name,
      });
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
   * Generate deterministic Markdown / Word exports of the 方案书 with the
   * boss's chosen option highlighted, and write them to the team workspace
   * (→ Content Hub), falling back to the Downloads folder. Blob downloads are
   * dropped by this app and aioncore fs.write is text-only, so binary Office
   * files go through the Electron main IPC.
   */
  private async exportDecisionFiles(decision: MeetingResolutionOption | null): Promise<void> {
    const topic = this.state.topic;
    const plan = this.state.plan;
    if (!plan.trim()) return;
    try {
      Message.info('正在生成决策方案文档…');
      const docArgs = {
        topic,
        teamName: this.team.name,
        plan,
        decision,
        dateLabel: new Date().toLocaleDateString('zh-CN'),
      };
      const docxBase64 = await decisionDocxBase64(docArgs);
      const mdContent = decisionMarkdownContent(docArgs);
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
        Message.error('生成决策方案文档失败：未找到保存位置');
        return;
      }
      const mdPath = joinPath(dir, decisionMarkdownFileName(topic, this.team.name));
      const mdOk = await ipcBridge.fs.writeFile.invoke({ path: mdPath, data: mdContent });
      const docxFileName = decisionFileName(topic, this.team.name);
      const docxRes = await ipcBridge.application.saveBinaryFile.invoke({
        dir,
        fileName: docxFileName,
        base64: docxBase64,
      });

      if (mdOk && docxRes?.success && docxRes.data?.path) {
        await registerGeneratedArtifacts({
          paths: [mdPath, docxRes.data.path],
          conversationId: this.moderator?.conversation_id,
          source: 'meeting',
          standaloneLabel: this.team.name,
        });
        emitter.emit('acp.workspace.refresh');
        emitter.emit('codex.workspace.refresh');
        emitter.emit('aionrs.workspace.refresh');
        const where = inWorkspace ? '已存入内容中心' : '已保存到下载文件夹';
        Message.success(`已生成决策方案：Markdown / Word（${where}）`);
      } else {
        const msg = docxRes?.msg || (!mdOk ? 'Markdown 写入失败' : '');
        Message.error(`生成决策方案文档失败${msg ? '：' + msg : ''}`);
        this.fallbackExportWithCodex();
      }
    } catch {
      Message.error('生成决策方案文档失败，已尝试交给 Codex 兜底生成');
      this.fallbackExportWithCodex();
    }
  }

  private fallbackExportWithCodex(): void {
    const plan = this.state.plan;
    if (!plan.trim()) return;
    const codex = this.team.agents.find((a) => (a.agent_type || '').toLowerCase() === 'codex' && a.conversation_id);
    const target = codex ?? this.moderator;
    if (!target?.conversation_id) return;
    void ipcBridge.conversation.sendMessage.invoke({
      conversation_id: target.conversation_id,
      input: buildExportTask(plan),
    });
  }

  // ---- transcript turns ----------------------------------------------------

  private updateTurn(turnId: string, patch: Partial<MeetingTurn>): void {
    const transcript = this.state.transcript.map((t) => (t.id === turnId ? { ...t, ...patch } : t));
    this.commit({ transcript });
  }

  /** Append a fresh "speaking" turn for a participant; returns its id. */
  private addTurn(p: Participant, phaseLabel: string, parallel = false, kind?: MeetingTurn['kind']): string {
    const id = `t-${this.state.transcript.length}-${p.id}`;
    const turn: MeetingTurn = {
      id,
      participantId: p.id,
      name: p.name,
      icon: p.icon,
      agent_type: p.agent_type,
      isModerator: p.isModerator,
      phaseLabel,
      parallel,
      text: '',
      status: 'speaking',
      kind,
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
      let cleanup = (): void => {};
      this.turnConv.set(conversationId, turnId);
      this.turnText.set(turnId, '');
      STREAM_ROUTES.set(conversationId, this);
      const finish = (text: string) => {
        if (settled) return;
        settled = true;
        off();
        clearTimeout(timer);
        const cleanupIndex = this.loopUnsubs.indexOf(cleanup);
        if (cleanupIndex >= 0) this.loopUnsubs.splice(cleanupIndex, 1);
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
      cleanup = () => finish(this.turnText.get(turnId) ?? '');
      this.loopUnsubs.push(cleanup);
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
    convs: Map<string, string>,
    savedSnapshot?: MeetingParticipantSnapshot[]
  ): Promise<{ mod: Participant; panel: Participant[] } | null> {
    const moderator = this.moderator;
    if (!moderator && !savedSnapshot?.some((participant) => participant.isModerator)) return null;
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
    if (this.extras.some((e) => e.provider_id) || savedSnapshot?.some((participant) => participant.provider_id)) {
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
          if (!provider) return null;
          params.model = { ...provider, use_model: src.model_name } as TProviderWithModel;
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

    const currentSources: MeetingParticipantSnapshot[] = moderator
      ? [
          {
            id: moderator.slot_id,
            name: moderator.agent_name,
            icon: moderator.icon,
            agent_type: moderator.agent_type,
            model: moderator.model,
            isModerator: true,
          },
          ...this.teamPanelists.map((agent) => ({
            id: agent.slot_id,
            name: agent.agent_name,
            icon: agent.icon,
            agent_type: agent.agent_type,
            model: agent.model,
            isModerator: false,
          })),
          ...this.extras.map((guest) => ({
            id: guest.id,
            name: guest.agent_name,
            icon: guest.icon,
            agent_type: guest.agent_type,
            provider_id: guest.provider_id,
            model_name: guest.model_name,
            isModerator: false,
          })),
        ]
      : [];
    const sources = savedSnapshot?.length ? savedSnapshot : currentSources;
    const moderatorSource = sources.find((source) => source.isModerator);
    if (!moderatorSource) return null;
    const mod = await make(moderatorSource);
    if (!mod || stale()) {
      this.releaseConvs(convs, true);
      return null;
    }
    const panel: Participant[] = [];
    for (const source of sources.filter((participant) => !participant.isModerator)) {
      if (stale()) break;
      const p = await make(source);
      if (p) panel.push(p);
    }
    if (panel.length !== sources.filter((participant) => !participant.isModerator).length) {
      this.releaseConvs(convs, true);
      return null;
    }
    if (stale()) {
      this.releaseConvs(convs, true);
      return null;
    }
    return { mod, panel };
  }

  private currentParticipantSnapshot(): MeetingParticipantSnapshot[] {
    const moderator = this.moderator;
    return [
      ...(moderator
        ? [
            {
              id: moderator.slot_id,
              name: moderator.agent_name,
              icon: moderator.icon,
              agent_type: moderator.agent_type,
              model: moderator.model,
              isModerator: true,
            },
          ]
        : []),
      ...this.teamPanelists.map((agent) => ({
        id: agent.slot_id,
        name: agent.agent_name,
        icon: agent.icon,
        agent_type: agent.agent_type,
        model: agent.model,
        isModerator: false,
      })),
      ...this.extras.map((guest) => ({
        id: guest.id,
        name: guest.agent_name,
        icon: guest.icon,
        agent_type: guest.agent_type,
        provider_id: guest.provider_id,
        model_name: guest.model_name,
        isModerator: false,
      })),
    ];
  }

  private waitForQuestion(question: MeetingQuestion): Promise<string> {
    this.commit({
      pendingQuestion: question,
      runState: 'awaiting_user',
      activity: 'awaiting_user',
      activeSlotId: null,
    });
    return new Promise<string>((resolve) => {
      let settled = false;
      const cleanup = (): void => settle('');
      const settle = (answer: string): void => {
        if (settled) return;
        settled = true;
        const cleanupIndex = this.loopUnsubs.indexOf(cleanup);
        if (cleanupIndex >= 0) this.loopUnsubs.splice(cleanupIndex, 1);
        resolve(answer);
      };
      this.questionGate = settle;
      this.loopUnsubs.push(cleanup);
    });
  }

  /** Host-driven discussion loop. Every iteration produces exactly one meaningful next action. */
  private async runDynamicMeeting(
    myRun: number,
    topic: string,
    form: MeetingForm,
    reference?: string,
    resumeRecord?: MeetingRecord
  ): Promise<void> {
    const stale = () => this.runSeq !== myRun;
    if (stale()) return;
    const convs = new Map<string, string>();
    this.activeTeardown = (stop: boolean) => this.releaseConvs(convs, stop);
    try {
      const snapshot = resumeRecord?.participantSnapshot?.length
        ? resumeRecord.participantSnapshot
        : this.currentParticipantSnapshot();
      const parts = await this.buildParticipants(myRun, convs, snapshot);
      if (!parts || stale()) {
        Message.error(
          i18n.t('team.meeting.deepDiscussion.resumeUnavailable', {
            defaultValue: '无法恢复原参会阵容，请检查主持人、顾问、模型和 Provider 配置。',
          })
        );
        if (!stale()) this.commit({ phase: resumeRecord ? 'paused' : 'idle', runState: 'stopped', activity: 'paused' });
        return;
      }
      const { mod, panel } = parts;
      const lenses = resolveDepartment(this.state.departmentId)?.lenses ?? PANEL_LENSES;
      const lensByPanel = new Map(panel.map((participant, index) => [participant.id, lenses[index % lenses.length]]));
      const panelNames = panel.map((participant) => participant.name);
      const transcriptText = () =>
        this.state.transcript
          .filter((turn) => turn.text.trim())
          .map((turn) => `${turn.name}（${turn.phaseLabel}）：${turn.text}`)
          .join('\n\n');
      const recordId = resumeRecord?.id ?? this.state.activeRecordId ?? `m-${Date.now()}`;
      const recordTs = resumeRecord?.ts ?? Date.now();

      const persistRecord = (status: 'active' | 'paused' | 'completed'): void => {
        const state = this.state;
        const record: MeetingRecord = {
          id: recordId,
          topic: state.topic,
          form: state.form,
          plan: state.plan,
          options: state.options,
          transcript: state.transcript,
          decidedOptionId: state.decidedOptionId,
          archivedPath: state.archivedPath,
          ts: recordTs,
          status,
          discussionState: state.discussionState,
          participantSnapshot: snapshot,
        };
        const existing = readHistory(this.team.id).some((item) => item.id === recordId);
        if (existing) patchHistoryRecord(this.team.id, recordId, record);
        else appendHistory(this.team.id, record);
      };
      const speak = async (
        participant: Participant,
        label: string,
        prompt: string,
        kind: MeetingTurn['kind']
      ): Promise<string> => {
        const turnId = this.addTurn(participant, label, false, kind);
        const text = await this.askTurn(participant.conversationId, turnId, prompt);
        if (stale()) return text;
        this.updateTurn(turnId, { text, status: hasValidMeetingSpeech(text) ? 'done' : 'error' });
        this.commit({ turnsCompleted: this.state.turnsCompleted + 1, activeSlotId: null });
        persistRecord('active');
        return text;
      };
      const appendSystemTurn = (label: string, text: string, kind: MeetingTurn['kind']): void => {
        this.commit({
          transcript: [
            ...this.state.transcript,
            {
              id: `t-${this.state.transcript.length}-system`,
              participantId: 'system',
              name: label,
              agent_type: 'system',
              isModerator: false,
              phaseLabel: label,
              text,
              status: 'done',
              kind,
            },
          ],
        });
        persistRecord('active');
      };

      this.commit({
        activeRecordId: recordId,
        participantSnapshot: snapshot,
        phase: 'running',
        runState: 'running',
        activity: resumeRecord ? 'aligning' : 'aligning',
      });
      persistRecord('active');
      let firstAction = true;
      while (!stale()) {
        if (this.pauseRequested) {
          this.commit({
            phase: 'paused',
            runState: 'stopped',
            activity: 'paused',
            pendingQuestion: null,
            activeSlotId: null,
          });
          persistRecord('paused');
          return;
        }
        if (this.finishRequested) {
          this.commit({ activity: 'finishing', runState: 'running', pendingQuestion: null });
          const notes = await speak(
            mod,
            i18n.t('team.meeting.deepDiscussion.notesTitle', { defaultValue: '讨论纪要' }),
            buildDiscussionNotesPrompt(topic, transcriptText()),
            'notes'
          );
          if (stale()) return;
          const notesText = hasValidMeetingSpeech(notes) ? notes : transcriptText();
          this.commit({
            phase: 'completed',
            runState: 'stopped',
            activity: 'completed',
            plan: notesText,
            pendingQuestion: null,
            activeSlotId: null,
          });
          persistRecord('completed');
          return;
        }

        this.commit({ activity: firstAction ? 'aligning' : 'moderating', runState: 'running' });
        const turnId = this.addTurn(
          mod,
          firstAction
            ? i18n.t('team.meeting.deepDiscussion.activity.aligning', { defaultValue: '目标对齐' })
            : i18n.t('team.meeting.deepDiscussion.activity.moderating', { defaultValue: '主持研判' }),
          false,
          'moderator_action'
        );
        const prompt = buildDynamicModeratorPrompt({
          topic,
          form,
          panelNames,
          transcript: transcriptText(),
          referenceContext: this.referenceContext || reference,
          opening: firstAction && !resumeRecord,
          resumed: firstAction && Boolean(resumeRecord),
          discussionState: this.state.discussionState,
        });
        let raw = await this.askTurn(mod.conversationId, turnId, prompt);
        if (stale()) return;
        let parsed = parseDynamicModeratorAction(raw, panelNames, `q-${Date.now()}`);
        if (!parsed) {
          raw = await this.askTurn(mod.conversationId, turnId, buildModeratorActionRepairPrompt(panelNames));
          if (stale()) return;
          parsed = parseDynamicModeratorAction(raw, panelNames, `q-${Date.now()}`);
        }
        if (!parsed) {
          const question = buildFallbackMeetingQuestion(
            `q-${Date.now()}`,
            i18n.t('team.meeting.deepDiscussion.fallbackQuestion', {
              defaultValue: '你希望接下来从哪个方向继续？',
            }),
            [
              {
                id: 'clarify',
                label: i18n.t('team.meeting.deepDiscussion.fallbackOptions.clarify', {
                  defaultValue: '先澄清目标与成功标准',
                }),
              },
              {
                id: 'risk',
                label: i18n.t('team.meeting.deepDiscussion.fallbackOptions.risk', {
                  defaultValue: '先识别关键风险和约束',
                }),
              },
              {
                id: 'paths',
                label: i18n.t('team.meeting.deepDiscussion.fallbackOptions.paths', {
                  defaultValue: '先比较可能的路径',
                }),
              },
              {
                id: 'context',
                label: i18n.t('team.meeting.deepDiscussion.fallbackOptions.context', {
                  defaultValue: '我想补充更多背景',
                }),
              },
            ]
          );
          parsed = {
            displayText: i18n.t('team.meeting.deepDiscussion.fallbackPrompt', {
              defaultValue: '主持人需要你确认接下来的讨论方向。',
            }),
            discussionState: this.state.discussionState,
            action: { type: 'ask_user', question },
          };
        }
        this.updateTurn(turnId, {
          text: parsed.displayText,
          status: 'done',
          question: parsed.action.type === 'ask_user' ? parsed.action.question : undefined,
        });
        this.commit({
          discussionState: parsed.discussionState,
          turnsCompleted: this.state.turnsCompleted + 1,
          activeSlotId: null,
        });
        persistRecord('active');
        firstAction = false;

        if (parsed.action.type === 'ask_user') {
          await this.waitForQuestion(parsed.action.question);
          continue;
        }
        if (parsed.action.type === 'suggest_close') {
          const question: MeetingQuestion = {
            id: `q-close-${Date.now()}`,
            prompt: parsed.action.reason || parsed.displayText,
            options: [
              {
                id: 'continue',
                label: i18n.t('team.meeting.deepDiscussion.closeOptions.continue', { defaultValue: '继续深挖' }),
              },
              {
                id: 'shift',
                label: i18n.t('team.meeting.deepDiscussion.closeOptions.shift', {
                  defaultValue: '换一个角度讨论',
                }),
              },
              {
                id: 'pause',
                label: i18n.t('team.meeting.deepDiscussion.closeOptions.pause', { defaultValue: '暂停并保存' }),
                action: 'pause',
              },
              {
                id: 'finish',
                label: i18n.t('team.meeting.deepDiscussion.closeOptions.finish', {
                  defaultValue: '结束并生成纪要',
                }),
                action: 'finish',
              },
            ],
          };
          this.updateTurn(turnId, { question });
          await this.waitForQuestion(question);
          continue;
        }
        if (parsed.action.type === 'research') {
          this.commit({ activity: 'researching' });
          try {
            const result = await retrieveKnowledgeContext(parsed.action.query);
            if (result.context) {
              const refreshedReference = buildReferenceContext(result.context, []);
              this.referenceContext = [this.referenceContext, refreshedReference].filter(Boolean).join('\n\n');
              appendSystemTurn(
                i18n.t('team.meeting.deepDiscussion.researchLabel', { defaultValue: '资料调查' }),
                result.context,
                'research'
              );
            } else {
              appendSystemTurn(
                i18n.t('team.meeting.deepDiscussion.researchLabel', { defaultValue: '资料调查' }),
                i18n.t('team.meeting.deepDiscussion.researchEmpty', { defaultValue: '未检索到相关资料。' }),
                'research'
              );
            }
          } catch {
            appendSystemTurn(
              i18n.t('team.meeting.deepDiscussion.researchLabel', { defaultValue: '资料调查' }),
              i18n.t('team.meeting.deepDiscussion.researchFailed', {
                defaultValue: '资料检索失败，主持人将基于现有信息继续。',
              }),
              'research'
            );
          }
          continue;
        }
        this.commit({ activity: 'consulting' });
        for (const name of parsed.action.targetNames) {
          if (stale() || this.pauseRequested || this.finishRequested) break;
          const advisor = panel.find((participant) => participant.name === name);
          if (!advisor) continue;
          await speak(
            advisor,
            i18n.t('team.meeting.deepDiscussion.activity.consulting', { defaultValue: '顾问讨论' }),
            buildDynamicAdvisorPrompt({
              topic,
              persona: advisor.name,
              lens: lensByPanel.get(advisor.id),
              instruction: parsed.action.instruction,
              transcript: transcriptText(),
              referenceContext: this.referenceContext || undefined,
            }),
            'advisor_response'
          );
        }
      }
    } finally {
      if (!stale()) {
        this.running = false;
        this.activeTeardown = null;
        this.questionGate = null;
      }
      this.releaseConvs(convs, false);
    }
  }

  // ---- public actions ------------------------------------------------------

  startMeeting = (topic: string, opts?: StartMeetingOptions): void => {
    const trimmed = topic.trim();
    if (!trimmed || !this.moderator || this.running) return;
    // Claim the run synchronously so two starts cannot race before participant setup.
    this.running = true;
    // Every dynamic loop carries its own generation id; a later start makes it stale.
    const myRun = ++this.runSeq;
    const form = opts?.form ?? this.state.form;
    const attachments = opts?.attachments ?? [];
    // Settle any pending turn/pause + reclaim leftover conversations, then start the debate.
    this.loopUnsubs.forEach((o) => o());
    this.loopUnsubs.length = 0;
    this.questionGate = null;
    this.activeTeardown?.(false);
    this.activeTeardown = null;
    this.turnConv.clear();
    this.turnText.clear();
    this.referenceContext = '';
    this.pauseRequested = false;
    this.finishRequested = false;
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
      pendingQuestion: null,
      discussionState: { summary: '', openQuestions: [] },
      activity: 'aligning',
      activeRecordId: null,
      participantSnapshot: [],
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
        this.referenceContext = [reference, this.referenceContext].filter(Boolean).join('\n\n');
        return this.runDynamicMeeting(myRun, trimmed, form, reference);
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
          kind: 'user_answer',
        },
      ],
    });
  };

  answerQuestion = (answer: { optionId?: string; text?: string }): void => {
    const question = this.state.pendingQuestion;
    if (!question || !this.questionGate) return;
    const option = question.options.find((item) => item.id === answer.optionId);
    const note = answer.text?.trim() ?? '';
    if (!option && !note) return;
    const response = [option?.label, note].filter(Boolean).join(' — ');
    this.commit({
      transcript: [
        ...this.state.transcript,
        {
          id: `t-${this.state.transcript.length}-boss-answer`,
          participantId: 'boss',
          name: '老板',
          agent_type: 'boss',
          isModerator: false,
          phaseLabel: '老板回应',
          text: response,
          status: 'done',
          kind: 'user_answer',
        },
      ],
      pendingQuestion: null,
      runState: 'running',
      activity: 'moderating',
    });
    if (option?.action === 'pause') this.pauseRequested = true;
    if (option?.action === 'finish') this.finishRequested = true;
    const gate = this.questionGate;
    this.questionGate = null;
    gate(response);
  };

  pauseMeeting = (): void => {
    if (!this.running) return;
    this.pauseRequested = true;
    this.commit({ activity: 'pausing', pendingQuestion: null });
    this.questionGate?.('');
    this.questionGate = null;
    this.loopUnsubs.forEach((resolve) => resolve());
    this.loopUnsubs.length = 0;
  };

  finishMeeting = (): void => {
    if (!this.running) return;
    this.finishRequested = true;
    this.commit({ activity: 'finishing', pendingQuestion: null });
    this.questionGate?.('');
    this.questionGate = null;
    this.loopUnsubs.forEach((resolve) => resolve());
    this.loopUnsubs.length = 0;
  };

  resumeMeeting = (recordId: string): void => {
    const record = readHistory(this.team.id).find((item) => item.id === recordId);
    if (!record || record.status !== 'paused' || !record.participantSnapshot?.length || this.running) return;
    this.running = true;
    this.pauseRequested = false;
    this.finishRequested = false;
    const myRun = ++this.runSeq;
    this.turnConv.clear();
    this.turnText.clear();
    this.commit({
      phase: 'running',
      runState: 'running',
      topic: record.topic,
      form: record.form,
      plan: '',
      options: [],
      transcript: record.transcript,
      pendingQuestion: null,
      discussionState: record.discussionState ?? { summary: '', openQuestions: [] },
      participantSnapshot: record.participantSnapshot,
      activeRecordId: record.id,
      activity: 'aligning',
    });
    void this.runDynamicMeeting(myRun, record.topic, record.form, undefined, record);
  };

  cancel = (): void => {
    this.runSeq++; // invalidate the active run; the awaiting frame unwinds via loopUnsubs
    this.loopUnsubs.forEach((o) => o());
    this.loopUnsubs.length = 0;
    this.questionGate = null;
    this.activeTeardown?.(true); // stop + remove this run's conversations
    this.activeTeardown = null;
    this.running = false;
    this.pauseRequested = false;
    this.finishRequested = false;
    this.referenceContext = '';
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
      pendingQuestion: null,
      activity: null,
    });
  };

  decide = (optionId: string): void => {
    this.commit({ decidedOptionId: optionId, phase: 'decided', runState: 'stopped', activeSlotId: null });
    // Auto-generate well-formed Markdown / Word files of the final decision.
    const decision = this.state.options.find((o) => o.id === optionId) ?? null;
    void this.exportDecisionFiles(decision);
  };

  exportPlan = (): boolean => {
    const plan = this.state.plan;
    if (!plan.trim()) return false;
    void this.exportDecisionFiles(this.state.options.find((o) => o.id === this.state.decidedOptionId) ?? null);
    return true;
  };

  openRecord = (rec: MeetingRecord): void => {
    if (this.running) return;
    this.commit({
      phase: rec.status === 'paused' ? 'paused' : rec.status === 'completed' ? 'completed' : 'resolution',
      runState: 'stopped',
      topic: rec.topic,
      form: rec.form,
      plan: rec.plan,
      options: rec.options,
      decidedOptionId: rec.decidedOptionId ?? null,
      transcript: rec.transcript ?? [],
      activeSlotId: null,
      runId: null,
      archivedPath: rec.archivedPath ?? null,
      discussionState: rec.discussionState ?? { summary: '', openQuestions: [] },
      participantSnapshot: rec.participantSnapshot ?? [],
      activeRecordId: rec.id,
      pendingQuestion: null,
      activity: rec.status === 'paused' ? 'paused' : rec.status === 'completed' ? 'completed' : null,
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

  refreshKnowledge = (): void => {
    const topic = this.state.topic;
    if (!topic) return;
    void retrieveKnowledgeContext(topic)
      .then((result) => {
        if (!result.context) {
          Message.info('知识库中未找到相关内容');
          return;
        }
        const id = `t-${this.state.transcript.length}-system-kb`;
        const refreshedReference = buildReferenceContext(result.context, []);
        this.referenceContext = [this.referenceContext, refreshedReference].filter(Boolean).join('\n\n');
        this.commit({
          transcript: [
            ...this.state.transcript,
            {
              id,
              participantId: 'system-kb',
              name: '知识库',
              icon: '📚',
              agent_type: 'system',
              isModerator: false,
              phaseLabel: '参考资料',
              parallel: false,
              text: `📚 **知识库检索结果（${result.count} 条）**\n\n${result.context}`,
              status: 'done',
            },
          ],
        });
        Message.success(`已注入 ${result.count} 条知识库参考资料`);
      })
      .catch(() => {
        Message.warning('知识库检索失败，请确认向量库服务已启动');
      });
  };

  reset = (): void => {
    this.runSeq++; // invalidate the active run; the awaiting frame unwinds via loopUnsubs
    this.loopUnsubs.forEach((o) => o());
    this.loopUnsubs.length = 0;
    this.questionGate = null;
    this.activeTeardown?.(false); // remove this run's conversations (reset = remove only)
    this.activeTeardown = null;
    this.turnConv.clear();
    this.turnText.clear();
    this.referenceContext = '';
    this.running = false;
    this.pauseRequested = false;
    this.finishRequested = false;
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
      answerQuestion: this.answerQuestion,
      pauseMeeting: this.pauseMeeting,
      finishMeeting: this.finishMeeting,
      resumeMeeting: this.resumeMeeting,
      cancel: this.cancel,
      decide: this.decide,
      exportPlan: this.exportPlan,
      openRecord: this.openRecord,
      addGuest: this.addGuest,
      removeGuest: this.removeGuest,
      refreshKnowledge: this.refreshKnowledge,
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
