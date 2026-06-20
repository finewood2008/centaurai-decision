/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for renderer/pages/toolbox prompt composition + registry.
 */

import { describe, it, expect } from 'vitest';
import {
  interpolatePrompt,
  findMissingRequired,
  buildToolPrompt,
  collectUploadPaths,
} from '@/renderer/pages/toolbox/toolboxPrompt';
import { getToolboxTools, getToolById } from '@/renderer/pages/toolbox/registry';
import {
  isToolboxImageSkill,
  skillToToolDef,
  mergeToolboxTools,
  type InstalledSkill,
} from '@/renderer/pages/toolbox/registry/skillTools';
import type { ToolDef } from '@/renderer/pages/toolbox/types';

describe('interpolatePrompt', () => {
  it('replaces {{field}} placeholders with values', () => {
    const out = interpolatePrompt('Subject: {{prompt}}, ratio {{ratio}}', {
      prompt: 'a red fox',
      ratio: '16:9',
    });
    expect(out).toBe('Subject: a red fox, ratio 16:9');
  });

  it('joins array values (upload paths) with newlines', () => {
    const out = interpolatePrompt('{{refImages}}', { refImages: ['/a.png', '/b.png'] });
    expect(out).toBe('/a.png\n/b.png');
  });

  it('resolves empty / unknown placeholders to empty string and trims', () => {
    const out = interpolatePrompt('A: {{a}}\nB: {{missing}}', { a: 'x' });
    expect(out).toBe('A: x\nB:');
  });

  it('collapses blank gaps left by empty optional fields', () => {
    const out = interpolatePrompt('one\n\n{{empty}}\n\n\ntwo', { empty: '' });
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain('one');
    expect(out).toContain('two');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(interpolatePrompt('{{  x  }}', { x: 'ok' })).toBe('ok');
  });
});

const FAKE_TOOL: ToolDef = {
  id: 'fake',
  titleKey: 't',
  descKey: 'd',
  icon: 'Picture',
  category: 'image',
  output: 'image',
  source: 'builtin',
  execution: { kind: 'mcp', mcpTool: 'x', promptTemplate: '{{prompt}} {{ratio}}' },
  fields: [
    { name: 'prompt', type: 'textarea', labelKey: 'l', required: true },
    { name: 'refs', type: 'upload', labelKey: 'l', required: true, multiple: true },
    { name: 'ratio', type: 'select', labelKey: 'l' },
  ],
};

describe('findMissingRequired', () => {
  it('flags missing, empty-string and empty-array required fields', () => {
    const missing = findMissingRequired(FAKE_TOOL, { prompt: '   ', refs: [] });
    expect(missing.map((f) => f.name).toSorted()).toEqual(['prompt', 'refs']);
  });

  it('passes when required fields are filled', () => {
    const missing = findMissingRequired(FAKE_TOOL, { prompt: 'hi', refs: ['/a.png'] });
    expect(missing).toHaveLength(0);
  });

  it('ignores optional fields', () => {
    const missing = findMissingRequired(FAKE_TOOL, { prompt: 'hi', refs: ['/a.png'], ratio: '' });
    expect(missing).toHaveLength(0);
  });
});

describe('buildToolPrompt + collectUploadPaths', () => {
  it('builds the prompt from the template', () => {
    expect(buildToolPrompt(FAKE_TOOL, { prompt: 'cat', ratio: '1:1' })).toBe('cat 1:1');
  });

  it('collects upload paths across upload fields in order', () => {
    expect(collectUploadPaths(FAKE_TOOL, { refs: ['/a.png', '/b.png'] })).toEqual(['/a.png', '/b.png']);
  });
});

