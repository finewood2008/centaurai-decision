/**
 * NasPanel — the 网盘 (enterprise LAN network drive) tab. READ-ONLY (P1).
 *
 * Browses the admin's large shared disk: folders navigate in place, files can
 * be opened (inline preview) or downloaded. Backed by the web-host /api/nas/*
 * routes via NasService. No upload / delete / rename in P1.
 */
import React, { useMemo } from 'react';
import { Button } from '@arco-design/web-react';
import { Download, FolderClose, FileText, Right, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNas } from './useNas';
import { downloadNasFile, openNasFile, type NasEntry } from '@/renderer/services/NasService';
import { formatFileSize } from '@/renderer/services/FileService';
import EmptyState from '../components/EmptyState';

type NasPanelProps = {
  /** Filters the visible entries by name; comes from the hub-wide search box. */
  search?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

function formatDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const NasPanel: React.FC<NasPanelProps> = ({ search = '' }) => {
  const { t } = useTranslation();
  const { path, entries, loading, disabled, unavailable, navigate, refresh } = useNas();

  const q = search.trim().toLowerCase();
  const visible = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;

  // Breadcrumb: root + each cumulative path segment.
  const crumbs = useMemo(() => {
    const segs = path ? path.split('/') : [];
    let acc = '';
    return segs.map((seg) => {
      acc = acc ? `${acc}/${seg}` : seg;
      return { label: seg, path: acc };
    });
  }, [path]);

  const onRowOpen = (entry: NasEntry) => {
    if (entry.isDir) navigate(entry.relPath);
    else void openNasFile(entry.relPath);
  };

  if (disabled) {
    return <EmptyState message={t('contentHub.nas.disabled')} loadingMessage={t('contentHub.nas.loading')} />;
  }
  if (unavailable) {
    return <EmptyState message={t('contentHub.nas.unavailable')} loadingMessage={t('contentHub.nas.loading')} />;
  }

  return (
    <div className='flex-1 flex flex-col min-h-0 px-16px pb-16px'>
      {/* Breadcrumb + refresh */}
      <div className='flex items-center gap-6px py-12px text-13px shrink-0'>
        <span className='cursor-pointer text-t-secondary hover:text-t-primary' onClick={() => navigate('')}>
          {t('contentHub.nas.root')}
        </span>
        {crumbs.map((c) => (
          <React.Fragment key={c.path}>
            <Right theme='outline' size={12} className='text-t-tertiary' />
            <span className='cursor-pointer text-t-secondary hover:text-t-primary' onClick={() => navigate(c.path)}>
              {c.label}
            </span>
          </React.Fragment>
        ))}
        <Button
          type='text'
          size='mini'
          className='ml-auto'
          icon={<Refresh theme='outline' size={14} />}
          onClick={refresh}
        >
          {t('contentHub.nas.refresh')}
        </Button>
      </div>

      {/* Listing */}
      {visible.length === 0 ? (
        <EmptyState
          loading={loading}
          message={t('contentHub.nas.empty')}
          loadingMessage={t('contentHub.nas.loading')}
        />
      ) : (
        <div className='flex-1 overflow-auto min-h-0'>
          {/* Header row */}
          <div className='flex items-center gap-12px px-12px py-8px text-12px text-t-tertiary border-b border-b-solid border-b-[var(--color-border-2)]'>
            <span className='flex-1'>{t('contentHub.nas.colName')}</span>
            <span className='w-100px text-right'>{t('contentHub.nas.colSize')}</span>
            <span className='w-140px text-right'>{t('contentHub.nas.colModified')}</span>
            <span className='w-80px' />
          </div>
          {visible.map((entry) => (
            <div
              key={entry.relPath}
              className='flex items-center gap-12px px-12px py-10px text-13px rd-6px hover:bg-fill-2 cursor-pointer group'
              onDoubleClick={() => onRowOpen(entry)}
            >
              <span className='flex-1 flex items-center gap-8px truncate' onClick={() => onRowOpen(entry)}>
                {entry.isDir ? (
                  <FolderClose theme='outline' size={16} className='text-[var(--color-warning-6)] shrink-0' />
                ) : (
                  <FileText theme='outline' size={16} className='text-t-tertiary shrink-0' />
                )}
                <span className='truncate text-t-primary'>{entry.name}</span>
              </span>
              <span className='w-100px text-right text-t-secondary'>
                {entry.isDir ? '—' : formatFileSize(entry.size)}
              </span>
              <span className='w-140px text-right text-t-secondary'>{formatDate(entry.modifiedAt)}</span>
              <span className='w-80px flex justify-end gap-4px opacity-0 group-hover:opacity-100 transition-opacity'>
                {!entry.isDir && (
                  <Button
                    type='text'
                    size='mini'
                    icon={<Download theme='outline' size={14} />}
                    title={t('contentHub.nas.download')}
                    onClick={(e) => {
                      e.stopPropagation();
                      void downloadNasFile(entry.relPath);
                    }}
                  />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default NasPanel;
