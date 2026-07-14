#!/usr/bin/env node
/** Fail on lint errors or any warning not present in the reviewed legacy baseline. */
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const baseline = require('../.oxlint-baseline.json');

const executable = path.resolve(
  __dirname,
  process.platform === 'win32' ? '../node_modules/.bin/oxlint.cmd' : '../node_modules/.bin/oxlint'
);
const result = spawnSync(executable, ['--format', 'json'], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

if (result.error) {
  console.error(`❌ Unable to run oxlint: ${result.error.message}`);
  process.exit(1);
}

let diagnostics;
try {
  diagnostics = JSON.parse(result.stdout || '{}').diagnostics || [];
} catch {
  process.stderr.write(result.stderr || result.stdout || 'Oxlint returned invalid JSON.\n');
  process.exit(1);
}

const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
if (errors.length > 0) {
  console.error(`❌ Oxlint found ${errors.length} error(s). Run \`bun run lint:raw\` for details.`);
  process.exit(1);
}

const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
const counts = new Map();
for (const warning of warnings) {
  const key = [warning.filename, warning.code, warning.message].join('\0');
  counts.set(key, (counts.get(key) || 0) + 1);
}
const canonical = [...counts]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([key, count]) => `${count}\0${key}`)
  .join('\n');
const fingerprintSha256 = createHash('sha256').update(canonical).digest('hex');

if (warnings.length !== baseline.diagnosticCount || fingerprintSha256 !== baseline.fingerprintSha256) {
  console.error(
    `❌ Lint warning baseline changed: expected ${baseline.diagnosticCount}, found ${warnings.length}. ` +
      'Run `bun run lint:raw` and fix every new warning; only reduce the baseline in a dedicated cleanup.'
  );
  process.exit(1);
}

console.log(`✅ Oxlint passed with 0 new warnings (${warnings.length} reviewed legacy warnings remain fingerprinted).`);
