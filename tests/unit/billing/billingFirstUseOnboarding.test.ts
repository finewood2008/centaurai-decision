import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

describe('billing first-use onboarding', () => {
  it('documents that users create an upstream key on the relay platform and CentaurAI stores only base_url plus api_key', () => {
    const doc = readFileSync('docs/superpowers/specs/2026-06-30-billing-upstream-api.md', 'utf8');

    expect(doc).toContain('First-Use Upstream Key Setup');
    expect(doc).toContain('Authorization: Bearer <user-created upstream API key>');
    expect(doc).toContain('CentaurAI must not store upstream account passwords, session cookies, or login tokens');
  });

  it('ships localized onboarding copy for users who have not configured a relay key yet', () => {
    const zh = readJson<{ onboarding?: Record<string, unknown> }>('packages/desktop/src/renderer/services/i18n/locales/zh-CN/billing.json');
    const en = readJson<{ onboarding?: Record<string, unknown> }>('packages/desktop/src/renderer/services/i18n/locales/en-US/billing.json');

    expect(zh.onboarding).toMatchObject({
      title: '配置中转站 Key',
      stepCreateKey: '在中转站平台注册或登录帐号，并创建用户 API Key',
      stepConfigureProvider: '回到 CentaurAI，在模型设置里新增上游服务，填写 Base URL 和 API Key',
      noSession: 'CentaurAI 不保存中转站帐号密码或登录态，只使用你配置的 Key 访问上游接口',
    });
    expect(en.onboarding).toMatchObject({
      title: 'Configure relay key',
      stepCreateKey: 'Register or sign in on the relay platform, then create a user API key',
      stepConfigureProvider: 'Return to CentaurAI, add an upstream service in model settings, and enter Base URL plus API Key',
      noSession: 'CentaurAI does not store relay account passwords or login sessions; it only uses the configured key for upstream APIs',
    });
  });

  it('renders the onboarding guide from BillingPage when no usable upstream provider is configured', () => {
    const page = readFileSync('packages/desktop/src/renderer/pages/billing/BillingPage.tsx', 'utf8');

    expect(page).toContain("import BillingUpstreamSetupGuide from './components/BillingUpstreamSetupGuide'");
    expect(page).toContain('<BillingUpstreamSetupGuide />');
    expect(page).toContain('upstreamOptions.length === 0');
  });
});
