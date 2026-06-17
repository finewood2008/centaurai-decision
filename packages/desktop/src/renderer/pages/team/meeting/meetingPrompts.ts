// Prompt builders + output parser for the moderated meeting mode.
//
// All prompts are injected into an agent's private conversation via
// `acpConversation.sendMessage`, exactly like a user turn. The moderator is the
// team leader; panelists are the teammates. Prompts are intentionally short to
// keep the meeting snappy and the token cost bounded.

import type { MeetingResolutionOption } from './meetingTypes';

/** Machine markers the moderator must use when emitting resolution options. */
const OPTION_OPEN = '@@OPTION@@';
const OPTION_CLOSE = '@@END@@';

/** A panelist descriptor used to build the roster line in prompts. */
export type PanelistBrief = { name: string; expertise?: string };

/**
 * The single task we hand to the team leader to kick off a backend team_run.
 * The leader (as moderator) runs the whole roundtable via mailboxes and must
 * end with machine-readable option blocks so the UI can render decision cards.
 */
export function buildTeamRunTask(topic: string, panelists: PanelistBrief[]): string {
  const roster = panelists.map((p) => p.name).join('、');
  return [
    '你是这个团队的主持人。请组织一场圆桌会议来论证下面这个议题，全程用中文。',
    `议题：${topic}`,
    panelists.length ? `与会专家：${roster}` : '',
    '',
    '重要规则：你必须给每一位专家发消息、让他们各自从专业视角真实发言，并组织至少一轮专家之间的互相反驳；绝不要自己代替专家回答，也不要跳过讨论直接给方案。',
    '',
    '请这样主持：',
    '1）开场：重述议题，拆解 2-4 个关键争论焦点；',
    '2）立论：让每位专家从各自专业视角依次发表开场观点；',
    '3）交锋：组织至少 1-2 轮专家互相反驳与回应，让分歧充分暴露；',
    '4）收敛：汇总共识、分歧与关键权衡。',
    '',
    '只有在专家们都充分讨论之后，再进入下一步。',
    '',
    '最后，你必须输出 2-3 个可供老板拍板的候选方案，每个严格用如下格式（不要多余包裹）：',
    `${OPTION_OPEN} 方案标题`,
    '核心思路：……',
    '优点：……',
    '风险/代价：……',
    '适用场景：……',
    OPTION_CLOSE,
    '并在方案之后用一句话给出你的推荐及理由。',
  ]
    .filter(Boolean)
    .join('\n');
}

function rosterLine(panelists: PanelistBrief[]): string {
  return panelists.map((p) => (p.expertise ? `${p.name}（${p.expertise}）` : p.name)).join('、');
}

/**
 * Moderator opening: restate the topic, break it into 2-4 focus questions, and
 * hand off. The moderator must NOT propose its own solution yet.
 */
export function buildModeratorOpeningPrompt(topic: string, panelists: PanelistBrief[]): string {
  return [
    '你是这场圆桌会议的主持人。请用主持人的口吻、简洁地主持，不要给出你自己的方案。',
    `本次议题：${topic}`,
    `与会专家：${rosterLine(panelists)}`,
    '',
    '请完成开场（150 字以内）：',
    '1）用一两句话重述议题；',
    '2）拆解出 2-4 个需要重点讨论的关键焦点；',
    '3）宣布开始，请专家依次发表开场观点。',
    '只输出开场词本身，不要旁白。',
  ].join('\n');
}

/**
 * Panelist opening position. `priorContext` carries the moderator's opening and
 * any earlier panelists' statements so the speaker has the room's context.
 */
export function buildPanelistPositionPrompt(params: { topic: string; persona: string; priorContext: string }): string {
  const { topic, persona, priorContext } = params;
  return [
    `你是参加圆桌会议的专家「${persona}」。请始终从你的专业视角发言，不要附和别人，也不要报数字置信度。`,
    `议题：${topic}`,
    '',
    '会议上下文：',
    priorContext || '（你是第一位发言的专家）',
    '',
    '请给出你的开场观点（200 字以内）：明确你的核心立场，并给出 1-2 个最有力的理由。直接发言，不要复述上下文。',
  ].join('\n');
}

