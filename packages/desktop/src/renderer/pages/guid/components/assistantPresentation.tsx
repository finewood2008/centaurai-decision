/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Branch, Code, Components, FilePdf, FileWord, Picture, Ppt, Search, Table } from '@icon-park/react';
import type React from 'react';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { CUSTOM_AVATAR_IMAGE_MAP } from '../constants';

export type ResolvedAvatar = { kind: 'image'; src: string } | { kind: 'emoji'; value: string } | { kind: 'none' };

/** Resolve an assistant's avatar to an image src, an emoji glyph, or none. */
export function resolveAssistantAvatar(assistant: Pick<Assistant, 'avatar'>): ResolvedAvatar {
  const value = assistant.avatar?.trim();
  if (!value) return { kind: 'none' };
  const image = CUSTOM_AVATAR_IMAGE_MAP[value] || resolveExtensionAssetUrl(value) || undefined;
  const isImage = Boolean(
    image && (/\.(svg|png|jpe?g|webp|gif)$/i.test(image) || /^(https?:|file:\/\/|data:|\/)/i.test(image))
  );
  if (isImage) return { kind: 'image', src: image as string };
  return { kind: 'emoji', value };
}

type IconCmp = React.ComponentType<{ size?: number | string; theme?: string }>;

const SKILL_ICONS: Array<[RegExp, IconCmp]> = [
  [/ppt|slide|pitch|deck/i, Ppt],
  [/xlsx|excel|sheet|table|data|financial|dashboard/i, Table],
  [/pdf/i, FilePdf],
  [/docx?|word|paper|academic|form/i, FileWord],
  [/image|draw|picture|logo|avatar|poster|sticker|illustration|photo|design/i, Picture],
  [/mermaid|diagram|chart|flow|graph/i, Branch],
  [/search|web|browse/i, Search],
  [/code|python|script|repl|node/i, Code],
];

/** Pick a representative icon for a skill by keyword. */
export function skillIcon(name: string): IconCmp {
  for (const [re, Icon] of SKILL_ICONS) if (re.test(name)) return Icon;
  return Components;
}

/** Human-friendly skill label: strip internal prefixes/separators. */
export function prettifySkill(name: string): string {
  return (
    name
      .replace(/^auto-inject\//, '')
      .replace(/^(officecli|builtin|aionui|morph|star)-/i, '')
      .replace(/[-_]/g, ' ')
      .trim() || name
  );
}

/** All skill names an assistant brings (enabled + custom), de-duplicated. */
export function assistantSkills(assistant: Pick<Assistant, 'enabled_skills' | 'custom_skill_names'>): string[] {
  return Array.from(new Set([...(assistant.enabled_skills || []), ...(assistant.custom_skill_names || [])]));
}