describe('registry', () => {
  it('ships the core + specialized image tools', () => {
    const imageIds = getToolboxTools()
      .filter((t) => t.category === 'image')
      .map((t) => t.id);
    expect(imageIds.slice(0, 3)).toEqual(['text-to-image', 'image-edit', 'poster']);
    expect(imageIds).toEqual(
      expect.arrayContaining(['avatar', 'sticker', 'product', 'id-photo', 'illustration', 'food', 'photo-restore'])
    );
  });

  it('all builtin image tools require an image model and use the image-gen MCP', () => {
    for (const tool of getToolboxTools().filter((t) => t.category === 'image')) {
      expect(tool.requires).toBe('image-model');
      expect(tool.execution.kind).toBe('mcp');
      expect(tool.execution.mcpTool).toBe('aionui_image_generation');
    }
  });

  it('every required field referenced in a template resolves', () => {
    for (const tool of getToolboxTools()) {
      const values: Record<string, string> = {};
      tool.fields.forEach((f) => (values[f.name] = `v_${f.name}`));
      const prompt = buildToolPrompt(tool, values);
      expect(prompt).not.toMatch(/\{\{/);
    }
  });

  it('getToolById finds and misses correctly', () => {
    expect(getToolById('poster')?.id).toBe('poster');
    expect(getToolById('nope')).toBeUndefined();
  });
});

const skill = (name: string, description = ''): InstalledSkill => ({ name, description, source: 'custom' });

describe('isToolboxImageSkill', () => {
  it('matches image/poster/logo skill names', () => {
    expect(isToolboxImageSkill(skill('image-generate'))).toBe(true);
    expect(isToolboxImageSkill(skill('poster-design'))).toBe(true);
    expect(isToolboxImageSkill(skill('logo-design'))).toBe(true);
    expect(isToolboxImageSkill(skill('海报生成'))).toBe(true);
  });

  it('ignores unrelated skills', () => {
    expect(isToolboxImageSkill(skill('pdf'))).toBe(false);
    expect(isToolboxImageSkill(skill('mermaid'))).toBe(false);
    expect(isToolboxImageSkill(skill('officecli-xlsx'))).toBe(false);
  });
});

describe('skillToToolDef', () => {
  it('produces a generic single-prompt skill tool with literal labels', () => {
    const def = skillToToolDef(skill('logo-design', 'Design a logo'));
    expect(def.source).toBe('skill');
    expect(def.execution.kind).toBe('skill');
    expect(def.execution.skillName).toBe('logo-design');
    expect(def.injectSkills).toEqual(['logo-design']);
    expect(def.titleText).toBe('logo-design');
    expect(def.descText).toBe('Design a logo');
    expect(def.fields).toHaveLength(1);
    expect(def.fields[0].name).toBe('prompt');
  });
});

describe('mergeToolboxTools', () => {
  it('injects the backing skill into a curated tool when installed', () => {
    const merged = mergeToolboxTools(getToolboxTools(), [skill('image-generate')]);
    const t2i = merged.find((t) => t.id === 'text-to-image');
    expect(t2i?.injectSkills).toEqual(['image-generate']);
  });

  it('dedupes skills already covered by a curated tool', () => {
    const merged = mergeToolboxTools(getToolboxTools(), [
      skill('image-generate'),
      skill('image-edit'),
      skill('poster-design'),
    ]);
    // No extra skill cards — all three are covered by curated tools.
    expect(merged.filter((t) => t.source === 'skill')).toHaveLength(0);
    expect(merged).toHaveLength(getToolboxTools().length);
  });

  it('auto-surfaces an uncovered image skill as a new tool', () => {
    const merged = mergeToolboxTools(getToolboxTools(), [skill('logo-design', 'Design a logo')]);
    const extra = merged.filter((t) => t.source === 'skill');
    expect(extra).toHaveLength(1);
    expect(extra[0].id).toBe('skill:logo-design');
  });

  it('does not mutate the shared registry singletons', () => {
    const before = getToolboxTools().find((t) => t.id === 'text-to-image');
    mergeToolboxTools(getToolboxTools(), [skill('image-generate')]);
    expect(before?.injectSkills).toBeUndefined();
  });
});
