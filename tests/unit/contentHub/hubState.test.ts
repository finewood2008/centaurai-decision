import { describe, expect, it } from 'vitest';
import {
  buildContentHubSearchParams,
  classifyHubFile,
  clearHubSelection,
  createHubSelectionState,
  defaultSortDirection,
  filterHubRecords,
  getHubSelectionSummary,
  isAssetInPersonalView,
  parseHubTab,
  parseContentHubQuery,
  setHubSelectionForIds,
  sortHubRecords,
  toggleHubSelection,
} from '@/renderer/pages/contentHub/components/manage/hubState';
import type { HubFileRecord } from '@/renderer/pages/contentHub/types';

const records: HubFileRecord[] = [
  { id: 'b', name: 'Beta.md', size: 20, modifiedAt: 1, kind: 'code', source: 'mine', raw: null },
  { id: 'a', name: 'Alpha.pdf', size: 10, modifiedAt: 2, kind: 'document', source: 'mine', raw: null },
];

describe('personal workspace URL state', () => {
  it.each(['shared', 'nas', null])('falls legacy tab %s back to drafts', (tab) => {
    expect(parseContentHubQuery(tab ? `tab=${tab}` : '').mineView).toBe('drafts');
  });

  it('opens the live knowledge view and recovers the removed archive view into assets', () => {
    expect(parseContentHubQuery('tab=knowledge').mineView).toBe('knowledge');
    expect(parseContentHubQuery('tab=archived').mineView).toBe('assets');
  });

  it.each(['all', 'byConversation', 'byType'])('maps legacy mine tab %s to assets', (tab) => {
    expect(parseContentHubQuery(`tab=${tab}`).mineView).toBe('assets');
  });

  it('round-trips supported query controls', () => {
    const state = parseContentHubQuery('tab=knowledge&q=plan&filter=document&sort=size&dir=asc&view=grid');
    expect(buildContentHubSearchParams(state).toString()).toBe(
      'tab=knowledge&q=plan&filter=document&sort=size&dir=asc&view=grid'
    );
  });

  it('falls invalid controls back to safe defaults', () => {
    expect(parseContentHubQuery('?tab=unknown&filter=audio&sort=random&dir=sideways&view=table')).toEqual({
      section: 'mine',
      mineView: 'drafts',
      search: '',
      kind: 'all',
      sortKey: 'modified',
      sortDirection: 'desc',
      view: 'list',
    });
    expect(parseHubTab('archived')).toBe('assets');
    expect(defaultSortDirection('name')).toBe('asc');
    expect(defaultSortDirection('size')).toBe('desc');
  });

  it('omits default controls and trims search text when serializing', () => {
    const params = buildContentHubSearchParams({
      ...parseContentHubQuery(''),
      search: '  quarterly plan  ',
      sortDirection: 'asc',
      view: 'waterfall',
    });
    expect(params.toString()).toBe('tab=drafts&q=quarterly+plan&dir=asc&view=waterfall');
  });
});

describe('personal workspace record controls', () => {
  it('moves indexed assets out of personal assets and recovers legacy archived assets', () => {
    expect(isAssetInPersonalView(['saved'], 'assets')).toBe(true);
    expect(isAssetInPersonalView(['archived'], 'assets')).toBe(true);
    expect(isAssetInPersonalView(['saved', 'indexed'], 'assets')).toBe(false);
    expect(isAssetInPersonalView(['draft'], 'drafts')).toBe(true);
    expect(isAssetInPersonalView(['saved'], 'knowledge')).toBe(false);
  });

  it('filters by search and kind together', () => {
    expect(filterHubRecords(records, 'alpha', 'document').map((record) => record.id)).toEqual(['a']);
  });

  it('sorts by size without mutating the input', () => {
    expect(sortHubRecords(records, 'size', 'asc').map((record) => record.id)).toEqual(['a', 'b']);
    expect(records.map((record) => record.id)).toEqual(['b', 'a']);
  });

  it('matches subtitles case-insensitively and supports all kinds', () => {
    const withSubtitle = [{ ...records[0], subtitle: 'Meeting Output' }];
    expect(filterHubRecords(withSubtitle, 'meeting', 'all')).toEqual(withSubtitle);
    expect(filterHubRecords(records, '', 'image')).toEqual([]);
  });

  it('sorts names naturally and breaks numeric ties by name', () => {
    const tied = [
      { ...records[0], name: 'File 10.md', modifiedAt: 3 },
      { ...records[1], name: 'File 2.pdf', modifiedAt: 3 },
    ];
    expect(sortHubRecords(tied, 'name', 'asc').map((record) => record.name)).toEqual(['File 2.pdf', 'File 10.md']);
    expect(sortHubRecords(tied, 'modified', 'desc').map((record) => record.name)).toEqual(['File 10.md', 'File 2.pdf']);
  });

  it.each([
    ['photo.png', 'image'],
    ['report.pdf', 'document'],
    ['sheet.xlsx', 'document'],
    ['notes.md', 'code'],
    ['patch.diff', 'code'],
    ['archive.zip', 'other'],
  ] as const)('classifies %s as %s', (name, kind) => {
    expect(classifyHubFile(name)).toBe(kind);
  });
});

describe('personal workspace selection', () => {
  it('toggles, replaces and clears immutable selection state', () => {
    const initial = createHubSelectionState(['a']);
    const added = toggleHubSelection(initial, 'b');
    const removed = toggleHubSelection(added, 'a');
    const all = setHubSelectionForIds(removed, ['a', 'c'], true);
    const none = setHubSelectionForIds(all, ['a', 'b', 'c'], false);

    expect([...initial.selectedIds]).toEqual(['a']);
    expect([...added.selectedIds]).toEqual(['a', 'b']);
    expect([...removed.selectedIds]).toEqual(['b']);
    expect([...all.selectedIds]).toEqual(['b', 'a', 'c']);
    expect(none.selectedIds.size).toBe(0);
    expect(clearHubSelection().selectedIds.size).toBe(0);
  });

  it('summarizes full, partial and empty visible selection', () => {
    expect(getHubSelectionSummary(createHubSelectionState(['a']), ['a', 'b'])).toEqual({
      selectedVisibleCount: 1,
      allVisibleSelected: false,
      partiallySelected: true,
    });
    expect(getHubSelectionSummary(createHubSelectionState(['a', 'b']), ['a', 'b']).allVisibleSelected).toBe(true);
    expect(getHubSelectionSummary(createHubSelectionState(), []).allVisibleSelected).toBe(false);
  });
});
