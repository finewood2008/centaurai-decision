# Billing Upstream API Contract

Version: v1
Date: 2026-06-30
Applies to: `centaurai-team`, `centaurai-decision`
Status: Upstream implementation contract

## 1. Purpose

CentaurAI needs a billing dashboard that shows token usage, model usage, cost, total cost, hourly data, daily data, and detailed usage records.

The dashboard must not generate billing data locally. The client only calls upstream APIs with a provider key identifier and renders the returned data.

This document defines the API contract that the upstream service must implement.

## 2. Mandatory Boundary

The following rules are mandatory:

- The client must not write a local billing ledger.
- The client must not calculate cost from model prices.
- The client must not aggregate billing data from local chat messages.
- The client must not treat `last_token_usage` in a conversation as billing source of truth.
- The client must not store provider API key secrets for billing analytics.
- The upstream service owns provider API querying, data normalization, aggregation, pricing, currency conversion, permissions, export, and sync state.
- The client only sends query filters such as `provider_key_id`, time range, granularity, model, and dimension.
- All displayed billing numbers must come from upstream response fields.

If the upstream cannot return a field, it must return `null` or `0` explicitly according to this contract. The client must not infer missing cost.

## 3. Key Flow

### 3.1 First-Use Upstream Key Setup

On first use, CentaurAI should guide the user to the relay platform in a browser. The user registers or signs in there, creates a user API key, then copies the relay `base_url` and API key into CentaurAI's existing model provider settings.

CentaurAI must store only:

- `base_url`: the relay platform API base URL.
- `api_key`: the user-created upstream API key.

CentaurAI must not store upstream account passwords, session cookies, or login tokens. The upstream browser login exists only so the user can manage their relay account, quota, recharge, and API keys on the relay platform.

### 3.2 Provider Key Registration

The raw provider API key is submitted only through the existing provider management flow, for example `POST /api/providers` or `PUT /api/providers/{id}`.

When a provider is created or updated, the backend must:

1. Validate the raw provider API key.
2. Store the raw provider API key in a secure server-side store.
3. Generate or map a stable, non-secret `provider_key_id`.
4. Return only safe provider metadata to the client.

The billing dashboard never receives or sends the raw provider API key.

Example:

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "provider_platform": "openai",
  "source_provider_id": "provider_openai_01",
  "masked_key": "sk-...ABCD"
}
```

`provider_key_id` is not the raw provider API key. It is an opaque backend identifier. It may map to an existing provider row id, but it must never be derived from the raw key in a reversible way.

### 3.3 How The Dashboard Gets `provider_key_id`

The dashboard obtains usable billing key identifiers from:

```http
GET /api/billing/provider-keys
```

The response returns provider keys visible to the supplied user-created upstream API key:

```json
{
  "items": [
    {
      "provider_key_id": "pk_openai_prod_01",
      "provider_platform": "openai",
      "display_name": "OpenAI Production",
      "masked_key": "sk-...ABCD",
      "source_provider_id": "provider_openai_01"
    }
  ]
}
```

After that, all billing queries pass `provider_key_id` only in the request body. Billing APIs must reject or ignore raw provider key fields such as `api_key`, `raw_key`, `provider_api_key`, `access_token`, `secret_key`, and `upstream_token` in the request body.

### 3.4 How Upstream Uses The Key

For every billing query, the backend resolves `provider_key_id` to the stored provider credentials, then calls the provider usage/billing API using the real key on the server side.

The client must not call provider billing APIs directly. The client must not receive raw provider API keys in response bodies, response metadata, headers, logs, exports, or errors.

## 4. Base URL And Authentication

Base path:

```text
/api/billing
```

CentaurAI is a client application configured with an upstream `base_url` and a user-created upstream API key. Billing endpoints authenticate with that key. CentaurAI must not require or store an upstream account password and must not depend on an upstream browser login cookie.

Recommended headers:

```http
Authorization: Bearer <user-created upstream API key>
Content-Type: application/json
Accept: application/json
Accept-Language: zh-CN
X-Request-ID: <client generated request id>
```

`provider_key_id` is a selector, not an authentication credential. Billing requests must not place the raw provider API key in the request body or headers.

For sync or export creation endpoints, the client may send:

```http
Idempotency-Key: <uuid>
```

The upstream should echo `request_id` in every response.

## 5. Common Response Envelope

Success:

```ts
type ApiSuccess<T> = {
  code: 0;
  message: 'ok';
  request_id: string;
  data: T;
};
```

Error:

```ts
type ApiError = {
  code: string;
  message: string;
  request_id: string;
  details?: Record<string, unknown>;
};
```

Example error:

```json
{
  "code": "TIME_RANGE_TOO_LARGE",
  "message": "The requested time range exceeds the maximum allowed range for hour granularity.",
  "request_id": "req_01JZ0000000000000000000000",
  "details": {
    "max_days": 31,
    "granularity": "hour"
  }
}
```

## 6. Common Conventions

### 6.1 Time

- All request and response timestamps use Unix epoch milliseconds.
- `start_ms` is inclusive.
- `end_ms` is exclusive.
- Default timezone is `Asia/Shanghai`.
- Bucket fields such as `bucket_start_ms` and `bucket_end_ms` must align to the requested timezone.

Example day bucket in `Asia/Shanghai`:

```json
{
  "bucket_start_ms": 1782748800000,
  "bucket_end_ms": 1782835200000,
  "timezone": "Asia/Shanghai"
}
```

### 6.2 Currency

- Upstream must calculate cost.
- Upstream should return USD and CNY where available.
- Display currency defaults to `CNY`.
- `exchange_rate` means `1 USD = exchange_rate CNY`.
- If a provider only exposes cost in another currency, upstream must normalize it and indicate the original currency in metadata.

### 6.3 Precision

- Token counts are integers.
- Cost fields are decimal numbers.
- Upstream should retain at least 8 decimal places internally.
- The client may format cost for display but must not recalculate it.

### 6.4 Pagination

Paginated endpoints use cursor pagination:

```ts
type PageRequest = {
  cursor?: string;
  limit?: number;
};

