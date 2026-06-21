import { beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';

import { curateExperts } from '@/process/utils/curateExperts';

const { setStateMock, isHttpErrorMock } = vi.hoisted(() => ({
  setStateMock: vi.fn(),
  isHttpErrorMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { setState: { invoke: setStateMock } },
  },
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: isHttpErrorMock,
}));

const FLAG = 'migration.expertsCurated';

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

/** Temp `experts/` dir with experts.json (so resolveExpertsDir finds it) + curated-out.json. */
async function makeFixture(cutIds: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-curate-'));
  const expertsDir = path.join(dir, 'experts');
  await fs.mkdir(expertsDir, { recursive: true });
  await fs.writeFile(path.join(expertsDir, 'experts.json'), JSON.stringify([{ id: 'x' }]), 'utf-8');
  await fs.writeFile(path.join(expertsDir, 'curated-out.json'), JSON.stringify(cutIds), 'utf-8');
  Object.defineProperty(process, 'resourcesPath', { value: dir, configurable: true });
  return dir;
}

describe('curateExperts', () => {
  beforeEach(() => {
    setStateMock.mockReset().mockResolvedValue(undefined);
    // Treat a thrown reason as a backend HTTP error when it carries a numeric status.
    isHttpErrorMock
      .mockReset()
      .mockImplementation((e: unknown) => typeof e === 'object' && e !== null && 'status' in e);
  });

  it('disables every curated-out expert and sets the flag on first run', async () => {
    await makeFixture(['cut-1', 'cut-2']);
    const config = makeConfig();

    const ok = await curateExperts(config as never);

    expect(ok).toBe(true);
    expect(setStateMock).toHaveBeenCalledTimes(2);
    expect(setStateMock).toHaveBeenCalledWith({ id: 'cut-1', enabled: false });
    expect(config.store.get(FLAG)).toBe(1);
  });

  it('is a no-op when already curated at the current version', async () => {
    await makeFixture(['cut-1']);
    const config = makeConfig(new Map([[FLAG, 1]]));

    const ok = await curateExperts(config as never);

    expect(ok).toBe(true);
    expect(setStateMock).not.toHaveBeenCalled();
  });

  it('sets the flag without calling setState when the cut list is empty', async () => {
    await makeFixture([]);
    const config = makeConfig();

    const ok = await curateExperts(config as never);

    expect(ok).toBe(true);
    expect(setStateMock).not.toHaveBeenCalled();
    expect(config.store.get(FLAG)).toBe(1);
  });

  it('defers (returns false, flag unset) when every target 404s — seed not applied yet', async () => {
    await makeFixture(['cut-1', 'cut-2']);
    setStateMock.mockRejectedValue({ status: 404 });
    const config = makeConfig();

    const ok = await curateExperts(config as never);

    expect(ok).toBe(false);
    expect(config.store.has(FLAG)).toBe(false);
  });

  it('returns false without the flag on a genuine (non-404) failure', async () => {
    await makeFixture(['cut-1', 'cut-2']);
    setStateMock.mockImplementation(({ id }: { id: string }) =>
      id === 'cut-2' ? Promise.reject({ status: 500 }) : Promise.resolve(undefined)
    );
    const config = makeConfig();

    const ok = await curateExperts(config as never);

    expect(ok).toBe(false);
    expect(config.store.has(FLAG)).toBe(false);
  });
});
