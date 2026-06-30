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
  occurred_at: number;
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
