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
    prompt: '请集中补充关键约束',
    questions: ['你更看重哪个目标？', '预算上限是多少？', '最晚何时见效？'],
    options: [
      { id: 'growth', label: '增长' },
      { id: 'risk', label: '风险' },
      { id: 'cash', label: '现金流' },
    ],
  };

  it('renders multiple questions together in one response card', () => {
    render(<MeetingQuestionCard question={question} onAnswer={vi.fn()} />);

    expect(screen.getByText('你更看重哪个目标？')).toBeInTheDocument();
    expect(screen.getByText('预算上限是多少？')).toBeInTheDocument();
    expect(screen.getByText('最晚何时见效？')).toBeInTheDocument();
  });

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

  it('advances after each choice, allows going back, then submits all answers on the last card', () => {
    const onAnswer = vi.fn();
    const batchQuestion = {
      id: 'q-batch',
      prompt: '请集中确认以下事项',
      options: [],
      items: [
        {
          id: 'goal',
          prompt: '首要目标？',
          options: [
            { id: 'growth', label: '增长' },
            { id: 'profit', label: '利润' },
          ],
        },
        {
          id: 'budget',
          prompt: '预算范围？',
          options: [
            { id: 'low', label: '10 万内' },
            { id: 'high', label: '30 万内' },
          ],
        },
      ],
    };
    render(<MeetingQuestionCard question={batchQuestion} onAnswer={onAnswer} />);

    expect(screen.getByTestId('meeting-question-goal')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-question-budget')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('增长'));

    expect(screen.getByTestId('meeting-question-budget')).toBeInTheDocument();
    expect(screen.getByTestId('meeting-question-confirm')).toBeDisabled();
    fireEvent.click(screen.getByText('10 万内'));
    fireEvent.click(screen.getByTestId('meeting-question-back'));
    fireEvent.click(screen.getByText('利润'));

    expect(screen.getByTestId('meeting-question-budget')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('meeting-question-confirm'));

    expect(onAnswer).toHaveBeenCalledWith({
      selections: [
        { questionId: 'goal', optionId: 'profit' },
        { questionId: 'budget', optionId: 'low' },
      ],
      text: '',
    });
  });
});
