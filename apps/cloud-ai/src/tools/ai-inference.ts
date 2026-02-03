import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText } from 'ai';
import { buildProviderModel } from '../utils/models';
import { safeToolWrite } from './bridge';

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
    'Run AI inference on text input. Returns either plain text or structured JSON based on mode. Use for summarization, classification, extraction, Q&A, or any text-to-text/JSON transformation. Models: fast=DeepSeek/Gemini Flash, balanced=Grok/GPT-4o Mini, smart=Gemini Pro/GPT-5.',
  inputSchema: z.object({
    prompt: z
      .string()
      .describe('The instruction/question for the AI. Be specific about what you want.'),
    input: z
      .string()
      .optional()
      .describe('Optional input text to process. Can also be embedded in prompt.'),
    mode: z
      .enum(['text', 'json'])
      .default('text')
      .describe('Output mode: "text" for plain text, "json" for structured output'),
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
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    text: z.string().optional().describe('Plain text result (text mode)'),
    json: z.any().optional().describe('Structured JSON result (json mode)'),
    model: z.string().describe('Model used'),
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
    } = (inputData || {}) as {
      prompt: string;
      input?: string;
      mode: 'text' | 'json';
      schema?: Record<string, any>;
      model: string;
      temperature: number;
      systemPrompt?: string;
    };

    await safeToolWrite(writer, {
      type: 'tool_event',
      tool: 'ai_inference',
      status: 'started',
      mode,
      model: modelId,
    });

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
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: fullPrompt });

    try {
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
