export type BillingGranularity = 'hour' | 'day' | 'month';
export type BillingProviderPlatform = 'openai' | 'anthropic' | 'gemini' | 'azure_openai' | string;
export type BillingFreshnessSource = 'provider_usage_api' | 'upstream_gateway' | 'upstream_cache' | 'mixed';
export type BillingEventStatus = 'completed' | 'failed' | 'cancelled' | 'unknown';

export type BillingUpstreamAuth = {
  base_url: string;
  api_key: string;
};

export type BillingProviderKey = {
  provider_key_id: string;
  provider_platform: BillingProviderPlatform;
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
  supported_granularities: BillingGranularity[];
  earliest_available_start_ms: number | null;
  latest_available_end_ms: number | null;
  last_synced_at_ms: number | null;
  metadata?: Record<string, unknown>;
};

export type BillingFreshness = {
  last_synced_at_ms: number | null;
  next_sync_available_at_ms: number | null;
  is_syncing: boolean;
  data_delay_seconds: number | null;
  source: BillingFreshnessSource;
};

export type BillingQuery = {
  upstream: BillingUpstreamAuth;
  provider_key_id?: string;
  provider_key_ids?: string[];
  provider_platform?: BillingProviderPlatform;
  start_ms: number;
  end_ms: number;
  timezone?: string;
  granularity?: BillingGranularity;
  model?: string;
  models?: string[];
  user_id?: string;
  user_ids?: string[];
  cursor?: string;
  limit?: number;
};

export type BillingProviderKeysRequest = {
  upstream: BillingUpstreamAuth;
  scope?: 'mine' | 'all';
  provider_platform?: BillingProviderPlatform;
};

export type BillingProviderKeysResponse = {
  items: BillingProviderKey[];
};

export type BillingSummary = {
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

export type BillingSummaryResponse = {
  query: BillingQuery;
  summary: BillingSummary;
  freshness: BillingFreshness;
};

export type BillingTimeseriesPoint = BillingSummary & {
  bucket_start_ms: number;
  bucket_end_ms: number;
  timezone: string;
};

export type BillingTimeseriesResponse = {
  items: BillingTimeseriesPoint[];
  freshness: BillingFreshness;
};

export type BillingBreakdownDimension = 'model' | 'provider_key' | 'provider_platform' | 'user' | 'day' | 'hour';

export type BillingBreakdownRequest = BillingQuery & {
  dimension: BillingBreakdownDimension;
};

export type BillingBreakdownRow = BillingSummary & {
  dimension: BillingBreakdownDimension;
  key: string;
  label: string;
  percentage_of_total_cost: number;
  percentage_of_total_tokens: number;
  metadata?: Record<string, unknown>;
};

export type BillingBreakdownResponse = {
  items: BillingBreakdownRow[];
  next_cursor: string | null;
  has_more: boolean;
  freshness: BillingFreshness;
};

export type BillingEvent = {
  id: string;
  provider_event_id?: string;
  provider_key_id: string;
  provider_platform: BillingProviderPlatform;
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
  status: BillingEventStatus;
  occurred_at_ms: number;
  created_at_ms?: number;
  metadata?: Record<string, unknown>;
};

export type BillingEventsResponse = {
  items: BillingEvent[];
  next_cursor: string | null;
  has_more: boolean;
  freshness: BillingFreshness;
};

export type BillingSyncRequest = {
  upstream: BillingUpstreamAuth;
  provider_key_id: string;
  provider_platform?: BillingProviderPlatform;
  start_ms: number;
  end_ms: number;
  force?: boolean;
};

export type BillingSyncJob = {
  sync_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  provider_key_id?: string;
  provider_platform?: BillingProviderPlatform;
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

export type BillingExportRequest = BillingQuery & {
  format: 'csv' | 'xlsx';
  level: 'summary' | 'timeseries' | 'breakdown' | 'events';
  dimension?: BillingBreakdownDimension;
};

export type BillingExportResponse = {
  export_id: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  download_url: string | null;
  expires_at_ms?: number;
};

export type BillingCapabilities = {
  supported_platforms: BillingProviderPlatform[];
  supported_granularities: BillingGranularity[];
  default_timezone: string;
  default_currency: 'CNY';
  max_ranges: Partial<Record<BillingGranularity, { days?: number; months?: number }>>;
  features: {
    sync: boolean;
    events: boolean;
    export_csv: boolean;
    export_xlsx: boolean;
    multi_key_query: boolean;
  };
};

export type BillingExportDownloadRequest = {
  upstream: BillingUpstreamAuth;
  export_id: string;
};

export type BillingLegacySummary = {
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  cost_cny: number;
  average_cost_cny_per_1m_tokens: number | null;
};
