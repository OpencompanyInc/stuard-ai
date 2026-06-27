import { RouterContext } from '../types';
import { execLocalTool } from './local';
import { ChildProcess, execFile, spawn } from 'child_process';

const OLLAMA_DEFAULT_HOST = 'http://localhost:11434';
let ollamaServeProcess: ChildProcess | null = null;

const OLLAMA_AGENT_DEFAULT_TOOLS = [
  'wait',
  'read_file',
  'write_file',
  'list_directory',
  'create_directory',
  'move_file',
  'glob',
  'grep',
  'run_command',
  'take_screenshot',
  'analyze_current_screen',
  'get_clipboard_content',
  'set_clipboard_content',
  'search_local_workflows',
  'invoke_workflow',
  'browser_use_status',
  'browser_use_navigate',
  'browser_use_click',
  'browser_use_type',
  'browser_use_press_key',
  'browser_use_content',
  'browser_use_get_interactive_elements',
  'browser_use_wait_for',
] as const;

const OLLAMA_AGENT_BLOCKED_TOOLS = new Set([
  'ollama_agent',
  'ollama_chat',
  'ollama_generate',
  'ollama_vision',
  'ollama_embeddings',
  'ollama_models',
  'run_sequential',
  'run_parallel',
  'loop_executor',
  'agent_node',
  'agent_decision',
  'agent_extract',
]);

let workflowToolSchemaModulePromise: Promise<typeof import('../../../renderer/workflows/constants/tool-schemas')> | null = null;

function getOllamaHost(): string {
  return process.env.OLLAMA_HOST || OLLAMA_DEFAULT_HOST;
}

