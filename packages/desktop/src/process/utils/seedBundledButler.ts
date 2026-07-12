/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { CreateAssistantRequest } from '@/common/types/agent/assistantTypes';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import type { ProcessConfig as ProcessConfigType } from './initStorage';

/**
 * Seed the built-in "CentaurAI 管家" (butler) assistant — a meta-management
 * assistant that configures and diagnoses CentaurAI itself in plain language.
 *
 * The bundled aioncore predates the upstream AionUi Butler, so its two skills
 * ship with the fork and are injected **additively** (no binary change, nothing
 * clobbered): the skill dirs are copied into the custom-skill registry via
 * `POST /api/skills/import`, then the assistant is imported referencing them by
 * `custom_skill_names`. The remote-access / public-link skill is intentionally
 * omitted — CentaurAI's LAN access is handled by the product itself.
 *
 * Dataset lives in `resources/butler/`:
 *   - `butler.json`            — { version, skills[], assistant } (the assistant
 *                                is a {@link CreateAssistantRequest}).
 *   - `skills/<name>/`         — the skill dirs imported as custom skills.
 *   - `rules/<id>.<locale>.md` — the persona body, per locale.
 *
 * Idempotent & content-aware so re-running is safe: assistant import is
 * insert-only, rule upload is read-before-write, and skill import tolerates an
 * already-present skill. Gated by {@link SEED_VERSION}; bump it to re-seed.
 */

const SEED_VERSION = 1;
const SEED_FLAG = 'migration.bundledButlerSeeded';
const RULE_LOCALES = ['zh-CN', 'en-US'] as const;

type ConfigFile = typeof ProcessConfigType;

type ConfigAccessor = {
  get: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown) => Promise<unknown>;
};

type ButlerManifest = {
  version?: number;
  skills: string[];
  assistant: CreateAssistantRequest & { id: string };
};
type SeedAgent = { id: string; agent_type: string; backend?: string };

/**
 * Locate the bundled butler directory. In production electron-builder copies
 * `resources/butler` → `<resourcesPath>/butler`; in dev it sits in the repo
 * relative to the main bundle. Returns the first candidate that holds
 * `butler.json`, or null when the dataset is absent.
 */
export function resolveButlerDir(): string | null {
  const candidates: string[] = [];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'butler'));

  const baseDir =
    typeof require !== 'undefined' && require.main?.filename ? path.dirname(require.main.filename) : __dirname;
  candidates.push(path.resolve(baseDir, '../../resources/butler'));
  candidates.push(path.resolve(baseDir, '../../../resources/butler'));
  candidates.push(path.resolve(process.cwd(), 'resources/butler'));

  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'butler.json'))) return dir;
  }
  return null;
}

/**
 * Import the butler's skill dirs as custom skills (additive copy). Tolerant of
 * an already-present skill so re-runs don't fail. Returns the set of skill
 * names that are present afterwards.
 */
async function importButlerSkills(butlerDir: string, skills: string[]): Promise<Set<string>> {
  const present = new Set<string>();
  for (const name of skills) {
    const skillPath = path.join(butlerDir, 'skills', name);
    if (!existsSync(path.join(skillPath, 'SKILL.md'))) {
      console.error(`[CentaurAI] Butler skill missing on disk: ${name}`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential: skill imports copy into a shared registry; parallel would race
      const res = await ipcBridge.fs.importSkill.invoke({ skill_path: skillPath });
      present.add(res?.skill_name || name);
    } catch (error) {
      // Most likely already imported on a previous run — treat as present.
      console.warn(`[CentaurAI] Butler skill import for '${name}' failed (may already exist):`, error);
      present.add(name);
    }
  }
  return present;
}

/** Upload the butler persona bodies (read-before-write, skip non-empty existing). */
async function uploadButlerRules(butlerDir: string, id: string): Promise<void> {
  await Promise.all(
    RULE_LOCALES.map(async (locale) => {
      const filePath = path.join(butlerDir, 'rules', `${id}.${locale}.md`);
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        return; // No bundled body for this locale.
      }
      if (!content.trim()) return;

      const existing = await ipcBridge.fs.readAssistantRule.invoke({ assistant_id: id, locale }).catch(() => '');
      if (existing.trim().length > 0) return;

      await ipcBridge.fs.writeAssistantRule.invoke({ assistant_id: id, locale, content });
    })
  );
}

/**
 * Seed the bundled butler. Returns `true` on success (including no-ops: already
 * seeded, or dataset absent); `false` on a partial failure so the caller logs
 * it and retries on the next launch.
 */
export async function seedBundledButler(configFile: ConfigFile): Promise<boolean> {
  const accessor = configFile as unknown as ConfigAccessor;

  let seededVersion = 0;
  try {
    const raw = await accessor.get(SEED_FLAG);
    if (typeof raw === 'number') seededVersion = raw;
  } catch {
    // Treat read errors as "not seeded yet".
  }
  if (seededVersion >= SEED_VERSION) return true;

  const butlerDir = resolveButlerDir();
  if (!butlerDir) {
    console.warn('[CentaurAI] Bundled butler dataset not found; skipping butler seed');
    return true;
  }

  let manifest: ButlerManifest;
  try {
    const raw = await fs.readFile(path.join(butlerDir, 'butler.json'), 'utf-8');
    manifest = JSON.parse(raw) as ButlerManifest;
  } catch (error) {
    console.error('[CentaurAI] Failed to read butler manifest:', error);
    return false;
  }
  if (!manifest?.assistant?.id) {
    console.error('[CentaurAI] Butler manifest missing assistant.id');
    return false;
  }

  // Phase 0: import the butler's skills as custom skills (additive).
  const present = await importButlerSkills(butlerDir, manifest.skills ?? []);
  const wanted = manifest.assistant.custom_skill_names ?? [];
  const missing = wanted.filter((name) => !present.has(name));
  if (missing.length > 0) {
    console.error(`[CentaurAI] Butler skills not available, deferring seed: ${missing.join(', ')}`);
    return false;
  }

  // Phase 1: import the assistant row (insert-only — never clobbers user edits).
  try {
    const agents = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    const preset = manifest.assistant.preset_agent_type?.trim().toLowerCase();
    const agentId =
      manifest.assistant.agent_id ??
      agents.find(
        (agent: SeedAgent) => agent.backend?.toLowerCase() === preset || agent.agent_type.toLowerCase() === preset
      )?.id;
    if (!agentId) {
      console.error(`[CentaurAI] Butler seed has no matching Core agent for '${preset || '<missing>'}'`);
      return false;
    }
    const { preset_agent_type: _presetAgentType, ...assistant } = manifest.assistant;
    const result = await ipcBridge.assistants.import.invoke({ assistants: [{ ...assistant, agent_id: agentId }] });
    if (result.failed !== 0) {
      console.error('[CentaurAI] Butler assistant import failed', result.errors);
      return false;
    }
  } catch (error) {
    console.error('[CentaurAI] Butler assistant import threw:', error);
    return false;
  }

  // Phase 2: upload the persona bodies (read-before-write).
  try {
    await uploadButlerRules(butlerDir, manifest.assistant.id);
  } catch (error) {
    console.error('[CentaurAI] Butler rule upload failed:', error);
    return false;
  }

  if (typeof accessor.set === 'function') {
    try {
      await accessor.set(SEED_FLAG, SEED_VERSION);
    } catch (error) {
      console.warn('[CentaurAI] Failed to persist butler seed flag', error);
    }
  }
  console.log('[CentaurAI] Seeded CentaurAI 管家 (butler) with skills:', [...present].join(', '));
  return true;
}
