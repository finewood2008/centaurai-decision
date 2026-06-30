import type {
  BillingBreakdownDimension,
  BillingBreakdownRow,
  BillingCsvRow,
  BillingGranularity,
  BillingModelPrice,
  BillingQuery,
  BillingSettings,
  BillingSummary,
  BillingTimeseriesPoint,
  BillingUsageEvent,
} from '@/common/types/billing';
import { BUILTIN_MODEL_PRICES, DEFAULT_BILLING_SETTINGS } from '@/common/types/billing';
import type { ISqliteDriver } from '../database/drivers/ISqliteDriver';

type BillingEventRow = Omit<BillingUsageEvent, 'metadata' | 'request_status' | 'pricing_status' | 'source_type'> & {
  metadata: string;
  source_type: BillingUsageEvent['source_type'];
  pricing_status: BillingUsageEvent['pricing_status'];
  request_status: BillingUsageEvent['request_status'];
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const toBool = (value: unknown): boolean => value === true || value === 1;

const normalizePrice = (row: BillingModelPrice | (Omit<BillingModelPrice, 'enabled'> & { enabled: number })): BillingModelPrice => ({
  ...row,
  enabled: toBool(row.enabled),
  scope_id: row.scope_id ?? undefined,
  provider_platform: row.provider_platform ?? undefined,
  provider_id: row.provider_id ?? undefined,
  effective_from: row.effective_from ?? undefined,
  effective_to: row.effective_to ?? undefined,
});

const eventFromRow = (row: BillingEventRow): BillingUsageEvent => ({
  ...row,
  conversation_id: row.conversation_id ?? undefined,
  message_id: row.message_id ?? undefined,
  request_id: row.request_id ?? undefined,
  provider_id: row.provider_id ?? undefined,
  provider_platform: row.provider_platform ?? undefined,
  provider_name: row.provider_name ?? undefined,
  input_unit_price_usd: row.input_unit_price_usd ?? null,
  output_unit_price_usd: row.output_unit_price_usd ?? null,
  metadata: parseJson(row.metadata, {}),
});

const roundMoney = (value: number): number => Number(value.toFixed(8));

const summaryFromRow = (row: Partial<BillingSummary> | undefined): BillingSummary => {
  const total_tokens = Number(row?.total_tokens ?? 0);
  const cost_cny = Number(row?.cost_cny ?? 0);
  return {
    request_count: Number(row?.request_count ?? 0),
    input_tokens: Number(row?.input_tokens ?? 0),
    output_tokens: Number(row?.output_tokens ?? 0),
    total_tokens,
    cost_usd: roundMoney(Number(row?.cost_usd ?? 0)),
    cost_cny: roundMoney(cost_cny),
    average_cost_cny_per_1m_tokens: total_tokens > 0 ? roundMoney((cost_cny / total_tokens) * 1_000_000) : 0,
  };
};

const aggregateId = (
  granularity: BillingGranularity,
  bucket: number,
  event: BillingUsageEvent
): string =>
  [
    granularity,
    bucket,
    event.user_id,
    event.provider_id ?? '',
    event.provider_platform ?? '',
    event.model,
    event.source_type,
  ].join(':');

export class BillingRepository {
  constructor(private readonly db: ISqliteDriver) {}

  ensureUser(userId: string): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(userId, userId, '', Date.now(), Date.now());
  }

  getSettings(): BillingSettings {
    const rows = this.db.prepare('SELECT key, value FROM billing_settings').all() as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      display_currency: 'CNY',
      usd_to_cny_exchange_rate: Number(
        values.get('usd_to_cny_exchange_rate') ?? DEFAULT_BILLING_SETTINGS.usd_to_cny_exchange_rate
      ),
      company_timezone: 'Asia/Shanghai',
      detail_retention_days: Number(values.get('detail_retention_days') ?? DEFAULT_BILLING_SETTINGS.detail_retention_days),
    };
  }

  saveSetting(key: keyof Omit<BillingSettings, 'display_currency' | 'company_timezone'>, value: number): void {
    this.db
      .prepare('INSERT INTO billing_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, String(value), Date.now());
  }

  listPrices(): BillingModelPrice[] {
    const rows = this.db.prepare('SELECT * FROM billing_model_prices WHERE enabled = 1').all() as Array<
      Omit<BillingModelPrice, 'enabled'> & { enabled: number }
    >;
    return [...rows.map(normalizePrice), ...BUILTIN_MODEL_PRICES];
  }

  upsertPrice(price: BillingModelPrice): void {
    this.db
      .prepare(`INSERT INTO billing_model_prices (
        id, scope_type, scope_id, provider_platform, provider_id, model, input_unit_price_usd,
        output_unit_price_usd, currency, effective_from, effective_to, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        scope_type = excluded.scope_type,
        scope_id = excluded.scope_id,
        provider_platform = excluded.provider_platform,
        provider_id = excluded.provider_id,
        model = excluded.model,
        input_unit_price_usd = excluded.input_unit_price_usd,
        output_unit_price_usd = excluded.output_unit_price_usd,
        currency = excluded.currency,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`)
      .run(
        price.id,
        price.scope_type,
        price.scope_id ?? null,
        price.provider_platform ?? null,
        price.provider_id ?? null,
        price.model,
        price.input_unit_price_usd,
        price.output_unit_price_usd,
        price.currency,
        price.effective_from ?? null,
        price.effective_to ?? null,
        price.enabled ? 1 : 0,
        price.created_at,
        price.updated_at
      );
  }

  insertEvent(event: BillingUsageEvent): boolean {
    const result = this.db
      .prepare(`INSERT OR IGNORE INTO billing_usage_events (
        id, user_id, conversation_id, message_id, request_id, source_type, provider_id, provider_platform,
        provider_name, model, input_tokens, output_tokens, total_tokens, currency, exchange_rate,
        input_unit_price_usd, output_unit_price_usd, cost_usd, cost_cny, pricing_status, request_status,
        metadata, occurred_at, hour_bucket, day_bucket, month_bucket, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        event.id,
        event.user_id,
        event.conversation_id ?? null,
        event.message_id ?? null,
        event.request_id ?? null,
        event.source_type,
        event.provider_id ?? null,
        event.provider_platform ?? null,
        event.provider_name ?? null,
        event.model,
        event.input_tokens,
        event.output_tokens,
        event.total_tokens,
        event.currency,
        event.exchange_rate,
        event.input_unit_price_usd,
        event.output_unit_price_usd,
        event.cost_usd,
        event.cost_cny,
        event.pricing_status,
        event.request_status,
        JSON.stringify(event.metadata ?? {}),
        event.occurred_at,
        event.hour_bucket,
        event.day_bucket,
        event.month_bucket,
        event.created_at
      );
    return result.changes > 0;
  }

  upsertAggregates(event: BillingUsageEvent): void {
    const buckets: Array<[BillingGranularity, number]> = [
      ['hour', event.hour_bucket],
      ['day', event.day_bucket],
      ['month', event.month_bucket],
    ];

    for (const [granularity, bucket] of buckets) {
      this.db
        .prepare(`INSERT INTO billing_usage_aggregates (
          id, granularity, bucket_start, user_id, provider_id, provider_platform, model, source_type,
          request_count, input_tokens, output_tokens, total_tokens, cost_usd, cost_cny, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          request_count = request_count + 1,
          input_tokens = input_tokens + excluded.input_tokens,
          output_tokens = output_tokens + excluded.output_tokens,
          total_tokens = total_tokens + excluded.total_tokens,
          cost_usd = cost_usd + excluded.cost_usd,
          cost_cny = cost_cny + excluded.cost_cny,
          updated_at = excluded.updated_at`)
        .run(
          aggregateId(granularity, bucket, event),
          granularity,
          bucket,
          event.user_id,
          event.provider_id ?? null,
          event.provider_platform ?? null,
          event.model,
          event.source_type,
          event.input_tokens,
          event.output_tokens,
          event.total_tokens,
          event.cost_usd,
          event.cost_cny,
          Date.now()
        );
    }
  }

  getSummary(query: BillingQuery): BillingSummary {
    const { where, args } = this.eventWhere(query);
    const row = this.db
      .prepare(`SELECT
        COUNT(*) AS request_count,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(cost_usd), 0) AS cost_usd,
        COALESCE(SUM(cost_cny), 0) AS cost_cny
      FROM billing_usage_events ${where}`)
      .get(...args) as Partial<BillingSummary> | undefined;
    return summaryFromRow(row);
  }

  queryEvents(query: BillingQuery): BillingUsageEvent[] {
    const { where, args } = this.eventWhere(query);
    const rows = this.db
      .prepare(`SELECT * FROM billing_usage_events ${where} ORDER BY occurred_at DESC, created_at DESC LIMIT 1000`)
      .all(...args) as BillingEventRow[];
    return rows.map(eventFromRow);
  }

  getTimeseries(query: BillingQuery): BillingTimeseriesPoint[] {
    const granularity = query.granularity ?? 'day';
    const { where, args } = this.aggregateWhere(query);
    return this.db
      .prepare(`SELECT
        bucket_start,
        SUM(request_count) AS request_count,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(total_tokens) AS total_tokens,
        SUM(cost_cny) AS cost_cny
      FROM billing_usage_aggregates
      WHERE granularity = ?${where ? ` AND ${where}` : ''}
      GROUP BY bucket_start
      ORDER BY bucket_start ASC`)
      .all(granularity, ...args) as BillingTimeseriesPoint[];
  }

  getBreakdown(query: BillingQuery, dimension: BillingBreakdownDimension): BillingBreakdownRow[] {
    const columns: Record<BillingBreakdownDimension, string> = {
      model: 'model',
      user: 'user_id',
      provider: 'provider_id',
      source_type: 'source_type',
    };
    const column = columns[dimension];
    const { where, args } = this.eventWhere(query);
    const rows = this.db
      .prepare(`SELECT
        COALESCE(${column}, '') AS key,
        COALESCE(${column}, '') AS label,
        COUNT(*) AS request_count,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(cost_usd), 0) AS cost_usd,
        COALESCE(SUM(cost_cny), 0) AS cost_cny
      FROM billing_usage_events ${where}
      GROUP BY ${column}
      ORDER BY cost_cny DESC, total_tokens DESC
      LIMIT 20`)
      .all(...args) as Array<Partial<BillingSummary> & { key: string; label: string }>;

    return rows.map((row) => ({
      ...summaryFromRow(row),
      key: row.key || 'unknown',
      label: row.label || 'unknown',
    }));
  }

  getCsvRows(query: BillingQuery): BillingCsvRow[] {
    return this.queryEvents(query).map((event) => ({
      occurred_at: event.occurred_at,
      user_id: event.user_id,
      source_type: event.source_type,
      provider_name: event.provider_name ?? '',
      provider_platform: event.provider_platform ?? '',
      model: event.model,
      input_tokens: event.input_tokens,
      output_tokens: event.output_tokens,
      total_tokens: event.total_tokens,
      cost_cny: event.cost_cny,
      pricing_status: event.pricing_status,
      request_status: event.request_status,
    }));
  }

  listMissingPriceModels(): Array<{ provider_platform: string; provider_id: string; model: string }> {
    return this.db
      .prepare(`SELECT DISTINCT
        COALESCE(provider_platform, '') AS provider_platform,
        COALESCE(provider_id, '') AS provider_id,
        model
      FROM billing_usage_events
      WHERE pricing_status = 'missing_price'
      ORDER BY model ASC`)
      .all() as Array<{ provider_platform: string; provider_id: string; model: string }>;
  }

  deleteEventsOlderThan(cutoff: number): number {
    return this.db.prepare('DELETE FROM billing_usage_events WHERE occurred_at < ?').run(cutoff).changes;
  }

  private eventWhere(query: BillingQuery): { where: string; args: unknown[] } {
    const clauses: string[] = [];
    const args: unknown[] = [];
    this.addCommonFilters(clauses, args, query);
    if (query.request_status) {
      clauses.push('request_status = ?');
      args.push(query.request_status);
    }
    if (query.pricing_status) {
      clauses.push('pricing_status = ?');
      args.push(query.pricing_status);
    }
    return {
      where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      args,
    };
  }

  private aggregateWhere(query: BillingQuery): { where: string; args: unknown[] } {
    const clauses: string[] = [];
    const args: unknown[] = [];
    this.addCommonFilters(clauses, args, query, 'bucket_start');
    return {
      where: clauses.join(' AND '),
      args,
    };
  }

  private addCommonFilters(
    clauses: string[],
    args: unknown[],
    query: BillingQuery,
    timeColumn = 'occurred_at'
  ): void {
    if (query.user_id) {
      clauses.push('user_id = ?');
      args.push(query.user_id);
    }
    if (query.provider_id) {
      clauses.push('provider_id = ?');
      args.push(query.provider_id);
    }
    if (query.provider_platform) {
      clauses.push('provider_platform = ?');
      args.push(query.provider_platform);
    }
    if (query.model) {
      clauses.push('model = ?');
      args.push(query.model);
    }
    if (query.source_type) {
      clauses.push('source_type = ?');
      args.push(query.source_type);
    }
    if (query.start !== undefined) {
      clauses.push(`${timeColumn} >= ?`);
      args.push(query.start);
    }
    if (query.end !== undefined) {
      clauses.push(`${timeColumn} <= ?`);
      args.push(query.end);
    }
  }
}
