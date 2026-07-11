/**
 * CLI wrapper for immutable CentaurAI Core packaging.
 *
 * Reads environment variables and invokes the shared module.
 *
 * Environment variables:
 *  - CENTAURAI_CORE_RELEASE_LOCK: immutable tag/commit/SHA lock file
 *  - AIONUI_BACKEND_ARCH: target architecture (default: process.arch)
 */

const path = require('path');
const { prepareCentauraiCore, prepareLegacyAioncore } = require('../packages/shared-scripts/src/prepare-aioncore.js');
const { resolveCentauraiCoreRelease, resolveLegacyAioncoreRelease } = require('./resolveAioncoreVersion.js');

const projectRoot = path.resolve(__dirname, '..');
const platform = process.platform;
// Support cross-compilation: AIONUI_BACKEND_ARCH > npm_config_target_arch > process.arch
const arch = process.env.AIONUI_BACKEND_ARCH || process.env.npm_config_target_arch || process.arch;
function prepareLockedCoreBundles() {
  const centaur = prepareCentauraiCore({
    projectRoot,
    platform,
    arch,
    release: resolveCentauraiCoreRelease(projectRoot),
  });
  const legacy = prepareLegacyAioncore({
    projectRoot,
    platform,
    arch,
    release: resolveLegacyAioncoreRelease(projectRoot),
  });
  return { centaur, legacy };
}

try {
  prepareLockedCoreBundles();
} catch (error) {
  console.error('❌ prepareAioncore failed:', error.message);
  process.exit(1);
}

module.exports = function () {
  try {
    return prepareLockedCoreBundles();
  } catch (error) {
    console.error('❌ prepareAioncore failed:', error.message);
    throw error;
  }
};
