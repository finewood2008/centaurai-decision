/** Prepare the immutable primary and rollback Core bundles. */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE_VARIANTS = {
  centaur: {
    assetPrefix: 'centaurai-core',
    binaryBaseName: 'centaurai-core',
    bundleDirName: 'bundled-centaurai-core',
    displayName: 'CentaurAI Core',
    repository: 'finewood2008/centaurai-core',
    tempDirName: 'centaurai-core-prepare',
  },
  legacy: {
    assetPrefix: 'aioncore',
    binaryBaseName: 'aioncore',
    bundleDirName: 'bundled-aioncore',
    displayName: 'Legacy AionCore',
    repository: 'iOfficeAI/AionCore',
    tempDirName: 'legacy-aioncore-prepare',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyFileSafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function getVariant(variantName) {
  const variant = CORE_VARIANTS[variantName];
  if (!variant) throw new Error(`Unknown Core bundle variant: ${variantName}`);
  return variant;
}

function getBinaryName(platform, variant) {
  return platform === 'win32' ? `${variant.binaryBaseName}.exe` : variant.binaryBaseName;
}

function prepareManagedResources(binaryPath, targetDir) {
  const bundleOut = path.join(targetDir, 'managed-resources');
  const dataDir = path.join(targetDir, '.prepare-data');

  removeDirectorySafe(bundleOut);
  removeDirectorySafe(dataDir);
  ensureDirectory(bundleOut);
  ensureDirectory(dataDir);

  console.log(`  Preparing managed resources under ${path.relative(process.cwd(), bundleOut)}`);
  execFileSync(binaryPath, ['--data-dir', dataDir, 'prepare-managed-resources', '--bundle-out', bundleOut], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CENTAURAI_CORE_BUNDLED_MANAGED_RESOURCES: '',
      AIONUI_BUNDLED_MANAGED_RESOURCES: '',
    },
  });

  removeDirectorySafe(dataDir);
  return bundleOut;
}

// ---------------------------------------------------------------------------
// Source resolvers
// ---------------------------------------------------------------------------

/**
 * Build the release asset filename for the given platform/arch/tag.
 *
 * Expected asset naming convention:
 *   centaurai-core-v0.1.48-aarch64-apple-darwin.tar.gz
 */
function getAssetName(platform, arch, tag, variantName = 'centaur') {
  const variant = getVariant(variantName);
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = {
    darwin: 'apple-darwin',
    linux: 'unknown-linux-gnu',
    win32: 'pc-windows-msvc',
  };
  const normalizedArch = archMap[arch];
  const normalizedPlatform = platformMap[platform];
  if (!normalizedArch || !normalizedPlatform) return null;
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `${variant.assetPrefix}-${tag}-${normalizedArch}-${normalizedPlatform}${ext}`;
}

function getDownloadUrl(assetName, tag, variant) {
  return `https://github.com/${variant.repository}/releases/download/${tag}/${assetName}`;
}

function downloadFile(url, outputPath, displayName, authToken) {
  console.log(`  Downloading ${displayName} from ${url}`);
  if (authToken) {
    throw new Error('Authenticated release downloads must use the GitHub asset API');
  }
  if (process.platform === 'win32') {
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 120000,
    });
    return;
  }
  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '-o', outputPath, url], { timeout: 120000 });
  } catch {
    execFileSync('wget', ['-q', '-O', outputPath, url], { timeout: 120000 });
  }
}

