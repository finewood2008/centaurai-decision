import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CoreConsumerContractError,
  runCentaurConsumerContract,
  verifyCoreMigrationCount,
} from '@process/services/core-switch/consumerContract';

function validCapabilities(): Record<string, unknown> {
  return {
    contract: { rest: '2', websocket: '2', startup: '2' },
    feature_version: '2',
    features: {
      agent_management: true,
      agent_management_refresh: true,
      centaurai_environment_aliases: true,
      centaurai_proxy_identity_headers: true,
      decision_per_brain_knowledge_egress: true,
      decisions: true,
      idempotent_resource_creation: true,
      knowledge_dispatch_egress_gate: true,
      knowledge_gateway: true,
      provider_secret_redaction: true,
      provider_ssrf_pinned_dns: true,
      teams: true,
    },
    websocket: {
      version: '2',
      events: [
        'conversation.listChanged',
        'decision.completed',
        'decision.evidenceAdded',
        'decision.sessionChanged',
        'decision.turnDelta',
        'message.stream',
        'team.agentStatusChanged',
        'team.runCancelled',
        'team.runCompleted',
        'team.teammateMessage',
      ],
    },
  };
}

function createFetch(overrides: Record<string, { data?: unknown; status?: number }> = {}) {
  const payloads: Record<string, unknown> = {
    'GET /api/capabilities': validCapabilities(),
    'GET /api/agents/management': [],
    'POST /api/agents/management/refresh': [],
    'GET /api/skills': [],
    'GET /api/providers': [],
    'GET /api/teams': [],
    'GET /api/cron/jobs': [],
    'GET /api/mcp/servers': [],
    'GET /api/conversations': { items: [], total: 0, has_more: false },
    'GET /api/settings/client': {},
  };
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/health') return new Response('ok', { status: 200 });
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const override = overrides[key];
    const status = override?.status ?? 200;
    return Response.json(
      { success: status < 400, data: override && 'data' in override ? override.data : payloads[key] },
      { status }
    );
  });
}

describe('runCentaurConsumerContract', () => {
  it('checks capabilities and every Decision bootstrap consumer endpoint', async () => {
    const fetchImpl = createFetch();

    await runCentaurConsumerContract(43123, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(11);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:43123/api/agents/management/refresh',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('rejects a Core without the versioned dual-startup capability', async () => {
    const capabilities = validCapabilities();
    capabilities.contract = { rest: '2', websocket: '2', startup: '1' };

    await expect(
      runCentaurConsumerContract(43123, createFetch({ 'GET /api/capabilities': { data: capabilities } }))
    ).rejects.toThrow('dual startup contract');
  });

  it('rejects the previous Core v1 contract', async () => {
    const capabilities = validCapabilities();
    capabilities.contract = { rest: '1', websocket: '1', startup: '2' };

    await expect(
      runCentaurConsumerContract(43123, createFetch({ 'GET /api/capabilities': { data: capabilities } }))
    ).rejects.toThrow('unsupported REST contract version');
  });

  it('rejects a consumer endpoint with a changed DTO shape', async () => {
    await expect(
      runCentaurConsumerContract(43123, createFetch({ 'GET /api/providers': { data: { items: [] } } }))
    ).rejects.toBeInstanceOf(CoreConsumerContractError);
  });
});

describe('verifyCoreMigrationCount', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('accepts exactly 26 successful startup migrations and rejects an incomplete set', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'core-migration-count-'));
    roots.push(dataDir);
    const databasePath = path.join(dataDir, 'aionui-backend.db');
    const driver = new DatabaseSync(databasePath);
    driver.exec(
      'CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, success INTEGER NOT NULL);' +
        Array.from(
          { length: 26 },
          (_, index) => `INSERT INTO _sqlx_migrations (version, success) VALUES (${index + 1}, 1);`
        ).join('')
    );
    driver.close();

    await expect(verifyCoreMigrationCount(dataDir)).resolves.toBeUndefined();

    const incomplete = new DatabaseSync(databasePath);
    incomplete.exec('DELETE FROM _sqlx_migrations WHERE version = 26');
    incomplete.close();
    await expect(verifyCoreMigrationCount(dataDir)).rejects.toThrow('expected 26 successful Core migrations');
  });
});
