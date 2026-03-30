import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execLocalTool, safeToolWrite } from './bridge';
import { waitTool } from './wait';
import { analyzeMediaTool } from './analyze-media';
import { aiInferenceTool } from './ai-inference';
import { executeAgenticTask } from './agentic-task';
import { web_search } from './perplexity-tools';
import { scrape_url } from './tavily-tools';
import * as deviceTools from './device-tools';
import * as googleTools from './google-tools';
import * as ocrTools from './ocr-tools';
import * as httpTools from './http-tools';
import * as marketplaceTools from './marketplace-tools';
import * as ttsTools from './tts-tools';
import { generate_image } from './image-gen';
import { ask_user } from './ask-user';
import { generateText, generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from '../utils/models';
import { writeLog } from '../utils/logger';
import { getToolRegistry, getToolMetadata } from './tool-registry';

// Note: initToolRegistry is called lazily when needed, not at module load time
// to avoid circular dependency issues with meta-tools.ts

// Debug logger for workflow tools
function wfLog(event: string, data?: Record<string, any>) {
  const msg = data ? `[workflow-tool] ${event}: ${JSON.stringify(data)}` : `[workflow-tool] ${event}`;
  console.log(msg);
  writeLog(`wf_tool_${event}`, data);
}

function getZodDescription(schema: any): string | undefined {
  try {
    const desc = (schema as any)?.description || (schema as any)?._def?.description;
    return desc ? String(desc) : undefined;
  } catch {
    return undefined;
  }
}

function unwrapZod(schema: any): { schema: any; optional: boolean; defaultValue?: any; nullable: boolean } {
  let s = schema;
  let optional = false;
  let nullable = false;
  let defaultValue: any = undefined;

  try {
    while (s) {
      if (s instanceof z.ZodOptional) {
        optional = true;
        s = (s as any)._def?.innerType;
        continue;
      }
      if (s instanceof z.ZodNullable) {
        nullable = true;
        s = (s as any)._def?.innerType;
        continue;
      }
      if (s instanceof z.ZodDefault) {
        try {
          const dv = (s as any)?._def?.defaultValue;
          defaultValue = typeof dv === 'function' ? dv() : dv;
        } catch {}
        s = (s as any)._def?.innerType;
        continue;
      }
      break;
    }
  } catch {}

  return { schema: s, optional, defaultValue, nullable };
}

function zodToJsonish(schema: any): any {
  const { schema: s, optional, defaultValue, nullable } = unwrapZod(schema);
  const description = getZodDescription(schema);

  const base: any = {};
  if (description) base.description = description;
  if (optional) base.optional = true;
  if (typeof defaultValue !== 'undefined') base.default = defaultValue;
  if (nullable) base.nullable = true;

  if (!s) return { type: 'unknown', ...base };
  if (s instanceof z.ZodObject) {
    const shape = (s as any).shape;
    const properties: any = {};
    const required: string[] = [];
    for (const key of Object.keys(shape)) {
      const child = shape[key];
      const childUnwrapped = unwrapZod(child);
      properties[key] = zodToJsonish(child);
      if (!childUnwrapped.optional && typeof childUnwrapped.defaultValue === 'undefined') {
        required.push(key);
      }
    }
    return { type: 'object', properties, required, ...base };
  }
  if (s instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonish((s as any).element), ...base };
  }
  if (s instanceof z.ZodString) return { type: 'string', ...base };
  if (s instanceof z.ZodNumber) return { type: 'number', ...base };
  if (s instanceof z.ZodBoolean) return { type: 'boolean', ...base };
  if (s instanceof z.ZodEnum) return { type: 'enum', values: (s as any)._def?.values || [], ...base };
  if (s instanceof z.ZodLiteral) return { type: 'literal', value: (s as any)._def?.value, ...base };
  if (s instanceof z.ZodRecord) return { type: 'record', ...base };
  if (s instanceof z.ZodAny) return { type: 'any', ...base };
  if (s instanceof z.ZodUnion) return { type: 'union', ...base };
  return { type: 'unknown', ...base };
}

