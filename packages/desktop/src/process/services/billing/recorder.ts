import type { BillingUsageEvent, BillingUsageInput } from '@/common/types/billing';
import { uuid } from '@/common/utils';
import { getBillingBuckets } from './billingTime';
import { calculateTokenCost, resolveBillingPrice } from './pricing';

type BillingRecorderRepo = {
  getSettings(): { usd_to_cny_exchange_rate: number };
  listPrices(): Parameters<typeof resolveBillingPrice>[1];
  insertEvent(event: BillingUsageEvent): boolean;
  upsertAggregates(event: BillingUsageEvent): void;
};

const normalizeTokens = (value: number): number => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));

export function recordBillingUsage(repo: BillingRecorderRepo, input: BillingUsageInput): BillingUsageEvent {
  const now = Date.now();
  const occurred_at = input.occurred_at ?? now;
  const input_tokens = normalizeTokens(input.input_tokens);
  const output_tokens = normalizeTokens(input.output_tokens);
  const settings = repo.getSettings();
  const price = resolveBillingPrice(
    {
      user_id: input.user_id,
      provider_id: input.provider_id,
      provider_platform: input.provider_platform,
      model: input.model,
    },
    repo.listPrices()
  );
  const cost = price
    ? calculateTokenCost({
        input_tokens,
        output_tokens,
        input_unit_price_usd: price.input_unit_price_usd,
        output_unit_price_usd: price.output_unit_price_usd,
        exchange_rate: settings.usd_to_cny_exchange_rate,
      })
    : { cost_usd: 0, cost_cny: 0 };
  const event: BillingUsageEvent = {
    ...input,
    id: input.request_id ? `billing:${input.request_id}` : `billing:${uuid(16)}`,
    input_tokens,
    output_tokens,
    total_tokens: input_tokens + output_tokens,
    currency: 'CNY',
    exchange_rate: settings.usd_to_cny_exchange_rate,
    input_unit_price_usd: price?.input_unit_price_usd ?? null,
    output_unit_price_usd: price?.output_unit_price_usd ?? null,
    cost_usd: cost.cost_usd,
    cost_cny: cost.cost_cny,
    pricing_status: price ? 'priced' : 'missing_price',
    request_status: input.request_status ?? 'completed',
    occurred_at,
    metadata: input.metadata ?? {},
    ...getBillingBuckets(occurred_at),
    created_at: now,
  };

  if (repo.insertEvent(event)) {
    repo.upsertAggregates(event);
  }

  return event;
}
