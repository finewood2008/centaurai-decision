/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDef, ToolField, ToolFormValues } from './types';

/** Convert a single form value into its prompt string representation. */
function stringifyValue(value: string | number | string[] | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join('\n');
  return String(value);
}

/**
 * Interpolate a `{{field}}` template with form values.
 *
 * - Unknown / empty placeholders resolve to an empty string.
 * - Array values (e.g. uploaded file paths) are joined by newlines.
 * - Whitespace-only lines left behind by empty optional fields are collapsed.
 */
export function interpolatePrompt(template: string, values: ToolFormValues): string {
  const replaced = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    return stringifyValue(values[key]);
  });
  // Drop lines that are empty after interpolation (e.g. unset optional fields),
  // so the composed prompt has no blank/placeholder noise.
  return replaced
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .join('\n')
    .trim();
}

/**
 * Return the i18n keys of required fields that are missing a value.
 * Empty strings, empty arrays and undefined all count as missing.
 */
export function findMissingRequired(tool: ToolDef, values: ToolFormValues): ToolField[] {
  return tool.fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.name];
    if (value === undefined || value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    return String(value).trim().length === 0;
  });
}

/** Build the final prompt string for a tool run from its form values. */
export function buildToolPrompt(tool: ToolDef, values: ToolFormValues): string {
  return interpolatePrompt(tool.execution.promptTemplate, values);
}

/**
 * Collect uploaded file paths across all `upload` fields, in field order.
 * Used to pass reference images to image-editing tools.
 */
export function collectUploadPaths(tool: ToolDef, values: ToolFormValues): string[] {
  const paths: string[] = [];
  for (const field of tool.fields) {
    if (field.type !== 'upload') continue;
    const value = values[field.name];
    if (Array.isArray(value)) paths.push(...value.filter(Boolean));
    else if (typeof value === 'string' && value.trim()) paths.push(value.trim());
  }
  return paths;
}
