import { ipcBridge } from '@/common';
import type {
  BillingBreakdownDimension,
  BillingProviderKeysRequest,
  BillingQuery,
  BillingSyncRequest,
  BillingUpstreamAuth,
} from '@/common/types/billing';
import useSWR, { mutate } from 'swr';

export const BILLING_PROVIDER_KEYS_KEY = 'billing.providerKeys';
export const BILLING_SUMMARY_KEY = 'billing.summary';
export const BILLING_EVENTS_KEY = 'billing.events';
export const BILLING_TIMESERIES_KEY = 'billing.timeseries';
export const BILLING_BREAKDOWN_KEY = 'billing.breakdown';

export function hasUsableBillingUpstream(upstream?: Partial<BillingUpstreamAuth> | null): upstream is BillingUpstreamAuth {
  return Boolean(upstream?.base_url?.trim() && upstream?.api_key?.trim());
}

export function useBillingProviderKeys(params?: BillingProviderKeysRequest) {
  return useSWR(hasUsableBillingUpstream(params?.upstream) ? [BILLING_PROVIDER_KEYS_KEY, params] : null, () => ipcBridge.billing.providerKeys.invoke(params!), {
    refreshInterval: 60_000,
  });
}

export function useBillingSummary(query: BillingQuery) {
  return useSWR(hasUsableBillingUpstream(query.upstream) ? [BILLING_SUMMARY_KEY, query] : null, () => ipcBridge.billing.summary.invoke(query), {
    refreshInterval: 10_000,
  });
}

export function useBillingEvents(query: BillingQuery) {
  return useSWR(hasUsableBillingUpstream(query.upstream) ? [BILLING_EVENTS_KEY, query] : null, () => ipcBridge.billing.events.invoke(query), {
    refreshInterval: 10_000,
  });
}

export function useBillingTimeseries(query: BillingQuery) {
  return useSWR(hasUsableBillingUpstream(query.upstream) ? [BILLING_TIMESERIES_KEY, query] : null, () => ipcBridge.billing.timeseries.invoke(query), {
    refreshInterval: 10_000,
  });
}

export function useBillingBreakdown(query: BillingQuery, dimension: BillingBreakdownDimension) {
  return useSWR(hasUsableBillingUpstream(query.upstream) ? [BILLING_BREAKDOWN_KEY, query, dimension] : null, () =>
    ipcBridge.billing.breakdown.invoke({ ...query, dimension })
  );
}

export async function refreshBillingData(): Promise<void> {
  await mutate((key) => Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('billing.'));
}

export async function syncBillingUsage(request: BillingSyncRequest): Promise<void> {
  await ipcBridge.billing.sync.invoke(request);
  await refreshBillingData();
}

export function providerToBillingUpstream(provider?: { base_url?: string; api_key?: string }): BillingUpstreamAuth | undefined {
  const baseUrl = provider?.base_url?.trim();
  const apiKey = provider?.api_key?.trim();
  if (!hasUsableBillingUpstream({ base_url: baseUrl, api_key: apiKey })) return undefined;
  return { base_url: baseUrl, api_key: apiKey };
}
