/**
 * useHubViewPrefs — remembers the Content Hub presentation mode (grid/waterfall)
 * and card size (small/medium/large) across sessions via localStorage.
 */
import { useCallback, useState } from 'react';
import type { HubCardSize, HubViewMode } from './types';

const VIEW_KEY = 'contentHub.viewMode';
const SIZE_KEY = 'contentHub.cardSize';

const isView = (v: string | null): v is HubViewMode => v === 'grid' || v === 'waterfall';
const isSize = (v: string | null): v is HubCardSize => v === 'small' || v === 'medium' || v === 'large';

export function useHubViewPrefs() {
  const [view, setViewState] = useState<HubViewMode>(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    return isView(saved) ? saved : 'grid';
  });
  const [size, setSizeState] = useState<HubCardSize>(() => {
    const saved = localStorage.getItem(SIZE_KEY);
    return isSize(saved) ? saved : 'medium';
  });

  const setView = useCallback((next: HubViewMode) => {
    setViewState(next);
    localStorage.setItem(VIEW_KEY, next);
  }, []);
  const setSize = useCallback((next: HubCardSize) => {
    setSizeState(next);
    localStorage.setItem(SIZE_KEY, next);
  }, []);

  return { view, size, setView, setSize };
}
