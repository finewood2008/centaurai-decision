/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for the expert ("agency-*") taxonomy.
 *
 * The expert library was re-curated for Chinese SMEs: 18 English-named source
 * departments are remapped to ~11 SME-facing "经营科室" (business clinics),
 * ordered by how often an SME owner consults them. Both the home expert
 * showcase (`AssistantSelectionArea`) and the full catalog (`AdvisorsPage`)
 * import from here so their grouping and ordering never drift apart.
 *
 * Resolution order for an expert's department:
 *   1. {@link EXPERT_DEPARTMENT_OVERRIDE} — explicit per-id placement for the
 *      cross-department movers (e.g. HR/CFO roles that lived under `specialized`).
 *   2. {@link CATEGORY_TO_DEPARTMENT} — default by the id's source category.
 *
 * Curation (which experts are shown) is independent: surfaces filter by the
 * backend `enabled` flag, so disabling an expert in Settings hides it and
 * re-enabling brings it back into its resolved 科室 — no code change needed.
 */

/** SME-facing departments, ordered by consultation frequency. */
export const SME_DEPARTMENT_ORDER = [
  '市场获客',
  '付费投放',
  '销售成交',
  '战略与增长',
  '财税与资金',
  '人力与团队',
  '运营提效',
  '项目与协作',
  '设计与创意',
  '数字化与建站',
  '行业专家',
] as const;

/** Default department selected when the expert views first open. */
export const DEFAULT_SME_DEPARTMENT = '市场获客';

/**
 * Source-category → SME department. Categories that were curated out entirely
 * (gis / spatial-computing / game-development / integrations / etc.) still map
 * to a sensible home so a re-enabled expert lands somewhere coherent.
 */
const CATEGORY_TO_DEPARTMENT: Record<string, string> = {
  marketing: '市场获客',
  'paid-media': '付费投放',
  sales: '销售成交',
  product: '战略与增长',
  strategy: '战略与增长',
  finance: '财税与资金',
  academic: '人力与团队',
  support: '运营提效',
  testing: '运营提效',
  'project-management': '项目与协作',
  design: '设计与创意',
  engineering: '数字化与建站',
  gis: '数字化与建站',
  'spatial-computing': '数字化与建站',
  integrations: '数字化与建站',
  'game-development': '设计与创意',
  security: '行业专家',
  specialized: '行业专家',
};

/**
 * Per-id overrides — experts whose natural home differs from their source
 * category (mostly `specialized`/`support` roles split into 财税/人力/战略/运营).
 * Keys are full assistant ids.
 */
const EXPERT_DEPARTMENT_OVERRIDE: Record<string, string> = {
  'agency-specialized-chief-financial-officer': '财税与资金', // 首席财务官
  'agency-specialized-accounts-payable-agent': '财税与资金', // 应付账款专员
  'agency-support-support-finance-tracker': '财税与资金', // 财务追踪员
  'agency-specialized-hr-onboarding': '人力与团队', // HR入职专员
  'agency-specialized-recruitment-specialist': '人力与团队', // 招聘专员
  'agency-specialized-corporate-training-designer': '人力与团队', // 企业培训设计师
  'agency-specialized-organizational-psychologist': '人力与团队', // 组织心理学家
  'agency-specialized-change-management-consultant': '人力与团队', // 变革管理顾问
  'agency-specialized-specialized-chief-of-staff': '人力与团队', // 幕僚长
  'agency-specialized-personal-growth-mentor': '人力与团队', // 个人成长导师
  'agency-academic-academic-psychologist': '人力与团队', // 心理学家
  'agency-specialized-business-strategist': '战略与增长', // 商业策略师
  'agency-specialized-specialized-pricing-analyst': '战略与增长', // 定价分析师
  'agency-specialized-supply-chain-strategist': '战略与增长', // 供应链策略师
  'agency-strategy-nexus-strategy': '战略与增长', // Nexus策略师
  'agency-specialized-operations-manager': '运营提效', // 运营经理
  'agency-specialized-customer-service': '运营提效', // 客服专员
  'agency-specialized-customer-success-manager': '运营提效', // 客户成功经理
  'agency-specialized-sales-outreach': '销售成交', // 销售外联
  'agency-support-support-analytics-reporter': '运营提效', // 分析报告员
  'agency-specialized-language-translator': '运营提效', // 语言翻译员
  'agency-support-support-legal-compliance-checker': '行业专家', // 法律合规检查员
  'agency-security-security-compliance-auditor': '行业专家', // 合规审计师
  'agency-engineering-engineering-wechat-mini-program-developer': '数字化与建站', // 微信小程序开发者
};

const KNOWN_TWO_WORD_CATEGORIES = new Set([
  'paid-media',
  'game-development',
  'project-management',
  'spatial-computing',
]);

/**
 * Derive the source category from an agency id, e.g.
 * `agency-engineering-engineering-frontend-developer` → `engineering`,
 * `agency-paid-media-ppc-campaign-strategist` → `paid-media`.
 */
export function resolveAgencyCategoryKey(id: string): string | null {
  if (!id.startsWith('agency-')) return null;
  const parts = id.replace(/^agency-/, '').split('-');
  if (parts.length === 0) return null;
  const twoWord = `${parts[0]}-${parts[1]}`;
  if (KNOWN_TWO_WORD_CATEGORIES.has(twoWord)) return twoWord;
  if (CATEGORY_TO_DEPARTMENT[parts[0]]) return parts[0];
  return 'specialized';
}

/**
 * Resolve an agency expert's SME department. Returns null for non-agency ids.
 */
export function resolveExpertDepartment(id: string): string | null {
  if (!id.startsWith('agency-')) return null;
  const override = EXPERT_DEPARTMENT_OVERRIDE[id];
  if (override) return override;
  const category = resolveAgencyCategoryKey(id);
  return (category && CATEGORY_TO_DEPARTMENT[category]) || '行业专家';
}

/** Order departments by {@link SME_DEPARTMENT_ORDER}; unknowns sort to the end. */
export function orderSmeDepartments(names: string[]): string[] {
  const rank = (n: string) => {
    const i = (SME_DEPARTMENT_ORDER as readonly string[]).indexOf(n);
    return i === -1 ? SME_DEPARTMENT_ORDER.length : i;
  };
  return [...names].toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
