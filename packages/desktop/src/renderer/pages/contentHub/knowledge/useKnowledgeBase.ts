/**
 * useKnowledgeBase — loads the read-only document list from the local vector DB.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchAllKnowledgeDocs, type KnowledgeDoc } from './knowledgeApi';

export type KnowledgeState = {
  docs: KnowledgeDoc[];
  total: number;
  loading: boolean;
  error: boolean;
  reload: () => void;
};

export function useKnowledgeBase(): KnowledgeState {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchAllKnowledgeDocs()
      .then(({ total: t, docs: d }) => {
        if (cancelled) return;
        setDocs(d);
        setTotal(t);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { docs, total, loading, error, reload };
}
