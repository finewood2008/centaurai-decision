/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BUILTIN_IMAGE_GEN_NAME } from '@/common/config/storage';
import type { ToolDef } from '../types';
import { SPECIALIZED_IMAGE_TOOLS } from './specializedImageTools';

/**
 * Common AI Toolbox — builtin tool registry.
 *
 * This is the single source of truth for the MVP image tools. It is also the
 * seam where skill-frontmatter-derived tools will be merged later (see
 * {@link getToolboxTools}): both produce the same `ToolDef` shape.
 */

const RATIO_OPTIONS = [
  { value: '1:1', labelKey: 'toolbox.options.ratio.square' },
  { value: '16:9', labelKey: 'toolbox.options.ratio.landscape' },
  { value: '9:16', labelKey: 'toolbox.options.ratio.portrait' },
  { value: '4:3', labelKey: 'toolbox.options.ratio.classic' },
  { value: '3:4', labelKey: 'toolbox.options.ratio.classicPortrait' },
];

const STYLE_OPTIONS = [
  { value: '', labelKey: 'toolbox.options.style.none' },
  { value: 'photorealistic', labelKey: 'toolbox.options.style.photorealistic' },
  { value: 'anime', labelKey: 'toolbox.options.style.anime' },
  { value: '3d-render', labelKey: 'toolbox.options.style.render3d' },
  { value: 'watercolor', labelKey: 'toolbox.options.style.watercolor' },
  { value: 'minimal', labelKey: 'toolbox.options.style.minimal' },
];

const TEXT_TO_IMAGE: ToolDef = {
  id: 'text-to-image',
  backingSkillNames: ['image-generate'],
  titleKey: 'toolbox.tools.textToImage.title',
  descKey: 'toolbox.tools.textToImage.desc',
  icon: 'Picture',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      '{{prompt}}',
      '{{style}}',
      'Render this as an image with a strict {{ratio}} aspect ratio. The output image dimensions MUST be {{ratio}} (square for 1:1, wide for 16:9, tall for 9:16).',
    ].join('\n'),
  },
  fields: [
    {
      name: 'prompt',
      type: 'textarea',
      labelKey: 'toolbox.fields.prompt.label',
      placeholderKey: 'toolbox.fields.prompt.placeholder',
      required: true,
    },
    {
      name: 'ratio',
      type: 'select',
      labelKey: 'toolbox.fields.ratio.label',
      defaultValue: '1:1',
      options: RATIO_OPTIONS,
    },
    {
      name: 'style',
      type: 'select',
      labelKey: 'toolbox.fields.style.label',
      defaultValue: '',
      options: STYLE_OPTIONS,
    },
    {
      name: 'count',
      type: 'number',
      labelKey: 'toolbox.fields.count.label',
      defaultValue: 1,
      min: 1,
      max: 4,
    },
  ],
};

const IMAGE_EDIT: ToolDef = {
  id: 'image-edit',
  backingSkillNames: ['image-edit'],
  titleKey: 'toolbox.tools.imageEdit.title',
  descKey: 'toolbox.tools.imageEdit.desc',
  icon: 'PictureOne',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      'Edit / re-generate based on the provided reference image(s).',
      '{{prompt}}',
      'Render the result with a strict {{ratio}} aspect ratio. The output image dimensions MUST be {{ratio}}.',
    ].join('\n'),
  },
  fields: [
    {
      name: 'refImages',
      type: 'upload',
      labelKey: 'toolbox.fields.refImages.label',
      placeholderKey: 'toolbox.fields.refImages.placeholder',
      required: true,
      accept: 'image/*',
      multiple: true,
    },
    {
      name: 'prompt',
      type: 'textarea',
      labelKey: 'toolbox.fields.editPrompt.label',
      placeholderKey: 'toolbox.fields.editPrompt.placeholder',
      required: true,
    },
    {
      name: 'ratio',
      type: 'select',
      labelKey: 'toolbox.fields.ratio.label',
      defaultValue: '1:1',
      options: RATIO_OPTIONS,
    },
  ],
};

