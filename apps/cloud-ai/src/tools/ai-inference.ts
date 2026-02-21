import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText, streamText, embed } from 'ai';
import { buildProviderModel, buildProviderEmbeddingModel } from '../utils/models';
import { safeToolWrite, execLocalTool, hasClientBridge } from './bridge';
import { writeLog } from '../utils/logger';
import { buildKnowledgeContext, buildQuickContext } from '../knowledge/retrieval';

/**
 * ai_inference - General purpose AI text/structured inference tool
 * 
 * Use cases:
 * - Text summarization
 * - Classification/categorization
 * - Entity extraction
 * - Data transformation
 * - Question answering
 * - JSON generation from natural language
 */

// Dynamic schema builder for structured output
function buildZodSchema(shape: Record<string, any>): z.ZodObject<any> {
  const entries: Record<string, any> = {};
  
  for (const [key, spec] of Object.entries(shape)) {
    const type = typeof spec === 'string' ? spec : spec?.type;
    const description = typeof spec === 'object' ? spec?.description : undefined;
    
    let zodType: any;
    switch (type) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'string[]':
        zodType = z.array(z.string());
        break;
      case 'number[]':
        zodType = z.array(z.number());
        break;
      case 'boolean[]':
        zodType = z.array(z.boolean());
        break;
      case 'object':
        zodType = z.record(z.string(), z.any());
        break;
      default:
        zodType = z.any();
    }
    
    if (description) {
      zodType = zodType.describe(description);
    }
    
    entries[key] = zodType;
  }
  
  return z.object(entries);
}

