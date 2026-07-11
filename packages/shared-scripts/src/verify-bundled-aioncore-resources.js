const fs = require('fs');
const path = require('path');

function backendBinaryName(platform, binaryBaseName) {
  return platform === 'win32' ? `${binaryBaseName}.exe` : binaryBaseName;
}

function nodeBinaryName(platform) {
  return platform === 'win32' ? 'node.exe' : 'node';
}

function nodeExecutableParts(platform) {
  return platform === 'win32' ? [nodeBinaryName(platform)] : ['bin', nodeBinaryName(platform)];
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function bundledPath(bundleDirName, runtimeKey, ...parts) {
  return normalize(path.join(bundleDirName, runtimeKey, ...parts));
}

function requireRelativePath(baseDir, bundleDirName, runtimeKey, parts, checked, missing) {
  const relativePath = bundledPath(bundleDirName, runtimeKey, ...parts);
  checked.push(relativePath);

  if (!fs.existsSync(path.join(baseDir, ...parts))) {
    missing.push(relativePath);
  }
}

function readDirectories(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function isFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function requireManagedNode(baseDir, bundleDirName, runtimeKey, platform, checked, missing) {
  const nodeRoot = path.join(baseDir, 'managed-resources', 'node');
  const versions = readDirectories(nodeRoot);
  const executableParts = nodeExecutableParts(platform);

  if (versions.length === 0) {
    const relativePath = bundledPath(bundleDirName, runtimeKey, 'managed-resources', 'node', '*', ...executableParts);
    checked.push(relativePath);
    missing.push(relativePath);
    return;
  }

  const executableFound = versions.some((version) => {
    const executablePath = path.join(nodeRoot, version, ...executableParts);
    return isFile(executablePath);
  });

  const relativePath = bundledPath(bundleDirName, runtimeKey, 'managed-resources', 'node', '*', ...executableParts);
  checked.push(relativePath);

  if (!executableFound) {
    missing.push(relativePath);
  }
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function requireImmutableReleaseManifest(
  baseDir,
  bundleDirName,
  runtimeKey,
  repository,
  releaseType,
  checked,
  missing
) {
  const relativePath = `${bundledPath(bundleDirName, runtimeKey, 'manifest.json')}#immutable-release`;
  checked.push(relativePath);
  const manifest = readManifest(path.join(baseDir, 'manifest.json'));
  const valid =
    manifest?.repository === repository &&
    manifest?.releaseType === releaseType &&
    typeof manifest?.version === 'string' &&
    /^v\d+\.\d+\.\d+$/.test(manifest.version) &&
    typeof manifest?.commit === 'string' &&
    /^[0-9a-f]{40}$/i.test(manifest.commit) &&
    typeof manifest?.sha256 === 'string' &&
    /^[0-9a-f]{64}$/i.test(manifest.sha256) &&
    typeof manifest?.source?.asset === 'string';
  if (!valid) missing.push(relativePath);
}

function requireManagedAcpTool(baseDir, bundleDirName, runtimeKey, toolId, checked, missing) {
  const toolRoot = path.join(baseDir, 'managed-resources', 'acp', toolId);
  const versions = readDirectories(toolRoot);

  if (versions.length === 0) {
    const relativePath = bundledPath(
      bundleDirName,
      runtimeKey,
      'managed-resources',
      'acp',
      toolId,
      '*',
      runtimeKey,
      'manifest.json'
    );
    checked.push(relativePath);
    missing.push(relativePath);
    return;
  }

  for (const version of versions) {
    const platformRoot = path.join(toolRoot, version, runtimeKey);
    const manifestRelativePath = bundledPath(
      bundleDirName,
      runtimeKey,
      'managed-resources',
      'acp',
      toolId,
      '*',
      runtimeKey,
      'manifest.json'
    );
    checked.push(manifestRelativePath);

    const manifestPath = path.join(platformRoot, 'manifest.json');
    if (!isFile(manifestPath)) {
      missing.push(manifestRelativePath);
      continue;
    }

    const manifest = readManifest(manifestPath);
    const entrypoint = typeof manifest?.entrypoint === 'string' ? manifest.entrypoint : null;
    if (!entrypoint) {
      missing.push(
        bundledPath(bundleDirName, runtimeKey, 'managed-resources', 'acp', toolId, version, runtimeKey, '<entrypoint>')
      );
      continue;
    }

    const entrypointRelativePath = bundledPath(
      bundleDirName,
      runtimeKey,
      'managed-resources',
      'acp',
      toolId,
      version,
      runtimeKey,
      entrypoint
    );
    checked.push(entrypointRelativePath);

    if (!isFile(path.join(platformRoot, entrypoint))) {
      missing.push(entrypointRelativePath);
    }
  }
}

function verifyCoreBundle({
  resourcesDir,
  electronPlatformName,
  targetArch,
  bundleDirName,
  binaryBaseName,
  repository,
  releaseType,
}) {
  const runtimeKey = `${electronPlatformName}-${targetArch}`;
  const baseDir = path.join(resourcesDir, bundleDirName, runtimeKey);
  const checked = [];
  const missing = [];

  requireRelativePath(
    baseDir,
    bundleDirName,
    runtimeKey,
    [backendBinaryName(electronPlatformName, binaryBaseName)],
    checked,
    missing
  );
  requireRelativePath(baseDir, bundleDirName, runtimeKey, ['manifest.json'], checked, missing);
  requireImmutableReleaseManifest(baseDir, bundleDirName, runtimeKey, repository, releaseType, checked, missing);
  requireRelativePath(baseDir, bundleDirName, runtimeKey, ['managed-resources'], checked, missing);
  requireManagedNode(baseDir, bundleDirName, runtimeKey, electronPlatformName, checked, missing);
  requireManagedAcpTool(baseDir, bundleDirName, runtimeKey, 'codex-acp', checked, missing);
  requireManagedAcpTool(baseDir, bundleDirName, runtimeKey, 'claude-agent-acp', checked, missing);

  return { runtimeKey, checked, missing };
}

function verifyBundledCentauraiCoreResources(options) {
  return verifyCoreBundle({
    ...options,
    bundleDirName: 'bundled-centaurai-core',
    binaryBaseName: 'centaurai-core',
    repository: 'finewood2008/centaurai-core',
    releaseType: 'centaur',
  });
}

function verifyBundledLegacyAioncoreResources(options) {
  return verifyCoreBundle({
    ...options,
    bundleDirName: 'bundled-aioncore',
    binaryBaseName: 'aioncore',
    repository: 'iOfficeAI/AionCore',
    releaseType: 'legacy',
  });
}

module.exports = {
  verifyBundledCentauraiCoreResources,
  verifyBundledLegacyAioncoreResources,
  verifyBundledAioncoreResources: verifyBundledCentauraiCoreResources,
};
