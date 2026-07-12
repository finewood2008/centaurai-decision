import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acpConversation, fs as fileBridge, team } from '@/common/adapter/ipcBridge';
import { wsEmitterAliases } from '@/common/adapter/httpBridge';

const ok = (data: unknown): Response =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const requestPath = (input: string | URL | Request): string => new URL(String(input)).pathname;

describe('Decision 2.5.1 CentaurAI Core REST consumer contract', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort = 43123;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  });

  it('uses agent management list, refresh, and per-agent health routes', async () => {
    const row = {
      id: 'claude-acp',
      name: 'Claude',
      backend: 'claude',
      agent_type: 'acp',
      agent_source: 'builtin',
      enabled: true,
      installed: true,
      status: 'online',
      sort_order: 1,
      config_options: [{ id: 'mode', type: 'select', current_value: 'default' }],
      last_check_latency_ms: 12,
    };
    const missingRow = {
      ...row,
      id: 'gemini-acp',
      backend: 'gemini',
      name: 'Gemini',
      installed: false,
      status: 'missing',
    };
    const offlineRow = { ...row, id: 'offline-acp', backend: 'offline', installed: true, status: 'offline' };
    const disabledRow = { ...row, id: 'disabled-acp', backend: 'disabled', enabled: false };
    const calls: Array<{ method: string; path: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = requestPath(input);
        calls.push({ method: init?.method ?? 'GET', path });
        if (path === '/api/agents/management') return ok([row, missingRow, offlineRow, disabledRow]);
        if (path === '/api/agents/management/refresh') return ok([row]);
        if (path === '/api/agents/claude-acp/health-check') return ok(row);
        return new Response('not found', { status: 404 });
      })
    );

    const agents = await acpConversation.getAvailableAgents.invoke();
    expect(agents[0]).toMatchObject({
      id: 'claude-acp',
      installed: true,
      status: 'online',
      available: true,
      last_check_latency_ms: 12,
    });
    expect(agents[0].handshake?.config_options).toEqual(row.config_options);
    expect(agents.slice(1).map((agent) => agent.available)).toEqual([false, false, false]);

    await acpConversation.refreshCustomAgents.invoke();
    const health = await acpConversation.checkAgentHealth.invoke({ backend: 'claude' });
    expect(health).toEqual({ available: true, latency: 12 });
    expect(calls).toEqual([
      { method: 'GET', path: '/api/agents/management' },
      { method: 'POST', path: '/api/agents/management/refresh' },
      { method: 'GET', path: '/api/agents/management' },
      { method: 'POST', path: '/api/agents/claude-acp/health-check' },
    ]);
  });

  it('reads and writes model and mode through runtime config-options', async () => {
    const configOptions = [
      {
        id: 'mode',
        category: 'mode',
        type: 'select',
        current_value: 'default',
        options: [{ value: 'default', name: 'Default' }],
      },
      {
        id: 'model',
        category: 'model',
        type: 'select',
        current_value: 'opus',
        options: [
          { value: 'opus', name: 'Opus' },
          { value: 'sonnet', label: 'Sonnet' },
        ],
      },
    ];
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = requestPath(input);
        calls.push({
          method: init?.method ?? 'GET',
          path,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        if (path.endsWith('/runtime/ensure')) return ok({ recovered: false, config_options: configOptions });
        if (path.endsWith('/config-options/mode'))
          return ok({ confirmation: 'observed', config_options: configOptions });
        if (path.endsWith('/config-options/model'))
          return ok({ confirmation: 'observed', config_options: configOptions });
        return new Response('not found', { status: 404 });
      })
    );

    await expect(acpConversation.getMode.invoke({ conversation_id: 'c1' })).resolves.toEqual({
      mode: 'default',
      initialized: true,
    });
    await expect(acpConversation.getModel.invoke({ conversation_id: 'c1' })).resolves.toEqual({
      model_info: {
        current_model_id: 'opus',
        current_model_label: 'Opus',
        available_models: [
          { id: 'opus', label: 'Opus' },
          { id: 'sonnet', label: 'Sonnet' },
        ],
      },
    });
    await acpConversation.setMode.invoke({ conversation_id: 'c1', mode: 'plan' });
    await acpConversation.setModel.invoke({ conversation_id: 'c1', model_id: 'sonnet' });

    expect(calls.slice(0, 2).map(({ method, path }) => ({ method, path }))).toEqual([
      { method: 'POST', path: '/api/conversations/c1/runtime/ensure' },
      { method: 'POST', path: '/api/conversations/c1/runtime/ensure' },
    ]);
    expect(calls.slice(2)).toEqual([
      { method: 'PUT', path: '/api/conversations/c1/config-options/mode', body: { value: 'plan' } },
      { method: 'PUT', path: '/api/conversations/c1/config-options/model', body: { value: 'sonnet' } },
    ]);
  });

  it('filters auto skills, imports by copy, and cancels team runs with POST', async () => {
    const calls: Array<{ method: string; path: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = requestPath(input);
        calls.push({ method: init?.method ?? 'GET', path });
        if (path === '/api/skills' && init?.method === 'GET') {
          return ok([
            { name: 'auto', description: 'A', location: '/auto', is_auto_inject: true },
            { name: 'manual', description: 'M', location: '/manual', is_auto_inject: false },
          ]);
        }
        if (path === '/api/skills/import') return ok({ skill_name: 'copied' });
        if (path === '/api/teams/t1/runs/r1/cancel') return ok(undefined);
        return new Response('not found', { status: 404 });
      })
    );

    await expect(fileBridge.listBuiltinAutoSkills.invoke()).resolves.toEqual([
      { name: 'auto', description: 'A', location: '/auto', is_auto_inject: true },
    ]);
    await fileBridge.importSkillWithSymlink.invoke({ skill_path: '/safe/source' });
    await team.cancelRun.invoke({ team_id: 't1', team_run_id: 'r1' });
    expect(calls).toEqual([
      { method: 'GET', path: '/api/skills' },
      { method: 'POST', path: '/api/skills/import' },
      { method: 'POST', path: '/api/teams/t1/runs/r1/cancel' },
    ]);
  });
});

