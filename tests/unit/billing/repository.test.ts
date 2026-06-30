import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BillingUsageEvent } from '@/common/types/billing';
import { BillingRepository } from '@/process/services/billing/repository';
import { initSchema } from '@/process/services/database/schema';
import { BetterSqlite3Driver } from '@/process/services/database/drivers/BetterSqlite3Driver';

let dir: string | null = null;

const event = (partial: Partial<BillingUsageEvent> = {}): BillingUsageEvent => ({
  id: partial.id ?? 'event-1',
  user_id: partial.user_id ?? 'u1',
  conversation_id: partial.conversation_id ?? 'conversation-1',
  message_id: partial.message_id ?? 'message-1',
  request_id: partial.request_id ?? 'request-1',
  source_type: partial.source_type ?? 'chat',
  provider_id: partial.provider_id ?? 'provider-1',
  provider_platform: partial.provider_platform ?? 'openai',
  provider_name: partial.provider_name ?? 'OpenAI',
  model: partial.model ?? 'gpt-test',
  input_tokens: partial.input_tokens ?? 100,
  output_tokens: partial.output_tokens ?? 50,
  total_tokens: partial.total_tokens ?? 150,
  currency: 'CNY',
  exchange_rate: partial.exchange_rate ?? 7.2,
  input_unit_price_usd: partial.input_unit_price_usd ?? 1,
  output_unit_price_usd: partial.output_unit_price_usd ?? 2,
  cost_usd: partial.cost_usd ?? 0.0002,
  cost_cny: partial.cost_cny ?? 0.00144,
  pricing_status: partial.pricing_status ?? 'priced',
  request_status: partial.request_status ?? 'completed',
  metadata: partial.metadata ?? {},
  occurred_at: partial.occurred_at ?? 1_000,
  hour_bucket: partial.hour_bucket ?? 0,
  day_bucket: partial.day_bucket ?? 0,
  month_bucket: partial.month_bucket ?? 0,
  created_at: partial.created_at ?? 1_000,
});

const createRepo = () => {
  dir = mkdtempSync(path.join(tmpdir(), 'billing-repo-'));
  const driver = new BetterSqlite3Driver(path.join(dir, 'test.db'));
  initSchema(driver);
  driver
    .prepare(`INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('u1', 'user1', 'hash', 1, 1);
  return { driver, repo: new BillingRepository(driver) };
};

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('BillingRepository', () => {
  it('inserts events and returns summary totals', () => {
    const { driver, repo } = createRepo();
    const inserted = repo.insertEvent(event());

    const summary = repo.getSummary({ user_id: 'u1' });

    expect(inserted).toBe(true);
    expect(summary.request_count).toBe(1);
    expect(summary.total_tokens).toBe(150);
    expect(summary.cost_cny).toBeCloseTo(0.00144);
    driver.close();
  });

  it('returns timeseries and breakdown rows from stored aggregates', () => {
    const { driver, repo } = createRepo();
    const usage = event();

    repo.insertEvent(usage);
    repo.upsertAggregates(usage);

    expect(repo.getTimeseries({ user_id: 'u1', granularity: 'hour' })).toHaveLength(1);
    expect(repo.getBreakdown({ user_id: 'u1' }, 'model')[0].key).toBe('gpt-test');
    driver.close();
  });

  it('deletes old detail rows while aggregate rows remain available', () => {
    const { driver, repo } = createRepo();
    const usage = event({ occurred_at: 1_000 });
    repo.insertEvent(usage);
    repo.upsertAggregates(usage);

    expect(repo.deleteEventsOlderThan(10_000)).toBe(1);

    expect(repo.queryEvents({ user_id: 'u1' })).toHaveLength(0);
    expect(repo.getTimeseries({ user_id: 'u1', granularity: 'hour' })).toHaveLength(1);
    driver.close();
  });
});
