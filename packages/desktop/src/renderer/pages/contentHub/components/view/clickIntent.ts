import { useCallback, useEffect, useRef } from 'react';

export const SINGLE_CLICK_DELAY_MS = 240;

export function useSingleDoubleClick<T>(
  onSingleClick: (item: T) => void,
  onDoubleClick?: (item: T) => void
): {
  handleClick: (item: T) => void;
  handleDoubleClick: (item: T) => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingClick = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clearPendingClick, [clearPendingClick]);

  const handleClick = useCallback(
    (item: T) => {
      clearPendingClick();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSingleClick(item);
      }, SINGLE_CLICK_DELAY_MS);
    },
    [clearPendingClick, onSingleClick]
  );

  const handleDoubleClick = useCallback(
    (item: T) => {
      clearPendingClick();
      if (onDoubleClick) onDoubleClick(item);
      else onSingleClick(item);
    },
    [clearPendingClick, onDoubleClick, onSingleClick]
  );

  return { handleClick, handleDoubleClick };
}
