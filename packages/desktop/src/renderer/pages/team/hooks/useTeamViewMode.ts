import { useCallback, useEffect, useState } from 'react';

export type TeamViewMode = 'split' | 'group';

const STORAGE_KEY = 'team-view-mode';
const DEFAULT_MODE: TeamViewMode = 'split';

type StoredMap = Record<string, TeamViewMode>;

function readStore(): StoredMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as StoredMap;
  } catch {
    // ignore malformed storage
  }
  return {};
}

function writeStore(map: StoredMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

/**
 * Per-team view mode preference, persisted in localStorage.
 *
 * - `split`: each agent gets its own column with its own send box (default, current behavior)
 * - `group`: shared broadcast send box at the bottom; per-column send boxes are hidden
 */
export function useTeamViewMode(team_id: string): {
  viewMode: TeamViewMode;
  setViewMode: (mode: TeamViewMode) => void;
} {
  const [viewMode, setViewModeState] = useState<TeamViewMode>(() => readStore()[team_id] ?? DEFAULT_MODE);

  useEffect(() => {
    setViewModeState(readStore()[team_id] ?? DEFAULT_MODE);
  }, [team_id]);

  const setViewMode = useCallback(
    (mode: TeamViewMode) => {
      setViewModeState(mode);
      const next = readStore();
      next[team_id] = mode;
      writeStore(next);
    },
    [team_id]
  );

  return { viewMode, setViewMode };
}
