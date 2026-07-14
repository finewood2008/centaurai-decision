/**
 * ViewControls — presentation switcher for the Content Hub: list, grid, or
 * waterfall layout, plus card size controls for visual modes.
 */
import React from 'react';
import classNames from 'classnames';
import { Button, Tooltip } from '@arco-design/web-react';
import { GridNine, Column, List } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { HubCardSize, HubViewMode } from '../../types';

type ViewControlsProps = {
  view: HubViewMode;
  size: HubCardSize;
  onViewChange: (view: HubViewMode) => void;
  onSizeChange: (size: HubCardSize) => void;
};

const SIZES: { key: HubCardSize; labelKey: string }[] = [
  { key: 'small', labelKey: 'contentHub.view.sizeSmall' },
  { key: 'medium', labelKey: 'contentHub.view.sizeMedium' },
  { key: 'large', labelKey: 'contentHub.view.sizeLarge' },
];

const ViewControls: React.FC<ViewControlsProps> = ({ view, size, onViewChange, onSizeChange }) => {
  const { t } = useTranslation();

  const iconBtn = (mode: HubViewMode, tip: string, icon: React.ReactNode) => (
    <Tooltip content={tip} mini>
      <Button
        size='mini'
        type='text'
        onClick={() => onViewChange(mode)}
        aria-label={tip}
        className={classNames(
          '!w-26px !h-24px !p-0 rd-6px transition-colors',
          view === mode ? '!bg-fill-3 !text-t-primary' : '!text-t-secondary hover:!bg-fill-2 hover:!text-t-primary'
        )}
      >
        {icon}
      </Button>
    </Tooltip>
  );

  return (
    <div className='flex items-center gap-8px'>
      <div className='flex items-center gap-2px p-2px rd-8px bg-fill-1'>
        {iconBtn('list', t('contentHub.view.list'), <List size='15' />)}
        {iconBtn('grid', t('contentHub.view.grid'), <GridNine size='15' />)}
        {iconBtn('waterfall', t('contentHub.view.waterfall'), <Column size='15' />)}
      </div>
      {view !== 'list' && (
        <div className='flex items-center gap-2px p-2px rd-8px bg-fill-1'>
          {SIZES.map((item) => (
            <Button
              key={item.key}
              size='mini'
              type='text'
              onClick={() => onSizeChange(item.key)}
              className={classNames(
                '!min-w-24px !h-24px !px-6px rd-6px !text-12px transition-colors',
                size === item.key
                  ? '!bg-fill-3 !text-t-primary font-[500]'
                  : '!text-t-secondary hover:!bg-fill-2 hover:!text-t-primary'
              )}
            >
              {t(item.labelKey)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ViewControls;