/**
 * Panelist debate turn — react to what others said this/last round.
 */
export function buildPanelistDebatePrompt(params: {
  topic: string;
  persona: string;
  round: number;
  recentContext: string;
}): string {
  const { topic, persona, round, recentContext } = params;
  return [
    `你是专家「${persona}」，现在是第 ${round} 轮交锋。保持你的专业立场，但要真正回应他人，而不是重复自己。`,
    `议题：${topic}`,
    '',
    '其他人最近的发言：',
    recentContext || '（暂无）',
    '',
    '请发言（200 字以内）：针对上面至少一位的观点明确表示赞成或反对并给出理由；如果你被说服了，可以调整立场；可以补充新角度。直接发言。',
  ].join('\n');
}

/** Moderator convergence: summarize consensus / disagreement / trade-offs. */
export function buildModeratorConvergePrompt(topic: string): string {
  return [
    '你是主持人。讨论已进行多轮，请收敛。',
    `议题：${topic}`,
    '',
    '请汇总（250 字以内），分三块：',
    '【共识】大家一致同意的点；',
    '【分歧】仍有争议的点；',
    '【关键权衡】最终决策需要在什么之间取舍。',
    '只做汇总，先不要给方案。',
  ].join('\n');
}

/**
 * Moderator resolution: emit 2-3 candidate options using strict machine markers
 * so the UI can parse them into selectable cards.
 */
export function buildModeratorResolutionPrompt(topic: string): string {
  return [
    '你是主持人。基于全场讨论，请给老板提供 2-3 个可供拍板的候选方案。',
    `议题：${topic}`,
    '',
    '每个方案必须严格用下面的格式输出，不要有多余包裹：',
    `${OPTION_OPEN} 方案标题`,
    '核心思路：……',
    '优点：……',
    '风险/代价：……',
    '适用场景：……',
    OPTION_CLOSE,
    '',
    '可以在所有方案之后用一句话给出你的推荐及理由。',
  ].join('\n');
}

/** Re-cue the moderator after the boss interjects mid-meeting. */
export function buildInterjectModeratorPrompt(userText: string): string {
  return [
    `老板临时插话：${userText}`,
    '',
    '请作为主持人简短回应这条插话（100 字以内），并据此调整接下来的讨论方向，然后继续主持。',
  ].join('\n');
}

/** Ask the moderator to write the final minutes once the boss has decided. */
export function buildFinalizePrompt(option: MeetingResolutionOption): string {
  return [
    `老板已拍板，选定方案：「${option.title}」。`,
    '',
    '请输出最终会议纪要（250 字以内）：一句话结论 + 关键执行要点（3-5 条）+ 主要风险与应对。',
  ].join('\n');
}

/**
 * Parse the moderator's resolution message into selectable options.
 *
 * Robust to extra prose around the marked blocks. The first line after the
 * opening marker is the title; the remaining lines (until the close marker) are
 * the body.
 */
export function parseResolutionOptions(text: string): MeetingResolutionOption[] {
  if (!text) return [];
  const pattern = new RegExp(`${OPTION_OPEN}\\s*(.*?)\\n([\\s\\S]*?)${OPTION_CLOSE}`, 'g');
  const out: MeetingResolutionOption[] = [];
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    const title = match[1].trim();
    const body = match[2].trim();
    if (!title && !body) continue;
    out.push({ id: `opt-${i}`, title: title || `方案 ${i + 1}`, body });
    i += 1;
  }
  return out;
}

/** True once the moderator's resolution text contains at least one full option block. */
export function hasResolutionOptions(text: string): boolean {
  return text.includes(OPTION_OPEN) && text.includes(OPTION_CLOSE);
}

/**
 * Strip the machine option blocks from a message for display — the parsed
 * options render as cards, so the raw `@@OPTION@@…@@END@@` markers shouldn't
 * show in the timeline.
 */
