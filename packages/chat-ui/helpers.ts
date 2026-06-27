/**
 * Pure helpers shared between desktop and website chat UIs.
 * No DOM, no React, no platform coupling.
 */
import type { ToolCall } from './types';

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
export const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'opus', 'm4a']);

const FILE_PATH_RE = /^([a-zA-Z]:[/\\]|\/(?:tmp|var|home|Users)\/).+\.\w{1,5}$/;

export function getFileExt(p: string): string {
  // Tolerate URL query/hash suffixes (e.g. GCS signed URLs: file.mp4?X-Goog-…)
  // — must stay in sync with desktop content.ts getAttachmentType.
  return (p.match(/\.([a-zA-Z0-9]+)(?:[?#].*)?$/)?.[1] || '').toLowerCase();
}

export function isFilePath(v: unknown): v is string {
  return typeof v === 'string' && FILE_PATH_RE.test(v.trim());
}

/** Extract all file paths from a tool result (flat or nested in arrays/objects). */
export function extractFilePaths(result: any): string[] {
  const paths: string[] = [];
  if (!result || typeof result !== 'object') return paths;

  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    for (const [key, val] of Object.entries(obj)) {
      void key;
      if (isFilePath(val)) paths.push(val);
      else if (typeof val === 'object' && val) walk(val);
    }
  };
  walk(result);
  return [...new Set(paths)];
}

/** Humanize a tool name: "read_file" → "Read File", "runCommand" → "Run Command". */
export function humanizeToolName(tool: string): string {
  return tool
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Format seconds as "42s" or "1m 13s". */
export function formatSec(s: number): string {
  if (s < 60) return `${Math.floor(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}

/**
 * `execute_tool` is a meta-wrapper: the model calls it with `{ tool_name, args }`
 * and the backend runs the real tool, returning `{ success, tool, result, error }`.
 * For display we collapse the wrapper into the real tool so the chain-of-thought
 * step is driven by the tool that actually ran — its name (label + grouping),
 * its args, and its result — not the generic "Execute Tool" shell. Non-wrapper
 * calls (and wrapper calls whose name hasn't streamed in yet) pass through.
 */
const WRAPPER_TOOL_NAMES = new Set(['execute_tool', 'vm_execute_tool', 'sis_execute_tool']);

export function unwrapExecuteTool(tool: ToolCall): ToolCall {
  if (!tool || !WRAPPER_TOOL_NAMES.has(tool.tool)) return tool;

  const wrapperArgs = (tool.args || {}) as Record<string, any>;
  // execute_tool/sis → tool_name; vm_execute_tool → tool.
  const realName =
    typeof wrapperArgs.tool_name === 'string' && wrapperArgs.tool_name.trim()
      ? wrapperArgs.tool_name.trim()
      : typeof wrapperArgs.tool === 'string' && wrapperArgs.tool.trim()
        ? wrapperArgs.tool.trim()
        : typeof wrapperArgs.toolName === 'string' && wrapperArgs.toolName.trim()
          ? wrapperArgs.toolName.trim()
          : '';
  if (!realName || WRAPPER_TOOL_NAMES.has(realName)) return tool;

  const realArgs =
    wrapperArgs.args && typeof wrapperArgs.args === 'object' && !Array.isArray(wrapperArgs.args)
      ? (wrapperArgs.args as Record<string, any>)
      : {};

  let result = tool.result;
  let error = tool.error;
  let status = tool.status;
  const env = tool.result as any;
  // execute_tool → { success, tool, result|error }; vm_execute_tool → { ok, tool, result|error }.
  if (env && typeof env === 'object' && !Array.isArray(env)
    && ('success' in env || 'result' in env || ('ok' in env && 'tool' in env) || 'error' in env)) {
    const failed = env.success === false || env.ok === false || (env.error && env.success !== true && env.ok !== true);
    if (failed) {
      error = typeof env.error === 'string' ? env.error : (error ?? JSON.stringify(env.error));
      result = undefined;
      if (status === 'completed') status = 'error';
    } else if ('result' in env) {
      result = env.result;
    }
  }

  return { ...tool, tool: realName, args: realArgs, result, error, status };
}
