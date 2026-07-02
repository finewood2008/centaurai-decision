import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('billing upstream bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('routes dashboard queries to upstream /api/billing endpoints', async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('http://127.0.0.1:8088', '');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer upstream-access-key' });
      const json = (data: unknown) =>
        new Response(JSON.stringify({ code: 0, message: 'ok', request_id: 'req_test', data }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      if (path === '/api/billing/provider-keys') {
        expect(init?.method).toBe('GET');
        return json({
          items: [
            {
              provider_key_id: 'pk_openai_prod_01',
              provider_platform: 'openai',
              display_name: 'OpenAI Production',
              masked_key: 'sk-...ABCD',
              source_provider_id: 'provider_openai_01',
              source_provider_name: 'OpenAI Production',
              api_key: 'sk-raw-secret-must-not-reach-renderer',
              metadata: {
                api_key: 'sk-nested-secret-must-not-reach-renderer',
                region: 'global',
              },
              status: 'active',
              billing_supported: true,
              realtime_supported: false,
              sync_supported: true,
              supported_granularities: ['hour', 'day'],
              earliest_available_start_ms: null,
              latest_available_end_ms: null,
              last_synced_at_ms: null,
            },
          ],
        });
      }

      if (path === '/api/billing/summary') {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe('{"provider_key_id":"pk_openai_prod_01","start_ms":1,"end_ms":2}');
        return json({
          query: { provider_key_id: 'pk_openai_prod_01', start_ms: 1, end_ms: 2 },
          summary: {
            request_count: 3,
            input_tokens: 10,
            output_tokens: 20,
            total_tokens: 30,
            cost_usd: 1.23,
            cost_cny: 8.98,
            currency: 'CNY',
            exchange_rate: 7.3,
            average_cost_usd_per_1m_tokens: 41000,
            average_cost_cny_per_1m_tokens: 299300,
          },
          freshness: {
            last_synced_at_ms: 2,
            next_sync_available_at_ms: null,
            is_syncing: false,
            data_delay_seconds: 0,
            source: 'provider_usage_api',
          },
        });
      }

      if (path === '/api/billing/timeseries') {
        return json({
          items: [
            {
              bucket_start_ms: 1,
              bucket_end_ms: 2,
              timezone: 'Asia/Shanghai',
              request_count: 1,
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              cost_usd: 0.1,
              cost_cny: 0.73,
              currency: 'CNY',
              exchange_rate: 7.3,
              average_cost_usd_per_1m_tokens: 6666.67,
              average_cost_cny_per_1m_tokens: 48666.67,
            },
          ],
          freshness: {
            last_synced_at_ms: 2,
            next_sync_available_at_ms: null,
            is_syncing: false,
            data_delay_seconds: 0,
            source: 'provider_usage_api',
          },
        });
      }

      if (path === '/api/billing/breakdown') {
        expect(init?.body).toBe('{"provider_key_id":"pk_openai_prod_01","start_ms":1,"end_ms":2,"dimension":"model"}');
        return json({
          items: [
            {
              dimension: 'model',
              key: 'gpt-4.1',
              label: 'gpt-4.1',
              request_count: 1,
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              cost_usd: 0.1,
              cost_cny: 0.73,
              currency: 'CNY',
              exchange_rate: 7.3,
              average_cost_usd_per_1m_tokens: 6666.67,
              average_cost_cny_per_1m_tokens: 48666.67,
              percentage_of_total_cost: 100,
              percentage_of_total_tokens: 100,
            },
          ],
          next_cursor: null,
          has_more: false,
          freshness: {
            last_synced_at_ms: 2,
            next_sync_available_at_ms: null,
            is_syncing: false,
            data_delay_seconds: 0,
            source: 'provider_usage_api',
          },
        });
      }

      if (path === '/api/billing/events') {
        return json({
          items: [
            {
              id: 'evt_1',
              provider_key_id: 'pk_openai_prod_01',
              provider_platform: 'openai',
              model: 'gpt-4.1',
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              cost_usd: 0.1,
              cost_cny: 0.73,
              currency: 'CNY',
              exchange_rate: 7.3,
              status: 'completed',
              occurred_at_ms: 1,
            },
          ],
          next_cursor: null,
          has_more: false,
          freshness: {
            last_synced_at_ms: 2,
            next_sync_available_at_ms: null,
            is_syncing: false,
            data_delay_seconds: 0,
            source: 'provider_usage_api',
          },
        });
      }

      throw new Error(`unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { billing } = await import('@/common/adapter/ipcBridge');
    const upstream = { base_url: 'http://127.0.0.1:8088/', api_key: 'upstream-access-key' };
    const query = { upstream, provider_key_id: 'pk_openai_prod_01', start_ms: 1, end_ms: 2 };

    const providerKeys = await billing.providerKeys.invoke({ upstream });
    expect(providerKeys).toHaveLength(1);
    expect(providerKeys[0]).toMatchObject({
      provider_key_id: 'pk_openai_prod_01',
      masked_key: 'sk-...ABCD',
      source_provider_id: 'provider_openai_01',
      source_provider_name: 'OpenAI Production',
      metadata: { region: 'global' },
    });
    expect('api_key' in (providerKeys[0] as Record<string, unknown>)).toBe(false);
    await expect(billing.summary.invoke(query)).resolves.toMatchObject({ cost_cny: 8.98 });
    await expect(billing.timeseries.invoke(query)).resolves.toHaveLength(1);
    await expect(billing.breakdown.invoke({ ...query, dimension: 'model' })).resolves.toHaveLength(1);
    await expect(billing.events.invoke(query)).resolves.toMatchObject([{ id: 'evt_1' }]);

    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('strips raw provider secrets from billing request bodies', async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:8088/api/billing/summary');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer upstream-access-key' });
      expect(init?.body).toBe(
        '{"provider_key_id":"pk_openai_prod_01","start_ms":1,"end_ms":2,"metadata":{"region":"global"}}'
      );
      return new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          request_id: 'req_test',
          data: {
            query: { provider_key_id: 'pk_openai_prod_01', start_ms: 1, end_ms: 2 },
            summary: {
              request_count: 0,
              input_tokens: 0,
              output_tokens: 0,
              total_tokens: 0,
              cost_usd: 0,
              cost_cny: 0,
              currency: 'CNY',
              exchange_rate: 7.3,
              average_cost_usd_per_1m_tokens: null,
              average_cost_cny_per_1m_tokens: null,
            },
            freshness: {
              last_synced_at_ms: null,
              next_sync_available_at_ms: null,
              is_syncing: false,
              data_delay_seconds: null,
              source: 'provider_usage_api',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { billing } = await import('@/common/adapter/ipcBridge');
    await billing.summary.invoke({
      upstream: { base_url: 'http://127.0.0.1:8088/', api_key: 'upstream-access-key' },
      provider_key_id: 'pk_openai_prod_01',
      start_ms: 1,
      end_ms: 2,
      api_key: 'sk-raw-secret',
      raw_key: 'sk-raw-secret',
      provider_api_key: 'sk-raw-secret',
      authorization: 'Bearer secret',
      metadata: {
        api_key: 'sk-nested-secret',
        region: 'global',
      },
    } as never);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects billing requests without configured upstream access', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { billing } = await import('@/common/adapter/ipcBridge');

    await expect(
      billing.summary.invoke({
        upstream: { base_url: '', api_key: '' },
        provider_key_id: 'pk_openai_prod_01',
        start_ms: 1,
        end_ms: 2,
      })
    ).rejects.toThrow('Billing upstream base_url and api_key are required');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not expose local billing recorder or pricing settings APIs', async () => {
    const { billing } = await import('@/common/adapter/ipcBridge');

    expect('recordUsage' in billing).toBe(false);
    expect('prices' in billing).toBe(false);
    expect('savePrice' in billing).toBe(false);
    expect('settings' in billing).toBe(false);
    expect('saveSettings' in billing).toBe(false);
  });
});
