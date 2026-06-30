import { describe, expect, it } from 'vitest';
import type { BillingModelPrice } from '@/common/types/billing';
import { calculateTokenCost, resolveBillingPrice } from '@/process/services/billing/pricing';

const price = (partial: Partial<BillingModelPrice>): BillingModelPrice => ({
  id: partial.id ?? 'price-id',
  scope_type: partial.scope_type ?? 'builtin',
  scope_id: partial.scope_id,
  provider_platform: partial.provider_platform,
  provider_id: partial.provider_id,
  model: partial.model ?? 'gpt-test',
  input_unit_price_usd: partial.input_unit_price_usd ?? 1,
  output_unit_price_usd: partial.output_unit_price_usd ?? 2,
  currency: 'USD',
  effective_from: partial.effective_from,
  effective_to: partial.effective_to,
  enabled: partial.enabled ?? true,
  created_at: 0,
  updated_at: 0,
});

describe('billing pricing', () => {
  it('prefers user provider override over global and builtin prices', () => {
    const match = resolveBillingPrice(
      {
        user_id: 'u1',
        provider_id: 'provider-1',
        provider_platform: 'openai',
        model: 'gpt-test',
      },
      [
        price({ id: 'builtin', scope_type: 'builtin', provider_platform: 'openai', input_unit_price_usd: 1 }),
        price({ id: 'global', scope_type: 'global', provider_platform: 'openai', input_unit_price_usd: 3 }),
        price({
          id: 'user',
          scope_type: 'user_provider',
          scope_id: 'u1',
          provider_id: 'provider-1',
          input_unit_price_usd: 5,
        }),
      ]
    );

    expect(match?.id).toBe('user');
  });

  it('computes USD and CNY from per-1M input and output token prices', () => {
    const result = calculateTokenCost({
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      input_unit_price_usd: 2,
      output_unit_price_usd: 8,
      exchange_rate: 7.2,
    });

    expect(result.cost_usd).toBe(6);
    expect(result.cost_cny).toBe(43.2);
  });
});
