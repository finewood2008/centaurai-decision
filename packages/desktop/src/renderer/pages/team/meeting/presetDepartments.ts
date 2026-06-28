/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preset decision-department TEMPLATES for the 决策会议室 (Decision edition).
 *
 * A department is an OPTIONAL shortcut chosen when creating a 决策会议室: picking it
 * pre-fills the discussion method (`form`) and injects domain flavor — a framing
 * line for the opening and a set of domain `lenses` (the angles each AI is assigned).
 * The boss can also just pick a discussion method manually with no department.
 *
 * Departments do NOT define their own phase sequence — every meeting runs the
 * universal backbone (① 并行立场 → ② 交锋讨论 → ③ 综合决议). The department only
 * changes the flavor, not the structure.
 */
import type { MeetingForm } from './meetingTypes';

export type PresetDepartment = {
  id: string;
  /** i18n key in the `decision` namespace, e.g. 'decision.dept.marketing.name'. */
  nameKey: string;
  /** i18n key for the one-line description. */
  hintKey: string;
  /** Default discussion method this template pre-selects (the boss can change it). */
  form: MeetingForm;
  /** Chinese framing prepended to the opening — sets the department context. */
  framing: string;
  /** Domain angles assigned round-robin to the panel (overrides the global PANEL_LENSES). */
  lenses: string[];
};

export const PRESET_DEPARTMENTS: PresetDepartment[] = [
  {
    id: 'marketing',
    nameKey: 'decision.dept.marketing.name',
    hintKey: 'decision.dept.marketing.hint',
    form: 'diverge',
    framing: '本场为【市场部】决策会议，围绕营销策略、品牌、增长与投放。请各位从市场视角帮老板做出可落地的决策。',
    lenses: ['品牌定位与心智', '增长与获客', '投放与 ROI', '内容与传播', '竞品动作与时机'],
  },
  {
    id: 'product',
    nameKey: 'decision.dept.product.name',
    hintKey: 'decision.dept.product.hint',
    form: 'roundtable',
    framing: '本场为【产品部】决策会议，围绕产品方向、需求取舍与路线落地。请帮老板做出清晰的产品决策。',
    lenses: ['用户价值与真实需求', '需求真伪与优先级', '技术可行性', '商业模式与回报', '体验与细节'],
  },
  {
    id: 'legal',
    nameKey: 'decision.dept.legal.name',
    hintKey: 'decision.dept.legal.hint',
    form: 'redteam',
    framing: '本场为【法务部】决策会议，围绕法律风险、合规与处置。请帮老板守住法律底线、给出可执行处置。',
    lenses: ['合同与条款', '合规与监管', '知识产权', '诉讼与纠纷风险', '声誉与公关风险'],
  },
  {
    id: 'finance',
    nameKey: 'decision.dept.finance.name',
    hintKey: 'decision.dept.finance.hint',
    form: 'deepdive',
    framing: '本场为【财务部】决策会议，围绕数据测算、现金流与财务风险。请用数字帮老板把账算清楚、把风险挖透。',
    lenses: ['现金流与流动性', '单位经济与毛利', '预算与成本结构', '回报周期与 IRR', '财务与税务风险'],
  },
  {
    id: 'operations',
    nameKey: 'decision.dept.operations.name',
    hintKey: 'decision.dept.operations.hint',
    form: 'roundtable',
    framing: '本场为【运营部】决策会议，围绕流程、执行与效率。请帮老板把事情高效落地。',
    lenses: ['流程与效率', '执行与落地', '数据与指标', '成本与资源', '供应链与协同'],
  },
  {
    id: 'hr',
    nameKey: 'decision.dept.hr.name',
    hintKey: 'decision.dept.hr.hint',
    form: 'roundtable',
    framing: '本场为【人力部 / HR】决策会议，围绕组织、人才与团队。请兼顾业务目标与团队的公平与稳定。',
    lenses: ['组织与架构', '人才与梯队', '激励与文化', '合规与公平', '团队稳定与风险'],
  },
  {
    id: 'strategy',
    nameKey: 'decision.dept.strategy.name',
    hintKey: 'decision.dept.strategy.hint',
    form: 'tournament',
    framing: '本场为【战略部】决策会议，围绕目标、多方案竞标与定案。请帮老板在多套方案中选出最优战略。',
    lenses: ['长期护城河', '竞争与终局', '资源配置', '时机与窗口', '风险对冲'],
  },
];

export function resolveDepartment(id?: string | null): PresetDepartment | undefined {
  if (!id) return undefined;
  return PRESET_DEPARTMENTS.find((d) => d.id === id);
}
