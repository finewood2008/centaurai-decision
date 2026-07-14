/**
 * HubFileList — dense file-manager list view used across all Content Hub
 * sections.
 */
import React from 'react';
import { Checkbox } from '@arco-design/web-react';
import { FileText, FolderClose } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useSingleDoubleClick } from '../view/clickIntent';
import { getHubSelectionSummary } from './hubState';
import type { HubFileRecord } from '../../types';

type HubFileListProps<T> = {
  records: readonly HubFileRecord<T>[];
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: (selected: boolean) => void;
  onOpen: (record: HubFileRecord<T>) => void;
  onDirectOpen?: (record: HubFileRecord<T>) => void;
  renderActions?: (record: HubFileRecord<T>) => React.ReactNode;
};

function formatDisplaySize(bytes: number): string {
  if (bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDisplayTime(epochSeconds: number): string {
  if (!epochSeconds) return '';
  const ms = epochSeconds >= 1e12 ? epochSeconds : epochSeconds * 1000;
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function HubFileList<T>({
  records,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onOpen,
  onDirectOpen,
  renderActions,
}: HubFileListProps<T>) {
  const { t } = useTranslation();
  const clickIntent = useSingleDoubleClick(onOpen, onDirectOpen);
  const visibleIds = records.map((record) => record.id);
  const summary = getHubSelectionSummary({ selectedIds: selectedIds ?? new Set() }, visibleIds);
  const selectable = !!onToggleSelect;

  return (
    <div className='min-w-720px overflow-hidden rd-8px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-1)]'>
      <div className='sticky top-0 z-1 grid grid-cols-[34px_minmax(240px,1fr)_120px_170px_180px] items-center gap-12px px-14px py-9px text-12px text-t-tertiary bg-[var(--color-fill-1)] border-b border-b-solid border-b-[var(--color-border-2)]'>
        <span>
          {selectable && (
            <Checkbox
              checked={summary.allVisibleSelected}
              indeterminate={summary.partiallySelected}
              onChange={(checked) => onToggleAll?.(checked)}
            />
          )}
        </span>
        <span>{t('contentHub.list.name')}</span>
        <span className='text-right'>{t('contentHub.list.size')}</span>
        <span className='text-right'>{t('contentHub.list.modified')}</span>
        <span />
      </div>
      {records.map((record) => (
        <div
          key={record.id}
          className='grid grid-cols-[34px_minmax(240px,1fr)_120px_170px_180px] items-center gap-12px px-14px py-10px text-13px border-b border-b-solid border-b-[var(--color-border-2)] last:border-b-0 hover:bg-fill-2 cursor-pointer group'
          onClick={() => clickIntent.handleClick(record)}
          onDoubleClick={() => clickIntent.handleDoubleClick(record)}
          title={[record.name, record.subtitle, record.path].filter(Boolean).join('\n')}
        >
          <span onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
            {selectable && (
              <Checkbox checked={selectedIds?.has(record.id) ?? false} onChange={() => onToggleSelect?.(record.id)} />
            )}
          </span>
          <span className='flex items-center gap-8px min-w-0'>
            {record.isDirectory ? (
              <span className='w-28px h-28px rd-6px flex items-center justify-center bg-[rgba(var(--warning-6),0.12)] text-[var(--color-warning-6)] shrink-0'>
                <FolderClose theme='outline' size={16} />
              </span>
            ) : (
              <span className='w-28px h-28px rd-6px flex items-center justify-center bg-fill-2 text-t-tertiary shrink-0'>
                <FileText theme='outline' size={16} />
              </span>
            )}
            <span className='min-w-0'>
              <span className='block truncate text-t-primary'>{record.name}</span>
              {record.subtitle && <span className='block truncate text-11px text-t-secondary'>{record.subtitle}</span>}
            </span>
          </span>
          <span className='text-right text-t-secondary'>
            {record.isDirectory ? '' : formatDisplaySize(record.size)}
          </span>
          <span className='text-right text-t-secondary'>{formatDisplayTime(record.modifiedAt)}</span>
          <span
            className='flex justify-end gap-2px opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity'
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {renderActions?.(record)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default HubFileList;
