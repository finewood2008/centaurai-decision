#!/usr/bin/env bun
/**
 * Import agency-agents Markdown bodies into the local assistant definition DB.
 *
 * The current advisor catalog stores agency advisors as `user_file` rule
 * resources. If the backing files are missing from the backend data dir, the
 * advisor cards still render but the assistants have no working rules. This
 * script makes those definitions self-contained by storing the Markdown body
 * as inline rule content.
 */

import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_AGENCY_REPO = 'https://github.com/msitarzewski/agency-agents.git';
const DEFAULT_SOURCE_DIR = path.join(os.tmpdir(), 'agency-agents');

type Frontmatter = Record<string, string>;

type AgentDoc = {
  keyCandidates: string[];
  name: string;
  description: string;
  emoji?: string;
  body: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  academic: '学术',
  design: '设计',
  engineering: '工程开发',
  finance: '财务',
  'game-development': '游戏开发',
  gis: '地理信息',
  integrations: '集成',
  marketing: '市场营销',
  'paid-media': '付费媒体',
  product: '产品',
  'project-management': '项目管理',
  sales: '销售',
  security: '安全',
  specialized: '专项专家',
  'spatial-computing': '空间计算',
  strategy: '战略',
  support: '技术支持',
  testing: '测试',
};

const ROLE_TOKEN_LABELS: Record<string, string> = {
  account: '客户',
  analyst: '分析',
  analytics: '分析',
  api: 'API',
  architect: '架构',
  automation: '自动化',
  backend: '后端',
  brand: '品牌',
  business: '业务',
  cloud: '云安全',
  code: '代码',
  compliance: '合规',
  content: '内容',
  creative: '创意',
  data: '数据',
  database: '数据库',
  developer: '开发',
  devops: '运维',
  discovery: '需求发现',
  ecommerce: '电商',
  engineer: '工程',
  executive: '高管汇报',
  finance: '财务',
  frontend: '前端',
  growth: '增长',
  incident: '事件响应',
  jira: 'Jira',
  legal: '法务',
  manager: '管理',
  marketing: '营销',
  media: '媒体',
  mobile: '移动端',
  operations: '运营',
  performance: '性能',
  product: '产品',
  project: '项目',
  qa: '质量',
  research: '研究',
  researcher: '研究',
  sales: '销售',
  security: '安全',
  seo: 'SEO',
  social: '社媒',
  strategist: '策略',
  strategy: '战略',
  support: '支持',
  technical: '技术',
  testing: '测试',
  ux: '体验',
  writer: '写作',
};

function parseArgs(): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (!arg.startsWith('--')) continue;
    const next = raw[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(arg, next);
      i++;
    } else {
      args.set(arg, true);
    }
  }
  return args;
}

async function fetchJson<T>(baseUrl: string, pathName: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { success?: boolean; data?: T; error?: string }) : {};
  if (!response.ok || payload.success === false) {
    throw new Error(`${init?.method ?? 'GET'} ${pathName} failed (${response.status}): ${text}`);
  }
  return (payload.data ?? payload) as T;
}

function resolveDefaultDataDir(): string {
  const suffix =
    process.env.NODE_ENV === 'production' ? '' : process.env.AIONUI_MULTI_INSTANCE === '1' ? '-Dev-2' : '-Dev';
  return path.join(os.homedir(), '.config', `CentaurAI${suffix}`, 'aionui');
}

function resolveDbPath(args: Map<string, string | boolean>): string {
  const explicitDb = args.get('--db');
  if (typeof explicitDb === 'string') return path.resolve(explicitDb);

  const dataDir = args.get('--data-dir') ?? process.env.AIONUI_DATA_DIR;
  const resolvedDataDir = typeof dataDir === 'string' ? path.resolve(dataDir) : resolveDefaultDataDir();
  return path.join(resolvedDataDir, 'aionui-backend.db');
}

function runGit(args: string[], cwd?: string): void {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`git ${args.join(' ')} failed${output ? `:\n${output}` : ''}`);
  }
}

