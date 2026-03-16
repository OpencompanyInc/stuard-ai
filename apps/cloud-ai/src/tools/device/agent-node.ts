/**
 * agent_node — Synchronous AI Agent workflow node
 *
 * Unlike deploy_headless_agent (fire-and-forget background task),
 * this tool runs an AI agent inline within a workflow step, waits for
 * completion, and returns the result directly to the next node.
 *
 * Perfect for:
 *  - "Think" steps: analyze data, make decisions, generate text
 *  - Multi-step reasoning within a workflow
 *  - Data extraction / transformation with AI
 *  - Conditional branching based on AI judgment
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getHeadlessAgent } from '../../agents/headless-agent';
import { getExternalAccount } from '../../supabase';
import { getBridgeSecrets, getBridgeWs, hasClientBridge, withClientBridge, safeToolWrite, execLocalTool } from '../bridge';
import { writeLog } from '../../utils/logger';
import { getDefaultModelForCategory } from '../../pricing';
import { buildKnowledgeContext, buildQuickContext } from '../../knowledge/retrieval';

const AGENT_NODE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min default

/**
 * agent_node — Run an AI agent synchronously as a workflow step.
 * The agent can use tools, reason, and return a structured result.
 */
export const agent_node = createTool({
  id: 'agent_node',
  description: `Run an AI agent as a workflow step. The agent receives a prompt (with optional context from previous steps), reasons about it, optionally uses tools, and returns a text or JSON result. Use this for AI-powered decision making, text generation, data extraction, summarization, or any task that needs reasoning within a workflow.

Examples:
- Summarize data from a previous step
- Decide which branch to take based on input
- Generate an email draft from context
- Extract structured data from unstructured text
- Analyze a screenshot and return findings`,
  inputSchema: z.object({
    prompt: z.string().describe('The instruction/task for the agent. Be specific. You can reference previous step outputs using {{step_id.field}} template syntax.'),
    context: z.string().optional().describe('Additional context to provide to the agent (e.g. data from previous steps, file contents, etc.)'),
    systemPrompt: z.string().optional().describe('Custom system prompt to shape agent behavior/persona. If omitted, uses a default task-focused prompt.'),
    model: z.enum(['fast', 'balanced', 'smart']).default('balanced').describe('Model tier: fast = quick & cheap, balanced = good quality, smart = best reasoning'),
    outputMode: z.enum(['text', 'json']).default('text').describe('Output format: "text" for free-form text, "json" for structured JSON output'),
    outputSchema: z.record(z.string(), z.any()).optional().describe('For json outputMode: define expected output shape. Keys = field names, values = types ("string", "number", "boolean", "string[]"). Example: {"category": "string", "confidence": "number", "tags": "string[]"}'),
    tools: z.array(z.string()).optional().describe('Restrict which tools the agent can use. If omitted, agent gets core tools. Use [] for no tools (pure reasoning).'),
    maxSteps: z.coerce.number().int().min(1).max(50).default(10).describe('Maximum tool-use steps before forcing a final answer'),
    timeoutMs: z.coerce.number().int().min(5000).max(600000).default(300000).describe('Timeout in milliseconds (default 5 min)'),
    injectMemory: z.boolean().optional().default(false).describe('Legacy: when true, injects all memory. Use `memory` for granular control.'),
    memory: z.object({
      enabled: z.boolean().optional().default(false),
      lenses: z.object({
        identity: z.boolean().optional().default(true),
        directives: z.boolean().optional().default(true),
        bio: z.boolean().optional().default(true),
        relatedMemories: z.boolean().optional().default(true),
        entities: z.boolean().optional().default(true),
      }).optional(),
      maxFacts: z.number().optional().default(6),
      conversationHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).optional(),
      customFacts: z.array(z.string()).optional(),
    }).optional().describe('Rich memory config: per-lens toggles, conversation history, custom facts.'),
    stream: z.boolean().optional().default(false).describe('When true, returns a streamId immediately and pushes tokens as text chunks to the stream. Connect a stream wire from this step to process tokens in real-time.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    text: z.string().optional().describe('Agent text response (text mode)'),
    json: z.any().optional().describe('Agent structured response (json mode)'),
    model: z.string().optional().describe('Model used'),
    toolCalls: z.number().optional().describe('Number of tool calls made'),
    durationMs: z.number().optional().describe('Execution time in ms'),
    streamId: z.string().optional().describe('Stream ID when stream=true. Use stream wires to consume tokens.'),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, context: any) => {
    const startTime = Date.now();
    const writer = (context as any)?.writer;
    // Normalize: HTTP route wraps body as { context: body }, Mastra passes directly
    const raw = (inputData as any)?.context && typeof (inputData as any).context === 'object' && (inputData as any).context.prompt
      ? (inputData as any).context
      : inputData;
    const {
      prompt,
      context: userContext,
      systemPrompt,
      model = 'balanced',
      outputMode = 'text',
      outputSchema,
      tools: toolsAllowed,
      maxSteps = 10,
      timeoutMs = AGENT_NODE_TIMEOUT_MS,
      stream: streamMode = false,
      injectMemory = false,
      memory: memoryConfig,
    } = raw as any;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return { ok: false, error: 'prompt is required' };
    }

    const secrets = getBridgeSecrets();
    const bridgeWs = getBridgeWs();
    const userId = secrets?.userId;

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'agent_node',
      status: 'started',
      model,
      outputMode,
    });

    let aggregatedText = '';

    try {
      // Prepare integrations
      const enabledIntegrations: string[] = [];
      if (userId) {
        const providers = ['github', 'google', 'outlook', 'facebook', 'instagram', 'threads', 'whatsapp'];
        const checks = await Promise.all(providers.map(p => getExternalAccount(userId, p)));
        providers.forEach((p, i) => { if (checks[i]) enabledIntegrations.push(p); });
      }

      // Load MCP tools if available
      let mcpTools: Record<string, any> = {};
      try {
        const { getConnectedMCPIntegrations, getMCPToolsForIntegrations } = await import('../../mcp');
        if (userId) {
          const connected = await getConnectedMCPIntegrations(userId);
          if (connected.length > 0) {
            mcpTools = await getMCPToolsForIntegrations(userId, connected);
          }
        }
      } catch {}

      // Determine tools — empty array means pure reasoning (no tools)
      const resolvedTools = Array.isArray(toolsAllowed) && toolsAllowed.length === 0
        ? [] // Explicitly no tools
        : toolsAllowed;

      // Build custom system prompt for structured output
      let agentSystemPrompt = systemPrompt || '';
      if (outputMode === 'json' && outputSchema) {
        const schemaDesc = JSON.stringify(outputSchema);
        agentSystemPrompt += `\n\nIMPORTANT: Your final response MUST be a valid JSON object matching this schema: ${schemaDesc}\nOutput ONLY the JSON object, no markdown fences, no explanation before or after.`;
      }

      // Create the agent
      const agent = getHeadlessAgent(
        model as any,
        enabledIntegrations,
        mcpTools,
        resolvedTools,
        agentSystemPrompt || undefined,
      );

      // Build the user message
      let userMessage = prompt.trim();
      if (userContext && typeof userContext === 'string' && userContext.trim()) {
        userMessage += `\n\n---\nContext:\n${userContext.trim()}`;
      }

      // ── MEMORY INJECTION: fetch user identity, directives, bio, relevant facts ──
      // Resolve memory config: new `memory` object takes precedence over legacy `injectMemory` boolean
      const memCfg = memoryConfig?.enabled
        ? memoryConfig
        : injectMemory
          ? { enabled: true, lenses: { identity: true, directives: true, bio: true, relatedMemories: true, entities: true }, maxFacts: 6, conversationHistory: [] as any[], customFacts: [] as string[] }
          : null;

      let memoryContext = '';
      if (memCfg?.enabled) {
        try {
          const lenses = memCfg.lenses ?? {};
          const hasBridge = hasClientBridge();
          writeLog('agent_node_memory_start', {
            hasBridge,
            userId,
            prompt: prompt.slice(0, 50),
            lenses,
          });
          await safeToolWrite(writer, {
            type: 'tool_event',
            tool: 'agent_node',
            status: 'loading_memory',
          });

          if (!hasBridge) {
            writeLog('agent_node_memory_no_bridge', { fallback: 'buildQuickContext' });
            try {
              const quickCtx = await buildQuickContext();
              if (quickCtx.trim()) {
                memoryContext = quickCtx.trim();
                writeLog('agent_node_memory_quick_fallback', { length: memoryContext.length });
              }
            } catch {}
          } else {
            const knowledgeCtx = await buildKnowledgeContext(prompt, {
              includeIdentity: lenses.identity !== false,
              includeDirectives: lenses.directives !== false,
              includeBio: lenses.bio !== false,
              maxGlobalFacts: lenses.relatedMemories !== false ? (memCfg.maxFacts ?? 6) : 0,
              detectEntities: lenses.entities !== false,
            });
            if (knowledgeCtx && knowledgeCtx.text.trim()) {
              memoryContext = knowledgeCtx.text.trim();
              writeLog('agent_node_memory_injected', {
                length: memoryContext.length,
                hasIdentity: knowledgeCtx.lenses.identity.length > 0,
                hasDirectives: knowledgeCtx.lenses.directives.length > 0,
                hasBio: knowledgeCtx.lenses.bio.length > 0,
                globalFacts: knowledgeCtx.lenses.globalSearch.length,
                entities: knowledgeCtx.detectedEntities,
              });
            } else {
              writeLog('agent_node_memory_empty', { hasCtx: !!knowledgeCtx });
            }
          }

          // Append custom facts
          if (Array.isArray(memCfg.customFacts) && memCfg.customFacts.length > 0) {
            const validFacts = memCfg.customFacts.filter((f: string) => typeof f === 'string' && f.trim());
            if (validFacts.length > 0) {
              memoryContext += '\n\n[CUSTOM FACTS]\n' + validFacts.map((f: string) => `- ${f.trim()}`).join('\n');
            }
          }
        } catch (memErr: any) {
          writeLog('agent_node_memory_error', { error: memErr?.message, stack: memErr?.stack?.slice(0, 300) });
          // Non-fatal: continue without memory
        }
      }

      // Enable thinking for Gemini 3 models
      const providerOptions: any = {};
      const concreteModelId = getDefaultModelForCategory(model as any);
      if (concreteModelId?.includes('google/gemini-3')) {
        providerOptions.google = {
          thinkingConfig: { includeThoughts: true },
        };
      }

      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'agent_node',
        status: 'running',
        model: concreteModelId,
      });

      // Build messages array with optional memory context
      const agentMessages: any[] = [];
      if (memoryContext) {
        agentMessages.push({ role: 'system', content: memoryContext });
      }

      // Inject conversation history as context messages
      if (memCfg && Array.isArray(memCfg.conversationHistory) && memCfg.conversationHistory.length > 0) {
        for (const msg of memCfg.conversationHistory) {
          if (msg.role && msg.content?.trim()) {
            agentMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content.trim() });
          }
        }
      }

      agentMessages.push({ role: 'user', content: userMessage });

      // ── STREAM MODE: create stream, run agent in background, return immediately ──
      if (streamMode) {
        const streamResult = await execLocalTool('stream_create', {
          kind: 'text',
          sourceStepId: 'agent_node',
          metadata: { model: concreteModelId, prompt: prompt.slice(0, 100) },
        });

        if (!streamResult?.ok || !streamResult?.streamId) {
          return { ok: false, error: 'Failed to create stream for agent output' };
        }

        const streamId = streamResult.streamId;

        // Fire and forget — run agent in background, push tokens to stream
        // Uses batching to reduce round-trips: accumulates tokens and flushes
        // periodically instead of writing each 1-3 char token individually.
        const runStreamedAgent = async () => {
          try {
            const abortCtrl = new AbortController();
            const tHandle = setTimeout(() => abortCtrl.abort(), timeoutMs);

            // Token batching: flush every 50ms or when buffer exceeds threshold
            let tokenBuffer = '';
            let flushTimer: ReturnType<typeof setTimeout> | null = null;
            let streamToolCallCount = 0;
            const FLUSH_INTERVAL_MS = 50;
            const FLUSH_SIZE_THRESHOLD = 80;

            const flushBuffer = async () => {
              if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
              const text = tokenBuffer;
              tokenBuffer = '';
              if (text) {
                await execLocalTool('stream_write', { streamId, chunk: text, chunkType: 'raw' }).catch(() => {});
              }
            };

            const scheduleFlush = () => {
              if (flushTimer) return; // already scheduled
              flushTimer = setTimeout(() => {
                flushTimer = null;
                flushBuffer().catch(() => {});
              }, FLUSH_INTERVAL_MS);
            };

            try {
              const agentStream: any = await agent.stream(
                agentMessages,
                { maxSteps, providerOptions, abortSignal: abortCtrl.signal },
              );
              const fullStream = (agentStream as any)?.fullStream || agentStream;

              for await (const chunk of fullStream as any) {
                const evType = (chunk as any)?.type;
                if (evType === 'text-delta') {
                  const t = (chunk as any)?.payload?.text || (chunk as any)?.text || '';
                  if (typeof t === 'string' && t) {
                    tokenBuffer += t;
                    if (tokenBuffer.length >= FLUSH_SIZE_THRESHOLD) {
                      await flushBuffer();
                    } else {
                      scheduleFlush();
                    }
                  }
                } else if (evType === 'tool-call') {
                  // Emit tool call events during streaming so the UI can show them
                  streamToolCallCount++;
                  const payload = (chunk as any).payload;
                  await flushBuffer(); // flush buffered text before tool call
                  await execLocalTool('stream_write', {
                    streamId,
                    chunk: JSON.stringify({
                      type: 'tool_call',
                      toolName: payload?.toolName,
                      args: payload?.args,
                      step: streamToolCallCount,
                    }),
                    chunkType: 'tool_call',
                  }).catch(() => {});
                } else if (evType === 'tool-result') {
                  // Emit tool result events during streaming
                  const payload = (chunk as any).payload;
                  await execLocalTool('stream_write', {
                    streamId,
                    chunk: JSON.stringify({
                      type: 'tool_result',
                      toolName: payload?.toolName,
                      result: payload?.result,
                      step: streamToolCallCount,
                    }),
                    chunkType: 'tool_result',
                  }).catch(() => {});
                }
              }
              // Final flush of any remaining tokens
              await flushBuffer();
            } finally {
              if (flushTimer) clearTimeout(flushTimer);
              clearTimeout(tHandle);
            }
          } catch (err: any) {
            writeLog('agent_node_stream_error', { streamId, error: err?.message });
          } finally {
            await execLocalTool('stream_close', { streamId }).catch(() => {});
          }
        };

        // Preserve bridge context for background execution
        if (bridgeWs && (bridgeWs as any)?.readyState === 1) {
          (withClientBridge as any)(bridgeWs, runStreamedAgent, secrets).catch(() => {});
        } else {
          runStreamedAgent().catch(() => {});
        }

        return {
          ok: true,
          streamId,
          model: concreteModelId,
          text: undefined,
        };
      }

      // ── SYNCHRONOUS MODE (default) ──
      // Create an abort controller for timeout
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

      let toolCallCount = 0;

      try {
        // Run the agent — wrapping in bridge context if available
        const runAgent = async () => {
          const stream: any = await agent.stream(
            agentMessages,
            {
              maxSteps,
              providerOptions,
              abortSignal: abortController.signal,
            },
          );

          const fullStream = (stream as any)?.fullStream || stream;

          for await (const chunk of fullStream as any) {
            const evType = (chunk as any)?.type;

            if (evType === 'tool-call') {
              toolCallCount++;
              const payload = (chunk as any).payload;
              await safeToolWrite(writer, {
                type: 'tool_event',
                tool: 'agent_node',
                status: 'tool_call',
                toolName: payload?.toolName,
                step: toolCallCount,
              });
            } else if (evType === 'text-delta') {
              const t = (chunk as any)?.payload?.text || (chunk as any)?.text || '';
              if (typeof t === 'string' && t) aggregatedText += t;
            }
          }
        };

        // Preserve bridge context for tool execution
        if (bridgeWs && (bridgeWs as any).readyState === 1 /* OPEN */) {
          await withClientBridge(bridgeWs as any, runAgent, secrets);
        } else {
          await runAgent();
        }
      } finally {
        clearTimeout(timeoutHandle);
      }

      const finalText = aggregatedText.trim();
      const durationMs = Date.now() - startTime;

      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'agent_node',
        status: 'completed',
        durationMs,
        toolCalls: toolCallCount,
      });

      // Parse JSON if json mode
      if (outputMode === 'json') {
        let jsonResult: any = null;
        try {
          // Try direct parse
          const text = finalText;
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;
          jsonResult = JSON.parse(jsonStr);
        } catch {
          // Try extracting JSON object
          const start = finalText.indexOf('{');
          const end = finalText.lastIndexOf('}');
          if (start >= 0 && end > start) {
            try {
              jsonResult = JSON.parse(finalText.slice(start, end + 1));
            } catch {}
          }
          // Try extracting JSON array
          if (!jsonResult) {
            const aStart = finalText.indexOf('[');
            const aEnd = finalText.lastIndexOf(']');
            if (aStart >= 0 && aEnd > aStart) {
              try {
                jsonResult = JSON.parse(finalText.slice(aStart, aEnd + 1));
              } catch {}
            }
          }
        }

        return {
          ok: true,
          text: finalText,
          json: jsonResult,
          model: concreteModelId,
          toolCalls: toolCallCount,
          durationMs,
        };
      }

      return {
        ok: true,
        text: finalText,
        model: concreteModelId,
        toolCalls: toolCallCount,
        durationMs,
      };

    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isAbort = err?.name === 'AbortError';

      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'agent_node',
        status: 'error',
        error: isAbort ? 'timeout' : (err?.message || 'agent_failed'),
      });

      writeLog('agent_node_error', { error: err?.message, durationMs });

      return {
        ok: false,
        error: isAbort ? `Agent timed out after ${timeoutMs}ms` : (err?.message || 'agent_failed'),
        text: aggregatedText?.trim() || undefined,
        durationMs,
      };
    }
  },
} as any);

