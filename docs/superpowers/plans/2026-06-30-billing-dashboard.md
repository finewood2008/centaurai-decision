# Billing Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared billing dashboard for `centaurai-team` and `centaurai-decision` that records direct-model token usage, computes CNY costs from USD price snapshots, and exposes dashboards by hour/day/month.

**Architecture:** Add a shared billing domain under `packages/desktop/src/common/types/billing` and `packages/desktop/src/process/services/billing`. The process billing service owns SQLite schema helpers, pricing resolution, recording, aggregation, retention, and query/export logic; the renderer consumes it through `ipcBridge.billing` and a first-level `/billing` route. Implement in `centaurai-team`, then apply the same source patch to `centaurai-decision`.

**Tech Stack:** TypeScript, React 19, Arco Design, SWR, Electron/Vite, Vitest, SQLite through `ISqliteDriver`, existing HTTP/IPC bridge patterns.

---

## File Structure

Create these files in both repositories unless the task explicitly says otherwise:

- `packages/desktop/src/common/types/billing/billingTypes.ts`  
  Shared request/response DTOs, enums, row types, pricing types, and CSV query types.
- `packages/desktop/src/common/types/billing/defaultPrices.ts`  
  Built-in default USD-per-1M-token prices and default USD/CNY exchange rate.
- `packages/desktop/src/common/types/billing/index.ts`  
  Barrel exports.
- `packages/desktop/src/process/services/billing/billingTime.ts`  
  Asia/Shanghai bucket calculation helpers for hour/day/month.
- `packages/desktop/src/process/services/billing/pricing.ts`  
  Price matching and cost calculation.
- `packages/desktop/src/process/services/billing/repository.ts`  
  SQLite statements for events, prices, aggregates, settings, retention, summaries, breakdowns, time series, and CSV rows.
- `packages/desktop/src/process/services/billing/recorder.ts`  
  Idempotent `recordBillingUsage()` orchestration.
- `packages/desktop/src/process/services/billing/index.ts`  
  Public service exports.
- `packages/desktop/src/process/bridge/billingBridge.ts`  
  Electron IPC bridge providers for desktop-native paths and testable service access.
- `packages/desktop/src/renderer/pages/billing/BillingPage.tsx`  
  Page shell with tabs and filters.
- `packages/desktop/src/renderer/pages/billing/components/BillingOverview.tsx`  
  KPI cards, trend chart, rankings.
- `packages/desktop/src/renderer/pages/billing/components/BillingDetails.tsx`  
  Event table and CSV action.
- `packages/desktop/src/renderer/pages/billing/components/BillingPriceSettings.tsx`  
  Price and exchange-rate management.
- `packages/desktop/src/renderer/pages/billing/hooks/useBillingData.ts`  
  SWR hooks around `ipcBridge.billing`.
- `packages/desktop/src/renderer/pages/billing/utils/formatters.ts`  
  Currency/token/time formatting helpers.
- `packages/desktop/src/renderer/pages/billing/index.tsx`  
  Default export.

Modify:

- `packages/desktop/src/process/services/database/schema.ts`  
  Add billing tables to fresh database schema and bump `CURRENT_DB_VERSION` from `26` to `27`.
- `packages/desktop/src/process/services/database/migrations.ts`  
  Add `migration_v27` and append it to `ALL_MIGRATIONS`.
- `packages/desktop/src/process/bridge/index.ts`  
  Register `initBillingBridge()`.
- `packages/desktop/src/common/adapter/ipcBridge.ts`  
  Add `billing` bridge facade and shared DTO imports.
- `packages/desktop/src/renderer/components/layout/Router.tsx`  
  Add lazy route for `/billing`.
- `packages/desktop/src/renderer/components/layout/Sider/index.tsx` and/or `SiderNav.tsx`  
  Add first-level sidebar entry.
- `packages/desktop/src/renderer/services/i18n/locales/zh-CN/common.json` or a new `billing.json` locale file plus locale index files  
  Add i18n keys for the dashboard. Follow existing locale-module conventions after inspecting `services/i18n/locales/*/index.ts`.
