/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'settings.addModel': 'Add Model',
        'settings.localModels.title': 'Local Models',
      })[key] ?? key,
  }),
}));

import GuidProviderModelRow from '@/renderer/pages/guid/components/GuidProviderModelRow';

const provider = (id: string, overrides: Partial<IProvider> = {}): IProvider => ({
  id,
  platform: 'custom',
  name: id,
  base_url: `https://${id}.example.com/v1`,
  api_key: 'test-key',
  models: [`${id}-model`],
  ...overrides,
});

const renderRow = (
  modelList: IProvider[],
  current_model?: TProviderWithModel,
  setCurrentModel = vi.fn<(_: TProviderWithModel) => Promise<void>>().mockResolvedValue(undefined)
) => {
  const view = render(
    <GuidProviderModelRow modelList={modelList} current_model={current_model} setCurrentModel={setCurrentModel} />
  );
  return { ...view, setCurrentModel };
};

describe('GuidProviderModelRow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows every direct provider in configuration order', () => {
    renderRow([provider('gemini'), provider('deepseek'), provider('openai')]);
    const ids = screen.getAllByTestId(/^provider-model-/).map((element) => element.dataset.testid);
    expect(ids).toEqual(['provider-model-gemini', 'provider-model-deepseek', 'provider-model-openai']);
  });

  it('keeps the local-model entry last', () => {
    const { container } = renderRow([
      provider('ollama', { base_url: 'http://127.0.0.1:11434/v1', models: ['qwen2.5', 'llama3'] }),
      provider('deepseek'),
    ]);
    const buttons = container.querySelectorAll('button');
    expect(buttons.item(buttons.length - 1)).toHaveAttribute('data-testid', 'provider-model-local');
  });

  it('lets the user choose a concrete local model', async () => {
    const ollama = provider('ollama', {
      base_url: 'http://127.0.0.1:11434/v1',
      models: ['qwen2.5', 'llama3'],
    });
    const { setCurrentModel } = renderRow([ollama]);

    fireEvent.click(screen.getByTestId('provider-model-local'));
    fireEvent.click(await screen.findByText('llama3'));

    await waitFor(() => {
      expect(setCurrentModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'ollama', use_model: 'llama3' }));
    });
  });

  it('hides disabled providers and an unconfigured local entry', () => {
    renderRow([provider('disabled', { enabled: false }), provider('empty', { models: [] })]);
    expect(screen.queryByTestId('provider-model-disabled')).not.toBeInTheDocument();
    expect(screen.queryByTestId('provider-model-local')).not.toBeInTheDocument();
  });
});