export const aiInferenceTool = createTool({
  id: 'ai_inference',
  description:
    'Run AI inference on text input. Returns either plain text, structured JSON, or embeddings based on mode. Use for summarization, classification, extraction, Q&A, or any text-to-text/JSON transformation. Models: fast=DeepSeek/Gemini Flash, balanced=Grok/GPT-4o Mini, smart=Gemini Pro/GPT-5.',
  inputSchema: z.object({
    prompt: z
      .string()
      .describe('The instruction/question for the AI. Be specific about what you want. For embedding mode, this is the text to embed.'),
    input: z
      .string()
      .optional()
      .describe('Optional input text to process. Can also be embedded in prompt.'),
    mode: z
      .enum(['text', 'json', 'embedding'])
      .default('text')
      .describe('Output mode: "text" for plain text, "json" for structured output, "embedding" for vector embeddings'),
    schema: z
      .record(z.string(), z.any())
      .optional()
      .describe('For json mode: define output shape. Keys are field names, values are types: "string", "number", "boolean", "string[]", etc. Example: { "category": "string", "confidence": "number", "tags": "string[]" }'),
    model: z
      .string()
      .default('openai/gpt-4.1-mini')
      .describe('Model selection: e.g. "openai/gpt-4.1-mini", "google/gemini-2.5-pro". Defaults to "openai/gpt-4.1-mini"'),
    temperature: z
      .number()
      .min(0)
      .max(2)
      .default(0.3)
      .describe('Creativity/randomness. 0 = deterministic, 1+ = creative'),
    systemPrompt: z
      .string()
      .optional()
      .describe('Optional system prompt to set AI behavior/persona'),
    stream: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, returns a streamId immediately and pushes tokens to the stream in real-time. Connect a stream wire to consume.'),
    injectMemory: z
      .boolean()
      .optional()
      .default(false)
      .describe('Legacy: When true, injects full memory context. Prefer the `memory` object for per-lens control.'),
    memory: z.object({
      enabled: z.boolean().describe('Master toggle for memory injection'),
      lenses: z.object({
        identity: z.boolean().optional().default(true).describe('Include user identity context'),
        directives: z.boolean().optional().default(true).describe('Include user directives/instructions'),
        bio: z.boolean().optional().default(true).describe('Include user bio'),
        relatedMemories: z.boolean().optional().default(true).describe('Include relevant past memories'),
        entities: z.boolean().optional().default(true).describe('Detect and include entity context'),
      }).optional(),
      maxFacts: z.number().optional().default(6).describe('Max global search facts to retrieve'),
      conversationHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })).optional().describe('Conversation history pairs to inject as context'),
      customFacts: z.array(z.string()).optional().describe('Custom facts to inject into memory context'),
    }).optional().describe('Rich memory configuration with per-lens control, conversation history, and custom facts'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    text: z.string().optional().describe('Plain text result (text mode)'),
    json: z.any().optional().describe('Structured JSON result (json mode)'),
    embedding: z.array(z.number()).optional().describe('Vector embedding result (embedding mode)'),
    model: z.string().describe('Model used'),
    streamId: z.string().optional().describe('Stream ID when stream=true'),
    error: z.string().optional(),
  }),
  execute: async (inputData: any, { writer }: any) => {
    const {
      prompt,
      input,
      mode,
      schema,
      model: modelId,
      temperature,
      systemPrompt,
      stream: streamMode = false,
      injectMemory = false,
      memory: memoryConfig,
    } = (inputData || {}) as {
      prompt: string;
      input?: string;
      mode: 'text' | 'json' | 'embedding';
      schema?: Record<string, any>;
      model: string;
      temperature: number;
      systemPrompt?: string;
      stream?: boolean;
      injectMemory?: boolean;
      memory?: { enabled: boolean; lenses?: Record<string, boolean>; maxFacts?: number; conversationHistory?: { role: string; content: string }[]; customFacts?: string[] };
    };

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'ai_inference',
      status: 'started',
      mode,
      model: modelId,
    });

    if (mode === 'embedding') {
      const embeddingModelId = modelId.includes('embedding') ? modelId : 'openai/text-embedding-3-large';
      const aiEmbeddingModel = buildProviderEmbeddingModel(embeddingModelId);
      
      if (!aiEmbeddingModel) {
        throw new Error(`Failed to initialize embedding model: ${embeddingModelId}`);
      }

      const textToEmbed = input ? `${prompt}\n${input}` : prompt;

      try {
        const { embedding: resultEmbedding } = await embed({
          model: aiEmbeddingModel,
          value: textToEmbed,
        });

        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'completed',
          mode: 'embedding',
        });

        return { ok: true, embedding: resultEmbedding, model: embeddingModelId };
      } catch (err: any) {
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'error',
          error: err?.message || 'embedding_failed',
        });

        return { ok: false, error: err?.message || 'embedding_failed', model: embeddingModelId };
      }
    }

    // Select model directly
    const aiModel = buildProviderModel(modelId);

    if (!aiModel) {
      throw new Error(`Failed to initialize model: ${modelId}`);
    }

    // Build full prompt
    const fullPrompt = input 
      ? `${prompt}\n\n---\nInput:\n${input}`
      : prompt;

    const messages: any[] = [];

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
        writeLog('ai_inference_memory_start', { prompt: prompt.slice(0, 50), lenses });
        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'loading_memory',
        });

        if (!hasClientBridge()) {
          try {
            const quickCtx = await buildQuickContext();
            if (quickCtx.trim()) {
              memoryContext = quickCtx.trim();
            }
          } catch {}
        } else {
          const knowledgeCtx = await buildKnowledgeContext(prompt, {
            includeIdentity: lenses.identity !== false,
            includeDirectives: lenses.directives !== false,
            includeBio: lenses.bio !== false,
            maxGlobalFacts: memCfg.maxFacts ?? 6,
            detectEntities: lenses.entities !== false,
          });
          if (knowledgeCtx && knowledgeCtx.text.trim()) {
            memoryContext = knowledgeCtx.text.trim();
          }
        }

        if (memoryContext) {
          messages.push({ role: 'system', content: memoryContext });
          writeLog('ai_inference_memory_injected', { length: memoryContext.length });
        }

        // Append custom facts
        if (Array.isArray(memCfg.customFacts) && memCfg.customFacts.length > 0) {
          const validFacts = memCfg.customFacts.filter((f: string) => typeof f === 'string' && f.trim());
          if (validFacts.length > 0) {
            const factsBlock = '\n\n[CUSTOM FACTS]\n' + validFacts.map((f: string) => `- ${f.trim()}`).join('\n');
            if (memoryContext) {
              // Amend the last system message
              messages[messages.length - 1].content += factsBlock;
            } else {
              messages.push({ role: 'system', content: factsBlock.trim() });
            }
          }
        }

        // Inject conversation history as context messages
        if (Array.isArray(memCfg.conversationHistory) && memCfg.conversationHistory.length > 0) {
          for (const msg of memCfg.conversationHistory) {
            if (msg.role && msg.content?.trim()) {
              messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content.trim() });
            }
          }
        }
      } catch (memErr: any) {
        writeLog('ai_inference_memory_error', { error: memErr?.message });
        // Non-fatal: continue without memory
      }
    }

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: fullPrompt });

    try {
      // ── STREAM MODE: create stream, push tokens in background, return immediately ──
      if (streamMode && mode === 'text') {
        const streamResult = await execLocalTool('stream_create', {
          kind: 'text',
          sourceStepId: 'ai_inference',
          metadata: { model: modelId, prompt: prompt.slice(0, 100) },
        });

        if (!streamResult?.ok || !streamResult?.streamId) {
          return { ok: false, error: 'Failed to create stream', model: modelId };
        }

        const streamId = streamResult.streamId;

        // Fire and forget — stream tokens in background
        (async () => {
          try {
            const result = await streamText({
              model: aiModel as any,
              messages,
              temperature,
            });

            for await (const chunk of result.textStream) {
              if (chunk) {
                await execLocalTool('stream_write', { streamId, chunk, chunkType: 'raw' }).catch(() => {});
              }
            }
          } catch (err: any) {
            writeLog('ai_inference_stream_error', { streamId, error: err?.message });
          } finally {
            await execLocalTool('stream_close', { streamId }).catch(() => {});
          }
        })();

        return { ok: true, streamId, model: modelId };
      }

      if (mode === 'json' && schema) {
        // Structured JSON output
        const zodSchema = buildZodSchema(schema);
        
        // Use generateText with JSON instruction since generateObject can be finicky
        const schemaDesc = JSON.stringify(schema);
        const jsonPrompt = `${fullPrompt}\n\nRespond with a valid JSON object matching this schema: ${schemaDesc}\nOutput ONLY the JSON, no markdown or explanation.`;
        
        const result = await generateText({
          model: aiModel as any,
          messages: systemPrompt 
            ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: jsonPrompt }]
            : [{ role: 'user', content: jsonPrompt }],
          temperature,
        });

        let jsonResult: any;
        try {
          // Try to parse JSON from response
          const text = result.text.trim();
          // Handle markdown code blocks
          const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
          const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;
          jsonResult = JSON.parse(jsonStr);
        } catch (parseErr) {
          // Try to extract JSON object/array
          const text = result.text.trim();
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start >= 0 && end > start) {
            jsonResult = JSON.parse(text.slice(start, end + 1));
          } else {
            throw new Error('Failed to parse JSON from response');
          }
        }

        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'completed',
          mode: 'json',
        });

        return { ok: true, json: jsonResult, model: modelId };
      } else {
        // Plain text output
        const result = await generateText({
          model: aiModel as any,
          messages,
          temperature,
        });

        const text = result.text?.trim() || '';

        await safeToolWrite(writer, {
          type: 'tool_event',
          tool: 'ai_inference',
          status: 'completed',
          mode: 'text',
          length: text.length,
        });

        return { ok: true, text, model: modelId };
      }
    } catch (err: any) {
      await safeToolWrite(writer, {
        type: 'tool_event',
        tool: 'ai_inference',
        status: 'error',
        error: err?.message || 'inference_failed',
      });

      return { ok: false, error: err?.message || 'inference_failed', model: modelId };
    }
  },
} as any);
