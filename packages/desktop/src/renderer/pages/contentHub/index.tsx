/**
 * ContentHubPage — unified hub for generated content.
 *
 * Three top-level sections: 我的产物 (with 全部 / 按会话 / 按类型 sub-views),
 * 共享库, and a read-only 知识库 (vector DB). Preview, search, per-section
 * grid/waterfall + size controls and one-click share-to-team.
 */
import React, { useState } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import HubHeader from './components/HubHeader';
import HubTabBar from './components/HubTabBar';
import MineSubTabs from './components/MineSubTabs';
import TypeFilterBar from './components/TypeFilterBar';
import FileGrid from './components/view/FileGrid';
import ViewControls from './components/view/ViewControls';
import ConversationGroup from './components/ConversationGroup';
import EmptyState from './components/EmptyState';
import ShareToTeamModal from './components/ShareToTeamModal';
import HubContextMenu, { type HubMenuState } from './components/HubContextMenu';
import SharedLibraryPanel from './shared/SharedLibraryPanel';
import KnowledgeBasePanel from './knowledge/KnowledgeBasePanel';
import { useHubFiles } from './useHubFiles';
import { useHubPreview } from './useHubPreview';
import { useHubFileActions } from './useHubFileActions';
import { useHubViewPrefs } from './useHubViewPrefs';
import { shareToTeam, SHARED_DRIVE_UNAVAILABLE } from '@/renderer/services/SharedDriveService';
import { getCurrentFrontendUserId } from '@/common/utils/frontendUserScope';
import type { FileEntry, HubMineView, HubSection } from './types';

/** Map the legacy ?tab= deep-link onto the new section + mine-view model. */
const parseInitialTab = (value: string | null): { section: HubSection; mineView: HubMineView } => {
  if (value === 'shared') return { section: 'shared', mineView: 'all' };
  if (value === 'knowledge') return { section: 'knowledge', mineView: 'all' };
  if (value === 'byConversation') return { section: 'mine', mineView: 'byConversation' };
  if (value === 'byType') return { section: 'mine', mineView: 'byType' };
  return { section: 'mine', mineView: 'all' };
};

const ContentHubPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const initial = parseInitialTab(new URLSearchParams(location.search).get('tab'));
  const [section, setSection] = useState<HubSection>(initial.section);
  const [mineView, setMineView] = useState<HubMineView>(initial.mineView);
  const [search, setSearch] = useState('');

  const hub = useHubFiles(search);
  const preview = useHubPreview();
  const actions = useHubFileActions();
  const { view, size, setView, setSize } = useHubViewPrefs();
  const [shareTarget, setShareTarget] = useState<FileEntry | null>(null);
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState<HubMenuState>(null);

  const openMenu = (file: FileEntry, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, file });
  };

  const handleShareConfirm = async (category: string) => {
    if (!shareTarget) return;
    setSharing(true);
    try {
      await shareToTeam({
        path: shareTarget.path,
        name: shareTarget.name,
        category: category || undefined,
        uploaderId: getCurrentFrontendUserId(),
      });
      Message.success(t('contentHub.share.success'));
      setShareTarget(null);
    } catch (err) {
      const unavailable = err instanceof Error && err.message === SHARED_DRIVE_UNAVAILABLE;
      Message.error(unavailable ? t('contentHub.shared.comingSoon') : t('contentHub.share.error'));
    } finally {
      setSharing(false);
    }
  };

  const empty = (
    <EmptyState
      loading={hub.loading}
      loadingMessage={t('contentHub.empty.loading')}
      message={search ? t('contentHub.empty.noMatch') : t('contentHub.empty.noFiles')}
    />
  );

  // 我的产物 toolbar: sub-view tabs (left) + optional type filter + view controls (right).
  const mineToolbar = (
    <div className='flex items-center gap-8px px-16px py-8px shrink-0'>
      <MineSubTabs active={mineView} onChange={setMineView} />
      {mineView === 'byType' && (
        <>
          <span className='w-1px h-16px bg-[var(--color-border-2)]' />
          <TypeFilterBar value={hub.kind} onChange={hub.setKind} />
        </>
      )}
      <div className='flex-1' />
      <ViewControls view={view} size={size} onViewChange={setView} onSizeChange={setSize} />
    </div>
  );

  const renderMine = () => {
    if (mineView === 'byConversation') {
      return (
        <>
          {mineToolbar}
          {hub.loading || hub.byConversation.length === 0 ? (
            empty
          ) : (
            <div className='flex-1 overflow-y-auto p-16px'>
              {hub.byConversation.map((group) => (
                <ConversationGroup
                  key={group.conversation}
                  conversation={group.conversation}
                  files={group.files}
                  view={view}
                  size={size}
                  onOpen={preview}
                  onShare={setShareTarget}
                  onContextMenu={openMenu}
                />
              ))}
            </div>
          )}
        </>
      );
    }

    const files = mineView === 'byType' ? hub.byType : hub.searched;
    return (
      <>
        {mineToolbar}
        {hub.loading || files.length === 0 ? (
          empty
        ) : (
          <div className='flex-1 overflow-y-auto p-16px'>
            <FileGrid
              files={files}
              view={view}
              size={size}
              onOpen={preview}
              onShare={setShareTarget}
              onContextMenu={openMenu}
            />
          </div>
        )}
      </>
    );
  };

  const renderBody = () => {
    if (section === 'shared') return <SharedLibraryPanel search={search} />;
    if (section === 'knowledge') return <KnowledgeBasePanel search={search} />;
    return renderMine();
  };

  return (
    <div className='h-full flex flex-col bg-[var(--color-bg-1)]'>
      <HubHeader count={hub.total} search={search} onSearchChange={setSearch} />
      <HubTabBar active={section} onChange={setSection} />
      {renderBody()}
      <ShareToTeamModal
        file={shareTarget}
        loading={sharing}
        onConfirm={handleShareConfirm}
        onCancel={() => setShareTarget(null)}
      />
      <HubContextMenu
        state={menu}
        onOpen={preview}
        onShare={setShareTarget}
        onCopyPath={(f) => void actions.copyPath(f)}
        onDownload={(f) => void actions.download(f)}
        onReveal={(f) => void actions.reveal(f)}
        onClose={() => setMenu(null)}
      />
    </div>
  );
};

export default ContentHubPage;
