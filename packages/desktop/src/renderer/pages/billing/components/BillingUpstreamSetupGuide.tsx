import React from 'react';
import { Alert } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';

const BillingUpstreamSetupGuide: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div data-testid='billing-upstream-setup-guide' className='mb-16px rounded-8px border border-border bg-2 p-16px'>
      <div className='mb-10px text-15px font-600 text-t-primary'>{t('billing.onboarding.title')}</div>
      <ol className='m-0 list-decimal pl-20px text-13px leading-22px text-t-primary'>
        <li>{t('billing.onboarding.stepCreateKey')}</li>
        <li>{t('billing.onboarding.stepConfigureProvider')}</li>
      </ol>
      <Alert className='mt-12px' type='info' showIcon content={t('billing.onboarding.noSession')} />
    </div>
  );
};

export default BillingUpstreamSetupGuide;
