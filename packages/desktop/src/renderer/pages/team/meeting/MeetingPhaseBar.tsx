import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loading } from '@icon-park/react';
import type { MeetingForm, MeetingPhase } from './meetingTypes';

/**
 * One stage in the meeting flow. `key` matches the turn's `phaseLabel` (Chinese,
 * assigned by the orchestrator) so we can detect which stages have been reached;
 * the display label is i18n'd. `__decision__` is virtual (driven by phase, not a turn).
 */
type Stage = { key: string; i18nKey: string; zh: string };
const S = (key: string, i18nKey: string, zh: string): Stage => ({ key, i18nKey, zh });

const OPENING = S('开场', 'team.meeting.stage.opening', '开场');
const SYNTH = S('综合', 'team.meeting.stage.synthesis', '综合');
const DECISION = S('__decision__', 'team.meeting.stage.decision', '拍板');

/** The user-facing milestones per discussion format (mirrors runMeeting's phases). */
const STAGES_BY_FORM: Record<MeetingForm, Stage[]> = {
  roundtable: [
    OPENING,
    S('立论', 'team.meeting.stage.position', '立论'),
    S('交锋', 'team.meeting.stage.debate', '交锋'),
    SYNTH,
    DECISION,
  ],
  redteam: [
    OPENING,
    S('起草', 'team.meeting.stage.draft', '起草'),
    S('红队', 'team.meeting.stage.redteam', '红队'),
    S('修订', 'team.meeting.stage.revise', '修订'),
    SYNTH,
    DECISION,
  ],
  tournament: [OPENING, S('提案', 'team.meeting.stage.proposal', '提案'), SYNTH, DECISION],
  diverge: [
    OPENING,
    S('发散', 'team.meeting.stage.diverge', '发散'),
    S('收敛', 'team.meeting.stage.converge', '收敛'),
    SYNTH,
    DECISION,
  ],
};

type Props = {
  phase: MeetingPhase;
  form: MeetingForm;
  /** Distinct phaseLabels seen in the transcript so far (drives stage progress). */
  reachedLabels: string[];
  turnsCompleted: number;
};

/**
 * Compact one-row stage tracker: shows where the meeting IS and what's NEXT
 * (开场 → 研讨阶段 → 综合 → 拍板), so the boss can read the room at a glance.
 * Deliberately slim — the transcript below is the hero.
 */
const MeetingPhaseBar: React.FC<Props> = ({ phase, form, reachedLabels, turnsCompleted }) => {
  const { t } = useTranslation();
  const stages = STAGES_BY_FORM[form] ?? STAGES_BY_FORM.roundtable;
  const reached = new Set(reachedLabels);

  let current = 0;
  stages.forEach((s, i) => {
    if (reached.has(s.key)) current = i;
  });
  // 拍板 (decision) is the last stage — active once options are on the table.
  if (phase === 'resolution' || phase === 'decided') current = stages.length - 1;
  const decided = phase === 'decided';

  return (
    <div
      data-testid='meeting-phase-bar'
      className='shrink-0 flex items-center gap-1px px-20px h-46px border-b border-solid border-[color:var(--border-light)] overflow-x-auto [scrollbar-width:none]'
    >
      {stages.map((s, i) => {
        const done = decided || i < current;
        const active = !decided && i === current;
        return (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <span
                className={`shrink-0 w-14px h-1px ${i <= current ? 'bg-[color:var(--color-primary-light-3)]' : 'bg-[color:var(--border-base)]'}`}
              />
            )}
            <span
              className={`shrink-0 flex items-center gap-5px pl-5px pr-9px h-28px rd-full text-12px transition-colors ${
                active
                  ? 'bg-[var(--color-primary-light-1)] text-[color:var(--primary)] font-medium'
                  : done
                    ? 'text-[color:var(--primary)]'
                    : 'text-[color:var(--bg-6)]'
              }`}
            >
              <span
                className={`w-18px h-18px rd-full flex items-center justify-center text-10px leading-none shrink-0 ${
                  active
                    ? 'bg-[var(--primary)] text-white'
                    : done
                      ? 'bg-[color:var(--color-primary-light-2)] text-[color:var(--primary)]'
                      : 'bg-[var(--bg-2)] text-[color:var(--bg-6)]'
                }`}
              >
                {done ? (
                  <Check theme='outline' size='11' fill='currentColor' />
                ) : active && phase === 'running' ? (
                  <Loading theme='outline' size='11' fill='currentColor' className='animate-spin' />
                ) : (
                  i + 1
                )}
              </span>
              {t(s.i18nKey, { defaultValue: s.zh })}
            </span>
          </React.Fragment>
        );
      })}
      <div className='flex-1 min-w-12px' />
      {phase === 'running' && turnsCompleted > 0 && (
        <span className='shrink-0 text-11px text-[color:var(--bg-6)]'>
          {t('team.meeting.status.turns', { count: turnsCompleted, defaultValue: `已完成 ${turnsCompleted} 段发言` })}
        </span>
      )}
      {phase === 'resolution' && (
        <span className='shrink-0 text-12px font-medium text-[color:var(--accent-gold-deep)]'>
          {t('team.meeting.status.resolution', { defaultValue: '讨论结束，请拍板' })}
        </span>
      )}
    </div>
  );
};

export default MeetingPhaseBar;