function ensureSourceDir(args: Map<string, string | boolean>): string {
  const explicitSource = args.get('--source');
  const sourceDir = path.resolve(typeof explicitSource === 'string' ? explicitSource : DEFAULT_SOURCE_DIR);
  if (fs.existsSync(sourceDir)) return sourceDir;

  if (typeof explicitSource === 'string') {
    throw new Error(`agency-agents source directory not found: ${sourceDir}`);
  }

  console.log(`Source directory not found. Cloning ${DEFAULT_AGENCY_REPO} into ${sourceDir}`);
  runGit(['clone', '--depth', '1', DEFAULT_AGENCY_REPO, sourceDir]);
  return sourceDir;
}

function parseFrontmatter(content: string): { frontmatter?: Frontmatter; body: string } {
  if (!content.startsWith('---\n')) return { body: content.trim() };

  const end = content.indexOf('\n---', 4);
  if (end === -1) return { body: content.trim() };

  const raw = content.slice(4, end).trim();
  const body = content.slice(end + 4).trim();
  const frontmatter: Frontmatter = {};

  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    frontmatter[key] = value.trim().replace(/^["']|["']$/g, '');
  }

  return { frontmatter, body };
}

function walkMarkdownFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === '.github' || entry.name === 'scripts') continue;
      files.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function toTitleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildKeyCandidates(rootDir: string, filePath: string): string[] {
  const rel = path.relative(rootDir, filePath);
  const parts = rel.split(path.sep);
  const filename = parts.at(-1)?.replace(/\.md$/, '') ?? '';
  const topLevel = parts[0];
  const parent = parts.length > 1 ? (parts.at(-2) ?? topLevel) : topLevel;
  const candidates = new Set<string>();

  if (parts.length >= 2) {
    candidates.add(`agency-${topLevel}-${filename}`);
    candidates.add(`agency-${topLevel}-${topLevel}-${filename}`);
    candidates.add(`agency-${topLevel}-${parent}-${filename}`);
  }

  candidates.add(`agency-${filename}`);
  candidates.add(`agency-${filename}`.slice(0, 64));
  for (const key of [...candidates]) candidates.add(key.slice(0, 64));

  return [...candidates].filter((key) => key.length > 'agency-'.length);
}

function loadAgentDocs(rootDir: string): AgentDoc[] {
  const docs: AgentDoc[] = [];
  for (const filePath of walkMarkdownFiles(rootDir)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    if (!body) continue;

    const rel = path.relative(rootDir, filePath);
    const filename = path.basename(filePath, '.md');
    const category = rel.split(path.sep)[0];
    const isAgentDoc = !!frontmatter?.name && !!frontmatter.description;
    const fallbackTitle = toTitleCase(filename);

    docs.push({
      keyCandidates: buildKeyCandidates(rootDir, filePath),
      name: frontmatter?.name ?? fallbackTitle,
      description: frontmatter?.description ?? `Agency ${toTitleCase(category)} reference: ${fallbackTitle}`,
      emoji: frontmatter?.emoji,
      body,
    });
  }
  return docs;
}

async function importViaApi(baseUrl: string, docsByKey: Map<string, AgentDoc>, dryRun: boolean): Promise<void> {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const assistants = await fetchJson<Array<{ id: string }>>(normalizedBaseUrl, '/api/assistants');
  const agencyAssistants = assistants.filter((assistant) => assistant.id.startsWith('agency-'));
  const missing: string[] = [];
  let matched = 0;
  let updated = 0;

  for (const assistant of agencyAssistants) {
    const doc = docsByKey.get(assistant.id);
    if (!doc) {
      missing.push(assistant.id);
      continue;
    }

    matched++;
    if (!dryRun) {
      for (const locale of ['en-US', 'zh-CN']) {
        await fetchJson<boolean>(normalizedBaseUrl, '/api/skills/assistant-rule/write', {
          method: 'POST',
          body: JSON.stringify({
            assistant_id: assistant.id,
            locale,
            content: doc.body,
          }),
        });
      }
    }
    updated++;
  }

  console.log(`Agency assistants: ${agencyAssistants.length}`);
  console.log(`Matched          : ${matched}`);
  console.log(`${dryRun ? 'Would write' : 'Wrote'}          : ${updated} rules x 2 locales`);
  console.log(`Missing          : ${missing.length}`);
  if (missing.length > 0) {
    console.log('');
    console.log('Missing keys:');
    for (const key of missing) console.log(`- ${key}`);
  }
}

