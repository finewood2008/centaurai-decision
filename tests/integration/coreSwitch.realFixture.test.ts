import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackendLifecycleManager } from '@aionui/web-host';
import { CoreSwitchService, runCentaurConsumerContract, verifyCoreMigrationCount } from '@process/services/core-switch';

const coreBinary = process.env.CENTAURAI_CORE_TEST_BIN;

describe.skipIf(!coreBinary)('Core switch real CentaurAI Core fixture', () => {
  const originalLogLevel = process.env.CENTAURAI_CORE_LOG_LEVEL;
  let rootDir: string;
  let dataDir: string;
  let service: CoreSwitchService;

  beforeAll(async () => {
    process.env.CENTAURAI_CORE_LOG_LEVEL = 'warn';
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decision-real-core-switch-'));
    dataDir = path.join(rootDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'rollback-sentinel.json'), '{"before":true}');
    const app = {
      version: '2.5.1-test',
      isPackaged: false,
      resourcesPath: path.dirname(coreBinary as string),
      userDataPath: rootDir,
    };
    service = new CoreSwitchService({
      createCentaurCore: () => new BackendLifecycleManager(app, () => coreBinary as string),
      createLegacyCore: () => new BackendLifecycleManager(app, () => coreBinary as string),
    });
  });

  afterAll(async () => {
    await service?.stop();
    await fs.rm(rootDir, { recursive: true, force: true });
    if (originalLogLevel === undefined) delete process.env.CENTAURAI_CORE_LOG_LEVEL;
    else process.env.CENTAURAI_CORE_LOG_LEVEL = originalLogLevel;
  });

  it('preflights, applies all 23 migrations, contracts, backs up, and starts formally', async () => {
    const port = await service.start(dataDir);

    expect(port).toBeGreaterThan(0);
    expect(service.status).toBe('running');
    await expect(runCentaurConsumerContract(port)).resolves.toBeUndefined();
    await expect(verifyCoreMigrationCount(dataDir)).resolves.toBeUndefined();
    const marker = JSON.parse(
      await fs.readFile(path.join(rootDir, '.data-core-switch', 'switch-complete.json'), 'utf8')
    ) as { backup: { manifestPath: string } };
    const manifest = JSON.parse(await fs.readFile(marker.backup.manifestPath, 'utf8')) as {
      files: Array<{ path: string }>;
    };
    expect(manifest.files).toContainEqual(expect.objectContaining({ path: 'rollback-sentinel.json' }));
    await expect(fs.stat(path.join(rootDir, '.data-core-switch', 'preflight-data'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 120_000);
});
