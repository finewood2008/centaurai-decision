import { describe, expect, it } from 'vitest';
import { getBillingBuckets } from '@/process/services/billing/billingTime';

describe('billing time buckets', () => {
  it('uses Asia/Shanghai calendar boundaries for hour, day, and month', () => {
    const occurredAt = Date.UTC(2026, 5, 30, 16, 30, 0); // 2026-07-01 00:30 Asia/Shanghai

    const buckets = getBillingBuckets(occurredAt);

    expect(new Date(buckets.hour_bucket).toISOString()).toBe('2026-06-30T16:00:00.000Z');
    expect(new Date(buckets.day_bucket).toISOString()).toBe('2026-06-30T16:00:00.000Z');
    expect(new Date(buckets.month_bucket).toISOString()).toBe('2026-06-30T16:00:00.000Z');
  });
});
