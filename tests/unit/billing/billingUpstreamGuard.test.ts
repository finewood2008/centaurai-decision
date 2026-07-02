import type { BillingQuery, BillingUpstreamAuth } from '@/common/types/billing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSWRMock = vi.hoisted(() => vi.fn(() => ({ data: undefined })));
const mutateMock = vi.hoisted(() => vi.fn());

vi.mock('swr', () => ({
  default: useSWRMock,
  mutate: mutateMock,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    billing: {
      providerKeys: { invoke: vi.fn() },
      summary: { invoke: vi.fn() },
      events: { invoke: vi.fn() },
      timeseries: { invoke: vi.fn() },
      breakdown: { invoke: vi.fn() },
      sync: { invoke: vi.fn() },
    },
  },
}));

import {
  useBillingBreakdown,
  useBillingEvents,
  useBillingProviderKeys,
  useBillingSummary,
  useBillingTimeseries,
} from '@/renderer/pages/billing/hooks/useBillingData';

const queryWithUpstream = (upstream: BillingUpstreamAuth): BillingQuery => ({
  upstream,
  start_ms: 0,
  end_ms: 1,
  granularity: 'day',
  timezone: 'Asia/Shanghai',
});

describe('billing upstream request guard', () => {
  beforeEach(() => {
    useSWRMock.mockClear();
  });

  it('does not start billing requests when upstream base URL or API key is blank', () => {
    const invalidUpstreams: BillingUpstreamAuth[] = [
      { base_url: '', api_key: 'pk_test' },
      { base_url: '   ', api_key: 'pk_test' },
      { base_url: 'http://127.0.0.1:8088', api_key: '' },
      { base_url: 'http://127.0.0.1:8088', api_key: '   ' },
    ];

    for (const upstream of invalidUpstreams) {
      const query = queryWithUpstream(upstream);

      useBillingProviderKeys({ upstream, scope: 'mine' });
      useBillingSummary(query);
      useBillingTimeseries(query);
      useBillingBreakdown(query, 'model');
      useBillingEvents(query);
    }

    expect(useSWRMock.mock.calls.map((call) => call[0])).toEqual(Array(invalidUpstreams.length * 5).fill(null));
  });

  it('starts billing requests when upstream base URL and API key are configured', () => {
    useBillingSummary(queryWithUpstream({ base_url: ' http://127.0.0.1:8088/ ', api_key: ' pk_test ' }));

    const lastCall = useSWRMock.mock.calls[useSWRMock.mock.calls.length - 1];
    expect(Array.isArray(lastCall[0])).toBe(true);
  });
});
