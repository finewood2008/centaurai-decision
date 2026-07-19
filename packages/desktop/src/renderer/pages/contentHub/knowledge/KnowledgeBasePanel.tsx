/**
 * KnowledgeBasePanel — browse, import, recover, preview, and download personal
 * memory documents from desktop and authenticated WebUI clients.
 */
import React, { useMemo, useState } from 'react';
import { Button, Message, Modal, Progress, Tooltip, Upload as ArcoUpload } from '@arco-design/web-react';
import { Book, CloseSmall, Delete, Download, PreviewOpen, Refresh, Upload } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import EmptyState from '../components/EmptyState';
import HubFileList from '../components/manage/HubFileList';
import { classifyHubFile } from '../components/manage/hubState';
import { WATERFALL_COL_WIDTH } from '../components/view/viewConfig';
import KnowledgeCard from './KnowledgeCard';
import KnowledgeTrashModal from './KnowledgeTrashModal';
import { useKnowledgeUploads, type KnowledgeUploadPhase } from './useKnowledgeUploads';
import type { KnowledgeState } from './useKnowledgeBase';
import {
  KNOWLEDGE_FILE_ACCEPT,
  isKnowledgeAdmin,
  knowledgeFileUrl,
  recycleKnowledgeDoc,
  reindexKnowledgeDoc,
  type KnowledgeDoc,
  type KnowledgeDocumentStatus,
} from './knowledgeApi';
import type { HubCardSize, HubViewMode } from '../types';

type KnowledgeBasePanelProps = {
  /** Filters the visible documents by name; comes from the hub-wide search box. */
  search?: string;
  state: KnowledgeState;
  view: HubViewMode;
  size: HubCardSize;
};