async function ollamaFetch(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const { timeoutMs = 30000, ...fetchOpts } = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${getOllamaHost()}${path}`, {
      ...fetchOpts,
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

function runCmd(cmd: string, args: string[], timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err) => {
      resolve(!err);
    });
  });
}

async function isOllamaInstalled(): Promise<boolean> {
  // Fast and cross-platform enough for our desktop targets.
  return runCmd('ollama', ['--version'], 6000);
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const resp = await ollamaFetch('/api/tags', { timeoutMs: 3000 });
    return resp.ok;
  } catch {
    return false;
  }
}

function parseNdjsonLine(line: string): any | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function streamOllamaTextToWorkflowStream(
  endpoint: '/api/chat' | '/api/generate',
  body: any,
  streamId: string,
  ctx: RouterContext,
  extractToken: (chunk: any) => string,
): Promise<{ fullText: string; tokenCount: number; writeCount: number }> {
  const resp = await ollamaFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 600000,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Ollama returned ${resp.status}: ${errText}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error('Ollama response has no readable stream body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let tokenCount = 0;
  let writeCount = 0;

  // Keep stream writes ordered but do not block network reads per token.
  let writeChain: Promise<void> = Promise.resolve();
  const enqueueWrite = (text: string) => {
    if (!text) return;
    writeCount += 1;
    writeChain = writeChain
      .then(async () => {
        await execLocalTool('stream_write', { streamId, chunk: text, chunkType: 'raw' }, ctx).catch(() => {});
      })
      .catch(() => {});
  };

  const processLine = (line: string): string => {
    const chunk = parseNdjsonLine(line);
    if (!chunk) return '';
    const token = extractToken(chunk);
    if (!token) return '';
    tokenCount += 1;
    fullText += token;
    return token;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let batchedText = '';
    for (const line of lines) {
      batchedText += processLine(line);
    }

    // Write once per network chunk to avoid artificial token-by-token throttling.
    enqueueWrite(batchedText);
  }

  // Flush any remaining buffered line (some responses omit trailing newline).
  if (buffer.trim()) {
    enqueueWrite(processLine(buffer));
  }

  await writeChain;
  return { fullText, tokenCount, writeCount };
}

async function loadWorkflowToolSchemas() {
  if (!workflowToolSchemaModulePromise) {
    workflowToolSchemaModulePromise = import('../../../renderer/workflows/constants/tool-schemas');
  }
  return workflowToolSchemaModulePromise;
}

function truncateText(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength).trimEnd();
  return `${clipped}\n...[truncated ${value.length - maxLength} chars]`;
}

function compactForPrompt(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return truncateText(value, depth === 0 ? 5000 : 1600);
  }
  if (typeof value !== 'object') return value;
  if (depth >= 3) return '[truncated]';

  if (Array.isArray(value)) {
    const limit = depth === 0 ? 12 : 8;
    const out = value.slice(0, limit).map((item) => compactForPrompt(item, depth + 1));
    if (value.length > limit) out.push(`[+${value.length - limit} more items]`);
    return out;
  }

  const entries = Object.entries(value);
  const limit = depth === 0 ? 18 : 10;
  const out: Record<string, any> = {};
  for (const [key, entryValue] of entries.slice(0, limit)) {
    out[key] = compactForPrompt(entryValue, depth + 1);
  }
  if (entries.length > limit) {
    out.__truncated__ = `+${entries.length - limit} more keys`;
  }
  return out;
}

function normalizeToolArguments(raw: any): any {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }
  return {};
}

function normalizeOllamaToolCalls(raw: any): Array<{ name: string; arguments: any }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => {
      const fn = entry?.function || entry;
      const name = String(fn?.name || '').trim();
      if (!name) return null;
      return {
        name,
        arguments: normalizeToolArguments(fn?.arguments),
      };
    })
    .filter(Boolean) as Array<{ name: string; arguments: any }>;
}

function summarizeArgSchema(arg: any): any {
  if (!arg || typeof arg !== 'object') return {};
  const summary: Record<string, any> = {
    type: arg.type || 'string',
  };
  if (arg.required === true) summary.required = true;
  if (typeof arg.description === 'string' && arg.description.trim()) {
    summary.description = truncateText(arg.description.trim(), 220);
  }
  if (arg.default !== undefined) summary.default = arg.default;
  if (typeof arg.placeholder === 'string' && arg.placeholder.trim()) {
    summary.placeholder = arg.placeholder.trim();
  }
  if (typeof arg.itemType === 'string') summary.itemType = arg.itemType;
  if (Array.isArray(arg.options) && arg.options.length > 0) {
    summary.options = arg.options.slice(0, 10).map((opt: any) => ({
      value: opt?.value,
      label: opt?.label,
    }));
  }
  return summary;
}

async function resolveAllowedOllamaTools(
  requestedTools: any,
  toolMode?: any,
  options?: { toolsProvided?: boolean },
): Promise<string[]> {
  const toolSchemas = await loadWorkflowToolSchemas();
  const knownTools = new Set<string>(toolSchemas.getAllToolNames());
  const normalizedMode = String(toolMode || '').trim().toLowerCase();

  if (normalizedMode === 'none') {
    return [];
  }

  const requestedList = Array.isArray(requestedTools)
    ? requestedTools.map((tool) => String(tool || '').trim()).filter(Boolean)
    : [];

  const shouldUseSelected = normalizedMode === 'selected' || options?.toolsProvided === true;
  const requested = shouldUseSelected ? requestedList : [...OLLAMA_AGENT_DEFAULT_TOOLS];

  const seen = new Set<string>();
  return requested.filter((tool) => {
    if (seen.has(tool)) return false;
    seen.add(tool);
    return knownTools.has(tool) && !OLLAMA_AGENT_BLOCKED_TOOLS.has(tool);
  });
}

async function searchAllowedWorkflowTools(query: string, allowedTools: string[]) {
  const toolSchemas = await loadWorkflowToolSchemas();
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const queryTerms = normalizedQuery.split(/[\s,]+/).filter(Boolean);

  const ranked = allowedTools
    .map((toolName) => {
      const schema = toolSchemas.getToolSchema(toolName);
      if (!schema) return null;

      const label = String(schema.label || toolName).toLowerCase();
      const description = String(schema.description || '').toLowerCase();
      const category = String(schema.category || '').toLowerCase();
      const argNames = Object.keys(schema.args || {}).join(' ').toLowerCase();
      const haystack = `${toolName.toLowerCase()} ${label} ${description} ${category} ${argNames}`;

      let score = normalizedQuery ? 0 : 1;
      if (normalizedQuery) {
        if (toolName.toLowerCase() === normalizedQuery) score += 100;
        if (label === normalizedQuery) score += 90;

        for (const term of queryTerms) {
          if (toolName.toLowerCase().includes(term)) score += 24;
          if (label.includes(term)) score += 20;
          if (description.includes(term)) score += 10;
          if (argNames.includes(term)) score += 8;
          if (category.includes(term)) score += 6;
          if (haystack.includes(term)) score += 2;
        }
      }

      return score > 0 ? { toolName, schema, score } : null;
    })
    .filter(Boolean) as Array<{ toolName: string; schema: any; score: number }>;

  ranked.sort((a, b) => b.score - a.score || a.toolName.localeCompare(b.toolName));

  return ranked.slice(0, 8).map(({ toolName, schema, score }) => ({
    tool_name: toolName,
    label: schema.label || toolName,
    category: schema.category || 'other',
    description: schema.description || '',
    args: Object.fromEntries(
      Object.entries(schema.args || {}).slice(0, 8).map(([key, arg]) => [key, summarizeArgSchema(arg)]),
    ),
    outputs: Array.isArray(schema.outputs) ? schema.outputs.slice(0, 12) : [],
    score,
  }));
}

async function describeAllowedWorkflowTool(toolName: string, allowedTools: string[]) {
  const normalized = String(toolName || '').trim();
  if (!normalized) {
    return { ok: false, error: 'tool_name is required for describe' };
  }
  if (!allowedTools.includes(normalized)) {
    return {
      ok: false,
      error: `Tool "${normalized}" is not allowed in this Ollama agent run.`,
    };
  }

  const toolSchemas = await loadWorkflowToolSchemas();
  const schema = toolSchemas.getToolSchema(normalized);
  if (!schema) {
    return { ok: false, error: `Tool "${normalized}" is not available in the workflow schema catalog.` };
  }

  return {
    ok: true,
    tool: {
      tool_name: normalized,
      label: schema.label || normalized,
      category: schema.category || 'other',
      description: schema.description || '',
      args: Object.fromEntries(
        Object.entries(schema.args || {}).map(([key, arg]) => [key, summarizeArgSchema(arg)]),
      ),
      outputs: Array.isArray(schema.outputs) ? schema.outputs : [],
    },
  };
}

async function formatAllowedToolCatalog(allowedTools: string[]) {
  const toolSchemas = await loadWorkflowToolSchemas();
  return allowedTools
    .map((toolName) => {
      const schema = toolSchemas.getToolSchema(toolName);
      if (!schema) return null;
      const argNames = Object.keys(schema.args || {});
      const argPreview = argNames.length > 0 ? ` Args: ${argNames.slice(0, 6).join(', ')}.` : '';
      return `- ${toolName}: ${schema.description || schema.label || toolName}.${argPreview}`;
    })
    .filter(Boolean)
    .join('\n');
}

async function readOllamaImages(images: any, imagePath?: string): Promise<string[]> {
  let normalized = images;
  if (!normalized && imagePath) {
    normalized = [{ path: imagePath }];
  }
  if (!Array.isArray(normalized) || normalized.length === 0) {
    return [];
  }

  const fs = await import('fs');
  const base64Images: string[] = [];

  for (const image of normalized) {
    if (!image) continue;
    if (typeof image?.data === 'string' && image.data.trim()) {
      base64Images.push(String(image.data).replace(/^data:image\/[^;]+;base64,/, ''));
      continue;
    }
    if (typeof image?.path === 'string' && image.path.trim()) {
      const filePath = String(image.path).trim();
      const buffer = fs.readFileSync(filePath);
      base64Images.push(buffer.toString('base64'));
    }
  }

  return base64Images;
}

function getLastUserMessageText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === 'user' && typeof message?.content === 'string' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

async function buildOllamaAgentMemoryContext(args: any, ctx: RouterContext): Promise<string> {
  const memCfg = args?.memory?.enabled
    ? args.memory
    : args?.injectMemory
      ? {
          enabled: true,
          lenses: {
            identity: true,
            directives: true,
            bio: true,
            relatedMemories: true,
          },
          maxFacts: 6,
          customFacts: [],
        }
      : null;

  if (!memCfg?.enabled) return '';

  const sections: string[] = [];
  const lenses = memCfg.lenses || {};

  try {
    const knowledge = await execLocalTool('knowledge_build_context', {
      include_identity: lenses.identity !== false,
      include_directives: lenses.directives !== false,
      include_bio: lenses.bio !== false,
    }, ctx);

    const knowledgeText = String(knowledge?.context || '').trim();
    if (knowledge?.ok && knowledgeText) {
      sections.push(knowledgeText);
    }
  } catch {}

  if (lenses.relatedMemories !== false) {
    try {
      const promptText = [
        String(args?.prompt || '').trim(),
        String(args?.context || '').trim(),
        getLastUserMessageText(Array.isArray(args?.messages) ? args.messages : []),
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 240);

      if (promptText) {
        const related = await execLocalTool('memory_retrieval', {
          action: 'search',
          query: promptText,
          limit: Math.max(1, Math.min(Number(memCfg.maxFacts || 6), 10)),
        }, ctx);

        const results = Array.isArray(related?.results) ? related.results : [];
        if (results.length > 0) {
          const lines = results
            .slice(0, Math.max(1, Math.min(Number(memCfg.maxFacts || 6), 10)))
            .map((entry: any) => {
              const text = String(entry?.text || entry?.fact?.text || '').trim();
              return text ? `- ${truncateText(text, 220)}` : null;
            })
            .filter(Boolean);

          if (lines.length > 0) {
            sections.push(`[RELATED MEMORIES]\n${lines.join('\n')}`);
          }
        }
      }
    } catch {}
  }

  if (Array.isArray(memCfg.customFacts) && memCfg.customFacts.length > 0) {
    const customFacts = memCfg.customFacts
      .map((fact: any) => String(fact || '').trim())
      .filter(Boolean);
    if (customFacts.length > 0) {
      sections.push(`[CUSTOM FACTS]\n${customFacts.map((fact: string) => `- ${fact}`).join('\n')}`);
    }
  }

  return sections.join('\n\n').trim();
}

async function buildOllamaAgentMessages(args: any): Promise<any[]> {
  const output: any[] = [];
  const topLevelImages = await readOllamaImages(args?.images, args?.imagePath);

  if (Array.isArray(args?.messages) && args.messages.length > 0) {
    for (const rawMessage of args.messages) {
      const role = String(rawMessage?.role || '').trim();
      const content = String(rawMessage?.content || '');
      if (!role || !content.trim()) continue;
      output.push({ role, content });
    }
  }

  const prompt = String(args?.prompt || '').trim();
  const extraContext = String(args?.context || '').trim();

  if (prompt) {
    const content = extraContext ? `${prompt}\n\nContext:\n${extraContext}` : prompt;
    const nextMessage: any = { role: 'user', content };
    if (topLevelImages.length > 0) nextMessage.images = topLevelImages;
    output.push(nextMessage);
  } else if (topLevelImages.length > 0) {
    if (output.length > 0 && output[output.length - 1]?.role === 'user') {
      output[output.length - 1] = {
        ...output[output.length - 1],
        images: topLevelImages,
      };
    } else {
      output.push({
        role: 'user',
        content: extraContext || 'Use the attached image(s) as context.',
        images: topLevelImages,
      });
    }
  } else if (!output.length && extraContext) {
    output.push({ role: 'user', content: extraContext });
  }

  return output;
}

function buildOllamaAgentSystemPrompt(args: any, allowedTools: string[], toolCatalog: string, memoryContext: string): string {
  const customSystemPrompt = String(args?.systemPrompt || args?.system || '').trim();
  const outputMode = String(args?.outputMode || args?.mode || (args?.json_mode ? 'json' : 'text')).trim().toLowerCase();
  const outputSchema = args?.outputSchema;

  const sections = [
    'You are Stuard\'s local Ollama workflow agent.',
    'Work like an execution-focused AI agent: reason, use tools when helpful, observe results, then continue until you can answer.',
    allowedTools.length > 0
      ? [
          'You have exactly one callable function: `workflow_tool`.',
          'Use `workflow_tool` with action="search" to discover allowed tools.',
          'Use `workflow_tool` with action="describe" to inspect the exact arguments for one allowed tool.',
          'Use `workflow_tool` with action="run" to execute an allowed tool with arguments.',
          'Never invent tool names or parameters.',
          'Allowed tool catalog:',
          toolCatalog || '- No allowed tools matched the current selection.',
        ].join('\n')
      : 'No tools are available in this run. Solve the task only from the provided prompt, context, and memory.',
  ];

  if (customSystemPrompt) {
    sections.push(`Additional instructions:\n${customSystemPrompt}`);
  }

  if (memoryContext) {
    sections.push(`Memory context:\n${memoryContext}`);
  }

  if (outputMode === 'json') {
    const schemaText = outputSchema && typeof outputSchema === 'object'
      ? `\nTarget schema:\n${JSON.stringify(outputSchema)}`
      : '';
    sections.push(
      `Your final answer must be valid JSON only.${schemaText}\nDo not wrap the JSON in markdown fences or explanatory text.`,
    );
  } else {
    sections.push('When the task is complete, return the final answer directly and concisely.');
  }

  return sections.filter(Boolean).join('\n\n');
}

async function execOllamaWorkflowToolCall(metaArgs: any, allowedTools: string[], ctx: RouterContext): Promise<any> {
  const action = String(metaArgs?.action || '').trim().toLowerCase();

  if (action === 'search') {
    const query = String(metaArgs?.query || '').trim();
    const matches = await searchAllowedWorkflowTools(query, allowedTools);
    return {
      ok: true,
      action,
      query,
      count: matches.length,
      matches,
    };
  }

  if (action === 'describe') {
    return await describeAllowedWorkflowTool(String(metaArgs?.tool_name || ''), allowedTools);
  }

  if (action === 'run') {
    const toolName = String(metaArgs?.tool_name || '').trim();
    if (!toolName) {
      return { ok: false, error: 'tool_name is required for run' };
    }
    if (!allowedTools.includes(toolName)) {
      return { ok: false, error: `Tool "${toolName}" is not allowed in this Ollama agent run.` };
    }

    try {
      const { execTool } = await import('../index');
      const result = await execTool(toolName, metaArgs?.args || {}, ctx);
      return {
        ok: !!result?.ok,
        action,
        tool_name: toolName,
        result: compactForPrompt(result),
      };
    } catch (err: any) {
      return {
        ok: false,
        action,
        tool_name: toolName,
        error: err?.message || 'tool_execution_failed',
      };
    }
  }

  return { ok: false, error: 'action must be one of: search, describe, run' };
}

async function runOllamaAgentLoop(args: any, allowedTools: string[], ctx: RouterContext) {
  const messages = await buildOllamaAgentMessages(args);
  if (messages.length === 0) {
    return { ok: false, error: 'prompt or messages is required' };
  }

  const memoryContext = await buildOllamaAgentMemoryContext(args, ctx);
  const toolCatalog = await formatAllowedToolCatalog(allowedTools);
  const systemPrompt = buildOllamaAgentSystemPrompt(args, allowedTools, toolCatalog, memoryContext);
  const conversation: any[] = [{ role: 'system', content: systemPrompt }];

  const memCfg = args?.memory?.enabled ? args.memory : null;
  if (memCfg && Array.isArray(memCfg.conversationHistory)) {
    for (const historyItem of memCfg.conversationHistory) {
      const role = String(historyItem?.role || '').trim();
      const content = String(historyItem?.content || '').trim();
      if (!role || !content) continue;
      conversation.push({ role, content });
    }
  }

  conversation.push(...messages);

  const model = String(args?.model || 'llama3.2');
  const maxSteps = Math.max(1, Math.min(Number(args?.maxSteps || 8), 20));
  const timeoutMs = Math.max(5000, Math.min(Number(args?.timeoutMs || 300000), 600000));
  const deadline = Date.now() + timeoutMs;
  const temperature = args?.temperature;
  const num_predict = args?.num_predict;
  const top_p = args?.top_p;
  const top_k = args?.top_k;
  const keep_alive = args?.keep_alive;
  const think = args?.think;
  const canUseTools = allowedTools.length > 0;

  let toolCallCount = 0;
  const usedTools = new Set<string>();
  let finalText = '';
  let finalThinking = '';
  let lastMessage: any = null;

  for (let step = 0; step <= maxSteps; step++) {
    const remainingRawMs = deadline - Date.now();
    if (remainingRawMs <= 0) {
      return {
        ok: false,
        error: `Ollama agent timed out after ${timeoutMs}ms`,
        text: finalText || undefined,
        thinking: finalThinking || undefined,
        toolCalls: toolCallCount,
        usedTools: Array.from(usedTools),
      };
    }
    const remainingMs = Math.max(5000, remainingRawMs);

    const body: any = {
      model,
      messages: conversation,
      stream: false,
    };
    if (temperature !== undefined) body.options = { ...body.options, temperature };
    if (num_predict !== undefined) body.options = { ...body.options, num_predict };
    if (top_p !== undefined) body.options = { ...body.options, top_p };
    if (top_k !== undefined) body.options = { ...body.options, top_k };
    if (keep_alive !== undefined) body.keep_alive = keep_alive;
    if (think !== undefined) body.think = think;
    if (canUseTools) {
      body.tools = [{
        type: 'function',
        function: {
          name: 'workflow_tool',
          description: 'Search, inspect, or execute the workflow tools allowed in this Ollama agent run.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['search', 'describe', 'run'],
                description: 'search = find tools, describe = inspect one tool schema, run = execute one tool',
              },
              query: {
                type: 'string',
                description: 'Search phrase for action="search"',
              },
              tool_name: {
                type: 'string',
                description: 'Exact tool name for action="describe" or action="run"',
              },
              args: {
                type: 'object',
                description: 'Tool arguments for action="run"',
              },
            },
            required: ['action'],
          },
        },
      }];
    }

    const resp = await ollamaFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: remainingMs,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return {
        ok: false,
        error: `Ollama returned ${resp.status}: ${errText}`,
        text: finalText || undefined,
        thinking: finalThinking || undefined,
        toolCalls: toolCallCount,
        usedTools: Array.from(usedTools),
      };
    }

    const data = await resp.json();
    const message = data?.message || {};
    const assistantContent = String(message?.content || '');
    finalText = assistantContent || finalText;
    if (typeof message?.thinking === 'string' && message.thinking.trim()) {
      finalThinking = message.thinking.trim();
    }
    lastMessage = message;

    const toolCalls = normalizeOllamaToolCalls(message?.tool_calls);
    if (toolCalls.length === 0) {
      return {
        ok: true,
        model: data?.model || model,
        text: assistantContent,
        thinking: finalThinking || undefined,
        toolCalls: toolCallCount,
        usedTools: Array.from(usedTools),
        totalDuration: data?.total_duration,
        evalCount: data?.eval_count,
        evalDuration: data?.eval_duration,
      };
    }

    if (step >= maxSteps) {
      return {
        ok: false,
        model: data?.model || model,
        error: `Ollama agent exceeded maxSteps=${maxSteps}`,
        text: assistantContent || undefined,
        thinking: finalThinking || undefined,
        toolCalls: toolCallCount,
        usedTools: Array.from(usedTools),
      };
    }

    conversation.push({
      role: 'assistant',
      content: assistantContent,
      tool_calls: message?.tool_calls,
    });

    for (const toolCall of toolCalls) {
      toolCallCount += 1;
      ctx.logFn?.(`[ollama_agent] workflow_tool ${toolCall.name}`);

      const toolResult = await execOllamaWorkflowToolCall(toolCall.arguments, allowedTools, ctx);
      if (toolCall.arguments?.action === 'run' && toolCall.arguments?.tool_name) {
        usedTools.add(String(toolCall.arguments.tool_name));
        ctx.logFn?.(`[ollama_agent] -> ${String(toolCall.arguments.tool_name)}`);
      }

      conversation.push({
        role: 'tool',
        name: toolCall.name,
        tool_name: toolCall.name,
        content: JSON.stringify(compactForPrompt(toolResult)),
      });
    }
  }

  return {
    ok: false,
    error: 'Ollama agent stopped before producing a final answer',
    text: finalText || undefined,
    thinking: finalThinking || undefined,
    toolCalls: toolCallCount,
    usedTools: Array.from(usedTools),
    message: lastMessage || undefined,
  };
}

// ─── ollama_status ───────────────────────────────────────────────────────────

export async function execOllamaStatus(_args: any, ctx: RouterContext): Promise<any> {
  try {
    const isRunning = await isOllamaRunning();
    if (!isRunning) {
      const installed = await isOllamaInstalled();
      return {
        ok: true,
        available: false,
        installed,
        running: false,
        host: getOllamaHost(),
        error: installed
          ? 'Ollama is installed but not running. Click Start Ollama in Integrations.'
          : 'Ollama is not installed. Download from ollama.com.',
      };
    }

    const [tagsResp, psResp] = await Promise.all([
      ollamaFetch('/api/tags', { timeoutMs: 5000 }).catch(() => null),
      ollamaFetch('/api/ps', { timeoutMs: 5000 }).catch(() => null),
    ]);

    if (!tagsResp || !tagsResp.ok) {
      const installed = await isOllamaInstalled();
      return {
        ok: true,
        available: false,
        installed,
        running: false,
        host: getOllamaHost(),
        error: installed
          ? 'Ollama is installed but not running. Click Start Ollama in Integrations.'
          : 'Ollama is not installed. Download from ollama.com.',
      };
    }

    const tagsData = await tagsResp.json().catch(() => ({}));
    const models = (tagsData.models || []).map((m: any) => ({
      name: m.name,
      size: m.size,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      family: m.details?.family,
      modifiedAt: m.modified_at,
    }));

    let runningModels: any[] = [];
    if (psResp && psResp.ok) {
      const psData = await psResp.json().catch(() => ({}));
      runningModels = (psData.models || []).map((m: any) => ({
        name: m.name,
        size: m.size,
        vram: m.size_vram,
        expiresAt: m.expires_at,
      }));
    }

    return {
      ok: true,
      available: true,
      installed: true,
      running: true,
      host: getOllamaHost(),
      modelCount: models.length,
      models,
      runningCount: runningModels.length,
      runningModels,
    };
  } catch (err: any) {
    const installed = await isOllamaInstalled().catch(() => false);
    return {
      ok: true,
      available: false,
      installed,
      running: false,
      host: getOllamaHost(),
      error: installed
        ? 'Ollama is installed but not running. Click Start Ollama in Integrations.'
        : err.message || 'Failed to reach Ollama',
    };
  }
}

// ─── ollama_start ────────────────────────────────────────────────────────────

export async function execOllamaStart(_args: any, _ctx: RouterContext): Promise<any> {
  if (await isOllamaRunning()) {
    return { ok: true, installed: true, running: true, alreadyRunning: true };
  }

  const installed = await isOllamaInstalled();
  if (!installed) {
    return { ok: false, installed: false, running: false, error: 'Ollama is not installed.' };
  }

  try {
    if (!ollamaServeProcess || ollamaServeProcess.killed) {
      ollamaServeProcess = spawn('ollama', ['serve'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      ollamaServeProcess.on('exit', () => {
        ollamaServeProcess = null;
      });
    }

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isOllamaRunning()) {
        return { ok: true, installed: true, running: true, started: true };
      }
    }

    return {
      ok: false,
      installed: true,
      running: false,
      error: 'Ollama is installed but did not start. Open Ollama once and retry.',
    };
  } catch (err: any) {
    return {
      ok: false,
      installed: true,
      running: false,
      error: err?.message || 'Failed to start Ollama',
    };
  }
}

// ─── ollama_chat ─────────────────────────────────────────────────────────────

export async function execOllamaAgent(args: any, ctx: RouterContext): Promise<any> {
  const allowedTools = await resolveAllowedOllamaTools(args?.tools, args?.toolMode, {
    toolsProvided: !!args && Object.prototype.hasOwnProperty.call(args, 'tools'),
  });
  const model = String(args?.model || 'llama3.2');
  const stream = args?.stream === true;
  const outputMode = String(args?.outputMode || args?.mode || (args?.json_mode ? 'json' : 'text')).trim().toLowerCase();

  const runOnce = async () => {
    const result = await runOllamaAgentLoop(args, allowedTools, ctx);
    if (!result?.ok) return result;

    if (outputMode === 'json') {
      const rawText = String(result?.text || '').trim();
      let parsed: any = null;

      try {
        parsed = JSON.parse(rawText);
      } catch {
        const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced?.[1]) {
          try { parsed = JSON.parse(fenced[1].trim()); } catch {}
        }
        if (!parsed) {
          const objectStart = rawText.indexOf('{');
          const objectEnd = rawText.lastIndexOf('}');
          if (objectStart >= 0 && objectEnd > objectStart) {
            try { parsed = JSON.parse(rawText.slice(objectStart, objectEnd + 1)); } catch {}
          }
        }
        if (!parsed) {
          const arrayStart = rawText.indexOf('[');
          const arrayEnd = rawText.lastIndexOf(']');
          if (arrayStart >= 0 && arrayEnd > arrayStart) {
            try { parsed = JSON.parse(rawText.slice(arrayStart, arrayEnd + 1)); } catch {}
          }
        }
      }

      return {
        ...result,
        json: parsed,
      };
    }

    return result;
  };

  if (!stream) {
    try {
      return await runOnce();
    } catch (err: any) {
      return { ok: false, error: err?.message || 'ollama_agent_failed' };
    }
  }

  const streamResult = await execLocalTool('stream_create', {
    kind: 'text',
    sourceStepId: 'ollama_agent',
    metadata: { model, toolCount: allowedTools.length },
  }, ctx);

  if (!streamResult?.ok || !streamResult?.streamId) {
    return { ok: false, error: 'Failed to create stream for Ollama agent' };
  }

  const streamId = streamResult.streamId;
  ctx.logFn?.(`[ollama_agent] Created stream ${streamId}, running in background...`);

  (async () => {
    try {
      const result = await runOnce();
      const text = String(result?.text || '').trim();
      if (text) {
        await execLocalTool('stream_write', {
          streamId,
          chunk: text,
          chunkType: 'raw',
        }, ctx).catch(() => {});
      }
      if (result?.toolCalls) {
        await execLocalTool('stream_write', {
          streamId,
          chunk: JSON.stringify({
            type: 'summary',
            toolCalls: result.toolCalls,
            usedTools: result.usedTools || [],
            ok: !!result.ok,
          }),
          chunkType: 'tool_result',
        }, ctx).catch(() => {});
      }
    } catch (err: any) {
      ctx.logFn?.(`[ollama_agent] Stream error: ${err?.message || err}`);
      await execLocalTool('stream_write', {
        streamId,
        chunk: JSON.stringify({
          type: 'error',
          error: err?.message || 'ollama_agent_failed',
        }),
        chunkType: 'tool_result',
      }, ctx).catch(() => {});
    } finally {
      await execLocalTool('stream_close', { streamId }, ctx).catch(() => {});
    }
  })();

  return {
    ok: true,
    model,
    streamId,
    streamed: true,
  };
}

export async function execOllamaChat(args: any, ctx: RouterContext): Promise<any> {
  const model = String(args?.model || 'llama3.2');
  const messages = args?.messages;
  const temperature = args?.temperature;
  const num_predict = args?.num_predict;
  const top_p = args?.top_p;
  const top_k = args?.top_k;
  // Support both 'format' and 'json_mode' (json_mode: true => format: 'json')
  const format = args?.json_mode === true ? 'json' : args?.format;
  const keep_alive = args?.keep_alive;
  const system = args?.system;
  const stream = args?.stream === true;
  // Thinking mode for reasoning models (deepseek-r1, etc.)
  const think = args?.think;
  // Tool/function calling (optional)
  const tools = args?.tools;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'messages is required (array of {role, content})' };
  }

  const body: any = { model, messages, stream: false };
  if (temperature !== undefined) body.options = { ...body.options, temperature };
  if (num_predict !== undefined) body.options = { ...body.options, num_predict };
  if (top_p !== undefined) body.options = { ...body.options, top_p };
  if (top_k !== undefined) body.options = { ...body.options, top_k };
  if (format) body.format = format;
  if (keep_alive !== undefined) body.keep_alive = keep_alive;
  if (system) body.messages = [{ role: 'system', content: system }, ...messages];
  // Enable thinking mode for reasoning models
  if (think !== undefined) body.think = think;
  // Pass tools for function calling
  if (tools && Array.isArray(tools) && tools.length > 0) body.tools = tools;

  // Streaming mode: create a stream, return immediately, push tokens in background
  if (stream) {
    body.stream = true;
    
    // Create stream via Python agent
    const streamResult = await execLocalTool('stream_create', {
      kind: 'text',
      sourceStepId: 'ollama_chat',
      metadata: { model, messageCount: messages.length },
    }, ctx);
    
    if (!streamResult?.ok || !streamResult?.streamId) {
      return { ok: false, error: 'Failed to create stream for Ollama chat' };
    }
    
    const streamId = streamResult.streamId;
    ctx.logFn?.(`[ollama_chat] Created stream ${streamId}, starting background streaming...`);
    
    // Fire and forget — stream tokens in background
    (async () => {
      try {
        const result = await streamOllamaTextToWorkflowStream(
          '/api/chat',
          body,
          streamId,
          ctx,
          (chunk) => chunk?.message?.content || '',
        );

        ctx.logFn?.(
          `[ollama_chat] Stream completed: ${result.fullText.length} chars (${result.tokenCount} tokens, ${result.writeCount} writes)`,
        );
      } catch (err: any) {
        ctx.logFn?.(`[ollama_chat] Stream error: ${err.message}`);
      } finally {
        // Close the stream
        await execLocalTool('stream_close', { streamId }, ctx).catch(() => {});
      }
    })();
    
    // Return immediately with streamId — workflow engine will consume via stream wire
    return { ok: true, streamId, model, streamed: true };
  }

  // Non-streaming mode
  try {
    const resp = await ollamaFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 600000,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Ollama returned ${resp.status}: ${errText}` };
    }
    const data = await resp.json();
    const result: any = {
      ok: true,
      model: data.model || model,
      message: data.message,
      text: data.message?.content || '',
      totalDuration: data.total_duration,
      evalCount: data.eval_count,
      evalDuration: data.eval_duration,
    };
    // Include thinking output if present (for reasoning models)
    if (data.message?.thinking) {
      result.thinking = data.message.thinking;
    }
    // Include tool calls if present (for function calling)
    if (data.message?.tool_calls) {
      result.toolCalls = data.message.tool_calls;
    }
    return result;
  } catch (err: any) {
    return { ok: false, error: err.message || 'Chat request failed' };
  }
}

