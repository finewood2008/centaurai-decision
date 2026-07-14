/**
 * useSharedDrive — loads and mutates the enterprise LAN shared library.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  listShared,
  listSharedCategories,
  removeShared,
  shareFileToTeam,
  shareToTeam,
  type ShareToTeamInput,
} from '@/renderer/services/SharedDriveService';
import { getCurrentFrontendUserId } from '@/common/utils/frontendUserScope';
import type { SharedCategoryEntry, SharedFileEntry } from '@/common/adapter/ipcBridge';

export function useSharedDrive() {
  const [files, setFiles] = useState<SharedFileEntry[]>([]);
  const [categories, setCategories] = useState<SharedCategoryEntry[]>([]);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([listShared(category), listSharedCategories()]);
      setFiles(list);
      setCategories(cats);
      setUnavailable(false);
    } catch {
      setFiles([]);
      setCategories([]);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const share = useCallback(
    async (input: Omit<ShareToTeamInput, 'uploaderId'>) => {
      const result = await shareToTeam({ ...input, uploaderId: getCurrentFrontendUserId() });
      await reload();
      return result;
    },
    [reload]
  );

  const remove = useCallback(
    async (id: string) => {
      await removeShared(id);
      await reload();
    },
    [reload]
  );

  // Upload OS files dropped directly onto the shared library. Uses the current
  // category filter as the default tag so drops land where the user is looking.
  const addFiles = useCallback(
    async (selectedFiles: File[]) => {
      const uploaderId = getCurrentFrontendUserId();
      const label = categories.find((c) => c.key === category)?.label;
      await Promise.all(selectedFiles.map((file) => shareFileToTeam(file, label, uploaderId)));
      await reload();
    },
    [reload, categories, category]
  );

  return { files, categories, category, setCategory, loading, unavailable, reload, share, remove, addFiles };
}
