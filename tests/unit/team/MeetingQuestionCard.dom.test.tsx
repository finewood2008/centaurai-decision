/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeetingQuestionCard } from '@/renderer/pages/team/meeting/MeetingRoomView';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('@/renderer/services/i18n', () => ({
  default: { t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key },
}));

describe('MeetingQuestionCard', () => {
  const question = {
    id: 'q-1',
    prompt: '你更看重哪个目标？',
    options: [
      { id: 'growth', label: '增长' },
      { id: 'risk', label: '风险' },
      { id: 'cash', label: '现金流' },
    ],
  };

  it('submits a selected option together with optional detail after confirmation', () => {
    const onAnswer = vi.fn();
    render(<MeetingQuestionCard question={question} onAnswer={onAnswer} />);

    fireEvent.click(screen.getByText('风险'));
    fireEvent.change(screen.getByPlaceholderText(/直接输入/), { target: { value: '不能影响现金流' } });
    fireEvent.click(screen.getByTestId('meeting-question-confirm'));

    expect(onAnswer).toHaveBeenCalledWith({ optionId: 'risk', text: '不能影响现金流' });
  });

  it('accepts free-form input without selecting an option', () => {
    const onAnswer = vi.fn();
    render(<MeetingQuestionCard question={question} onAnswer={onAnswer} />);
    fireEvent.change(screen.getByPlaceholderText(/直接输入/), { target: { value: '先补充背景' } });
    fireEvent.click(screen.getByTestId('meeting-question-confirm'));

    expect(onAnswer).toHaveBeenCalledWith({ optionId: undefined, text: '先补充背景' });
  });

  it('keeps confirmation disabled when no answer is provided', () => {
    render(<MeetingQuestionCard question={question} onAnswer={vi.fn()} />);
    expect(screen.getByTestId('meeting-question-confirm')).toBeDisabled();
  });
});
