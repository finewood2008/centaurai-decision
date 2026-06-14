/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDef, ToolField } from '../types';

/**
 * Specialized, preset-driven image tools — each bakes in the attributes of a
 * specific image type (avatar, sticker, product shot, ID photo, …) so the user
 * just fills a focused form instead of writing a full prompt. They all run on
 * the configured image model via direct generation (no agent).
 *
 * Option `value`s are model-facing English phrases; `labelKey`s are i18n.
 */

const RATIO_DIRECTIVE = (ratio: string) =>
  `Render with a strict ${ratio} aspect ratio. The output image dimensions MUST be ${ratio}.`;

const requiredText = (name: string, labelKey: string, placeholderKey: string): ToolField => ({
  name,
  type: 'textarea',
  labelKey,
  placeholderKey,
  required: true,
});

const select = (name: string, labelKey: string, defaultValue: string, options: Array<[string, string]>): ToolField => ({
  name,
  type: 'select',
  labelKey,
  defaultValue,
  options: options.map(([value, labelKey]) => ({ value, labelKey })),
});

const AVATAR: ToolDef = {
  id: 'avatar',
  titleKey: 'toolbox.tools.avatar.title',
  descKey: 'toolbox.tools.avatar.desc',
  icon: 'Avatar',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      'Portrait headshot avatar of {{subject}}.',
      '{{style}} style.',
      '{{background}} background.',
      'Centered composition, face clearly visible, soft flattering lighting, high detail.',
      RATIO_DIRECTIVE('1:1'),
    ].join('\n'),
  },
  fields: [
    requiredText('subject', 'toolbox.fields.avatarSubject.label', 'toolbox.fields.avatarSubject.placeholder'),
    select('style', 'toolbox.fields.avatarStyle.label', 'realistic photographic', [
      ['realistic photographic', 'toolbox.options.avatarStyle.realistic'],
      ['anime', 'toolbox.options.avatarStyle.anime'],
      ['3D rendered Pixar-like', 'toolbox.options.avatarStyle.render3d'],
      ['oil painting', 'toolbox.options.avatarStyle.oil'],
      ['cyberpunk neon', 'toolbox.options.avatarStyle.cyberpunk'],
      ['minimal flat line art', 'toolbox.options.avatarStyle.lineart'],
    ]),
    select('background', 'toolbox.fields.avatarBackground.label', 'softly blurred bokeh', [
      ['softly blurred bokeh', 'toolbox.options.avatarBackground.blur'],
      ['solid color studio', 'toolbox.options.avatarBackground.solid'],
      ['detailed scene', 'toolbox.options.avatarBackground.scene'],
    ]),
  ],
};

const STICKER: ToolDef = {
  id: 'sticker',
  titleKey: 'toolbox.tools.sticker.title',
  descKey: 'toolbox.tools.sticker.desc',
  icon: 'SmilingFace',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      'Cute die-cut sticker of {{subject}}.',
      '{{emotion}}',
      'Bold clean outline, flat vibrant colors, simple shapes, glossy sticker style, plain white background, centered.',
      RATIO_DIRECTIVE('1:1'),
    ].join('\n'),
  },
  fields: [
    requiredText('subject', 'toolbox.fields.stickerSubject.label', 'toolbox.fields.stickerSubject.placeholder'),
    {
      name: 'emotion',
      type: 'text',
      labelKey: 'toolbox.fields.stickerEmotion.label',
      placeholderKey: 'toolbox.fields.stickerEmotion.placeholder',
    },
  ],
};

const PRODUCT: ToolDef = {
  id: 'product',
  titleKey: 'toolbox.tools.product.title',
  descKey: 'toolbox.tools.product.desc',
  icon: 'ShoppingBag',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      'Professional e-commerce product photography of {{product}}.',
      '{{background}} background.',
      '{{angle}}.',
      'Studio lighting, soft shadows, sharp focus, clean, commercial quality, high resolution.',
      RATIO_DIRECTIVE('1:1'),
    ].join('\n'),
  },
  fields: [
    requiredText('product', 'toolbox.fields.productDesc.label', 'toolbox.fields.productDesc.placeholder'),
    select('background', 'toolbox.fields.productBackground.label', 'pure white seamless', [
      ['pure white seamless', 'toolbox.options.productBackground.white'],
      ['light gray gradient', 'toolbox.options.productBackground.gray'],
      ['wooden table', 'toolbox.options.productBackground.wood'],
      ['marble surface', 'toolbox.options.productBackground.marble'],
      ['lifestyle scene', 'toolbox.options.productBackground.scene'],
    ]),
    select('angle', 'toolbox.fields.productAngle.label', 'front view', [
      ['front view', 'toolbox.options.productAngle.front'],
      ['45-degree angle', 'toolbox.options.productAngle.angle45'],
      ['top-down flat lay', 'toolbox.options.productAngle.topdown'],
    ]),
  ],
};

