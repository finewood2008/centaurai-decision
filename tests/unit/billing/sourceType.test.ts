import { describe, expect, it } from 'vitest';
import { resolveBillingSourceType } from '@/renderer/pages/billing/utils/sourceType';

describe('resolveBillingSourceType', () => {
  it('maps aionrs conversations to chat billing source', () => {
    expect(resolveBillingSourceType({ type: 'aionrs' } as never)).toBe('chat');
  });

  it('maps conversations with agency assistant ids to advisor source', () => {
    expect(
      resolveBillingSourceType({
        type: 'aionrs',
        extra: { preset_assistant_id: 'agency-market' },
      } as never)
    ).toBe('advisor');
  });
});
