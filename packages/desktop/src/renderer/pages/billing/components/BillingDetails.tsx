import React, { useState } from 'react';
import { Button, Message, Table, Tag } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { BillingEvent, BillingQuery } from '@/common/types/billing';
import { useBillingEvents } from '../hooks/useBillingData';
import { formatCny, formatTime, formatTokens } from '../utils/formatters';

type BillingDetailsProps = {
  query: BillingQuery;
};

const downloadCsv = (csv: string): void => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `centaurai-billing-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const statusLabelKey: Record<BillingEvent['status'], string> = {
  completed: 'billing.requestStatus.completed',
  failed: 'billing.requestStatus.failed',
  cancelled: 'billing.requestStatus.cancelled',
  unknown: 'billing.requestStatus.unknown',
};

const BillingDetails: React.FC<BillingDetailsProps> = ({ query }) => {
  const { t } = useTranslation();
  const events = useBillingEvents(query);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      downloadCsv(await ipcBridge.billing.exportCsv.invoke(query));
    } catch (error) {
      console.error('[Billing] Export failed:', error);
      Message.error(t('billing.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className='flex flex-col gap-12px'>
      <div className='flex justify-end'>
        <Button icon={<Download />} loading={exporting} onClick={handleExport}>
          {t('billing.exportCsv')}
        </Button>
      </div>
      <Table
        rowKey='id'
        loading={events.isLoading}
        data={events.data ?? []}
        pagination={{ pageSize: 20, sizeCanChange: true }}
        columns={[
          {
            title: t('billing.table.time'),
            dataIndex: 'occurred_at_ms',
            width: 150,
            render: (value: number) => formatTime(value),
          },
          { title: t('billing.table.user'), dataIndex: 'user_name', width: 160 },
          { title: t('billing.table.model'), dataIndex: 'model', width: 180 },
          {
            title: t('billing.table.provider'),
            render: (_: unknown, row: BillingEvent) => row.provider_name || row.provider_platform || row.provider_key_id || '-',
          },
          {
            title: t('billing.table.tokens'),
            render: (_: unknown, row: BillingEvent) => formatTokens(row.total_tokens),
          },
          {
            title: t('billing.table.cost'),
            render: (_: unknown, row: BillingEvent) => formatCny(row.cost_cny),
          },
          {
            title: t('billing.table.status'),
            dataIndex: 'status',
            render: (value: BillingEvent['status']) => (
              <Tag color={value === 'completed' ? 'green' : 'orangered'}>{t(statusLabelKey[value] ?? statusLabelKey.unknown)}</Tag>
            ),
          },
        ]}
      />
    </div>
  );
};

export default BillingDetails;
