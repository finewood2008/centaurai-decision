/**
 * @license
 * Copyright 2025 CentaurAI (centaurloop.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ipcBridge } from '@/common';
import { BUILTIN_IMAGE_GEN_ID, BUILTIN_IMAGE_GEN_NAME } from '@/common/config/storage';
import type { IDirectImageGenResult } from '@/common/adapter/ipcBridge';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

function getBackendPort(): number | undefined {
  return (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
}

type McpTransportConfig = { type: string; command: string; args: string[]; env?: Record<string, string> };
type McpServerRow = { id?: string; name?: string; builtin?: boolean; transport?: McpTransportConfig };

/** Fetch the configured builtin image-generation MCP server (command/args/env). */
async function resolveImageMcpTransport(): Promise<McpTransportConfig | null> {
  const port = getBackendPort();
  if (!port) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/mcp/servers`);
    const body = (await res.json()) as { data?: McpServerRow[] } | McpServerRow[];
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    const server = rows.find(
      (s) => s.builtin === true && (s.id === BUILTIN_IMAGE_GEN_ID || s.name === BUILTIN_IMAGE_GEN_NAME)
    );
    const transport = server?.transport;
    if (!transport || transport.type !== 'stdio' || !transport.command) return null;
    return transport;
  } catch {
    return null;
  }
}

/** Extract the saved image path from the tool's text output. */
function parseSavedPath(text: string): string | undefined {
  const match = text.match(/(?:saved to|保存(?:到|至))[:：]?\s*([^\s'"]+\.(?:png|jpe?g|webp|gif|bmp|avif))/i);
  return match?.[1];
}

/** Newest image file in a directory (fallback when the path isn't in the text). */
function newestImageIn(dir: string): string | undefined {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXT.test(f))
      .map((f) => path.join(dir, f));
    if (files.length === 0) return undefined;
    return files.toSorted((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  } catch {
    return undefined;
  }
}

export function initImageGenBridge(): void {
  ipcBridge.imageGen.generate.provider(async ({ prompt, image_uris, workspace }): Promise<IDirectImageGenResult> => {
    const transport = await resolveImageMcpTransport();
    if (!transport) {
      return { success: false, text: '', error: 'image-model-not-configured' };
    }

    // Default to a stable, user-visible output folder when no workspace is given.
    const outDir = workspace || path.join(app.getPath('userData'), 'toolbox-images');
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch {
      /* best effort */
    }

    let client: Client | undefined;
    try {
      const stdio = new StdioClientTransport({
        command: transport.command,
        args: transport.args,
        env: { PATH: process.env.PATH ?? '', ...transport.env },
      });
      client = new Client({ name: 'toolbox-imagegen', version: '1.0.0' }, { capabilities: {} });
      await client.connect(stdio);

      const tools = await client.listTools();
      const toolName = tools.tools[0]?.name;
      if (!toolName) return { success: false, text: '', error: 'image-tool-unavailable' };

      const res = await client.callTool({
        name: toolName,
        arguments: { prompt, image_uris, workspace_dir: outDir },
      });
      const text = ((res.content as Array<{ type: string; text?: string }>) || [])
        .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
        .join('\n');

      if (res.isError === true) {
        return { success: false, text, error: 'generation-failed' };
      }
      const imagePath = parseSavedPath(text) ?? newestImageIn(outDir);
      return { success: true, text, imagePath };
    } catch (error) {
      return { success: false, text: '', error: error instanceof Error ? error.message : String(error) };
    } finally {
      await client?.close().catch(() => {});
    }
  });
}