describe('CentaurAI Core immutable release lock contract', () => {
  const originalLock = process.env.CENTAURAI_CORE_RELEASE_LOCK;
  const originalLegacyLock = process.env.LEGACY_AIONCORE_RELEASE_LOCK;
  const roots: string[] = [];

  afterEach(() => {
    if (originalLock === undefined) delete process.env.CENTAURAI_CORE_RELEASE_LOCK;
    else process.env.CENTAURAI_CORE_RELEASE_LOCK = originalLock;
    if (originalLegacyLock === undefined) delete process.env.LEGACY_AIONCORE_RELEASE_LOCK;
    else process.env.LEGACY_AIONCORE_RELEASE_LOCK = originalLegacyLock;
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
  });

  it('accepts an exact tag, commit, and per-asset SHA-256 lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'centaur-core-lock-'));
    roots.push(root);
    const asset = 'centaurai-core-v0.1.48-x86_64-unknown-linux-gnu.tar.gz';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ centauraiCoreVersion: 'v0.1.48' }));
    const lockPath = join(root, 'release.json');
    writeFileSync(
      lockPath,
      JSON.stringify({
        repository: 'finewood2008/centaurai-core',
        tag: 'v0.1.48',
        commit: 'a'.repeat(40),
        assets: { [asset]: 'b'.repeat(64) },
      })
    );
    process.env.CENTAURAI_CORE_RELEASE_LOCK = lockPath;

    const { resolveCentauraiCoreRelease } = require('../../scripts/resolveAioncoreVersion.js');
    expect(resolveCentauraiCoreRelease(root)).toMatchObject({
      tag: 'v0.1.48',
      commit: 'a'.repeat(40),
      assets: { [asset]: 'b'.repeat(64) },
    });
  });

  it('rejects an incomplete release lock instead of falling back to latest', () => {
    const root = mkdtempSync(join(tmpdir(), 'centaur-core-lock-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ centauraiCoreVersion: 'v0.1.48' }));
    const lockPath = join(root, 'release.json');
    writeFileSync(lockPath, JSON.stringify({ repository: 'finewood2008/centaurai-core', tag: 'v0.1.48', assets: {} }));
    process.env.CENTAURAI_CORE_RELEASE_LOCK = lockPath;

    const { resolveCentauraiCoreRelease } = require('../../scripts/resolveAioncoreVersion.js');
    expect(() => resolveCentauraiCoreRelease(root)).toThrow('exact 40-character commit');
  });

  it('uses the published repository lock and fails closed when an override is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'centaur-core-unpublished-'));
    roots.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ centauraiCoreVersion: 'v0.1.48' }));
    delete process.env.CENTAURAI_CORE_RELEASE_LOCK;

    const { resolveCentauraiCoreRelease } = require('../../scripts/resolveAioncoreVersion.js');
    expect(() => resolveCentauraiCoreRelease(root)).toThrow('release lock is required');

    const published = resolveCentauraiCoreRelease(process.cwd());
    expect(published).toMatchObject({
      repository: 'finewood2008/centaurai-core',
      tag: 'v0.2.2',
      commit: 'd667ae51520795d550e0b6a14d7cbddb967f68ec',
    });
    expect(Object.keys(published.assets)).toHaveLength(6);
  });

  it('locks legacy v0.1.24 independently for rollback packaging', () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-core-lock-'));
    roots.push(root);
    const asset = 'aioncore-v0.1.24-x86_64-unknown-linux-gnu.tar.gz';
    writeFileSync(join(root, 'package.json'), JSON.stringify({ legacyAioncoreVersion: 'v0.1.24' }));
    const lockPath = join(root, 'legacy-release.json');
    writeFileSync(
      lockPath,
      JSON.stringify({
        repository: 'iOfficeAI/AionCore',
        tag: 'v0.1.24',
        commit: 'f09d94989d2b01a891fbb5e7efcc65b568f290e1',
        assets: { [asset]: '94d624fc354b16a18654249580c6da732e2da0acc7f2325c53095d951ad1296f' },
      })
    );
    process.env.LEGACY_AIONCORE_RELEASE_LOCK = lockPath;

    const { resolveLegacyAioncoreRelease } = require('../../scripts/resolveAioncoreVersion.js');
    expect(resolveLegacyAioncoreRelease(root)).toMatchObject({
      repository: 'iOfficeAI/AionCore',
      tag: 'v0.1.24',
      commit: 'f09d94989d2b01a891fbb5e7efcc65b568f290e1',
    });
  });

  it('uses isolated legacy asset names and rejects a missing target SHA before download', () => {
    const { getAssetName, prepareLegacyAioncore } = require('../../packages/shared-scripts/src/prepare-aioncore.js');
    expect(getAssetName('linux', 'x64', 'v0.1.24', 'legacy')).toBe('aioncore-v0.1.24-x86_64-unknown-linux-gnu.tar.gz');
    expect(() =>
      prepareLegacyAioncore({
        projectRoot: '/fixture',
        platform: 'linux',
        arch: 'x64',
        release: {
          repository: 'iOfficeAI/AionCore',
          tag: 'v0.1.24',
          commit: 'a'.repeat(40),
          assets: {},
        },
      })
    ).toThrow('missing SHA-256');
  });
});

