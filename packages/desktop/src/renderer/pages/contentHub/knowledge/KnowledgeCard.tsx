/**
 * KnowledgeCard — one read-only document from the vector DB, in either the
 * uniform grid or the masonry waterfall layout. Images load a real thumbnail;
 * a chunk-count badge hints how much of the file is indexed. Click opens the
 * source file (desktop only — the path is local to the DB host).
 */
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSize, formatTime } from '@/renderer/pages/guid/components/RecentFiles';
import FileThumb from '../components/view/FileThumb';
import { GRID_SIZE, WATERFALL_EMOJI } from '../components/view/viewConfig';
import { loadKnowledgeImage, type KnowledgeDoc } from './knowledgeApi';
import type { HubCardSize, HubViewMode } from '../types';

type KnowledgeCardProps = {
  doc: KnowledgeDoc;
  view: HubViewMode;
  size: HubCardSize;
  onOpen: (doc: KnowledgeDoc) => void;
  actions?: React.ReactNode;
};

const KnowledgeCard: React.FC<KnowledgeCardProps> = ({ doc, view, size, onOpen, actions }) => {
  const { t } = useTranslation();
  const loadImage = useCallback(() => loadKnowledgeImage(doc.path), [doc.path]);
  const chunks = t('contentHub.knowledge.chunks', { n: doc.chunkCount });
  const meta = `${chunks}${doc.size ? ` · ${formatSize(doc.size)}` : ''}${doc.mtime ? ` · ${formatTime(doc.mtime)}` : ''}`;
  const title = `${doc.name}\n${doc.path}\n${meta}`;
  const badge = (
    <span className='absolute top-6px left-6px z-1 px-5px h-16px flex items-center rd-4px bg-[var(--color-bg-2)]/85 text-9px text-t-secondary'>
      {chunks}
    </span>
  );

  if (view === 'waterfall') {
    return (
      <div
        className='break-inside-avoid mb-12px rd-10px overflow-hidden cursor-pointer
          bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative'
        onClick={() => onOpen(doc)}
        title={title}
      >
        {badge}
        {actions && (
          <span
            className='absolute top-6px right-6px z-2 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </span>
        )}
        <FileThumb name={doc.name} loadImage={loadImage} variant='natural' emojiClass={WATERFALL_EMOJI[size]} />
        <div className='px-8px py-8px'>
          <div className='text-12px text-t-primary truncate leading-tight'>{doc.name}</div>
          <div className='mt-2px text-10px text-t-secondary truncate leading-tight'>{meta}</div>
        </div>
      </div>
    );
  }

  const dim = GRID_SIZE[size];
  return (
    <div
      className={`flex flex-col items-center gap-4px ${dim.card} rd-10px cursor-pointer
        bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] transition-colors group relative`}
      onClick={() => onOpen(doc)}
      title={title}
    >
      {badge}
      {actions && (
        <span
          className='absolute top-4px right-4px z-2 flex gap-2px opacity-0 group-hover:opacity-100 transition-opacity'
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </span>
      )}
      <FileThumb name={doc.name} loadImage={loadImage} variant='cover' heightClass={dim.thumb} emojiClass={dim.emoji} />
      <span className={`${dim.name} text-t-primary text-center w-full truncate leading-tight`}>{doc.name}</span>
      <span className='text-10px text-t-secondary text-center leading-tight'>{chunks}</span>
      {doc.size > 0 && (
        <span className='text-10px text-t-secondary text-center leading-tight'>{formatSize(doc.size)}</span>
      )}
    </div>
  );
};

export default KnowledgeCard;
