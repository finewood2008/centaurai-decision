/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AionUI应用程序共用常量
 */

// ===== 文件处理相关常量 =====

/** 临时文件时间戳分隔符 */
export const AIONUI_TIMESTAMP_SEPARATOR = '_aionui_';

/** 用于匹配和清理时间戳后缀的正则表达式 */
export const AIONUI_TIMESTAMP_REGEX = /_aionui_\d{13}(\.\w+)?$/;
export const AIONUI_FILES_MARKER = '[[AION_FILES]]';

// ===== 媒体类型相关常量 =====

/** 支持的图片文件扩展名 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg'] as const;

/** 文件扩展名到MIME类型的映射 */
export const MIME_TYPE_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

/** MIME类型到文件扩展名的映射 */
export const MIME_TO_EXT_MAP: Record<string, string> = {
  jpeg: '.jpg',
  jpg: '.jpg',
  png: '.png',
  gif: '.gif',
  webp: '.webp',
  bmp: '.bmp',
  tiff: '.tiff',
  'svg+xml': '.svg',
};

/** 默认图片文件扩展名 */
export const DEFAULT_IMAGE_EXTENSION = '.png';

// ===== WebUI 相关常量 =====

/** WebUI default port: 25808 for production, 25809 for development, 25810 for multi-instance dev */
export const WEBUI_DEFAULT_PORT = (() => {
  if (process.env.NODE_ENV === 'production') return 25808;
  if (process.env.AIONUI_MULTI_INSTANCE === '1') return 25810;
  return 25809;
})();

// ===== Edition (build-time product variant) =====
//
// This core repo ships the FULL app. Two carved-down editions are produced by
// setting AIONUI_EDITION at build time; each is distributed from its own downstream
// repo that tracks this core (merges upstream/main for updates):
//   - 'full'     (DEFAULT): every feature on, multi-user — today's behavior. What
//                the core repo, `bun dev`, and a plain build produce. Inert flag.
//   - 'decision' (超级参谋团): single-user; core is 智囊团 (the multi-agent decision
//                room) reframed as a 决策作战室. No workbench, no multi-user WebUI.
//   - 'team'     (团队版): 智囊团 removed; core is office assistants + advisors +
//                workbench, with the multi-user WebUI / LAN server.
//
// `__EDITION__` is injected by electron.vite.config.ts `define` (BOTH the main and
// renderer blocks), sourced from the AIONUI_EDITION env at BUILD time — one
// build-time source of truth across processes. The `typeof` fallback only fires in
// non-bundled contexts (e.g. tsx scripts). Unset / unknown ⇒ 'full'.
export type Edition = 'full' | 'decision' | 'team';

declare const __EDITION__: string | undefined;

function normalizeEdition(value: string | undefined): Edition {
  return value === 'decision' || value === 'team' ? value : 'full';
}

const ENV_EDITION: Edition = normalizeEdition(typeof process !== 'undefined' ? process.env.AIONUI_EDITION : undefined);

export const EDITION: Edition = typeof __EDITION__ !== 'undefined' ? normalizeEdition(__EDITION__) : ENV_EDITION;
export const IS_DECISION = EDITION === 'decision';
export const IS_TEAM = EDITION === 'team';

// Capability flags — derived so feature gates never special-case all three editions.
// 'full' enables everything; each edition subtracts.
/** 智囊团 (multi-agent decision room): present in full + decision; removed in team. */
export const TEAM_MODE_ENABLED = EDITION !== 'team';
/** Workbench (office assistants + image studio): present in full + team; removed in decision. */
export const WORKBENCH_ENABLED = EDITION !== 'decision';
/**
 * Multiple USER ACCOUNTS (the Users settings tab + user-management CRUD): present
 * in full + team; decision stays single-user. NOTE: this is account management
 * only — it no longer gates remote connectivity (see REMOTE_ACCESS_ENABLED).
 */
export const MULTI_USER_ENABLED = EDITION !== 'decision';
/**
 * REMOTE ACCESS to the WebUI (LAN server bind + browser/native-client + Tailscale):
 * enabled in ALL editions. Decision is single-user but the owner still needs to
 * reach their own AI remotely — over the LAN and/or "from anywhere" via Tailscale.
 * Decoupled from MULTI_USER_ENABLED so decision can expose remotely WITHOUT also
 * turning on multi-account management. Remote exposure always requires the auth
 * gate (static-server `requireAuth = allowRemote`).
 */
export const REMOTE_ACCESS_ENABLED = true;
/** Office assistants (办公助理: word/ppt/excel/财务/学术/Mermaid…): present in full + team; removed in decision (experts/专家 stay). */
export const OFFICE_ASSISTANTS_ENABLED = EDITION !== 'decision';

// ===== AI Provider 相关常量 =====

// Stable ID for the Google Auth virtual provider.
// Shared between frontend (useModelProviderList) and backend (SystemActions).
export const GOOGLE_AUTH_PROVIDER_ID = 'google-auth-gemini';
