# Billing Dashboard Design

## Goal

Add a billing management feature to both CentaurAI editions so users can see near-real-time token usage, model usage, costs, and total cost dashboards by hour and day.

The feature must ship in both `centaurai-team` and `centaurai-decision` without creating edition-specific source forks. The implementation should be shared, with only permissions and small copy differences adapting the experience.

## Scope

First release includes:

- Accurate usage accounting for direct text model calls that expose reliable usage metadata:
  - Aionrs / OpenAI-compatible providers
  - Gemini direct providers
  - Anthropic direct providers
- Immutable billing event ledger with price snapshots.
- Hour/day/month aggregate data.
- A first-level `费用看板` route in desktop, WebUI, and LAN client.
- Admin global view and normal-user personal view.
- Model/provider/source/user breakdowns.
- CSV export for the current filter range.
- Built-in default model prices, admin global overrides, user private-provider overrides.
- CNY display by default, using USD model prices and a fixed configured exchange rate.
- Detail retention for 365 days; aggregate retention forever.

First release does not include:

- Accurate accounting for external CLI agents such as Claude Code, Codex CLI, Gemini CLI, Qwen CLI. The schema and UI should leave room for these later.
- Image generation, video, speech-to-text, or other non-text model billing. The schema should allow a future `unit` or `request` based pricing mode, but v1 focuses on text token pricing.
- Budget limits, threshold alerts, or quota enforcement.
- Online price-table updates. The design reserves the API boundary, but v1 ships built-in defaults plus manual overrides.

## Product Behavior

### Team Edition

`centaurai-team` exposes billing as a first-level sidebar entry named `费用看板`.

Admins can:

- View all company usage and cost.
- Filter by user, model, provider, source type, and time range.
- Maintain global prices and exchange rate.
- Export global CSV data for the selected filters.

Normal users can:

- View only their own usage and cost.
- Filter by their own model, provider, source type, and time range.
- Maintain price overrides for their own private providers.
- Export only their own CSV data.

### Decision Edition

`centaurai-decision` uses the same shared billing module. Since the decision edition is single-user by default, the owner sees the full dashboard. Copy can be adjusted toward decision-cost language, such as `决策成本`, but the route and data model remain shared.

Decision edition still supports WebUI/LAN/Tailscale access according to current code behavior, so the dashboard must work in desktop, WebUI, and native LAN client.

## Architecture

Use a shared billing module with four layers:

1. Capture: model responses report standardized usage when a request finishes.
2. Ledger: each usage record is written once to an immutable event table with a price snapshot.
3. Aggregation: hour/day/month aggregate rows are upserted after each ledger write.
4. Dashboard/API: UI queries summary, time series, breakdown, event details, prices, and CSV export through `/api/billing/*`.

The model response UI may still show `last_token_usage`, but that lightweight conversation metadata is not the source of truth for billing. The billing ledger is the source of truth.

## Data Model

### `billing_usage_events`

Immutable billing event ledger.

Recommended columns:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL`
- `conversation_id TEXT`
- `message_id TEXT`
- `request_id TEXT`
- `source_type TEXT NOT NULL`
- `provider_id TEXT`
- `provider_platform TEXT`
- `provider_name TEXT`
- `model TEXT NOT NULL`
- `input_tokens INTEGER NOT NULL DEFAULT 0`
- `output_tokens INTEGER NOT NULL DEFAULT 0`
- `total_tokens INTEGER NOT NULL DEFAULT 0`
- `currency TEXT NOT NULL DEFAULT 'CNY'`
- `exchange_rate REAL NOT NULL`
- `input_unit_price_usd REAL`
- `output_unit_price_usd REAL`
- `cost_usd REAL NOT NULL DEFAULT 0`
- `cost_cny REAL NOT NULL DEFAULT 0`
- `pricing_status TEXT NOT NULL`
- `request_status TEXT NOT NULL`
- `metadata TEXT NOT NULL DEFAULT '{}'`
- `occurred_at INTEGER NOT NULL`
- `hour_bucket INTEGER NOT NULL`
- `day_bucket INTEGER NOT NULL`
- `month_bucket INTEGER NOT NULL`
- `created_at INTEGER NOT NULL`

Recommended indexes:

- `idx_billing_events_user_time(user_id, occurred_at DESC)`
- `idx_billing_events_time(occurred_at DESC)`
- `idx_billing_events_model_time(model, occurred_at DESC)`
- `idx_billing_events_provider_time(provider_id, occurred_at DESC)`
- `idx_billing_events_source_time(source_type, occurred_at DESC)`
- Unique dedupe index on `conversation_id, message_id, provider_id, model` where possible. If the source cannot provide a stable `message_id`, use `request_id`.

### `billing_model_prices`

Price configuration table.

Recommended columns:

- `id TEXT PRIMARY KEY`
- `scope_type TEXT NOT NULL`
- `scope_id TEXT`
- `provider_platform TEXT`
- `provider_id TEXT`
- `model TEXT NOT NULL`
- `input_unit_price_usd REAL NOT NULL`
- `output_unit_price_usd REAL NOT NULL`
- `currency TEXT NOT NULL DEFAULT 'USD'`
- `effective_from INTEGER`
- `effective_to INTEGER`
- `enabled INTEGER NOT NULL DEFAULT 1`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`