type PageResponse<T> = {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
};
```

Default `limit`: `50`

Maximum `limit`: `500`

### 6.5 Freshness

Every data response must include freshness metadata:

```ts
type BillingFreshness = {
  last_synced_at_ms: number | null;
  next_sync_available_at_ms: number | null;
  is_syncing: boolean;
  data_delay_seconds: number | null;
  source: 'provider_usage_api' | 'upstream_gateway' | 'upstream_cache' | 'mixed';
};
```

The dashboard can show "syncing" or "last updated" based on these fields.

## 7. Common Request Schema

Most query endpoints accept this base request:

```ts
type BillingQuery = {
  provider_key_id?: string;
  provider_key_ids?: string[];
  provider_platform?: 'openai' | 'anthropic' | 'gemini' | 'azure_openai' | string;
  start_ms: number;
  end_ms: number;
  timezone?: string;
  granularity?: 'hour' | 'day' | 'month';
  model?: string;
  models?: string[];
  user_id?: string;
  user_ids?: string[];
  cursor?: string;
  limit?: number;
};
```

Rules:

- `start_ms` and `end_ms` are required for summary, timeseries, breakdown, events, and export.
- Either `provider_key_id`, `provider_key_ids`, or an authorized "all visible keys" default may be used.
- If both `provider_key_id` and `provider_key_ids` are supplied, upstream should reject the request with `INVALID_ARGUMENT`.
- Normal users can only query keys they are allowed to see.
- Team admins may query all team-visible keys.
- Decision edition owner is treated as the admin of the single-user workspace.

## 8. Data Models

### 8.1 Provider Key

```ts
type BillingProviderKey = {
  provider_key_id: string;
  provider_platform: 'openai' | 'anthropic' | 'gemini' | 'azure_openai' | string;
  display_name: string;
  masked_key?: string;
  source_provider_id?: string;
  source_provider_name?: string;
  key_alias?: string;
  key_fingerprint?: string;
  key_last4?: string;
  owner_user_id?: string;
  owner_user_name?: string;
  workspace_id?: string;
  status: 'active' | 'disabled' | 'expired' | 'invalid' | 'unknown';
  billing_supported: boolean;
  realtime_supported: boolean;
  sync_supported: boolean;
  supported_granularities: Array<'hour' | 'day' | 'month'>;
  earliest_available_start_ms: number | null;
  latest_available_end_ms: number | null;
  last_synced_at_ms: number | null;
  metadata?: Record<string, unknown>;
};
```

### 8.2 Billing Summary

```ts
type BillingSummary = {
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
  cost_usd: number;
  cost_cny: number;
  currency: 'CNY';
  exchange_rate: number | null;
  average_cost_usd_per_1m_tokens: number | null;
  average_cost_cny_per_1m_tokens: number | null;
};
```

### 8.3 Timeseries Point

```ts
type BillingTimeseriesPoint = BillingSummary & {
  bucket_start_ms: number;
  bucket_end_ms: number;
  timezone: string;
};
```

### 8.4 Breakdown Row

```ts
type BillingBreakdownDimension = 'model' | 'provider_key' | 'provider_platform' | 'user' | 'day' | 'hour';

