import React, { useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Message, Select, Table, Tag } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { BillingModelPrice } from '@/common/types/billing';
import { uuid } from '@/common/utils';
import { saveBillingPrice, saveBillingSettings, useBillingPrices, useBillingSettings } from '../hooks/useBillingData';
import { formatUsd } from '../utils/formatters';

type PriceFormValues = {
  provider_platform?: string;
  provider_id?: string;
  model?: string;
  input_unit_price_usd?: number;
  output_unit_price_usd?: number;
  scope_type?: BillingModelPrice['scope_type'];
};

const priceScopeLabelKey: Record<BillingModelPrice['scope_type'], string> = {
  builtin: 'billing.priceScope.builtin',
  global: 'billing.priceScope.global',
  user_provider: 'billing.priceScope.user_provider',
};

const BillingPriceSettings: React.FC = () => {
  const { t } = useTranslation();
  const prices = useBillingPrices();
  const settings = useBillingSettings();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [settingsForm] = Form.useForm();

  const editablePrices = useMemo(() => (prices.data ?? []).filter((price) => price.scope_type !== 'builtin'), [prices.data]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const values = settingsForm.getFieldsValue() as {
        usd_to_cny_exchange_rate?: number;
        detail_retention_days?: number;
      };
      await saveBillingSettings(values);
      Message.success(t('common.saveSuccess'));
    } catch (error) {
      console.error('[Billing] Save settings failed:', error);
      Message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddPrice = async () => {
    const values = (await form.validate()) as PriceFormValues;
    const now = Date.now();
    await saveBillingPrice({
      id: `price-${uuid(16)}`,
      scope_type: values.scope_type ?? 'global',
      provider_platform: values.provider_platform,
      provider_id: values.provider_id,
      model: values.model!,
      input_unit_price_usd: values.input_unit_price_usd!,
      output_unit_price_usd: values.output_unit_price_usd!,
      currency: 'USD',
      enabled: true,
      created_at: now,
      updated_at: now,
    });
    form.resetFields();
    Message.success(t('common.saveSuccess'));
  };

  return (
    <div className='grid grid-cols-1 gap-12px xl:grid-cols-[360px_1fr]'>
      <div className='flex flex-col gap-12px'>
        <Card title={t('billing.settings.title')} bordered={false}>
          <Form
            form={settingsForm}
            layout='vertical'
            initialValues={{
              usd_to_cny_exchange_rate: settings.data?.usd_to_cny_exchange_rate ?? 7.2,
              detail_retention_days: settings.data?.detail_retention_days ?? 365,
            }}
          >
            <Form.Item label={t('billing.settings.exchangeRate')} field='usd_to_cny_exchange_rate'>
              <InputNumber min={0} precision={4} className='w-full' />
            </Form.Item>
            <Form.Item label={t('billing.settings.retentionDays')} field='detail_retention_days'>
              <InputNumber min={30} precision={0} className='w-full' />
            </Form.Item>
            <Button type='primary' loading={saving} onClick={handleSaveSettings}>
              {t('common.save')}
            </Button>
          </Form>
        </Card>
        <Card title={t('billing.prices.add')} bordered={false}>
          <Form form={form} layout='vertical'>
            <Form.Item label={t('billing.prices.scope')} field='scope_type' initialValue='global'>
              <Select
                options={[
                  { label: t('billing.priceScope.global'), value: 'global' },
                  { label: t('billing.priceScope.user_provider'), value: 'user_provider' },
                ]}
              />
            </Form.Item>
            <Form.Item label={t('billing.table.provider')} field='provider_platform'>
              <Input placeholder='openai / anthropic / gemini' />
            </Form.Item>
            <Form.Item label={t('billing.prices.providerId')} field='provider_id'>
              <Input />
            </Form.Item>
            <Form.Item label={t('billing.table.model')} field='model' rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item label={t('billing.prices.inputPrice')} field='input_unit_price_usd' rules={[{ required: true }]}>
              <InputNumber min={0} precision={6} className='w-full' />
            </Form.Item>
            <Form.Item label={t('billing.prices.outputPrice')} field='output_unit_price_usd' rules={[{ required: true }]}>
              <InputNumber min={0} precision={6} className='w-full' />
            </Form.Item>
            <Button type='primary' icon={<Plus />} onClick={() => void handleAddPrice()}>
              {t('common.add')}
            </Button>
          </Form>
        </Card>
      </div>
      <Card title={t('billing.prices.tableTitle')} bordered={false}>
        <Table
          rowKey='id'
          loading={prices.isLoading}
          data={editablePrices}
          pagination={{ pageSize: 12 }}
          columns={[
            {
              title: t('billing.prices.scope'),
              dataIndex: 'scope_type',
              render: (value: BillingModelPrice['scope_type']) => <Tag>{t(priceScopeLabelKey[value])}</Tag>,
            },
            { title: t('billing.table.provider'), dataIndex: 'provider_platform' },
            { title: t('billing.table.model'), dataIndex: 'model' },
            { title: t('billing.prices.inputPrice'), dataIndex: 'input_unit_price_usd', render: (value) => formatUsd(value) },
            { title: t('billing.prices.outputPrice'), dataIndex: 'output_unit_price_usd', render: (value) => formatUsd(value) },
          ]}
        />
      </Card>
    </div>
  );
};

export default BillingPriceSettings;
