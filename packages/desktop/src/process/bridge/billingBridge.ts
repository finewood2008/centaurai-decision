import path from 'node:path';
import type {
  BillingBreakdownDimension,
  BillingCsvRow,
  BillingModelPrice,
  BillingQuery,
  BillingUsageInput,
} from '@/common/types/billing';
import { ipcBridge } from '@/common';
import { getDataPath } from '@process/utils';
import { BillingRepository, recordBillingUsage } from '../services/billing';
import { BetterSqlite3Driver } from '../services/database/drivers/BetterSqlite3Driver';

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function billingRowsToCsv(rows: BillingCsvRow[]): string {
  const headers: Array<keyof BillingCsvRow> = [
    'occurred_at',
    'user_id',
    'source_type',
    'provider_name',
    'provider_platform',
    'model',
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'cost_cny',
    'pricing_status',
    'request_status',
  ];
  return [headers.join(','), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))].join('\n');
}

const withBillingRepo = <T>(fn: (repo: BillingRepository) => T): T => {
  const driver = new BetterSqlite3Driver(path.join(getDataPath(), 'aionui-backend.db'));
  try {
    return fn(new BillingRepository(driver));
  } finally {
    driver.close();
  }
};

const ensureBillingUser = (repo: BillingRepository, userId: string): void => {
  repo.ensureUser(userId);
};

export function initBillingBridge(): void {
  ipcBridge.billing.summary.provider(async (query: BillingQuery) => withBillingRepo((repo) => repo.getSummary(query)));
  ipcBridge.billing.events.provider(async (query: BillingQuery) => withBillingRepo((repo) => repo.queryEvents(query)));
  ipcBridge.billing.timeseries.provider(async (query: BillingQuery) =>
    withBillingRepo((repo) => repo.getTimeseries(query))
  );
  ipcBridge.billing.breakdown.provider(
    async (params: { query: BillingQuery; dimension: BillingBreakdownDimension }) =>
      withBillingRepo((repo) => repo.getBreakdown(params.query, params.dimension))
  );
  ipcBridge.billing.exportCsv.provider(async (query: BillingQuery) =>
    withBillingRepo((repo) => billingRowsToCsv(repo.getCsvRows(query)))
  );
  ipcBridge.billing.prices.provider(async () => withBillingRepo((repo) => repo.listPrices()));
  ipcBridge.billing.savePrice.provider(async (price: BillingModelPrice) =>
    withBillingRepo((repo) => repo.upsertPrice(price))
  );
  ipcBridge.billing.settings.provider(async () => withBillingRepo((repo) => repo.getSettings()));
  ipcBridge.billing.saveSettings.provider(
    async (settings: { usd_to_cny_exchange_rate?: number; detail_retention_days?: number }) =>
      withBillingRepo((repo) => {
        if (settings.usd_to_cny_exchange_rate !== undefined) {
          repo.saveSetting('usd_to_cny_exchange_rate', settings.usd_to_cny_exchange_rate);
        }
        if (settings.detail_retention_days !== undefined) {
          repo.saveSetting('detail_retention_days', settings.detail_retention_days);
        }
      })
  );
  ipcBridge.billing.recordUsage.provider(async (input: BillingUsageInput) =>
    withBillingRepo((repo) => {
      ensureBillingUser(repo, input.user_id);
      return recordBillingUsage(repo, input);
    })
  );
}
