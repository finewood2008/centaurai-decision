// Prompt builders + output parser for the moderated meeting mode.
//
// All prompts are injected into an agent's private conversation via
// `acpConversation.sendMessage`, exactly like a user turn. The moderator is the
// team leader; panelists are the teammates. Prompts are intentionally short to
// keep the meeting snappy and the token cost bounded.

import type {
  MeetingDiscussionState,
  MeetingForm,
  MeetingModeratorAction,
  MeetingQuestion,
  MeetingResolutionOption,
} from './meetingTypes';

/** Machine markers the moderator must use when emitting resolution options. */
const OPTION_OPEN = '@@OPTION@@';
const OPTION_CLOSE = '@@END@@';
/** Machine markers wrapping the final synthesized 方案书 (markdown). */
const PLAN_OPEN = '@@PLAN@@';
const PLAN_CLOSE = '@@END_PLAN@@';
const ACTION_OPEN = '@@MEETING_ACTION@@';
const ACTION_CLOSE = '@@END_MEETING_ACTION@@';

/** A panelist descriptor used to build the roster line in prompts. */
export type PanelistBrief = { name: string; expertise?: string; lens?: string };

export type ParsedModeratorAction = {
  displayText: string;
  action: MeetingModeratorAction;
  discussionState: MeetingDiscussionState;
};

type RawModeratorAction = {
  type?: string;
  question?: string;
  questions?: Array<
    | string
    | {
        prompt?: string;
        options?: Array<{ label?: string; description?: string }>;
      }
  >;
  options?: Array<{ label?: string; description?: string }>;
  targetNames?: string[];
  instruction?: string;
  query?: string;
  reason?: string;
  stateSummary?: string;
  openQuestions?: string[];
};

export function buildFallbackMeetingQuestion(
  id: string,
  prompt: string,
  options: MeetingQuestion['options']
): MeetingQuestion {
  return { id, prompt, options };
}

/** Parse the moderator's visible narrative plus one machine-readable next action. */
export function parseDynamicModeratorAction(
  text: string,
  panelNames: string[],
  actionId: string
): ParsedModeratorAction | null {
  const start = text.indexOf(ACTION_OPEN);
  const end = text.indexOf(ACTION_CLOSE, start + ACTION_OPEN.length);
  if (start < 0 || end < 0) return null;
  let raw: RawModeratorAction;
  try {
    raw = JSON.parse(text.slice(start + ACTION_OPEN.length, end).trim()) as RawModeratorAction;
  } catch {
    return null;
  }
  const displayText = text.slice(0, start).trim();
  const discussionState: MeetingDiscussionState = {
    summary: raw.stateSummary?.trim() || displayText,
    openQuestions: Array.isArray(raw.openQuestions)
      ? raw.openQuestions.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(String)
      : [],
  };
  if (raw.type === 'ask_user' && raw.question?.trim() && Array.isArray(raw.questions)) {
    const items = raw.questions
      .filter(
        (item): item is Exclude<NonNullable<RawModeratorAction['questions']>[number], string> =>
          typeof item === 'object' && item !== null && Boolean(item.prompt?.trim()) && Array.isArray(item.options)
      )
      .slice(0, 3)
      .map((item, questionIndex) => ({
        id: `${actionId}-question-${questionIndex + 1}`,
        prompt: item.prompt!.trim(),
        options: item
          .options!.filter((option) => option?.label?.trim())
          .slice(0, 4)
          .map((option, optionIndex) => ({
            id: `${actionId}-question-${questionIndex + 1}-option-${optionIndex + 1}`,
            label: option.label!.trim(),
            description: option.description?.trim() || undefined,
          })),
      }))
      .filter((item) => item.options.length >= 2);
    if (items.length > 0) {
      return {
        displayText,
        discussionState,
        action: {
          type: 'ask_user',
          question: { id: actionId, prompt: raw.question.trim(), items, options: [] },
        },
      };
    }
  }
  if (raw.type === 'ask_user' && raw.question?.trim() && Array.isArray(raw.options)) {
    const options = raw.options
      .filter((option) => option?.label?.trim())
      .slice(0, 4)
      .map((option, index) => ({
        id: `${actionId}-${index + 1}`,
        label: option.label!.trim(),
        description: option.description?.trim() || undefined,
      }));
    if (options.length < 3) return null;
    const questions = Array.isArray(raw.questions)
      ? raw.questions
          .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
          .map((item) => item.trim())
          .slice(0, 3)
      : [];
    if (questions.length < 1) return null;
    return {
      displayText,
      discussionState,
      action: {
        type: 'ask_user',
        question: {
          id: actionId,
          prompt: raw.question.trim(),
          questions: questions.length > 0 ? questions : undefined,
          options,
        },
      },
    };
  }
  if (raw.type === 'consult_advisors' && raw.instruction?.trim() && Array.isArray(raw.targetNames)) {
    const targetNames = panelNames.filter((name) => raw.targetNames?.includes(name)).slice(0, 2);
    if (targetNames.length === 0) return null;
    return {
      displayText,
      discussionState,
      action: { type: 'consult_advisors', targetNames, instruction: raw.instruction.trim() },
    };
  }
  if (raw.type === 'research' && raw.query?.trim()) {
    return { displayText, discussionState, action: { type: 'research', query: raw.query.trim() } };
  }
  if (raw.type === 'suggest_close') {
    return {
      displayText,
      discussionState,
      action: { type: 'suggest_close', reason: raw.reason?.trim() || displayText },
    };
  }
  return null;
}