`scope_type` values:

- `builtin`: built-in default prices seeded by the app.
- `global`: admin-defined global override.
- `user_provider`: user-defined override for a private provider.

Price matching priority:

1. User private-provider override for the exact provider/model.
2. Admin global override for platform/model or provider/model.
3. Built-in default platform/model.
4. Missing price. Token usage is still recorded, cost is `0`, and `pricing_status = 'missing_price'`.

### `billing_usage_aggregates`

Permanent aggregate table.

Recommended columns:

- `id TEXT PRIMARY KEY`
- `granularity TEXT NOT NULL`
- `bucket_start INTEGER NOT NULL`
- `user_id TEXT`
- `provider_id TEXT`
- `provider_platform TEXT`
- `model TEXT`
- `source_type TEXT`
- `request_count INTEGER NOT NULL DEFAULT 0`
- `input_tokens INTEGER NOT NULL DEFAULT 0`
- `output_tokens INTEGER NOT NULL DEFAULT 0`
- `total_tokens INTEGER NOT NULL DEFAULT 0`
- `cost_usd REAL NOT NULL DEFAULT 0`
- `cost_cny REAL NOT NULL DEFAULT 0`
- `updated_at INTEGER NOT NULL`

Use rows with nullable dimensions for rollups where useful, or generate specific dashboard queries from the detailed aggregate dimensions. Keep the first implementation conservative and indexed rather than over-building a cube.

### `billing_settings`

Either a small billing settings table or existing config storage can hold:

- `display_currency = 'CNY'`
- `usd_to_cny_exchange_rate`
- `company_timezone = 'Asia/Shanghai'`
- `detail_retention_days = 365`

## Source Types

Use these source types in v1:

- `chat`: ordinary conversation.
- `decision_room`: 智囊团 / decision meeting.
- `office_assistant`: office assistant workflow.
- `advisor`: expert/advisor usage.
- `unknown`: fallback when the source cannot be inferred.

The team edition can keep the enum even though decision meetings are disabled there. The decision edition can use the same enum without source forks.

## Capture And Recording

V1 records billing after the model request finishes. It does not estimate usage during streaming.

Flow:

1. A model call finishes and provides usage metadata.
2. Usage is normalized to `{ input_tokens, output_tokens, total_tokens }`.
3. The recorder resolves:
   - current user
   - conversation
   - message/request identity
   - provider
   - model
   - source type
   - request status
4. The pricing resolver chooses the applicable price and exchange rate.
5. The recorder computes USD and CNY cost.
6. The recorder writes an immutable `billing_usage_events` row.
7. The recorder upserts hour/day/month aggregates.
8. The dashboard refreshes through SWR/revalidation or a WebSocket event.

Failure behavior:

- If no reliable usage metadata is returned, do not create a billing event.
- If usage metadata is returned for a failed or cancelled request, record it with `request_status = 'failed'` or `request_status = 'cancelled'`.
- If price is missing, record tokens with zero cost and `pricing_status = 'missing_price'`.
- Duplicate event attempts must be idempotent.

## Provider Coverage

V1 hard target:

- Aionrs / OpenAI-compatible response usage.
- Gemini usage metadata.
- Anthropic usage metadata.

Existing code has local token usage handling in:

