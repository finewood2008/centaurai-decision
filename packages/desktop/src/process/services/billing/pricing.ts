import type { BillingModelPrice } from '@/common/types/billing';

export type BillingPriceLookup = {
  user_id: string;
  provider_id?: string;
  provider_platform?: string;
  model: string;
};

const matchesPrice = (price: BillingModelPrice, lookup: BillingPriceLookup): boolean => {
  if (!price.enabled) return false;
  if (price.model !== lookup.model) return false;
  if (price.provider_id && price.provider_id !== lookup.provider_id) return false;
  if (price.provider_platform && price.provider_platform !== lookup.provider_platform) return false;
  return true;
};

export function resolveBillingPrice(
  lookup: BillingPriceLookup,
  prices: BillingModelPrice[]
): BillingModelPrice | null {
  const candidates = prices.filter((price) => matchesPrice(price, lookup));

  return (
    candidates.find(
      (price) =>
        price.scope_type === 'user_provider' &&
        price.scope_id === lookup.user_id &&
        (!price.provider_id || price.provider_id === lookup.provider_id)
    ) ??
    candidates.find((price) => price.scope_type === 'global') ??
    candidates.find((price) => price.scope_type === 'builtin') ??
    null
  );
}

export function calculateTokenCost(input: {
  input_tokens: number;
  output_tokens: number;
  input_unit_price_usd: number;
  output_unit_price_usd: number;
  exchange_rate: number;
}): { cost_usd: number; cost_cny: number } {
  const inputUsd = (input.input_tokens / 1_000_000) * input.input_unit_price_usd;
  const outputUsd = (input.output_tokens / 1_000_000) * input.output_unit_price_usd;
  const cost_usd = Number((inputUsd + outputUsd).toFixed(8));
  return {
    cost_usd,
    cost_cny: Number((cost_usd * input.exchange_rate).toFixed(8)),
  };
}
