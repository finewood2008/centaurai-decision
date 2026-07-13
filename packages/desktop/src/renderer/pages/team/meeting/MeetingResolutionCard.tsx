import { Button } from '@arco-design/web-react';
import { CheckOne, Trophy } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MeetingResolutionOption } from './meetingTypes';
import styles from './MeetingResolutionCard.module.css';
import { IS_DECISION } from '@/common/config/constants';

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
    <div data-testid='meeting-resolution' className='flex flex-col gap-14px px-2px py-8px'>
      <div className='flex items-center gap-8px'>
        <Trophy theme='outline' size='18' fill='var(--accent-gold-deep)' />
        <span className='centaur-title centaur-title-md'>
          {t(IS_DECISION ? 'decision.resolution.title' : 'team.meeting.resolution.title', {
            defaultValue: '候选方案 — 请老板拍板',
          })}
        </span>
        {IS_DECISION && (
          <span className='ml-auto text-12px text-[color:var(--bg-6)]'>
            {t('decision.resolution.subtitle', {
              count: options.length,
              defaultValue: `${options.length} 个方案待选择`,
            })}
          </span>
        )}
      </div>
      <div className='flex gap-16px overflow-x-auto pb-8px items-stretch [scrollbar-width:thin]'>
        {options.map((opt) => {
          const decided = opt.id === decidedOptionId;
          const dimmed = decidedOptionId !== null && !decided;
          return (
            <div
              key={opt.id}
              data-testid={`meeting-option-${opt.id}`}
              className={`flex flex-col gap-14px p-20px rd-8px border border-solid shrink-0 w-340px ${styles.card} ${decided ? styles.selected : ''} ${dimmed ? styles.dimmed : ''} ${
                decided
                  ? 'bg-[color:var(--color-primary-light-1)]'
                  : 'border-[color:var(--border-light)] bg-[var(--bg-1)]'
              }`}
            >
              <div className='flex items-center gap-8px shrink-0'>
                {decided && <CheckOne theme='filled' size='20' fill='var(--primary)' className='shrink-0' />}
                <span className='centaur-title centaur-title-md leading-snug'>{opt.title}</span>
              </div>
              {IS_DECISION && (
                <div className={styles.optionMeta}>
                  {t(decided ? 'decision.resolution.chosenMeta' : 'decision.resolution.optionMeta', {
                    defaultValue: decided ? '此方案已按你的决定进入归档' : '请权衡收益、代价与执行节奏',
                  })}
                </div>
              )}
              <div className='flex-1 min-h-0 max-h-300px overflow-y-auto text-15px text-[color:var(--text-secondary)] whitespace-pre-wrap leading-[1.7] [scrollbar-width:thin]'>
                {opt.body}
              </div>
              {decided ? (
                <div className='shrink-0 flex items-center justify-center gap-4px h-38px rd-full text-14px font-medium text-[color:var(--primary)] bg-[color:var(--color-primary-light-2)]'>
                  <CheckOne theme='filled' size='16' fill='currentColor' />
                  {t(IS_DECISION ? 'decision.resolution.picked' : 'team.meeting.resolution.picked', {
                    defaultValue: '已拍板',
                  })}
                </div>
              ) : decidedOptionId === null ? (
                <Button
                  type='primary'
                  size='large'
                  shape='round'
                  long
                  onClick={() => onDecide(opt.id)}
                  data-testid={`meeting-decide-${opt.id}`}
                >
                  {t(IS_DECISION ? 'decision.resolution.pick' : 'team.meeting.resolution.pick', {
                    defaultValue: '就选这个',
                  })}
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
