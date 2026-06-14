/**
 * @license
 * Copyright 2025 CentaurAI (centaurai.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export function normalizeBrandText(text: string | undefined | null): string {
  if (!text) return '';
  return text
    .replace(/\bAionUi\b/g, 'CentaurAI')
    .replace(/\bAion UI\b/g, 'CentaurAI')
    .replace(/\bAion preview\b/g, 'CentaurAI preview')
    .replace(/Aion 预览/g, 'CentaurAI 预览')
    .replace(/Aion 預覽/g, 'CentaurAI 預覽')
    .replace(/\bAion users\b/g, 'CentaurAI users')
    .replace(/Aion 用户/g, 'CentaurAI 用户')
    .replace(/Aion 用戶/g, 'CentaurAI 用戶')
    .replace(/\bAion side\b/g, 'CentaurAI side')
    .replace(/Aion 侧/g, 'CentaurAI 侧')
    .replace(/Aion 側/g, 'CentaurAI 側')
    .replace(/\bAion\/OpenClaw\b/g, 'CentaurAI/OpenClaw')
    .replace(/\bOpenClaw \/ Aion\b/g, 'OpenClaw / CentaurAI');
}