function zodToTemplate(schema: any): any {
  const { schema: s, defaultValue } = unwrapZod(schema);
  if (typeof defaultValue !== 'undefined') return defaultValue;
  if (!s) return null;

  if (s instanceof z.ZodObject) {
    const shape = (s as any).shape;
    const out: any = {};
    for (const key of Object.keys(shape)) {
      out[key] = zodToTemplate(shape[key]);
    }
    return out;
  }
  if (s instanceof z.ZodArray) return [];
  if (s instanceof z.ZodString) return '';
  if (s instanceof z.ZodNumber) return 0;
  if (s instanceof z.ZodBoolean) return false;
  if (s instanceof z.ZodEnum) {
    const values = (s as any)._def?.values;
    return Array.isArray(values) && values.length > 0 ? values[0] : '';
  }
  if (s instanceof z.ZodLiteral) return (s as any)._def?.value;
  if (s instanceof z.ZodRecord) return {};
  if (s instanceof z.ZodAny) return null;
  if (s instanceof z.ZodUnion) return null;
  return null;
}

// Global workflow map to store in-memory workflows in the cloud AI
export const workflowMap = new Map<string, any>();

// Build a registry of cloud-side tools we can invoke directly by name.
// Falls back to execLocalTool for local-only tools.
// Using lazy initialization to avoid circular dependency issues at module load time.
let _cloudToolsCache: Map<string, any> | null = null;

function getCloudTools(): Map<string, any> {
  if (_cloudToolsCache) return _cloudToolsCache;

  const registry = new Map<string, any>();
  const add = (t: any) => {
    try {
      const name = String((t as any)?.id || (t as any)?.name || '').trim();
      if (name && typeof (t as any)?.execute === 'function') registry.set(name, t);
    } catch { }
  };
  add(waitTool);
  add(analyzeMediaTool);
  add(aiInferenceTool);
  add(executeAgenticTask);
  add(web_search);
  add(scrape_url);
  for (const v of Object.values(deviceTools as any)) {
    const maybe = v as any;
    if (
      maybe &&
      typeof maybe === 'object' &&
      typeof maybe.execute === 'function' &&
      (typeof maybe.id === 'string' || typeof maybe.name === 'string')
    ) {
      add(maybe);
    }
  }
  for (const v of Object.values(googleTools as any)) {
    const maybe = v as any;
    if (
      maybe &&
      typeof maybe === 'object' &&
      typeof maybe.execute === 'function' &&
      (typeof maybe.id === 'string' || typeof maybe.name === 'string')
    ) {
      add(maybe);
    }
  }
  for (const v of Object.values(ocrTools as any)) {
    const maybe = v as any;
    if (
      maybe &&
      typeof maybe === 'object' &&
      typeof maybe.execute === 'function' &&
      (typeof maybe.id === 'string' || typeof maybe.name === 'string')
    ) {
      add(maybe);
    }
  }
  for (const v of Object.values(httpTools as any)) {
    const maybe = v as any;
    if (
      maybe &&
      typeof maybe === 'object' &&
      typeof maybe.execute === 'function' &&
      (typeof maybe.id === 'string' || typeof maybe.name === 'string')
    ) {
      add(maybe);
    }
  }
  for (const v of Object.values(marketplaceTools as any)) {
    const maybe = v as any;
    if (
      maybe &&
      typeof maybe === 'object' &&
      typeof maybe.execute === 'function' &&
      (typeof maybe.id === 'string' || typeof maybe.name === 'string')
    ) {
      add(maybe);
    }
  }
  for (const v of Object.values(ttsTools as any)) {
    const maybe = v as any;
    if (
      maybe &&
      typeof maybe === 'object' &&
      typeof maybe.execute === 'function' &&
      (typeof maybe.id === 'string' || typeof maybe.name === 'string')
    ) {
      add(maybe);
    }
  }
  add(generate_image);
  add(ask_user);

  _cloudToolsCache = registry;
  return registry;
}

const StepSchema = z.object({
  tool: z.string(),
  args: z.any().default({}),
  kind: z.enum(['auto', 'cloud', 'local']).default('auto'),
  timeoutMs: z.number().int().min(100).max(600000).optional(),
});

const ResultsSchema = z.array(
  z.object({
    tool: z.string(),
    ok: z.boolean().optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  })
);

