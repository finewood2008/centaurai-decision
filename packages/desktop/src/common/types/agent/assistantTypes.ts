/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Mirror of aionui-api-types/src/assistant.rs.
// Any shape change on either side requires a same-PR update on the other.

export type AssistantSource = 'builtin' | 'generated' | 'user' | 'extension';

export interface Assistant {
  id: string;
  source: AssistantSource;
  name: string;
  name_i18n: Record<string, string>;
  description?: string;
  description_i18n: Record<string, string>;
  avatar?: string;
  enabled: boolean;
  sort_order: number;
  /** Core v2 execution-agent identity used by team creation. */
  agent_id?: string;
  /** Core v2's authoritative team-mode availability decision. */
  team_selectable?: boolean;
  preset_agent_type: string;
  enabled_skills: string[];
  custom_skill_names: string[];
  disabled_builtin_skills: string[];
  context?: string;
  context_i18n: Record<string, string>;
  prompts: string[];
  prompts_i18n: Record<string, string[]>;
  models: string[];
  last_used_at?: number;
}

export interface CreateAssistantRequest {
  id?: string;
  name: string;
  description?: string;
  avatar?: string;
  agent_id?: string;
  /** Legacy manifest hint; convert to agent_id before sending to Core v2. */
  preset_agent_type?: string;
  enabled_skills?: string[];
  custom_skill_names?: string[];
  disabled_builtin_skills?: string[];
  prompts?: string[];
  models?: string[];
  name_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  prompts_i18n?: Record<string, string[]>;
}

export type UpdateAssistantRequest = Partial<Omit<CreateAssistantRequest, 'id'>> & {
  id: string;
};

export interface SetAssistantStateRequest {
  id: string;
  enabled?: boolean;
  sort_order?: number;
  last_used_at?: number;
}

export interface ImportAssistantsRequest {
  assistants: CreateAssistantRequest[];
}

export interface ImportError {
  id: string;
  error: string;
}

export interface ImportAssistantsResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: ImportError[];
}