- `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/useAionrsMessage.ts`  
  Record billing when reliable input/output usage is received.
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts`  
  Do not bill context usage as cost. If exact usage becomes available through request trace/finish events, normalize it through the billing recorder; otherwise leave ACP CLI usage as future.

Tests:

- `tests/unit/billing/billingTime.test.ts`
- `tests/unit/billing/pricing.test.ts`
- `tests/unit/billing/repository.test.ts`
- `tests/unit/billing/recorder.test.ts`
- `tests/unit/billing/csvExport.test.ts`
- `tests/unit/billing/BillingPage.dom.test.tsx`
- Update or add migration tests under `tests/unit/bootstrap/`.

Important constraint: this repository mostly proxies business HTTP routes to the bundled `aioncore`. If `/api/billing/*` cannot be added in this source tree, implement v1 through Electron IPC bridge providers backed by the local SQLite service and expose renderer access via `ipcBridge.billing`. Keep DTO names aligned with the future `/api/billing/*` contract so adding HTTP endpoints later is mechanical.

---

### Task 1: Shared Billing Types And Defaults

**Files:**
- Create: `packages/desktop/src/common/types/billing/billingTypes.ts`
- Create: `packages/desktop/src/common/types/billing/defaultPrices.ts`
- Create: `packages/desktop/src/common/types/billing/index.ts`
- Test: `tests/unit/billing/pricing.test.ts` will consume these types in Task 3.

- [ ] **Step 1: Create shared billing type definitions**

Create `packages/desktop/src/common/types/billing/billingTypes.ts`:

```ts
export type BillingGranularity = 'hour' | 'day' | 'month';
export type BillingSourceType = 'chat' | 'decision_room' | 'office_assistant' | 'advisor' | 'unknown';
export type BillingPricingStatus = 'priced' | 'missing_price';
export type BillingRequestStatus = 'completed' | 'failed' | 'cancelled';
export type BillingPriceScope = 'builtin' | 'global' | 'user_provider';

export type BillingUsageInput = {
  user_id: string;
  conversation_id?: string;
  message_id?: string;
  request_id?: string;
  source_type: BillingSourceType;
  provider_id?: string;
  provider_platform?: string;
  provider_name?: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  request_status?: BillingRequestStatus;
  occurred_at?: number;
  metadata?: Record<string, unknown>;
};

export type BillingUsageEvent = BillingUsageInput & {
  id: string;
  total_tokens: number;
  currency: 'CNY';
  exchange_rate: number;
  input_unit_price_usd: number | null;
  output_unit_price_usd: number | null;
  cost_usd: number;
  cost_cny: number;
  pricing_status: BillingPricingStatus;
  request_status: BillingRequestStatus;
  hour_bucket: number;
  day_bucket: number;
  month_bucket: number;
  created_at: number;
};

export type BillingModelPrice = {
  id: string;
  scope_type: BillingPriceScope;
  scope_id?: string;
  provider_platform?: string;
  provider_id?: string;
  model: string;
  input_unit_price_usd: number;
  output_unit_price_usd: number;
  currency: 'USD';
  effective_from?: number;
  effective_to?: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

export type BillingSettings = {
  display_currency: 'CNY';
  usd_to_cny_exchange_rate: number;
  company_timezone: 'Asia/Shanghai';
  detail_retention_days: number;
};

export type BillingQuery = {
  start?: number;
  end?: number;
  granularity?: BillingGranularity;
  user_id?: string;
  provider_id?: string;
  provider_platform?: string;
  model?: string;
  source_type?: BillingSourceType;
  request_status?: BillingRequestStatus;
  pricing_status?: BillingPricingStatus;
};

export type BillingSummary = {
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_cny: number;
  average_cost_cny_per_1m_tokens: number;
};

export type BillingTimeseriesPoint = {
  bucket_start: number;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_cny: number;
};

export type BillingBreakdownDimension = 'model' | 'user' | 'provider' | 'source_type';

export type BillingBreakdownRow = BillingSummary & {
  key: string;
  label: string;
};

export type BillingCsvRow = {
  occurred_at: number;
  user_id: string;
  source_type: BillingSourceType;
  provider_name: string;
  provider_platform: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_cny: number;
  pricing_status: BillingPricingStatus;
  request_status: BillingRequestStatus;
};
```

- [ ] **Step 2: Add default price table**

Create `packages/desktop/src/common/types/billing/defaultPrices.ts`:

```ts
import type { BillingModelPrice, BillingSettings } from './billingTypes';

const now = 0;

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  display_currency: 'CNY',
  usd_to_cny_exchange_rate: 7.2,
  company_timezone: 'Asia/Shanghai',
  detail_retention_days: 365,
};

export const BUILTIN_MODEL_PRICES: BillingModelPrice[] = [
  {
    id: 'builtin-openai-gpt-4.1',
    scope_type: 'builtin',
    provider_platform: 'openai',
    model: 'gpt-4.1',
    input_unit_price_usd: 2,
    output_unit_price_usd: 8,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'builtin-openai-gpt-4.1-mini',
    scope_type: 'builtin',
    provider_platform: 'openai',
    model: 'gpt-4.1-mini',
    input_unit_price_usd: 0.4,
    output_unit_price_usd: 1.6,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'builtin-anthropic-claude-sonnet-4',
    scope_type: 'builtin',
    provider_platform: 'anthropic',
    model: 'claude-sonnet-4',
    input_unit_price_usd: 3,
    output_unit_price_usd: 15,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'builtin-gemini-2.5-pro',
    scope_type: 'builtin',
    provider_platform: 'gemini',
    model: 'gemini-2.5-pro',
    input_unit_price_usd: 1.25,
    output_unit_price_usd: 10,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'builtin-gemini-2.5-flash',
    scope_type: 'builtin',
    provider_platform: 'gemini',
    model: 'gemini-2.5-flash',
    input_unit_price_usd: 0.3,
    output_unit_price_usd: 2.5,
    currency: 'USD',
    enabled: true,
    created_at: now,
    updated_at: now,
  },
];
```

Note: before implementation, verify current public model prices if the user wants production-grade defaults. If not verified, label these as editable starter defaults in UI copy.

- [ ] **Step 3: Add barrel export**

Create `packages/desktop/src/common/types/billing/index.ts`:

```ts
export * from './billingTypes';
export * from './defaultPrices';
```

- [ ] **Step 4: Run type check for touched shared files**

Run:

```bash
rtk bunx tsc --noEmit
```

Expected: it may expose unrelated pre-existing project errors. If errors mention the new billing type files, fix them before continuing.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/desktop/src/common/types/billing
rtk git commit -m "feat(billing): add shared billing types"
```

---

### Task 2: Database Schema And Migration

**Files:**
- Modify: `packages/desktop/src/process/services/database/schema.ts`
- Modify: `packages/desktop/src/process/services/database/migrations.ts`
- Test: `tests/unit/bootstrap/billingMigration.test.ts`

- [ ] **Step 1: Write migration test**

Create `tests/unit/bootstrap/billingMigration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initSchema, CURRENT_DB_VERSION } from '@/process/services/database/schema';
import { runMigrations } from '@/process/services/database/migrations';

class MemoryStatement {
  constructor(private readonly db: MemoryDriver, private readonly sql: string) {}
  get(): unknown {
    if (this.sql.includes('sqlite_master')) return this.db.createdTables.has('billing_usage_events') ? { name: 'billing_usage_events' } : undefined;
    return undefined;
  }
  all(): unknown[] {
    return [];
  }
  run(): { changes: number; lastInsertRowid: number } {
    this.db.exec(this.sql);
    return { changes: 1, lastInsertRowid: 1 };
  }
}

class MemoryDriver {
  createdTables = new Set<string>();
  createdIndexes = new Set<string>();
  version = 26;
  exec(sql: string): void {
    for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)) this.createdTables.add(match[1]);
    for (const match of sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_]+)/g)) this.createdIndexes.add(match[1]);
    for (const match of sql.matchAll(/DROP TABLE IF EXISTS ([a-z_]+)/g)) this.createdTables.delete(match[1]);
  }
  prepare(sql: string): MemoryStatement {
    return new MemoryStatement(this, sql);
  }
  pragma(sql: string, options?: { simple?: boolean }): unknown {
    if (sql === 'foreign_keys = OFF' || sql === 'foreign_keys = ON') return undefined;
    if (sql === 'foreign_key_check') return [];
    if (sql === 'user_version' && options?.simple) return this.version;
    const match = sql.match(/^user_version = (\d+)$/);
    if (match) this.version = Number(match[1]);
    return undefined;
  }
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args) => fn(...args);
  }
  close(): void {}
}

describe('billing database schema', () => {
  it('creates billing tables for fresh databases', () => {
    const db = new MemoryDriver();
    initSchema(db);
    expect(db.createdTables.has('billing_usage_events')).toBe(true);
    expect(db.createdTables.has('billing_model_prices')).toBe(true);
    expect(db.createdTables.has('billing_usage_aggregates')).toBe(true);
    expect(db.createdTables.has('billing_settings')).toBe(true);
  });

  it('migration v27 adds billing tables and indexes', () => {
    const db = new MemoryDriver();
    runMigrations(db, 26, 27);
    expect(CURRENT_DB_VERSION).toBe(27);
    expect(db.createdTables.has('billing_usage_events')).toBe(true);
    expect(db.createdTables.has('billing_model_prices')).toBe(true);
    expect(db.createdTables.has('billing_usage_aggregates')).toBe(true);
    expect(db.createdIndexes.has('idx_billing_events_user_time')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk bun run test tests/unit/bootstrap/billingMigration.test.ts
```

Expected: FAIL because billing tables do not exist and `CURRENT_DB_VERSION` is still `26`.

- [ ] **Step 3: Update fresh schema**

In `packages/desktop/src/process/services/database/schema.ts`, after the team tasks table block and before the final success log, add:

```ts
  db.exec(`CREATE TABLE IF NOT EXISTS billing_usage_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    message_id TEXT,
    request_id TEXT,
    source_type TEXT NOT NULL,
    provider_id TEXT,
    provider_platform TEXT,
    provider_name TEXT,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'CNY',
    exchange_rate REAL NOT NULL,
    input_unit_price_usd REAL,
    output_unit_price_usd REAL,
    cost_usd REAL NOT NULL DEFAULT 0,
    cost_cny REAL NOT NULL DEFAULT 0,
    pricing_status TEXT NOT NULL,
    request_status TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    occurred_at INTEGER NOT NULL,
    hour_bucket INTEGER NOT NULL,
    day_bucket INTEGER NOT NULL,
    month_bucket INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_events_user_time ON billing_usage_events(user_id, occurred_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_events_time ON billing_usage_events(occurred_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_events_model_time ON billing_usage_events(model, occurred_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_events_provider_time ON billing_usage_events(provider_id, occurred_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_events_source_time ON billing_usage_events(source_type, occurred_at DESC)');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_events_dedupe
    ON billing_usage_events(conversation_id, message_id, provider_id, model)
    WHERE conversation_id IS NOT NULL AND message_id IS NOT NULL AND provider_id IS NOT NULL`);

  db.exec(`CREATE TABLE IF NOT EXISTS billing_model_prices (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL,
    scope_id TEXT,
    provider_platform TEXT,
    provider_id TEXT,
    model TEXT NOT NULL,
    input_unit_price_usd REAL NOT NULL,
    output_unit_price_usd REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    effective_from INTEGER,
    effective_to INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_prices_lookup ON billing_model_prices(scope_type, scope_id, provider_platform, provider_id, model, enabled)');

  db.exec(`CREATE TABLE IF NOT EXISTS billing_usage_aggregates (
    id TEXT PRIMARY KEY,
    granularity TEXT NOT NULL,
    bucket_start INTEGER NOT NULL,
    user_id TEXT,
    provider_id TEXT,
    provider_platform TEXT,
    model TEXT,
    source_type TEXT,
    request_count INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    cost_cny REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_aggregates_key
    ON billing_usage_aggregates(granularity, bucket_start, user_id, provider_id, provider_platform, model, source_type)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_billing_aggregates_bucket ON billing_usage_aggregates(granularity, bucket_start)');

  db.exec(`CREATE TABLE IF NOT EXISTS billing_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
```

Change:

```ts
export const CURRENT_DB_VERSION = 26;
```

to:

```ts
export const CURRENT_DB_VERSION = 27;
```

- [ ] **Step 4: Add migration v27**

In `packages/desktop/src/process/services/database/migrations.ts`, add a `migration_v27` after `migration_v26` with the same table/index creation SQL from Step 3 and a down migration that drops indexes and tables in reverse order.

Append `migration_v27` to `ALL_MIGRATIONS`:

```ts
  migration_v25, migration_v26, migration_v27,
```

- [ ] **Step 5: Run migration test**

```bash
rtk bun run test tests/unit/bootstrap/billingMigration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/desktop/src/process/services/database/schema.ts packages/desktop/src/process/services/database/migrations.ts tests/unit/bootstrap/billingMigration.test.ts
rtk git commit -m "feat(billing): add billing database schema"
```

---

### Task 3: Billing Time And Pricing Services

**Files:**
- Create: `packages/desktop/src/process/services/billing/billingTime.ts`
- Create: `packages/desktop/src/process/services/billing/pricing.ts`
- Create: `packages/desktop/src/process/services/billing/index.ts`
- Test: `tests/unit/billing/billingTime.test.ts`
- Test: `tests/unit/billing/pricing.test.ts`

- [ ] **Step 1: Write time bucket tests**

Create `tests/unit/billing/billingTime.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getBillingBuckets } from '@/process/services/billing/billingTime';

describe('billing time buckets', () => {
  it('uses Asia/Shanghai calendar boundaries', () => {
    const occurredAt = Date.UTC(2026, 5, 30, 16, 30, 0); // 2026-07-01 00:30 Asia/Shanghai
    const buckets = getBillingBuckets(occurredAt);
    expect(new Date(buckets.day_bucket).toISOString()).toBe('2026-06-30T16:00:00.000Z');
    expect(new Date(buckets.month_bucket).toISOString()).toBe('2026-06-30T16:00:00.000Z');
    expect(new Date(buckets.hour_bucket).toISOString()).toBe('2026-06-30T16:00:00.000Z');
  });
});
```

- [ ] **Step 2: Write pricing tests**

Create `tests/unit/billing/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BillingModelPrice } from '@/common/types/billing';
import { calculateTokenCost, resolveBillingPrice } from '@/process/services/billing/pricing';

const price = (partial: Partial<BillingModelPrice>): BillingModelPrice => ({
  id: partial.id ?? 'p',
  scope_type: partial.scope_type ?? 'builtin',
  model: partial.model ?? 'gpt-test',
  input_unit_price_usd: partial.input_unit_price_usd ?? 1,
  output_unit_price_usd: partial.output_unit_price_usd ?? 2,
  currency: 'USD',
  enabled: partial.enabled ?? true,
  created_at: 0,
  updated_at: 0,
  ...partial,
});

describe('billing pricing', () => {
  it('prefers user provider override over global and builtin', () => {
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

  it('computes USD and CNY from per-1M input and output prices', () => {
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
```

- [ ] **Step 3: Run tests to verify failure**

```bash
rtk bun run test tests/unit/billing/billingTime.test.ts tests/unit/billing/pricing.test.ts
```

Expected: FAIL because service files do not exist.

- [ ] **Step 4: Implement time helpers**

Create `packages/desktop/src/process/services/billing/billingTime.ts`:

```ts
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const bucketUtcMs = (timestamp: number, granularity: 'hour' | 'day' | 'month'): number => {
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();

  const localBucket =
    granularity === 'month'
      ? Date.UTC(year, month, 1)
      : granularity === 'day'
        ? Date.UTC(year, month, day)
        : Date.UTC(year, month, day, hour);

  return localBucket - SHANGHAI_OFFSET_MS;
};

export function getBillingBuckets(timestamp: number): {
  hour_bucket: number;
  day_bucket: number;
  month_bucket: number;
} {
  return {
    hour_bucket: bucketUtcMs(timestamp, 'hour'),
    day_bucket: bucketUtcMs(timestamp, 'day'),
    month_bucket: bucketUtcMs(timestamp, 'month'),
  };
}
```

- [ ] **Step 5: Implement pricing helpers**

Create `packages/desktop/src/process/services/billing/pricing.ts`:

```ts
import type { BillingModelPrice } from '@/common/types/billing';

export type BillingPriceLookup = {
  user_id: string;
  provider_id?: string;
  provider_platform?: string;
  model: string;
};

const matchesModel = (price: BillingModelPrice, lookup: BillingPriceLookup): boolean => {
  if (!price.enabled) return false;
  if (price.model !== lookup.model) return false;
  if (price.provider_id && price.provider_id !== lookup.provider_id) return false;
  if (price.provider_platform && price.provider_platform !== lookup.provider_platform) return false;
  return true;
};

export function resolveBillingPrice(
  lookup: BillingPriceLookup,
  prices: BillingModelPrice[]
): BillingModelPrice | null {
  const candidates = prices.filter((price) => matchesModel(price, lookup));

  return (
    candidates.find(
      (price) =>
        price.scope_type === 'user_provider' &&
        price.scope_id === lookup.user_id &&
        (!price.provider_id || price.provider_id === lookup.provider_id)
    ) ??
    candidates.find((price) => price.scope_type === 'global') ??
    candidates.find((price) => price.scope_type === 'builtin') ??
    null
  );
}

export function calculateTokenCost(input: {
  input_tokens: number;
  output_tokens: number;
  input_unit_price_usd: number;
  output_unit_price_usd: number;
  exchange_rate: number;
}): { cost_usd: number; cost_cny: number } {
  const inputUsd = (input.input_tokens / 1_000_000) * input.input_unit_price_usd;
  const outputUsd = (input.output_tokens / 1_000_000) * input.output_unit_price_usd;
  const cost_usd = Number((inputUsd + outputUsd).toFixed(8));
  return {
    cost_usd,
    cost_cny: Number((cost_usd * input.exchange_rate).toFixed(8)),
  };
}
```

- [ ] **Step 6: Add billing service barrel**

Create `packages/desktop/src/process/services/billing/index.ts`:

```ts
export * from './billingTime';
export * from './pricing';
```

- [ ] **Step 7: Run tests**

```bash
rtk bun run test tests/unit/billing/billingTime.test.ts tests/unit/billing/pricing.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/desktop/src/process/services/billing tests/unit/billing
rtk git commit -m "feat(billing): add pricing and time helpers"
```

---

### Task 4: Billing Repository, Recording, Aggregation, And Retention

**Files:**
- Create: `packages/desktop/src/process/services/billing/repository.ts`
- Create: `packages/desktop/src/process/services/billing/recorder.ts`
- Modify: `packages/desktop/src/process/services/billing/index.ts`
- Test: `tests/unit/billing/repository.test.ts`
- Test: `tests/unit/billing/recorder.test.ts`

- [ ] **Step 1: Write repository tests**

Create `tests/unit/billing/repository.test.ts` using the in-memory driver pattern from Task 2 or `BetterSqlite3Driver` with a temp file if `better-sqlite3` works in tests:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initSchema } from '@/process/services/database/schema';
import { BetterSqlite3Driver } from '@/process/services/database/drivers/BetterSqlite3Driver';
import { BillingRepository } from '@/process/services/billing/repository';

let dir: string | null = null;

const createRepo = () => {
  dir = mkdtempSync(path.join(tmpdir(), 'billing-repo-'));
  const driver = new BetterSqlite3Driver(path.join(dir, 'test.db'));
  initSchema(driver);
  driver.prepare(
    `INSERT INTO users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run('u1', 'user1', 'hash', 1, 1);
  return { driver, repo: new BillingRepository(driver) };
};

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('BillingRepository', () => {
  it('inserts events and returns summary totals', () => {
    const { driver, repo } = createRepo();
    repo.insertEvent({
      id: 'event-1',
      user_id: 'u1',
      source_type: 'chat',
      provider_id: 'p1',
      provider_platform: 'openai',
      provider_name: 'OpenAI',
      model: 'gpt-test',
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      currency: 'CNY',
      exchange_rate: 7.2,
      input_unit_price_usd: 1,
      output_unit_price_usd: 2,
      cost_usd: 0.0002,
      cost_cny: 0.00144,
      pricing_status: 'priced',
      request_status: 'completed',
      metadata: {},
      occurred_at: 1_000,
      hour_bucket: 0,
      day_bucket: 0,
      month_bucket: 0,
      created_at: 1_000,
    });
    const summary = repo.getSummary({ user_id: 'u1' });
    expect(summary.request_count).toBe(1);
    expect(summary.total_tokens).toBe(150);
    expect(summary.cost_cny).toBeCloseTo(0.00144);
    driver.close();
  });

  it('retains aggregates when old detail rows are deleted', () => {
    const { driver, repo } = createRepo();
    repo.deleteEventsOlderThan(10_000);
    expect(repo.getSummary({ user_id: 'u1' }).request_count).toBe(0);
    driver.close();
  });
});
```

- [ ] **Step 2: Write recorder tests**

Create `tests/unit/billing/recorder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recordBillingUsage } from '@/process/services/billing/recorder';
import type { BillingModelPrice, BillingUsageEvent } from '@/common/types/billing';

class FakeRepo {
  prices: BillingModelPrice[] = [];
  events: BillingUsageEvent[] = [];
  settings = {
    display_currency: 'CNY' as const,
    usd_to_cny_exchange_rate: 7.2,
    company_timezone: 'Asia/Shanghai' as const,
    detail_retention_days: 365,
  };
  getSettings() {
    return this.settings;
  }
  listPrices() {
    return this.prices;
  }
  insertEvent(event: BillingUsageEvent) {
    if (this.events.some((e) => e.id === event.id)) return false;
    this.events.push(event);
    return true;
  }
  upsertAggregates() {}
}

describe('recordBillingUsage', () => {
  it('records tokens with missing_price when no price matches', () => {
    const repo = new FakeRepo();
    const event = recordBillingUsage(repo as never, {
      user_id: 'u1',
      source_type: 'chat',
      provider_platform: 'unknown',
      model: 'missing-model',
      input_tokens: 100,
      output_tokens: 50,
      request_id: 'r1',
    });
    expect(event.pricing_status).toBe('missing_price');
    expect(event.cost_cny).toBe(0);
    expect(repo.events).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
rtk bun run test tests/unit/billing/repository.test.ts tests/unit/billing/recorder.test.ts
```

Expected: FAIL because repository and recorder are missing.

- [ ] **Step 4: Implement repository**

Create `packages/desktop/src/process/services/billing/repository.ts` with a `BillingRepository` class:

```ts
import type {
  BillingCsvRow,
  BillingModelPrice,
  BillingQuery,
  BillingSettings,
  BillingSummary,
  BillingTimeseriesPoint,
  BillingUsageEvent,
} from '@/common/types/billing';
import { DEFAULT_BILLING_SETTINGS } from '@/common/types/billing';
import type { ISqliteDriver } from '../database/drivers/ISqliteDriver';

const json = (value: unknown): string => JSON.stringify(value ?? {});
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export class BillingRepository {
  constructor(private readonly db: ISqliteDriver) {}

  getSettings(): BillingSettings {
    const rows = this.db.prepare('SELECT key, value FROM billing_settings').all() as Array<{ key: string; value: string }>;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return {
      ...DEFAULT_BILLING_SETTINGS,
      usd_to_cny_exchange_rate: Number(values.get('usd_to_cny_exchange_rate') ?? DEFAULT_BILLING_SETTINGS.usd_to_cny_exchange_rate),
      detail_retention_days: Number(values.get('detail_retention_days') ?? DEFAULT_BILLING_SETTINGS.detail_retention_days),
    };
  }

  listPrices(): BillingModelPrice[] {
    return this.db.prepare('SELECT * FROM billing_model_prices WHERE enabled = 1').all() as BillingModelPrice[];
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
        json(event.metadata),
        event.occurred_at,
        event.hour_bucket,
        event.day_bucket,
        event.month_bucket,
        event.created_at
      );
    return result.changes > 0;
  }

  upsertAggregates(event: BillingUsageEvent): void {
    for (const [granularity, bucket] of [
      ['hour', event.hour_bucket],
      ['day', event.day_bucket],
      ['month', event.month_bucket],
    ] as const) {
      const id = [granularity, bucket, event.user_id, event.provider_id ?? '', event.provider_platform ?? '', event.model, event.source_type].join(':');
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
          id,
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
    const rows = this.queryEvents(query);
    const total = rows.reduce(
      (acc, row) => ({
        request_count: acc.request_count + 1,
        input_tokens: acc.input_tokens + row.input_tokens,
        output_tokens: acc.output_tokens + row.output_tokens,
        total_tokens: acc.total_tokens + row.total_tokens,
        cost_usd: acc.cost_usd + row.cost_usd,
        cost_cny: acc.cost_cny + row.cost_cny,
      }),
      { request_count: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, cost_cny: 0 }
    );
    return {
      ...total,
      average_cost_cny_per_1m_tokens: total.total_tokens > 0 ? (total.cost_cny / total.total_tokens) * 1_000_000 : 0,
    };
  }

  queryEvents(query: BillingQuery): BillingUsageEvent[] {
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (query.user_id) {
      clauses.push('user_id = ?');
      args.push(query.user_id);
    }
    if (query.start) {
      clauses.push('occurred_at >= ?');
      args.push(query.start);
    }
    if (query.end) {
      clauses.push('occurred_at <= ?');
      args.push(query.end);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.db.prepare(`SELECT * FROM billing_usage_events ${where} ORDER BY occurred_at DESC`).all(...args) as BillingUsageEvent[]).map(
      (row) => ({ ...row, metadata: parseJson(row.metadata, {}) })
    );
  }

  getTimeseries(_query: BillingQuery): BillingTimeseriesPoint[] {
    return [];
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

  deleteEventsOlderThan(cutoff: number): number {
    return this.db.prepare('DELETE FROM billing_usage_events WHERE occurred_at < ?').run(cutoff).changes;
  }
}
```

- [ ] **Step 5: Implement recorder**

Create `packages/desktop/src/process/services/billing/recorder.ts`:

```ts
import type { BillingUsageEvent, BillingUsageInput } from '@/common/types/billing';
import { uuid } from '@/common/utils';
import { getBillingBuckets } from './billingTime';
import { calculateTokenCost, resolveBillingPrice } from './pricing';

type BillingRecorderRepo = {
  getSettings(): { usd_to_cny_exchange_rate: number };
  listPrices(): Parameters<typeof resolveBillingPrice>[1];
  insertEvent(event: BillingUsageEvent): boolean;
  upsertAggregates(event: BillingUsageEvent): void;
};

export function recordBillingUsage(repo: BillingRecorderRepo, input: BillingUsageInput): BillingUsageEvent {
  const now = Date.now();
  const occurred_at = input.occurred_at ?? now;
  const settings = repo.getSettings();
  const price = resolveBillingPrice(
    {
      user_id: input.user_id,
      provider_id: input.provider_id,
      provider_platform: input.provider_platform,
      model: input.model,
    },
    repo.listPrices()
  );
  const cost = price
    ? calculateTokenCost({
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        input_unit_price_usd: price.input_unit_price_usd,
        output_unit_price_usd: price.output_unit_price_usd,
        exchange_rate: settings.usd_to_cny_exchange_rate,
      })
    : { cost_usd: 0, cost_cny: 0 };
  const buckets = getBillingBuckets(occurred_at);
  const event: BillingUsageEvent = {
    ...input,
    id: input.request_id ? `billing:${input.request_id}` : uuid(),
    input_tokens: Math.max(0, input.input_tokens),
    output_tokens: Math.max(0, input.output_tokens),
    total_tokens: Math.max(0, input.input_tokens) + Math.max(0, input.output_tokens),
    currency: 'CNY',
    exchange_rate: settings.usd_to_cny_exchange_rate,
    input_unit_price_usd: price?.input_unit_price_usd ?? null,
    output_unit_price_usd: price?.output_unit_price_usd ?? null,
    cost_usd: cost.cost_usd,
    cost_cny: cost.cost_cny,
    pricing_status: price ? 'priced' : 'missing_price',
    request_status: input.request_status ?? 'completed',
    metadata: input.metadata ?? {},
    occurred_at,
    ...buckets,
    created_at: now,
  };
  if (repo.insertEvent(event)) repo.upsertAggregates(event);
  return event;
}
```

- [ ] **Step 6: Export repository and recorder**

Update `packages/desktop/src/process/services/billing/index.ts`:

```ts
export * from './billingTime';
export * from './pricing';
export * from './repository';
export * from './recorder';
```

- [ ] **Step 7: Run billing service tests**

```bash
rtk bun run test tests/unit/billing/repository.test.ts tests/unit/billing/recorder.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add packages/desktop/src/process/services/billing tests/unit/billing
rtk git commit -m "feat(billing): record usage events"
```

---

### Task 5: Bridge Facade, CSV Export, And Permission Scoping

**Files:**
- Create: `packages/desktop/src/process/bridge/billingBridge.ts`
- Modify: `packages/desktop/src/process/bridge/index.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Test: `tests/unit/billing/csvExport.test.ts`

- [ ] **Step 1: Add CSV export test for escaping and headers**

Create `tests/unit/billing/csvExport.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify failure**

```bash
rtk bun run test tests/unit/billing/csvExport.test.ts
```

Expected: FAIL because `billingBridge.ts` does not exist.

- [ ] **Step 3: Implement billing bridge**

Create `packages/desktop/src/process/bridge/billingBridge.ts`:

```ts
import path from 'node:path';
import { bridge } from '@office-ai/platform';
import { getDataPath } from '../utils/initStorage';
import { BetterSqlite3Driver } from '../services/database/drivers/BetterSqlite3Driver';
import { BillingRepository } from '../services/billing';
import type { BillingCsvRow, BillingQuery } from '@/common/types/billing';

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

const withRepo = <T>(fn: (repo: BillingRepository) => T): T => {
  const driver = new BetterSqlite3Driver(path.join(getDataPath(), 'aionui-backend.db'));
  try {
    return fn(new BillingRepository(driver));
  } finally {
    driver.close();
  }
};

export function initBillingBridge(): void {
  bridge.buildProvider('billing.summary', async (query: BillingQuery) => withRepo((repo) => repo.getSummary(query)));
  bridge.buildProvider('billing.events', async (query: BillingQuery) => withRepo((repo) => repo.queryEvents(query)));
  bridge.buildProvider('billing.exportCsv', async (query: BillingQuery) =>
    withRepo((repo) => billingRowsToCsv(repo.getCsvRows(query)))
  );
}
```

During implementation, add `prices`, `savePrices`, `timeseries`, and `breakdown` providers once repository methods exist. Keep `billingRowsToCsv` exported for tests.

- [ ] **Step 4: Register bridge**

Modify `packages/desktop/src/process/bridge/index.ts`:

```ts
import { initBillingBridge } from './billingBridge';
```

and call:

```ts
  initBillingBridge();
```

after existing local service bridges.

- [ ] **Step 5: Add renderer bridge facade**

In `packages/desktop/src/common/adapter/ipcBridge.ts`, import billing types and add:

```ts
export const billing = {
  summary: bridge.buildProvider<BillingSummary, BillingQuery>('billing.summary'),
  events: bridge.buildProvider<BillingUsageEvent[], BillingQuery>('billing.events'),
  exportCsv: bridge.buildProvider<string, BillingQuery>('billing.exportCsv'),
};
```

If this file already imports `bridge`, reuse it. Add DTO imports from `../types/billing`.

- [ ] **Step 6: Run bridge/CSV test**

```bash
rtk bun run test tests/unit/billing/csvExport.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/desktop/src/process/bridge/billingBridge.ts packages/desktop/src/process/bridge/index.ts packages/desktop/src/common/adapter/ipcBridge.ts tests/unit/billing/csvExport.test.ts
rtk git commit -m "feat(billing): expose billing bridge"
```

---

### Task 6: Aionrs Usage Capture

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/useAionrsMessage.ts`
- Modify or create service helper: `packages/desktop/src/renderer/pages/billing/utils/sourceType.ts`
- Test: `tests/unit/billing/aionrsBillingCapture.test.ts` or extend existing renderer hook tests if available.

- [ ] **Step 1: Add a small source-type resolver**

Create `packages/desktop/src/renderer/pages/billing/utils/sourceType.ts`:

```ts
import type { BillingSourceType } from '@/common/types/billing';
import type { TChatConversation } from '@/common/config/storage';

export function resolveBillingSourceType(conversation?: TChatConversation | null): BillingSourceType {
  if (!conversation) return 'unknown';
  if (conversation.type === 'aionrs' || conversation.type === 'acp') return 'chat';
  if (conversation.type === 'team') return 'decision_room';
  const extra = conversation.extra as Record<string, unknown> | undefined;
  if (extra?.assistant_id && typeof extra.assistant_id === 'string') {
    return extra.assistant_id.startsWith('agency-') ? 'advisor' : 'office_assistant';
  }
  return 'unknown';
}
```

Adjust type checks during implementation to match actual `TChatConversation.type` values.

- [ ] **Step 2: Add billing call in Aionrs finish handling**

In `useAionrsMessage.ts`, after usage data is converted to `newTokenUsage`, resolve the current conversation and call the billing bridge:

```ts
const conversation = getConversationOrNull(conversation_id);
void ipcBridge.billing.recordUsage?.invoke?.({
  user_id: conversation?.user_id ?? 'system_default_user',
  conversation_id,
  message_id: message.msg_id,
  request_id: message.msg_id ? `aionrs:${conversation_id}:${message.msg_id}` : undefined,
  source_type: resolveBillingSourceType(conversation),
  provider_id: conversation?.model?.id,
  provider_platform: conversation?.model?.platform,
  provider_name: conversation?.model?.name,
  model: conversation?.model?.use_model ?? conversation?.model?.model ?? 'unknown',
  input_tokens: usageData.input_tokens || 0,
  output_tokens: usageData.output_tokens || 0,
  request_status: 'completed',
  occurred_at: Date.now(),
});
```

If `recordUsage` is not exposed through bridge yet, add it to Task 5 bridge facade before wiring this. If `conversation.model` does not carry these fields for Aionrs, use the existing selected model state passed into `AionrsSendBox` and thread it into the hook cleanly.

- [ ] **Step 3: Avoid billing ACP context usage**

In `useAcpMessage.ts`, leave `acp_context_usage` as UI context usage only. Add a short comment:

```ts
// Context usage is not billable token usage. Billing only records exact provider usage.
```

- [ ] **Step 4: Run focused tests**

```bash
rtk bun run test tests/unit/renderer/AcpSendBox.dom.test.tsx tests/unit/billing/recorder.test.ts
```

Expected: PASS. Add a dedicated capture test if hook structure allows stable mocking without brittle event setup.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/desktop/src/renderer/pages/conversation/platforms/aionrs/useAionrsMessage.ts packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts packages/desktop/src/renderer/pages/billing/utils/sourceType.ts
rtk git commit -m "feat(billing): capture direct model usage"
```

---

### Task 7: Billing Dashboard Route And Sidebar Entry

**Files:**
- Create: `packages/desktop/src/renderer/pages/billing/index.tsx`
- Create: `packages/desktop/src/renderer/pages/billing/BillingPage.tsx`
- Create: `packages/desktop/src/renderer/pages/billing/hooks/useBillingData.ts`
- Create: `packages/desktop/src/renderer/pages/billing/utils/formatters.ts`
- Modify: `packages/desktop/src/renderer/components/layout/Router.tsx`
- Modify: `packages/desktop/src/renderer/components/layout/Sider/index.tsx`
- Modify: `packages/desktop/src/renderer/components/layout/Sider/SiderNav.tsx`
- Test: `tests/unit/billing/BillingPage.dom.test.tsx`

- [ ] **Step 1: Inspect SiderNav exports**

Run:

```bash
rtk sed -n '1,260p' packages/desktop/src/renderer/components/layout/Sider/SiderNav.tsx
```

Use the existing icon/button pattern for the new billing entry. Prefer an `@icon-park/react` icon already in the dependency, such as `Bill` if available, otherwise `ChartHistogram` or `Data`.

- [ ] **Step 2: Add basic dashboard hook**

Create `packages/desktop/src/renderer/pages/billing/hooks/useBillingData.ts`:

```ts
import { ipcBridge } from '@/common';
import type { BillingQuery } from '@/common/types/billing';
import useSWR from 'swr';

export const BILLING_SUMMARY_KEY = 'billing.summary';
export const BILLING_EVENTS_KEY = 'billing.events';

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
```

- [ ] **Step 3: Add formatting helpers**

Create `packages/desktop/src/renderer/pages/billing/utils/formatters.ts`:

```ts
export const formatCny = (value: number): string =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(value);

export const formatTokens = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
};
```

- [ ] **Step 4: Add page shell**

Create `packages/desktop/src/renderer/pages/billing/BillingPage.tsx`:

```tsx
import React, { useMemo } from 'react';
import { Card, DatePicker, Empty, Spin, Tabs, Table, Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { BillingQuery } from '@/common/types/billing';
import { useBillingEvents, useBillingSummary } from './hooks/useBillingData';
import { formatCny, formatTokens } from './utils/formatters';

const BillingPage: React.FC = () => {
  const { t } = useTranslation();
  const query = useMemo<BillingQuery>(() => ({ granularity: 'day' }), []);
  const summary = useBillingSummary(query);
  const events = useBillingEvents(query);

  return (
    <div className='h-full overflow-auto bg-1 p-16px'>
      <div className='mb-16px flex items-center justify-between gap-12px'>
        <div>
          <h2 className='m-0 text-20px font-600'>{t('billing.title', { defaultValue: '费用看板' })}</h2>
          <p className='m-0 mt-4px text-12px text-t-secondary'>
            {t('billing.subtitle', { defaultValue: '查看 Token 使用量、模型成本和费用趋势' })}
          </p>
        </div>
        <DatePicker.RangePicker />
      </div>
      <Tabs defaultActiveTab='overview'>
        <Tabs.TabPane key='overview' title={t('billing.tabs.overview', { defaultValue: '总览' })}>
          {summary.isLoading ? (
            <Spin />
          ) : (
            <div className='grid grid-cols-1 gap-12px md:grid-cols-4'>
              <Card title={t('billing.metric.cost', { defaultValue: '总费用' })}>{formatCny(summary.data?.cost_cny ?? 0)}</Card>
              <Card title={t('billing.metric.tokens', { defaultValue: '总 Token' })}>{formatTokens(summary.data?.total_tokens ?? 0)}</Card>
              <Card title={t('billing.metric.input', { defaultValue: '输入 Token' })}>{formatTokens(summary.data?.input_tokens ?? 0)}</Card>
              <Card title={t('billing.metric.output', { defaultValue: '输出 Token' })}>{formatTokens(summary.data?.output_tokens ?? 0)}</Card>
            </div>
          )}
          <Card className='mt-12px' title={t('billing.trend.title', { defaultValue: '费用趋势' })}>
            <Empty description={t('billing.trend.empty', { defaultValue: '暂无趋势数据' })} />
          </Card>
        </Tabs.TabPane>
        <Tabs.TabPane key='details' title={t('billing.tabs.details', { defaultValue: '明细' })}>
          <div className='mb-12px flex justify-end'>
            <Button>{t('billing.exportCsv', { defaultValue: '导出 CSV' })}</Button>
          </div>
          <Table
            rowKey='id'
            loading={events.isLoading}
            data={events.data ?? []}
            columns={[
              { title: t('billing.table.model', { defaultValue: '模型' }), dataIndex: 'model' },
              { title: t('billing.table.input', { defaultValue: '输入' }), dataIndex: 'input_tokens' },
              { title: t('billing.table.output', { defaultValue: '输出' }), dataIndex: 'output_tokens' },
              { title: t('billing.table.cost', { defaultValue: '费用' }), render: (_, row) => formatCny(row.cost_cny) },
            ]}
          />
        </Tabs.TabPane>
        <Tabs.TabPane key='prices' title={t('billing.tabs.prices', { defaultValue: '价格设置' })}>
          <Empty description={t('billing.prices.empty', { defaultValue: '价格设置将在后续任务中补齐' })} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default BillingPage;
```

Create `packages/desktop/src/renderer/pages/billing/index.tsx`:

```ts
export { default } from './BillingPage';
```

- [ ] **Step 5: Add route**

Modify `Router.tsx`:

```ts
const BillingPage = React.lazy(() => import('@renderer/pages/billing'));
```

Add protected route:

```tsx
<Route path='/billing' element={withRouteFallback(BillingPage)} />
```

- [ ] **Step 6: Add sidebar entry**

Follow `SiderScheduledEntry` / `SiderFilesEntry` pattern in `SiderNav.tsx` and `Sider/index.tsx`. Add a first-level entry that navigates to `/billing` and uses i18n key `billing.title`.

- [ ] **Step 7: Add i18n keys**

Add `billing` keys to the locale module convention used by the project. At minimum add Simplified Chinese and English fallback/default values:

```json
{
  "title": "费用看板",
  "subtitle": "查看 Token 使用量、模型成本和费用趋势",
  "tabs": {
    "overview": "总览",
    "details": "明细",
    "prices": "价格设置"
  },
  "metric": {
    "cost": "总费用",
    "tokens": "总 Token",
    "input": "输入 Token",
    "output": "输出 Token"
  },
  "trend": {
    "title": "费用趋势",
    "empty": "暂无趋势数据"
  },
  "table": {
    "model": "模型",
    "input": "输入",
    "output": "输出",
    "cost": "费用"
  },
  "exportCsv": "导出 CSV",
  "prices": {
    "empty": "价格设置将在后续任务中补齐"
  }
}
```

- [ ] **Step 8: Run UI-related tests**

```bash
rtk bun run test tests/unit/renderer/messageList.dom.test.tsx tests/unit/billing/BillingPage.dom.test.tsx --passWithNoTests
rtk bunx tsc --noEmit
```

Expected: billing page compiles; focused tests pass or no billing DOM test exists yet.

- [ ] **Step 9: Commit**

```bash
rtk git add packages/desktop/src/renderer/pages/billing packages/desktop/src/renderer/components/layout packages/desktop/src/renderer/services/i18n packages/desktop/src/common/adapter/ipcBridge.ts
rtk git commit -m "feat(billing): add billing dashboard route"
```

---

### Task 8: Details, Price Settings, Timeseries, Breakdowns, And CSV Download Polish

**Files:**
- Modify: `packages/desktop/src/process/services/billing/repository.ts`
- Modify: `packages/desktop/src/process/bridge/billingBridge.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Create: `packages/desktop/src/renderer/pages/billing/components/BillingOverview.tsx`
- Create: `packages/desktop/src/renderer/pages/billing/components/BillingDetails.tsx`
- Create: `packages/desktop/src/renderer/pages/billing/components/BillingPriceSettings.tsx`
- Modify: `packages/desktop/src/renderer/pages/billing/BillingPage.tsx`
- Test: extend `tests/unit/billing/repository.test.ts`

- [ ] **Step 1: Extend repository tests for breakdown and timeseries**

Add tests asserting:

```ts
expect(repo.getTimeseries({ user_id: 'u1', granularity: 'hour' })).toHaveLength(1);
expect(repo.getBreakdown({ user_id: 'u1' }, 'model')[0].key).toBe('gpt-test');
```

- [ ] **Step 2: Implement repository methods**

Add `getTimeseries(query)`, `getBreakdown(query, dimension)`, `upsertPrice(price)`, `listMissingPriceModels()`, and `saveSetting(key, value)` to `BillingRepository`. Use parameterized SQL and the same filter builder as `queryEvents`.

- [ ] **Step 3: Extend bridge facade**

Add bridge providers:

```ts
billing.timeseries
billing.breakdown
billing.prices
billing.savePrice
billing.settings
billing.saveSettings
billing.recordUsage
```

For `recordUsage`, call `recordBillingUsage(repo, input)`.

- [ ] **Step 4: Split UI into components**

Move overview cards and charts into `BillingOverview.tsx`, details table into `BillingDetails.tsx`, and price settings into `BillingPriceSettings.tsx`. Keep `BillingPage.tsx` responsible for query/filter state and tabs only.

- [ ] **Step 5: Implement CSV browser download**

In `BillingDetails.tsx`, call `ipcBridge.billing.exportCsv.invoke(query)`, create a Blob, and trigger a download named:

```ts
`centaurai-billing-${Date.now()}.csv`
```

- [ ] **Step 6: Run tests and typecheck**

```bash
rtk bun run test tests/unit/billing
rtk bunx tsc --noEmit
```

Expected: billing tests pass; no new type errors.

- [ ] **Step 7: Commit**

```bash
rtk git add packages/desktop/src/process/services/billing packages/desktop/src/process/bridge/billingBridge.ts packages/desktop/src/common/adapter/ipcBridge.ts packages/desktop/src/renderer/pages/billing tests/unit/billing
rtk git commit -m "feat(billing): complete dashboard data views"
```

---

### Task 9: Retention Cleanup And Startup Wiring

**Files:**
- Create: `packages/desktop/src/process/services/billing/retention.ts`
- Modify: `packages/desktop/src/process/services/billing/index.ts`
- Modify: `packages/desktop/src/index.ts` or an appropriate startup file under `packages/desktop/src/process/startup/`
- Test: `tests/unit/billing/retention.test.ts`

- [ ] **Step 1: Write retention test**

Create `tests/unit/billing/retention.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runBillingRetention } from '@/process/services/billing/retention';

describe('runBillingRetention', () => {
  it('deletes detail rows older than configured retention days', () => {
    const repo = {
      getSettings: () => ({ detail_retention_days: 365 }),
      deleteEventsOlderThan: vi.fn(() => 3),
    };
    const now = Date.UTC(2026, 5, 30);
    expect(runBillingRetention(repo as never, now)).toBe(3);
    expect(repo.deleteEventsOlderThan).toHaveBeenCalledWith(now - 365 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Implement retention service**

Create `packages/desktop/src/process/services/billing/retention.ts`:

```ts
type RetentionRepo = {
  getSettings(): { detail_retention_days: number };
  deleteEventsOlderThan(cutoff: number): number;
};

export function runBillingRetention(repo: RetentionRepo, now = Date.now()): number {
  const days = repo.getSettings().detail_retention_days;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return repo.deleteEventsOlderThan(cutoff);
}
```

- [ ] **Step 3: Export retention**

Update `packages/desktop/src/process/services/billing/index.ts`:

```ts
export * from './retention';
```

- [ ] **Step 4: Wire startup cleanup**

Find a startup path after backend database migrations run. Add a guarded call that opens `aionui-backend.db`, constructs `BillingRepository`, calls `runBillingRetention`, logs deleted row count, and closes the driver. Do not block app startup on cleanup failure; log and continue.

- [ ] **Step 5: Run retention test**

```bash
rtk bun run test tests/unit/billing/retention.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add packages/desktop/src/process/services/billing packages/desktop/src/index.ts tests/unit/billing/retention.test.ts
rtk git commit -m "feat(billing): add usage retention cleanup"
```

---

### Task 10: Team Repository Verification

**Files:** no expected source edits unless failures are found.

- [ ] **Step 1: Run focused billing tests**

```bash
rtk bun run test tests/unit/billing
```

Expected: PASS.

- [ ] **Step 2: Run migration and bridge tests**

```bash
rtk bun run test tests/unit/bootstrap/billingMigration.test.ts tests/unit/common-adapter/httpBridge.test.ts tests/unit/renderer/auth/AuthContext.dom.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
rtk bunx tsc --noEmit
```

Expected: PASS or only documented pre-existing errors. New billing errors must be fixed.

- [ ] **Step 4: Run i18n validation if locale files changed**

```bash
rtk bun run i18n:types
rtk node scripts/check-i18n.js
```

Expected: PASS.

- [ ] **Step 5: Commit fixes if needed**

If verification required fixes:

```bash
rtk git add <fixed-files>
rtk git commit -m "fix(billing): stabilize dashboard verification"
```

---

### Task 11: Apply Same Patch To `centaurai-decision`

**Files:** same source files as Tasks 1-10 in `/Users/longxiping/Public/workspace/qs/ai/nexusaos/nexusaos-centuarai/centaurai-decision`.

- [ ] **Step 1: Export team patch series**

From `centaurai-team`, identify commits after the plan/spec commit:

```bash
rtk git log --oneline --decorate -12
```

Create patches for billing implementation commits only:

```bash
rtk git format-patch --stdout <base-commit>..HEAD > /tmp/centaurai-billing.patch
```

Use the commit before Task 1 implementation as `<base-commit>`.

- [ ] **Step 2: Apply patch to decision repo**

```bash
cd /Users/longxiping/Public/workspace/qs/ai/nexusaos/nexusaos-centuarai/centaurai-decision
rtk git apply /tmp/centaurai-billing.patch
```

If patch context differs, manually apply equivalent changes. Do not alter `EDITION.md`.

- [ ] **Step 3: Run decision focused tests**

```bash
rtk bun run test tests/unit/billing
rtk bun run test tests/unit/bootstrap/billingMigration.test.ts
rtk bunx tsc --noEmit
```

Expected: same result as team repo. Fix only decision-specific conflicts.

- [ ] **Step 4: Commit decision implementation**

```bash
rtk git add packages tests
rtk git commit -m "feat(billing): add billing dashboard"
```

---

### Task 12: Final Cross-Edition Verification

**Files:** no expected source edits unless failures are found.

- [ ] **Step 1: Verify team repo status and latest commits**

```bash
cd /Users/longxiping/Public/workspace/qs/ai/nexusaos/nexusaos-centuarai/centaurai-team
rtk proxy git status --short --branch
rtk git log --oneline -5
```

Expected: clean except branch ahead count; latest commits include billing implementation.

- [ ] **Step 2: Verify decision repo status and latest commits**

```bash
cd /Users/longxiping/Public/workspace/qs/ai/nexusaos/nexusaos-centuarai/centaurai-decision
rtk proxy git status --short --branch
rtk git log --oneline -5
```

Expected: clean except branch ahead count; latest commits include billing implementation.

- [ ] **Step 3: Run final focused suites in both repos**

Team:

```bash
cd /Users/longxiping/Public/workspace/qs/ai/nexusaos/nexusaos-centuarai/centaurai-team
rtk bun run test tests/unit/billing tests/unit/bootstrap/billingMigration.test.ts
```

Decision:

```bash
cd /Users/longxiping/Public/workspace/qs/ai/nexusaos/nexusaos-centuarai/centaurai-decision
rtk bun run test tests/unit/billing tests/unit/bootstrap/billingMigration.test.ts
```

Expected: PASS in both repos.

- [ ] **Step 4: Document any skipped scope**

If CLI-agent billing, online price updates, or non-text billing remain unimplemented, do not create placeholder code. Ensure the final response says those are intentionally outside v1 per the approved spec.

