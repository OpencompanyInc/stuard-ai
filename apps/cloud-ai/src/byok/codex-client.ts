/**
 * Codex (ChatGPT-subscription) inference client.
 *
 * Strategy:
 *   - The AI SDK's `createOpenAI(...).responses(modelId)` already speaks
 *     OpenAI Responses API. We feed it a custom `fetch` that intercepts
 *     each call, transforms the body to what `chatgpt.com/backend-api/
 *     codex/responses` expects (stateless, encrypted reasoning, no
 *     max_output_tokens, etc.), swaps in the user's OAuth access token
 *     as Bearer, and adds the chatgpt-account-id / OpenAI-Beta /
 *     originator headers Codex CLI uses.
 *   - Tool calls flow through unchanged: the host (Stuard) declares its
 *     tools normally; we just prepend a developer-role system message
 *     telling the model to use *those* tools instead of its trained
 *     vocabulary (apply_patch / update_plan / shell …).
 *   - On a 401 we mark the user's stored Codex tokens expired and surface
 *     a `codex_token_expired` error so the desktop knows to re-read
 *     ~/.codex/auth.json (which Codex CLI keeps fresh) and re-push.
 *
 * Security:
 *   - Access token never leaves cloud-ai memory; it's pulled fresh from
 *     the encrypted store per request and held only for the duration of
 *     that one fetch call.
 *   - We never log the token or the chatgpt-account-id (account-scoping
 *     header that's tied to the user's plan).
 */

import { randomUUID } from 'crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { getUserApiKey } from './keys';
import { markCodexExpired, writeAuditLog } from './storage';
import { buildCodexSystemPrelude, normalizeReasoningEffort } from './codex-prompts';

const CHATGPT_BACKEND_BASE = 'https://chatgpt.com/backend-api/codex';
const CODEX_RESPONSES_PATH = '/responses';

/**
 * Decode the JWT access token and pull the chatgpt account id out of the
 * `https://api.openai.com/auth` claim. Required as the
 * `chatgpt-account-id` header on every request.
 */
function extractChatGptAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const obj = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    const claim = obj?.['https://api.openai.com/auth'];
    const acct = claim?.chatgpt_account_id || claim?.account_id || null;
    return typeof acct === 'string' ? acct : null;
  } catch {
    return null;
  }
}

interface CodexInputItem {
  type?: string;
  id?: string;
  role?: string;
  content?: any;
  [k: string]: any;
}

/**
 * Transform an incoming OpenAI-Responses-API body into what the ChatGPT
 * Codex backend accepts. Mostly a port of the OpenCode plugin's
 * request-transformer logic: strip stateful AI SDK constructs, force
 * stateless mode, normalize reasoning, prepend our system prelude.
 */
function transformBody(body: any, originalModelId: string, hasTools: boolean): any {
  const out = { ...body };

  // ChatGPT backend requires stateless mode and streaming on the wire.
  out.store = false;
  out.stream = true;

  // Drop fields the backend rejects.
  delete out.max_output_tokens;
  delete out.max_completion_tokens;

  // Reasoning continuity in stateless mode requires the encrypted-content
  // include. Always present, even if the caller asked for something else.
  const include = Array.isArray(out.include) ? out.include.slice() : [];
  if (!include.includes('reasoning.encrypted_content')) {
    include.push('reasoning.encrypted_content');
  }
  out.include = include;

  // Reasoning + verbosity per-model normalization.
  const effort = normalizeReasoningEffort(originalModelId, out.reasoning?.effort);
  out.reasoning = {
    ...(out.reasoning || {}),
    effort,
    summary: out.reasoning?.summary || 'auto',
  };
  out.text = {
    ...(out.text || {}),
    verbosity: out.text?.verbosity || 'medium',
  };

  // Filter input: strip ids (stateless mode); drop AI SDK item_reference;
  // convert orphaned function_call_output into messages so the model
  // doesn't lose tool results.
  if (Array.isArray(out.input)) {
    const seenCallIds = new Set<string>();
    for (const item of out.input as CodexInputItem[]) {
      if (item?.type === 'function_call' && typeof item.call_id === 'string') {
        seenCallIds.add(item.call_id);
      }
    }
    const filtered: CodexInputItem[] = [];
    for (const item of out.input as CodexInputItem[]) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'item_reference') continue;
      if (item.type === 'function_call_output' && item.call_id && !seenCallIds.has(item.call_id)) {
        // Orphan — convert to a plain user-role message so context isn't lost.
        const text = typeof item.output === 'string'
          ? item.output
          : (() => { try { return JSON.stringify(item.output); } catch { return String(item.output ?? ''); } })();
        filtered.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `[orphan tool result: ${text.slice(0, 4000)}]` }],
        });
        continue;
      }
      const { id: _drop, ...rest } = item as any;
      filtered.push(rest);
    }

    // Prepend the Stuard bridge + tool-remap prelude as a developer message.
    const prelude: CodexInputItem = {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: buildCodexSystemPrelude(hasTools) }],
    };
    out.input = [prelude, ...filtered];
  }

  // The chatgpt backend rejects requests without a top-level `instructions`
  // field with HTTP 400 "Instructions are required". The AI SDK's OpenAI
  // Responses provider expresses the system prompt as an inline message
  // rather than this field, so we promote one here. The developer prelude
  // above stays in `input` so it still applies; this is just to satisfy
  // the backend's schema check.
  if (typeof out.instructions !== 'string' || !out.instructions.trim()) {
    out.instructions = buildCodexSystemPrelude(hasTools);
  }

  return out;
}

