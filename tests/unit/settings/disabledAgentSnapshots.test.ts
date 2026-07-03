/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { AgentMetadata } from '@/renderer/utils/model/agentTypes';
import {
  mergeSettingsAgentRows,
  reconcileDisabledAgentSnapshots,
  removeDisabledAgentSnapshot,
  upsertDisabledAgentSnapshot,
} from '@/renderer/pages/settings/AgentSettings/disabledAgentSnapshots';

const agent = (overrides: Partial<AgentMetadata>): AgentMetadata => ({
  id: 'agent-1',
  name: 'Test Agent',
  agent_type: 'acp',
  agent_source: 'builtin',
  backend: 'test',
  enabled: true,
  available: true,
  ...overrides,
});

describe('disabledAgentSnapshots', () => {
  it('adds built-in disabled fallbacks when the backend omits them', () => {
    const merged = mergeSettingsAgentRows([agent({ id: 'aionrs', agent_type: 'aionrs' })], []);

    expect(merged.some((item) => item.id === '2d23ff1c' && item.enabled === false)).toBe(true);
    expect(merged.some((item) => item.id === 'f9f61666' && item.enabled === false)).toBe(true);
  });

  it('does not duplicate a built-in row when the backend returns it', () => {
    const claude = agent({ id: '2d23ff1c', backend: 'claude', name: 'Claude Code', enabled: true });
    const merged = mergeSettingsAgentRows([claude], []);

    expect(merged.filter((item) => item.id === '2d23ff1c')).toHaveLength(1);
    expect(merged.find((item) => item.id === '2d23ff1c')?.enabled).toBe(true);
  });

  it('does not duplicate OpenClaw when the backend row has a different id', () => {
    const openclaw = agent({
      id: 'real-openclaw-id',
      name: 'OpenClaw',
      backend: undefined,
      agent_type: 'openclaw-gateway',
      agent_source_info: { binary_name: 'openclaw' },
      command: 'openclaw',
      enabled: true,
    });
    const merged = mergeSettingsAgentRows([openclaw], []);

    expect(
      merged.filter(
        (item) => item.agent_type === 'openclaw-gateway' || item.agent_source_info?.binary_name === 'openclaw'
      )
    ).toHaveLength(1);
    expect(merged.find((item) => item.name === 'OpenClaw')?.id).toBe('real-openclaw-id');
  });

  it('keeps disabled snapshots that are missing from the backend list', () => {
    const disabled = agent({ id: 'custom-disabled', enabled: false, available: false });
    const merged = mergeSettingsAgentRows([], [disabled]);

    expect(merged).toContainEqual(disabled);
  });

  it('removes disabled snapshots once the backend returns the enabled row again', () => {
    const disabled = agent({ id: 'agent-1', enabled: false });
    const enabled = agent({ id: 'agent-1', enabled: true });

    expect(reconcileDisabledAgentSnapshots([disabled], [enabled])).toEqual([]);
  });

  it('upserts and removes disabled snapshots by id', () => {
    const first = agent({ id: 'agent-1', name: 'Old', enabled: false });
    const second = agent({ id: 'agent-1', name: 'New', enabled: true });
    const upserted = upsertDisabledAgentSnapshot([first], second);

    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toMatchObject({ id: 'agent-1', name: 'New', enabled: false });
    expect(removeDisabledAgentSnapshot(upserted, 'agent-1')).toEqual([]);
  });
});