- `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/useAionrsMessage.ts`
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpMessage.ts`
- `packages/desktop/src/common/api/ProtocolConverter.ts`

The final implementation should prefer recording at the narrowest reliable shared boundary. Do not scatter provider-specific billing calculations across UI components if a common response/converter layer can standardize usage first.

## API

Expose billing APIs under `/api/billing/*`.

Endpoints:

- `GET /api/billing/summary`
- `GET /api/billing/timeseries`
- `GET /api/billing/breakdown`
- `GET /api/billing/events`
- `GET /api/billing/prices`
- `PUT /api/billing/prices`
- `GET /api/billing/export.csv`

Common query filters:

- `start`
- `end`
- `granularity = hour | day | month`
- `user_id`
- `provider_id`
- `provider_platform`
- `model`
- `source_type`
- `request_status`
- `pricing_status`

Permission enforcement must happen in API/bridge code, not only in the UI:

- Admin users can query all users and global data.
- Normal users are forced to their own `user_id`.
- Normal users cannot update global prices or exchange rate.
- Normal users can update only their own private-provider price overrides.

## UI

Add a first-level sidebar entry: `费用看板`.

Dashboard tabs:

1. `总览`
2. `明细`
3. `价格设置`

### Overview

Top filters:

- Time range
- Granularity: hour/day/month
- Scope:
  - Admin: company/all users or specific user
  - Normal user: fixed to own usage
- Source type
- Provider
- Model

KPI cards:

- Total cost in CNY
- Total tokens
- Input tokens
- Output tokens
- Request count
- Average cost per 1K or 1M tokens

Charts:

- Main trend chart with toggle for cost/token/request count.
- Model cost ranking.
- User ranking for admins only.
- Source type distribution.

### Details

Event table:

- Time
- User
- Source
- Provider
- Model
- Input tokens
- Output tokens
- Total tokens
- Cost CNY
- Pricing status
- Request status

CSV export exports the current filter scope. Admin exports can include all users; normal user exports include only their own rows.

### Price Settings

Admin view:

- Exchange rate.
- Built-in default prices read-only.
- Global price overrides editable.
- Missing-price models detected from billing events.

Normal user view:

- Own private-provider price overrides.
- Built-in/global prices read-only for context.

Decision edition can reuse the same UI and adjust copy where appropriate.

## Retention

Retention policy:

- Keep event details for 365 days.
- Keep hour/day/month aggregates forever.

Implementation:

- Add a cleanup job that deletes `billing_usage_events` older than 365 days.
- Do not delete aggregate rows.
- The cleanup job should be safe to run repeatedly.

## Testing

Data tests:

- Schema migration creates billing tables and indexes.
- Price priority resolves user override, global override, built-in default, then missing price.
- Cost calculation handles input/output token prices and CNY conversion.
- Duplicate recording is idempotent.
- Aggregate upsert increments request count, tokens, and costs.
- Retention deletes old detail rows while preserving aggregate rows.

API tests:

- Admin summary includes all users.
- Normal user summary is scoped to own rows even if `user_id` query asks for another user.
- Breakdown by model, user, provider, and source returns expected totals.
- CSV export respects filters and permissions.
- Price update rejects unauthorized global writes.

Capture tests:

- Aionrs/OpenAI-compatible usage records input/output tokens.
- Gemini usage records input/output tokens.
- Anthropic usage records input/output tokens.
- Missing usage does not record a billing event.
- Missing price records token usage with zero cost and `missing_price`.

UI tests:

- Sidebar shows `费用看板` in both editions.
- Admin sees global/user filters and user ranking.
- Normal user does not see global user filters or other-user rows.
- Dashboard renders KPI, trend, rankings, detail table, and CSV action.
- Price settings show admin and normal-user capabilities correctly.

Edition tests:

- Team edition exposes billing dashboard in desktop, WebUI, and LAN client.
- Decision edition exposes billing dashboard and can use decision-oriented copy.
- No billing source fork is introduced between the two repositories.

## Rollout Plan

1. Implement the full feature in `centaurai-team`.
2. Verify unit, integration, and relevant UI tests.
3. Apply the same patch to `centaurai-decision`.
4. Verify both repositories.
5. If the upstream core `centaurai-station` is available, prefer landing the shared implementation there and syncing both downstream repos afterward.

The code should stay shared. Edition differences should be limited to existing feature flags, permissions, and display copy.

## Open Decisions Closed During Brainstorming

- First release scope: internal direct model calls only; CLI agents are future.
- Price strategy: built-in defaults + manual overrides; online updates reserved.
- Permissions: admins see global data; normal users see own data.
- Display dimensions: model, user, source, conversation context, hour/day trends.
- Realtime definition: record and refresh after each response finishes.
- Currency: default CNY display, USD price table with fixed exchange rate.
- UI entry: first-level sidebar dashboard.
- Retention: event details 365 days, aggregates forever.
- Accurate provider scope: Aionrs/OpenAI-compatible/Gemini/Anthropic.
- Client scope: desktop, WebUI, and LAN client.
- Cost ownership: requesting user/conversation owner.
- Price ownership: admin global defaults, user private-provider overrides.
- Export: CSV for current filter range.
- Timezone: server/company timezone, default Asia/Shanghai.
