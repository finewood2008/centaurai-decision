/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Slot = 'morning' | 'afternoon' | 'evening' | 'night';

function resolveSlot(hour: number): Slot {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

export interface TimeGreetingOptions {
  username?: string | null;
}

export function useTimeGreeting({ username }: TimeGreetingOptions = {}): string {
  const { t } = useTranslation();
  const [slot, setSlot] = useState<Slot>(() => resolveSlot(new Date().getHours()));

  useEffect(() => {
    const tick = () => setSlot(resolveSlot(new Date().getHours()));
    const interval = window.setInterval(tick, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const base = t(`guid.greeting.${slot}`, {
    defaultValue: {
      morning: 'Good morning',
      afternoon: 'Good afternoon',
      evening: 'Good evening',
      night: 'Working late',
    }[slot],
  });

  return username ? `${base}, ${username}` : base;
}
