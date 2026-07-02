import React, { useMemo, useState } from 'react';
import { DatePicker, Radio, Select, Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { BillingGranularity, BillingQuery } from '@/common/types/billing';
import BillingDetails from './components/BillingDetails';
import BillingOverview from './components/BillingOverview';
import BillingUpstreamSetupGuide from './components/BillingUpstreamSetupGuide';
import { providerToBillingUpstream, useBillingProviderKeys } from './hooks/useBillingData';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';

const defaultRange = (): [number, number] => {
  const end = Date.now();
  return [end - 7 * 24 * 60 * 60 * 1000, end];
};

const BillingPage: React.FC = () => {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<BillingGranularity>('day');
  const [range, setRange] = useState<[number, number]>(() => defaultRange());
  const [upstreamProviderId, setUpstreamProviderId] = useState<string | undefined>();
  const [providerKeyId, setProviderKeyId] = useState<string | undefined>();
  const providers = useProvidersQuery();
  const selectedUpstreamProvider = useMemo(
    () => (providers.data ?? []).find((provider) => provider.id === upstreamProviderId),
    [providers.data, upstreamProviderId]
  );
  const upstream = useMemo(() => providerToBillingUpstream(selectedUpstreamProvider), [selectedUpstreamProvider]);
  const providerKeys = useBillingProviderKeys(upstream ? { upstream, scope: 'mine' } : undefined);
  const query = useMemo<BillingQuery>(
    () => ({
      upstream: upstream ?? { base_url: '', api_key: '' },
      granularity,
      provider_key_id: providerKeyId,
      start_ms: range[0],
      end_ms: range[1],
      timezone: 'Asia/Shanghai',
    }),
    [granularity, providerKeyId, range, upstream]
  );
  const upstreamOptions = useMemo(
    () =>
      (providers.data ?? [])
        .filter((provider) => provider.base_url?.trim() && provider.api_key?.trim())
        .map((provider) => ({
          label: provider.name,
          value: provider.id,
        })),
    [providers.data]
  );
  const providerOptions = useMemo(
    () =>
      (providerKeys.data ?? []).map((key) => ({
        label: key.display_name,
        value: key.provider_key_id,
        disabled: !key.billing_supported,
      })),
    [providerKeys.data]
  );

  return (
    <div className='h-full overflow-auto bg-1 p-16px'>
      <div className='mb-16px flex flex-col gap-12px lg:flex-row lg:items-center lg:justify-between'>
        <div>
          <h2 className='m-0 text-20px font-600 text-t-primary'>{t('billing.title')}</h2>
          <p className='m-0 mt-4px text-12px text-t-secondary'>{t('billing.subtitle')}</p>
        </div>
        <div className='flex flex-wrap items-center gap-10px'>
          <Select
            className='min-w-220px'
            loading={providers.isLoading}
            options={upstreamOptions}
            placeholder={t('billing.upstream.placeholder')}
            value={upstreamProviderId}
            onChange={(value) => {
              setUpstreamProviderId(value);
              setProviderKeyId(undefined);
            }}
          />
          <Select
            allowClear
            className='min-w-220px'
            disabled={!upstream}
            loading={providerKeys.isLoading}
            options={providerOptions}
            placeholder={t('billing.providerKey.placeholder')}
            value={providerKeyId}
            onChange={(value) => setProviderKeyId(value)}
          />
          <Radio.Group type='button' value={granularity} onChange={(value) => setGranularity(value as BillingGranularity)}>
            <Radio value='hour'>{t('billing.granularity.hour')}</Radio>
            <Radio value='day'>{t('billing.granularity.day')}</Radio>
            <Radio value='month'>{t('billing.granularity.month')}</Radio>
          </Radio.Group>
          <DatePicker.RangePicker
            showTime
            onChange={(dateStrings) => {
              const values = Array.isArray(dateStrings) ? dateStrings : [];
              const start = values[0] ? new Date(values[0]).getTime() : NaN;
              const end = values[1] ? new Date(values[1]).getTime() : NaN;
              if (Number.isFinite(start) && Number.isFinite(end)) setRange([start, end]);
            }}
          />
        </div>
      </div>
      {!providers.isLoading && upstreamOptions.length === 0 && <BillingUpstreamSetupGuide />}
      <Tabs defaultActiveTab='overview'>
        <Tabs.TabPane key='overview' title={t('billing.tabs.overview')}>
          <BillingOverview query={query} />
        </Tabs.TabPane>
        <Tabs.TabPane key='details' title={t('billing.tabs.details')}>
          <BillingDetails query={query} />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default BillingPage;
