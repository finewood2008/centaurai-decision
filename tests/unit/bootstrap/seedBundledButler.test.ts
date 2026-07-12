import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import { seedBundledButler } from '@/process/utils/seedBundledButler';

const { agentsMock, importAssistantMock, importSkillMock, readRuleMock, writeRuleMock } = vi.hoisted(() => ({
  agentsMock: vi.fn(),
  importAssistantMock: vi.fn(),
  importSkillMock: vi.fn(),
  readRuleMock: vi.fn(),
  writeRuleMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { getAvailableAgents: { invoke: agentsMock } },
    assistants: { import: { invoke: importAssistantMock } },
    fs: {
      importSkill: { invoke: importSkillMock },
      readAssistantRule: { invoke: readRuleMock },
      writeAssistantRule: { invoke: writeRuleMock },
    },
  },
}));

type ConfigStore = Map<string, unknown>;

function makeConfig(initial: ConfigStore = new Map()) {
  return {
    get: vi.fn(async (key: string) => initial.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      initial.set(key, value);
      return value;
    }),
    store: initial,
  };
}

const BUTLER_ID = 'centaurai-butler';

async function makeFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'butler-seed-'));
  const butlerDir = path.join(dir, 'butler');
  await fs.mkdir(path.join(butlerDir, 'rules'), { recursive: true });
  await Promise.all(
    ['aionui-config', 'aionui-troubleshooting'].map(async (skill) => {
      await fs.mkdir(path.join(butlerDir, 'skills', skill), { recursive: true });
      await fs.writeFile(path.join(butlerDir, 'skills', skill, 'SKILL.md'), `# ${skill}\nbody`, 'utf-8');
    })
  );
  const manifest = {
    version: 1,
    skills: ['aionui-config', 'aionui-troubleshooting'],
    assistant: {
      id: BUTLER_ID,
      name: 'CentaurAI 管家',
      preset_agent_type: 'aionrs',
      custom_skill_names: ['aionui-config', 'aionui-troubleshooting'],
    },
  };
  await fs.writeFile(path.join(butlerDir, 'butler.json'), JSON.stringify(manifest), 'utf-8');
  await fs.writeFile(path.join(butlerDir, 'rules', `${BUTLER_ID}.zh-CN.md`), '# CentaurAI 管家\n中文正文', 'utf-8');
  await fs.writeFile(path.join(butlerDir, 'rules', `${BUTLER_ID}.en-US.md`), '# CentaurAI Butler\nbody', 'utf-8');
  // Point the production resolver at this fixture.
  Object.defineProperty(process, 'resourcesPath', { value: dir, configurable: true });
  return dir;
}

describe('seedBundledButler', () => {
  beforeEach(() => {
    agentsMock
      .mockReset()
      .mockResolvedValue([{ id: '632f31d2', name: 'CentaurAI Core', agent_type: 'aionrs', agent_source: 'internal' }]);
    importAssistantMock.mockReset().mockResolvedValue({ imported: 1, skipped: 0, failed: 0, errors: [] });
    importSkillMock.mockReset().mockImplementation(async ({ skill_path }: { skill_path: string }) => ({
      skill_name: path.basename(skill_path),
    }));
    readRuleMock.mockReset().mockResolvedValue('');
    writeRuleMock.mockReset().mockResolvedValue(true);
  });

  it('imports the skills, assistant, and both locale rule bodies on first run', async () => {
    await makeFixture();
    const config = makeConfig();

    const ok = await seedBundledButler(config as never);

    expect(ok).toBe(true);
    expect(importSkillMock).toHaveBeenCalledTimes(2);
    expect(importAssistantMock).toHaveBeenCalledTimes(1);
    const payload = importAssistantMock.mock.calls[0][0] as { assistants: Array<Record<string, unknown>> };
    expect(payload.assistants).toHaveLength(1);
    expect(payload.assistants[0].id).toBe(BUTLER_ID);
    expect(payload.assistants[0]).not.toHaveProperty('preset_agent_type');
    expect(payload.assistants[0]).toHaveProperty('agent_id', '632f31d2');
    expect(writeRuleMock).toHaveBeenCalledTimes(2);
    expect(config.store.get('migration.bundledButlerSeeded')).toBe(1);
  });

  it('is a no-op when already seeded at the current version', async () => {
    await makeFixture();
    const config = makeConfig(new Map([['migration.bundledButlerSeeded', 1]]));

    const ok = await seedBundledButler(config as never);

    expect(ok).toBe(true);
    expect(importSkillMock).not.toHaveBeenCalled();
    expect(importAssistantMock).not.toHaveBeenCalled();
  });

  it('tolerates an already-present skill (import throws) and still seeds', async () => {
    await makeFixture();
    importSkillMock.mockRejectedValue(new Error('already exists'));
    const config = makeConfig();

    const ok = await seedBundledButler(config as never);

    expect(ok).toBe(true);
    expect(importAssistantMock).toHaveBeenCalledTimes(1);
    expect(config.store.get('migration.bundledButlerSeeded')).toBe(1);
  });

  it('defers (no flag) when a wanted skill cannot be made available', async () => {
    await makeFixture();
    // Skill import resolves to an unexpected name and the dir is gone, so the
    // wanted custom_skill_names stay unsatisfied.
    importSkillMock.mockResolvedValue({ skill_name: 'something-else' });
    const config = makeConfig();

    const ok = await seedBundledButler(config as never);

    expect(ok).toBe(false);
    expect(importAssistantMock).not.toHaveBeenCalled();
    expect(config.store.has('migration.bundledButlerSeeded')).toBe(false);
  });

  it('never overwrites an existing non-empty rule', async () => {
    await makeFixture();
    readRuleMock.mockResolvedValue('user edited');
    const config = makeConfig();

    await seedBundledButler(config as never);

    expect(writeRuleMock).not.toHaveBeenCalled();
  });

  it('returns false without setting the flag when assistant import reports failures', async () => {
    await makeFixture();
    importAssistantMock.mockResolvedValue({
      imported: 0,
      skipped: 0,
      failed: 1,
      errors: [{ id: BUTLER_ID, error: 'boom' }],
    });
    const config = makeConfig();

    const ok = await seedBundledButler(config as never);

    expect(ok).toBe(false);
    expect(config.store.has('migration.bundledButlerSeeded')).toBe(false);
  });

  it('defers without importing when the Core agent cannot be resolved', async () => {
    await makeFixture();
    agentsMock.mockResolvedValue([]);
    const config = makeConfig();

    const ok = await seedBundledButler(config as never);

    expect(ok).toBe(false);
    expect(importAssistantMock).not.toHaveBeenCalled();
    expect(config.store.has('migration.bundledButlerSeeded')).toBe(false);
  });
});