/**
 * agent_decision — Lightweight agent that makes a yes/no or categorical decision.
 * Returns a structured { decision, reason } object. Great for conditional branching.
 */
export const agent_decision = createTool({
  id: 'agent_decision',
  description: `Ask the AI to make a decision based on input data. Returns a structured decision with reasoning. Perfect for conditional workflow branching — use the decision output in a wire guard to route to different paths.

Examples:
- "Is this email spam?" → { decision: "spam", reason: "Contains suspicious links" }
- "Should we retry?" → { decision: "yes", reason: "Error was transient" }
- "Classify this support ticket" → { decision: "billing", reason: "Customer mentions invoice" }`,
  inputSchema: z.object({
    question: z.string().describe('The decision question. Be specific about what you want decided.'),
    context: z.string().optional().describe('Data/context to base the decision on (e.g. email body, error message, previous step output)'),
    options: z.array(z.string()).optional().describe('Optional list of valid decision values. If provided, the agent must pick one. Example: ["approve", "reject", "escalate"]'),
    model: z.enum(['fast', 'balanced', 'smart']).default('fast').describe('Model tier (fast is usually sufficient for decisions)'),
    injectMemory: z.boolean().optional().default(false).describe('When true, injects the user\'s identity and instructions into the decision context — so the AI knows who the user is and follows their custom directives.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    decision: z.string().describe('The decision value'),
    reason: z.string().optional().describe('Brief reasoning behind the decision'),
    confidence: z.number().optional().describe('Confidence score 0-1'),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, ctx: any) => {
    // Normalize: HTTP route wraps body as { context: body }
    const raw = (inputData as any)?.context && typeof (inputData as any).context === 'object' && (inputData as any).context.question
      ? (inputData as any).context
      : inputData;
    const { question, context: userContext, options, model = 'fast', injectMemory = false } = raw as any;
    const writer = (ctx as any)?.writer;

    if (!question) return { ok: false, decision: '', error: 'question is required' };

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'agent_decision',
      status: 'thinking',
    });

    try {
      const { generateText } = await import('ai');
      const { buildProviderModel } = await import('../../utils/models');

      const concreteModelId = getDefaultModelForCategory(model as any);
      const aiModel = buildProviderModel(concreteModelId);

      const optionsClause = options && options.length > 0
        ? `\nYou MUST pick one of these options: ${JSON.stringify(options)}`
        : '';

      const systemPrompt = `You are a decision-making assistant. Given a question and context, make a clear decision.${optionsClause}

Respond with ONLY a valid JSON object in this exact format:
{"decision": "<your choice>", "reason": "<brief 1-2 sentence explanation>", "confidence": <0.0-1.0>}`;

      let userMessage = question;
      if (userContext) {
        userMessage += `\n\nContext:\n${userContext}`;
      }

      // Build messages with optional memory context
      const messages: any[] = [];
      if (injectMemory) {
        try {
          const quickCtx = await buildQuickContext();
          if (quickCtx.trim()) messages.push({ role: 'system', content: quickCtx });
        } catch {}
      }
      messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: userMessage });

      const result = await generateText({
        model: aiModel as any,
        messages,
        temperature: 0.1,
      });

      const text = (result as any).text?.trim() || '';

      // Parse JSON response
      let parsed: any;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      } catch {
        // Fallback: treat entire response as the decision
        parsed = { decision: text.slice(0, 200), reason: '', confidence: 0.5 };
      }

      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'agent_decision',
        status: 'decided',
        decision: parsed.decision,
      });

      return {
        ok: true,
        decision: String(parsed.decision || ''),
        reason: String(parsed.reason || ''),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      };
    } catch (err: any) {
      return {
        ok: false,
        decision: '',
        error: err?.message || 'decision_failed',
      };
    }
  },
} as any);