const ID_PHOTO: ToolDef = {
  id: 'id-photo',
  titleKey: 'toolbox.tools.idPhoto.title',
  descKey: 'toolbox.tools.idPhoto.desc',
  icon: 'IdCard',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      'Formal ID / passport photo of {{subject}}.',
      'Head and shoulders, front-facing, looking straight at the camera, neutral expression.',
      '{{bgColor}} solid background.',
      'Wearing {{attire}}.',
      'Even soft lighting, sharp focus, realistic, professional.',
      RATIO_DIRECTIVE('3:4'),
    ].join('\n'),
  },
  fields: [
    requiredText('subject', 'toolbox.fields.idSubject.label', 'toolbox.fields.idSubject.placeholder'),
    select('bgColor', 'toolbox.fields.idBgColor.label', 'plain white', [
      ['plain white', 'toolbox.options.idBgColor.white'],
      ['plain blue', 'toolbox.options.idBgColor.blue'],
      ['plain red', 'toolbox.options.idBgColor.red'],
    ]),
    select('attire', 'toolbox.fields.idAttire.label', 'a formal business suit', [
      ['a formal business suit', 'toolbox.options.idAttire.formal'],
      ['professional attire', 'toolbox.options.idAttire.professional'],
      ['smart casual clothing', 'toolbox.options.idAttire.casual'],
    ]),
  ],
};

const ILLUSTRATION: ToolDef = {
  id: 'illustration',
  titleKey: 'toolbox.tools.illustration.title',
  descKey: 'toolbox.tools.illustration.desc',
  icon: 'BookOne',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      '{{artStyle}} of {{scene}}.',
      'Detailed, well composed, artistic, cohesive color palette.',
      'Render with a strict {{ratio}} aspect ratio. The output image dimensions MUST be {{ratio}}.',
    ].join('\n'),
  },
  fields: [
    requiredText('scene', 'toolbox.fields.illustScene.label', 'toolbox.fields.illustScene.placeholder'),
    select('artStyle', 'toolbox.fields.illustStyle.label', 'flat vector illustration', [
      ['flat vector illustration', 'toolbox.options.illustStyle.flat'],
      ['watercolor illustration', 'toolbox.options.illustStyle.watercolor'],
      ['painterly digital painting', 'toolbox.options.illustStyle.painting'],
      ['cel-shaded anime illustration', 'toolbox.options.illustStyle.cel'],
      ["children's storybook illustration", 'toolbox.options.illustStyle.children'],
      ['pixel art', 'toolbox.options.illustStyle.pixel'],
    ]),
    select('ratio', 'toolbox.fields.ratio.label', '1:1', [
      ['1:1', 'toolbox.options.ratio.square'],
      ['16:9', 'toolbox.options.ratio.landscape'],
      ['9:16', 'toolbox.options.ratio.portrait'],
    ]),
  ],
};

const FOOD: ToolDef = {
  id: 'food',
  titleKey: 'toolbox.tools.food.title',
  descKey: 'toolbox.tools.food.desc',
  icon: 'Bowl',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      'Professional food photography of {{dish}}.',
      '{{angle}}.',
      '{{mood}}.',
      'Appetizing, mouth-watering, fresh ingredients, soft natural light, shallow depth of field, high detail.',
      RATIO_DIRECTIVE('1:1'),
    ].join('\n'),
  },
  fields: [
    requiredText('dish', 'toolbox.fields.foodDish.label', 'toolbox.fields.foodDish.placeholder'),
    select('angle', 'toolbox.fields.foodAngle.label', '45-degree angle', [
      ['45-degree angle', 'toolbox.options.foodAngle.angle45'],
      ['top-down overhead', 'toolbox.options.foodAngle.topdown'],
      ['close-up macro', 'toolbox.options.foodAngle.closeup'],
    ]),
    select('mood', 'toolbox.fields.foodMood.label', 'bright and fresh with natural light', [
      ['bright and fresh with natural light', 'toolbox.options.foodMood.bright'],
      ['dark and moody with dramatic light', 'toolbox.options.foodMood.dark'],
      ['Japanese minimalist style', 'toolbox.options.foodMood.japanese'],
      ['trendy Instagram flat-lay', 'toolbox.options.foodMood.ins'],
    ]),
  ],
};

const PHOTO_RESTORE: ToolDef = {
  id: 'photo-restore',
  titleKey: 'toolbox.tools.photoRestore.title',
  descKey: 'toolbox.tools.photoRestore.desc',
  icon: 'Time',
  category: 'image',
  output: 'image',
  requires: 'image-model',
  source: 'builtin',
  execution: {
    kind: 'mcp',
    mcpTool: 'aionui_image_generation',
    promptTemplate: [
      'Restore and enhance this old photograph.',
      'Remove scratches, dust, creases and noise; repair damaged areas; sharpen and enhance details and faces.',
      '{{colorize}}.',
      'Preserve the original composition, identity and facial features faithfully.',
    ].join('\n'),
  },
  fields: [
    {
      name: 'photo',
      type: 'upload',
      labelKey: 'toolbox.fields.restorePhoto.label',
      placeholderKey: 'toolbox.fields.restorePhoto.placeholder',
      required: true,
      accept: 'image/*',
    },
    select('colorize', 'toolbox.fields.restoreColorize.label', 'Keep the original tones', [
      ['Keep the original tones', 'toolbox.options.restoreColorize.keep'],
      ['Colorize it naturally with realistic colors', 'toolbox.options.restoreColorize.colorize'],
    ]),
  ],
};

/** Specialized image tools, in display order. */
export const SPECIALIZED_IMAGE_TOOLS: ToolDef[] = [
  AVATAR,
  STICKER,
  PRODUCT,
  ID_PHOTO,
  ILLUSTRATION,
  FOOD,
  PHOTO_RESTORE,
];
