import type { IncomingMessage, ServerResponse } from 'http';
import { generateText, generateObject, embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { verifyToken } from '../supabase';

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => { try { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch {} });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function writeJson(res: ServerResponse, status: number, obj: any) {
  try {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch {
    try { res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('{"ok":false,"error":"internal"}'); } catch {}
  }
}

function pickModelProvider() {
  // Prefer OpenAI if available; otherwise fall back to Gemini; if both fail, caller should handle.
  const prefer = (process.env.WORKFLOW_INFER_PROVIDER || '').toLowerCase();
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGemini = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY || !!process.env.GEMINI_API_KEY;
  if ((prefer === 'openai' && hasOpenAI) || (hasOpenAI && !hasGemini)) return { kind: 'openai' as const, model: 'gpt-4.1-mini' };
  if (hasGemini) return { kind: 'google' as const, model: 'gemini-1.5-flash' };
  // default to openai id (may fail; handled by try/catch in callers)
  return { kind: 'openai' as const, model: 'gpt-4.1-mini' };
}

export async function handleInferenceRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  const path = String(parsedUrl.pathname || '');

  // CORS preflight
  if (req.method === 'OPTIONS' && path.startsWith('/inference/')) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return true;
  }

  if (req.method === 'POST' && path === '/inference/workflow/next') {
    try {
      // Internal workflow engine endpoint - no user auth required
      // TODO: Add internal API key validation for production
      const body = await readJsonBody(req);
      const ctx = body?.context || {};
      const step = ctx.step || {};
      const options = Array.isArray(ctx.options) ? ctx.options : [];
      const instruction = typeof ctx.instruction === 'string' ? ctx.instruction : '';
      const produceArgs = !!ctx.produceArgs;
      const state = ctx.ctx || {};

      if (!options.length) {
        writeJson(res, 400, { ok: false, error: 'no_options' });
        return true;
      }

      const prov = pickModelProvider();
      const schema = z.object({
        next: z.string(),
        argsPatch: z.record(z.string(), z.any()).optional(),
        reason: z.string().optional(),
      });

      const limited = (s: any) => {
        try { const t = typeof s === 'string' ? s : JSON.stringify(s); return t.length > 8000 ? t.slice(0, 8000) : t; } catch { return ''; }
      };

      const optionsBrief = options.map((o: any) => ({ to: String(o?.to || ''), label: String(o?.label || '') }));
      const prompt = [
        'You are a routing function for a workflow engine. Choose the best next step from the provided options.',
        'Return strict JSON { "next": string, "argsPatch"?: object }.',
        'If you cannot determine, choose the first option.',
        instruction ? `Instruction: ${instruction}` : '',
        `Step: ${limited(step?.id || step?.name || 'current')}`,
        `Options: ${limited(JSON.stringify(optionsBrief))}`,
        `State excerpt: ${limited(state)}`,
      ].filter(Boolean).join('\n');

      let result: { next: string; argsPatch?: any } | null = null;
      try {
        const model = prov.kind === 'openai' ? openai(prov.model) : google(prov.model);
        const out = await generateText({
          model: model as any,
          prompt: `${prompt}\n\nRespond with a valid JSON object matching this schema: ${JSON.stringify(schema.shape)}`,
          temperature: 0.2
        });
        const obj = JSON.parse(out.text) as any;
        if (obj && typeof obj.next === 'string') result = { next: obj.next, argsPatch: obj.argsPatch };
      } catch {}

      if (!result) {
        writeJson(res, 400, { ok: false, error: 'no_routing_decision' });
      } else {
        writeJson(res, 200, { ok: true, ...result });
      }
      return true;
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: e?.message || 'failed' });
      return true;
    }
  }

  if (req.method === 'POST' && path === '/inference/ai/embed_many') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authed = token ? await verifyToken(token) : null;
      if (!authed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' });
        return true;
      }

      const body = await readJsonBody(req);
      const texts = Array.isArray(body?.texts) ? body.texts : [];
      const modelId = String(body?.model || 'text-embedding-3-large').trim() || 'text-embedding-3-large';

      const values = texts
        .map((t: any) => String(t || '').trim())
        .filter(Boolean)
        .map((t: string) => t.slice(0, 12000));

      if (values.length === 0) {
        writeJson(res, 400, { ok: false, error: 'missing_texts' });
        return true;
      }

      const out = await embedMany({
        model: openai.embedding(modelId),
        values,
      });

      writeJson(res, 200, { ok: true, embeddings: out.embeddings, model: modelId });
      return true;
    } catch (e: any) {
      console.error('[inference] ai/embed_many error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'embed_many_failed' });
      return true;
    }
  }

  // Workflow agent endpoints removed - workflow editing handled by stuard agent with workflow tools

  // Analyze media (audio, video, images) - used by workflow engine
  if (req.method === 'POST' && path === '/inference/ai/analyze-media') {
    try {
      // Internal workflow engine endpoint - no user auth required
      // TODO: Add internal API key validation for production
      const body = await readJsonBody(req);
      const task = String(body?.task || 'Analyze this media and provide a summary.');
      const media = Array.isArray(body?.media) ? body.media : [];
      
      if (media.length === 0) {
        writeJson(res, 400, { ok: false, error: 'no_media_provided' });
        return true;
      }
      
      try {
        // Use Gemini for multimodal analysis
        const model = google('gemini-2.5-flash');
        
        // Build content parts in the correct format for AI SDK
        // Must use 'mimeType' and keep data as base64 string
        const contentParts: any[] = [{ type: 'text', text: task }];
        
        for (const m of media) {
          const data = String(m?.data || '');
          const mediaType = String(m?.mimeType || 'application/octet-stream');
          if (!data) continue;
          
          // Use the file part format with base64 string data and 'mimeType'
          contentParts.push({
            type: 'file',
            data,  // Keep as base64 string, not Buffer
            mediaType: mediaType,
          });
        }
        
        const out = await generateText({
          model: model as any,
          messages: [{ role: 'user' as const, content: contentParts }],
          temperature: 0.2,
        });
        
        const summary = out.text?.trim() || '';
        writeJson(res, 200, { ok: true, summary, text: summary });
        return true;
      } catch (e: any) {
        console.error('[inference] analyze-media error:', e);
        writeJson(res, 500, { ok: false, error: e?.message || 'ai_failed' });
        return true;
      }
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: e?.message || 'failed' });
      return true;
    }
  }

  if (req.method === 'POST' && path === '/inference/ai/vision-structured') {
    try {
      const body = await readJsonBody(req);
      const shapeField = z.object({
        type: z.enum(['string', 'number', 'boolean', 'string[]', 'number[]', 'boolean[]']),
      });
      const shapeSchema = z.object({
        type: z.literal('object'),
        properties: z.record(z.string(), shapeField),
      });
      const inputSchema = z.object({
        prompt: z.string().min(1),
        imageB64: z.string().min(16),
        mimeType: z.string().optional(),
        schema: shapeSchema,
      });

      const parsed = inputSchema.safeParse(body || {});
      if (!parsed.success) {
        writeJson(res, 400, { ok: false, error: 'invalid_body', details: parsed.error.flatten() });
        return true;
      }

      const { prompt, imageB64, mimeType, schema } = parsed.data;

      const prov = pickModelProvider();

      const buildZodObject = (shape: z.infer<typeof shapeSchema>) => {
        const entries: Record<string, any> = {};
        for (const [k, spec] of Object.entries(shape.properties || {})) {
          let base: any;
          switch ((spec as any).type) {
            case 'string': base = z.string(); break;
            case 'number': base = z.number(); break;
            case 'boolean': base = z.boolean(); break;
            case 'string[]': base = z.array(z.string()); break;
            case 'number[]': base = z.array(z.number()); break;
            case 'boolean[]': base = z.array(z.boolean()); break;
            default: base = z.any(); break;
          }
          entries[k] = base;
        }
        return z.object(entries);
      };

      const objSchema = buildZodObject(schema);

      const parts: any[] = [
        { type: 'text', text: prompt },
        { type: 'image', image: imageB64, mimeType: mimeType || 'image/jpeg' },
      ];

      const messages = [{ role: 'user' as const, content: parts }];

      let object: any = null;
      try {
        const model = prov.kind === 'openai' ? openai(prov.model) : google(prov.model);
        const textPrompt = `${prompt}\n\nRespond with a valid JSON object matching this schema: ${JSON.stringify(objSchema.shape)}`;
        const out = await generateText({ model: model as any, messages: [{ role: 'user', content: textPrompt }], temperature: 0.2 });
        object = JSON.parse(out.text);
      } catch {}

      if (!object || typeof object !== 'object') {
        writeJson(res, 400, { ok: false, error: 'ai_failed' });
        return true;
      }

      writeJson(res, 200, { ok: true, object });
      return true;
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: e?.message || 'failed' });
      return true;
    }
  }

  // AI Text Inference - text in, text or JSON out
  if (req.method === 'POST' && path === '/inference/ai/text') {
    try {
      // Internal workflow engine endpoint - no user auth required
      // TODO: Add internal API key validation for production
      const body = await readJsonBody(req);
      const prompt = String(body?.prompt || '');
      const input = body?.input ? String(body.input) : undefined;
      const mode = body?.mode === 'json' ? 'json' : 'text';
      const schema = body?.schema as Record<string, any> | undefined;
      const modelChoice = body?.model === 'quality' ? 'quality' : 'fast';
      const temperature = typeof body?.temperature === 'number' ? body.temperature : 0.3;
      const systemPrompt = body?.systemPrompt ? String(body.systemPrompt) : undefined;

      if (!prompt) {
        writeJson(res, 400, { ok: false, error: 'prompt_required' });
        return true;
      }

      // Select model
      const modelId = modelChoice === 'quality' ? 'gpt-4.1-mini' : 'gemini-2.5-flash';
      const aiModel = modelChoice === 'quality' ? openai(modelId) : google(modelId);

      // Build full prompt
      const fullPrompt = input ? `${prompt}\n\n---\nInput:\n${input}` : prompt;

      try {
        if (mode === 'json' && schema) {
          // JSON mode with schema
          const schemaDesc = JSON.stringify(schema);
          const jsonPrompt = `${fullPrompt}\n\nRespond with a valid JSON object matching this schema: ${schemaDesc}\nOutput ONLY the JSON, no markdown or explanation.`;

          const messages: any[] = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: jsonPrompt }]
            : [{ role: 'user', content: jsonPrompt }];

          const result = await generateText({
            model: aiModel as any,
            messages,
            temperature,
          });

          let jsonResult: any;
          try {
            const text = result.text.trim();
            // Handle markdown code blocks
            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : text;
            jsonResult = JSON.parse(jsonStr);
          } catch {
            // Try to extract JSON object
            const text = result.text.trim();
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            if (start >= 0 && end > start) {
              jsonResult = JSON.parse(text.slice(start, end + 1));
            } else {
              throw new Error('Failed to parse JSON from response');
            }
          }

          writeJson(res, 200, { ok: true, json: jsonResult, model: modelId });
        } else {
          // Text mode
          const messages: any[] = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: fullPrompt }]
            : [{ role: 'user', content: fullPrompt }];

          const result = await generateText({
            model: aiModel as any,
            messages,
            temperature,
          });

          const text = result.text?.trim() || '';
          writeJson(res, 200, { ok: true, text, model: modelId });
        }
        return true;
      } catch (e: any) {
        console.error('[inference] ai/text error:', e);
        writeJson(res, 500, { ok: false, error: e?.message || 'ai_inference_failed', model: modelId });
        return true;
      }
    } catch (e: any) {
      writeJson(res, 500, { ok: false, error: e?.message || 'failed' });
      return true;
    }
  }

  if (req.method === 'POST' && path === '/inference/ai/embed') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const authed = token ? await verifyToken(token) : null;
      if (!authed) {
        writeJson(res, 401, { ok: false, error: 'unauthorized' });
        return true;
      }

      const body = await readJsonBody(req);
      const text = String(body?.text || '').trim();
      const modelId = String(body?.model || 'text-embedding-3-large').trim() || 'text-embedding-3-large';
      if (!text) {
        writeJson(res, 400, { ok: false, error: 'missing_text' });
        return true;
      }

      const out = await embed({
        model: openai.embedding(modelId),
        value: text.slice(0, 12000),
      });

      writeJson(res, 200, { ok: true, embedding: out.embedding, model: modelId });
      return true;
    } catch (e: any) {
      console.error('[inference] ai/embed error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'embed_failed' });
      return true;
    }
  }

  // Multimodal file summarization - supports images, audio, video, PDF as attachments
  if (req.method === 'POST' && path === '/inference/ai/summarize-file') {
    try {
      const body = await readJsonBody(req);
      const filename = String(body?.filename || 'file');
      const mimeType = String(body?.mimeType || 'application/octet-stream');
      const base64Data = body?.data as string | undefined;  // Base64 encoded file
      const textContent = body?.text as string | undefined;  // For text-based files

      if (!base64Data && !textContent) {
        writeJson(res, 400, { ok: false, error: 'Either data (base64) or text content required' });
        return true;
      }

      const summaryPrompt = `You are a file summarizer. Analyze this file and generate:
1. A concise summary (2-4 sentences) describing what this file contains
2. A comma-separated list of relevant keywords (5-15 keywords)

Format your response EXACTLY as:
SUMMARY: [your summary here]
KEYWORDS: [keyword1, keyword2, keyword3, ...]

Filename: ${filename}`;

      let content: any[];

      if (base64Data) {
        // Multimodal: send as attachment
        content = [
          { type: 'text', text: summaryPrompt },
          mimeType.startsWith('image/') 
            ? { type: 'image', image: base64Data, mimeType }
            : { type: 'file', data: base64Data, mimeType },
        ];
      } else {
        // Text content
        content = [
          { type: 'text', text: `${summaryPrompt}\n\nContent:\n${textContent?.slice(0, 15000)}` },
        ];
      }

      const result = await generateText({
        model: google('gemini-2.5-flash') as any,
        messages: [{ role: 'user', content }],
        temperature: 0.3,
      });

      const text = result.text?.trim() || '';
      const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=KEYWORDS:|$)/is);
      const keywordsMatch = text.match(/KEYWORDS:\s*(.+?)$/is);

      writeJson(res, 200, {
        ok: true,
        summary: summaryMatch?.[1]?.trim() || `File: ${filename}`,
        keywords: keywordsMatch?.[1]?.trim() || filename.replace(/[._-]/g, ', '),
        model: 'gemini-2.5-flash',
      });
      return true;
    } catch (e: any) {
      console.error('[inference] ai/summarize-file error:', e);
      writeJson(res, 500, { ok: false, error: e?.message || 'summarize_failed' });
      return true;
    }
  }

  return false;
}