/**
 * agent_extract — Extract structured data from unstructured text using AI.
 */
export const agent_extract = createTool({
  id: 'agent_extract',
  description: `Extract structured data from unstructured text. Define the fields you want and the AI will pull them out. Great for parsing emails, documents, logs, or any text into structured data for downstream workflow steps.

Examples:
- Extract name, email, phone from a contact message
- Pull order ID, amount, date from an invoice email
- Parse error codes, timestamps, severity from log entries`,
  inputSchema: z.object({
    text: z.string().describe('The unstructured text to extract data from'),
    fields: z.record(z.string(), z.string()).describe('Fields to extract. Keys = field names, values = description of what to extract. Example: {"name": "person name", "email": "email address", "sentiment": "positive/negative/neutral"}'),
    model: z.enum(['fast', 'balanced', 'smart']).default('fast').describe('Model tier'),
    injectMemory: z.boolean().optional().default(false).describe('When true, injects the user\'s identity and instructions into the extraction context.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    data: z.record(z.string(), z.any()).optional().describe('Extracted fields'),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, ctx: any) => {
    // Normalize: HTTP route wraps body as { context: body }
    const raw = (inputData as any)?.context && typeof (inputData as any).context === 'object' && (inputData as any).context.text !== undefined
      ? (inputData as any).context
      : inputData;
    const { text, fields, model = 'fast', injectMemory = false } = raw as any;
    const writer = (ctx as any)?.writer;

    if (!text) return { ok: false, error: 'text is required' };
    if (!fields || Object.keys(fields).length === 0) return { ok: false, error: 'fields is required' };

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'agent_extract',
      status: 'extracting',
      fieldCount: Object.keys(fields).length,
    });

    try {
      const { generateText } = await import('ai');
      const { buildProviderModel } = await import('../../utils/models');

      const concreteModelId = getDefaultModelForCategory(model as any);
      const aiModel = buildProviderModel(concreteModelId);

      const fieldDesc = Object.entries(fields)
        .map(([k, v]) => `  "${k}": ${v}`)
        .join('\n');

      const systemPrompt = `You are a data extraction assistant. Extract the requested fields from the given text.
Return ONLY a valid JSON object with the extracted values. Use null for fields you cannot find.`;

      const userMessage = `Extract these fields:
${fieldDesc}

From this text:
${text}`;

      // Build messages with optional memory context
      const messages: any[] = [];
      if (injectMemory) {
        try {
          const quickCtx = await buildQuickContext();
          if (quickCtx.trim()) messages.push({ role: 'system', content: quickCtx });
        } catch {}
      }
      messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: userMessage });

      const result = await generateText({
        model: aiModel as any,
        messages,
        temperature: 0,
      });

      const responseText = (result as any).text?.trim() || '';

      let data: any;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        data = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
      } catch {
        data = { _raw: responseText };
      }

      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'agent_extract',
        status: 'completed',
      });

      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'extraction_failed' };
    }
  },
} as any);
