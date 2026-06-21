/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getConsultationProtocol, isAgencyExpert } from '@/common/utils/consultationProtocol';
import {
  loadPresetAssistantResources,
  type PresetAssistantResourceDeps,
} from '@/common/utils/presetAssistantResources';

const RULE_BODY = '# 小红书专家\n\n你是一位小红书运营专家……';

function makeDeps(): PresetAssistantResourceDeps {
  return {
    readAssistantRule: async () => RULE_BODY,
    readAssistantSkill: async () => '',
    getEnabledSkills: async () => undefined,
    getExcludeAutoInjectSkills: async () => undefined,
    warn: () => {},
  };
}

describe('consultationProtocol helpers', () => {
  it('isAgencyExpert detects agency ids only', () => {
    expect(isAgencyExpert('agency-marketing-marketing-xiaohongshu-specialist')).toBe(true);
    expect(isAgencyExpert('cowork')).toBe(false);
    expect(isAgencyExpert(undefined)).toBe(false);
    expect(isAgencyExpert('')).toBe(false);
  });

  it('getConsultationProtocol is locale-aware', () => {
    expect(getConsultationProtocol('zh-CN')).toContain('咨询协议');
    expect(getConsultationProtocol('en-US')).toContain('Consultation Protocol');
  });
});

describe('loadPresetAssistantResources — protocol injection', () => {
  it('prepends the consultation protocol for agency experts (prefix, body preserved)', async () => {
    const result = await loadPresetAssistantResources(
      { custom_agent_id: 'agency-marketing-marketing-xiaohongshu-specialist', localeKey: 'zh-CN' },
      makeDeps()
    );
    const rules = result.rules || '';
    // Protocol comes first, then the original rule body.
    expect(rules.startsWith(getConsultationProtocol('zh-CN'))).toBe(true);
    expect(rules).toContain(RULE_BODY);
    expect(rules.indexOf('咨询协议')).toBeLessThan(rules.indexOf('小红书运营专家'));
  });

  it('does NOT inject the protocol for non-agency assistants', async () => {
    const result = await loadPresetAssistantResources({ custom_agent_id: 'cowork', localeKey: 'zh-CN' }, makeDeps());
    expect(result.rules).toBe(RULE_BODY);
    expect(result.rules).not.toContain('咨询协议');
  });

  it('injects the English protocol for non-zh locales', async () => {
    const result = await loadPresetAssistantResources(
      { custom_agent_id: 'agency-finance-finance-tax-strategist', localeKey: 'en-US' },
      makeDeps()
    );
    expect(result.rules || '').toContain('Consultation Protocol');
  });
});
