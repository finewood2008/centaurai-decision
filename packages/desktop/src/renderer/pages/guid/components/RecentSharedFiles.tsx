/**
 * RecentSharedFiles — vertical list of the most recently added shared-library
 * items, shown on the home right rail below RecentFiles. Reuses the same
 * `.recent*` styles for visual consistency.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Message } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { getFileIcon, formatSize, formatTime } from './RecentFiles';
import { downloadShared, listShared, openShared } from '@/renderer/services/SharedDriveService';
import type { SharedFileEntry } from '@/common/adapter/ipcBridge';
import styles from '../index.module.css';

interface RecentSharedFilesProps {
  onViewAll?: () => void;
  limit?: number;
}

const RecentSharedFiles: React.FC<RecentSharedFilesProps> = ({ onViewAll, limit = 6 }) => {
  const { t } = useTranslation();
  const [files, setFiles] = useState<SharedFileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await listShared();
      setFiles(list);
    } catch {
      setFiles([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const open = async (file: SharedFileEntry) => {
    try {
      await openShared(file.id);
    } catch {
      Message.error(t('contentHub.toast.openFailed'));
    }
  };

  const download = async (e: React.MouseEvent, file: SharedFileEntry) => {
    e.stopPropagation();
    try {
      await downloadShared(file.id, file.name);
    } catch {
      Message.error(t('contentHub.toast.downloadFailed'));
    }
  };

  if (!loaded) return null;
  if (files.length === 0) {
    return <div className={styles.recentEmpty}>{t('contentHub.shared.empty')}</div>;
  }

  const displayed = files.slice(0, limit);
  const hasMore = files.length > limit;

  return (
    <div className={styles.recentList}>
      {displayed.map((file) => (
        <div
          key={file.id}
          className={styles.recentItem}
          onClick={() => open(file)}
          title={`${file.name}\n${file.uploaderName || file.uploaderId || ''}\n${formatSize(file.size)}`}
        >
          <span className={styles.recentItemIcon}>{getFileIcon(file.name)}</span>
          <div className={styles.recentItemBody}>
            <div className={styles.recentItemName}>{file.name}</div>
            <div className={styles.recentItemMeta}>
              <span>{formatTime(Math.floor(file.createdAt / 1000))}</span>
              <span className={styles.recentItemDot}>·</span>
              <span>{file.category || formatSize(file.size)}</span>
            </div>
          </div>
          <div className={styles.recentItemActions}>
            <span onClick={(e) => download(e, file)} className={styles.recentItemAction} title='Download'>
              <Download size='12' />
            </span>
          </div>
        </div>
      ))}
      {hasMore && onViewAll && (
        <button type='button' onClick={onViewAll} className={styles.recentViewAll}>
          {t('guid.recentFiles.viewAll', { defaultValue: 'See all' })} →
        </button>
      )}
    </div>
  );
};

export default RecentSharedFiles;
