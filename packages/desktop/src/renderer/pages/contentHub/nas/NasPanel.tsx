/**
 * NasPanel — the 网盘 (enterprise LAN network drive) tab.
 *
 * Browses the admin's large shared disk: folders navigate in place, files open
 * (inline preview) or download. Read+write (P2): upload (button + drag-drop),
 * new folder, rename, and delete (soft-delete to a recycle folder). Backed by
 * the web-host /api/nas/* routes (or admin IPC) via NasService.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Button, Input, Message, Modal, Popconfirm } from '@arco-design/web-react';
import { Delete, Download, Editor, FileText, FolderClose, FolderPlus, Refresh, Right, Upload } from '@icon-park/react';
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
  const { path, entries, loading, disabled, unavailable, navigate, refresh, mkdir, upload, remove, rename } = useNas();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [busy, setBusy] = useState(false);
  // Naming dialog (shared by "new folder" and "rename").
  const [dialog, setDialog] = useState<{ mode: 'mkdir' | 'rename'; entry?: NasEntry; value: string } | null>(null);

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

  const run = async (fn: () => Promise<void>, failKey: string) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      Message.error(t(failKey));
    } finally {
      setBusy(false);
    }
  };

  const doUpload = (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    void run(async () => {
      await upload(list);
      Message.success(t('contentHub.nas.uploadDone'));
    }, 'contentHub.nas.uploadFailed');
  };

  const submitDialog = () => {
    if (!dialog) return;
    const name = dialog.value.trim();
    if (!name) return;
    const { mode, entry } = dialog;
    setDialog(null);
    void run(
      async () => {
        if (mode === 'mkdir') await mkdir(name);
        else if (entry) await rename(entry, name);
      },
      mode === 'mkdir' ? 'contentHub.nas.mkdirFailed' : 'contentHub.nas.renameFailed'
    );
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files);
  };
  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  if (disabled) {
    return <EmptyState message={t('contentHub.nas.disabled')} loadingMessage={t('contentHub.nas.loading')} />;
  }
  if (unavailable) {
    return <EmptyState message={t('contentHub.nas.unavailable')} loadingMessage={t('contentHub.nas.loading')} />;
  }

  return (
    <div
      className='flex-1 flex flex-col min-h-0 px-16px pb-16px relative'
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Toolbar: breadcrumb (left) + actions (right) */}
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
        <div className='ml-auto flex items-center gap-4px'>
          <Button
            type='text'
            size='mini'
            icon={<Upload theme='outline' size={14} />}
            loading={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('contentHub.nas.upload')}
          </Button>
          <Button
            type='text'
            size='mini'
            icon={<FolderPlus theme='outline' size={14} />}
            onClick={() => setDialog({ mode: 'mkdir', value: '' })}
          >
            {t('contentHub.nas.newFolder')}
          </Button>
          <Button type='text' size='mini' icon={<Refresh theme='outline' size={14} />} onClick={refresh}>
            {t('contentHub.nas.refresh')}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type='file'
          multiple
          className='hidden'
          onChange={(e) => {
            doUpload(e.target.files);
            e.target.value = '';
          }}
        />
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
          <div className='flex items-center gap-12px px-12px py-8px text-12px text-t-tertiary border-b border-b-solid border-b-[var(--color-border-2)]'>
            <span className='flex-1'>{t('contentHub.nas.colName')}</span>
            <span className='w-100px text-right'>{t('contentHub.nas.colSize')}</span>
            <span className='w-140px text-right'>{t('contentHub.nas.colModified')}</span>
            <span className='w-120px' />
          </div>
          {visible.map((entry) => (
            <div
              key={entry.relPath}
              className='flex items-center gap-12px px-12px py-10px text-13px rd-6px hover:bg-fill-2 cursor-pointer group'
              onClick={() => onRowOpen(entry)}
            >
              <span className='flex-1 flex items-center gap-8px truncate'>
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
              <span
                className='w-120px flex justify-end gap-2px opacity-0 group-hover:opacity-100 transition-opacity'
                onClick={(e) => e.stopPropagation()}
              >
                {!entry.isDir && (
                  <Button
                    type='text'
                    size='mini'
                    icon={<Download theme='outline' size={14} />}
                    title={t('contentHub.nas.download')}
                    onClick={() => void downloadNasFile(entry.relPath)}
                  />
                )}
                <Button
                  type='text'
                  size='mini'
                  icon={<Editor theme='outline' size={14} />}
                  title={t('contentHub.nas.rename')}
                  onClick={() => setDialog({ mode: 'rename', entry, value: entry.name })}
                />
                <Popconfirm
                  focusLock
                  title={t('contentHub.nas.deleteConfirm', { name: entry.name })}
                  okText={t('contentHub.nas.delete')}
                  cancelText={t('contentHub.nas.cancel')}
                  onOk={() => run(() => remove(entry), 'contentHub.nas.deleteFailed')}
                >
                  <Button
                    type='text'
                    size='mini'
                    status='danger'
                    icon={<Delete theme='outline' size={14} />}
                    title={t('contentHub.nas.delete')}
                  />
                </Popconfirm>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Drag-drop overlay */}
      {dragging && (
        <div className='absolute inset-0 z-10 flex items-center justify-center bg-[rgba(var(--primary-6),0.08)] border-2 border-dashed border-[rgb(var(--primary-6))] rd-12px text-14px text-[rgb(var(--primary-6))] pointer-events-none'>
          {t('contentHub.nas.dropHere')}
        </div>
      )}

      {/* New-folder / rename dialog */}
      <Modal
        visible={!!dialog}
        title={dialog?.mode === 'rename' ? t('contentHub.nas.renameTitle') : t('contentHub.nas.newFolderTitle')}
        okText={t('contentHub.nas.ok')}
        cancelText={t('contentHub.nas.cancel')}
        onOk={submitDialog}
        onCancel={() => setDialog(null)}
        autoFocus
        focusLock
      >
        <Input
          autoFocus
          value={dialog?.value ?? ''}
          placeholder={t('contentHub.nas.namePlaceholder')}
          onChange={(v) => setDialog((d) => (d ? { ...d, value: v } : d))}
          onPressEnter={submitDialog}
        />
      </Modal>
    </div>
  );
};

export default NasPanel;