type BillingBreakdownRow = BillingSummary & {
  dimension: BillingBreakdownDimension;
  key: string;
  label: string;
  percentage_of_total_cost: number;
  percentage_of_total_tokens: number;
  metadata?: Record<string, unknown>;
};
```

### 8.5 Billing Event

The event endpoint returns upstream/provider usage records. These are not client-generated local ledger rows.

```ts
type BillingEvent = {
  id: string;
  provider_event_id?: string;
  provider_key_id: string;
  provider_platform: string;
  provider_name?: string;
  model: string;
  user_id?: string;
  user_name?: string;
  request_id?: string;
  upstream_project_id?: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
  cost_usd: number;
  cost_cny: number;
  currency: 'CNY';
  exchange_rate: number | null;
  status: 'completed' | 'failed' | 'cancelled' | 'unknown';
  occurred_at_ms: number;
  created_at_ms?: number;
  metadata?: Record<string, unknown>;
};
```

### 8.6 Sync Job

```ts
type BillingSyncJob = {
  sync_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  provider_key_id?: string;
  provider_platform?: string;
  start_ms: number;
  end_ms: number;
  progress: {
    current: number;
    total: number;
  } | null;
  started_at_ms: number | null;
  finished_at_ms: number | null;
  error_code?: string;
  error_message?: string;
};
```

## 9. Endpoint Summary

| Method | Path                              | Required    | Purpose                                              |
| ------ | --------------------------------- | ----------- | ---------------------------------------------------- |
| `GET`  | `/api/billing/capabilities`       | Yes         | Return billing feature support and limits.           |
| `GET`  | `/api/billing/provider-keys`      | Yes         | Return provider keys visible to the current user.    |
| `POST` | `/api/billing/summary`            | Yes         | Return total usage and cost for a time range.        |
| `POST` | `/api/billing/timeseries`         | Yes         | Return hourly/daily/monthly dashboard series.        |
| `POST` | `/api/billing/breakdown`          | Yes         | Return grouped usage and cost, for example by model. |
| `POST` | `/api/billing/events`             | Yes         | Return paginated usage details.                      |
| `POST` | `/api/billing/sync`               | Recommended | Trigger upstream provider usage sync.                |
| `GET`  | `/api/billing/sync/{sync_id}`     | Recommended | Poll sync job status.                                |
| `POST` | `/api/billing/export`             | Recommended | Create CSV/XLSX export.                              |
| `GET`  | `/api/billing/export/{export_id}` | Recommended | Download or poll export result.                      |

## 10. APIs

### 10.1 Get Capabilities

```http
GET /api/billing/capabilities
```

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_cap_001",
  "data": {
    "supported_platforms": ["openai", "anthropic", "gemini", "azure_openai"],
    "supported_granularities": ["hour", "day", "month"],
    "default_timezone": "Asia/Shanghai",
    "default_currency": "CNY",
    "max_ranges": {
      "hour": { "days": 31 },
      "day": { "days": 366 },
      "month": { "months": 36 }
    },
    "features": {
      "sync": true,
      "events": true,
      "export_csv": true,
      "export_xlsx": false,
      "multi_key_query": true
    }
  }
}
```

### 10.2 List Provider Keys

```http
GET /api/billing/provider-keys?scope=mine&provider_platform=openai
```

Query parameters:

