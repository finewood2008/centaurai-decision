/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import { getToolboxTools } from './registry';
import { mergeToolboxTools, type InstalledSkill } from './registry/skillTools';
import type { ToolDef } from './types';

/**
 * Resolve the toolbox tool list: curated builtin tools merged with installed
 * skills (the hybrid model).
 *
 * - Curated tools are always present. When a curated tool's backing skill is
 *   installed, that skill is injected into its run ("powered by the skill").
 * - Any installed image skill not already covered by a curated tool is
 *   auto-surfaced as a generic, single-prompt tool.
 *
 * Starts from the builtin list synchronously, then refines once the skill list
 * loads, so the page renders instantly and never blocks on the backend.
 */
export function useToolboxTools(): ToolDef[] {
  const [tools, setTools] = useState<ToolDef[]>(() => getToolboxTools());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const skills = (await ipcBridge.fs.listAvailableSkills.invoke()) as InstalledSkill[];
        if (cancelled) return;
        setTools(mergeToolboxTools(getToolboxTools(), skills));
      } catch (error) {
        console.error('[toolbox] failed to load skills', error);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return tools;
}
