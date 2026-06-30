import React, { useMemo, useState } from 'react';
import { DatePicker, Radio, Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { BillingGranularity, BillingQuery } from '@/common/types/billing';
import BillingDetails from './components/BillingDetails';
import BillingOverview from './components/BillingOverview';
import BillingPriceSettings from './components/BillingPriceSettings';

const BillingPage: React.FC = () => {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<BillingGranularity>('day');
  const [range, setRange] = useState<[number, number] | null>(null);
  const query = useMemo<BillingQuery>(
    () => ({
      granularity,
      start: range?.[0],
      end: range?.[1],
    }),
    [granularity, range]
  );

  return (
    <div className='h-full overflow-auto bg-1 p-16px'>
      <div className='mb-16px flex flex-col gap-12px lg:flex-row lg:items-center lg:justify-between'>
        <div>
          <h2 className='m-0 text-20px font-600 text-t-primary'>{t('billing.title')}</h2>
          <p className='m-0 mt-4px text-12px text-t-secondary'>{t('billing.subtitle')}</p>
        </div>
        <div className='flex flex-wrap items-center gap-10px'>
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
              setRange(Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null);
            }}
          />
        </div>
      </div>
      <Tabs defaultActiveTab='overview'>
        <Tabs.TabPane key='overview' title={t('billing.tabs.overview')}>
          <BillingOverview query={query} />
        </Tabs.TabPane>
        <Tabs.TabPane key='details' title={t('billing.tabs.details')}>
          <BillingDetails query={query} />
        </Tabs.TabPane>
        <Tabs.TabPane key='prices' title={t('billing.tabs.prices')}>
          <BillingPriceSettings />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default BillingPage;
