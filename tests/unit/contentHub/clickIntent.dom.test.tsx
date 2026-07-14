import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SINGLE_CLICK_DELAY_MS, useSingleDoubleClick } from '@/renderer/pages/contentHub/components/view/clickIntent';

afterEach(() => vi.useRealTimers());

describe('useSingleDoubleClick', () => {
  it('delays a single click before previewing', () => {
    vi.useFakeTimers();
    const preview = vi.fn();
    const open = vi.fn();
    const { result } = renderHook(() => useSingleDoubleClick(preview, open));

    act(() => result.current.handleClick('report.pdf'));
    act(() => vi.advanceTimersByTime(SINGLE_CLICK_DELAY_MS - 1));
    expect(preview).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(preview).toHaveBeenCalledWith('report.pdf');
    expect(open).not.toHaveBeenCalled();
  });

  it('cancels a pending preview on double click', () => {
    vi.useFakeTimers();
    const preview = vi.fn();
    const open = vi.fn();
    const { result } = renderHook(() => useSingleDoubleClick(preview, open));

    act(() => {
      result.current.handleClick('report.pdf');
      result.current.handleDoubleClick('report.pdf');
      vi.runAllTimers();
    });
    expect(open).toHaveBeenCalledWith('report.pdf');
    expect(preview).not.toHaveBeenCalled();
  });

  it('uses the single-click action when no double-click action exists', () => {
    vi.useFakeTimers();
    const preview = vi.fn();
    const { result } = renderHook(() => useSingleDoubleClick(preview));

    act(() => result.current.handleDoubleClick('report.pdf'));
    expect(preview).toHaveBeenCalledWith('report.pdf');
  });

  it('clears a pending click when unmounted', () => {
    vi.useFakeTimers();
    const preview = vi.fn();
    const { result, unmount } = renderHook(() => useSingleDoubleClick(preview));
    act(() => result.current.handleClick('report.pdf'));
    unmount();
    act(() => vi.runAllTimers());
    expect(preview).not.toHaveBeenCalled();
  });
});
