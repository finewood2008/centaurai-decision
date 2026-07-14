/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** OpenAI-compatible endpoint exposed by the local Ollama daemon. */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';

/** Whether a provider URL points to the supported local Ollama endpoint. */
export const isLocalOllamaUrl = (baseUrl?: string): boolean => {
  const value = baseUrl?.trim();
  if (!value) return false;

  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    const hostname = url.hostname.toLowerCase();
    return (hostname === '127.0.0.1' || hostname === 'localhost') && url.port === '11434';
  } catch {
    return false;
  }
};
