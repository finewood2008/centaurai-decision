/**
 * BatchActionBar — compact action strip shown whenever visible rows are
 * selected.
 */
import React from 'react';
import { Button } from '@arco-design/web-react';
import { CloseSmall } from '@icon-park/react';
import { useTranslation } from 'react-i18next';

export type HubBatchAction = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  status?: 'default' | 'danger' | 'success' | 'warning';
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
};

type BatchActionBarProps = {
  count: number;
  actions: readonly HubBatchAction[];
  onClear: () => void;
};

const BatchActionBar: React.FC<BatchActionBarProps> = ({ count, actions, onClear }) => {
  const { t } = useTranslation();
  if (count <= 0) return null;

  return (
    <div className='mx-18px mt-10px shrink-0 flex flex-wrap items-center gap-8px rd-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-fill-1)] px-10px py-8px text-12px text-t-primary'>
      <span className='font-[500]'>{t('contentHub.selection.selected', { count })}</span>
      <div className='flex flex-wrap items-center gap-4px'>
        {actions.map((action) => (
          <Button
            key={action.key}
            size='mini'
            type='text'
            status={action.status}
            icon={action.icon}
            disabled={action.disabled}
            loading={action.loading}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </div>
      <Button
        className='ml-auto'
        size='mini'
        type='text'
        icon={<CloseSmall size='14' />}
        onClick={onClear}
        aria-label={t('contentHub.selection.clear')}
      />
    </div>
  );
};

export default BatchActionBar;
