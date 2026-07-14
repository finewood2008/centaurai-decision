/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { CreateAssistantRequest, UpdateAssistantRequest } from '@/common/types/agent/assistantTypes';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import type { ProcessConfig as ProcessConfigType } from './initStorage';

/**
 * Seed the bundled "expert library" (agency advisors, `agency-*`) into the
 * backend on startup so a fresh install ships with the full catalog instead of
 * relying on a one-off import. The seed dataset lives in `resources/experts/`:
 *
 *   - `experts.json` — array of {@link CreateAssistantRequest}-shaped rows
 *     (id, name, i18n, avatar/emoji, preset_agent_type, enabled_skills, …).
 *   - `rules/<id>.<locale>.md` — the expert prompt body, per locale
 *     (`zh-CN` translated, `en-US` original).
 *
 * Both phases are content-aware so re-running is safe:
 *   1. `POST /api/assistants/import` is insert-only — already-present experts
 *      (and any user edits to them) are skipped, never clobbered.
 *   2. Rule upload is read-before-write — a non-empty backend rule for an
 *      (id, locale) is left untouched.
 *
 * Gated by a version flag so it normally runs once; bump {@link SEED_VERSION}
 * when the bundled dataset changes to re-seed newly added experts.
 */

const SEED_VERSION = 3;
const SEED_FLAG = 'migration.bundledExpertsSeeded';
const RULE_LOCALES = ['zh-CN', 'en-US'] as const;

type ConfigFile = typeof ProcessConfigType;

type ConfigAccessor = {
  get: (key: string) => Promise<unknown>;
  set?: (key: string, value: unknown) => Promise<unknown>;
};

/** A manifest row: the create-request fields plus the rule-file template. */
type ExpertManifestEntry = CreateAssistantRequest & { rule_file?: string };
type SeedAgent = { id: string; agent_type: string; backend?: string };

/**
 * Locate the bundled experts directory. In production electron-builder copies
 * `resources/experts` → `<resourcesPath>/experts`; in dev it sits in the repo
 * relative to the main bundle (`out/main`). Returns the first candidate that
 * actually holds `experts.json`, or null when the dataset is absent.
 */
export function resolveExpertsDir(): string | null {
  const candidates: string[] = [];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'experts'));

  const baseDir =
    typeof require !== 'undefined' && require.main?.filename ? path.dirname(require.main.filename) : __dirname;
  candidates.push(path.resolve(baseDir, '../../resources/experts'));
  candidates.push(path.resolve(baseDir, '../../../resources/experts'));
  candidates.push(path.resolve(process.cwd(), 'resources/experts'));

  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'experts.json'))) return dir;
  }
  return null;
}

/** Strip the manifest-only `rule_file` field so the import payload matches the wire contract. */
function resolveAgentId(presetAgentType: string | undefined, agents: SeedAgent[]): string | undefined {
  const preset = presetAgentType?.trim().toLowerCase();
  if (!preset) return undefined;
  return agents.find((agent) => agent.backend?.toLowerCase() === preset || agent.agent_type.toLowerCase() === preset)
    ?.id;
}

function toCreateRequest(entry: ExpertManifestEntry, agents: SeedAgent[]): CreateAssistantRequest | null {
  const { rule_file: _ruleFile, preset_agent_type: presetAgentType, ...request } = entry;
  const agentId = entry.agent_id ?? resolveAgentId(presetAgentType, agents);
  if (!agentId) return null;
  return { ...request, agent_id: agentId };
}

function hasTranslations(value: Record<string, unknown> | undefined): boolean {
  return value !== undefined && Object.keys(value).length > 0;
}

async function repairMissingExpertLocalizations(manifest: ExpertManifestEntry[]): Promise<number> {
  const existing = await ipcBridge.assistants.list.invoke();
  const byId = new Map(existing.map((assistant) => [assistant.id, assistant]));
  const patches: UpdateAssistantRequest[] = [];

  for (const entry of manifest) {
    if (!entry.id) continue;
    const assistant = byId.get(entry.id);
    if (!assistant) continue;
    const patch: UpdateAssistantRequest = { id: entry.id };
    if (!hasTranslations(assistant.name_i18n) && hasTranslations(entry.name_i18n)) {
      patch.name_i18n = entry.name_i18n;
    }
    const currentZhDescription = assistant.description_i18n?.['zh-CN'];
    const bundledZhDescription = entry.description_i18n?.['zh-CN'];
    if (!hasTranslations(assistant.description_i18n) && hasTranslations(entry.description_i18n)) {
      patch.description_i18n = entry.description_i18n;
    } else if (
      currentZhDescription?.startsWith('Expert ') &&
      bundledZhDescription &&
      bundledZhDescription !== currentZhDescription
    ) {
      patch.description_i18n = { ...assistant.description_i18n, 'zh-CN': bundledZhDescription };
    }
    if (!hasTranslations(assistant.prompts_i18n) && hasTranslations(entry.prompts_i18n)) {
      patch.prompts_i18n = entry.prompts_i18n;
    }
    if (Object.keys(patch).length > 1) patches.push(patch);
  }

  const outcomes = await Promise.allSettled(patches.map((patch) => ipcBridge.assistants.update.invoke(patch)));
  const failed = outcomes.filter((outcome) => outcome.status === 'rejected').length;
  if (failed > 0) throw new Error(`${failed}/${patches.length} expert localization updates failed`);
  return patches.length;
}

