import React from 'react';
import { Card, Empty, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { BillingQuery, BillingSummary, BillingTimeseriesPoint } from '@/common/types/billing';
import { useBillingBreakdown, useBillingSummary, useBillingTimeseries } from '../hooks/useBillingData';
import { formatCny, formatTokens } from '../utils/formatters';

type BillingOverviewProps = {
  query: BillingQuery;
};

const MetricCard: React.FC<{ title: string; value: string; hint?: string }> = ({ title, value, hint }) => (
  <Card bordered={false} className='min-h-96px'>
    <div className='text-12px text-t-secondary'>{title}</div>
    <div className='mt-10px text-24px font-600 text-t-primary leading-30px'>{value}</div>
    {hint && <div className='mt-6px text-12px text-t-secondary'>{hint}</div>}
  </Card>
);

const TrendBars: React.FC<{ points: BillingTimeseriesPoint[] }> = ({ points }) => {
  const maxCost = Math.max(...points.map((point) => point.cost_cny), 0);
  if (!points.length) return <Empty />;

  return (
    <div className='h-180px flex items-end gap-6px overflow-x-auto px-2px pb-4px'>
      {points.map((point) => {
        const height = maxCost > 0 ? Math.max(8, (point.cost_cny / maxCost) * 160) : 8;
        return (
          <div key={point.bucket_start_ms} className='min-w-24px flex-1 flex flex-col items-center justify-end gap-6px'>
            <div
              className='w-full rd-4px bg-[rgb(var(--primary-6))]'
              style={{ height }}
              title={formatCny(point.cost_cny)}
            />
          </div>
        );
      })}
    </div>
  );
};

const summaryHint = (summary?: BillingSummary): string => {
  if (!summary || summary.total_tokens === 0) return '';
  return `${formatCny(summary.average_cost_cny_per_1m_tokens ?? 0)} / 1M tokens`;
};

const BillingOverview: React.FC<BillingOverviewProps> = ({ query }) => {
  const { t } = useTranslation();
  const summary = useBillingSummary(query);
  const timeseries = useBillingTimeseries(query);
  const modelBreakdown = useBillingBreakdown(query, 'model');
  const providerBreakdown = useBillingBreakdown(query, 'provider_key');

  if (summary.isLoading) {
    return (
      <div className='h-220px flex items-center justify-center'>
        <Spin />
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-12px'>
      <div className='grid grid-cols-1 gap-12px md:grid-cols-4'>
        <MetricCard
          title={t('billing.metric.cost')}
          value={formatCny(summary.data?.cost_cny ?? 0)}
          hint={summaryHint(summary.data)}
        />
        <MetricCard title={t('billing.metric.tokens')} value={formatTokens(summary.data?.total_tokens ?? 0)} />
        <MetricCard title={t('billing.metric.requests')} value={String(summary.data?.request_count ?? 0)} />
        <MetricCard title={t('billing.metric.output')} value={formatTokens(summary.data?.output_tokens ?? 0)} />
      </div>
      <Card title={t('billing.trend.title')} bordered={false}>
        {timeseries.isLoading ? <Spin /> : <TrendBars points={timeseries.data ?? []} />}
      </Card>
      <div className='grid grid-cols-1 gap-12px lg:grid-cols-2'>
        <Card title={t('billing.breakdown.model')} bordered={false}>
          {(modelBreakdown.data ?? []).length === 0 ? (
            <Empty />
          ) : (
            <div className='flex flex-col gap-10px'>
              {(modelBreakdown.data ?? []).map((row) => (
                <div key={row.key} className='flex items-center justify-between gap-12px text-13px'>
                  <span className='min-w-0 flex-1 truncate text-t-primary'>{row.label}</span>
                  <span className='shrink-0 text-t-secondary'>{formatTokens(row.total_tokens)}</span>
                  <span className='shrink-0 font-600 text-t-primary'>{formatCny(row.cost_cny)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title={t('billing.breakdown.providerKey')} bordered={false}>
          {(providerBreakdown.data ?? []).length === 0 ? (
            <Empty />
          ) : (
            <div className='flex flex-col gap-10px'>
              {(providerBreakdown.data ?? []).map((row) => (
                <div key={row.key} className='flex items-center justify-between gap-12px text-13px'>
                  <span className='min-w-0 flex-1 truncate text-t-primary'>{row.label}</span>
                  <span className='shrink-0 text-t-secondary'>{formatTokens(row.total_tokens)}</span>
                  <span className='shrink-0 font-600 text-t-primary'>{formatCny(row.cost_cny)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default BillingOverview;