const AssertionSchema = z.object({
  type: z.enum(['ok', 'equals', 'contains', 'matches', 'exists']).describe('Assertion type'),
  target: z.enum(['combined', 'last', 'step']).optional().describe('Where to read the value from'),
  stepIndex: z.number().int().min(0).optional().describe('If target is step, which step index'),
  path: z.string().optional().describe('Dot path into the target object (e.g. "stdout" or "data.value")'),
  expected: z.any().optional().describe('Expected value (for equals/contains)'),
  pattern: z.string().optional().describe('Regex pattern (for matches)'),
});

function sanitizeResult(result: any) {
  try {
    if (result && typeof result === 'object') {
      const r: any = { ...result };
      if (typeof r.data === 'string') {
        r.bytes = r.data.length;
        delete r.data;
      }
      return r;
    }
  } catch { }
  return result;
}

// Merge multiple step results into a single combined object.
// - Object results: shallow-merged; array values are concatenated when both sides are arrays.
// - Non-object results: stored under auto keys like value_0, value_1, ...
function combineResults(items: Array<{ result?: any }>) {
  const combined: any = {};
  try {
    let autoIdx = 0;
    for (const it of Array.isArray(items) ? items : []) {
      const res = (it as any)?.result;
      if (res && typeof res === 'object' && !Array.isArray(res)) {
        for (const [k, v] of Object.entries(res)) {
          if (Array.isArray(v) && Array.isArray((combined as any)[k])) {
            (combined as any)[k] = [...(combined as any)[k], ...v];
          } else {
            (combined as any)[k] = v;
          }
        }
      } else if (typeof res !== 'undefined') {
        (combined as any)[`value_${autoIdx++}`] = res;
      }
    }
  } catch { }
  return combined;
}

function normalizeToolName(name: string): string {
  try {
    let n = String(name || '').trim();
    // Strip common prefixes the model may include
    if (n.startsWith('functions.')) n = n.slice('functions.'.length);
    if (n.startsWith('tools.')) n = n.slice('tools.'.length);
    return n;
  } catch {
    return name;
  }
}

function markWorkflowToolArgs(args: any): any {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  return { ...(args as Record<string, any>), __workflowToolCall: true };
}

async function runOne(step: z.infer<typeof StepSchema>, writer?: WritableStreamDefaultWriter<any>, eventTool = 'run_sequential') {
  const { tool, args, kind, timeoutMs } = step;
  const toolName = normalizeToolName(tool);
  const startEvt = { type: 'tool_event', tool: eventTool, status: 'step_started', step: { tool, kind } };
  try { await safeToolWrite(writer as any, startEvt as any); } catch { }

  try {
    let result: any;
    if (kind === 'cloud' || (kind === 'auto' && getCloudTools().has(toolName))) {
      const t = getCloudTools().get(toolName);
      // Do NOT pass the outer ToolStream writer to nested cloud tool to avoid stream lock.
      // Still pass an empty context object so destructuring ({ writer }) doesn't crash.
      result = await (t as any).execute?.(args, {});
    } else {
      result = await execLocalTool(
        toolName,
        markWorkflowToolArgs(args),
        writer as any,
        typeof timeoutMs === 'number' ? timeoutMs : undefined,
      );
    }
    const safe = sanitizeResult(result);
    try { await safeToolWrite(writer as any, { type: 'tool_event', tool: eventTool, status: 'step_completed', step: { tool }, result: safe } as any); } catch { }
    return { tool, ok: (result && typeof result.ok === 'boolean') ? !!result.ok : true, result: safe };
  } catch (e: any) {
    const msg = e?.message || 'failed';
    try { await safeToolWrite(writer as any, { type: 'tool_event', tool: eventTool, status: 'step_error', step: { tool }, error: msg } as any); } catch { }
    return { tool, ok: false, error: msg };
  }
}

export const runSequentialTool = createTool({
  id: 'run_sequential',
  description: 'Run a list of tools in sequence. Each step can target a cloud tool or a local tool.',
  inputSchema: z.object({
    steps: z.array(StepSchema).min(1),
    continueOnError: z.boolean().default(false),
  }),
  execute: async (inputData, { writer }) => {
    const { steps, continueOnError } = inputData;
    const results: any[] = [];
    let firstError: string | undefined;

    await safeToolWrite(writer as any, { type: 'tool_event', tool: 'run_sequential', status: 'started', count: steps.length });
    for (const step of steps) {
      const res = await runOne(step, writer as any);
      results.push(res);
      if ((res.ok ?? true) !== true) {
        if (!firstError) firstError = String(res.error || 'error');
        if (!continueOnError) break;
      }
    }
    const allOk = results.every((r) => (r.ok ?? true) === true);
    const combined = combineResults(results);
    await safeToolWrite(writer as any, { type: 'tool_event', tool: 'run_sequential', status: 'completed', count: results.length, allOk });
    return { results, combined, allOk, firstError };
  },
});

