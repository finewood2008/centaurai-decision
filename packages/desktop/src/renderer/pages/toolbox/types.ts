/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Common AI Toolbox — type definitions.
 *
 * A `ToolDef` is the single, unified shape that both the in-app builtin
 * registry and (in the future) skill-frontmatter-derived tools produce.
 * Each tool declares a form (fields), how to compose its prompt, how to
 * execute it, and how to render its output.
 */

/** Field kinds the dynamic form renderer understands. */
export type ToolFieldType = 'text' | 'textarea' | 'select' | 'number' | 'upload';

/** A single select option. `label` is an i18n key resolved at render time. */
export type ToolSelectOption = {
  value: string;
  /** i18n key for the option label. */
  labelKey: string;
};

/**
 * One form field. `name` is the key used both for validation and for
 * `{{name}}` interpolation in the prompt template.
 */
export type ToolField = {
  name: string;
  type: ToolFieldType;
  /** i18n key for the field label. */
  labelKey: string;
  /** i18n key for the placeholder / helper text. */
  placeholderKey?: string;
  required?: boolean;
  /** Default value applied when the form mounts. */
  defaultValue?: string | number;
  /** Options for `select` fields. */
  options?: ToolSelectOption[];
  /** Bounds for `number` fields. */
  min?: number;
  max?: number;
  /** For `upload` fields: accepted mime/extension hint and multi-select. */
  accept?: string;
  multiple?: boolean;
};

/** How a tool is executed once the form is submitted. */
export type ToolExecution = {
  /**
   * Execution backend:
   * - `mcp`: rely on a builtin MCP tool (e.g. image generation) that the
   *   chosen agent already has available.
   * - `skill`: inject a named skill into the run.
   * - `prompt`: plain prompt, no special tool required.
   */
  kind: 'mcp' | 'skill' | 'prompt';
  /** MCP tool name, when `kind === 'mcp'` (e.g. `aionui_image_generation`). */
  mcpTool?: string;
  /** Skill name, when `kind === 'skill'`. */
  skillName?: string;
  /**
   * Prompt template with `{{fieldName}}` placeholders. Uploaded file paths
   * are interpolated as their absolute paths joined by newlines.
   */
  promptTemplate: string;
};

/** What the run is expected to produce, drives the result renderer. */
export type ToolOutputKind = 'image' | 'text';

/** Where a tool definition came from (hybrid registry + future skills). */
export type ToolSource = 'builtin' | 'skill';

/** A complete, self-describing toolbox tool. */
export type ToolDef = {
  id: string;
  /** i18n key for the tool title. */
  titleKey: string;
  /** i18n key for the short description shown on the card. */
  descKey: string;
  /**
   * Literal title/description, used instead of the i18n keys when present.
   * Skill-derived tools use the skill's own name/description here.
   */
  titleText?: string;
  descText?: string;
  /** icon-park icon name. */
  icon: string;
  /** Grouping bucket for the card grid. */
  category: 'image' | 'text';
  fields: ToolField[];
  execution: ToolExecution;
  output: ToolOutputKind;
  /**
   * Allowed agent backends (e.g. `['claude', 'gemini']`). When omitted, any
   * available agent may run the tool. The form filters the agent picker to
   * this list intersected with installed agents.
   */
  agents?: string[];
  /**
   * Precondition the tool needs before it can run. `image-model` means an
   * image generation model must be configured in settings.
   */
  requires?: 'image-model';
  source: ToolSource;
  /**
   * Skill names this curated tool represents. When one of these skills is
   * installed, it is deduped from the auto-surfaced skill list and injected
   * into the run so the curated form is "powered by" the skill.
   */
  backingSkillNames?: string[];
  /**
   * Skills to inject into the run (resolved at merge time against installed
   * skills). Empty/undefined means a pure MCP/prompt run.
   */
  injectSkills?: string[];
};

/** Form values keyed by `ToolField.name`. */
export type ToolFormValues = Record<string, string | number | string[] | undefined>;

/** A single generated image result. */
export type ToolImageResult = {
  /** Absolute path of the generated file in the workspace. */
  path: string;
  /** Data URL (base64) for inline preview. */
  dataUrl: string;
};

/** Result of a completed tool run. */
export type ToolRunResult = {
  conversation_id: string;
  /** Final assistant text (for text tools, or status text for image tools). */
  text: string;
  /** Generated images (for image tools). */
  images: ToolImageResult[];
};
