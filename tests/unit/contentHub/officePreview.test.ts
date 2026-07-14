import { describe, expect, it, vi } from 'vitest';
import {
  getOfficePreviewContentType,
  isOfficePreviewFile,
  openOfficePreviewForFile,
} from '@/renderer/utils/file/officePreview';

describe('office preview helpers', () => {
  it.each([
    ['slides.pptx', 'ppt'],
    ['report.docx', 'word'],
    ['budget.xlsx', 'excel'],
    ['data.csv', 'excel'],
    ['notes.md', null],
  ] as const)('maps %s to %s', (name, expected) => {
    expect(getOfficePreviewContentType(name)).toBe(expected);
  });

  it('detects only Office preview files', () => {
    expect(isOfficePreviewFile('/srv/work/output.ppt')).toBe(true);
    expect(isOfficePreviewFile('/srv/work/image.png')).toBe(false);
  });

  it('opens an Office file with path metadata and caller options', () => {
    const openPreview = vi.fn();

    expect(
      openOfficePreviewForFile(
        openPreview,
        { path: '/srv/work/方案.pptx', name: '方案.pptx', workspace: '/srv/work' },
        { replace: false }
      )
    ).toBe(true);
    expect(openPreview).toHaveBeenCalledWith(
      '',
      'ppt',
      {
        title: '方案.pptx',
        file_name: '方案.pptx',
        file_path: '/srv/work/方案.pptx',
        workspace: '/srv/work',
        editable: false,
      },
      { replace: false }
    );
  });

  it('does not open a non-Office file', () => {
    const openPreview = vi.fn();
    expect(openOfficePreviewForFile(openPreview, { path: '/srv/work/image.png', name: 'image.png' })).toBe(false);
    expect(openPreview).not.toHaveBeenCalled();
  });
});
