import { Tooltip } from '@arco-design/web-react';
import { Link, LinkBreak } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTeamSharedContext } from '../hooks/useTeamSharedContext';

/**
 * Toggle for Phase 3 cross-agent visibility. When ON, each agent's reply to a
 * user broadcast is forwarded to all other team members as a teammate
 * message — they "hear" each other and can react.
 *
 * Hidden when no team shared-context provider is mounted (e.g. when rendered
 * outside a team page).
 */
const TeamSharedContextSwitch: React.FC = () => {
  const { t } = useTranslation();
  const ctx = useTeamSharedContext();
  if (!ctx) return null;

  const { enabled, setEnabled } = ctx;
  const title = enabled
    ? t('team.sharedContext.on', { defaultValue: 'Shared context: ON (agents hear each other)' })
    : t('team.sharedContext.off', { defaultValue: 'Shared context: OFF (agents are isolated)' });

  return (
    <Tooltip content={title} mini>
      <button
        type='button'
        data-testid='team-shared-context-switch'
        aria-pressed={enabled}
        aria-label={title}
        onClick={() => setEnabled(!enabled)}
        className={`flex items-center justify-center w-28px h-24px rd-4px cursor-pointer transition-colors border-none ${
          enabled
            ? 'bg-[color:var(--color-primary-light-1)] text-[color:var(--color-primary-6)]'
            : 'bg-transparent text-[color:var(--color-text-3)] hover:bg-[var(--fill-2)] hover:text-[color:var(--color-text-2)]'
        }`}
        style={{ lineHeight: 0 }}
      >
        {enabled ? (
          <Link theme='outline' size='14' fill='currentColor' />
        ) : (
          <LinkBreak theme='outline' size='14' fill='currentColor' />
        )}
      </button>
    </Tooltip>
  );
};

export default TeamSharedContextSwitch;