function parseJsonObject(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function resolveCategoryKey(assistantKey: string): string | null {
  const parts = assistantKey.replace(/^agency-/, '').split('-');
  const twoPart = `${parts[0]}-${parts[1]}`;
  if (CATEGORY_LABELS[twoPart]) return twoPart;
  if (CATEGORY_LABELS[parts[0]]) return parts[0];
  return null;
}

function buildChineseDescription(assistantKey: string): string {
  const categoryKey = resolveCategoryKey(assistantKey);
  const category = categoryKey ? CATEGORY_LABELS[categoryKey] : '行业';
  const categoryTokens = categoryKey?.split('-') ?? [];
  const roleTokens = assistantKey
    .replace(/^agency-/, '')
    .split('-')
    .filter((part) => part && part !== categoryKey && !categoryTokens.includes(part))
    .map((part) => ROLE_TOKEN_LABELS[part])
    .filter(Boolean);
  const role = roleTokens.length > 0 ? [...new Set(roleTokens)].join('') : '专业';

  return `${category}${role}顾问，提供问题诊断、方案建议与落地路径。`;
}

function hasCjkText(value: string | undefined): boolean {
  return !!value && /[\u3400-\u9fff]/.test(value);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rootDir = ensureSourceDir(args);
  const dryRun = args.has('--dry-run');
  const api = args.get('--api');

  const docs = loadAgentDocs(rootDir);
  const docsByKey = new Map<string, AgentDoc>();
  for (const doc of docs) {
    for (const key of doc.keyCandidates) docsByKey.set(key, doc);
  }

  console.log(`Source docs       : ${docs.length}`);

  if (typeof api === 'string') {
    await importViaApi(api, docsByKey, dryRun);
    return;
  }

  const dbPath = resolveDbPath(args);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`AionUI backend database not found: ${dbPath}`);
  }

  const db = new Database(dbPath);
  const definitions = db
    .prepare(
      `select definition_id, assistant_key, name, description_i18n
       from assistant_definitions
       where assistant_key like 'agency-%' and deleted_at is null
       order by assistant_key`
    )
    .all() as Array<{
    definition_id: string;
    assistant_key: string;
    name: string;
    description_i18n: string | null;
  }>;

  let matched = 0;
  let updated = 0;
  const missing: string[] = [];

  const update = db.prepare(
    `update assistant_definitions
     set description = @description,
         description_i18n = @description_i18n,
         avatar_type = case
           when @emoji is not null and @emoji != '' then 'emoji'
           else avatar_type
         end,
         avatar_value = case
           when @emoji is not null and @emoji != '' then @emoji
           else avatar_value
         end,
         rule_resource_type = 'inline',
         rule_resource_ref = null,
         rule_inline_content = @rule_inline_content,
         updated_at = @updated_at
     where definition_id = @definition_id`
  );

  const run = db.transaction(() => {
    for (const definition of definitions) {
      const doc = docsByKey.get(definition.assistant_key);
      if (!doc) {
        missing.push(definition.assistant_key);
        continue;
      }

      matched++;
      const descriptionI18n = parseJsonObject(definition.description_i18n);
      const zhDescription = hasCjkText(descriptionI18n['zh-CN'])
        ? descriptionI18n['zh-CN']
        : buildChineseDescription(definition.assistant_key);

      if (!dryRun) {
        update.run({
          definition_id: definition.definition_id,
          description: doc.description,
          description_i18n: JSON.stringify({
            ...descriptionI18n,
            'en-US': doc.description,
            'zh-CN': zhDescription,
          }),
          emoji: doc.emoji ?? '',
          rule_inline_content: doc.body,
          updated_at: Date.now(),
        });
      }
      updated++;
    }
  });

  run();
  db.close();

  console.log(`Agency definitions: ${definitions.length}`);
  console.log(`Matched           : ${matched}`);
  console.log(`${dryRun ? 'Would update' : 'Updated'}           : ${updated}`);
  console.log(`Missing           : ${missing.length}`);
  if (missing.length > 0) {
    console.log('');
    console.log('Missing keys:');
    for (const key of missing) console.log(`- ${key}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
