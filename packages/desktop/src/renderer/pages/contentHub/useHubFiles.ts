/**
 * useHubFiles — loads the current user's generated files and derives the
 * search / by-conversation / by-type views consumed by the Content Hub.
 *
 * Data source is reused verbatim from the homepage RecentFiles helpers so the
 * hub and the home rail always show the same visibility-scoped set.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import { filterConversationsWithChannelScope } from '@/renderer/utils/user/conversationVisibility';
import { buildVisibleFileFilter, fetchRecentFiles } from '@/renderer/pages/guid/components/RecentFiles';
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import type { FileEntry, HubConversationGroup, HubFileKind } from './types';

/** Map a fine-grained PreviewContentType to the coarse hub filter buckets. */
export function classifyHubFile(name: string): Exclude<HubFileKind, 'all'> {
  const type = getContentTypeByExtension(name);
  if (type === 'image') return 'image';
  if (type === 'pdf' || type === 'word' || type === 'excel' || type === 'ppt') return 'document';
  if (type === 'code' || type === 'markdown' || type === 'html') return 'code';
  return 'other';
}

export function useHubFiles() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<HubFileKind>('all');

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const conversations = await ipcBridge.database.getUserConversations.invoke({ limit: 10000 });
      const visibleConversations = await filterConversationsWithChannelScope(conversations.items ?? []);
      setFiles(await fetchRecentFiles(buildVisibleFileFilter(visibleConversations)));
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Files matching the search box, sorted newest-first.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files;
    return [...list].sort((a, b) => b.mtime - a.mtime);
  }, [files, search]);

  // Files for the 按类型 view: search + kind filter applied.
  const byType = useMemo(() => {
    if (kind === 'all') return searched;
    return searched.filter((f) => classifyHubFile(f.name) === kind);
  }, [searched, kind]);

  // Files grouped by conversation for the 按会话 view.
  const byConversation = useMemo<HubConversationGroup[]>(() => {
    const map = new Map<string, FileEntry[]>();
    for (const file of searched) {
      const list = map.get(file.conversation) ?? [];
      list.push(file);
      map.set(file.conversation, list);
    }
    return [...map.entries()]
      .map(([conversation, list]) => ({ conversation, files: list }))
      .sort((a, b) => (b.files[0]?.mtime ?? 0) - (a.files[0]?.mtime ?? 0));
  }, [searched]);

  return {
    loading,
    total: files.length,
    search,
    setSearch,
    kind,
    setKind,
    searched,
    byType,
    byConversation,
    reload: loadFiles,
  };
}
