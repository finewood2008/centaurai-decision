/**
 * useNas — browses and mutates the enterprise LAN network drive.
 *
 * Holds the current relative path, the listing for it, and navigation +
 * mutation helpers (P2). `disabled` means the admin has not configured a shared
 * disk; `unavailable` means the WebUI server hosting /api/nas/* was unreachable.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  createNasFolder,
  listNas,
  moveNasEntry,
  removeNasEntry,
  uploadNasFiles,
  type NasEntry,
} from '@/renderer/services/NasService';

export function useNas() {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<NasEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    // Drop the previous folder's rows immediately so navigation shows the
    // loading state rather than stale (clickable) rows from the old directory.
    setEntries([]);
    try {
      const { listing, disabled: isDisabled } = await listNas(target);
      setEntries(listing.entries);
      setPath(listing.path);
      setDisabled(isDisabled);
      setUnavailable(false);
    } catch {
      setEntries([]);
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const navigate = useCallback(
    (relPath: string) => {
      void load(relPath);
    },
    [load]
  );

  const refresh = useCallback(() => {
    void load(path);
  }, [load, path]);

  const join = useCallback((name: string) => (path ? `${path}/${name}` : name), [path]);

  const mkdir = useCallback(
    async (name: string) => {
      await createNasFolder(path, name);
      await load(path);
    },
    [load, path]
  );

  const upload = useCallback(
    async (files: File[]) => {
      await uploadNasFiles(path, files);
      await load(path);
    },
    [load, path]
  );

  const remove = useCallback(
    async (entry: NasEntry) => {
      await removeNasEntry(entry.relPath);
      await load(path);
    },
    [load, path]
  );

  const rename = useCallback(
    async (entry: NasEntry, newName: string) => {
      await moveNasEntry(entry.relPath, join(newName));
      await load(path);
    },
    [load, path, join]
  );

  return { path, entries, loading, disabled, unavailable, navigate, refresh, mkdir, upload, remove, rename };
}
