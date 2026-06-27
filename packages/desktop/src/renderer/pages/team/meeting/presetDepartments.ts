/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preset decision departments for the DECISION edition (决策会议室).
 *
 * Each department is a fixed, boss-facing 决策流程: a name + a dedicated phase
 * sequence (专有流程), each phase carrying its own preset prompt (提示词) and a
 * framing line for the moderator's opening. The boss picks a department when
 * creating a 决策会议室; the workflow (form='department') + departmentId are then
 * fixed — there is no runtime flow picker.
 *
 * The orchestrator (useMeetingOrchestrator) runs the phases generically: for each
 * phase the panel discusses per `instruction`, then a moderator 综合 → 决议. Adding
 * or editing a department's 流程 is a data-only change here — no engine code.
 *
 * Phase labels/instructions are plain Chinese, consistent with meetingPrompts.ts
 * (the whole model-facing prompt layer is Chinese). Department NAME/HINT are i18n
 * keys (decision.dept.*) so the create-dialog picker localizes.
 */

export type DeptPhase = {
  /** Stable key (for phase bar / display dedupe). */
  key: string;
  /** Boss-facing phase label, e.g. 风险识别. Also used as the transcript phaseLabel. */
  label: string;
  /** Department-specific instruction for this phase — the preset 提示词. */
  instruction: string;
};

export type PresetDepartment = {
  id: string;
  /** i18n key in the `decision` namespace, e.g. 'decision.dept.marketing.name'. */
  nameKey: string;
  /** i18n key for the one-line description. */
  hintKey: string;
  /** Chinese framing prepended to the moderator's opening prompt. */
  framing: string;
  /** The fixed 专有流程 — substantive phases (the boss's 决议 is the resolution stage that follows). */
  phases: DeptPhase[];
};

