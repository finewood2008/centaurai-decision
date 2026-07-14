/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isLocalOllamaUrl } from '@/renderer/utils/model/localModelProvider';
import { describe, expect, it } from 'vitest';

describe('isLocalOllamaUrl', () => {
  it.each(['http://127.0.0.1:11434/v1', 'http://localhost:11434', 'localhost:11434/v1'])(
    'recognizes local Ollama endpoint %s',
    (url) => {
      expect(isLocalOllamaUrl(url)).toBe(true);
    }
  );

  it.each([undefined, '', 'not a url', 'https://ollama.example.com:11434/v1', 'http://127.0.0.1:11435/v1'])(
    'rejects non-local endpoint %s',
    (url) => {
      expect(isLocalOllamaUrl(url)).toBe(false);
    }
  );
});
