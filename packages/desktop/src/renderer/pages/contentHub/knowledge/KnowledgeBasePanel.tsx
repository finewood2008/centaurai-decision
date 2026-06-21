/**
 * KnowledgeBasePanel — the 知识库 tab: a read-only browse of everything indexed
 * in the local vector DB, with the same grid / waterfall + size controls as the
 * rest of the Content Hub. Clicking a document opens its source file (desktop).
 */
import React from 'react';
import { Message } from '@arco-design/web-react';
import { Book, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { isElectronDesktop } from '@/renderer/utils/platform';
import EmptyState from '../components/EmptyState';
import ViewControls from '../components/view/ViewControls';
import { WATERFALL_COL_WIDTH } from '../components/view/viewConfig';
import KnowledgeCard from './KnowledgeCard';
import { useKnowledgeBase } from './useKnowledgeBase';
import { useHubViewPrefs } from '../useHubViewPrefs';
import type { KnowledgeDoc } from './knowledgeApi';

type KnowledgeBasePanelProps = {
  /** Filters the visible documents by name; comes from the hub-wide search box. */
  search?: string;
};

const KnowledgeBasePanel: React.FC<KnowledgeBasePanelProps> = ({ search = '' }) => {
  const { t } = useTranslation();
  const { docs, total, loading, error, reload } = useKnowledgeBase();
  const { view, size, setView, setSize } = useHubViewPrefs();

  const q = search.trim().toLowerCase();
  const visibleDocs = q ? docs.filter((d) => d.name.toLowerCase().includes(q)) : docs;

  const openDoc = (doc: KnowledgeDoc) => {
    if (!isElectronDesktop()) {
      Message.info(t('contentHub.knowledge.openDesktopOnly'));
      return;
    }
    void ipcBridge.shell.openFile.invoke(doc.path).catch(() => Message.error(t('contentHub.toast.openFailed')));
  };

  return (
    <div className='flex-1 flex flex-col min-h-0'>
      <div className='flex items-center gap-8px px-16px py-8px shrink-0'>
        <Book size='14' className='text-t-secondary' />
        <span className='text-12px text-t-secondary'>{t('contentHub.knowledge.readonly', { n: total })}</span>
        <button
          onClick={reload}
          className='p-2px cursor-pointer text-t-secondary hover:text-t-primary'
          title={t('contentHub.knowledge.refresh')}
        >
          <Refresh size='13' />
        </button>
        <div className='flex-1' />
        <ViewControls view={view} size={size} onViewChange={setView} onSizeChange={setSize} />
      </div>
      {loading || error || visibleDocs.length === 0 ? (
        <EmptyState
          loading={loading}
          loadingMessage={t('contentHub.empty.loading')}
          message={
            error
              ? t('contentHub.knowledge.unreachable')
              : q
                ? t('contentHub.empty.noMatch')
                : t('contentHub.knowledge.empty')
          }
        />
      ) : (
        <div className='flex-1 overflow-y-auto p-16px'>
          {view === 'waterfall' ? (
            <div style={{ columnWidth: WATERFALL_COL_WIDTH[size], columnGap: 12 }}>
              {visibleDocs.map((doc) => (
                <KnowledgeCard key={doc.id} doc={doc} view={view} size={size} onOpen={openDoc} />
              ))}
            </div>
          ) : (
            <div className='flex flex-wrap gap-8px'>
              {visibleDocs.map((doc) => (
                <KnowledgeCard key={doc.id} doc={doc} view={view} size={size} onOpen={openDoc} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default KnowledgeBasePanel;
