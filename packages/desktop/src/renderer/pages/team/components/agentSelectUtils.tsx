import React from 'react';
import { Robot } from '@icon-park/react';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import { CUSTOM_AVATAR_IMAGE_MAP } from '@renderer/pages/guid/constants';
import { getAgentDisplayName, type AgentMetadata } from '@renderer/utils/model/agentTypes';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { resolveBackendAssetUrl } from '@renderer/utils/platform';

/**
 * Team leader selector entry — unified view over CLI agents and preset
 * assistants. Both sources share the dropdown but have different native
 * shapes; this type is what the dropdown code actually reads.
 */
export type TeamAgentOption = {
  id: string;
  name: string;
  /** Execution backend (claude, gemini, qwen, …). For assistants this is
   *  `preset_agent_type`; for CLI agents it's `backend`. */
  backend?: string;
  /** Icon / avatar token — an SVG filename, emoji, or key into
   *  `CUSTOM_AVATAR_IMAGE_MAP`. */
  icon?: string;
  /** Whether this agent supports team mode. Sourced from the backend's
   *  authoritative `behavior_policy.supports_team` (the top-level `team_capable`
   *  is uniformly true and non-discriminating, so it can't be used to gate). */
  team_capable?: boolean;
  /** Set for a "直连模型专家" — a specific provider model (e.g. SiliconFlow 国产模型)
   *  joined as an aionrs panelist. `backend` is `aionrs` and these two pin the model. */
  provider_id?: string;
  model_name?: string;
  /** True when this option is a direct provider model rather than a CLI-agent backend. */
  isModelExpert?: boolean;
};

export function cliAgentToOption(
  agent: AgentMetadata,
  assistant?: Pick<Assistant, 'id' | 'team_selectable'> | null
): TeamAgentOption {
  return {
    id: assistant?.id ?? agent.id,
    name: getAgentDisplayName(agent),
    backend: agent.backend || agent.agent_type,
    icon: agent.icon,
    // `behavior_policy.supports_team` is the real capability — agents that can't
    // be injected with the team-coordination MCP tools (e.g. OpenClaw, Hermes:
    // no MCP http/sse in their ACP handshake) report false here, while the
    // top-level `team_capable` stays true for everyone. Fall back to the
    // top-level flag only when the policy is absent (older/custom backends).
    team_capable:
      assistant === null
        ? false
        : (assistant?.team_selectable ?? agent.behavior_policy?.supports_team ?? agent.team_capable),
  };
}

export function assistantToOption(assistant: Assistant, teamCapableKeys?: Set<string>): TeamAgentOption {
  return {
    id: assistant.id,
    name: assistant.name,
    backend: assistant.preset_agent_type,
    icon: assistant.avatar,
    team_capable: teamCapableKeys ? teamCapableKeys.has(assistant.preset_agent_type) : undefined,
  };
}

export function agentKey(agent: TeamAgentOption): string {
  return agent.id;
}

export function agentFromKey(key: string, allAgents: TeamAgentOption[]): TeamAgentOption | undefined {
  return allAgents.find((a) => agentKey(a) === key);
}

export function resolveTeamAgentType(agent: TeamAgentOption | undefined, fallback: string): string {
  return agent?.backend || fallback;
}

/** Filter agents to only those supported in team mode */
export function filterTeamSupportedAgents(agents: TeamAgentOption[]): TeamAgentOption[] {
  return agents.filter((a) => a.team_capable);
}

export function resolveConversationType(
  backend: string
): 'acp' | 'aionrs' | 'codex' | 'openclaw-gateway' | 'nanobot' | 'remote' {
  if (backend === 'aionrs') return 'aionrs';
  if (backend === 'codex') return 'acp';
  if (backend === 'openclaw-gateway') return 'openclaw-gateway';
  if (backend === 'nanobot') return 'nanobot';
  if (backend === 'remote') return 'remote';
  return 'acp';
}

export const AgentOptionLabel: React.FC<{ agent: TeamAgentOption }> = ({ agent }) => {
  const displayName = getAgentDisplayName({ backend: agent.backend, name: agent.name });
  const logo = getAgentLogo(agent.backend);
  const avatarImage = agent.icon ? CUSTOM_AVATAR_IMAGE_MAP[agent.icon] : undefined;
  const directIcon =
    agent.icon &&
    !avatarImage &&
    (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(agent.icon) || /\.(svg|png|jpe?g|gif|webp)$/i.test(agent.icon))
      ? (resolveBackendAssetUrl(agent.icon) ?? agent.icon)
      : undefined;
  const isEmoji = Boolean(agent.icon && !avatarImage && !directIcon);
  return (
    <div className='flex items-center gap-8px min-w-0'>
      {avatarImage ? (
        <img
          src={avatarImage}
          alt={displayName}
          style={{ width: 16, height: 16, objectFit: 'contain' }}
          className='shrink-0'
        />
      ) : isEmoji ? (
        <span style={{ fontSize: 14, lineHeight: '16px' }} className='shrink-0'>
          {agent.icon}
        </span>
      ) : directIcon ? (
        <img
          src={directIcon}
          alt={displayName}
          style={{ width: 16, height: 16, objectFit: 'contain' }}
          className='shrink-0'
        />
      ) : logo ? (
        <img
          src={logo}
          alt={displayName}
          style={{ width: 16, height: 16, objectFit: 'contain' }}
          className='shrink-0'
        />
      ) : (
        <Robot size='16' className='shrink-0' />
      )}
      <span className='truncate'>{displayName}</span>
    </div>
  );
};
