/**
 * viewConfig — size presets for the Content Hub presentation modes.
 *
 * Class strings are written as full literals (not concatenated) so UnoCSS can
 * statically detect and generate them.
 */
import type { HubCardSize } from '../../types';

/** Uniform-grid card metrics per size. */
export const GRID_SIZE: Record<HubCardSize, { card: string; thumb: string; emoji: string; name: string }> = {
  small: { card: 'w-92px px-6px py-10px', thumb: 'h-56px', emoji: 'text-32px', name: 'text-10px' },
  medium: { card: 'w-120px px-8px py-12px', thumb: 'h-72px', emoji: 'text-44px', name: 'text-11px' },
  large: { card: 'w-164px px-10px py-14px', thumb: 'h-116px', emoji: 'text-60px', name: 'text-13px' },
};

/** Masonry column width (px) per size — drives `column-width` on the waterfall container. */
export const WATERFALL_COL_WIDTH: Record<HubCardSize, number> = {
  small: 130,
  medium: 184,
  large: 248,
};

/** Fallback emoji size for non-image cards in the waterfall layout. */
export const WATERFALL_EMOJI: Record<HubCardSize, string> = {
  small: 'text-40px',
  medium: 'text-52px',
  large: 'text-64px',
};
