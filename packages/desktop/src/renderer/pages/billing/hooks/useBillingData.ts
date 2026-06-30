import { ipcBridge } from '@/common';
import type {
  BillingBreakdownDimension,
  BillingModelPrice,
  BillingQuery,
  BillingSettings,
} from '@/common/types/billing';
import useSWR, { mutate } from 'swr';

export const BILLING_SUMMARY_KEY = 'billing.summary';
export const BILLING_EVENTS_KEY = 'billing.events';
export const BILLING_TIMESERIES_KEY = 'billing.timeseries';
export const BILLING_BREAKDOWN_KEY = 'billing.breakdown';
export const BILLING_PRICES_KEY = 'billing.prices';
export const BILLING_SETTINGS_KEY = 'billing.settings';

export function useBillingSummary(query: BillingQuery) {
  return useSWR([BILLING_SUMMARY_KEY, query], () => ipcBridge.billing.summary.invoke(query), {
    refreshInterval: 10_000,
  });
}

export function useBillingEvents(query: BillingQuery) {
  return useSWR([BILLING_EVENTS_KEY, query], () => ipcBridge.billing.events.invoke(query), {
    refreshInterval: 10_000,
  });
}

export function useBillingTimeseries(query: BillingQuery) {
  return useSWR([BILLING_TIMESERIES_KEY, query], () => ipcBridge.billing.timeseries.invoke(query), {
    refreshInterval: 10_000,
  });
}

export function useBillingBreakdown(query: BillingQuery, dimension: BillingBreakdownDimension) {
  return useSWR([BILLING_BREAKDOWN_KEY, query, dimension], () =>
    ipcBridge.billing.breakdown.invoke({ query, dimension })
  );
}

export function useBillingPrices() {
  return useSWR(BILLING_PRICES_KEY, () => ipcBridge.billing.prices.invoke());
}

export function useBillingSettings() {
  return useSWR(BILLING_SETTINGS_KEY, () => ipcBridge.billing.settings.invoke());
}

export async function saveBillingPrice(price: BillingModelPrice): Promise<void> {
  await ipcBridge.billing.savePrice.invoke(price);
  await mutate(BILLING_PRICES_KEY);
}

export async function saveBillingSettings(settings: Partial<Pick<BillingSettings, 'usd_to_cny_exchange_rate' | 'detail_retention_days'>>): Promise<void> {
  await ipcBridge.billing.saveSettings.invoke(settings);
  await mutate(BILLING_SETTINGS_KEY);
}
