/**
 * NasFolderPicker — a modal that browses the network drive's folder tree and
 * returns a chosen destination directory (relPath). Folders only; used by
 * "另存到网盘" to pick where an AI artifact should be copied.
 */
import React, { useEffect, useState } from 'react';
import { Button, Modal } from '@arco-design/web-react';
import { FolderClose, Right } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { listNas, type NasEntry } from '@/renderer/services/NasService';

type NasFolderPickerProps = {
  visible: boolean;
  /** Confirm button label suffix already provided by caller via title. */
  loading?: boolean;
  onPick: (relPath: string) => void;
  onCancel: () => void;
};

const NasFolderPicker: React.FC<NasFolderPickerProps> = ({ visible, loading, onPick, onCancel }) => {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [dirs, setDirs] = useState<NasEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async (target: string) => {
    setBusy(true);
    try {
      const { listing } = await listNas(target);
      setPath(listing.path);
      setDirs(listing.entries.filter((e) => e.isDir));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (visible) void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const crumbs = (() => {
    const segs = path ? path.split('/') : [];
    let acc = '';
    return segs.map((seg) => {
      acc = acc ? `${acc}/${seg}` : seg;
      return { label: seg, path: acc };
    });
  })();

  return (
    <Modal
      visible={visible}
      title={t('contentHub.nas.pickFolderTitle')}
      okText={t('contentHub.nas.saveHere')}
      cancelText={t('contentHub.nas.cancel')}
      okButtonProps={{ loading }}
      onOk={() => onPick(path)}
      onCancel={onCancel}
    >
      <div className='flex items-center gap-6px py-8px text-13px flex-wrap'>
        <span className='cursor-pointer text-t-secondary hover:text-t-primary' onClick={() => void load('')}>
          {t('contentHub.nas.root')}
        </span>
        {crumbs.map((c) => (
          <React.Fragment key={c.path}>
            <Right theme='outline' size={12} className='text-t-tertiary' />
            <span className='cursor-pointer text-t-secondary hover:text-t-primary' onClick={() => void load(c.path)}>
              {c.label}
            </span>
          </React.Fragment>
        ))}
      </div>
      <div className='h-260px overflow-auto rd-8px border border-solid border-[var(--color-border-2)]'>
        {dirs.length === 0 ? (
          <div className='h-full flex items-center justify-center text-t-tertiary text-13px'>
            {busy ? t('contentHub.nas.loading') : t('contentHub.nas.noSubfolders')}
          </div>
        ) : (
          dirs.map((d) => (
            <div
              key={d.relPath}
              className='flex items-center gap-8px px-12px py-10px text-13px cursor-pointer hover:bg-fill-2'
              onClick={() => void load(d.relPath)}
            >
              <FolderClose theme='outline' size={16} className='text-[var(--color-warning-6)] shrink-0' />
              <span className='truncate text-t-primary'>{d.name}</span>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
};

export default NasFolderPicker;
