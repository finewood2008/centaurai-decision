/** Decision personal workspace: drafts, durable assets, and one-way archive. */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Message, Modal, Tooltip } from '@arco-design/web-react';
import { Box, Copy, Delete, Download, FolderOpen, PreviewOpen, Save } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { ContentAssetDTO } from '@/common/adapter/ipcBridge';
import { useFileActions } from '@/renderer/hooks/file/useFileActions';
import {
  archiveContentAsset,
  discardContentAssetDraft,
  promoteContentAsset,
  saveContentAsset,
} from '@/renderer/services/ContentAssetService';
import EmptyState from './components/EmptyState';
import BatchActionBar, { type HubBatchAction } from './components/manage/BatchActionBar';
import HubFileList from './components/manage/HubFileList';
import HubRecordCards from './components/manage/HubRecordCards';
import HubToolbar from './components/manage/HubToolbar';
import PersonalWorkspaceSidebar from './components/manage/PersonalWorkspaceSidebar';
import {
  buildContentHubSearchParams,
  clearHubSelection,
  filterHubRecords,
  parseContentHubQuery,
  setHubSelectionForIds,
  sortHubRecords,
  toggleHubSelection,
} from './components/manage/hubState';
import { useHubFiles } from './useHubFiles';
import { useHubViewPrefs } from './useHubViewPrefs';
import type { HubFileRecord, HubSelectionState, HubUrlState, PersonalWorkspaceView } from './types';

function assetOf(record: HubFileRecord): ContentAssetDTO | null {
  if (record.id.startsWith('legacy:')) return null;
  return record.raw as ContentAssetDTO;
}

const targetFor = (record: HubFileRecord) => ({ path: record.path || '', name: record.name });

const ContentHubPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<HubUrlState>(() => parseContentHubQuery(searchParams));
  const [selection, setSelection] = useState<HubSelectionState>(() => clearHubSelection());
  const [busy, setBusy] = useState(false);
  const hub = useHubFiles();
  const prefs = useHubViewPrefs();
  const fileActions = useFileActions();
  const view = state.mineView as PersonalWorkspaceView;

  useEffect(() => {
    setSearchParams(buildContentHubSearchParams(state), { replace: true });
  }, [setSearchParams, state]);

  const allByView = useMemo(
    () => ({ drafts: hub.forView('drafts'), assets: hub.forView('assets'), archived: hub.forView('archived') }),
    [hub]
  );
  const visible = useMemo(
    () =>
      sortHubRecords(filterHubRecords(allByView[view], state.search, state.kind), state.sortKey, state.sortDirection),
    [allByView, state.kind, state.search, state.sortDirection, state.sortKey, view]
  );
  const selected = visible.filter((record) => selection.selectedIds.has(record.id));

  const changeView = (next: PersonalWorkspaceView) => {
    setSelection(clearHubSelection());
    setState((current) => ({ ...current, mineView: next }));
  };

  const reload = async () => {
    await hub.reload();
    setSelection(clearHubSelection());
  };

  const preview = async (record: HubFileRecord) => {
    try {
      await fileActions.previewFile(targetFor(record));
    } catch {
      Message.error(t('contentHub.actions.previewFailed'));
    }
  };

  const directOpen = async (record: HubFileRecord) => {
    try {
      await fileActions.openFile(targetFor(record));
    } catch {
      Message.error(t('contentHub.actions.openFailed'));
    }
  };

  const saveDraft = async (record: HubFileRecord) => {
    const asset = assetOf(record);
    if (asset) await promoteContentAsset(asset.id);
    else await saveContentAsset({ sourcePath: record.path || '', name: record.name });
  };

  const runMany = async (records: HubFileRecord[], operation: (record: HubFileRecord) => Promise<unknown>) => {
    setBusy(true);
    const results = await Promise.allSettled(records.map(operation));
    setBusy(false);
    await reload();
    const failures = results.filter((result) => result.status === 'rejected').length;
    Message[failures ? 'warning' : 'success'](
      failures
        ? t('contentHub.batch.partialFailure', { count: failures })
        : t('contentHub.batch.completed', { count: records.length })
    );
  };

  const confirmDiscard = (records: HubFileRecord[]) => {
    const managed = records.filter((record) => assetOf(record)?.statusFlags.includes('draft'));
    if (!managed.length) return;
    Modal.confirm({
      title: t('contentHub.actions.discardDraft'),
      content: t('contentHub.workspace.discardConfirm', { count: managed.length }),
      okButtonProps: { status: 'danger' },
      onOk: () => runMany(managed, (record) => discardContentAssetDraft(assetOf(record)!.id)),
    });
  };

  const archiveRecords = (records: HubFileRecord[]) =>
    runMany(
      records.filter((record) => assetOf(record)),
      (record) => archiveContentAsset(assetOf(record)!.id)
    );

  const copyPath = async (record: HubFileRecord) => {
    await navigator.clipboard.writeText(record.path || '');
    Message.success(t('common.copySuccess'));
  };

  const download = async (record: HubFileRecord) => {
    try {
      await fileActions.downloadFile(targetFor(record));
    } catch {
      Message.error(t('contentHub.actions.downloadFailed'));
    }
  };

  const renderActions = (record: HubFileRecord) => (
    <>
      <Tooltip content={t('contentHub.actions.preview')} mini>
        <Button type='text' size='mini' icon={<PreviewOpen size={15} />} onClick={() => void preview(record)} />
      </Tooltip>
      {view === 'drafts' && (
        <Tooltip content={t('contentHub.actions.saveAsset')} mini>
          <Button type='text' size='mini' icon={<Save size={15} />} onClick={() => void runMany([record], saveDraft)} />
        </Tooltip>
      )}
      {view === 'drafts' && assetOf(record) && (
        <Tooltip content={t('contentHub.actions.discardDraft')} mini>
          <Button
            type='text'
            status='danger'
            size='mini'
            icon={<Delete size={15} />}
            onClick={() => confirmDiscard([record])}
          />
        </Tooltip>
      )}
      {view === 'assets' && (
        <Tooltip content={t('contentHub.actions.archive')} mini>
          <Button type='text' size='mini' icon={<Box size={15} />} onClick={() => void archiveRecords([record])} />
        </Tooltip>
      )}
      {view !== 'drafts' && (
        <Tooltip content={t('contentHub.actions.download')} mini>
          <Button type='text' size='mini' icon={<Download size={15} />} onClick={() => void download(record)} />
        </Tooltip>
      )}
      <Tooltip content={t('contentHub.actions.copyPath')} mini>
        <Button type='text' size='mini' icon={<Copy size={15} />} onClick={() => void copyPath(record)} />
      </Tooltip>
      {view === 'assets' && fileActions.canReveal && (
        <Tooltip content={t('contentHub.actions.reveal')} mini>
          <Button
            type='text'
            size='mini'
            icon={<FolderOpen size={15} />}
            onClick={() => void fileActions.revealFile(targetFor(record))}
          />
        </Tooltip>
      )}
    </>
  );

  const batchActions: HubBatchAction[] =
    view === 'drafts'
      ? [
          {
            key: 'save',
            label: t('contentHub.actions.saveAsset'),
            loading: busy,
            onClick: () => void runMany(selected, saveDraft),
          },
          {
            key: 'discard',
            label: t('contentHub.actions.discardDraft'),
            status: 'danger',
            disabled: !selected.some((record) => assetOf(record)),
            onClick: () => confirmDiscard(selected),
          },
        ]
      : view === 'assets'
        ? [
            {
              key: 'archive',
              label: t('contentHub.actions.archive'),
              loading: busy,
              onClick: () => void archiveRecords(selected),
            },
          ]
        : [];

  return (
    <div className='h-full min-h-0 flex bg-[var(--color-bg-1)]'>
      <PersonalWorkspaceSidebar
        active={view}
        counts={{
          drafts: allByView.drafts.length,
          assets: allByView.assets.length,
          archived: allByView.archived.length,
        }}
        onChange={changeView}
      />
      <main className='flex-1 min-w-0 min-h-0 flex flex-col'>
        <HubToolbar
          search={state.search}
          kind={state.kind}
          sortKey={state.sortKey}
          sortDirection={state.sortDirection}
          view={state.view}
          size={prefs.size}
          onSearchChange={(search) => setState((current) => ({ ...current, search }))}
          onKindChange={(kind) => setState((current) => ({ ...current, kind }))}
          onSortKeyChange={(sortKey) => setState((current) => ({ ...current, sortKey }))}
          onSortDirectionChange={(sortDirection) => setState((current) => ({ ...current, sortDirection }))}
          onViewChange={(next) => {
            prefs.setView(next);
            setState((current) => ({ ...current, view: next }));
          }}
          onSizeChange={prefs.setSize}
          onRefresh={() => void reload()}
          refreshing={hub.loading}
        />
        <BatchActionBar
          count={selected.length}
          actions={batchActions}
          onClear={() => setSelection(clearHubSelection())}
        />
        <div className='flex-1 min-h-0 overflow-auto p-18px'>
          {hub.loading && !visible.length ? (
            <EmptyState loading loadingMessage={t('contentHub.empty.loading')} message='' />
          ) : !visible.length ? (
            <EmptyState loading={false} loadingMessage='' message={t(`contentHub.workspace.${view}Empty`)} />
          ) : state.view === 'list' ? (
            <HubFileList
              records={visible}
              selectedIds={selection.selectedIds}
              onToggleSelect={(id) => setSelection((current) => toggleHubSelection(current, id))}
              onToggleAll={(checked) =>
                setSelection((current) =>
                  setHubSelectionForIds(
                    current,
                    visible.map((record) => record.id),
                    checked
                  )
                )
              }
              onOpen={(record) => void preview(record)}
              onDirectOpen={(record) => void directOpen(record)}
              renderActions={renderActions}
            />
          ) : (
            <HubRecordCards
              records={visible}
              view={state.view}
              size={prefs.size}
              selectedIds={selection.selectedIds}
              onToggleSelect={(id) => setSelection((current) => toggleHubSelection(current, id))}
              onOpen={(record) => void preview(record)}
              onDirectOpen={(record) => void directOpen(record)}
              renderActions={renderActions}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default ContentHubPage;
