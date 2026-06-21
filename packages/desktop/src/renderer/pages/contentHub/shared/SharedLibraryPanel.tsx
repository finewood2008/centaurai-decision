/**
 * SharedLibraryPanel — the 共享库 (enterprise LAN shared library) tab.
 *
 * Files here are visible to everyone on the LAN, organized by category.
 * Backed by the web-host /api/shared-drive/* routes via SharedDriveService.
 */
import React, { useRef, useState } from 'react';
import { Message } from '@arco-design/web-react';
import { Share, Upload } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import CategorySidebar from './CategorySidebar';
import SharedFileCard from './SharedFileCard';
import EmptyState from '../components/EmptyState';
import ViewControls from '../components/view/ViewControls';
import { WATERFALL_COL_WIDTH } from '../components/view/viewConfig';
import { useSharedDrive } from '../useSharedDrive';
import { useHubViewPrefs } from '../useHubViewPrefs';

type SharedLibraryPanelProps = {
  /** Filters the visible files by name; comes from the hub-wide search box. */
  search?: string;
};

const SharedLibraryPanel: React.FC<SharedLibraryPanelProps> = ({ search = '' }) => {
  const { t } = useTranslation();
  const { files, categories, category, setCategory, loading, unavailable, remove, addFiles } = useSharedDrive();
  const { view, size, setView, setSize } = useHubViewPrefs();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const total = categories.reduce((sum, c) => sum + c.count, 0);
  const q = search.trim().toLowerCase();
  const visibleFiles = q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files;

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };
  const onDragLeave = () => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length === 0) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    try {
      await addFiles(dropped);
      Message.success(t('contentHub.share.success'));
    } catch {
      Message.error(t('contentHub.share.error'));
    }
  };

  if (unavailable) {
    return (
      <div className='flex-1 flex flex-col items-center justify-center gap-12px text-t-secondary'>
        <Share size='40' className='opacity-50' />
        <div className='text-14px'>{t('contentHub.shared.comingSoon')}</div>
        <div className='text-12px opacity-70'>{t('contentHub.shared.allVisible')}</div>
      </div>
    );
  }

  return (
    <div
      className='flex-1 flex min-h-0 relative'
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className='absolute inset-0 z-50 flex flex-col items-center justify-center gap-8px bg-[var(--color-bg-1)]/85 border-2 border-dashed border-[var(--color-primary-6)] rd-12px pointer-events-none'>
          <Upload size='32' className='text-[var(--color-primary-6)]' />
          <div className='text-14px text-t-primary'>{t('contentHub.shared.upload')}</div>
        </div>
      )}
      <CategorySidebar categories={categories} total={total} selected={category} onSelect={setCategory} />
      <div className='flex-1 flex flex-col min-w-0'>
        <div className='flex items-center gap-8px px-16px py-8px shrink-0'>
          <span className='text-11px text-t-secondary'>{t('contentHub.shared.allVisible')}</span>
          <div className='flex-1' />
          <ViewControls view={view} size={size} onViewChange={setView} onSizeChange={setSize} />
        </div>
        {loading || visibleFiles.length === 0 ? (
          <EmptyState
            loading={loading}
            loadingMessage={t('contentHub.empty.loading')}
            message={q ? t('contentHub.empty.noMatch') : t('contentHub.shared.empty')}
          />
        ) : (
          <div className='flex-1 overflow-y-auto p-16px'>
            {view === 'waterfall' ? (
              <div style={{ columnWidth: WATERFALL_COL_WIDTH[size], columnGap: 12 }}>
                {visibleFiles.map((file) => (
                  <SharedFileCard key={file.id} file={file} view={view} size={size} onRemove={remove} />
                ))}
              </div>
            ) : (
              <div className='flex flex-wrap gap-8px'>
                {visibleFiles.map((file) => (
                  <SharedFileCard key={file.id} file={file} view={view} size={size} onRemove={remove} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SharedLibraryPanel;