function actionProtocol(panelNames: string[]): string {
  return [
    '回复末尾必须输出且只输出一个动作块：',
    ACTION_OPEN,
    '{"type":"ask_user | consult_advisors | research | suggest_close","stateSummary":"当前认识","openQuestions":["未决问题"], ...动作字段}',
    ACTION_CLOSE,
    'ask_user 字段：question（批量问题标题）、questions（1-3项，绝不能超过 3 项）。questions 每项格式为 {"prompt":"具体问题","options":[{"label":"选项","description":"可选说明"}]}，每题提供 2-4 个独立选项。不要使用所有问题共用一组选项的旧格式。',
    `consult_advisors 字段：targetNames（只能取 ${panelNames.join('、')}）、instruction。`,
    'research 字段：query。suggest_close 字段：reason；它只会询问用户，不能自行结束会议。',
  ].join('\n');
}

export function buildDynamicModeratorPrompt(params: {
  topic: string;
  form: MeetingForm;
  panelNames: string[];
  transcript: string;
  referenceContext?: string;
  opening?: boolean;
  resumed?: boolean;
  discussionState?: MeetingDiscussionState;
  advisorContributionsSinceUser?: number;
  minimumAdvisorContributions?: number;
}): string {
  const {
    topic,
    form,
    panelNames,
    transcript,
    referenceContext,
    opening,
    resumed,
    discussionState,
    advisorContributionsSinceUser = 0,
    minimumAdvisorContributions = Math.min(1, panelNames.length),
  } = params;
  return [
    '你是深度讨论的核心主持人，同时也是能独立判断的首席参谋。会议不是采访用户，也不是固定剧本；你的职责是识别根问题、提出有依据的判断、组织顾问交叉讨论，再决定下一步最有信息价值的动作。',
    `议题：${topic}`,
    `主持风格：${form}（它只是风格偏好，不是固定流程）`,
    `可调度顾问：${panelNames.join('、')}`,
    referenceContext ? `背景资料：\n${referenceContext}` : '',
    discussionState?.summary ? `上次主持判断：${discussionState.summary}` : '',
    discussionState?.openQuestions?.length ? `尚未解决：${discussionState.openQuestions.join('；')}` : '',
    opening || resumed
      ? '当前处于开场或恢复节点；如果用户意图存在关键缺口，可以直接 ask_user。'
      : `自用户上次回应后，顾问已贡献 ${advisorContributionsSinceUser} 次；达到 ${minimumAdvisorContributions} 次后才可再次 ask_user。`,
    transcript ? `完整会议记录：\n${transcript}` : '',
    opening
      ? `这是开场。先判断议题是否已经包含明确的决策目标、成功标准和关键约束。只要其中存在会影响分析方向的缺口，就先用 ask_user 集中询问 1-3 个最关键问题；如果信息已经足够明确，再用 consult_advisors 点名 ${Math.min(2, panelNames.length)} 位最相关顾问展开首轮讨论。不要为了走流程而提问。`
      : '',
    resumed
      ? '这是恢复的会议。先说明你理解的进展和当前判断；如果用户接下来想解决的重点不明确，可以先用 ask_user 集中确认 1-3 个问题，否则继续调度顾问。'
      : '',
    !opening && !resumed
      ? `评估最新内容后选择一个最有价值的下一步。通常每轮点名 1-2 位相关顾问，并要求后发言者明确回应前序观点；顾问带来信息增量后，应主动寻找用户参与节点，让用户确认目标、取舍、事实或风险偏好。不要连续多轮只让顾问说，也不要连续追问用户或把分析责任推给用户。`
      : '',
    !opening && !resumed && advisorContributionsSinceUser >= 2
      ? '自用户上次回应后已经连续完成至少两次顾问贡献。本轮必须优先用 ask_user 邀请用户确认关键取舍、事实或风险偏好；只有当前确实没有任何需要用户确认的信息时，才可继续调度顾问。'
      : '',
    '动作块之前必须输出有信息增量的主持话语，使用 Markdown，依次包含“### 核心判断”“### 判断依据”“### 下一步”。核心判断要亮明倾向，依据要提炼顾问共识、分歧或证据，不能只复述流程。不要暴露协议或 JSON。',
    '需要 ask_user 时，优先一次询问 2-3 个相互关联的高价值问题，简单场景可只问 1 个，绝不能超过 3 个；每个问题都要有自己的清晰选项，并在 description 中标出你的推荐及理由。用户回答后应先推进分析，不要立刻再次追问。',
    actionProtocol(panelNames),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildModeratorActionRepairPrompt(panelNames: string[]): string {
  return ['你刚才的动作块无效。不要重复长篇内容，请按协议重新输出一个有效动作。', actionProtocol(panelNames)].join(
    '\n\n'
  );
}

export function buildDynamicAdvisorPrompt(params: {
  topic: string;
  persona: string;
  lens?: string;
  instruction: string;
  transcript: string;
  referenceContext?: string;
}): string {
  return [
    `你是顾问「${params.persona}」（主攻：${params.lens ?? '综合'}）。主持人只在当前问题需要你时点名，请正面完成任务，不要自行扩展会议流程。`,
    `议题：${params.topic}`,
    `主持任务：${params.instruction}`,
    params.referenceContext ? `背景资料：\n${params.referenceContext}` : '',
    `截至你发言前的会议记录：\n${params.transcript}`,
    '必须明确引用至少一个前序观点并选择：赞同并补强、反驳并给证据、或指出其遗漏。随后给出你的独立判断、关键依据、风险边界和一条可执行建议；不要只做泛泛总结。直接发言。',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildDiscussionNotesPrompt(topic: string, transcript: string): string {
  return [
    '你是会议主持人。用户主动结束了讨论。请生成讨论纪要，不要强行形成结论、推荐方案或候选拍板卡。',
    `议题：${topic}`,
    `会议记录：\n${transcript}`,
    '使用 Markdown，依次整理：已确认的认识、关键分歧及依据、用户偏好与约束、尚未解决的问题、可选的下一步探索。只输出纪要正文。',
  ].join('\n\n');
}

/**
 * Distinct angles assigned (round-robin) to panelists so the debate has REAL
 * perspective diversity — otherwise different agents tend to say the same thing.
 * Each agent keeps its own model strengths but champions one angle.
 */
export const PANEL_LENSES: string[] = [
  '增长与商业化（收入、转化、规模化、增长杠杆）',
  '风险与合规（法律、安全、声誉、可逆性、最坏情况）',
  '用户与体验（留存、口碑、信任、易用、真实需求）',
  '财务与 ROI（成本结构、回报周期、现金流、单位经济）',
  '技术与可行性（实现难度、依赖、工程量、交付节奏）',
  '竞争与市场（差异化、时机、对手反应、终局格局）',
  '长期与战略（护城河、复利效应、组织能力、十年后）',
];

/** UI metadata for the discussion-format picker. */
export const MEETING_FORMS: { id: MeetingForm; label: string; hint: string }[] = [
  { id: 'roundtable', label: '圆桌共识', hint: '主持倾向平衡各方观点、识别共识与真实分歧' },
  { id: 'redteam', label: '红蓝对抗', hint: '主持倾向主动攻击假设、暴露风险与论证漏洞' },
  { id: 'tournament', label: '方案竞标', hint: '主持倾向比较不同路径的机制、代价与适用条件' },
  { id: 'diverge', label: '发散收敛', hint: '主持倾向探索更多可能性，再帮助用户选择深挖方向' },
  { id: 'deepdive', label: '逐层深挖', hint: '主持倾向连续追问根因、证据与边界条件' },
];

/**
 * Assemble the optional 背景资料 block from knowledge-base hits and/or shared
 * library files, mirroring how a normal conversation folds in retrieved context
 * and attached files. Returns '' when there's nothing to add.
 */
export function buildReferenceContext(knowledgeContext: string | null, attachmentPaths: string[]): string {
  const sections: string[] = [];
  if (knowledgeContext?.trim()) {
    sections.push(`── 知识库检索结果 ──\n${knowledgeContext.trim()}`);
  }
  if (attachmentPaths.length > 0) {
    const list = attachmentPaths.map((p) => `- ${p}`).join('\n');
    sections.push(`── 共享库资料（本机文件，可用文件读取工具打开查阅）──\n${list}`);
  }
  if (sections.length === 0) return '';
  return ['【背景资料 / 参考材料】（请在讨论中充分参考）', ...sections].join('\n\n');
}

/** Roster line showing each panelist + their assigned angle, for the moderator. */
function lensRoster(panelists: PanelistBrief[]): string {
  return panelists.map((p) => (p.lens ? `${p.name}（主攻：${p.lens}）` : p.name)).join('；');
}

/**
 * Moderator opening — addressed to the BOSS (the user). Frames the real decision
 * tension, sets the agenda, and promises a result better than any single AI.
 */
export function buildModeratorOpeningPrompt(topic: string, panelists: PanelistBrief[]): string {
  return [
    '你是这场 AI 智囊团研讨的 leader / 主持人，面对的是【老板】（也就是用户本人），全程用中文、用主持人的口吻。',
    `本次议题：${topic}`,
    `与会专家及其主攻视角：${lensRoster(panelists)}`,
    '',
    '请完成开场（务实有力，可稍长，不要套话）：',
    '1）一两句话点破这个决策【真正的核心张力】是什么（不是泛泛重述题目，而是说清"难就难在哪")；',
    '2）把老板的问题拆成 2-4 个必须回答清楚的关键问题，并明确这些问题分别要抛给哪些专家视角去判断；',
    '3）说明你不会在第一轮抢顾问席，你的核心工作是主持、追问、提炼精华，并帮老板看见真正有价值的观点；',
    '4）明确告诉老板：顾问会按席位顺序逐一发言，并承接、引用或反驳前序观点；之后你会提炼重点、综合分歧，再邀请老板补充倾向或约束；',
    '5）邀请老板：如果有特别看重的约束（预算 / 时间 / 风险偏好 / 已定的红线），随时插话，我们会据此调整。',
    '最后把拆解后的问题抛给全体专家开始第一轮。只输出开场词本身。',
  ].join('\n');
}

/**
 * Optional moderator advisory turn retained for alternate flows. The current
 * advisor-meeting flow keeps the moderator in the host seat during 顾问立场.
 */
export function buildModeratorPositionPrompt(topic: string, panelists: PanelistBrief[], framing?: string): string {
  return [
    framing ? framing : '',
    '你是这场决策会议的主持人，也是首席顾问；开场主持已经完成，现在进入【顾问立场】。请你暂时以专家身份发表首席判断，但不要丢掉主持人的全局视角。',
    `决策议题：${topic}`,
    `与会专家及其主攻视角：${lensRoster(panelists)}`,
    '',
    '请直接发表你的首席专家观点（务实有力、可稍长、不说套话）：',
    '1）你的【首席判断 / 初步倾向】是什么，敢于亮明立场；',
    '2）最关键的 2-3 个理由，要说清机制、数据量级、因果链或真实案例；',
    '3）你最担心的风险或反对意见，以及老板最该盯住的一个指标或红线；',
    '4）提醒其他顾问可以从哪些角度挑战你的判断。',
    '不要再重复主持开场，不要宣布流程，只输出你的首席专家发言。',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Deep-dive (逐层深挖) — moderator drives a probing follow-up round, picking the
 * weakest-justified / most-uncertain points from the discussion so far and pressing on them.
 */
export function buildDeepDiveProbePrompt(params: { topic: string; round: number; priorContext: string }): string {
  const { topic, round, priorContext } = params;
  return [
    `你是主持人，进入第 ${round} 轮【逐层深挖】。请基于目前的讨论，挑出 2-3 个最关键、但还没被充分论证清楚、或分歧最大的点，向专家们追问下去。`,
    `议题：${topic}`,
    priorContext ? `\n讨论进展：\n${priorContext}` : '',
    '',
    '每个追问要具体、尖锐、指向决策（"如果……会怎样？""凭什么这么说？数据/机制是什么？""最坏情况是什么？"）。只输出你的追问，逐条列出。',
  ].join('\n');
}

/** Deep-dive — a panelist answers the moderator's probing questions from their angle. */
export function buildDeepDiveAnswerPrompt(params: {
  topic: string;
  persona: string;
  lens?: string;
  probeContext: string;
}): string {
  const { topic, persona, lens, probeContext } = params;
  return [
    `你是专家「${persona}」（主攻【${lens ?? '综合'}】）。主持人提出了一轮追问，请从你的视角【正面、深入】地回应——不回避、不打太极。`,
    `议题：${topic}`,
    `\n追问与上下文：\n${probeContext}`,
    '',
    '逐条回应你能回应的追问，给出具体依据（机制 / 数据量级 / 案例）；如果某点你也没把握，明确说出不确定性与它对决策的影响。',
  ].join('\n');
}

/**
 * Panelist opening position — from an assigned angle (lens), substantive and concrete.
 */
export function buildPanelistPositionPrompt(params: {
  topic: string;
  persona: string;
  lens?: string;
  priorContext: string;
}): string {
  const { topic, persona, lens, priorContext } = params;
  return [
    `你是参加这场智囊团研讨的专家「${persona}」。本场你主攻【${lens ?? '综合'}】这个视角——请充分发挥你（作为这个模型）独特的判断力，言之有物，绝不说正确的废话。`,
    `议题：${topic}`,
    priorContext ? `\n会议进展（已有发言）：\n${priorContext}` : '\n（你是第一位发言的专家）',
    '',
    '如果老板在上面有过插话/约束，必须把它当硬性前提。请给出你的立论（务实、具体、可落地）：',
    `1）从【${lens ?? '你的专业'}】视角，你的核心主张 / 推荐方向；`,
    '2）2-3 个最有力的理由——要具体到机制、数据量级、真实案例或因果链，不要抽象口号；',
    '3）这个方向最大的风险或最容易被忽视的盲点；',
    '4）预判一个其他视角最可能反驳你的点，并先给出你的回应。',
    '直接发言，有锋芒。',
  ].join('\n');
}

/**
 * Panelist cross-examination — forced to genuinely challenge others (no bland agreement).
 */
export function buildPanelistDebatePrompt(params: {
  topic: string;
  persona: string;
  lens?: string;
  round: number;
  recentContext: string;
}): string {
  const { topic, persona, lens, recentContext } = params;
  return [
    `你是专家「${persona}」（主攻【${lens ?? '综合'}】），现在进入【交锋质询】环节。请真正地辩论，绝不要附和或重复自己。`,
    `议题：${topic}`,
    '',
    '其他专家的发言：',
    recentContext || '（暂无）',
    '',
    '请做到（直接发言，火药味可以有，但对事不对人、要讲理）：',
    '1）明确点出至少一位专家观点里【最站不住脚 / 风险最大 / 论证最弱】的地方，并说清为什么；',
    '2）如果别人某个点真的说服了你，坦诚承认并据此【调整你的立场】——被说服不丢人，假装没听见才丢人；',
    `3）从你的【${lens ?? '专业'}】视角，补一个目前全场都没提到、但会影响最终决策的关键考量。`,
  ].join('\n');
}

/** Moderator mid-point — summarize for the BOSS and surface the real trade-off to decide. */
export function buildModeratorConvergePrompt(topic: string): string {
  return [
    '你是主持人。专家们已充分交锋，现在请你向【老板】做一次中场小结（口语化、清楚）。',
    `议题：${topic}`,
    '',
    '请讲清三块（精炼）：',
    '【已形成的共识】大家其实都同意的点；',
    '【真正的分歧】仍然对立、且会影响结论的点——别和稀泥，如实说清两边各自的道理；',
    '【需要老板权衡的核心取舍】把这个决策最终落到老板要在"什么 vs 什么"之间做选择，并明确邀请老板此刻可以插话表达倾向。',
    '只做小结、抛出取舍，先不要给最终方案。',
  ].join('\n');
}

/**
 * Between-round PAUSE summary: the moderator recaps the round in plain language for
 * the boss and invites them to react, so the boss can read at their own pace and
 * feel part of the discussion (the UI then waits for the boss to click 继续讨论).
 */
export function buildRoundPausePrompt(args: {
  topic: string;
  round: number;
  stage: string;
  recentContext: string;
}): string {
  return [
    `你是这场 AI 智囊团研讨的主持人，面对的是【老板】。专家们刚完成了「${args.stage}」这一轮。`,
    `议题：${args.topic}`,
    '',
    '下面是专家们这一轮的发言，请你据此总结（不要照抄，要提炼）：',
    args.recentContext || '（暂无）',
    '',
    '请用口语化、简洁的中文，做一段"让老板秒懂并能参与"的小结：',
    '1）先按专家逐一提炼：每位专家最有价值的 1-2 个观点是什么，不要让老板自己去读长篇发言；',
    '2）再做综合：哪些观点已经形成共识，哪些分歧真的会影响结论，哪些观点可以被组合成更强方案；',
    '3）点出此刻最值得老板关注或拿主意的 1 个问题/取舍；',
    '4）最后用一句话邀请老板：可以在下方补充想法或提出关注点，看完后点「继续讨论」进入下一环节。',
    '不要长篇大论，重点是把节奏交给老板，让他跟得上、愿意参与。先不要给最终方案。',
  ].join('\n');
}

/** Moderator joins the debate as a host: not an extra first-round opinion, but a pressure tester. */
export function buildModeratorDebatePrompt(params: { topic: string; recentContext: string }): string {
  return [
    '你是这场决策会议的 leader / 主持人。现在进入交锋阶段，你必须深度参与辩论，但你的目标不是证明自己对，而是挖出真正有价值、能回答老板关键决策问题的观点。',
    `议题：${params.topic}`,
    '',
    '当前讨论：',
    params.recentContext || '（暂无）',
    '',
    '请直接主持追辩：',
    '1）点名 2-3 个最值得继续追问的专家观点，说清它们为什么关键；',
    '2）指出至少 1 个论证不足、假设过强或相互冲突的地方，并提出尖锐问题；',
    '3）把可被整合的观点合成一个更强判断，说明它如何回答老板的核心问题；',
    '4）如果有某个专家观点被你认为应该升级为最终方案的重要组成部分，要明确标出。',
    '语言要像会议主持，不要像论文摘要；允许有锋芒，但对事不对人。',
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

/**
 * Final moderator synthesis for the renderer-orchestrated meeting: given the full
 * transcript, emit a high-quality 方案书 (wrapped in PLAN markers) + 2-3 candidate
 * options (OPTION markers) so the UI can parse them. Used by the local loop.
 */
export function buildLocalSynthesisPrompt(topic: string, transcriptText: string): string {
  return [
    '你是这场智囊团研讨的主持人，面对的是【老板】。全场专家已从不同视角充分博弈、互相挑刺。现在请你产出最终成果——它必须【明显优于任何单个 AI 的一次性回答】，这正是开智囊团研讨的全部意义。',
    `议题：${topic}`,
    '',
    '全场发言（含老板的插话，如有则必须当作硬性约束）：',
    transcriptText || '（无）',
    '',
    '请输出两部分。',
    '',
    `第一部分——一份厚实、具体、有洞察的《方案书》，严格用 ${PLAN_OPEN} 与 ${PLAN_CLOSE} 包裹，内部用 markdown，必须包含以下小节：`,
    '## 背景与真正的决策张力',
    '## 推荐方案',
    '（要具体可执行：关键决策、分步骤怎么做、关键参数/指标/节奏，落到能直接照着干，不要停在原则和正确的废话）',
    '## 为什么这个方案更优',
    '（这一节是重点：明确点出——综合了多位专家后，发现了哪些【单一视角会忽略】的关键？方案如何同时兼顾增长 / 风险 / 用户 / 财务 / 技术等多方，做到任何单个 AI 一次性回答都给不出的平衡。用"如果只问一个 AI，多半只会说 X；但综合后我们看到 Y、Z 才是胜负手"这种对比讲清楚价值。）',
    '## 关键论证与依据',
    '## 风险与应对（每条风险都配上具体的缓解/对冲措施）',
    '## 仍需老板拍板的关键取舍（如实保留真实分歧，绝不和稀泥；说清每个选择的代价）',
    '## 下一步可立即执行的行动清单',
    '',
    `第二部分——再给老板 2-3 个【有真实差异】的可对比候选方案（不是同一方案的换皮），每个严格用如下格式：`,
    `${OPTION_OPEN} 方案标题`,
    '核心思路：……',
    '优点：……',
    '风险/代价：……',
    '适用场景：……',
    OPTION_CLOSE,
    '',
    '要求：方案书要厚（信息密度高、有具体抓手），不要凑字数也不要单薄；语言对老板说话。',
  ].join('\n');
}

// --- Per-form panelist/moderator prompts for the local orchestrator ---------
// roundtable uses position/debate above; the three formats below reuse the
// common opening + synthesis and only differ in the middle phases.

/** redteam ①起草: one panelist drafts a full initial proposal. */
export function buildDraftPrompt(params: { topic: string; persona: string; reference?: string }): string {
  const { topic, persona, reference } = params;
  return [
    `你是专家「${persona}」，本场采用【红蓝评审】，由你先打草稿。请拿出一份【完整、具体、可被攻击】的初步方案——越具体越好，方便其他专家挑刺。`,
    `议题：${topic}`,
    reference ? `\n参考资料：\n${reference}` : '',
    '',
    '给出：核心思路、关键决策与步骤、你认为最关键的假设（红队会攻击它们）。直接发言。',
  ]
    .filter(Boolean)
    .join('\n');
}

/** redteam ②红队: other panelists attack the draft from their angle. */
export function buildRedTeamPrompt(params: {
  topic: string;
  persona: string;
  lens?: string;
  draftContext: string;
}): string {
  const { topic, persona, lens, draftContext } = params;
  return [
    `你是专家「${persona}」（主攻【${lens ?? '综合'}】），现在作为【红队】。你的唯一任务是尽全力攻破下面这份草案——找出最致命的漏洞、最站不住的假设、最大的风险。`,
    `议题：${topic}`,
    '',
    '待攻击的草案与讨论：',
    draftContext || '（暂无）',
    '',
    `请从【${lens ?? '你的专业'}】视角给出 2-3 个最有杀伤力的攻击点：每个点说清"哪里错/哪里危险 + 为什么 + 会导致什么后果"，并给出你建议的修补方向。对事不对人，但不要手软。`,
  ].join('\n');
}

/** redteam ③修订: the drafter revises the draft per the red-team critiques. */
export function buildRevisePrompt(params: { topic: string; persona: string; critiqueContext: string }): string {
  const { topic, persona, critiqueContext } = params;
  return [
    `你是草案的起草人「${persona}」。红队已对你的草案发起攻击，请据此【认真修订】——能接受的批评就改、说清怎么改；不接受的要给出有力反驳，不许回避。`,
    `议题：${topic}`,
    '',
    '红队意见与讨论：',
    critiqueContext || '（暂无）',
    '',
    '给出修订后的方案：逐条回应关键攻击（采纳/反驳），并呈现强化后的完整方案。',
  ].join('\n');
}

/** tournament ①提案: each panelist independently produces a full competing plan. */
export function buildProposalPrompt(params: {
  topic: string;
  persona: string;
  lens?: string;
  reference?: string;
}): string {
  const { topic, persona, lens, reference } = params;
  return [
    `你是专家「${persona}」，本场采用【多方案竞标】。请【独立】产出一份完整、自洽、可落地的方案参赛——带上你（这个模型）独特的判断，鼓励有鲜明侧重（如更激进/更稳健、MVP 优先/风险优先）。`,
    `议题：${topic}`,
    lens ? `建议侧重视角：${lens}` : '',
    reference ? `\n参考资料：\n${reference}` : '',
    '',
    '给出：方案标题、核心思路、关键步骤、最大优点、已知风险与应对。这是一份要被评委和其他方案比较的【完整提案】，别只给原则。',
  ]
    .filter(Boolean)
    .join('\n');
}

/** diverge ①发散: each panelist independently brainstorms many ideas (no peeking). */
export function buildDivergePrompt(params: { topic: string; persona: string; lens?: string }): string {
  const { topic, persona, lens } = params;
  return [
    `你是专家「${persona}」（主攻【${lens ?? '综合'}】），本场采用【发散→收敛】，现在是【发散】环节。请【尽可能多】地抛出不同思路，最大化多样性——宁要数量和新意，不要急着自我筛选或求稳。`,
    `议题：${topic}`,
    '',
    `从【${lens ?? '你的专业'}】视角，给出 5-8 个有差异的点子/方向（每个一两句话说清），可以包含一两个大胆的非常规想法。先不要互相评判，纯发散。`,
  ].join('\n');
}

/** diverge ②聚类: moderator clusters/dedupes/ranks all the diverged ideas. */
export function buildClusterPrompt(params: { topic: string; ideasContext: string }): string {
  const { topic, ideasContext } = params;
  return [
    '你是主持人。专家们已完成头脑风暴发散，请你把所有点子【聚类、去重、合并】，整理成几个清晰的方向簇，并按价值/可行性排序。',
    `议题：${topic}`,
    '',
    '所有发散的点子：',
    ideasContext || '（暂无）',
    '',
    '输出：3-5 个方向簇，每簇一个标题 + 一句话说清它代表什么 + 归并了哪些点子。最后点出最值得深入收敛的 2-3 个簇，邀请专家下一步聚焦。',
  ].join('\n');
}

/** diverge ③收敛: each panelist converges on the top clusters into a concrete take. */
export function buildConvergePrompt(params: {
  topic: string;
  persona: string;
  lens?: string;
  clustersContext: string;
}): string {
  const { topic, persona, lens, clustersContext } = params;
  return [
    `你是专家「${persona}」（主攻【${lens ?? '综合'}】），进入【收敛】环节。请围绕主持人梳理出的重点方向簇，把它落成具体、可执行的主张。`,
    `议题：${topic}`,
    '',
    '主持人的聚类与重点方向：',
    clustersContext || '（暂无）',
    '',
    `从【${lens ?? '你的专业'}】视角，选你最看好的方向，给出：具体怎么做（步骤/关键决策）、为什么它在收敛后胜出、以及一个落地时要盯住的风险。`,
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
 * Task asking the leader (who has officecli + file skills) to archive the 方案书
 * as Word/Markdown into the workspace, where it surfaces in the Content Hub.
 */
export function buildExportTask(plan: string): string {
  return [
    '请把下面这份《方案书》整理并归档到当前工作区目录（之后可在「内容中心」查看）：',
    '1）用 officecli 导出为 Word（.docx）一份；',
    '2）同时保存一份 Markdown（.md）。',
    '不要生成 PPT / PPTX。',
    '文件名用方案书标题或议题，保存完成后简要回复保存的文件名。',
    '',
    '《方案书》原文：',
    plan,
  ].join('\n');
}

/** Extract the synthesized 方案书 (markdown) from the leader's final message. */
export function parsePlan(text: string): string {
  if (!text) return '';
  const m = new RegExp(`${PLAN_OPEN}([\\s\\S]*?)${PLAN_CLOSE}`).exec(text);
  return m ? m[1].trim() : '';
}

/**
 * Strip the machine option blocks from a message for display — the parsed
 * options render as cards, so the raw `@@OPTION@@…@@END@@` markers shouldn't
 * show in the timeline.
 */
export function stripResolutionMarkers(text: string): string {
  if (!text || (!text.includes(OPTION_OPEN) && !text.includes(PLAN_OPEN))) return text;
  return text
    .replace(new RegExp(`${PLAN_OPEN}[\\s\\S]*?${PLAN_CLOSE}`, 'g'), '')
    .replace(new RegExp(`${OPTION_OPEN}[\\s\\S]*?${OPTION_CLOSE}`, 'g'), '')
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

/** Whitespace-only replies count as no speech throughout the meeting loop. */
export function hasValidMeetingSpeech(text: string): boolean {
  return text.trim().length > 0;
}
