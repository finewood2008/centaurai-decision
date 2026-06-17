/**
 * SharedFileCard — one item in the shared library. Click opens it (preview URL);
 * hover actions download or remove.
 */
import React from 'react';
import { Message } from '@arco-design/web-react';
import { Delete, Download } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { getFileIcon, formatSize, formatTime } from '@/renderer/pages/guid/components/RecentFiles';
import { downloadShared, openShared, sharedDownloadUrl, SHARED_DND_MIME } from '@/renderer/services/SharedDriveService';
import type { SharedFileEntry } from '@/common/adapter/ipcBridge';

type SharedFileCardProps = {
  file: SharedFileEntry;
  onRemove: (id: string) => void;
};

const SharedFileCard: React.FC<SharedFileCardProps> = ({ file, onRemove }) => {
  const { t } = useTranslation();

  const handleOpen = async () => {
    try {
      await openShared(file.id);
    } catch {
      Message.error(t('contentHub.toast.openFailed'));
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await downloadShared(file.id, file.name);
    } catch {
      Message.error(t('contentHub.toast.downloadFailed'));
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(file.id);
  };

  // Make the card a real drag source: a DownloadURL lets users drag it out to
  // the OS file manager, and a custom mime lets the chat sendbox attach it.
  const handleDragStart = (e: React.DragEvent) => {
    // The custom mime is what the chat sendbox reads to attach the item; set it
    // synchronously so drag-into-chat always works. A DownloadURL (for dragging
    // out to the OS) is best-effort and only available in HTTP transport mode.
    e.dataTransfer.setData(SHARED_DND_MIME, JSON.stringify({ id: file.id, name: file.name }));
    e.dataTransfer.effectAllowed = 'copy';
    void sharedDownloadUrl(file.id)
      .then((url) => {
        e.dataTransfer.setData('text/uri-list', url);
        e.dataTransfer.setData('DownloadURL', `${file.mime}:${file.name}:${url}`);
      })
      .catch(() => {});
  };

  return (
    <div
      className='flex flex-col items-center gap-4px w-108px px-6px py-14px rd-10px cursor-pointer
        bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative'
      onClick={handleOpen}
      draggable
      onDragStart={handleDragStart}
      title={`${file.name}\n${file.uploaderName || file.uploaderId || ''}\n${formatSize(file.size)} · ${formatTime(Math.floor(file.createdAt / 1000))}`}
    >
      <div className='absolute -top-4px right-0 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'>
        <span
          onClick={handleDownload}
          className='w-18px h-18px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-t-primary cursor-pointer'
        >
          <Download size='10' />
        </span>
        <span
          onClick={handleRemove}
          className='w-18px h-18px flex items-center justify-center rd-4px bg-[var(--color-bg-2)] text-t-secondary hover:text-[rgb(var(--danger-6))] cursor-pointer'
        >
          <Delete size='10' />
        </span>
      </div>
      <span className='text-48px leading-none'>{getFileIcon(file.name)}</span>
      <span className='text-11px text-t-primary text-center w-full truncate leading-tight'>{file.name}</span>
      <span className='text-10px text-t-secondary text-center w-full truncate leading-tight'>
        {file.uploaderName || file.uploaderId || ''}
      </span>
      <span className='text-10px text-t-secondary text-center leading-tight'>{formatSize(file.size)}</span>
      <span className='text-10px text-t-secondary text-center leading-tight'>
        {formatTime(Math.floor(file.createdAt / 1000))}
      </span>
    </div>
  );
};

export default SharedFileCard;
