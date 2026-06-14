#!/usr/bin/env bun
/**
 * Match agency advisors to their main agent + builtin skills.
 *
 * The agency advisors (`agency-*`) live in the legacy `assistants` table, which
 * is the CANONICAL source: on every backend startup the definitions table
 * (`assistant_definitions`) is re-derived from `assistants`
 * (`default_skill_ids <- enabled_skills`, `agent_backend <- preset_agent_type`).
 * So we must write to `assistants` — writes to `assistant_definitions` are wiped
 * on the next launch. The advisors ship with EMPTY skills + a uniform agent;
 * this applies a per-advisor mapping so they have sensible capabilities out of
 * the box. Users can still override any advisor's agent/skills in the UI.
 *
 * Mapping lives in `scripts/advisor-skill-map.json` (array of
 * `{ key, agent_backend, skill_ids }`). Re-runnable and idempotent.
 *
 * Usage:
 *   tsx scripts/match-advisor-skills.ts [--dry-run] [--db <path>] [--data-dir <dir>] [--map <path>]
 *   (run with tsx/node — better-sqlite3 is not supported under bun)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

type Mapping = { key: string; agent_backend: string; skill_ids: string[] };

const VALID_SKILLS = new Set([
  'officecli-docx',
  'officecli-pptx',
  'officecli-xlsx',
  'officecli-pitch-deck',
  'officecli-financial-model',
  'officecli-data-dashboard',
  'officecli-academic-paper',
  'officecli-word-form',
  'pdf',
  'mermaid',
]);
const VALID_AGENTS = new Set(['aionrs', 'claude', 'gemini', 'codex', 'qwen', 'goose']);

function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(a, next);
      i++;
    } else {
      args.set(a, true);
    }
  }
  return args;
}

function resolveDefaultDataDir(): string {
  const suffix = process.env.NODE_ENV === 'production' ? '' : process.env.AIONUI_MULTI_INSTANCE === '1' ? '-Dev-2' : '-Dev';
  return path.join(os.homedir(), '.config', `CentaurAI${suffix}`, 'aionui');
}

function resolveDbPath(args: Map<string, string | boolean>): string {
  const explicitDb = args.get('--db');
  if (typeof explicitDb === 'string') return path.resolve(explicitDb);
  const dataDir = args.get('--data-dir') ?? process.env.AIONUI_DATA_DIR;
  const resolvedDataDir = typeof dataDir === 'string' ? path.resolve(dataDir) : resolveDefaultDataDir();
  return path.join(resolvedDataDir, 'aionui-backend.db');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.has('--dry-run');

  const mapPath =
    typeof args.get('--map') === 'string' ? path.resolve(args.get('--map') as string) : path.join(__dirname, 'advisor-skill-map.json');
  if (!fs.existsSync(mapPath)) throw new Error(`Mapping file not found: ${mapPath}`);
  const mapping: Mapping[] = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

  const dbPath = resolveDbPath(args);
  if (!fs.existsSync(dbPath)) throw new Error(`AionUI backend database not found: ${dbPath}`);

  const db = new Database(dbPath);
  const now = Date.now();
  // Write to the canonical `assistants` table (the definitions table is derived
  // from it on startup). enabled_skills = the builtin skill ids; preset_agent_type = main agent.
  const select = db.prepare(`select enabled_skills, preset_agent_type from assistants where id = ?`);
  const update = db.prepare(`update assistants set preset_agent_type = ?, enabled_skills = ?, updated_at = ? where id = ?`);

  let updated = 0;
  let missing = 0;
  let unchanged = 0;
  const invalid: string[] = [];

  const apply = db.transaction((rows: Mapping[]) => {
    for (const row of rows) {
      const skills = (row.skill_ids || []).filter((s) => VALID_SKILLS.has(s));
      const agent = VALID_AGENTS.has(row.agent_backend) ? row.agent_backend : 'aionrs';
      if (skills.length === 0) {
        invalid.push(row.key);
        continue;
      }
      const existing = select.get(row.key) as { enabled_skills: string; preset_agent_type: string } | undefined;
      if (!existing) {
        missing++;
        continue;
      }
      const nextSkills = JSON.stringify(skills);
      if (existing.enabled_skills === nextSkills && existing.preset_agent_type === agent) {
        unchanged++;
        continue;
      }
      if (!dryRun) update.run(agent, nextSkills, now, row.key);
      updated++;
    }
  });
  apply(mapping);

  db.close();

  console.log(`DB              : ${dbPath}`);
  console.log(`Mapping entries : ${mapping.length}`);
  console.log(`${dryRun ? 'Would update' : 'Updated'}    : ${updated}`);
  console.log(`Unchanged       : ${unchanged}`);
  console.log(`Missing in DB   : ${missing}`);
  if (invalid.length) console.log(`Invalid (no valid skills): ${invalid.length} -> ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}`);
}

main();