describe('Decision maintenance release supply-chain contract', () => {
  it('pins release actions, Bun, and Ubuntu instead of resolving floating latest inputs', () => {
    for (const relative of [
      '.github/workflows/_build-reusable.yml',
      '.github/workflows/build-and-release.yml',
      '.github/workflows/pack-web-cli.yml',
    ]) {
      const workflow = readFileSync(join(process.cwd(), relative), 'utf8');
      expect(workflow).not.toMatch(/bun-version:\s*latest/i);
      expect(workflow).not.toContain('ubuntu-latest');
      expect(workflow).toContain('bun-version: 1.3.14');
      const externalActions = [...workflow.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)/g)]
        .filter(([, action]) => !action.startsWith('./'))
        .map(([, , reference]) => reference);
      expect(externalActions.length).toBeGreaterThan(0);
      expect(externalActions.every((reference) => /^[0-9a-f]{40}$/.test(reference))).toBe(true);
    }
  });
});

describe('Team WebSocket compatibility contract', () => {
  it('delivers both canonical camelCase and legacy dotted event names', () => {
    type Listener = (event: { data?: string; code?: number; reason?: string }) => void;
    class FakeWebSocket {
      static readonly OPEN = 1;
      static readonly CONNECTING = 0;
      static last: FakeWebSocket | undefined;
      readonly readyState = FakeWebSocket.OPEN;
      private readonly listeners = new Map<string, Listener[]>();

      constructor(_url: string) {
        FakeWebSocket.last = this;
      }

      addEventListener(name: string, listener: Listener): void {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      }

      close(): void {}

      message(name: string, data: unknown): void {
        this.listeners.get('message')?.forEach((listener) => listener({ data: JSON.stringify({ name, data }) }));
      }
    }

    vi.stubGlobal('window', { __backendPort: 43123 });
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const received: string[] = [];
    const emitter = wsEmitterAliases<{ value: string }>(['team.agentStatusChanged', 'team.agent.status']);
    const unsubscribe = emitter.on((event) => received.push(event.value));

    FakeWebSocket.last?.message('team.agentStatusChanged', { value: 'canonical' });
    FakeWebSocket.last?.message('team.agent.status', { value: 'legacy' });
    unsubscribe();

    expect(received).toEqual(['canonical', 'legacy']);
    vi.unstubAllGlobals();
  });
});