function downloadAuthenticatedReleaseAsset(repository, tag, assetName, outputPath, authToken) {
  const commonHeaders = ['-H', `Authorization: Bearer ${authToken}`, '-H', 'X-GitHub-Api-Version: 2022-11-28'];
  let release;
  try {
    const response = execFileSync(
      'curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        ...commonHeaders,
        '-H',
        'Accept: application/vnd.github+json',
        `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
      ],
      { encoding: 'utf8', timeout: 120000 }
    );
    release = JSON.parse(response);
  } catch {
    throw new Error(`Unable to resolve authenticated GitHub release ${repository}@${tag}`);
  }
  const asset = Array.isArray(release.assets)
    ? release.assets.find((candidate) => candidate && candidate.name === assetName)
    : undefined;
  if (!asset || typeof asset.url !== 'string') {
    throw new Error(`Release ${repository}@${tag} does not contain ${assetName}`);
  }
  try {
    execFileSync(
      'curl',
      [
        '-L',
        '--fail',
        '--silent',
        '--show-error',
        ...commonHeaders,
        '-H',
        'Accept: application/octet-stream',
        '-o',
        outputPath,
        asset.url,
      ],
      { timeout: 120000 }
    );
  } catch {
    throw new Error(`Authenticated download failed for ${assetName}`);
  }
}

function extractArchive(archivePath, outputDir, platform) {
  ensureDirectory(outputDir);
  if (platform === 'win32' || archivePath.endsWith('.zip')) {
    if (platform === 'win32') {
      const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', outputDir]);
    }
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', outputDir]);
  }
}

function findBinaryInDir(dir, binaryName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === binaryName) return fullPath;
    if (entry.isDirectory()) {
      const found = findBinaryInDir(fullPath, binaryName);
      if (found) return found;
    }
  }
  return null;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function downloadAndExtract(platform, arch, tag, expectedSha256, variantName) {
  const variant = getVariant(variantName);
  const assetName = getAssetName(platform, arch, tag, variantName);
  if (!assetName) {
    throw new Error(`Unsupported ${variant.displayName} target: ${platform}-${arch}`);
  }

  const url = getDownloadUrl(assetName, tag, variant);
  const tempDir = path.join(os.tmpdir(), variant.tempDirName, tag, `${platform}-${arch}`);
  const archivePath = path.join(tempDir, assetName);
  const extractDir = path.join(tempDir, 'extracted');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  const authToken =
    variantName === 'centaur'
      ? process.env.GH_COMPONENT_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN
      : undefined;
  if (authToken) {
    console.log(`  Downloading ${variant.displayName} through the authenticated GitHub asset API`);
    downloadAuthenticatedReleaseAsset(variant.repository, tag, assetName, archivePath, authToken);
  } else {
    downloadFile(url, archivePath, variant.displayName);
  }
  const actualSha256 = sha256File(archivePath);
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${assetName}: expected ${expectedSha256}, received ${actualSha256}`);
  }
  extractArchive(archivePath, extractDir, platform);

  const binaryName = getBinaryName(platform, variant);
  const binaryPath = findBinaryInDir(extractDir, binaryName);
  if (!binaryPath) {
    throw new Error(`Binary ${binaryName} not found in downloaded archive`);
  }

  return { assetName, binaryPath, tempDir, url, sha256: actualSha256 };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Prepare CentaurAI Core binary for packaging.
 *
 * @param {object} options - Configuration options
 * @param {string} options.projectRoot - Project root directory
 * @param {string} options.platform - Target platform (process.platform)
 * @param {string} options.arch - Target architecture (process.arch)
 * @param {{tag: string; commit: string; assets: Record<string, string>}} options.release
 * @returns {{ prepared: true; dir: string; sourceType: string }}
 */
function prepareCoreBundle(options, variantName) {
  const variant = getVariant(variantName);
  const { projectRoot, platform, arch, release } = options;
  const runtimeKey = `${platform}-${arch}`;
  if (!release || !release.tag || !release.commit || !release.assets) {
    throw new Error(`An immutable ${variant.displayName} release lock is required`);
  }
  if (release.repository && release.repository !== variant.repository) {
    throw new Error(`${variant.displayName} release lock has an unexpected repository`);
  }
  const tag = release.tag;
  const assetName = getAssetName(platform, arch, tag, variantName);
  const expectedSha256 = assetName ? release.assets[assetName] : undefined;
  if (!assetName || typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    throw new Error(`${variant.displayName} release lock is missing SHA-256 for ${assetName || runtimeKey}`);
  }

  const targetDir = path.join(projectRoot, 'resources', variant.bundleDirName, runtimeKey);
  const binaryName = getBinaryName(platform, variant);
  const targetBinaryPath = path.join(targetDir, binaryName);

  console.log(`Preparing ${variant.displayName} for ${runtimeKey} (version: ${tag}, commit: ${release.commit})`);

  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  let sourcePath = null;
  let sourceType = 'none';
  let sourceDetail = {};
  let tempDir = null;

  const result = downloadAndExtract(platform, arch, tag, expectedSha256, variantName);
  sourcePath = result.binaryPath;
  tempDir = result.tempDir;
  sourceType = 'download';
  sourceDetail = { url: result.url, asset: result.assetName, sha256: result.sha256, commit: release.commit };
  console.log(`  Downloaded and verified from GitHub releases`);

  // Write result
  if (sourcePath) {
    copyFileSafe(sourcePath, targetBinaryPath);
    ensureExecutableMode(targetBinaryPath);
    const bundledManagedResourcesDir = prepareManagedResources(targetBinaryPath, targetDir);

    // The release tag is the authoritative version — the aioncore
    // binary does not expose a --version flag (it has --app-version which
    // takes a value, not a self-report).
    const manifest = {
      platform,
      arch,
      version: tag,
      commit: release.commit,
      sha256: expectedSha256,
      repository: variant.repository,
      releaseType: variantName,
      generatedAt: new Date().toISOString(),
      sourceType,
      source: sourceDetail,
      files: [binaryName, 'managed-resources/'],
    };

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    console.log(
      `  Bundled ${variant.displayName} prepared: resources/${variant.bundleDirName}/${runtimeKey}/${binaryName} [source=${sourceType}]`
    );
    console.log(`  Bundled managed resources prepared: ${bundledManagedResourcesDir}`);

    if (tempDir) removeDirectorySafe(tempDir);
    return { prepared: true, dir: targetDir, sourceType };
  }

  throw new Error(`${variant.displayName} binary not found for ${runtimeKey} (tag: ${tag})`);
}

function prepareCentauraiCore(options) {
  return prepareCoreBundle(options, 'centaur');
}

function prepareLegacyAioncore(options) {
  return prepareCoreBundle(options, 'legacy');
}

module.exports = {
  prepareCentauraiCore,
  prepareLegacyAioncore,
  // Temporary compatibility export for downstream scripts during the rename.
  prepareAioncore: prepareCentauraiCore,
  getAssetName,
};