export const PRESET_DEPARTMENTS: PresetDepartment[] = [
  {
    id: 'marketing',
    nameKey: 'decision.dept.marketing.name',
    hintKey: 'decision.dept.marketing.hint',
    framing: '本次为【市场部】决策会议，围绕营销策略、品牌、增长与投放展开。请各位专家以帮老板做出可落地的市场决策为目标。',
    phases: [
      { key: 'insight', label: '现状洞察', instruction: '梳理当前市场、用户与竞争的现状与关键数据，指出最值得关注的事实、机会点与威胁。' },
      { key: 'diverge', label: '创意发散', instruction: '围绕议题尽可能多地发散营销创意与打法，先不预设可行性，追求数量与角度的多样性。' },
      { key: 'converge', label: '策略收敛', instruction: '从已有创意中收敛出 2-3 个最具性价比、可落地的核心策略，并说明取舍理由。' },
      { key: 'budget', label: '预算与投放', instruction: '为收敛后的策略给出预算分配、渠道与投放建议，以及预期 ROI 区间与衡量指标。' },
    ],
  },
  {
    id: 'product',
    nameKey: 'decision.dept.product.name',
    hintKey: 'decision.dept.product.hint',
    framing: '本次为【产品部】决策会议，围绕产品方向、需求取舍与路线落地展开。请以为老板做出清晰的产品决策为目标。',
    phases: [
      { key: 'clarify', label: '需求澄清', instruction: '澄清议题背后的真实用户需求与问题，区分"想要"与"真正需要"，列出关键假设。' },
      { key: 'tradeoff', label: '多角度权衡', instruction: '从用户价值、技术可行性、商业回报、风险等角度权衡各可选方向的利弊。' },
      { key: 'decide', label: '方案取舍', instruction: '在多个方向中取舍出推荐方案，明确"做什么、不做什么"及其原因。' },
      { key: 'roadmap', label: '路线落地', instruction: '给出推荐方案的里程碑、优先级与落地路线，标出最大风险与外部依赖。' },
    ],
  },
  {
    id: 'legal',
    nameKey: 'decision.dept.legal.name',
    hintKey: 'decision.dept.legal.hint',
    framing: '本次为【法务部】决策会议，围绕法律风险、合规与处置展开。请以帮老板守住法律底线、给出可执行处置为目标。',
    phases: [
      { key: 'risk', label: '风险识别', instruction: '识别本议题涉及的主要法律与合规风险点，并按严重程度排序。' },
      { key: 'clause', label: '条款审查', instruction: '针对关键合同、条款或对外承诺逐条审查，指出有问题或需补强之处。' },
      { key: 'compliance', label: '合规校验', instruction: '对照相关法律法规与监管要求校验合规性，标出"红线"与"灰区"。' },
      { key: 'remedy', label: '处置建议', instruction: '为识别出的风险给出可执行的处置、规避或补救建议，并标明优先级。' },
    ],
  },
  {
    id: 'finance',
    nameKey: 'decision.dept.finance.name',
    hintKey: 'decision.dept.finance.hint',
    framing: '本次为【财务部】决策会议，围绕数据测算、现金流与财务风险展开。请用数字帮老板把账算清楚。',
    phases: [
      { key: 'data', label: '数据现状', instruction: '梳理与议题相关的关键财务数据与现状（收入、成本、现金流、利润率等）。' },
      { key: 'assume', label: '假设设定', instruction: '明确测算所依赖的关键假设，并标出最敏感、最不确定的假设。' },
      { key: 'model', label: '测算推演', instruction: '基于假设进行测算与情景推演（乐观/中性/悲观），给出关键结论数字。' },
      { key: 'stress', label: '风险压测', instruction: '对结论做压力测试，指出最坏情况与现金流、回报上的风险点。' },
    ],
  },
  {
    id: 'operations',
    nameKey: 'decision.dept.operations.name',
    hintKey: 'decision.dept.operations.hint',
    framing: '本次为【运营部】决策会议，围绕流程、执行与效率展开。请以帮老板把事情高效落地为目标。',
    phases: [
      { key: 'diagnose', label: '问题诊断', instruction: '诊断当前运营或执行中的核心问题与瓶颈，用数据或具体事实支撑。' },
      { key: 'breakdown', label: '流程拆解', instruction: '把相关流程拆解到关键环节，定位低效或断点所在。' },
      { key: 'design', label: '方案设计', instruction: '针对瓶颈设计可执行的改进方案，说明预期效果与代价。' },
      { key: 'schedule', label: '执行排期', instruction: '给出落地的责任分工、节奏与排期，标出关键依赖与风险。' },
    ],
  },
  {
    id: 'hr',
    nameKey: 'decision.dept.hr.name',
    hintKey: 'decision.dept.hr.hint',
    framing: '本次为【人力部 / HR】决策会议，围绕组织、人才与团队展开。请兼顾业务目标与团队公平稳定。',
    phases: [
      { key: 'assess', label: '现状评估', instruction: '评估与议题相关的组织、人才与团队现状及关键事实。' },
      { key: 'views', label: '多方视角', instruction: '从管理者、员工、业务与合规等多方视角分析议题的影响与诉求。' },
      { key: 'weigh', label: '方案权衡', instruction: '权衡可选的人事或组织方案的利弊、公平性与可执行性。' },
      { key: 'land', label: '落地与风险', instruction: '给出推荐方案的落地步骤与沟通策略，标出法律与团队稳定性风险。' },
    ],
  },
  {
    id: 'strategy',
    nameKey: 'decision.dept.strategy.name',
    hintKey: 'decision.dept.strategy.hint',
    framing: '本次为【战略部】决策会议，围绕目标、多方案竞标与定案展开。请帮老板在多套方案中选出最优战略。',
    phases: [
      { key: 'goal', label: '目标定义', instruction: '厘清本次战略议题要达成的核心目标与成功标准。' },
      { key: 'bid', label: '多方案竞标', instruction: '每位专家独立提出一套完整的战略方案（目标—路径—资源—风险），越具体越好。' },
      { key: 'score', label: '评审打分', instruction: '对各方案从可行性、回报、风险、护城河等维度评审打分，指出优劣。' },
      { key: 'finalize', label: '综合定案', instruction: '综合各方案的优点，收敛出推荐的战略定案与关键取舍。' },
    ],
  },
];

export function resolveDepartment(id?: string | null): PresetDepartment | undefined {
  if (!id) return undefined;
  return PRESET_DEPARTMENTS.find((d) => d.id === id);
}
