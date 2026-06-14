import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import { seedBundledExperts } from '@/process/utils/seedBundledExperts';

const { importMock, readRuleMock, writeRuleMock } = vi.hoisted(() => ({
  importMock: vi.fn(),
  readRuleMock: vi.fn(),
  writeRuleMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { import: { invoke: importMock } },
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
    importMock.mockReset().mockResolvedValue({ imported: 1, skipped: 0, failed: 0, errors: [] });
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
    expect(writeRuleMock).toHaveBeenCalledTimes(2);
    expect(config.store.get('migration.bundledExpertsSeeded')).toBe(1);
  });

  it('is a no-op when already seeded at the current version', async () => {
    await makeFixture();
    const config = makeConfig(new Map([['migration.bundledExpertsSeeded', 1]]));

    const ok = await seedBundledExperts(config as never);

    expect(ok).toBe(true);
    expect(importMock).not.toHaveBeenCalled();
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
});
