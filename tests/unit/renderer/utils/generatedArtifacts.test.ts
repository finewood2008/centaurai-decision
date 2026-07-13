/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { extractGeneratedArtifactPaths } from '@/renderer/utils/file/generatedArtifacts';

describe('generatedArtifacts', () => {
  it('extracts a bare generated Office filename from assistant text', () => {
    const paths = extractGeneratedArtifactPaths('已生成文件：半人马AI产品介绍.xlsx');

    expect(paths).toContain('半人马AI产品介绍.xlsx');
  });

  it('extracts quoted absolute paths with spaces', () => {
    const paths = extractGeneratedArtifactPaths('Saved to "/home/user/Desktop/My Report.docx".');

    expect(paths).toContain('/home/user/Desktop/My Report.docx');
  });

  it('ignores file paths inside diff payloads', () => {
    const paths = extractGeneratedArtifactPaths({
      diff: '+++ /tmp/old-report.docx',
      output: 'created /tmp/new-report.docx',
    });

    expect(paths).toEqual(['/tmp/new-report.docx']);
  });
});