/** Sentinel error so callers can detect "user needs to re-push tokens." */
export class CodexTokenExpiredError extends Error {
  constructor() {
    super('codex_token_expired');
    this.name = 'CodexTokenExpiredError';
  }
}

/**
 * Build a fetch implementation suitable for `createOpenAI({ fetch })`.
 * Captures `userId` and the original model id so we can resolve tokens
 * per-request and apply per-model reasoning normalization.
 */
function makeCodexFetch(userId: string, originalModelId: string): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const resolved = await getUserApiKey(userId, 'codex_subscription');
    if (!resolved?.apiKey) {
      throw new CodexTokenExpiredError();
    }
    const accessToken = resolved.apiKey;
    const accountId = extractChatGptAccountId(accessToken);
    if (!accountId) {
      // Token is structurally invalid — treat like an expiry so the
      // desktop re-pushes from auth.json.
      await markCodexExpired(userId);
      throw new CodexTokenExpiredError();
    }

    // Re-route any /responses URL to the chatgpt backend.
    const incomingUrl = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
    const u = new URL(incomingUrl);
    const path = u.pathname.endsWith('/responses') ? CODEX_RESPONSES_PATH : u.pathname;
    const targetUrl = `${CHATGPT_BACKEND_BASE}${path}`;

    // Transform the body.
    let bodyText = '';
    if (init?.body) {
      bodyText = typeof init.body === 'string' ? init.body : Buffer.isBuffer(init.body) ? init.body.toString('utf8') : '';
    }
    let bodyObj: any = null;
    try { bodyObj = bodyText ? JSON.parse(bodyText) : null; } catch {}
    const hasTools = Array.isArray(bodyObj?.tools) && bodyObj.tools.length > 0;
    const transformed = bodyObj ? transformBody(bodyObj, originalModelId, hasTools) : null;

    // Build headers (drop incoming Authorization; we set our own).
    const sessionId = randomUUID();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'Authorization': `Bearer ${accessToken}`,
      'OpenAI-Beta': 'responses=experimental',
      'originator': 'codex_cli_rs',
      'chatgpt-account-id': accountId,
      'session_id': sessionId,
      'conversation_id': sessionId,
    };
    if (init?.headers) {
      const h = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
      h.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (lk === 'authorization' || lk === 'content-type' || lk === 'accept') return;
        headers[k] = v;
      });
    }

    const r = await fetch(targetUrl, {
      method: init?.method || 'POST',
      headers,
      body: transformed ? JSON.stringify(transformed) : init?.body as any,
      signal: init?.signal as any,
    });

    if (r.status === 401) {
      await markCodexExpired(userId);
      await writeAuditLog({
        userId,
        provider: 'codex_subscription',
        action: 'codex_token_expired',
        detail: { status: 401 },
      });
      throw new CodexTokenExpiredError();
    }
    return r;
  }) as typeof fetch;
}

/**
 * Build an AI SDK Responses-API model bound to the user's stored Codex
 * tokens. Returns null when the user has no Codex subscription on file.
 *
 * Use exactly like any other AI SDK model:
 *   const m = await buildCodexModel(userId, 'gpt-5.1-codex');
 *   if (m) await streamText({ model: m, messages, tools, ... });
 */
export async function buildCodexModel(
  userId: string,
  modelId: string,
): Promise<any | null> {
  // Cheap pre-check so we don't spin up a client when the user has no key.
  const resolved = await getUserApiKey(userId, 'codex_subscription');
  if (!resolved?.apiKey) return null;

  const client = createOpenAI({
    apiKey: 'codex-oauth-placeholder', // replaced per-request by makeCodexFetch
    baseURL: CHATGPT_BACKEND_BASE,
    fetch: makeCodexFetch(userId, modelId),
  });
  return client.responses(modelId);
}