// ─── ollama_generate ─────────────────────────────────────────────────────────

export async function execOllamaGenerate(args: any, ctx: RouterContext): Promise<any> {
  const model = String(args?.model || 'llama3.2');
  const prompt = String(args?.prompt || '');
  const system = args?.system;
  const temperature = args?.temperature;
  const num_predict = args?.num_predict;
  // Support both 'format' and 'json_mode' (json_mode: true => format: 'json')
  const format = args?.json_mode === true ? 'json' : args?.format;
  const keep_alive = args?.keep_alive;
  const stream = args?.stream === true;
  // Thinking mode for reasoning models (deepseek-r1, etc.)
  const think = args?.think;

  if (!prompt) {
    return { ok: false, error: 'prompt is required' };
  }

  const body: any = { model, prompt, stream: false };
  if (system) body.system = system;
  if (temperature !== undefined) body.options = { ...body.options, temperature };
  if (num_predict !== undefined) body.options = { ...body.options, num_predict };
  if (format) body.format = format;
  if (keep_alive !== undefined) body.keep_alive = keep_alive;
  // Enable thinking mode for reasoning models
  if (think !== undefined) body.think = think;

  // Streaming mode: create a stream, return immediately, push tokens in background
  if (stream) {
    body.stream = true;
    
    // Create stream via Python agent
    const streamResult = await execLocalTool('stream_create', {
      kind: 'text',
      sourceStepId: 'ollama_generate',
      metadata: { model, promptLength: prompt.length },
    }, ctx);
    
    if (!streamResult?.ok || !streamResult?.streamId) {
      return { ok: false, error: 'Failed to create stream for Ollama generate' };
    }
    
    const streamId = streamResult.streamId;
    ctx.logFn?.(`[ollama_generate] Created stream ${streamId}, starting background streaming...`);
    
    // Fire and forget — stream tokens in background
    (async () => {
      try {
        const result = await streamOllamaTextToWorkflowStream(
          '/api/generate',
          body,
          streamId,
          ctx,
          (chunk) => chunk?.response || '',
        );

        ctx.logFn?.(
          `[ollama_generate] Stream completed: ${result.fullText.length} chars (${result.tokenCount} tokens, ${result.writeCount} writes)`,
        );
      } catch (err: any) {
        ctx.logFn?.(`[ollama_generate] Stream error: ${err.message}`);
      } finally {
        // Close the stream
        await execLocalTool('stream_close', { streamId }, ctx).catch(() => {});
      }
    })();
    
    // Return immediately with streamId — workflow engine will consume via stream wire
    return { ok: true, streamId, model, streamed: true };
  }

  // Non-streaming mode
  try {
    const resp = await ollamaFetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 600000,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Ollama returned ${resp.status}: ${errText}` };
    }
    const data = await resp.json();
    return {
      ok: true,
      model: data.model || model,
      text: data.response || '',
      streamed: false,
      totalDuration: data.total_duration,
      evalCount: data.eval_count,
      evalDuration: data.eval_duration,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Generate request failed' };
  }
}

// ─── ollama_vision ───────────────────────────────────────────────────────────

export async function execOllamaVision(args: any, ctx: RouterContext): Promise<any> {
  const model = String(args?.model || 'llava');
  const prompt = String(args?.prompt || 'Describe this image.');
  const temperature = args?.temperature;
  const num_predict = args?.num_predict;

  // Support both 'imagePath' (single string) and 'images' (array)
  let images = args?.images;
  if (!images && args?.imagePath) {
    images = [{ path: args.imagePath }];
  }

  if (!images || !Array.isArray(images) || images.length === 0) {
    return { ok: false, error: 'imagePath or images is required' };
  }

  // Read local files and convert to base64
  const base64Images: string[] = [];
  const fs = await import('fs');
  const path = await import('path');

  for (const img of images) {
    if (img.data) {
      // Already base64
      const cleaned = String(img.data).replace(/^data:image\/[^;]+;base64,/, '');
      base64Images.push(cleaned);
    } else if (img.path) {
      try {
        const filePath = String(img.path);
        const buf = fs.readFileSync(filePath);
        base64Images.push(buf.toString('base64'));
      } catch (err: any) {
        return { ok: false, error: `Failed to read image "${img.path}": ${err.message}` };
      }
    }
  }

  if (base64Images.length === 0) {
    return { ok: false, error: 'No valid images provided' };
  }

  const body: any = {
    model,
    messages: [{ role: 'user', content: prompt, images: base64Images }],
    stream: false,
  };
  if (temperature !== undefined) body.options = { ...body.options, temperature };
  if (num_predict !== undefined) body.options = { ...body.options, num_predict };

  try {
    const resp = await ollamaFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 600000,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Ollama returned ${resp.status}: ${errText}` };
    }
    const data = await resp.json();
    return {
      ok: true,
      model: data.model || model,
      text: data.message?.content || '',
      totalDuration: data.total_duration,
      imageCount: base64Images.length,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Vision request failed' };
  }
}

