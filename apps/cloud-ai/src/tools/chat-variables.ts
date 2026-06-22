/**
 * Chat Variables — store-by-reference for large payloads.
 *
 * Token problem this solves: a tool that emits a big blob (base64 image/audio,
 * a long file read, a fat API dump, a screenshot) otherwise lands in the model's
 * message history and is re-sent on every subsequent step. `sanitizeToolResultForModel`
 * in meta-tools.ts already *redacted* such payloads, but redaction is lossy — the
 * bytes were gone, so the agent couldn't pass them onward (e.g. to image-gen or a
 * send-media tool).
 *
 * Here we make the same trick non-lossy and bidirectional:
 *   - captureLargeOutputs(): oversized strings/fields are stored under an auto
 *     handle (img_1, audio_1, blob_1) and the model sees `{ _ref: "{{var:img_1}}", … }`.
 *   - resolveVarRefs(): before a tool runs, any arg equal to or containing
 *     `{{var:NAME}}` is rehydrated to the stored raw value.
 *   - the `variables` tool lets the agent deliberately set/get/list/delete values.
 *
 * The store is per-conversation (keyed off bridge secrets) and cloud-side, so it
 * works on desktop, VM, and web chat alike — unlike the desktop-bridge,
 * workflow-scoped tools in device/variables.ts.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeSecrets } from './bridge';
import { geminiSafeJsonValue } from './zod-utils';

// ─── Tuning ──────────────────────────────────────────────────────────────────

/** A string/field this long (and base64/data-URL-shaped) is captured to a handle. */
const BLOB_MIN_CHARS = 2000;
/** Cap entries per conversation so a runaway agent can't grow the store unbounded. */
const MAX_VARS_PER_CONV = 256;
const PREVIEW_LEN = 96;

/** Field names that conventionally carry binary payloads (mirrors meta-tools BINARY_PAYLOAD_KEYS). */
const BINARY_PAYLOAD_KEYS = new Set([
  '_b64', 'b64', 'base64', 'base64Data', 'data', 'imageB64', 'audioData', 'content',
]);

/** Matches a variable handle. Captures the name. */
const VAR_REF_RE = /\{\{var:([a-zA-Z0-9_.-]+)\}\}/g;

// ─── Store ───────────────────────────────────────────────────────────────────

export interface VarEntry {
  value: any;
  type: string;
  bytes: number;
  kind: string;
  preview: string;
  updatedAt: string;
}

const store = new Map<string, Map<string, VarEntry>>();
const autoCounters = new Map<string, number>();

function bucket(convKey: string): Map<string, VarEntry> {
  let m = store.get(convKey);
  if (!m) {
    m = new Map<string, VarEntry>();
    store.set(convKey, m);
  }
  return m;
}

function safeSecrets(): any {
  try { return getBridgeSecrets(); } catch { return undefined; }
}

/** Resolve the per-conversation store key from bridge secrets (or an explicit bag). */
export function conversationKeyFromSecrets(secrets?: any): string {
  const s = secrets ?? safeSecrets();
  const conv = typeof s?.conversationId === 'string' && s.conversationId.trim() ? s.conversationId.trim() : '';
  if (conv) return `conv:${conv}`;
  const req = typeof s?.__requestId === 'string' && s.__requestId.trim() ? s.__requestId.trim() : '';
  if (req) return `req:${req}`;
  return '__default';
}

function detectType(value: any): string {
  if (Array.isArray(value)) return 'list';
  if (value === null) return 'null';
  return typeof value;
}

function byteLen(value: any): number {
  if (typeof value === 'string') {
    // base64-ish strings decode to ~3/4 their length; otherwise utf8 byte length.
    if (value.length > 256 && /^[A-Za-z0-9+/=_-]+$/.test(value.slice(0, 256))) {
      return Math.ceil((value.length * 3) / 4);
    }
    try { return Buffer.byteLength(value, 'utf8'); } catch { return value.length; }
  }
  try { return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8'); } catch { return 0; }
}

function previewOf(value: any): string {
  const s = typeof value === 'string' ? value : (() => { try { return JSON.stringify(value); } catch { return String(value); } })();
  return s.length > PREVIEW_LEN ? `${s.slice(0, PREVIEW_LEN)}…` : s;
}

/** Set (or overwrite) a named variable. */
export function setVar(convKey: string, name: string, value: any, type?: string): VarEntry {
  const m = bucket(convKey);
  if (!m.has(name) && m.size >= MAX_VARS_PER_CONV) {
    // Evict the oldest entry to make room.
    const oldest = [...m.entries()].sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt))[0];
    if (oldest) m.delete(oldest[0]);
  }
  const entry: VarEntry = {
    value,
    type: type || detectType(value),
    bytes: byteLen(value),
    kind: type || detectType(value),
    preview: previewOf(value),
    updatedAt: new Date().toISOString(),
  };
  m.set(name, entry);
  return entry;
}