| Name                | Type            | Required | Notes                                                |
| ------------------- | --------------- | -------- | ---------------------------------------------------- |
| `scope`             | `mine` or `all` | No       | Defaults to `mine`. `all` requires admin permission. |
| `provider_platform` | string          | No       | Filter by platform.                                  |

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_keys_001",
  "data": {
    "items": [
      {
        "provider_key_id": "pk_openai_prod_01",
        "provider_platform": "openai",
        "display_name": "OpenAI Production",
        "masked_key": "sk-...ABCD",
        "source_provider_id": "provider_openai_01",
        "source_provider_name": "OpenAI Production",
        "key_alias": "prod",
        "key_fingerprint": "sha256:8b4f...c91a",
        "key_last4": "ABCD",
        "owner_user_id": "user_001",
        "owner_user_name": "Alice",
        "workspace_id": "workspace_001",
        "status": "active",
        "billing_supported": true,
        "realtime_supported": false,
        "sync_supported": true,
        "supported_granularities": ["hour", "day", "month"],
        "earliest_available_start_ms": 1780243200000,
        "latest_available_end_ms": 1782835200000,
        "last_synced_at_ms": 1782831600000
      }
    ]
  }
}
```

Implementation notes:

- Do not return raw API keys.
- Do not place raw API keys in `metadata`, errors, export files, or logs.
- `provider_key_id` must be generated or mapped by the backend when a provider key is saved.
- The raw key is accepted only by provider management create/update APIs, not by `/api/billing/*`.
- Billing query endpoints must resolve `provider_key_id` to the stored key server-side before calling provider usage APIs.
- Return disabled or invalid keys only if the user has permission to see them.
- `billing_supported = false` means the UI should show the key but disable billing queries for it.

### 10.3 Get Summary

```http
POST /api/billing/summary
```

Request:

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "provider_platform": "openai",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "timezone": "Asia/Shanghai"
}
```

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_summary_001",
  "data": {
    "query": {
      "provider_key_id": "pk_openai_prod_01",
      "provider_platform": "openai",
      "start_ms": 1782748800000,
      "end_ms": 1782835200000,
      "timezone": "Asia/Shanghai"
    },
    "summary": {
      "request_count": 1280,
      "input_tokens": 4100000,
      "output_tokens": 760000,
      "total_tokens": 4860000,
      "cached_input_tokens": 280000,
      "reasoning_tokens": 120000,
      "cost_usd": 18.2745,
      "cost_cny": 133.404,
      "currency": "CNY",
      "exchange_rate": 7.3,
      "average_cost_usd_per_1m_tokens": 3.76018518,
      "average_cost_cny_per_1m_tokens": 27.44938272
    },
    "freshness": {
      "last_synced_at_ms": 1782831600000,
      "next_sync_available_at_ms": 1782831900000,
      "is_syncing": false,
      "data_delay_seconds": 1800,
      "source": "provider_usage_api"
    }
  }
}
```

Implementation notes:

- `summary.cost_usd` and `summary.cost_cny` are authoritative.
- If provider returns only estimated cost, upstream should include `metadata.cost_type = "estimated"`.
- If no data exists, return zero values, not an error.

### 10.4 Get Timeseries

```http
POST /api/billing/timeseries
```

Request:

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "timezone": "Asia/Shanghai",
  "granularity": "hour"
}
```

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_ts_001",
  "data": {
    "items": [
      {
        "bucket_start_ms": 1782748800000,
        "bucket_end_ms": 1782752400000,
        "timezone": "Asia/Shanghai",
        "request_count": 42,
        "input_tokens": 120000,
        "output_tokens": 21000,
        "total_tokens": 141000,
        "cached_input_tokens": 8000,
        "reasoning_tokens": 3000,
        "cost_usd": 0.52,
        "cost_cny": 3.796,
        "currency": "CNY",
        "exchange_rate": 7.3,
        "average_cost_usd_per_1m_tokens": 3.68794326,
        "average_cost_cny_per_1m_tokens": 26.92208511
      }
    ],
    "freshness": {
      "last_synced_at_ms": 1782831600000,
      "next_sync_available_at_ms": 1782831900000,
      "is_syncing": false,
      "data_delay_seconds": 1800,
      "source": "provider_usage_api"
    }
  }
}
```

Implementation notes:

- Return empty buckets with zero values if the client requests a continuous chart.
- If the upstream chooses sparse buckets, document it through `capabilities`.
- `granularity = hour` should be limited to a reasonable range, for example 31 days.

### 10.5 Get Breakdown

```http
POST /api/billing/breakdown
```

Request:

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "timezone": "Asia/Shanghai",
  "dimension": "model",
  "limit": 20
}
```

Request schema:

```ts
type BillingBreakdownRequest = BillingQuery & {
  dimension: 'model' | 'provider_key' | 'provider_platform' | 'user' | 'day' | 'hour';
};
```

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_breakdown_001",
  "data": {
    "items": [
      {
        "dimension": "model",
        "key": "gpt-4.1",
        "label": "gpt-4.1",
        "request_count": 620,
        "input_tokens": 2100000,
        "output_tokens": 360000,
        "total_tokens": 2460000,
        "cached_input_tokens": 140000,
        "reasoning_tokens": 90000,
        "cost_usd": 10.42,
        "cost_cny": 76.066,
        "currency": "CNY",
        "exchange_rate": 7.3,
        "average_cost_usd_per_1m_tokens": 4.23577236,
        "average_cost_cny_per_1m_tokens": 30.92113821,
        "percentage_of_total_cost": 57.04,
        "percentage_of_total_tokens": 50.62
      }
    ],
    "next_cursor": null,
    "has_more": false,
    "freshness": {
      "last_synced_at_ms": 1782831600000,
      "next_sync_available_at_ms": 1782831900000,
      "is_syncing": false,
      "data_delay_seconds": 1800,
      "source": "provider_usage_api"
    }
  }
}
```

Implementation notes:

- The dashboard needs `dimension = model` for "each model usage".
- Team edition can use `dimension = user` for admin views if upstream has user mapping.
- If the provider does not expose user-level usage, return `UNSUPPORTED_DIMENSION` for `user`.

### 10.6 Get Events

```http
POST /api/billing/events
```

Request:

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "timezone": "Asia/Shanghai",
  "model": "gpt-4.1",
  "limit": 50
}
```

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_events_001",
  "data": {
    "items": [
      {
        "id": "evt_01JZ0000000000000000000000",
        "provider_event_id": "openai_usage_abc",
        "provider_key_id": "pk_openai_prod_01",
        "provider_platform": "openai",
        "provider_name": "OpenAI",
        "model": "gpt-4.1",
        "user_id": "user_001",
        "user_name": "Alice",
        "request_id": "req_model_001",
        "upstream_project_id": "proj_001",
        "input_tokens": 3200,
        "output_tokens": 860,
        "total_tokens": 4060,
        "cached_input_tokens": 0,
        "reasoning_tokens": 200,
        "cost_usd": 0.0214,
        "cost_cny": 0.15622,
        "currency": "CNY",
        "exchange_rate": 7.3,
        "status": "completed",
        "occurred_at_ms": 1782828000000,
        "created_at_ms": 1782828060000,
        "metadata": {
          "source": "provider_usage_api"
        }
      }
    ],
    "next_cursor": "cursor_next_page",
    "has_more": true,
    "freshness": {
      "last_synced_at_ms": 1782831600000,
      "next_sync_available_at_ms": 1782831900000,
      "is_syncing": false,
      "data_delay_seconds": 1800,
      "source": "provider_usage_api"
    }
  }
}
```

Implementation notes:

- Events must be returned by upstream from provider usage APIs, upstream gateway logs, or upstream cache.
- The client must not create these events.
- If provider APIs only expose aggregate data and no event-level data, return `EVENTS_NOT_SUPPORTED`.

### 10.7 Trigger Sync

```http
POST /api/billing/sync
```

Request:

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "provider_platform": "openai",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "force": false
}
```

Request schema:

```ts
type BillingSyncRequest = {
  provider_key_id: string;
  provider_platform?: string;
  start_ms: number;
  end_ms: number;
  force?: boolean;
};
```

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_sync_001",
  "data": {
    "sync_id": "sync_01JZ0000000000000000000000",
    "status": "queued",
    "provider_key_id": "pk_openai_prod_01",
    "provider_platform": "openai",
    "start_ms": 1782748800000,
    "end_ms": 1782835200000,
    "progress": null,
    "started_at_ms": null,
    "finished_at_ms": null
  }
}
```

Implementation notes:

- This endpoint tells upstream to fetch or refresh usage from the provider.
- It should be idempotent when `Idempotency-Key` is provided.
- If another sync is running for the same key and range, return the existing sync job or `SYNC_IN_PROGRESS`.
- Sync should update upstream-side cache/storage only. It must not require client local storage.

### 10.8 Get Sync Status

```http
GET /api/billing/sync/{sync_id}
```

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_sync_status_001",
  "data": {
    "sync_id": "sync_01JZ0000000000000000000000",
    "status": "succeeded",
    "provider_key_id": "pk_openai_prod_01",
    "provider_platform": "openai",
    "start_ms": 1782748800000,
    "end_ms": 1782835200000,
    "progress": {
      "current": 100,
      "total": 100
    },
    "started_at_ms": 1782831700000,
    "finished_at_ms": 1782831760000
  }
}
```

### 10.9 Create Export

```http
POST /api/billing/export
```

Request:

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "timezone": "Asia/Shanghai",
  "format": "csv",
  "level": "events"
}
```

Request schema:

```ts
type BillingExportRequest = BillingQuery & {
  format: 'csv' | 'xlsx';
  level: 'summary' | 'timeseries' | 'breakdown' | 'events';
  dimension?: 'model' | 'provider_key' | 'provider_platform' | 'user' | 'day' | 'hour';
};
```

Response:

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_export_001",
  "data": {
    "export_id": "export_01JZ0000000000000000000000",
    "status": "ready",
    "download_url": "/api/billing/export/export_01JZ0000000000000000000000",
    "expires_at_ms": 1782918000000
  }
}
```

### 10.10 Download Export

```http
GET /api/billing/export/{export_id}
```

If the export is ready, return file content:

```http
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="centaurai-billing-2026-06-30.csv"
```

If the export is still running:

```json
{
  "code": "EXPORT_NOT_READY",
  "message": "The export is still being generated.",
  "request_id": "req_export_download_001",
  "details": {
    "export_id": "export_01JZ0000000000000000000000",
    "status": "running"
  }
}
```

## 11. Error Codes

| Code                      | HTTP | Meaning                                                                                                                                   |
| ------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`        | 400  | Request body or query parameter is invalid.                                                                                               |
| `INVALID_PROVIDER_KEY`    | 400  | The provider key id is invalid, disabled, expired, or cannot be used.                                                                     |
| `PROVIDER_NOT_SUPPORTED`  | 400  | Billing is not supported for this provider platform.                                                                                      |
| `UNSUPPORTED_GRANULARITY` | 400  | Requested granularity is not supported.                                                                                                   |
| `UNSUPPORTED_DIMENSION`   | 400  | Requested breakdown dimension is not supported.                                                                                           |
| `EVENTS_NOT_SUPPORTED`    | 400  | Event-level usage is unavailable for this provider.                                                                                       |
| `TIME_RANGE_TOO_LARGE`    | 400  | Requested time range exceeds upstream limits.                                                                                             |
| `UNAUTHENTICATED`         | 401  | The user-created upstream API key is missing or invalid; CentaurAI billing API access must not require an upstream browser login session. |
| `PERMISSION_DENIED`       | 403  | User cannot access this provider key or scope.                                                                                            |
| `NOT_FOUND`               | 404  | Sync job, export, or provider key was not found.                                                                                          |
| `SYNC_IN_PROGRESS`        | 409  | A sync job is already running for the same key/range.                                                                                     |
| `UPSTREAM_RATE_LIMITED`   | 429  | Provider or upstream rate limit was hit.                                                                                                  |
| `UPSTREAM_UNAVAILABLE`    | 503  | Provider usage API or upstream billing dependency is unavailable.                                                                         |
| `EXPORT_NOT_READY`        | 409  | Export exists but is not ready for download.                                                                                              |
| `UNKNOWN_ERROR`           | 500  | Unexpected upstream error.                                                                                                                |

## 12. Permission Requirements

Team edition:

- Normal users can query their own visible provider keys.
- Admins can query all workspace provider keys.
- `scope=all`, `user_id`, and `user_ids` require admin permission.
- Export must follow the same permission scope as the query.

Decision edition:

- The owner can query all keys in the local decision workspace.
- If multi-user access is enabled later, use the same permission model as team edition.

## 13. Provider Implementation Guidance

Upstream may combine different sources:

- Provider usage APIs.
- Provider invoice/cost APIs.
- Upstream gateway logs.
- Upstream cached normalized usage.

Upstream must normalize these into the response schemas above.

For provider-backed data, upstream must first authenticate the CentaurAI request using the user-created upstream API key. Then it must resolve `provider_key_id` to the stored provider API key on the server side and call the provider usage or billing API with that provider key.

If provider data is delayed, upstream should still return the latest available data and set:

```json
{
  "data_delay_seconds": 3600,
  "source": "provider_usage_api"
}
```

If a provider cannot return cost, upstream should calculate cost server-side using its own price table and return:

```json
{
  "metadata": {
    "cost_type": "upstream_calculated"
  }
}
```

The client must not own that price table.

## 14. Dashboard Mapping

The CentaurAI dashboard should call endpoints as follows:

| UI Area                 | Endpoint                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Provider key selector   | `GET /api/billing/provider-keys`                                                     |
| Total cost KPI          | `POST /api/billing/summary`                                                          |
| Current token usage KPI | `POST /api/billing/summary`                                                          |
| Hour/day/month chart    | `POST /api/billing/timeseries`                                                       |
| Usage by model          | `POST /api/billing/breakdown` with `dimension = model`                               |
| Usage by key/provider   | `POST /api/billing/breakdown` with `dimension = provider_key` or `provider_platform` |
| Usage by user           | `POST /api/billing/breakdown` with `dimension = user`                                |
| Detail table            | `POST /api/billing/events`                                                           |
| Manual refresh          | `POST /api/billing/sync` then `GET /api/billing/sync/{sync_id}`                      |
| Export                  | `POST /api/billing/export` then `GET /api/billing/export/{export_id}`                |

## 15. Acceptance Criteria For Upstream

The upstream implementation is considered ready when:

- `GET /api/billing/provider-keys` returns safe key identifiers without secrets.
- Provider keys are created or updated through provider management APIs, and billing APIs only receive `provider_key_id`.
- `POST /api/billing/summary` returns token and cost totals for a selected key and time range.
- `POST /api/billing/timeseries` returns hourly and daily buckets.
- `POST /api/billing/breakdown` returns at least `dimension = model`.
- `POST /api/billing/events` returns usage details or a clear `EVENTS_NOT_SUPPORTED` error.
- Costs are calculated upstream and include `cost_usd`, `cost_cny`, `currency`, and `exchange_rate`.
- Raw provider API keys are never returned by billing APIs and are never required in billing request bodies.
- Permission checks prevent users from querying unauthorized keys.
- Responses include freshness metadata.
- The API returns stable error codes from this document.
- Raw provider API keys are never returned to the client.

## 16. Example Client Sequence

1. Client loads available keys:

```http
GET /api/billing/provider-keys?scope=mine
```

2. User selects `pk_openai_prod_01`.

3. Client requests dashboard summary:

```http
POST /api/billing/summary
```

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "timezone": "Asia/Shanghai"
}
```

4. Client requests model breakdown:

```http
POST /api/billing/breakdown
```

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "timezone": "Asia/Shanghai",
  "dimension": "model"
}
```

5. If `freshness.is_syncing = false` and the user clicks refresh, client triggers sync:

```http
POST /api/billing/sync
```

```json
{
  "provider_key_id": "pk_openai_prod_01",
  "start_ms": 1782748800000,
  "end_ms": 1782835200000,
  "force": false
}
```

6. Client polls sync status, then reloads summary/timeseries/breakdown/events.

## 17. Notes For Replacing The Local Billing Prototype

The previous prototype created local billing tables and calculated price in the desktop process. That direction is no longer the target.

The correct target is:

- Keep the billing dashboard UI.
- Replace local billing repository/recorder calls with HTTP calls to this upstream contract.
- Remove local billing event generation from model response handlers.
- Remove local price settings as a billing source of truth.
- Treat provider key ids and upstream responses as the only billing data source.
- Do not add a billing-specific raw key input. Raw keys belong to provider management; billing only consumes `provider_key_id`.
