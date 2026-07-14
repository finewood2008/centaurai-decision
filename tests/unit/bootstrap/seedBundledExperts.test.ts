import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import { seedBundledExperts } from '@/process/utils/seedBundledExperts';

const { agentsMock, importMock, listMock, updateMock, readRuleMock, writeRuleMock } = vi.hoisted(() => ({
  agentsMock: vi.fn(),
  importMock: vi.fn(),
  listMock: vi.fn(),
  updateMock: vi.fn(),
  readRuleMock: vi.fn(),
  writeRuleMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { getAvailableAgents: { invoke: agentsMock } },
    assistants: { import: { invoke: importMock }, list: { invoke: listMock }, update: { invoke: updateMock } },
    fs: {
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

async function makeFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-seed-'));
  const expertsDir = path.join(dir, 'experts');
  await fs.mkdir(path.join(expertsDir, 'rules'), { recursive: true });
  const manifest = [
    {
      id: 'agency-marketing-marketing-seo-specialist',
      name: 'SEO Specialist',
      preset_agent_type: 'aionrs',
      enabled_skills: ['officecli-docx'],
      name_i18n: { 'zh-CN': 'SEO 专家', 'en-US': 'SEO Specialist' },
      description_i18n: { 'zh-CN': '搜索优化顾问', 'en-US': 'Search optimization advisor' },
      rule_file: 'rules/agency-marketing-marketing-seo-specialist.{locale}.md',
    },
  ];
  await fs.writeFile(path.join(expertsDir, 'experts.json'), JSON.stringify(manifest), 'utf-8');
  await fs.writeFile(path.join(expertsDir, 'rules', `${manifest[0].id}.zh-CN.md`), '# SEO 专家\n中文正文', 'utf-8');
  await fs.writeFile(path.join(expertsDir, 'rules', `${manifest[0].id}.en-US.md`), '# SEO Specialist\nbody', 'utf-8');
  // Point production resolver at this fixture.
  Object.defineProperty(process, 'resourcesPath', { value: dir, configurable: true });
  return dir;
}

describe('seedBundledExperts', () => {
  beforeEach(() => {
    agentsMock
      .mockReset()
      .mockResolvedValue([{ id: '632f31d2', name: 'CentaurAI Core', agent_type: 'aionrs', agent_source: 'internal' }]);
    importMock.mockReset().mockResolvedValue({ imported: 1, skipped: 0, failed: 0, errors: [] });
    listMock.mockReset().mockResolvedValue([]);
    updateMock.mockReset().mockResolvedValue({});
    readRuleMock.mockReset().mockResolvedValue('');
    writeRuleMock.mockReset().mockResolvedValue(true);
  });

  it('imports the catalog and uploads both locale rule bodies on first run', async () => {
    await makeFixture();
    const config = makeConfig();

    const ok = await seedBundledExperts(config as never);

    expect(ok).toBe(true);
    expect(importMock).toHaveBeenCalledTimes(1);
    const payload = importMock.mock.calls[0][0] as { assistants: Array<Record<string, unknown>> };
    expect(payload.assistants).toHaveLength(1);
    // rule_file is a manifest-only field — it must not leak into the wire contract.
    expect(payload.assistants[0]).not.toHaveProperty('rule_file');
    expect(payload.assistants[0]).not.toHaveProperty('preset_agent_type');
    expect(payload.assistants[0]).toHaveProperty('agent_id', '632f31d2');
    expect(writeRuleMock).toHaveBeenCalledTimes(2);
    expect(config.store.get('migration.bundledExpertsSeeded')).toBe(3);
  });

  it('is a no-op when already seeded at the current version', async () => {
    await makeFixture();
    const config = makeConfig(new Map([['migration.bundledExpertsSeeded', 3]]));

    const ok = await seedBundledExperts(config as never);

    expect(ok).toBe(true);
    expect(importMock).not.toHaveBeenCalled();
  });

  it('repairs empty localization maps without overwriting existing translations', async () => {
    await makeFixture();
    listMock.mockResolvedValue([
      {
        id: 'agency-marketing-marketing-seo-specialist',
        name_i18n: {},
        description_i18n: { 'zh-CN': '用户翻译' },
        prompts_i18n: {},
      },
    ]);
    const config = makeConfig(new Map([['migration.bundledExpertsSeeded', 1]]));

    expect(await seedBundledExperts(config as never)).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({
      id: 'agency-marketing-marketing-seo-specialist',
      name_i18n: { 'zh-CN': 'SEO 专家', 'en-US': 'SEO Specialist' },
    });
    expect(updateMock.mock.calls[0][0]).not.toHaveProperty('description_i18n');
  });

  it('replaces a historically English zh-CN description while preserving other locales', async () => {
    await makeFixture();
    listMock.mockResolvedValue([
      {
        id: 'agency-marketing-marketing-seo-specialist',
        name_i18n: { 'zh-CN': 'SEO 专家' },
        description_i18n: { 'zh-CN': 'Expert legacy text', 'fr-FR': 'Texte utilisateur' },
        prompts_i18n: {},
      },
    ]);

    expect(await seedBundledExperts(makeConfig() as never)).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({
      id: 'agency-marketing-marketing-seo-specialist',
      description_i18n: {
        'zh-CN': '搜索优化顾问',
        'fr-FR': 'Texte utilisateur',
      },
    });
  });

  it('never overwrites an existing non-empty rule', async () => {
    await makeFixture();
    readRuleMock.mockResolvedValue('user edited');
    const config = makeConfig();

    await seedBundledExperts(config as never);

    expect(writeRuleMock).not.toHaveBeenCalled();
  });

  it('returns false without setting the flag when import reports failures', async () => {
    await makeFixture();
    importMock.mockResolvedValue({ imported: 0, skipped: 0, failed: 1, errors: [{ id: 'x', error: 'boom' }] });
    const config = makeConfig();

    const ok = await seedBundledExperts(config as never);

    expect(ok).toBe(false);
    expect(config.store.has('migration.bundledExpertsSeeded')).toBe(false);
  });

  it('defers without importing when a manifest preset has no matching Core agent', async () => {
    await makeFixture();
    agentsMock.mockResolvedValue([]);
    const config = makeConfig();

    const ok = await seedBundledExperts(config as never);

    expect(ok).toBe(false);
    expect(importMock).not.toHaveBeenCalled();
    expect(config.store.has('migration.bundledExpertsSeeded')).toBe(false);
  });
});
