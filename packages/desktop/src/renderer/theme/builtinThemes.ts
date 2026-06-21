/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Theme } from '@/common/theme/types';
import { LIGHT_THEME_ID, DARK_THEME_ID, PAPER_THEME_ID } from '@/common/theme/constants';

const T0 = 0;

/**
 * 素白 Clean White = the original AionUi color scheme (neutral white/gray
 * surfaces + arcoblue #165DFF primary), restored via the `tokens` channel since
 * the base `:root` is now the warm domain. This includes resetting the Arco
 * primary ramp back to arcoblue, neutralizing the brand gold/green accents, and
 * dropping the brand font back to the system stack — so it reads as a clean,
 * cool, neutral theme clearly distinct from 暖米.
 */
const CLEAN_WHITE_TOKENS: Record<string, string> = {
  // Fonts → system (no brand font)
  '--app-font-sans':
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
  // AOU ramp → original blue-gray
  '--aou-1': '#eff0f6',
  '--aou-2': '#e5e7f0',
  '--aou-3': '#d1d5e5',
  '--aou-4': '#b5bcd6',
  '--aou-5': '#97a0c5',
  '--aou-6': '#7583b2',
  '--aou-7': '#596590',
  '--aou-8': '#3f4868',
  '--aou-9': '#262c41',
  '--aou-10': '#0d101c',
  // Backgrounds → white / cool gray
  '--bg-base': '#ffffff',
  '--bg-1': '#f9fafb',
  '--bg-2': '#f2f3f5',
  '--bg-3': '#e5e6eb',
  '--bg-4': '#c9cdd4',
  '--bg-5': '#adb4c1',
  '--bg-6': '#86909c',
  '--bg-8': '#4e5969',
  '--bg-9': '#1d2129',
  '--bg-10': '#0c0e12',
  '--bg-hover': '#f3f4f6',
  '--bg-active': '#e5e6eb',
  // Text → black / slate
  '--text-primary': '#000000',
  '--color-text-1': '#000000',
  '--text-secondary': '#454d5f',
  '--color-text-2': '#454d5f',
  '--color-text-3': '#86909c',
  '--color-text-4': '#c9cdd4',
  '--text-disabled': '#c9cdd4',
  // Semantic → original
  '--primary': '#165dff',
  '--success': '#00b42a',
  '--warning': '#ff7d00',
  '--danger': '#f53f3f',
  '--info': '#165dff',
  // Arco primary ramp → arcoblue
  '--primary-1': '232, 243, 255',
  '--primary-2': '190, 218, 255',
  '--primary-3': '148, 191, 255',
  '--primary-4': '106, 161, 255',
  '--primary-5': '64, 128, 255',
  '--primary-6': '22, 93, 255',
  '--primary-7': '14, 66, 210',
  '--primary-8': '7, 44, 166',
  '--primary-9': '3, 26, 123',
  '--primary-10': '0, 13, 82',
  '--color-primary-light-1': '#e8f3ff',
  '--color-primary-light-2': '#bedaff',
  '--color-primary-light-3': '#94bfff',
  '--color-primary-light-4': '#6aa1ff',
  // Borders
  '--border-base': '#e5e6eb',
  '--border-light': '#f2f3f5',
  // Brand → original blue-gray
  '--brand': '#7583b2',
  '--brand-light': '#eff0f6',
  '--brand-hover': '#b5bcd6',
  // Neutralize brand accents (no gold/clay in 素白)
  '--accent-gold': '#4080ff',
  '--accent-gold-deep': '#165dff',
  '--accent-gold-tint': '#e8f3ff',
  '--accent-green-tint': '#e8f8ec',
  // Messages / fills / special → original
  '--message-user-bg': '#e9efff',
  '--message-tips-bg': '#f0f4ff',
  '--workspace-btn-bg': '#eff0f1',
  '--fill': '#f7f8fa',
  '--fill-0': '#ffffff',
  '--dialog-fill-0': '#ffffff',
  '--fill-white-to-black': '#ffffff',
  '--border-special': '#e5e6eb',
  '--color-guid-agent-bar': '#eaecf7',
};

/**
 * 3 core themes. 暖米 (default) and 墨夜 carry no tokens — they ARE the base
 * `:root` / `:root[data-theme='dark']` palettes in default-color-scheme.css.
 * Users can still add custom CSS themes via Appearance settings (advanced).
 */
export const BUILTIN_THEMES: Theme[] = [
  {
    id: LIGHT_THEME_ID,
    name: '暖米 Warm Cream',
    appearance: 'light',
    builtin: true,
    created_at: T0,
    updated_at: T0,
  },
  {
    id: PAPER_THEME_ID,
    name: '素白 Clean White',
    appearance: 'light',
    tokens: CLEAN_WHITE_TOKENS,
    builtin: true,
    created_at: T0,
    updated_at: T0,
  },
  {
    id: DARK_THEME_ID,
    name: '墨夜 Tech Dark',
    appearance: 'dark',
    builtin: true,
    created_at: T0,
    updated_at: T0,
  },
];

export const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));
