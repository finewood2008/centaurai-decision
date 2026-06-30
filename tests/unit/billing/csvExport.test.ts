import { describe, expect, it } from 'vitest';
import { billingRowsToCsv } from '@/process/bridge/billingBridge';

describe('billingRowsToCsv', () => {
  it('exports escaped CSV with billing headers', () => {
    const csv = billingRowsToCsv([
      {
        occurred_at: 1,
        user_id: 'u1',
        source_type: 'chat',
        provider_name: 'Provider, Inc.',
        provider_platform: 'openai',
        model: 'gpt-test',
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        cost_cny: 0.12,
        pricing_status: 'priced',
        request_status: 'completed',
      },
    ]);

    expect(csv.split('\n')[0]).toContain('occurred_at,user_id,source_type');
    expect(csv).toContain('"Provider, Inc."');
  });
});
