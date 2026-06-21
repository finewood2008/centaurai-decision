/**
 * SharedLibraryPicker — modal that lets the user pick one or more files from the
 * enterprise shared library to attach to the composer. Resolves each pick to a
 * local path (via SharedDriveService) and returns them through onConfirm.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Message } from '@arco-design/web-react';
import { Check } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { getFileIcon, formatSize } from '@/renderer/pages/guid/components/RecentFiles';
import { listShared, listSharedCategories, sharedFileToLocalPath } from '@/renderer/services/SharedDriveService';
import type { SharedCategoryEntry, SharedFileEntry } from '@/common/adapter/ipcBridge';

type SharedLibraryPickerProps = {
  visible: boolean;
  onCancel: () => void;
  /** Receives the resolved local paths of the chosen shared files. */
  onConfirm: (paths: string[]) => void;
};

const SharedLibraryPicker: React.FC<SharedLibraryPickerProps> = ({ visible, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<SharedFileEntry[]>([]);
  const [categories, setCategories] = useState<SharedCategoryEntry[]>([]);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([listShared(category), listSharedCategories()]);
      setFiles(list);
      setCategories(cats);
    } catch {
      setFiles([]);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      setCategory(undefined);
    }
  }, [visible]);

  const total = useMemo(() => categories.reduce((s, c) => s + c.count, 0), [categories]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = async () => {
    const picks = files.filter((f) => selected.has(f.id));
    if (picks.length === 0) {
      onCancel();
      return;
    }
    setConfirming(true);
    try {
      const paths = await Promise.all(picks.map((f) => sharedFileToLocalPath(f)));
      onConfirm(paths);
    } catch {
      Message.error(t('contentHub.toast.downloadFailed'));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t('common.fileAttach.fromSharedLibrary')}
      onOk={handleConfirm}
      onCancel={onCancel}
      okText={t('common.fileAttach.attachSelected', { count: selected.size })}
      confirmLoading={confirming}
      okButtonProps={{ disabled: selected.size === 0 }}
      style={{ width: 680 }}
      unmountOnExit
    >
      <div className='flex min-h-360px h-360px'>
        {/* Category sidebar */}
        <div className='w-150px shrink-0 border-r border-[var(--color-border-2)] pr-8px overflow-y-auto'>
          <div
            className={classNames(
              'px-10px py-6px rd-6px text-13px cursor-pointer flex justify-between',
              category == null ? 'bg-fill-3 text-t-primary font-[500]' : 'text-t-secondary hover:bg-fill-2'
            )}
            onClick={() => setCategory(undefined)}
          >
            <span>{t('contentHub.shared.all')}</span>
            <span className='text-11px text-t-secondary'>{total}</span>
          </div>
          {categories.map((c) => (
            <div
              key={c.key}
              className={classNames(
                'px-10px py-6px rd-6px text-13px cursor-pointer flex justify-between',
                category === c.key ? 'bg-fill-3 text-t-primary font-[500]' : 'text-t-secondary hover:bg-fill-2'
              )}
              onClick={() => setCategory(c.key)}
            >
              <span className='truncate'>{c.label || t('contentHub.shared.uncategorized')}</span>
              <span className='text-11px text-t-secondary ml-6px'>{c.count}</span>
            </div>
          ))}
        </div>
        {/* File grid */}
        <div className='flex-1 overflow-y-auto pl-12px'>
          {loading ? (
            <div className='h-full flex items-center justify-center text-t-secondary'>
              {t('contentHub.empty.loading')}
            </div>
          ) : files.length === 0 ? (
            <div className='h-full flex items-center justify-center text-t-secondary'>
              {t('contentHub.shared.empty')}
            </div>
          ) : (
            <div className='flex flex-wrap gap-8px'>
              {files.map((file) => {
                const isOn = selected.has(file.id);
                return (
                  <div
                    key={file.id}
                    onClick={() => toggle(file.id)}
                    className={classNames(
                      'flex flex-col items-center gap-2px w-96px px-4px py-10px rd-10px cursor-pointer relative transition-colors border',
                      isOn
                        ? 'bg-[var(--color-primary-light-1)] border-[var(--color-primary-6)]'
                        : 'bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] border-transparent'
                    )}
                    title={`${file.name}\n${formatSize(file.size)}`}
                  >
                    {isOn && (
                      <span className='absolute top-2px right-2px w-14px h-14px rd-full bg-[var(--color-primary-6)] text-white flex items-center justify-center'>
                        <Check size='10' />
                      </span>
                    )}
                    <span className='text-40px leading-none'>{getFileIcon(file.name)}</span>
                    <span className='text-11px text-t-primary text-center w-full truncate leading-tight'>
                      {file.name}
                    </span>
                    <span className='text-10px text-t-secondary leading-tight'>{formatSize(file.size)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SharedLibraryPicker;
