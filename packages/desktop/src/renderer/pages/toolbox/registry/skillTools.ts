/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDef } from '../types';

/** Minimal shape of an installed skill from `listAvailableSkills`. */
export type InstalledSkill = {
  name: string;
  description: string;
  source: 'builtin' | 'custom' | 'extension';
};

/**
 * Heuristic: is this skill an image/poster generator we want to surface in the
 * toolbox? Matched on the skill NAME only (not description) to avoid false
 * positives from unrelated skills that merely mention images.
 */
const IMAGE_SKILL_NAME = /(image|poster|logo|avatar|icon|draw|绘|海报|插画|illustration)/i;

export function isToolboxImageSkill(skill: { name: string }): boolean {
  return IMAGE_SKILL_NAME.test(skill.name);
}

/**
 * Convert an installed skill into a generic, form-driven toolbox tool: a single
 * free-text prompt that is injected together with the skill into the run. This
 * is the hybrid seam — any image skill the user installs shows up automatically,
 * even without a curated builtin form.
 */
/**
 * Merge curated builtin tools with installed skills (the hybrid model).
 *
 * - Every curated tool is kept. When its backing skill is installed, that skill
 *   is injected into the run so the curated form is "powered by" the skill.
 * - Any installed image skill not already covered by a curated tool is appended
 *   as a generic, single-prompt tool.
 *
 * Pure function: never mutates its inputs (registry singletons are copy-on-write).
 */
export function mergeToolboxTools(builtin: ToolDef[], skills: InstalledSkill[]): ToolDef[] {
  const coveredSkills = new Set(builtin.flatMap((tool) => tool.backingSkillNames ?? []));
  const installedNames = new Set(skills.map((skill) => skill.name));

  const curated: ToolDef[] = [];
  for (const tool of builtin) {
    const inject = (tool.backingSkillNames ?? []).filter((name) => installedNames.has(name));
    curated.push(inject.length ? { ...tool, injectSkills: inject } : tool);
  }

  const extra = skills
    .filter((skill) => isToolboxImageSkill(skill) && !coveredSkills.has(skill.name))
    .map(skillToToolDef);

  return [...curated, ...extra];
}

export function skillToToolDef(skill: InstalledSkill): ToolDef {
  return {
    id: `skill:${skill.name}`,
    titleKey: 'toolbox.title',
    descKey: 'toolbox.subtitle',
    titleText: skill.name,
    descText: skill.description,
    icon: 'Magic',
    category: 'image',
    output: 'image',
    requires: 'image-model',
    source: 'skill',
    injectSkills: [skill.name],
    execution: { kind: 'skill', skillName: skill.name, promptTemplate: '{{prompt}}' },
    fields: [
      {
        name: 'prompt',
        type: 'textarea',
        labelKey: 'toolbox.fields.prompt.label',
        placeholderKey: 'toolbox.fields.prompt.placeholder',
        required: true,
      },
    ],
  };
}
