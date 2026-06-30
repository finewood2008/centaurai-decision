import { describe, expect, it, vi } from 'vitest';
import { runBillingRetention } from '@/process/services/billing/retention';

describe('runBillingRetention', () => {
  it('deletes detail rows older than configured retention days', () => {
    const repo = {
      getSettings: () => ({ detail_retention_days: 365 }),
      deleteEventsOlderThan: vi.fn(() => 3),
    };
    const now = Date.UTC(2026, 5, 30);

    expect(runBillingRetention(repo, now)).toBe(3);
    expect(repo.deleteEventsOlderThan).toHaveBeenCalledWith(now - 365 * 24 * 60 * 60 * 1000);
  });
});