export const runParallelTool = createTool({
  id: 'run_parallel',
  description: 'Run a list of tools in parallel with optional concurrency limit.',
  inputSchema: z.object({
    steps: z.array(StepSchema).min(1),
    concurrency: z.number().int().min(1).optional(),
  }),
  execute: async (inputData, { writer }) => {
    const { steps, concurrency } = inputData;
    const limit = Math.max(1, Math.min(typeof concurrency === 'number' ? concurrency : steps.length, steps.length));

    await safeToolWrite(writer as any, { type: 'tool_event', tool: 'run_parallel', status: 'started', count: steps.length, concurrency: limit });

    const results: any[] = new Array(steps.length);
    let idx = 0;

    async function worker() {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= steps.length) break;
        const step = steps[myIdx];
        const toolName = normalizeToolName(step.tool);
        const startEvt = { type: 'tool_event', tool: 'run_parallel', status: 'step_started', step: { index: myIdx, tool: step.tool, kind: step.kind } };
        try { await safeToolWrite(writer as any, startEvt as any); } catch { }
        try {
          let result: any;
          if (step.kind === 'cloud' || (step.kind === 'auto' && getCloudTools().has(toolName))) {
            const t = getCloudTools().get(toolName);
            // Avoid passing parent ToolStream writer to nested cloud tool to prevent lock.
            // Still pass an empty context object so destructuring ({ writer }) doesn't crash.
            result = await (t as any).execute?.(step.args, {});
          } else {
            result = await execLocalTool(
              toolName,
              markWorkflowToolArgs(step.args),
              writer as any,
              typeof step.timeoutMs === 'number' ? step.timeoutMs : undefined,
            );
          }
          const safe = sanitizeResult(result);
          results[myIdx] = { tool: step.tool, ok: (result && typeof result.ok === 'boolean') ? !!result.ok : true, result: safe };
          try { await safeToolWrite(writer as any, { type: 'tool_event', tool: 'run_parallel', status: 'step_completed', step: { index: myIdx, tool: step.tool }, result: safe } as any); } catch { }
        } catch (e: any) {
          const msg = e?.message || 'failed';
          results[myIdx] = { tool: step.tool, ok: false, error: msg };
          try {
            await safeToolWrite(
              writer as any,
              { type: 'tool_event', tool: 'run_parallel', status: 'step_error', step: { index: myIdx, tool: step.tool }, error: msg } as any,
            );
          } catch { }
        }
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < limit; i++) workers.push(worker());
    await Promise.all(workers);

    const allOk = results.every((r) => (r?.ok ?? true) === true);
    const combined = combineResults(results as any);
    await safeToolWrite(writer as any, { type: 'tool_event', tool: 'run_parallel', status: 'completed', count: results.length, allOk });
    return { results, combined, allOk };
  },
});

// ---- Workflow / Stuard spec generation ----------------------------------------------------

