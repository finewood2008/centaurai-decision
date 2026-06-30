import type { BillingModelPrice, BillingSettings } from './billingTypes';

const now = 0;

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  display_currency: 'CNY',
  usd_to_cny_exchange_rate: 7.2,
  company_timezone: 'Asia/Shanghai',
  detail_retention_days: 365,
};

export const BUILTIN_MODEL_PRICES: BillingModelPrice[] = [
  {
    id: 'builtin-openai-gpt-4.1',
    scope_type: 'builtin',
    provider_platform: 'openai',
    model: 'gpt-4.1',
    input_unit_price_usd: 2,
    output_unit_price_usd: 8,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'builtin-openai-gpt-4.1-mini',
    scope_type: 'builtin',
    provider_platform: 'openai',
    model: 'gpt-4.1-mini',
    input_unit_price_usd: 0.4,
    output_unit_price_usd: 1.6,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'builtin-anthropic-claude-sonnet-4',
    scope_type: 'builtin',
    provider_platform: 'anthropic',
    model: 'claude-sonnet-4',
    input_unit_price_usd: 3,
    output_unit_price_usd: 15,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'builtin-gemini-2.5-pro',
    scope_type: 'builtin',
    provider_platform: 'gemini',
    model: 'gemini-2.5-pro',
    input_unit_price_usd: 1.25,
    output_unit_price_usd: 10,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'builtin-gemini-2.5-flash',
    scope_type: 'builtin',
    provider_platform: 'gemini',
    model: 'gemini-2.5-flash',
    input_unit_price_usd: 0.3,
    output_unit_price_usd: 2.5,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
];
