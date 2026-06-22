/**
 * AI assistant for the Integration Builder.
 *
 *   POST /v1/integrations/ai-assist
 *
 * Streams SSE events while the model thinks. Has access to web_search and
 * scrape_url so it can verify endpoints against live docs before editing the
 * manifest — the user gets the same "research → reason → edit" experience as
 * the main agent and the workflow AI.
 *
 * Event types (newline-delimited JSON, framed as SSE `data:` lines):
 *   - { type: "start" }
 *   - { type: "reasoning-delta", text }      — chain-of-thought chunks
 *   - { type: "tool-call", id, name, args }  — model invoked a tool
 *   - { type: "tool-result", id, name, result }
 *   - { type: "text-delta", text }           — running prose for the user
 *   - { type: "done", reply, manifest? }     — final consolidated reply
 *   - { type: "error", error, detail? }
 *
 * The model is asked to emit a fenced ```json``` block ONLY when changes are
 * intended. Plain prose answers (questions about the schema, debugging hints)
 * leave the manifest untouched. We never apply partial JSON patches.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { streamText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { authenticateHttpLegacy, sendAuthError } from '../auth/http';
import { AuthErrorCode } from '../auth';
import { buildProviderModelForUser } from '../utils/models';
import { checkAccess, logUsageEvent } from '../supabase';
import { web_search } from '../tools/perplexity-tools';
import { scrape_url, normalizeScrapeUrlsInput } from '../tools/tavily-tools';
import { getDefaultModelForCategory } from '../pricing';
import { buildProviderOptions } from '../server/chat/provider-options';
import { INTEGRATION_MANIFEST_SYSTEM_PROMPT } from '../integrations/manifest-prompt';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function writeJson(res: ServerResponse, status: number, obj: any): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

const SYSTEM_PROMPT = INTEGRATION_MANIFEST_SYSTEM_PROMPT;

function extractManifest(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const candidate = fenced ? fenced[1] : null;
  if (candidate) {
    try { return JSON.parse(candidate); } catch { /* fall through */ }
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { return JSON.parse(trimmed); } catch { /* nope */ }
  }
  return null;
}

function stripManifestBlock(text: string): string {
  return text.replace(/```(?:json)?\s*\n[\s\S]*?\n```/g, '').trim();
}