/**
 * Upload the bundled rule bodies for one expert. Skips missing files and any
 * (id, locale) the backend already has non-empty content for. Throws on a
 * genuine write failure so the caller can count it.
 */
async function uploadExpertRules(expertsDir: string, id: string): Promise<void> {
  await Promise.all(
    RULE_LOCALES.map(async (locale) => {
      const filePath = path.join(expertsDir, 'rules', `${id}.${locale}.md`);
      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        return; // No bundled body for this locale.
      }
      if (!content.trim()) return;

      // Read-before-write: never overwrite an existing (e.g. user-edited) rule.
      const existing = await ipcBridge.fs.readAssistantRule.invoke({ assistant_id: id, locale }).catch(() => '');
      if (existing.trim().length > 0) return;

      await ipcBridge.fs.writeAssistantRule.invoke({ assistant_id: id, locale, content });
    })
  );
}

/**
 * Seed bundled experts into the backend. Returns `true` on success (including
 * the no-op cases: already seeded, or no dataset present); `false` on a partial
 * failure so the caller can log it and retry on the next launch.
 */
export async function seedBundledExperts(configFile: ConfigFile): Promise<boolean> {
  const accessor = configFile as unknown as ConfigAccessor;

  let seededVersion = 0;
  try {
    const raw = await accessor.get(SEED_FLAG);
    if (typeof raw === 'number') seededVersion = raw;
  } catch {
    // Treat read errors as "not seeded yet".
  }
  if (seededVersion >= SEED_VERSION) return true;

  const expertsDir = resolveExpertsDir();
  if (!expertsDir) {
    console.warn('[AionUi] Bundled experts dataset not found; skipping expert seed');
    return true;
  }

  let manifest: ExpertManifestEntry[];
  try {
    const raw = await fs.readFile(path.join(expertsDir, 'experts.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    manifest = Array.isArray(parsed) ? (parsed as ExpertManifestEntry[]) : [];
  } catch (error) {
    console.error('[AionUi] Failed to read bundled experts manifest:', error);
    return false;
  }
  if (manifest.length === 0) return true;

  // Phase 1: import the catalog rows (insert-only).
  try {
    const agents = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    const requests = manifest.map((entry) => toCreateRequest(entry, agents));
    const unresolved = manifest.filter((_, index) => requests[index] === null).map((entry) => entry.id);
    if (unresolved.length > 0) {
      console.error(`[AionUi] Expert seed has no matching Core agent for: ${unresolved.join(', ')}`);
      return false;
    }
    const result = await ipcBridge.assistants.import.invoke({
      assistants: requests.filter((request): request is CreateAssistantRequest => request !== null),
    });
    if (result.failed !== 0) {
      console.error(`[AionUi] Expert seed import partial: ${result.failed} failed`, result.errors);
      return false;
    }
    if (result.imported > 0 || result.skipped > 0) {
      console.log(`[AionUi] Seeded ${result.imported} experts (skipped ${result.skipped})`);
    }
  } catch (error) {
    console.error('[AionUi] Expert seed import failed:', error);
    return false;
  }

  // Core versions before the unified-definition i18n fix imported the legacy
  // row correctly but projected empty locale maps. Repair only empty maps (and
  // four historically mislabelled `Expert ...` zh-CN descriptions) so an
  // existing user-edited translation is never overwritten.
  try {
    const repaired = await repairMissingExpertLocalizations(manifest);
    if (repaired > 0) console.log(`[AionUi] Repaired localization for ${repaired} experts`);
  } catch (error) {
    console.error('[AionUi] Expert localization repair failed:', error);
    return false;
  }

  // Phase 2: upload the per-locale rule bodies (read-before-write).
  let ruleFailures = 0;
  const outcomes = await Promise.allSettled(
    manifest.map((entry) => (entry.id ? uploadExpertRules(expertsDir, entry.id) : Promise.resolve()))
  );
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      ruleFailures += 1;
      console.error(`[AionUi] Failed to seed rules for '${manifest[index].id}':`, outcome.reason);
    }
  });
  if (ruleFailures > 0) {
    console.error(`[AionUi] Expert rule seed partial: ${ruleFailures}/${manifest.length} failed`);
    return false;
  }

  if (typeof accessor.set === 'function') {
    try {
      await accessor.set(SEED_FLAG, SEED_VERSION);
    } catch (error) {
      console.warn('[AionUi] Failed to persist expert seed flag', error);
    }
  }
  return true;
}