function stuardSpecToWorkflowDefinition(spec: any): any {
  // Convert StuardSpec to WorkflowDefinition (authoring DSL)
  const name = String(spec?.name || spec?.id || 'Workflow');
  const version = String(spec?.version || '1');
  const description = String(spec?.description || '');
  const mode = spec?.autostart ? 'auto' : 'manual';
  const requirements = spec?.requirements || '';
  const scripts = spec?.scripts || {};

  const triggers = Array.isArray(spec?.triggers) ? spec.triggers.map((t: any) => ({
    id: String(t?.id || ''),
    type: String(t?.type || 'manual'),
    args: t?.args || {},
  })) : [{ type: 'manual', args: {} }];

  const steps = Array.isArray(spec?.steps) ? spec.steps.map((s: any) => {
    const step: any = {
      id: String(s?.id || ''),
      uses: String(s?.tool || 'noop'),
      with: s?.args || {},
    };
    // Preserve control flow metadata if present
    if (s?.args?.__if) step.if = s.args.__if;
    if (s?.args?.__control) {
      if (s.args.__control.timeoutMs) step.timeoutMs = s.args.__control.timeoutMs;
      if (s.args.__control.retry) step.retry = s.args.__control.retry;
      if (s.args.__control.on_error) step.on_error = s.args.__control.on_error;
    }
    if (s?.args?.__out) step.out = s.args.__out;
    return step;
  }) : [];

  return {
    name,
    version,
    description,
    mode,
    triggers,
    steps,
    requirements,
    scripts,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('generation_timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Minimal workflow spec schema - accepts any JSON workflow format
// Only requires 'id', everything else is passthrough to support both:
// - StuardSpec format (steps array with embedded next edges)
// - DesignerModel format (nodes + wires arrays)
const WorkflowSpecSchema = z.object({
  id: z.string(),
}).passthrough();

/**
 * Create a new workflow from scratch with full spec.
 */
export const createWorkflowTool = createTool({
  id: 'create_workflow',
  description: `Create a new workflow from scratch. Provide the full workflow JSON spec.

REQUIRED FIELDS:
- id: unique ID (e.g., "flow_abc123")
- name: display name
- triggers: array of triggers
- nodes: array of nodes
- wires: array connecting triggers to nodes

EXAMPLE:
{
  "spec": {
    "id": "flow_my_app",
    "name": "My App",
    "version": "1",
    "triggers": [{ "id": "trig_0", "type": "manual", "label": "Manual", "args": {}, "position": { "x": 50, "y": 50 } }],
    "nodes": [{ "id": "step_1", "tool": "log", "label": "Log", "args": { "message": "Hello" }, "position": { "x": 200, "y": 50 } }],
    "wires": [{ "from": "trig_0", "to": "step_1" }]
  }
}

`,
  inputSchema: z.object({
    spec: WorkflowSpecSchema.describe('The full workflow spec'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    spec: WorkflowSpecSchema.optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const { spec } = inputData as { spec?: any };

    if (!spec || !spec.id) {
      return { ok: false, error: 'Spec with id is required' };
    }

    // Fill in defaults
    if (!spec.name) spec.name = 'New Workflow';
    if (!spec.version) spec.version = '1';
    if (!Array.isArray(spec.triggers)) {
      spec.triggers = [{ id: 'trig_0', type: 'manual', label: 'Manual', args: {}, position: { x: 50, y: 50 } }];
    }
    if (!Array.isArray(spec.nodes)) spec.nodes = [];
    if (!Array.isArray(spec.wires)) spec.wires = [];

    // Ensure positions
    spec.triggers = spec.triggers.map((t: any, i: number) => ({
      ...t,
      position: t.position || { x: 50, y: 50 + i * 120 }
    }));
    spec.nodes = spec.nodes.map((n: any, i: number) => ({
      ...n,
      position: n.position || { x: 200, y: 50 + i * 120 }
    }));

    wfLog('create_workflow', { id: spec.id, nodes: spec.nodes.length });

    // Store in in-memory map for quick access
    workflowMap.set(spec.id, spec);

    await safeToolWrite(writer as any, {
      type: 'tool_event',
      tool: 'create_workflow',
      status: 'completed',
      workflowId: spec.id,
    });

    return { ok: true, spec };
  },
});

export const retrieveToolFormat = createTool({
  id: 'get_tool_schema',
  description: 'Get the schema and argument format for a specific tool by name. Pass the exact tool name to get its args template.',
  inputSchema: z.object({
    toolName: z.string().describe('The exact tool name to look up (e.g., "take_screenshot", "run_command")'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    tool: z.object({
      id: z.string(),
      kind: z.string().optional(),
      description: z.string().optional(),
      argsTemplate: z.any().optional(),
      outputSchema: z.any().optional(),
      inputSchema: z.any().optional(),
      category: z.string().optional(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { toolName } = inputData as { toolName: string };
    
    if (!toolName) {
      return { found: false, error: 'toolName is required' };
    }

    // Search in Registry
    const registry = getToolRegistry();
    let tool = registry.get(toolName);
    let toolId = toolName;

    // Case-insensitive fallback
    if (!tool) {
      for (const [id, t] of registry.entries()) {
        if (id.toLowerCase() === toolName.toLowerCase()) {
          tool = t;
          toolId = id;
          break;
        }
      }
    }

    if (tool) {
      const metadata = getToolMetadata(toolId) || { category: 'Other', kind: 'local' };

      const inputSchema = (tool as any).inputSchema;
      const outputSchema = (tool as any).outputSchema;
      const argsTemplate = inputSchema ? zodToTemplate(inputSchema) : {};

      return {
        found: true,
        tool: {
          id: toolId,
          kind: metadata.kind,
          description: tool.description,
          argsTemplate,
          inputSchema: inputSchema ? zodToJsonish(inputSchema) : {},
          outputSchema: outputSchema ? zodToJsonish(outputSchema) : {},
          category: metadata.category,
        },
      };
    }

    // Not found - suggest similar tools
    const similar: string[] = [];
    for (const id of registry.keys()) {
        if (id.toLowerCase().includes(toolName.toLowerCase()) || toolName.toLowerCase().includes(id.toLowerCase().split('_')[0])) {
            similar.push(id);
            if (similar.length >= 5) break;
        }
    }

    return {
      found: false,
      error: `Tool "${toolName}" not found.${similar.length > 0 ? ` Similar: ${similar.join(', ')}` : ' Use search_tools to find available tools.'}`,
    };
  },
});

// Legacy: list all tools (for backward compatibility)
export const listAllToolFormats = createTool({
  id: 'list_all_tool_formats',
  description: 'Return ALL workflow triggers and tools with their argument formats. Use get_tool_schema for a specific tool.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    triggers: z.array(z.any()),
    tools: z.array(z.any()),
  }),
  execute: async () => {
    const triggers = [
      { type: 'manual', description: 'Manual trigger - run workflow on demand', argsTemplate: {} },
      { type: 'app_start', description: 'Application startup trigger - run once when Stuard launches after the local Python agent is ready', argsTemplate: {} },
      { type: 'webhook', description: 'Webhook trigger - receive HTTP POST requests. Set mode to "cloud" for public URL or "local" for localhost.', argsTemplate: { mode: 'cloud' } },
      { type: 'schedule.cron', description: 'Cron schedule trigger', argsTemplate: { cron: '0 9 * * *' } },
      { type: 'hotkey', description: 'Global hotkey trigger', argsTemplate: { accelerator: 'Ctrl+Alt+K' } },
      { type: 'keystroke', description: 'Keystroke sequence trigger', argsTemplate: { sequence: 'stuard' } },
      { type: 'fs.watch', description: 'Filesystem watch trigger', argsTemplate: { path: 'C:/path', pattern: '*.*' } },
      { type: 'gmail.new_email', description: 'Native Gmail push trigger for new emails', argsTemplate: { profile: 'default', labelIds: ['INBOX'] } },
      { type: 'drive.new_file', description: 'Native Google Drive push trigger for new files', argsTemplate: { profile: 'default', onlyNew: true } },
    ];

    const registry = getToolRegistry();
    const tools = Array.from(registry.entries()).map(([id, tool]) => {
      const metadata = getToolMetadata(id) || { category: 'Other', kind: 'local' };

      const inputSchema = (tool as any).inputSchema;
      const outputSchema = (tool as any).outputSchema;
      return {
        id,
        kind: metadata.kind,
        description: tool.description,
        argsTemplate: inputSchema ? zodToTemplate(inputSchema) : {},
        inputSchema: inputSchema ? zodToJsonish(inputSchema) : {},
        outputSchema: outputSchema ? zodToJsonish(outputSchema) : {},
        category: metadata.category,
      };
    });

    return { triggers, tools };
  },
});

/**
 * Test a single workflow step before finalizing - allows the AI to verify tool behavior
 */
export const testWorkflowStepTool = createTool({
  id: 'test_workflow_step',
  description: 'Test a single workflow step/tool with given arguments before adding it to the workflow. Returns the result so you can verify the tool works as expected.',
  inputSchema: z.object({
    mode: z.enum(['single', 'segment']).default('single').describe('Test mode: a single tool call or a multi-step segment'),
    tool: z.string().optional().describe('The tool name to test (single mode)'),
    args: z.any().default({}).describe('Arguments to pass to the tool (single mode)'),
    steps: z.array(StepSchema).optional().describe('Steps to execute (segment mode). Each step supports tool/args/kind/timeoutMs.'),
    dryRun: z.boolean().default(false).describe('If true, only validates args without executing'),
    continueOnError: z.boolean().default(false).describe('If true in segment mode, continue even if a step fails'),
    assertions: z.array(AssertionSchema).optional().describe('Optional assertions to verify outputs'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    mode: z.enum(['single', 'segment']).optional(),
    result: z.any().optional(),
    results: z.any().optional(),
    combined: z.any().optional(),
    assertions: z.any().optional(),
    allAssertionsOk: z.boolean().optional(),
    error: z.string().optional(),
    duration: z.number().optional(),
    dryRun: z.boolean().optional(),
  }),
  execute: async (inputData, { writer }) => {
    const c = inputData as any;
    const explicitMode = c?.mode === 'single' || c?.mode === 'segment' ? (c.mode as 'single' | 'segment') : undefined;
    const mode: 'single' | 'segment' = explicitMode
      ? explicitMode
      : (Array.isArray(c?.steps) && c.steps.length > 0 ? 'segment' : 'single');
    const dryRun = !!c?.dryRun;
    const assertions = Array.isArray(c?.assertions) ? c.assertions : [];

    const getPathValue = (obj: any, path?: string) => {
      if (!path) return obj;
      try {
        const parts = String(path).split('.').filter(Boolean);
        let cur: any = obj;
        for (const p of parts) {
          if (cur == null) return undefined;
          const m = /^(.+)\[(\d+)\]$/.exec(p);
          if (m) {
            const key = m[1];
            const idx = Number(m[2]);
            cur = (cur as any)?.[key];
            if (!Array.isArray(cur)) return undefined;
            cur = cur[idx];
          } else {
            cur = (cur as any)?.[p];
          }
        }
        return cur;
      } catch {
        return undefined;
      }
    };

    const evalAssertions = (results: any[], combined: any, allOk: boolean) => {
      const out: any[] = [];
      let allAssertionsOk = true;
      for (const a of assertions) {
        const type = String(a?.type || '').trim();
        const target = String(a?.target || (typeof a?.stepIndex === 'number' ? 'step' : 'combined')) as any;
        const stepIndex = typeof a?.stepIndex === 'number' ? a.stepIndex : undefined;

        let base: any = combined;
        if (target === 'last') base = results.length ? (results[results.length - 1]?.result) : undefined;
        if (target === 'step') base = (typeof stepIndex === 'number' && results[stepIndex]) ? results[stepIndex]?.result : undefined;
        const actual = getPathValue(base, a?.path);

        let ok = true;
        let message = 'ok';

        if (type === 'ok') {
          ok = target === 'step'
            ? (typeof stepIndex === 'number' ? ((results[stepIndex]?.ok ?? true) === true) : false)
            : allOk;
          message = ok ? 'ok' : 'expected ok';
        } else if (type === 'exists') {
          ok = typeof actual !== 'undefined' && actual !== null;
          message = ok ? 'exists' : 'missing';
        } else if (type === 'equals') {
          const exp = a?.expected;
          ok = JSON.stringify(actual) === JSON.stringify(exp);
          message = ok ? 'equals' : 'not_equal';
        } else if (type === 'contains') {
          const exp = a?.expected;
          if (typeof actual === 'string') ok = typeof exp === 'string' ? actual.includes(exp) : false;
          else if (Array.isArray(actual)) ok = actual.some((v) => JSON.stringify(v) === JSON.stringify(exp));
          else ok = false;
          message = ok ? 'contains' : 'not_contains';
        } else if (type === 'matches') {
          try {
            const re = new RegExp(String(a?.pattern || ''));
            ok = typeof actual === 'string' ? re.test(actual) : false;
          } catch {
            ok = false;
          }
          message = ok ? 'matches' : 'no_match';
        } else {
          ok = false;
          message = 'unknown_assertion_type';
        }

        if (!ok) allAssertionsOk = false;
        out.push({ ok, type, target, stepIndex, path: a?.path, message, expected: a?.expected, pattern: a?.pattern });
      }
      return { assertions: out, allAssertionsOk };
    };

    const toolName = mode === 'single' ? normalizeToolName(String(c?.tool || '')) : 'segment';
    wfLog('test_step_start', { mode, tool: toolName, dryRun });

    try {
      await safeToolWrite(writer as any, {
        type: 'tool_event',
        tool: 'test_workflow_step',
        status: dryRun ? 'validating' : 'executing',
        mode,
        step: mode === 'single' ? { tool: toolName } : undefined,
        count: mode === 'segment' && Array.isArray(c?.steps) ? c.steps.length : undefined,
      });

      if (mode === 'single') {
        if (!toolName) return { ok: false, mode, error: 'missing_tool' };

        if (dryRun) {
          const cloudTools = getCloudTools();
          const isCloud = cloudTools.has(toolName);
          const registry = getToolRegistry();
          const tool = registry.get(toolName);
          
          if (!isCloud && !tool) {
            return { ok: false, mode, error: `Unknown tool: ${toolName}`, dryRun: true };
          }
          const metadata = getToolMetadata(toolName) || { kind: isCloud ? 'cloud' : 'local' };
          return {
            ok: true,
            mode,
            dryRun: true,
            result: {
              toolFound: true,
              kind: metadata.kind,
              description: tool?.description || 'Cloud tool'
            }
          };
        }

        const startTime = Date.now();
        let result: any;
        const cloudTools = getCloudTools();
        if (cloudTools.has(toolName)) {
          const t = cloudTools.get(toolName);
          result = await (t as any).execute?.(c?.args, {});
        } else {
          result = await execLocalTool(toolName, markWorkflowToolArgs(c?.args), writer as any, 30000);
        }

        const duration = Date.now() - startTime;
        const safe = sanitizeResult(result);

        wfLog('test_step_complete', { mode, tool: toolName, duration, ok: result?.ok !== false });

        const assertionEval = evalAssertions([{ tool: toolName, ok: result?.ok !== false, result: safe }], safe, result?.ok !== false);

        await safeToolWrite(writer as any, {
          type: 'tool_event',
          tool: 'test_workflow_step',
          status: 'completed',
          mode,
          step: { tool: toolName },
          result: safe,
          assertions: assertionEval.assertions,
          allAssertionsOk: assertionEval.allAssertionsOk,
        });

        const ok = (result?.ok !== false) && (assertionEval.allAssertionsOk !== false);
        return {
          ok,
          mode,
          result: safe,
          duration,
          dryRun: false,
          assertions: assertionEval.assertions,
          allAssertionsOk: assertionEval.allAssertionsOk,
          error: result?.error,
        };
      }

      const steps = Array.isArray(c?.steps) ? c.steps : [];
      if (steps.length === 0) return { ok: false, mode, error: 'missing_steps' };

      if (dryRun) {
        const cloudTools = getCloudTools();
        const registry = getToolRegistry();
        for (const s of steps) {
          const tn = normalizeToolName(String((s as any)?.tool || ''));
          const isCloud = cloudTools.has(tn);
          const tool = registry.get(tn);
          
          if (!isCloud && !tool) {
            return { ok: false, mode, error: `Unknown tool: ${tn}`, dryRun: true };
          }
        }
        return { ok: true, mode, dryRun: true, result: { validated: true, count: steps.length } };
      }

      const startTime = Date.now();
      const results: any[] = [];
      let firstError: string | undefined;
      const continueOnError = !!c?.continueOnError;

      for (const s of steps) {
        const res = await runOne(s, writer as any, 'test_workflow_step');
        results.push(res);
        if ((res.ok ?? true) !== true) {
          if (!firstError) firstError = String(res.error || 'error');
          if (!continueOnError) break;
        }
      }

      const allOk = results.every((r) => (r.ok ?? true) === true);
      const combined = combineResults(results);
      const duration = Date.now() - startTime;
      const assertionEval = evalAssertions(results, combined, allOk);

      await safeToolWrite(writer as any, {
        type: 'tool_event',
        tool: 'test_workflow_step',
        status: 'completed',
        mode,
        count: results.length,
        allOk,
        assertions: assertionEval.assertions,
        allAssertionsOk: assertionEval.allAssertionsOk,
      });

      const ok = allOk && (assertionEval.allAssertionsOk !== false);
      wfLog('test_step_complete', { mode, duration, ok });

      return {
        ok,
        mode,
        results,
        combined,
        assertions: assertionEval.assertions,
        allAssertionsOk: assertionEval.allAssertionsOk,
        duration,
        error: firstError,
      };
    } catch (e: any) {
      const error = e?.message || 'test_failed';
      wfLog('test_step_error', { mode, tool: toolName, error });
      return { ok: false, mode, error };
    }
  },
});
