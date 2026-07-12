import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loading } from '@icon-park/react';
import type { MeetingForm, MeetingPhase } from './meetingTypes';
import { IS_DECISION } from '@/common/config/constants';

/**
 * One stage in the meeting flow. `key` matches the turn's `phaseLabel` (Chinese,
 * assigned by the orchestrator) so we can detect which stages have been reached;
 * the display label is i18n'd (missing keys fall back to the Chinese default).
 * `__decision__` is virtual (driven by phase, not a turn).
 */
type Stage = { key: string; i18nKey: string; zh: string };
const S = (key: string, i18nKey: string, zh: string): Stage => ({ key, i18nKey, zh });

// New meetings use sequential advisor positions. Historical `并行立场` turns remain
// renderable in MeetingRoomView; the phase bar describes the current meeting strategy.
const POSITION = S('顾问立场', 'team.meeting.stage.position', '顾问立场');
const SYNTH = S('综合', 'team.meeting.stage.synthesis', '综合');
const DECISION = S('__decision__', 'team.meeting.stage.decision', '拍板');

/** The user-facing milestones per discussion format (mirrors runMeeting's phases). */
const STAGES_BY_FORM: Record<MeetingForm, Stage[]> = {
  roundtable: [POSITION, S('交锋', 'team.meeting.stage.debate', '交锋'), SYNTH, DECISION],
  redteam: [POSITION, S('红队猛攻', 'team.meeting.stage.redteamAttack', '红队猛攻'), SYNTH, DECISION],
  tournament: [POSITION, S('互评', 'team.meeting.stage.crossreview', '互评'), SYNTH, DECISION],
  diverge: [POSITION, S('收敛', 'team.meeting.stage.converge', '收敛'), SYNTH, DECISION],
  deepdive: [POSITION, S('追问', 'team.meeting.stage.probe', '追问'), SYNTH, DECISION],
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
 * (顾问立场 → 交锋 → 综合 → 拍板), so the boss can read the room at a glance.
 * Deliberately slim — the transcript below is the hero.
 */
const MeetingPhaseBar: React.FC<Props> = ({ phase, form, reachedLabels, turnsCompleted }) => {
  const { t } = useTranslation();
  const stages = STAGES_BY_FORM[form] ?? STAGES_BY_FORM.roundtable;
  const reached = new Set(reachedLabels);
  // Old persisted meetings used `并行立场`; map it to the new first milestone.
  if (reached.has('并行立场')) reached.add('顾问立场');

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
      className='shrink-0 flex items-center gap-1px px-20px h-44px border-t border-solid border-[color:var(--border-light)] overflow-x-auto [scrollbar-width:none]'
      style={{ background: 'color-mix(in srgb, var(--bg-1) 78%, transparent)', backdropFilter: 'blur(6px)' }}
    >
      {stages.map((s, i) => {
        const done = decided || i < current;
        const active = !decided && i === current;
        const stageName = s.i18nKey.replace('team.meeting.stage.', '');
        const label = IS_DECISION
          ? t(`decision.stage.${stageName}`, { defaultValue: t(s.i18nKey, { defaultValue: s.zh }) })
          : t(s.i18nKey, { defaultValue: s.zh });
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
              {label}
            </span>
          </React.Fragment>
        );
      })}
      <div className='flex-1 min-w-12px' />
      {phase === 'running' && turnsCompleted > 0 && (
        <span className='shrink-0 text-11px text-[color:var(--bg-6)]'>
          {t(IS_DECISION ? 'decision.room.turns' : 'team.meeting.status.turns', {
            count: turnsCompleted,
            defaultValue: `已完成 ${turnsCompleted} 段发言`,
          })}
        </span>
      )}
      {phase === 'resolution' && (
        <span className='shrink-0 text-12px font-medium text-[color:var(--accent-gold-deep)]'>
          {t(IS_DECISION ? 'decision.room.resolutionStatus' : 'team.meeting.status.resolution', {
            defaultValue: '讨论结束，请拍板',
          })}
        </span>
      )}
    </div>
  );
};

export default MeetingPhaseBar;
