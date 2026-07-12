/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MeetingPhaseBar from '@/renderer/pages/team/meeting/MeetingPhaseBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

describe('MeetingPhaseBar', () => {
  it('shows the sequential advisor-position milestone for new meetings', () => {
    render(<MeetingPhaseBar phase='running' form='roundtable' reachedLabels={['顾问立场']} turnsCompleted={1} />);

    expect(screen.getByText('顾问立场')).toBeInTheDocument();
    expect(screen.queryByText('并行立场')).not.toBeInTheDocument();
  });

  it('maps a historical parallel-position record to the current first milestone', () => {
    render(
      <MeetingPhaseBar phase='running' form='roundtable' reachedLabels={['并行立场', '交锋']} turnsCompleted={3} />
    );

    expect(screen.getByText('顾问立场')).toBeInTheDocument();
    expect(screen.getByText('交锋')).toBeInTheDocument();
  });
});