const KnowledgeBasePanel: React.FC<KnowledgeBasePanelProps> = ({ search = '', state, view, size }) => {
  const { t } = useTranslation();
  const { docs, total, loading, error } = state;
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [trashVisible, setTrashVisible] = useState(false);
  const admin = isKnowledgeAdmin();
  const uploads = useKnowledgeUploads(state.reload);

  const q = search.trim().toLowerCase();
  const visibleDocs = useMemo(() => (q ? docs.filter((d) => d.name.toLowerCase().includes(q)) : docs), [docs, q]);

  const statusLabel = (status: KnowledgeDocumentStatus) => {
    const keys: Record<KnowledgeDocumentStatus, Parameters<typeof t>[0]> = {
      indexed: 'contentHub.knowledge.status.indexed',
      queued: 'contentHub.knowledge.status.queued',
      processing: 'contentHub.knowledge.status.processing',
      failed: 'contentHub.knowledge.status.failed',
      unindexed: 'contentHub.knowledge.status.unindexed',
      missing: 'contentHub.knowledge.status.missing',
    };
    return t(keys[status]);
  };

  const uploadPhaseLabel = (phase: KnowledgeUploadPhase) =>
    t(`contentHub.knowledge.uploadPhase.${phase}` as Parameters<typeof t>[0]);

  const openDoc = (doc: KnowledgeDoc) => {
    if (!doc.onDisk || doc.status === 'missing') {
      Message.warning(t('contentHub.knowledge.fileMissing'));
      return;
    }
    if (admin) {
      void ipcBridge.shell.openFile.invoke(doc.path).catch(() => Message.error(t('contentHub.toast.openFailed')));
      return;
    }
    window.open(knowledgeFileUrl(doc.path, 'inline'), '_blank', 'noopener,noreferrer');
  };

  const downloadDoc = (doc: KnowledgeDoc) => {
    if (!doc.onDisk || doc.status === 'missing') return Message.warning(t('contentHub.knowledge.fileMissing'));
    window.open(knowledgeFileUrl(doc.path, 'attachment'), '_blank', 'noopener,noreferrer');
  };

  const withBusy = async (doc: KnowledgeDoc, action: () => Promise<void>) => {
    setBusyIds((current) => new Set(current).add(doc.id));
    try {
      await action();
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(doc.id);
        return next;
      });
    }
  };

  const retryDoc = (doc: KnowledgeDoc) =>
    withBusy(doc, async () => {
      try {
        await reindexKnowledgeDoc(doc.path);
        Message.success(t('contentHub.knowledge.retrySuccess'));
        state.reload();
      } catch {
        Message.error(t('contentHub.knowledge.retryFailed'));
      }
    });

  const confirmRecycle = (doc: KnowledgeDoc) => {
    Modal.confirm({
      title: t('contentHub.knowledge.deleteTitle'),
      content: t('contentHub.knowledge.deleteConfirm', { name: doc.name }),
      okButtonProps: { status: 'danger' },
      onOk: () =>
        withBusy(doc, async () => {
          try {
            await recycleKnowledgeDoc(doc.path);
            Message.success(t('contentHub.knowledge.deleteSuccess'));
            state.reload();
          } catch {
            Message.error(t('contentHub.knowledge.deleteFailed'));
            throw new Error('KNOWLEDGE_RECYCLE_FAILED');
          }
        }),
    });
  };

  const renderActions = (doc: KnowledgeDoc) => (
    <>
      <Tooltip content={t('contentHub.actions.preview')} mini>
        <Button
          type='text'
          size='mini'
          icon={<PreviewOpen size={14} />}
          disabled={!doc.onDisk || doc.status === 'missing'}
          onClick={() => openDoc(doc)}
        />
      </Tooltip>
      <Tooltip content={t('contentHub.actions.download')} mini>
        <Button
          type='text'
          size='mini'
          icon={<Download size={14} />}
          disabled={!doc.onDisk || doc.status === 'missing'}
          onClick={() => downloadDoc(doc)}
        />
      </Tooltip>
      {doc.onDisk && ['failed', 'unindexed'].includes(doc.status) && (
        <Tooltip content={t('contentHub.knowledge.retry')} mini>
          <Button
            type='text'
            size='mini'
            icon={<Refresh size={14} />}
            loading={busyIds.has(doc.id)}
            onClick={() => void retryDoc(doc)}
          />
        </Tooltip>
      )}
      {admin && doc.onDisk && (
        <Tooltip content={t('contentHub.knowledge.delete')} mini>
          <Button
            type='text'
            size='mini'
            status='danger'
            icon={<Delete size={14} />}
            loading={busyIds.has(doc.id)}
            onClick={() => confirmRecycle(doc)}
          />
        </Tooltip>
      )}
    </>
  );

  return (
    <div className='flex-1 flex flex-col min-h-0'>
      <div className='flex items-center gap-8px px-16px py-8px shrink-0'>
        <Book size='14' className='text-t-secondary' />
        <span className='text-12px text-t-secondary'>{t('contentHub.knowledge.summary', { n: total })}</span>
        <ArcoUpload
          className='ml-auto'
          multiple
          accept={{ type: KNOWLEDGE_FILE_ACCEPT, strict: false }}
          showUploadList={false}
          beforeUpload={(file) => {
            uploads.enqueue(file);
            return false;
          }}
        >
          <Button type='primary' size='mini' icon={<Upload size={14} />}>
            {t('contentHub.knowledge.import')}
          </Button>
        </ArcoUpload>
        {admin && (
          <Button type='text' size='mini' icon={<Delete size={14} />} onClick={() => setTrashVisible(true)}>
            {t('contentHub.knowledge.trash')}
          </Button>
        )}
      </div>
      {!!uploads.tasks.length && (
        <div className='mx-16px mb-8px shrink-0 max-h-160px overflow-y-auto rd-8px bg-fill-1 px-12px py-8px flex flex-col gap-6px'>
          {uploads.tasks.map((task) => (
            <div key={task.id} className='flex items-center gap-8px text-12px'>
              <span className='w-180px truncate text-t-primary' title={task.name}>
                {task.name}
              </span>
              <Progress
                className='flex-1'
                size='small'
                percent={task.progress}
                status={task.phase === 'error' ? 'error' : task.phase === 'done' ? 'success' : 'normal'}
              />
              <span className='w-72px text-t-secondary'>{uploadPhaseLabel(task.phase)}</span>
              {task.phase === 'error' && (
                <Button type='text' size='mini' onClick={() => uploads.retry(task.id)} title={task.error}>
                  {t('contentHub.knowledge.retry')}
                </Button>
              )}
              {['done', 'error'].includes(task.phase) && (
                <Button
                  type='text'
                  size='mini'
                  icon={<CloseSmall size={13} />}
                  onClick={() => uploads.dismiss(task.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
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
          {view === 'list' ? (
            <HubFileList
              records={visibleDocs.map((doc) => ({
                id: doc.id,
                name: doc.name,
                size: doc.size,
                modifiedAt: doc.mtime,
                kind: classifyHubFile(doc.name),
                source: 'knowledge',
                raw: doc,
                path: doc.path,
                subtitle: `${statusLabel(doc.status)} · ${t('contentHub.knowledge.chunks', { n: doc.chunkCount })}`,
              }))}
              onOpen={(record) => openDoc(record.raw as KnowledgeDoc)}
              onDirectOpen={(record) => openDoc(record.raw as KnowledgeDoc)}
              renderActions={(record) => renderActions(record.raw as KnowledgeDoc)}
            />
          ) : view === 'waterfall' ? (
            <div style={{ columnWidth: WATERFALL_COL_WIDTH[size], columnGap: 12 }}>
              {visibleDocs.map((doc) => (
                <KnowledgeCard
                  key={doc.id}
                  doc={doc}
                  view={view}
                  size={size}
                  onOpen={openDoc}
                  actions={renderActions(doc)}
                />
              ))}
            </div>
          ) : (
            <div className='flex flex-wrap gap-8px'>
              {visibleDocs.map((doc) => (
                <KnowledgeCard
                  key={doc.id}
                  doc={doc}
                  view={view}
                  size={size}
                  onOpen={openDoc}
                  actions={renderActions(doc)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {admin && (
        <KnowledgeTrashModal visible={trashVisible} onCancel={() => setTrashVisible(false)} onRestored={state.reload} />
      )}
    </div>
  );
};

export default KnowledgeBasePanel;
