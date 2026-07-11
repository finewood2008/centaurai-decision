/**
 * Resolve immutable release locks for the new and rollback Core binaries.
 * There is intentionally no "latest" or ad-hoc version fallback.
 */

const fs = require('fs');
const path = require('path');

const RELEASES = {
  centaur: {
    displayName: 'CentaurAI Core',
    envName: 'CENTAURAI_CORE_RELEASE_LOCK',
    lockFile: 'centaurai-core-release.lock.json',
    packageField: 'centauraiCoreVersion',
    repository: 'finewood2008/centaurai-core',
  },
  legacy: {
    displayName: 'Legacy AionCore',
    envName: 'LEGACY_AIONCORE_RELEASE_LOCK',
    lockFile: 'legacy-aioncore-release.lock.json',
    packageField: 'legacyAioncoreVersion',
    repository: 'iOfficeAI/AionCore',
  },
};

function resolveRelease(projectRoot, releaseType) {
  const spec = RELEASES[releaseType];
  if (!spec) throw new Error(`Unknown Core release type: ${releaseType}`);
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const pinnedTag = packageJson[spec.packageField];
  if (typeof pinnedTag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(pinnedTag)) {
    throw new Error(`package.json must pin ${spec.packageField} to an exact vX.Y.Z tag`);
  }

  const lockPath = process.env[spec.envName]
    ? path.resolve(process.env[spec.envName])
    : path.join(projectRoot, 'resources', spec.lockFile);
  let release;
  try {
    release = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  } catch (error) {
    throw new Error(`${spec.displayName} release lock is required: ${lockPath}`, { cause: error });
  }
  if (release.repository !== spec.repository) {
    throw new Error(`${spec.displayName} release lock has an unexpected repository`);
  }
  if (release.tag !== pinnedTag) {
    throw new Error(`${spec.displayName} release lock tag ${release.tag || '<missing>'} does not match ${pinnedTag}`);
  }
  if (typeof release.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(release.commit)) {
    throw new Error(`${spec.displayName} release lock must contain an exact 40-character commit`);
  }
  if (!release.assets || typeof release.assets !== 'object' || Array.isArray(release.assets)) {
    throw new Error(`${spec.displayName} release lock must contain an assets map`);
  }
  const assets = Object.entries(release.assets);
  if (assets.length === 0) {
    throw new Error(`${spec.displayName} release lock must contain at least one asset SHA-256`);
  }
  for (const [asset, sha256] of assets) {
    if (!asset || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`${spec.displayName} release lock has an invalid SHA-256 for ${asset || '<empty>'}`);
    }
  }
  return { ...release, lockPath, releaseType };
}

function resolveCentauraiCoreRelease(projectRoot) {
  return resolveRelease(projectRoot, 'centaur');
}

function resolveLegacyAioncoreRelease(projectRoot) {
  return resolveRelease(projectRoot, 'legacy');
}

module.exports = {
  resolveCentauraiCoreRelease,
  resolveLegacyAioncoreRelease,
  // Temporary compatibility export for scripts outside this maintenance branch.
  resolveAioncoreVersion: (projectRoot) => resolveCentauraiCoreRelease(projectRoot).tag,
};
