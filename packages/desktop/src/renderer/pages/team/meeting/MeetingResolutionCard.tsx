import { Button } from '@arco-design/web-react';
import { CheckOne, Trophy } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MeetingResolutionOption } from './meetingTypes';
import styles from './MeetingResolutionCard.module.css';

type Props = {
  options: MeetingResolutionOption[];
  decidedOptionId: string | null;
  onDecide: (optionId: string) => void;
};

/**
 * Horizontal row of candidate solutions for the boss to pick from. The chosen
 * one gets an animated glowing frame; the others dim.
 */
const MeetingResolutionCard: React.FC<Props> = ({ options, decidedOptionId, onDecide }) => {
  const { t } = useTranslation();
  if (options.length === 0) return null;

  return (
    <div data-testid='meeting-resolution' className='flex flex-col gap-12px px-16px py-16px'>
      <div className='flex items-center gap-6px text-15px font-semibold text-[color:var(--color-text-1)]'>
        <Trophy theme='outline' size='18' fill='var(--color-primary-6)' />
        {t('team.meeting.resolution.title', { defaultValue: '候选方案 — 请老板拍板' })}
      </div>
      <div className='flex gap-16px overflow-x-auto pb-8px items-stretch [scrollbar-width:thin]'>
        {options.map((opt) => {
          const decided = opt.id === decidedOptionId;
          const dimmed = decidedOptionId !== null && !decided;
          return (
            <div
              key={opt.id}
              data-testid={`meeting-option-${opt.id}`}
              className={`flex flex-col gap-12px p-18px rd-14px border-2 border-solid shrink-0 w-340px ${styles.card} ${decided ? styles.selected : ''} ${dimmed ? styles.dimmed : ''} ${
                decided
                  ? 'bg-[color:var(--color-primary-light-1)]'
                  : 'border-[color:var(--border-base)] bg-[var(--color-bg-2)]'
              }`}
            >
              <div className='flex items-center gap-8px shrink-0'>
                {decided && <CheckOne theme='filled' size='20' fill='var(--color-primary-6)' className='shrink-0' />}
                <span className='text-17px font-semibold text-[color:var(--color-text-1)] leading-snug'>
                  {opt.title}
                </span>
              </div>
              <div className='flex-1 min-h-0 max-h-300px overflow-y-auto text-14px text-[color:var(--color-text-2)] whitespace-pre-wrap leading-relaxed [scrollbar-width:thin]'>
                {opt.body}
              </div>
              {decided ? (
                <div className='shrink-0 flex items-center justify-center gap-4px h-36px rd-8px text-14px font-medium text-[color:var(--color-primary-6)] bg-[color:var(--color-primary-light-2)]'>
                  <CheckOne theme='filled' size='16' fill='currentColor' />
                  {t('team.meeting.resolution.picked', { defaultValue: '已拍板' })}
                </div>
              ) : decidedOptionId === null ? (
                <Button
                  type='primary'
                  size='large'
                  long
                  onClick={() => onDecide(opt.id)}
                  data-testid={`meeting-decide-${opt.id}`}
                >
                  {t('team.meeting.resolution.pick', { defaultValue: '就选这个' })}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MeetingResolutionCard;