export function getVar(convKey: string, name: string): VarEntry | undefined {
  return store.get(convKey)?.get(name);
}

export function listVars(convKey: string): Array<{ name: string; type: string; bytes: number; kind: string; preview: string; updatedAt: string }> {
  const m = store.get(convKey);
  if (!m) return [];
  return [...m.entries()].map(([name, e]) => ({
    name, type: e.type, bytes: e.bytes, kind: e.kind, preview: e.preview, updatedAt: e.updatedAt,
  }));
}

export function deleteVar(convKey: string, name: string): boolean {
  return store.get(convKey)?.delete(name) ?? false;
}

/** Drop all variables for a conversation (call on conversation end / reset). */
export function clearConversationVars(convKey: string): void {
  store.delete(convKey);
  autoCounters.delete(convKey);
}

function nextHandle(convKey: string, kind: string): string {
  const n = (autoCounters.get(convKey) ?? 0) + 1;
  autoCounters.set(convKey, n);
  return `${kind}_${n}`;
}

// ─── Reference resolution (args in) ──────────────────────────────────────────

function looksLikeRef(str: string): boolean {
  VAR_REF_RE.lastIndex = 0;
  return VAR_REF_RE.test(str);
}

/**
 * Deep-walk a tool's input args and rehydrate `{{var:NAME}}` handles:
 *  - a string that is EXACTLY one handle → the raw stored value (may be non-string),
 *  - a string with embedded handle(s) → each handle replaced by the stringified value.
 * Unknown handles are left untouched so the model can see and correct the mistake.
 */
export function resolveVarRefs(convKey: string, args: any): any {
  const m = store.get(convKey);
  if (!m || m.size === 0) return args;

  const walk = (val: any): any => {
    if (typeof val === 'string') {
      VAR_REF_RE.lastIndex = 0;
      const exact = val.match(/^\{\{var:([a-zA-Z0-9_.-]+)\}\}$/);
      if (exact) {
        const entry = m.get(exact[1]);
        return entry ? entry.value : val;
      }
      if (!looksLikeRef(val)) return val;
      return val.replace(VAR_REF_RE, (whole, name) => {
        const entry = m.get(name);
        if (!entry) return whole;
        return typeof entry.value === 'string' ? entry.value : (() => { try { return JSON.stringify(entry.value); } catch { return whole; } })();
      });
    }
    if (Array.isArray(val)) return val.map(walk);
    if (val && typeof val === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) out[k] = walk(v);
      return out;
    }
    return val;
  };

  return walk(args);
}

// ─── Large-output capture (result out) ───────────────────────────────────────

function isBigBase64(str: string): boolean {
  return str.length > BLOB_MIN_CHARS && /^[A-Za-z0-9+/=_-]+$/.test(str.slice(0, BLOB_MIN_CHARS));
}
function isBigDataUrl(str: string): boolean {
  return str.startsWith('data:') && str.length > BLOB_MIN_CHARS;
}

function kindFromHint(hint: string, value: string): string {
  const h = hint.toLowerCase();
  if (h.includes('image') || h.includes('img') || value.startsWith('data:image')) return 'img';
  if (h.includes('audio') || value.startsWith('data:audio')) return 'audio';
  if (h.includes('video') || value.startsWith('data:video')) return 'video';
  return 'blob';
}

function makeHandleRef(convKey: string, kind: string, value: string) {
  const name = nextHandle(convKey, kind);
  const entry = setVar(convKey, name, value, kind);
  return {
    _ref: `{{var:${name}}}`,
    kind,
    bytes: entry.bytes,
    preview: `[stored ${kind} ${entry.bytes} bytes as {{var:${name}}} — pass this handle to another tool instead of the raw value]`,
  };
}

/**
 * Walk a tool result and swap oversized base64/data-URL payloads for reusable
 * handles. Non-oversized data passes through untouched. This both shrinks the
 * model's context AND keeps the payload retrievable via its `{{var:…}}` handle.
 */
