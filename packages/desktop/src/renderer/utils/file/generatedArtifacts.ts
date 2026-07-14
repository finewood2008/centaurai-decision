/** Registers only files explicitly reported by completed generation events. */
import { stageContentAsset } from '@/renderer/services/ContentAssetService';

const EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'csv',
  'md',
  'html',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
] as const;
const EXT = EXTENSIONS.join('|');
const PATH_PATTERN = new RegExp(
  `(?<![A-Za-z0-9:/])(?:file:\\/\\/|~|\\/|\\.{1,2}[\\\\/]|[A-Za-z]:[\\\\/])[^<>"'\\x60\\r\\n]*?\\.(?:${EXT})\\b|["'\\x60]([^"'\\x60]+?\\.(?:${EXT}))["'\\x60]`,
  'gi'
);
const EXT_PATTERN = new RegExp(`\\.(?:${EXT})$`, 'i');
const EXPLICIT_PATH_KEY = /(?:^|_)(?:file|path|location|output|destination)(?:_|$)/i;
const recentlyStaged = new Map<string, number>();
const DEDUPE_WINDOW_MS = 10_000;

type ArtifactSource = 'conversation' | 'toolbox' | 'meeting';

export type RegisterGeneratedArtifactsOptions = {
  paths: Array<string | null | undefined>;
  workspace?: string | null;
  conversationId?: string;
  source?: ArtifactSource;
  standaloneLabel?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clean(raw: string): string {
  return raw
    .trim()
    .replace(/^file:\/\//i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^[<([{]+/, '')
    .replace(/[>\])}.,，。；;:：]+$/, '');
}

function dedupe(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string').map(clean))].filter(
    (value) => EXT_PATTERN.test(value) && !/^https?:\/\//i.test(value)
  );
}

function isAbsolute(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function resolvePath(value: string, workspace?: string | null): string {
  if (isAbsolute(value) || !workspace) return value;
  return `${workspace.replace(/[\\/]+$/, '')}/${value.replace(/^\.?[\\/]+/, '')}`;
}

function nameFromPath(value: string): string {
  return value.split(/[\\/]/).pop() || 'artifact';
}

export function extractGeneratedArtifactPaths(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string') {
    return dedupe([...value.matchAll(PATH_PATTERN)].map((match) => match[1] || match[0]));
  }
  if (Array.isArray(value)) return dedupe(value.flatMap((item) => extractGeneratedArtifactPaths(item, depth + 1)));
  if (!isRecord(value)) return [];
  return dedupe(
    Object.entries(value).flatMap(([key, nested]) => {
      if (key === 'diff' || key === 'file_diff') return [];
      if (typeof nested === 'string' && EXPLICIT_PATH_KEY.test(key)) return dedupe([nested]);
      return extractGeneratedArtifactPaths(nested, depth + 1);
    })
  );
}

function completed(status: unknown): boolean {
  return typeof status === 'string' && /^(completed|success|succeeded|done|finished)$/i.test(status);
}

function readOnlyTool(name: string): boolean {
  return /^(read|list|get|search|grep|find|cat|view|preview|inspect|stat|ls)([_-]|$)/i.test(name);
}

export function extractGeneratedArtifactPathsFromToolPayload(payload: unknown): string[] {
  if (Array.isArray(payload)) return dedupe(payload.flatMap(extractGeneratedArtifactPathsFromToolPayload));
  if (!isRecord(payload)) return extractGeneratedArtifactPaths(payload);
  const update = isRecord(payload.update) ? payload.update : undefined;
  if (update) {
    if (!completed(update.status) || update.kind === 'read') return [];
    return extractGeneratedArtifactPaths([update.locations, update.content, update.rawInput]);
  }
  const name = typeof payload.name === 'string' ? payload.name : '';
  if ((payload.status !== undefined && !completed(payload.status)) || readOnlyTool(name)) return [];
  return extractGeneratedArtifactPaths([payload.output, payload.result_display, payload.args, payload.input]);
}

export async function registerGeneratedArtifacts(options: RegisterGeneratedArtifactsOptions): Promise<string[]> {
  const paths = dedupe(options.paths).map((value) => resolvePath(value, options.workspace));
  const results = await Promise.all(
    paths.map(async (sourcePath): Promise<string | null> => {
      const key = `${options.conversationId || ''}\n${sourcePath}`;
      if (Date.now() - (recentlyStaged.get(key) ?? 0) < DEDUPE_WINDOW_MS) return null;
      try {
        await stageContentAsset({
          sourcePath,
          name: nameFromPath(sourcePath),
          sourceConversationId: options.conversationId,
          category: options.standaloneLabel,
          draftProvenance: options.source === 'meeting' ? 'meeting-output' : 'registered-generated-artifact',
        });
        recentlyStaged.set(key, Date.now());
        return sourcePath;
      } catch (error) {
        console.warn('[GeneratedArtifacts] Unable to stage reported output:', sourcePath, error);
        return null;
      }
    })
  );
  return results.filter((sourcePath): sourcePath is string => sourcePath !== null);
}

export function registerGeneratedArtifactsFromPayload(
  payload: unknown,
  options: Omit<RegisterGeneratedArtifactsOptions, 'paths'>
): Promise<string[]> {
  return registerGeneratedArtifacts({ ...options, paths: extractGeneratedArtifactPaths(payload) });
}

export function registerGeneratedArtifactsFromToolPayload(
  payload: unknown,
  options: Omit<RegisterGeneratedArtifactsOptions, 'paths'>
): Promise<string[]> {
  return registerGeneratedArtifacts({ ...options, paths: extractGeneratedArtifactPathsFromToolPayload(payload) });
}
