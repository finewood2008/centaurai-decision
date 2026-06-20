import React from 'react';
import { useTranslation } from 'react-i18next';
import { Peoples } from '@icon-park/react';
import type { TeamAgent } from '@/common/types/team/teamTypes';
import { resolveAgentLogo } from '@renderer/utils/model/agentLogo';

type Props = {
  agents: TeamAgent[];
  /** Diameter of each avatar circle, px. */
  size?: number;
  /** Max avatars to show before collapsing the rest into a +N chip. */
  max?: number;
  className?: string;
};

type ResolvedAgent = { key: string; name: string; initial: string; logo: string | null };

/** First visible character for the letter fallback. */
function initialOf(agent: TeamAgent): string {
  const s = (agent.agent_name || agent.agent_type || '?').trim();
  return s.charAt(0).toUpperCase();
}

/**
 * Overlapping circular avatars of a roundtable's agent panel — the topic-centric
 * board's icon. Leader first, then teammates, then a "+N" chip for overflow.
 *
 * Logo resolution is synchronous and memoized (resolveAgentLogo on agent_type/icon,
 * NOT the conversation) so the sider stays cheap and renders even while a fresh
 * team's conversation_ids are still warming up.
 */
const StackedAgentAvatars: React.FC<Props> = ({ agents, size = 16, max = 3, className }) => {
  const { t } = useTranslation();
  // A logo that 404s falls back to the letter initial (per-key, render-local).
  const [failed, setFailed] = React.useState<Record<string, boolean>>({});

  const ordered = React.useMemo<ResolvedAgent[]>(() => {
    const leaders = agents.filter((a) => a.role === 'leader');
    const rest = agents.filter((a) => a.role !== 'leader');
    return [...leaders, ...rest].map((a, i) => ({
      key: a.slot_id || `${a.agent_type}-${i}`,
      name: a.agent_name,
      initial: initialOf(a),
      logo: resolveAgentLogo({
        icon: a.icon,
        backend: a.agent_type,
        custom_agent_id: a.custom_agent_id,
        isExtension: Boolean(a.custom_agent_id?.startsWith('ext:')),
      }),
    }));
  }, [agents]);

  if (ordered.length === 0) {
    return (
      <span
        title={t('team.noAgents', { defaultValue: '无成员' })}
        className={`inline-flex items-center justify-center shrink-0 rd-full bg-[var(--fill-2)] text-[color:var(--color-text-3)] ${className ?? ''}`}
        style={{ width: size, height: size, lineHeight: 0 }}
      >
        <Peoples theme='outline' size={Math.round(size * 0.66)} fill='currentColor' />
      </span>
    );
  }

  const shown = ordered.slice(0, max);
  const overflow = ordered.length - shown.length;
  const overlap = Math.round(size / 3);
  const ring = '0 0 0 1.5px var(--color-bg-2)';

  return (
    <span className={`inline-flex items-center shrink-0 ${className ?? ''}`} style={{ lineHeight: 0 }}>
      {shown.map((a, i) => {
        const common: React.CSSProperties = {
          width: size,
          height: size,
          marginLeft: i === 0 ? 0 : -overlap,
          boxShadow: ring,
          zIndex: shown.length - i,
        };
        const showLetter = !a.logo || failed[a.key];
        return showLetter ? (
          <span
            key={a.key}
            title={a.name}
            className='inline-flex items-center justify-center rd-full bg-[var(--fill-3)] text-[color:var(--color-text-2)] font-medium'
            style={{ ...common, fontSize: Math.round(size * 0.5) }}
          >
            {a.initial}
          </span>
        ) : (
          <img
            key={a.key}
            src={a.logo ?? undefined}
            alt={a.name}
            title={a.name}
            onError={() => setFailed((prev) => (prev[a.key] ? prev : { ...prev, [a.key]: true }))}
            className='rd-full object-contain bg-[var(--color-bg-2)] block'
            style={common}
          />
        );
      })}
      {overflow > 0 && (
        <span
          title={t('team.moreAgents', { count: overflow, defaultValue: `还有 ${overflow} 位` })}
          className='inline-flex items-center justify-center rd-full bg-[var(--fill-2)] text-[color:var(--color-text-3)] font-medium'
          style={{
            width: size,
            height: size,
            marginLeft: -overlap,
            boxShadow: ring,
            fontSize: Math.round(size * 0.42),
          }}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
};

export default StackedAgentAvatars;
