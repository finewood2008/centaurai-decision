/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { STORAGE_KEYS } from '@/common/config/storageKeys';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';

const BUILTIN_DISABLED_AGENT_FALLBACKS: AgentMetadata[] = [
  {
    id: '2d23ff1c',
    icon: '/api/assets/logos/ai-major/claude.svg',
    name: 'Claude Code',
    backend: 'claude',
    agent_type: 'acp',
    agent_source: 'builtin',
    agent_source_info: { binary_name: 'claude' },
    enabled: false,
    available: false,
    native_skills_dirs: ['.claude/skills'],
    behavior_policy: {
      supports_side_question: true,
      supports_team: true,
    },
    yolo_id: 'bypassPermissions',
    team_capable: true,
    handshake: {},
  },
  {
    id: 'f9f61666',
    icon: '/api/assets/logos/tools/openclaw.svg',
    name: 'OpenClaw',
    agent_type: 'openclaw-gateway',
    agent_source: 'builtin',
    agent_source_info: { binary_name: 'openclaw' },
    enabled: false,
    available: false,
    command: 'openclaw',
    behavior_policy: {
      supports_team: false,
    },
    yolo_id: 'yolo',
    team_capable: false,
    handshake: {},
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function toAgentMetadata(value: unknown): AgentMetadata | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.agent_type !== 'string' ||
    typeof value.agent_source !== 'string'
  ) {
    return null;
  }
  return {
    ...(value as AgentMetadata),
    enabled: false,
    available: value.available === true,
  };
}

function sameAgentList(a: AgentMetadata[], b: AgentMetadata[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((agent, index) => agent.id === b[index]?.id && agent.enabled === b[index]?.enabled);
}

function getAgentLogicalKey(agent: AgentMetadata): string {
  const binaryName = agent.agent_source_info?.binary_name;
  if (agent.backend) {
    return `${agent.agent_type}:${agent.backend}`;
  }
  if (agent.agent_type === 'openclaw-gateway' || binaryName === 'openclaw' || agent.command === 'openclaw') {
    return 'builtin:openclaw';
  }
  return `${agent.agent_source}:${agent.agent_type}:${agent.name.toLowerCase()}`;
}

export function readDisabledAgentSnapshots(): AgentMetadata[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEYS.DISABLED_AGENT_SNAPSHOTS);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(toAgentMetadata).filter((agent): agent is AgentMetadata => agent !== null);
  } catch {
    return [];
  }
}

export function writeDisabledAgentSnapshots(snapshots: AgentMetadata[]): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    if (snapshots.length === 0) {
      storage.removeItem(STORAGE_KEYS.DISABLED_AGENT_SNAPSHOTS);
      return;
    }
    storage.setItem(STORAGE_KEYS.DISABLED_AGENT_SNAPSHOTS, JSON.stringify(snapshots));
  } catch {
    /* ignore unavailable storage */
  }
}

export function upsertDisabledAgentSnapshot(snapshots: AgentMetadata[], agent: AgentMetadata): AgentMetadata[] {
  const disabledAgent: AgentMetadata = { ...agent, enabled: false };
  const logicalKey = getAgentLogicalKey(agent);
  const withoutCurrent = snapshots.filter((item) => item.id !== agent.id && getAgentLogicalKey(item) !== logicalKey);
  return [...withoutCurrent, disabledAgent];
}

export function removeDisabledAgentSnapshot(snapshots: AgentMetadata[], agentId: string): AgentMetadata[] {
  return snapshots.filter((agent) => agent.id !== agentId);
}

export function reconcileDisabledAgentSnapshots(
  snapshots: AgentMetadata[],
  currentAgents: AgentMetadata[]
): AgentMetadata[] {
  const enabledIds = new Set(currentAgents.filter((agent) => agent.enabled !== false).map((agent) => agent.id));
  const next = snapshots.filter((agent) => !enabledIds.has(agent.id));
  return sameAgentList(snapshots, next) ? snapshots : next;
}

export function mergeSettingsAgentRows(
  currentAgents: AgentMetadata[],
  disabledSnapshots: AgentMetadata[]
): AgentMetadata[] {
  const byId = new Map<string, AgentMetadata>();
  const logicalKeys = new Set<string>();
  for (const agent of currentAgents) {
    byId.set(agent.id, agent);
    logicalKeys.add(getAgentLogicalKey(agent));
  }

  for (const agent of disabledSnapshots) {
    const logicalKey = getAgentLogicalKey(agent);
    if (!byId.has(agent.id) && !logicalKeys.has(logicalKey)) {
      byId.set(agent.id, { ...agent, enabled: false });
      logicalKeys.add(logicalKey);
    }
  }

  for (const agent of BUILTIN_DISABLED_AGENT_FALLBACKS) {
    const logicalKey = getAgentLogicalKey(agent);
    if (!byId.has(agent.id) && !logicalKeys.has(logicalKey)) {
      byId.set(agent.id, agent);
      logicalKeys.add(logicalKey);
    }
  }

  return Array.from(byId.values());
}
