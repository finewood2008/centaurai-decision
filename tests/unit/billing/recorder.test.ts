import { describe, expect, it } from 'vitest';
import type { BillingModelPrice, BillingUsageEvent } from '@/common/types/billing';
import { recordBillingUsage } from '@/process/services/billing/recorder';

class FakeRepo {
  prices: BillingModelPrice[] = [];
  events: BillingUsageEvent[] = [];
  settings = {
    display_currency: 'CNY' as const,
    usd_to_cny_exchange_rate: 7.2,
    company_timezone: 'Asia/Shanghai' as const,
    detail_retention_days: 365,
  };

  getSettings() {
    return this.settings;
  }

  listPrices() {
    return this.prices;
  }

  insertEvent(event: BillingUsageEvent) {
    if (this.events.some((existing) => existing.id === event.id)) return false;
    this.events.push(event);
    return true;
  }

  upsertAggregates() {}
}

describe('recordBillingUsage', () => {
  it('records tokens with missing_price when no price matches', () => {
    const repo = new FakeRepo();

    const event = recordBillingUsage(repo, {
      user_id: 'u1',
      source_type: 'chat',
      provider_platform: 'unknown',
      model: 'missing-model',
      input_tokens: 100,
      output_tokens: 50,
      request_id: 'r1',
    });

    expect(event.pricing_status).toBe('missing_price');
    expect(event.cost_cny).toBe(0);
    expect(repo.events).toHaveLength(1);
  });

  it('records priced costs when a model price matches', () => {
    const repo = new FakeRepo();
    repo.prices.push({
      id: 'price-1',
      scope_type: 'builtin',
      provider_platform: 'openai',
      model: 'gpt-test',
      input_unit_price_usd: 2,
      output_unit_price_usd: 8,
      currency: 'USD',
      enabled: true,
      created_at: 0,
      updated_at: 0,
    });

    const event = recordBillingUsage(repo, {
      user_id: 'u1',
      source_type: 'chat',
      provider_platform: 'openai',
      model: 'gpt-test',
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      request_id: 'r2',
    });

    expect(event.pricing_status).toBe('priced');
    expect(event.cost_usd).toBe(6);
    expect(event.cost_cny).toBe(43.2);
  });
});