export function captureLargeOutputs(convKey: string, value: any): any {
  if (typeof value === 'string') {
    if (isBigBase64(value) || isBigDataUrl(value)) {
      return makeHandleRef(convKey, kindFromHint('', value), value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => captureLargeOutputs(convKey, item));
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (BINARY_PAYLOAD_KEYS.has(key) && typeof child === 'string' && (isBigBase64(child) || isBigDataUrl(child))) {
      out[key] = makeHandleRef(convKey, kindFromHint(key, child), child);
      continue;
    }
    out[key] = captureLargeOutputs(convKey, child);
  }
  return out;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

/**
 * The `variables` chat tool. Bind a conversation key at build time when ALS may
 * be unreliable (orchestrator), or omit it to resolve from bridge secrets at
 * execute time (subagents / execute_tool, where secrets are always pushed).
 */
export function createVariablesTool(boundConvKey?: string) {
  return createTool({
    id: 'variables',
    description:
      'Store and recall values by name within this conversation, so large payloads stay OUT of the chat context. ' +
      'Use `set` to stash a value (e.g. a base64 image, a long document, an API response) under a name, then pass it to ' +
      'another tool by reference as the string "{{var:NAME}}" — the value is rehydrated right before that tool runs. ' +
      'Large tool outputs are auto-stored and returned to you as { _ref: "{{var:NAME}}" } handles; reuse the handle directly. ' +
      'Actions: set {name,value,type?} · get {name} · list · delete {name}. Prefer passing handles over calling get (get reloads the full value into context).',
    inputSchema: z.object({
      action: z.enum(['set', 'get', 'list', 'delete']).describe('Operation to perform.'),
      name: z.string().optional().describe('Variable name (required for set/get/delete).'),
      // NB: must NOT be a bare z.any() — that emits a type-less property which
      // Gemini's tool-schema validator rejects on the OpenRouter→Google path.
      // geminiSafeJsonValue() keeps "store any value" while staying Gemini-safe.
      value: geminiSafeJsonValue()
        .optional()
        .describe('Value to store (required for set). May itself contain {{var:…}} refs.'),
      type: z.enum(['string', 'number', 'boolean', 'list', 'object']).optional().describe('Optional explicit type (auto-detected if omitted).'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      action: z.string(),
      name: z.string().optional(),
      ref: z.string().optional(),
      value: z.any().optional(),
      variables: z.array(z.any()).optional(),
      error: z.string().optional(),
    }),
    execute: async (input: any) => {
      const convKey = boundConvKey ?? conversationKeyFromSecrets();
      const action = String(input?.action || '');
      const name = typeof input?.name === 'string' ? input.name.trim() : '';

      if (action === 'set') {
        if (!name) return { ok: false, action, error: 'name is required for set' };
        const entry = setVar(convKey, name, input?.value, input?.type);
        return { ok: true, action, name, ref: `{{var:${name}}}`, value: { kind: entry.kind, bytes: entry.bytes, preview: entry.preview } };
      }
      if (action === 'get') {
        if (!name) return { ok: false, action, error: 'name is required for get' };
        const entry = getVar(convKey, name);
        if (!entry) return { ok: false, action, name, error: `No variable named "${name}"` };
        return { ok: true, action, name, value: entry.value };
      }
      if (action === 'list') {
        return { ok: true, action, variables: listVars(convKey) };
      }
      if (action === 'delete') {
        if (!name) return { ok: false, action, error: 'name is required for delete' };
        return { ok: deleteVar(convKey, name), action, name };
      }
      return { ok: false, action, error: `Unknown action "${action}"` };
    },
  });
}

/** Static instance for the execution universe / registry (resolves conv key at execute). */
export const variablesTool = createVariablesTool();

/**
 * Wrap a tool so its args are var-resolved on the way IN and oversized outputs
 * are captured to handles on the way OUT. Apply as the OUTERMOST layer (after
 * wrapToolWithBridge), because local tools are dispatched by id inside the bridge
 * wrapper and never re-enter this execute otherwise. The `variables` tool itself
 * is left unwrapped so `get` can return a full value on demand.
 */
export function wrapToolWithVariables(tool: any, boundConvKey?: string): any {
  if (!tool || typeof tool.execute !== 'function') return tool;
  const id = tool.id || tool.name || '';
  if (id === 'variables') return tool;

  const originalExecute = tool.execute.bind(tool);
  return createTool({
    id,
    description: tool.description || '',
    inputSchema: tool.inputSchema || tool.parameters || z.any(),
    outputSchema: tool.outputSchema || z.any(),
    execute: async (args: any, ctx: any) => {
      const convKey = boundConvKey ?? conversationKeyFromSecrets();
      const resolvedArgs = resolveVarRefs(convKey, args);
      const result = await originalExecute(resolvedArgs, ctx);
      return captureLargeOutputs(convKey, result);
    },
  });
}
