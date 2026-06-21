/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SME_DEPARTMENT,
  SME_DEPARTMENT_ORDER,
  orderSmeDepartments,
  resolveAgencyCategoryKey,
  resolveExpertDepartment,
} from '@/renderer/pages/settings/AssistantSettings/advisorTaxonomy';

describe('advisorTaxonomy', () => {
  it('default department is the first ordered SME 科室', () => {
    expect(DEFAULT_SME_DEPARTMENT).toBe(SME_DEPARTMENT_ORDER[0]);
    expect(DEFAULT_SME_DEPARTMENT).toBe('市场获客');
  });

  it('returns null for non-agency ids', () => {
    expect(resolveExpertDepartment('cowork')).toBeNull();
    expect(resolveAgencyCategoryKey('builtin-word-creator')).toBeNull();
  });

  it('resolves by source category (default mapping)', () => {
    expect(resolveExpertDepartment('agency-marketing-marketing-xiaohongshu-specialist')).toBe('市场获客');
    expect(resolveExpertDepartment('agency-sales-sales-coach')).toBe('销售成交');
    expect(resolveExpertDepartment('agency-design-design-brand-guardian')).toBe('设计与创意');
  });

  it('applies cross-department overrides (movers out of specialized/support)', () => {
    expect(resolveExpertDepartment('agency-specialized-chief-financial-officer')).toBe('财税与资金');
    expect(resolveExpertDepartment('agency-specialized-hr-onboarding')).toBe('人力与团队');
    expect(resolveExpertDepartment('agency-specialized-customer-service')).toBe('运营提效');
    expect(resolveExpertDepartment('agency-academic-academic-psychologist')).toBe('人力与团队');
    expect(resolveExpertDepartment('agency-engineering-engineering-wechat-mini-program-developer')).toBe(
      '数字化与建站'
    );
  });

  it('handles two-word source categories', () => {
    expect(resolveAgencyCategoryKey('agency-paid-media-ppc-campaign-strategist')).toBe('paid-media');
    expect(resolveExpertDepartment('agency-paid-media-ppc-campaign-strategist')).toBe('付费投放');
  });

  it('every resolved department is a known SME 科室', () => {
    const sample = [
      'agency-marketing-marketing-douyin-strategist',
      'agency-finance-finance-tax-strategist',
      'agency-project-management-project-shepherd',
      'agency-gis-gis-analyst', // curated-out, but must still map somewhere coherent
      'agency-game-development-game-designer',
    ];
    for (const id of sample) {
      expect((SME_DEPARTMENT_ORDER as readonly string[]).includes(resolveExpertDepartment(id)!)).toBe(true);
    }
  });

  it('orderSmeDepartments sorts by frequency order, unknowns last', () => {
    expect(orderSmeDepartments(['销售成交', '市场获客', '行业专家'])).toEqual(['市场获客', '销售成交', '行业专家']);
    expect(orderSmeDepartments(['未知科室', '市场获客'])).toEqual(['市场获客', '未知科室']);
  });
});
