/**
 * SharedFileCard — one item in the shared library, in either the uniform grid
 * or the masonry waterfall layout. Click opens it (preview URL); hover actions
 * download or remove; it's also a drag source (into chat / out to the OS).
 */
import React, { useCallback } from 'react';
import { Message } from '@arco-design/web-react';
import { Delete, Download } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { formatSize, formatTime } from '@/renderer/pages/guid/components/RecentFiles';
import { downloadShared, openShared, sharedDownloadUrl, SHARED_DND_MIME } from '@/renderer/services/SharedDriveService';
import FileThumb from '../components/view/FileThumb';
import { loadSharedImage } from '../components/view/imageThumb';
import { GRID_SIZE, WATERFALL_EMOJI } from '../components/view/viewConfig';
import type { HubCardSize, HubViewMode } from '../types';
import type { SharedFileEntry } from '@/common/adapter/ipcBridge';

type SharedFileCardProps = {
  file: SharedFileEntry;
  view: HubViewMode;
  size: HubCardSize;
  onRemove: (id: string) => void;
};

const SharedFileCard: React.FC<SharedFileCardProps> = ({ file, view, size, onRemove }) => {
  const { t } = useTranslation();
  const uploader = file.uploaderName || file.uploaderId || '';
  const mtime = Math.floor(file.createdAt / 1000);

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

  const loadImage = useCallback(() => loadSharedImage(file.id), [file.id]);

  const actions = (
    <>
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
    </>
  );

  const title = `${file.name}\n${uploader}\n${formatSize(file.size)} · ${formatTime(mtime)}`;

  if (view === 'waterfall') {
    return (
      <div
        className='break-inside-avoid mb-12px rd-10px overflow-hidden cursor-pointer
          bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative'
        onClick={handleOpen}
        draggable
        onDragStart={handleDragStart}
        title={title}
      >
        <div className='absolute top-6px right-6px z-1 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'>
          {actions}
        </div>
        <FileThumb name={file.name} loadImage={loadImage} variant='natural' emojiClass={WATERFALL_EMOJI[size]} />
        <div className='px-8px py-8px'>
          <div className='text-12px text-t-primary truncate leading-tight'>{file.name}</div>
          <div className='mt-2px text-10px text-t-secondary truncate leading-tight'>
            {uploader ? `${uploader} · ` : ''}
            {formatSize(file.size)} · {formatTime(mtime)}
          </div>
        </div>
      </div>
    );
  }

  const dim = GRID_SIZE[size];
  return (
    <div
      className={`flex flex-col items-center gap-4px ${dim.card} rd-10px cursor-pointer
        bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative`}
      onClick={handleOpen}
      draggable
      onDragStart={handleDragStart}
      title={title}
    >
      <div className='absolute -top-4px right-0 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'>
        {actions}
      </div>
      <FileThumb
        name={file.name}
        loadImage={loadImage}
        variant='cover'
        heightClass={dim.thumb}
        emojiClass={dim.emoji}
      />
      <span className={`${dim.name} text-t-primary text-center w-full truncate leading-tight`}>{file.name}</span>
      <span className='text-10px text-t-secondary text-center w-full truncate leading-tight'>{uploader}</span>
      <span className='text-10px text-t-secondary text-center leading-tight'>{formatSize(file.size)}</span>
      <span className='text-10px text-t-secondary text-center leading-tight'>{formatTime(mtime)}</span>
    </div>
  );
};

export default SharedFileCard;