// ─── ollama_embeddings ───────────────────────────────────────────────────────

export async function execOllamaEmbeddings(args: any, ctx: RouterContext): Promise<any> {
  const model = String(args?.model || 'nomic-embed-text');
  const input = args?.input;

  if (!input) {
    return { ok: false, error: 'input is required (string or array of strings)' };
  }

  const inputArray = Array.isArray(input) ? input : [input];

  try {
    const resp = await ollamaFetch('/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: inputArray }),
      timeoutMs: 120000,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `Ollama returned ${resp.status}: ${errText}` };
    }
    const data = await resp.json();
    const embeddings = data.embeddings || [];
    return {
      ok: true,
      model: data.model || model,
      embeddings,
      dimensions: embeddings[0]?.length || 0,
      count: embeddings.length,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Embeddings request failed' };
  }
}

// ─── ollama_models ───────────────────────────────────────────────────────────

export async function execOllamaModels(args: any, ctx: RouterContext): Promise<any> {
  const action = String(args?.action || 'list');
  const model = args?.model ? String(args.model) : '';
  const destination = args?.destination ? String(args.destination) : '';

  try {
    switch (action) {
      case 'list': {
        const resp = await ollamaFetch('/api/tags', { timeoutMs: 10000 });
        if (!resp.ok) return { ok: false, error: `Failed: ${resp.status}` };
        const data = await resp.json();
        const models = (data.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
          parameterSize: m.details?.parameter_size,
          quantization: m.details?.quantization_level,
          family: m.details?.family,
          format: m.details?.format,
          modifiedAt: m.modified_at,
        }));
        return { ok: true, action: 'list', models, count: models.length };
      }

      case 'pull': {
        if (!model) return { ok: false, error: 'model is required for pull action' };
        ctx.logFn?.(`Pulling model "${model}"...`);

        const resp = await ollamaFetch('/api/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model, stream: true }),
          timeoutMs: 3600000, // 1 hour for large models
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return { ok: false, error: `Pull failed: ${resp.status} ${errText}` };
        }

        // Stream progress
        const reader = resp.body?.getReader();
        if (!reader) return { ok: false, error: 'No response body' };

        const decoder = new TextDecoder();
        let buffer = '';
        let lastStatus = '';
        let lastPercent = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);
              lastStatus = chunk.status || lastStatus;
              if (chunk.total && chunk.completed) {
                const pct = Math.round((chunk.completed / chunk.total) * 100);
                if (pct !== lastPercent) {
                  lastPercent = pct;
                  ctx.logFn?.(`[ollama_models] pulling ${model}: ${pct}% - ${lastStatus}`);
                }
              }
            } catch {}
          }
        }

        ctx.logFn?.(`[ollama_models] pull complete: ${model}`);
        return { ok: true, action: 'pull', model, status: 'complete' };
      }

      case 'delete': {
        if (!model) return { ok: false, error: 'model is required for delete action' };
        const resp = await ollamaFetch('/api/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model }),
          timeoutMs: 30000,
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return { ok: false, error: `Delete failed: ${resp.status} ${errText}` };
        }
        return { ok: true, action: 'delete', model, deleted: true };
      }

      case 'show': {
        if (!model) return { ok: false, error: 'model is required for show action' };
        const resp = await ollamaFetch('/api/show', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model }),
          timeoutMs: 10000,
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return { ok: false, error: `Show failed: ${resp.status} ${errText}` };
        }
        const data = await resp.json();
        return {
          ok: true,
          action: 'show',
          model,
          modelfile: data.modelfile,
          parameters: data.parameters,
          template: data.template,
          details: data.details,
          modelInfo: data.model_info,
        };
      }

      case 'running': {
        const resp = await ollamaFetch('/api/ps', { timeoutMs: 10000 });
        if (!resp.ok) return { ok: false, error: `Failed: ${resp.status}` };
        const data = await resp.json();
        const models = (data.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
          vram: m.size_vram,
          processor: m.digest ? 'gpu' : 'cpu',
          expiresAt: m.expires_at,
        }));
        return { ok: true, action: 'running', models, count: models.length };
      }

      case 'copy': {
        if (!model) return { ok: false, error: 'model is required for copy action' };
        if (!destination) return { ok: false, error: 'destination is required for copy action' };
        const resp = await ollamaFetch('/api/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: model, destination }),
          timeoutMs: 60000,
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return { ok: false, error: `Copy failed: ${resp.status} ${errText}` };
        }
        return { ok: true, action: 'copy', source: model, destination };
      }

      default:
        return { ok: false, error: `Unknown action: ${action}. Valid: list, pull, delete, show, running, copy` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message || `Model ${action} failed` };
  }
}