export function stripResolutionMarkers(text: string): string {
  if (!text || !text.includes(OPTION_OPEN)) return text;
  const pattern = new RegExp(`${OPTION_OPEN}[\\s\\S]*?${OPTION_CLOSE}`, 'g');
  return text
    .replace(pattern, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- P1: scribe board + speaker selection + expert matching ---------------

/** Extract the first balanced JSON object from a string, tolerating prose. */
function extractJsonObject(text: string): unknown {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}

/** Side-question asked to the moderator to extract a structured round summary. */
export function buildScribeQuestion(topic: string, recentContext: string): string {
  return [
    '你是这场会议的记录员。基于目前的讨论，提取结构化纪要。',
    `议题：${topic}`,
    '讨论内容：',
    recentContext || '（暂无）',
    '',
    '只输出一个 JSON 对象，不要任何解释或代码块标记，格式：',
    '{"consensus":["已达成共识的点"],"disagreements":["仍有分歧的点"],"open":["尚未解决的开放问题"],"converged":true 或 false}',
    'converged 表示讨论是否已基本收敛（没有重大新分歧、继续争论收益不大）。',
  ].join('\n');
}

export type ScribeResult = {
  consensus: string[];
  disagreements: string[];
  open: string[];
  converged: boolean;
};

/** Parse the scribe's JSON answer; tolerant of surrounding prose. */
export function parseScribe(text: string): ScribeResult {
  const obj = extractJsonObject(text) as Record<string, unknown> | null;
  if (!obj) return { consensus: [], disagreements: [], open: [], converged: false };
  return {
    consensus: asStringArray(obj.consensus),
    disagreements: asStringArray(obj.disagreements),
    open: asStringArray(obj.open),
    converged: obj.converged === true,
  };
}

/**
 * Side-question asked to the moderator to pick the next debate speaker.
 * `lastName` is excluded to prevent one panelist monopolizing the floor.
 */
export function buildSelectQuestion(params: {
  topic: string;
  names: string[];
  lastName: string | null;
  recentContext: string;
}): string {
  const { topic, names, lastName, recentContext } = params;
  return [
    '你是会议主持人。根据讨论态势，决定下一个最该发言回应的人。',
    `议题：${topic}`,
    '讨论内容：',
    recentContext || '（暂无）',
    '',
    `可选发言人：${names.join('、')}`,
    lastName ? `不要选刚刚发过言的：${lastName}` : '',
    '只回一个名字，必须严格等于上面可选发言人之一，不要任何多余文字。',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Resolve a moderator's free-text speaker pick to one of the candidate names. */
export function matchSpeakerName(answer: string, names: string[]): string | null {
  if (!answer) return null;
  const cleaned = answer.trim();
  // Exact match first, then substring containment (the model may add quotes).
  const exact = names.find((n) => n === cleaned);
  if (exact) return exact;
  const contained = names.find((n) => cleaned.includes(n));
  return contained ?? null;
}

/** A compact advisor entry for the topic-matching prompt. */
export type AdvisorBrief = { name: string; description: string };

/** Side-question asked to the moderator to pick relevant advisors for a topic. */
export function buildExpertMatchQuestion(topic: string, catalog: AdvisorBrief[]): string {
  const list = catalog.map((a, i) => `${i + 1}. ${a.name}${a.description ? `：${a.description}` : ''}`).join('\n');
  return [
    '从下面的顾问名单中，挑选出对解决该议题最相关、且视角互补的 3-5 位。',
    `议题：${topic}`,
    '',
    '顾问名单：',
    list,
    '',
    '只输出一个 JSON 对象，不要解释：{"picks":["完全匹配名单里的名字"]}。优先选择能从不同专业角度贡献的组合。',
  ].join('\n');
}

/** Parse the advisor-match answer into a list of picked names. */
export function parseExpertPicks(text: string): string[] {
  const obj = extractJsonObject(text) as Record<string, unknown> | null;
  if (obj) {
    const picks = asStringArray(obj.picks);
    if (picks.length > 0) return picks;
  }
  return [];
}
