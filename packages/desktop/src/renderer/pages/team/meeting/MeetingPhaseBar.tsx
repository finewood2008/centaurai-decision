import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckOne, Loading, Trophy } from '@icon-park/react';
import type { MeetingPhase } from './meetingTypes';

type Props = {
  phase: MeetingPhase;
  turnsCompleted: number;
};

/** Compact status strip reflecting the backend team_run lifecycle. */
const MeetingPhaseBar: React.FC<Props> = ({ phase, turnsCompleted }) => {
  const { t } = useTranslation();

  const content = (() => {
    if (phase === 'running') {
      return (
        <>
          <Loading theme='outline' size='13' fill='var(--color-primary-6)' className='animate-spin' />
          <span className='text-[color:var(--color-primary-6)]'>
            {t('team.meeting.status.running', { defaultValue: '会议进行中' })}
          </span>
          {turnsCompleted > 0 && (
            <span className='text-[color:var(--color-text-3)]'>
              {t('team.meeting.status.turns', {
                count: turnsCompleted,
                defaultValue: `已完成 ${turnsCompleted} 段发言`,
              })}
            </span>
          )}
        </>
      );
    }
    if (phase === 'resolution') {
      return (
        <>
          <Trophy theme='outline' size='13' fill='var(--color-warning-6)' />
          <span className='text-[color:var(--color-text-2)]'>
            {t('team.meeting.status.resolution', { defaultValue: '讨论结束，请拍板' })}
          </span>
        </>
      );
    }
    return (
      <>
        <CheckOne theme='filled' size='13' fill='var(--color-success-6)' />
        <span className='text-[color:var(--color-text-2)]'>
          {t('team.meeting.status.decided', { defaultValue: '已拍板' })}
        </span>
      </>
    );
  })();

  return (
    <div
      data-testid='meeting-phase-bar'
      className='shrink-0 flex items-center gap-6px px-16px h-36px border-b border-solid border-[color:var(--border-base)] text-12px'
    >
      {content}
    </div>
  );
};

export default MeetingPhaseBar;
