/**
 * Resolve the CentaurAI Core binary path.
 *
 * Search order:
 *  1. Bundled with app (production)
 *  2. System PATH
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const MAX_DIR_ENTRIES = 20;
const MAX_LOOKUP_TEXT_LENGTH = 1000;

type BackendBinaryVariant = {
  binaryName: string;
  bundleDirName: string;
  displayName: string;
};

const CENTAUR_CORE: BackendBinaryVariant = {
  binaryName: 'centaurai-core',
  bundleDirName: 'bundled-centaurai-core',
  displayName: 'CentaurAI Core',
};

const LEGACY_CORE: BackendBinaryVariant = {
  binaryName: 'aioncore',
  bundleDirName: 'bundled-aioncore',
  displayName: 'Legacy AionCore',
};

type ResolveBinaryOptions = {
  allowSystemPath?: boolean;
};

type BackendBinaryResolveDiagnostics = {
  resourcesPath?: string;
  runtimeKey: string;
  binaryName: string;
  bundleDirName: string;
  checkedBundledPath?: string;
  bundledDirExists?: boolean;
  runtimeDirExists?: boolean;
  resourcesDirEntries?: string[];
  runtimeDirEntries?: string[];
  pathLookupCommand: string;
  pathLookupResult?: string;
  pathLookupError?: string;
};

class BackendBinaryResolveError extends Error {
  readonly diagnostics: BackendBinaryResolveDiagnostics;

  constructor(message: string, diagnostics: BackendBinaryResolveDiagnostics) {
    super(message);
    this.name = 'BackendBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function getBinaryName(variant: BackendBinaryVariant): string {
  return process.platform === 'win32' ? `${variant.binaryName}.exe` : variant.binaryName;
}

function getRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function listDirEntries(dirPath: string): string[] | undefined {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  } catch {
    return undefined;
  }
}

function trimLookupText(text: string): string {
  return text.trim().slice(0, MAX_LOOKUP_TEXT_LENGTH);
}

/**
 * Resolve the CentaurAI Core binary path.
 * Returns the absolute path to the binary, or throws if not found.
 */
function resolveVariantBinary(variant: BackendBinaryVariant, options: ResolveBinaryOptions = {}): string {
  const runtimeKey = getRuntimeKey();
  const binaryName = getBinaryName(variant);
  const diagnostics: BackendBinaryResolveDiagnostics = {
    runtimeKey,
    binaryName,
    bundleDirName: variant.bundleDirName,
    pathLookupCommand: process.platform === 'win32' ? `where ${variant.binaryName}` : `which ${variant.binaryName}`,
  };

  const bundled = bundledPath(variant.bundleDirName, runtimeKey, binaryName, diagnostics);
  if (bundled) return bundled;

  if (options.allowSystemPath ?? true) {
    const fromPath = resolveFromSystemPATH(diagnostics);
    if (fromPath) return fromPath;
  }

  throw new BackendBinaryResolveError(
    `Cannot find ${variant.displayName} "${variant.binaryName}" binary. Checked locked bundled location${
      (options.allowSystemPath ?? true) ? ' and system PATH' : ''
    }.`,
    diagnostics
  );
}

export function resolveBinaryPath(options: ResolveBinaryOptions = {}): string {
  return resolveVariantBinary(CENTAUR_CORE, options);
}

export function resolveLegacyBinaryPath(options: ResolveBinaryOptions = {}): string {
  return resolveVariantBinary(LEGACY_CORE, options);
}

/**
 * Check bundled binary in resources directory.
 * Layout: bundled-centaurai-core/{platform}-{arch}/centaurai-core[.exe]
 */
function bundledPath(
  bundleDirName: string,
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return null;
  diagnostics.resourcesPath = resourcesPath;

  const bundledDir = join(resourcesPath, bundleDirName);
  const runtimeDir = join(bundledDir, runtimeKey);
  const candidate = join(runtimeDir, binaryName);
  diagnostics.checkedBundledPath = candidate;
  diagnostics.bundledDirExists = existsSync(bundledDir);
  diagnostics.runtimeDirExists = existsSync(runtimeDir);
  diagnostics.resourcesDirEntries = listDirEntries(resourcesPath);
  diagnostics.runtimeDirEntries = listDirEntries(runtimeDir);

  if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Try to find the binary on the system PATH.
 */
function resolveFromSystemPATH(diagnostics: BackendBinaryResolveDiagnostics): string | null {
  try {
    const result = execSync(diagnostics.pathLookupCommand, { encoding: 'utf-8', timeout: 5000 }).trim();
    diagnostics.pathLookupResult = trimLookupText(result);
    const firstMatch = result.split(/\r?\n/).find((line) => line.trim());
    if (firstMatch && existsSync(firstMatch.trim())) return firstMatch.trim();
  } catch (error) {
    diagnostics.pathLookupError = error instanceof Error ? trimLookupText(error.message) : String(error);
    return null;
  }
  return null;
}

export type { BackendBinaryResolveDiagnostics, ResolveBinaryOptions };
