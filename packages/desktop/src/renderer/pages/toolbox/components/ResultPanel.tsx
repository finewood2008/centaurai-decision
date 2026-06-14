/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Image, Spin } from '@arco-design/web-react';
import { DownloadOne, PreviewOpen, Refresh, Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import type { ToolImageResult, ToolRunResult } from '../types';

type ResultStatus = 'idle' | 'running' | 'done' | 'error';

type ResultPanelProps = {
  status: ResultStatus;
  result: ToolRunResult | null;
  error: string | null;
  onOpenConversation: (conversationId: string) => void;
  onRegenerate: () => void;
};

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || 'image.png';
}

const ImageCard: React.FC<{ image: ToolImageResult }> = ({ image }) => {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col overflow-hidden rounded-8px b-1 b-solid b-line-2 bg-1'>
      {/* Arco Image gives click-to-zoom preview out of the box. */}
      <Image
        src={image.dataUrl}
        alt={fileName(image.path)}
        width='100%'
        height={320}
        className='bg-2 cursor-zoom-in'
        style={{ objectFit: 'contain' }}
      />
      <div className='flex min-w-0 items-center justify-between gap-8px border-0 border-t b-solid b-line-2 px-10px py-8px'>
        <span className='min-w-0 truncate text-12px text-t-tertiary'>{fileName(image.path)}</span>
        <Button
          size='mini'
          type='text'
          icon={<DownloadOne />}
          onClick={() => void downloadFileFromPath(image.path, fileName(image.path))}
        >
          {t('toolbox.download')}
        </Button>
      </div>
    </div>
  );
};

/** Renders the run state: loading, generated images / text, or an error. */
export const ResultPanel: React.FC<ResultPanelProps> = ({
  status,
  result,
  error,
  onOpenConversation,
  onRegenerate,
}) => {
  const { t } = useTranslation();

  const renderContent = () => {
    if (status === 'running') {
      return (
        <div className='flex min-h-360px flex-col items-center justify-center gap-14px rounded-12px bg-[var(--centaur-bg-warm)]'>
          <div className='flex h-48px w-48px items-center justify-center rounded-8px bg-1 text-primary-6'>
            <Spin dot />
          </div>
          <span className='text-13px font-500 text-t-secondary'>{t('toolbox.generating')}</span>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className='flex min-h-360px flex-col items-center justify-center gap-12px rounded-12px bg-[var(--centaur-bg-warm)] px-20px text-center'>
          <span className='text-13px text-rgb-danger'>{t('toolbox.runFailed')}</span>
          {error && <span className='text-12px text-t-tertiary break-all'>{error}</span>}
          <Button icon={<Refresh />} onClick={onRegenerate}>
            {t('toolbox.retry')}
          </Button>
        </div>
      );
    }

    if (status === 'done' && result) {
      const hasImages = result.images.length > 0;
      return (
        <div className='flex flex-col gap-12px'>
          <div className='flex flex-wrap justify-end gap-8px'>
            <Button size='small' icon={<Refresh />} onClick={onRegenerate}>
              {t('toolbox.regenerate')}
            </Button>
            {result.conversation_id && (
              <Button
                size='small'
                type='outline'
                icon={<Right />}
                onClick={() => onOpenConversation(result.conversation_id)}
              >
                {t('toolbox.openInConversation')}
              </Button>
            )}
          </div>
          {hasImages ? (
            <Image.PreviewGroup infinite={false}>
              <div
                className={
                  result.images.length === 1 ? 'grid grid-cols-1 gap-12px' : 'grid grid-cols-1 sm:grid-cols-2 gap-12px'
                }
              >
                {result.images.map((image) => (
                  <ImageCard key={image.path} image={image} />
                ))}
              </div>
            </Image.PreviewGroup>
          ) : (
            <div className='min-h-260px whitespace-pre-wrap rounded-12px bg-[var(--centaur-bg-warm)] p-14px text-13px leading-20px text-t-primary'>
              {result.text || t('toolbox.noOutput')}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className='flex min-h-360px items-center justify-center rounded-12px bg-[var(--centaur-bg-warm)]'>
        <Empty description={t('toolbox.resultHint')} />
      </div>
    );
  };

  return (
    <div className='centaur-card min-h-420px w-full' style={{ borderRadius: 'var(--centaur-radius-sm)' }}>
      <div
        className='flex items-center gap-10px px-16px py-14px'
        style={{ borderBottom: '1px solid var(--centaur-line)' }}
      >
        <div
          className='flex h-30px w-30px items-center justify-center rounded-10px'
          style={{ background: 'var(--centaur-gold-tint)', color: 'var(--centaur-gold-deep)' }}
        >
          <PreviewOpen size={16} />
        </div>
        <span className='text-14px font-600' style={{ color: 'var(--centaur-ink)' }}>
          {t('toolbox.resultTitle')}
        </span>
      </div>
      <div className='p-16px'>{renderContent()}</div>
    </div>
  );
};

export default ResultPanel;
