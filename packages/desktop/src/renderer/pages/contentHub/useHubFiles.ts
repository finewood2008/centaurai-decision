/** Loads managed assets plus legacy files from explicitly temporary workspaces. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import type { ContentAssetDTO } from '@/common/adapter/ipcBridge';
import { listContentAssets, migrateLegacyContentAssets } from '@/renderer/services/ContentAssetService';
import { filterConversationsWithChannelScope } from '@/renderer/utils/user/conversationVisibility';
import { useGeneratedFilesAutoRefresh } from '@/renderer/hooks/workspace/useGeneratedFilesAutoRefresh';
import { fetchRecentFiles, type FileEntry } from '@/renderer/pages/guid/components/RecentFiles';
import { classifyHubFile, isAssetInPersonalView } from './components/manage/hubState';
import type { HubFileRecord, PersonalWorkspaceView } from './types';

export function useHubFiles() {
  const [assets, setAssets] = useState<ContentAssetDTO[]>([]);
  const [temporaryFiles, setTemporaryFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      await migrateLegacyContentAssets();
      const [nextAssets, conversations] = await Promise.all([
        listContentAssets(),
        ipcBridge.database.getUserConversations.invoke({ limit: 10000 }),
      ]);
      const visible = await filterConversationsWithChannelScope(conversations.items ?? []);
      setAssets(nextAssets);
      setTemporaryFiles(await fetchRecentFiles(visible));
    } catch (error) {
      console.warn('[PersonalWorkspace] Unable to refresh:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void loadFiles(), [loadFiles]);
  useGeneratedFilesAutoRefresh(loadFiles, 3000);

  const records = useMemo(() => {
    const registeredPaths = new Set(assets.map((asset) => asset.sourceWorkspacePath.replace(/\\/g, '/')));
    const assetRecords: HubFileRecord<ContentAssetDTO>[] = assets.map((asset) => ({
      id: asset.id,
      name: asset.title,
      size: asset.size,
      modifiedAt: asset.updatedAt,
      kind: asset.kind,
      source: 'mine',
      raw: asset,
      asset,
      path: asset.storagePath,
      subtitle: asset.category,
    }));
    const legacyRecords: HubFileRecord<FileEntry>[] = temporaryFiles
      .filter((file) => !registeredPaths.has(file.path.replace(/\\/g, '/')))
      .map((file) => ({
        id: `legacy:${file.path}`,
        name: file.name,
        size: file.size,
        modifiedAt: file.mtime,
        kind: classifyHubFile(file.name),
        source: 'mine',
        raw: file,
        path: file.path,
        subtitle: file.conversation,
      }));
    return { assetRecords, legacyRecords };
  }, [assets, temporaryFiles]);

  const forView = useCallback(
    (view: PersonalWorkspaceView): HubFileRecord[] => {
      if (view === 'assets') {
        return records.assetRecords.filter((record) => isAssetInPersonalView(record.raw.statusFlags, view));
      }
      if (view === 'knowledge') return [];
      return [
        ...records.assetRecords.filter((record) => isAssetInPersonalView(record.raw.statusFlags, 'drafts')),
        ...records.legacyRecords,
      ];
    },
    [records]
  );

  return { loading, assets, forView, reload: loadFiles };
}
