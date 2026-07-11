import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const EXPECTED_CORE_MIGRATION_COUNT = 23;

const REQUIRED_FEATURES = [
  'agent_management',
  'agent_management_refresh',
  'centaurai_environment_aliases',
  'centaurai_proxy_identity_headers',
  'provider_secret_redaction',
  'teams',
] as const;

const REQUIRED_WS_EVENTS = [
  'conversation.listChanged',
  'message.stream',
  'team.agentStatusChanged',
  'team.runCancelled',
  'team.runCompleted',
  'team.teammateMessage',
] as const;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export class CoreConsumerContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreConsumerContractError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CoreConsumerContractError(message);
}

async function requestJson(fetchImpl: FetchLike, baseUrl: string, route: string, method = 'GET'): Promise<unknown> {
  const response = await fetchImpl(`${baseUrl}${route}`, {
    method,
    signal: AbortSignal.timeout(10_000),
  });
  assert(response.ok, `${method} ${route} returned ${response.status}`);
  const body = (await response.json()) as unknown;
  assert(isRecord(body) && body.success === true && 'data' in body, `${method} ${route} returned an invalid envelope`);
  return body.data;
}

function assertArray(value: unknown, route: string): void {
  assert(Array.isArray(value), `${route} must return an array`);
}

function assertCapabilities(value: unknown): void {
  assert(isRecord(value), '/api/capabilities data must be an object');
  assert(isRecord(value.contract), '/api/capabilities contract must be an object');
  assert(value.contract.rest === '1', 'unsupported REST contract version');
  assert(value.contract.websocket === '1', 'unsupported WebSocket contract version');
  assert(value.contract.startup === '2', 'CentaurAI dual startup contract is required');
  assert(value.feature_version === '1', 'unsupported feature contract version');
  assert(isRecord(value.features), '/api/capabilities features must be an object');
  for (const feature of REQUIRED_FEATURES) {
    assert(value.features[feature] === true, `required Core feature is unavailable: ${feature}`);
  }
  assert(isRecord(value.websocket), '/api/capabilities websocket must be an object');
  assert(value.websocket.version === '1', 'unsupported WebSocket event version');
  assert(Array.isArray(value.websocket.events), '/api/capabilities websocket.events must be an array');
  for (const eventName of REQUIRED_WS_EVENTS) {
    assert(value.websocket.events.includes(eventName), `required WebSocket event is unavailable: ${eventName}`);
  }
}

/** Exercise the read-only API surfaces used during Decision bootstrap. */
export async function runCentaurConsumerContract(port: number, fetchImpl: FetchLike = fetch): Promise<void> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
  assert(health.ok, `/health returned ${health.status}`);

  assertCapabilities(await requestJson(fetchImpl, baseUrl, '/api/capabilities'));
  assertArray(await requestJson(fetchImpl, baseUrl, '/api/agents/management'), '/api/agents/management');
  assertArray(
    await requestJson(fetchImpl, baseUrl, '/api/agents/management/refresh', 'POST'),
    '/api/agents/management/refresh'
  );
  assertArray(await requestJson(fetchImpl, baseUrl, '/api/skills'), '/api/skills');
  assertArray(await requestJson(fetchImpl, baseUrl, '/api/providers'), '/api/providers');
  assertArray(await requestJson(fetchImpl, baseUrl, '/api/teams'), '/api/teams');
  assertArray(await requestJson(fetchImpl, baseUrl, '/api/cron/jobs'), '/api/cron/jobs');
  assertArray(await requestJson(fetchImpl, baseUrl, '/api/mcp/servers'), '/api/mcp/servers');

  const conversations = await requestJson(fetchImpl, baseUrl, '/api/conversations');
  assert(isRecord(conversations), '/api/conversations data must be an object');
  assert(Array.isArray(conversations.items), '/api/conversations items must be an array');
  assert(typeof conversations.total === 'number', '/api/conversations total must be a number');
  assert(typeof conversations.has_more === 'boolean', '/api/conversations has_more must be a boolean');

  const settings = await requestJson(fetchImpl, baseUrl, '/api/settings/client');
  assert(isRecord(settings), '/api/settings/client data must be an object');
}

/** Verify that startup applied the exact v0.1.48 migration set. */
export async function verifyCoreMigrationCount(
  dataDir: string,
  expectedCount = EXPECTED_CORE_MIGRATION_COUNT
): Promise<void> {
  const database = new DatabaseSync(path.join(dataDir, 'aionui-backend.db'), { readOnly: true });
  try {
    const row = database.prepare('SELECT COUNT(*) AS count FROM _sqlx_migrations WHERE success = 1').get();
    assert(
      row && row.count === expectedCount,
      `expected ${expectedCount} successful Core migrations, received ${row?.count}`
    );
  } finally {
    database.close();
  }
}
