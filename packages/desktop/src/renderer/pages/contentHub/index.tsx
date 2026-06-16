/**
 * ContentHubPage — unified hub for generated content.
 *
 * Replaces the old standalone FileArchivePage. Organizes the user's
 * visibility-scoped artifacts across four dimensions: 我的产物 / 按会话 /
 * 按类型 / 共享库, with preview, search and (later) one-click share-to-team.
 */
import React, { useState } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import HubHeader from './components/HubHeader';
import HubTabBar from './components/HubTabBar';
import TypeFilterBar from './components/TypeFilterBar';
import FileGrid from './components/FileGrid';
import ConversationGroup from './components/ConversationGroup';
import EmptyState from './components/EmptyState';
import ShareToTeamModal from './components/ShareToTeamModal';
import HubContextMenu, { type HubMenuState } from './components/HubContextMenu';
import SharedLibraryPanel from './shared/SharedLibraryPanel';
import { useHubFiles } from './useHubFiles';
import { useHubPreview } from './useHubPreview';
import { useHubFileActions } from './useHubFileActions';
import { shareToTeam, SHARED_DRIVE_UNAVAILABLE } from '@/renderer/services/SharedDriveService';
import { getCurrentFrontendUserId } from '@/common/utils/frontendUserScope';
import type { FileEntry, HubTab } from './types';

const isHubTab = (value: string | null): value is HubTab =>
  value === 'mine' || value === 'byConversation' || value === 'byType' || value === 'shared';

const ContentHubPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const initialTab = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState<HubTab>(isHubTab(initialTab) ? initialTab : 'mine');

  const hub = useHubFiles();
  const preview = useHubPreview();
  const actions = useHubFileActions();
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
      message={hub.search ? t('contentHub.empty.noMatch') : t('contentHub.empty.noFiles')}
    />
  );

  const renderBody = () => {
    if (tab === 'shared') return <SharedLibraryPanel />;

    if (tab === 'byConversation') {
      if (hub.loading || hub.byConversation.length === 0) return empty;
      return (
        <div className='flex-1 overflow-y-auto p-16px'>
          {hub.byConversation.map((group) => (
            <ConversationGroup
              key={group.conversation}
              conversation={group.conversation}
              files={group.files}
              onOpen={preview}
              onShare={setShareTarget}
              onContextMenu={openMenu}
            />
          ))}
        </div>
      );
    }

    const files = tab === 'byType' ? hub.byType : hub.searched;
    return (
      <>
        {tab === 'byType' && <TypeFilterBar value={hub.kind} onChange={hub.setKind} />}
        {hub.loading || files.length === 0 ? (
          empty
        ) : (
          <div className='flex-1 overflow-y-auto p-16px'>
            <FileGrid files={files} onOpen={preview} onShare={setShareTarget} onContextMenu={openMenu} />
          </div>
        )}
      </>
    );
  };

  return (
    <div className='h-full flex flex-col bg-[var(--color-bg-1)]'>
      <HubHeader count={hub.total} search={hub.search} onSearchChange={hub.setSearch} />
      <HubTabBar active={tab} onChange={setTab} />
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
