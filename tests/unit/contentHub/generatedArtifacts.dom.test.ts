import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stageContentAsset } from '@/renderer/services/ContentAssetService';
import {
  extractGeneratedArtifactPaths,
  extractGeneratedArtifactPathsFromToolPayload,
  registerGeneratedArtifacts,
  registerGeneratedArtifactsFromPayload,
  registerGeneratedArtifactsFromToolPayload,
} from '@/renderer/utils/file/generatedArtifacts';

vi.mock('@/renderer/services/ContentAssetService', () => ({ stageContentAsset: vi.fn() }));

describe('generated artifact registration', () => {
  beforeEach(() =>
    vi
      .mocked(stageContentAsset)
      .mockReset()
      .mockResolvedValue({} as never)
  );

  it('ignores paths reported by read-only tools', () => {
    expect(
      extractGeneratedArtifactPathsFromToolPayload({
        name: 'read_file',
        status: 'completed',
        output: '/tmp/report.pdf',
      })
    ).toEqual([]);
  });

  it('stages an explicitly reported relative output from its workspace', async () => {
    await registerGeneratedArtifacts({
      paths: ['reports/plan.docx'],
      workspace: '/tmp/conversation',
      conversationId: 'conversation-1',
      source: 'conversation',
    });

    expect(stageContentAsset).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: '/tmp/conversation/reports/plan.docx', name: 'plan.docx' })
    );
  });

  it('does not scan a custom workspace when no output path was reported', async () => {
    await registerGeneratedArtifacts({ paths: [], workspace: '/home/me/project', source: 'conversation' });
    expect(stageContentAsset).not.toHaveBeenCalled();
  });

  it('extracts quoted, file URL, Windows and nested artifact paths', () => {
    expect(
      extractGeneratedArtifactPaths({
        text: 'Saved "/srv/out/result.pptx", file:///srv/out/poster.png and C:\\work\\report.pdf.',
        nested: [{ file: '`notes/summary.md`' }],
        diff: '/srv/out/ignored.docx',
      })
    ).toEqual(['/srv/out/result.pptx', '/srv/out/poster.png', 'C:\\work\\report.pdf', 'notes/summary.md']);
  });

  it('ignores URLs, unsupported extensions, primitive values and excessive nesting', () => {
    expect(extractGeneratedArtifactPaths('https://example.com/report.pdf image.bmp')).toEqual([]);
    expect(extractGeneratedArtifactPaths(42)).toEqual([]);
    expect(extractGeneratedArtifactPaths({ a: { b: { c: { d: { e: { f: '/tmp/deep.pdf' } } } } } })).toEqual([]);
  });

  it('extracts only completed write-like tool output', () => {
    expect(
      extractGeneratedArtifactPathsFromToolPayload([
        { name: 'office_export', status: 'completed', output: '/tmp/report.pdf' },
        { name: 'office_export', status: 'failed', output: '/tmp/failed.pdf' },
        { name: 'read_file', status: 'completed', output: '/tmp/input.pdf' },
      ])
    ).toEqual(['/tmp/report.pdf']);
  });

  it('extracts explicit locations and raw output fields from a completed tool update', () => {
    expect(
      extractGeneratedArtifactPathsFromToolPayload({
        update: {
          kind: 'execute',
          status: 'success',
          locations: [{ path: 'outputs/summary.docx' }],
          content: 'Saved /tmp/deck.pptx',
          rawInput: { output_path: '/tmp/report.pdf' },
        },
      })
    ).toEqual(['outputs/summary.docx', '/tmp/deck.pptx', '/tmp/report.pdf']);
  });

  it('ignores incomplete and read-only update payloads', () => {
    expect(
      extractGeneratedArtifactPathsFromToolPayload({
        update: { kind: 'read', status: 'completed', locations: ['/tmp/input.pdf'] },
      })
    ).toEqual([]);
    expect(
      extractGeneratedArtifactPathsFromToolPayload({
        update: { kind: 'execute', status: 'running', locations: ['/tmp/output.pdf'] },
      })
    ).toEqual([]);
  });

  it('deduplicates paths and marks meeting provenance', async () => {
    const registered = await registerGeneratedArtifacts({
      paths: ['./out/plan.docx', './out/plan.docx', null],
      workspace: '/tmp/meeting',
      conversationId: 'meeting-1',
      source: 'meeting',
      standaloneLabel: 'Board',
    });
    expect(registered).toEqual(['/tmp/meeting/out/plan.docx']);
    expect(stageContentAsset).toHaveBeenCalledWith(
      expect.objectContaining({ draftProvenance: 'meeting-output', category: 'Board' })
    );
  });

  it('continues when one reported file cannot be staged', async () => {
    vi.mocked(stageContentAsset)
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({} as never);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registered = await registerGeneratedArtifacts({ paths: ['/tmp/a.pdf', '/tmp/b.pdf'] });
    expect(registered).toEqual(['/tmp/b.pdf']);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('deduplicates repeated registration within the trailing window', async () => {
    const options = { paths: ['/tmp/window.pdf'], conversationId: `dedupe-${Date.now()}` };
    expect(await registerGeneratedArtifacts(options)).toEqual(['/tmp/window.pdf']);
    expect(await registerGeneratedArtifacts(options)).toEqual([]);
  });

  it('registers artifacts extracted from ordinary and tool payload wrappers', async () => {
    await registerGeneratedArtifactsFromPayload('Saved /tmp/plain.pdf', { source: 'conversation' });
    await registerGeneratedArtifactsFromToolPayload(
      { name: 'export', status: 'done', result_display: '/tmp/tool.pdf' },
      { source: 'toolbox' }
    );
    expect(stageContentAsset).toHaveBeenCalledTimes(2);
  });
});
