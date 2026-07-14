/**
 * Generic card renderer for normalized hub records. Used by sections that do
 * not need custom thumbnails or drag behavior.
 */
import React from 'react';
import { Checkbox } from '@arco-design/web-react';
import FileThumb from '../view/FileThumb';
import { useSingleDoubleClick } from '../view/clickIntent';
import { GRID_SIZE, WATERFALL_COL_WIDTH, WATERFALL_EMOJI } from '../view/viewConfig';
import type { HubCardSize, HubFileRecord, HubViewMode } from '../../types';

type HubRecordCardsProps<T> = {
  records: readonly HubFileRecord<T>[];
  view: HubViewMode;
  size: HubCardSize;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
  onOpen: (record: HubFileRecord<T>) => void;
  onDirectOpen?: (record: HubFileRecord<T>) => void;
  renderActions?: (record: HubFileRecord<T>) => React.ReactNode;
};

function HubRecordCards<T>({
  records,
  view,
  size,
  selectedIds,
  onToggleSelect,
  onOpen,
  onDirectOpen,
  renderActions,
}: HubRecordCardsProps<T>) {
  const clickIntent = useSingleDoubleClick(onOpen, onDirectOpen);

  if (view === 'waterfall') {
    return (
      <div style={{ columnWidth: WATERFALL_COL_WIDTH[size], columnGap: 12 }}>
        {records.map((record) => (
          <div
            key={record.id}
            className='break-inside-avoid mb-12px rd-10px overflow-hidden cursor-pointer
              bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative'
            onClick={() => clickIntent.handleClick(record)}
            onDoubleClick={() => clickIntent.handleDoubleClick(record)}
            title={[record.name, record.subtitle, record.path].filter(Boolean).join('\n')}
          >
            {onToggleSelect && (
              <span
                className='absolute top-6px left-6px z-1'
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <Checkbox checked={selectedIds?.has(record.id) ?? false} onChange={() => onToggleSelect(record.id)} />
              </span>
            )}
            {renderActions && (
              <div
                className='absolute top-6px right-6px z-1 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {renderActions(record)}
              </div>
            )}
            <FileThumb name={record.name} variant='natural' emojiClass={WATERFALL_EMOJI[size]} />
            <div className='px-8px py-8px'>
              <div className='text-12px text-t-primary truncate leading-tight'>{record.name}</div>
              {record.subtitle && <div className='mt-2px text-10px text-t-secondary truncate'>{record.subtitle}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const dim = GRID_SIZE[size];
  return (
    <div className='flex flex-wrap gap-8px'>
      {records.map((record) => (
        <div
          key={record.id}
          className={`flex flex-col items-center gap-4px ${dim.card} rd-10px cursor-pointer
            bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative`}
          onClick={() => clickIntent.handleClick(record)}
          onDoubleClick={() => clickIntent.handleDoubleClick(record)}
          title={[record.name, record.subtitle, record.path].filter(Boolean).join('\n')}
        >
          {onToggleSelect && (
            <span
              className='absolute top-4px left-4px z-1'
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <Checkbox checked={selectedIds?.has(record.id) ?? false} onChange={() => onToggleSelect(record.id)} />
            </span>
          )}
          {renderActions && (
            <div
              className='absolute -top-4px right-0 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {renderActions(record)}
            </div>
          )}
          <FileThumb
            name={record.name}
            variant='cover'
            heightClass={dim.thumb}
            emojiClass={record.isDirectory ? 'text-38px' : dim.emoji}
          />
          <span className={`${dim.name} text-t-primary text-center w-full truncate leading-tight`}>{record.name}</span>
          {record.subtitle && (
            <span className='text-10px text-t-secondary text-center w-full truncate leading-tight'>
              {record.subtitle}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default HubRecordCards;
