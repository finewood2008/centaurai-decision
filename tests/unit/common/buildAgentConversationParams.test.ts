/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getConversationTypeForBackend, normalizeAcpBackend } from '@/common/utils/buildAgentConversationParams';

describe('normalizeAcpBackend', () => {
  it('rewrites the legacy openclaw-gateway backend to openclaw', () => {
    expect(normalizeAcpBackend('openclaw-gateway')).toBe('openclaw');
  });

  it('passes through every other backend unchanged', () => {
    for (const b of ['openclaw', 'aionrs', 'gemini', 'codex', 'nanobot', 'remote']) {
      expect(normalizeAcpBackend(b)).toBe(b);
    }
  });
});

describe('getConversationTypeForBackend', () => {
  it('maps aionrs / nanobot / remote to their own conversation types', () => {
    expect(getConversationTypeForBackend('aionrs')).toBe('aionrs');
    expect(getConversationTypeForBackend('nanobot')).toBe('nanobot');
    expect(getConversationTypeForBackend('remote')).toBe('remote');
  });

  it('maps both openclaw and the legacy openclaw-gateway to acp', () => {
    expect(getConversationTypeForBackend('openclaw')).toBe('acp');
    expect(getConversationTypeForBackend('openclaw-gateway')).toBe('acp');
  });

  it('defaults unknown / builtin ACP backends (gemini, codex, claude) to acp', () => {
    for (const b of ['gemini', 'codex', 'claude', 'something-new']) {
      expect(getConversationTypeForBackend(b)).toBe('acp');
    }
  });
});