const POSTER: ToolDef = {
  id: 'poster',
  backingSkillNames: ['poster-design'],
  titleKey: 'toolbox.tools.poster.title',
  descKey: 'toolbox.tools.poster.desc',
  icon: 'Topic',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      'Design a marketing poster. Render the title text clearly and legibly inside the poster, spelled exactly.',
      'Main title: {{title}}',
      'Subtitle: {{subtitle}}',
      'Visual style: {{style}}',
      'Color scheme: {{colorScheme}}',
      'Additional requirements: {{extra}}',
      'Render the poster with a strict {{size}} aspect ratio. The output image dimensions MUST be {{size}}.',
    ].join('\n'),
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      labelKey: 'toolbox.fields.posterTitle.label',
      placeholderKey: 'toolbox.fields.posterTitle.placeholder',
      required: true,
    },
    {
      name: 'subtitle',
      type: 'text',
      labelKey: 'toolbox.fields.posterSubtitle.label',
      placeholderKey: 'toolbox.fields.posterSubtitle.placeholder',
    },
    {
      name: 'style',
      type: 'select',
      labelKey: 'toolbox.fields.posterStyle.label',
      defaultValue: 'business',
      options: [
        { value: 'business', labelKey: 'toolbox.options.posterStyle.business' },
        { value: 'minimal', labelKey: 'toolbox.options.posterStyle.minimal' },
        { value: 'festive', labelKey: 'toolbox.options.posterStyle.festive' },
        { value: 'tech', labelKey: 'toolbox.options.posterStyle.tech' },
        { value: 'retro', labelKey: 'toolbox.options.posterStyle.retro' },
      ],
    },
    {
      name: 'colorScheme',
      type: 'select',
      labelKey: 'toolbox.fields.colorScheme.label',
      defaultValue: '',
      options: [
        { value: '', labelKey: 'toolbox.options.colorScheme.auto' },
        { value: 'warm', labelKey: 'toolbox.options.colorScheme.warm' },
        { value: 'cool', labelKey: 'toolbox.options.colorScheme.cool' },
        { value: 'high-contrast', labelKey: 'toolbox.options.colorScheme.highContrast' },
        { value: 'soft', labelKey: 'toolbox.options.colorScheme.soft' },
      ],
    },
    {
      name: 'size',
      type: 'select',
      labelKey: 'toolbox.fields.posterSize.label',
      defaultValue: '9:16',
      options: [
        { value: '9:16', labelKey: 'toolbox.options.ratio.portrait' },
        { value: '16:9', labelKey: 'toolbox.options.ratio.landscape' },
        { value: '1:1', labelKey: 'toolbox.options.ratio.square' },
      ],
    },
    {
      name: 'extra',
      type: 'textarea',
      labelKey: 'toolbox.fields.posterExtra.label',
      placeholderKey: 'toolbox.fields.posterExtra.placeholder',
    },
  ],
};

/** Builtin tools shipped with the app, in display order. */
export const BUILTIN_TOOLS: ToolDef[] = [TEXT_TO_IMAGE, IMAGE_EDIT, POSTER, ...SPECIALIZED_IMAGE_TOOLS];

/**
 * Resolve the list of toolbox tools.
 *
 * Currently returns the builtin registry. This is the single merge point for
 * the planned hybrid model: skill-frontmatter-derived `ToolDef`s will be
 * appended here once the skill format gains an optional `form:` block.
 */
export function getToolboxTools(): ToolDef[] {
  return BUILTIN_TOOLS;
}

/** Find a tool by id. */
export function getToolById(id: string): ToolDef | undefined {
  return BUILTIN_TOOLS.find((tool) => tool.id === id);
}

/** The builtin image-generation MCP tool name, re-exported for convenience. */
export const IMAGE_GEN_MCP_NAME = BUILTIN_IMAGE_GEN_NAME;
