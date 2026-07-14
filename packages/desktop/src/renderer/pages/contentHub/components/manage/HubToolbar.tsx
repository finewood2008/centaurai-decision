/**
 * Unified Content Hub toolbar: search, type filter, sort, refresh, and view
 * controls. Sections can pass their own left-side context and right-side tools.
 */
import React from 'react';
import { Button, Input, Select, Tooltip } from '@arco-design/web-react';
import { ArrowDown, ArrowUp, Refresh, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import ViewControls from '../view/ViewControls';
import { defaultSortDirection } from './hubState';
import type { HubCardSize, HubFileKind, HubSortDirection, HubSortKey, HubViewMode } from '../../types';

type HubToolbarProps = {
  search: string;
  kind: HubFileKind;
  sortKey: HubSortKey;
  sortDirection: HubSortDirection;
  view: HubViewMode;
  size: HubCardSize;
  onSearchChange: (value: string) => void;
  onKindChange: (value: HubFileKind) => void;
  onSortKeyChange: (value: HubSortKey) => void;
  onSortDirectionChange: (value: HubSortDirection) => void;
  onViewChange: (view: HubViewMode) => void;
  onSizeChange: (size: HubCardSize) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  start?: React.ReactNode;
  end?: React.ReactNode;
  simple?: boolean;
};

const TYPE_OPTIONS: { key: HubFileKind; labelKey: string }[] = [
  { key: 'all', labelKey: 'contentHub.type.all' },
  { key: 'image', labelKey: 'contentHub.type.image' },
  { key: 'document', labelKey: 'contentHub.type.document' },
  { key: 'code', labelKey: 'contentHub.type.code' },
  { key: 'other', labelKey: 'contentHub.type.other' },
];

const SORT_OPTIONS: { key: HubSortKey; labelKey: string }[] = [
  { key: 'modified', labelKey: 'contentHub.sort.modified' },
  { key: 'name', labelKey: 'contentHub.sort.name' },
  { key: 'size', labelKey: 'contentHub.sort.size' },
];

const HubToolbar: React.FC<HubToolbarProps> = ({
  search,
  kind,
  sortKey,
  sortDirection,
  view,
  size,
  onSearchChange,
  onKindChange,
  onSortKeyChange,
  onSortDirectionChange,
  onViewChange,
  onSizeChange,
  onRefresh,
  refreshing,
  start,
  end,
  simple = false,
}) => {
  const { t } = useTranslation();
  const directionTip = sortDirection === 'asc' ? t('contentHub.sort.directionAsc') : t('contentHub.sort.directionDesc');

  return (
    <div className='flex flex-wrap items-center gap-10px px-18px py-12px border-b border-b-solid border-b-[var(--color-border-2)] bg-[var(--color-bg-1)] shrink-0'>
      {start}
      <Input
        prefix={<Search size='14' />}
        placeholder={t('contentHub.search.placeholder')}
        value={search}
        onChange={onSearchChange}
        size='small'
        className='w-280px max-w-full'
        allowClear
      />
      {!simple && (
        <>
          <Select size='small' value={kind} onChange={onKindChange} className='w-112px'>
            {TYPE_OPTIONS.map((option) => (
              <Select.Option key={option.key} value={option.key}>
                {t(option.labelKey)}
              </Select.Option>
            ))}
          </Select>
          <Select
            size='small'
            value={sortKey}
            onChange={(value) => {
              const nextKey = value as HubSortKey;
              onSortKeyChange(nextKey);
              onSortDirectionChange(defaultSortDirection(nextKey));
            }}
            className='w-132px'
          >
            {SORT_OPTIONS.map((option) => (
              <Select.Option key={option.key} value={option.key}>
                {t(option.labelKey)}
              </Select.Option>
            ))}
          </Select>
          <Tooltip content={directionTip} mini>
            <Button
              size='mini'
              icon={sortDirection === 'asc' ? <ArrowUp size='14' /> : <ArrowDown size='14' />}
              onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
              aria-label={directionTip}
            />
          </Tooltip>
        </>
      )}
      {onRefresh && (
        <Tooltip content={t('contentHub.actions.refresh')} mini>
          <Button
            size='mini'
            icon={<Refresh size='14' />}
            loading={refreshing}
            onClick={onRefresh}
            aria-label={t('contentHub.actions.refresh')}
          />
        </Tooltip>
      )}
      <div className='flex-1 min-w-12px' />
      {end}
      <ViewControls view={view} size={size} onViewChange={onViewChange} onSizeChange={onSizeChange} />
    </div>
  );
};

export default HubToolbar;
