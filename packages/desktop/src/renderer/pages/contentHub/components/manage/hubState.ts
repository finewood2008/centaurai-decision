/** Pure personal-workspace URL, filtering, sorting, and selection helpers. */
import { getContentTypeByExtension } from '@/renderer/pages/conversation/Preview/fileUtils';
import type { ContentAssetStatusFlagDTO } from '@/common/adapter/ipcBridge';
import type {
  HubFileKind,
  HubFileRecord,
  HubSelectionState,
  HubSortDirection,
  HubSortKey,
  HubUrlState,
  HubViewMode,
  PersonalWorkspaceView,
} from '../../types';

const VIEWS = new Set<PersonalWorkspaceView>(['drafts', 'assets', 'knowledge']);
const KINDS = new Set<HubFileKind>(['all', 'image', 'document', 'code', 'other']);
const SORTS = new Set<HubSortKey>(['modified', 'name', 'size']);
const DIRECTIONS = new Set<HubSortDirection>(['asc', 'desc']);
const MODES = new Set<HubViewMode>(['list', 'grid', 'waterfall']);
const CODE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'css',
  'go',
  'h',
  'hpp',
  'java',
  'js',
  'jsx',
  'json',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'ts',
  'tsx',
  'vue',
  'xml',
  'yaml',
  'yml',
]);

export const DEFAULT_HUB_URL_STATE: HubUrlState = {
  section: 'mine',
  mineView: 'drafts',
  search: '',
  kind: 'all',
  sortKey: 'modified',
  sortDirection: 'desc',
  view: 'list',
};

export function parseHubTab(value: string | null): PersonalWorkspaceView {
  if (VIEWS.has(value as PersonalWorkspaceView)) return value as PersonalWorkspaceView;
  if (value === 'archived' || value === 'all' || value === 'byConversation' || value === 'byType') return 'assets';
  return 'drafts';
}

export function defaultSortDirection(sortKey: HubSortKey): HubSortDirection {
  return sortKey === 'name' ? 'asc' : 'desc';
}

function parseEnum<T extends string>(value: string | null, allowed: ReadonlySet<T>, fallback: T): T {
  return value != null && allowed.has(value as T) ? (value as T) : fallback;
}

export function parseContentHubQuery(input: URLSearchParams | string): HubUrlState {
  const params = typeof input === 'string' ? new URLSearchParams(input.replace(/^\?/, '')) : input;
  const sortKey = parseEnum(params.get('sort'), SORTS, 'modified');
  return {
    section: 'mine',
    mineView: parseHubTab(params.get('tab')),
    search: params.get('q') ?? '',
    kind: parseEnum(params.get('filter'), KINDS, 'all'),
    sortKey,
    sortDirection: parseEnum(params.get('dir'), DIRECTIONS, defaultSortDirection(sortKey)),
    view: parseEnum(params.get('view'), MODES, 'list'),
  };
}

export function buildContentHubSearchParams(state: HubUrlState): URLSearchParams {
  const params = new URLSearchParams({ tab: parseHubTab(state.mineView) });
  if (state.search.trim()) params.set('q', state.search.trim());
  if (state.kind !== 'all') params.set('filter', state.kind);
  if (state.sortKey !== 'modified') params.set('sort', state.sortKey);
  if (state.sortDirection !== defaultSortDirection(state.sortKey)) params.set('dir', state.sortDirection);
  if (state.view !== 'list') params.set('view', state.view);
  return params;
}

export function classifyHubFile(name: string): Exclude<HubFileKind, 'all'> {
  const type = getContentTypeByExtension(name);
  const extension = name.toLowerCase().split('.').pop() || '';
  if (type === 'image') return 'image';
  if (type === 'pdf' || type === 'word' || type === 'excel' || type === 'ppt') return 'document';
  if (type === 'markdown' || type === 'html' || type === 'diff' || CODE_EXTENSIONS.has(extension)) return 'code';
  return 'other';
}

export function isAssetInPersonalView(
  statusFlags: readonly ContentAssetStatusFlagDTO[],
  view: PersonalWorkspaceView
): boolean {
  if (view === 'assets') {
    return (statusFlags.includes('saved') || statusFlags.includes('archived')) && !statusFlags.includes('indexed');
  }
  if (view === 'drafts') return statusFlags.includes('draft');
  return false;
}

export function filterHubRecords<T extends HubFileRecord>(
  records: readonly T[],
  search: string,
  kind: HubFileKind
): T[] {
  const query = search.trim().toLowerCase();
  return records.filter(
    (record) =>
      (!query || record.name.toLowerCase().includes(query) || record.subtitle?.toLowerCase().includes(query)) &&
      (kind === 'all' || record.kind === kind)
  );
}

export function sortHubRecords<T extends HubFileRecord>(
  records: readonly T[],
  sortKey: HubSortKey,
  direction: HubSortDirection
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...records].toSorted((a, b) => {
    if (sortKey === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true }) * factor;
    const left = sortKey === 'size' ? a.size : a.modifiedAt;
    const right = sortKey === 'size' ? b.size : b.modifiedAt;
    return left === right
      ? a.name.localeCompare(b.name, undefined, { numeric: true }) * factor
      : (left - right) * factor;
  });
}

export function createHubSelectionState(ids: readonly string[] = []): HubSelectionState {
  return { selectedIds: new Set(ids) };
}

export function toggleHubSelection(state: HubSelectionState, id: string): HubSelectionState {
  const selectedIds = new Set(state.selectedIds);
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  return { selectedIds };
}

export function setHubSelectionForIds(
  state: HubSelectionState,
  ids: readonly string[],
  selected: boolean
): HubSelectionState {
  const selectedIds = new Set(state.selectedIds);
  ids.forEach((id) => (selected ? selectedIds.add(id) : selectedIds.delete(id)));
  return { selectedIds };
}

export function clearHubSelection(): HubSelectionState {
  return createHubSelectionState();
}

export function getHubSelectionSummary(state: HubSelectionState, visibleIds: readonly string[]) {
  const selectedVisibleCount = visibleIds.filter((id) => state.selectedIds.has(id)).length;
  return {
    selectedVisibleCount,
    allVisibleSelected: visibleIds.length > 0 && selectedVisibleCount === visibleIds.length,
    partiallySelected: selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length,
  };
}