export async function handleIntegrationsAssistRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  if (parsedUrl.pathname !== '/v1/integrations/ai-assist') return false;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }

  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return true;
  }

  const auth = await authenticateHttpLegacy(req, parsedUrl);
  if (!auth.success || !auth.userId) {
    sendAuthError(res, auth.error || AuthErrorCode.UNAUTHORIZED, auth.message);
    return true;
  }

  try {
    const access = await checkAccess(auth.userId);
    if (!access.allowed) {
      writeJson(res, 402, { ok: false, error: access.reason || 'credit_limit_exceeded' });
      return true;
    }
  } catch {
    writeJson(res, 503, { ok: false, error: 'credit_check_failed' });
    return true;
  }

  const body = await readJson(req);
  if (!body) {
    writeJson(res, 400, { ok: false, error: 'invalid_json' });
    return true;
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    writeJson(res, 400, { ok: false, error: 'missing_message' });
    return true;
  }

  const manifest = body.manifest && typeof body.manifest === 'object' ? body.manifest : {};
  const history = Array.isArray(body.history) ? body.history : [];

  const requestedModelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
  const selectedModelId =
    requestedModelId && requestedModelId !== 'auto'
      ? requestedModelId
      : getDefaultModelForCategory('balanced');
  const modelSource = typeof body.modelSource === 'string' ? body.modelSource.trim() : 'auto';
  const reasoningLevel = typeof body.reasoningLevel === 'string' ? body.reasoningLevel.trim() : 'high';
  const resolved = await buildProviderModelForUser(auth.userId, selectedModelId, modelSource);
  if (!resolved) {
    writeJson(res, 500, { ok: false, error: 'model_unavailable' });
    return true;
  }

  // ── SSE bootstrap ──────────────────────────────────────────────────────
  let sseStarted = false;
  const startSse = (): void => {
    if (sseStarted) return;
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sseStarted = true;
  };
  const send = (obj: any): void => {
    try {
      if (!sseStarted) startSse();
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch { /* client gone */ }
  };
  const heartbeat = setInterval(() => {
    try { if (sseStarted && !res.writableEnded) res.write(`: ping ${Date.now()}\n\n`); } catch {}
  }, 15_000);
  const controller = new AbortController();
  let finished = false;
  const onClose = (): void => { if (!finished) { try { controller.abort(); } catch {} } };
  try { res.on('close', onClose); } catch {}
  const finish = (): void => {
    finished = true;
    try { clearInterval(heartbeat); } catch {}
    try { res.off('close', onClose); } catch {}
    try { if (!res.writableEnded) res.end(); } catch {}
  };

  // ── AI-SDK shaped wrappers around the mastra tools ─────────────────────
  // The shared web_search/scrape_url live as @mastra/core tools; we wrap them
  // here so we can also push tool events into the SSE stream.
  const webSearchTool = tool({
    description:
      'Search the web for up-to-date documentation about a third-party API. Returns title/url/snippet for the top results. Use this before adding a tool when uncertain about the real endpoint, auth header, or request shape.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Natural-language search query (no Google operators).'),
      max_results: z.number().int().min(1).max(10).optional().default(5),
    }),
    execute: async ({ query, max_results }) => {
      try {
        const result: any = await (web_search as any).execute(
          { query, max_results: max_results ?? 5 },
          {},
        );
        return { results: Array.isArray(result?.results) ? result.results : [] };
      } catch (e: any) {
        return { results: [], error: e?.message || String(e) };
      }
    },
  });

  const scrapeUrlTool = tool({
    description:
      'Fetch and extract the readable text of one or more URLs (max 2 per call). Use to read the relevant section of an API doc page after web_search surfaces it.',
    inputSchema: z.object({
      urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(2)])
        .describe('A single URL or list of up to 2 URLs.'),
      extractDepth: z.enum(['basic', 'advanced']).optional().default('basic'),
    }),
    execute: async ({ urls, extractDepth }) => {
      try {
        const list = normalizeScrapeUrlsInput(urls).slice(0, 2);
        if (list.length === 0) return { results: [], error: 'no_urls' };
        const result: any = await (scrape_url as any).execute(
          { urls: list, extractDepth: extractDepth ?? 'basic' },
          {},
        );
        return { results: Array.isArray(result?.results) ? result.results : [] };
      } catch (e: any) {
        return { results: [], error: e?.message || String(e) };
      }
    },
  });

  // ── Compose the conversation. Current manifest is given to the model as a
  // system-style preamble so it can edit it directly without re-quoting. ──
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const h of history) {
    if (!h || typeof h !== 'object') continue;
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: String(h.content || '') });
    }
  }
  const contextPreamble =
    `Current manifest:\n\`\`\`json\n${JSON.stringify(manifest, null, 2)}\n\`\`\`\n\nUser request: ${message}`;
  messages.push({ role: 'user', content: contextPreamble });

  send({ type: 'start', model: selectedModelId });

  let finalText = '';
  let usage: any = null;

  try {
    const stream = streamText({
      model: resolved.model as any,
      system: SYSTEM_PROMPT,
      messages,
      temperature: 0.2,
      tools: { web_search: webSearchTool, scrape_url: scrapeUrlTool },
      stopWhen: stepCountIs(8),
      abortSignal: controller.signal,
      providerOptions: buildProviderOptions({
        agentType: 'workflow',
        workflowModelId: selectedModelId,
        chosenModelId: selectedModelId,
        modelSource: resolved.source,
        modelLabel: selectedModelId,
        msg: { reasoningLevel },
      }),
    });

    // Forward fine-grained events to the client. AI SDK v6 uses `fullStream`
    // with typed parts: text-delta, reasoning-delta, tool-call, tool-result,
    // finish, error.
    for await (const part of stream.fullStream as AsyncIterable<any>) {
      if (controller.signal.aborted) break;
      switch (part?.type) {
        case 'text-delta': {
          const text = String(part.text ?? part.delta ?? '');
          if (text) {
            finalText += text;
            send({ type: 'text-delta', text });
          }
          break;
        }
        case 'reasoning-delta': {
          const text = String(part.text ?? part.delta ?? '');
          if (text) send({ type: 'reasoning-delta', text });
          break;
        }
        case 'tool-call': {
          send({
            type: 'tool-call',
            id: part.toolCallId || part.id || `tc_${Date.now()}`,
            name: part.toolName || part.name,
            args: part.input ?? part.args ?? {},
          });
          break;
        }
        case 'tool-error': {
          send({
            type: 'tool-result',
            id: part.toolCallId || part.id || `te_${Date.now()}`,
            name: part.toolName || part.name,
            result: {
              error: part.error?.message || String(part.error || 'tool_error'),
            },
          });
          break;
        }
        case 'tool-result': {
          send({
            type: 'tool-result',
            id: part.toolCallId || part.id || `tr_${Date.now()}`,
            name: part.toolName || part.name,
            result: part.output ?? part.result ?? null,
          });
          break;
        }
        case 'error': {
          const detail = part.error?.message || String(part.error || 'stream_error');
          send({ type: 'error', error: 'stream_error', detail });
          break;
        }
        default:
          break;
      }
    }

    try { usage = await stream.totalUsage; }
    catch { try { usage = await (stream as any).usage; } catch {} }

    try {
      await logUsageEvent(auth.userId, null, selectedModelId, {
        ...(usage || {}),
        sourceType: 'inference',
        source_label: 'Integration Builder AI',
        ...(resolved.billingExcluded ? { billingExcluded: true } : {}),
      });
    } catch { /* non-fatal */ }

    const newManifest = extractManifest(finalText);
    const reply = stripManifestBlock(finalText) ||
      (newManifest ? 'Updated the manifest.' : 'No changes — let me know what to do next.');

    send({
      type: 'done',
      reply,
      ...(newManifest ? { manifest: newManifest } : {}),
    });
    finish();
    return true;
  } catch (e: any) {
    send({ type: 'error', error: 'llm_error', detail: e?.message || String(e) });
    finish();
    return true;
  }
}
