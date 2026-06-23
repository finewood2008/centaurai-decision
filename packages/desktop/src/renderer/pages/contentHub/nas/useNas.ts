/**
 * useNas — browses the enterprise LAN network drive (read-only, P1).
 *
 * Holds the current relative path, the listing for it, and navigation helpers.
 * `disabled` means the admin has not configured a shared disk; `unavailable`
 * means the WebUI server hosting /api/nas/* could not be reached.
 */
import { useCallback, useEffect, useState } from 'react';
import { listNas, type NasEntry } from '@/renderer/services/NasService';

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

  return { path, entries, loading, disabled, unavailable, navigate, refresh };
}
