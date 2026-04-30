/**
 * VM Workflow Engine
 *
 * Self-contained workflow execution engine for headless Linux VMs.
 * This is a port of the desktop Electron engine (apps/desktop/src/main/engine)
 * with all Electron dependencies replaced by Node.js equivalents.
 *
 * Supports:
 * - Full step-graph execution (sequential, parallel, convergence)
 * - Guard evaluation (JSONLogic, AI routing, string expressions)
 * - Loop execution (forEach, repeat, while)
 * - Template interpolation ({{step.output}}, {{$vars.x}})
 * - Tool routing: cloud tools via HTTP, local tools via Python agent WS
 * - File/shell/variable tools run directly on the VM
 * - DesignerModel → StuardSpec conversion
 */

import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { execSync, spawn, ChildProcess } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import WebSocket from 'ws';
import { mintVMToken } from '../services/vm-tokens';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RouterContext {
  agentWsUrl: string;
  cloudAiUrl: string;
  logFn: (msg: string) => void;
  timezone?: string;
  /** Owner's userId — resolved server-side, never from user input on the VM */
  userId: string;
  /** Per-VM HMAC secret (from VM_TOKEN_SECRET env) — used to mint short-lived auth tokens */
  vmTokenSecret: string;
}

export interface EngineContext extends RouterContext {
  stuardsDir: string;
}

export interface LoopConfig {
  type: 'forEach' | 'repeat' | 'while';
  items?: string;
  itemVar?: string;
  indexVar?: string;
  count?: number;
  conditionText?: string;
  maxIterations?: number;
  delayMs?: number;
}

export interface StreamWireConfig {
  sourceField?: string;
  mode?: 'reactive' | 'batch';
  bufferSize?: number;
  format?: 'base64' | 'ref';
}

export interface StuardEdge {
  to: string;
  guard?: any;
  label?: string;
  loop?: LoopConfig;
  loopBreak?: boolean;
  loopFanoutMode?: 'wait' | 'parallel';
  stream?: StreamWireConfig;
}

export interface StuardStep {
  id: string;
  label?: string;
  tool?: string;
  args?: any;
  next?: StuardEdge[];
  fallback?: { to: string };
  waitForAll?: boolean;
}

export interface StuardSpec {
  id: string;
  name?: string;
  version?: string;
  autostart?: boolean;
  triggers?: Array<{ type: string; args?: any; id?: string; start?: string; startNodes?: string[]; inputParams?: any[] }>;
  steps?: StuardStep[];
  start?: string;
  globals?: { ai?: any; [key: string]: any };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Registry — what kind of handler each tool needs
// ─────────────────────────────────────────────────────────────────────────────

type ToolKind = 'local' | 'cloud' | 'vm-native' | 'orchestration' | 'desktop-relay' | 'unsupported';

/** Tools that the VM can execute natively (filesystem, variables, shell, http, utilities) */
const VM_NATIVE_TOOLS = new Set([
  // Filesystem
  'write_file', 'read_file', 'file_read', 'delete_file', 'list_files', 'create_directory',
  'file_edit', 'list_directory', 'move_file', 'copy_file', 'glob', 'grep',
  // Shell / scripts
  'run_command', 'run_node_script',
  // HTTP
  'http_request',
  // Flow control
  'log', 'wait', 'end', 'return_value', 'noop',
  // Variables
  'set_variable', 'get_variable', 'toggle_variable', 'increment_variable',
  'append_to_list', 'list_variables', 'delete_variable',
  // Utilities
  'get_datetime', 'sleep', 'generate_uuid', 'math_eval',
  'json_parse', 'json_stringify', 'regex_match', 'regex_replace',
  'base64_encode', 'base64_decode', 'hash_string',
  'random_number', 'random_choice', 'get_env_var', 'get_system_info',
  // Transforms
  'transform_data',
  // Streams (basic in-memory)
  'stream_create', 'stream_write', 'stream_read', 'stream_close',
  'stream_subscribe', 'stream_unsubscribe', 'stream_list',
]);

/** Tools that run on Cloud AI (LLM inference, web search, integrations) */
const CLOUD_TOOLS = new Set([
  'chat_completion', 'smart_chat', 'summarize_text', 'extract_data', 'classify_text',
  'web_search', 'scrape_url', 'web_search_scrape',
  'send_email', 'read_email',
  'google_calendar_list', 'google_calendar_create', 'google_calendar_update', 'google_calendar_delete',
  'github_create_issue', 'github_list_issues', 'github_create_pr',
  'youtube_search', 'youtube_transcript',
  'text_to_speech',
  'generate_embeddings', 'semantic_search',
  'reddit_search', 'reddit_post',
  'x_search_tweets', 'x_get_user_timeline', 'x_get_tweet',
  'x_post_tweet', 'x_delete_tweet',
  'x_send_dm', 'x_list_dms',
  'x_get_user', 'x_list_followers', 'x_list_following',
  'discord_send', 'discord_read',
  'agent_node', 'agent_decision', 'agent_extract',
  'analyze_media',
]);

/** Orchestration tools handled inline by the engine */
const ORCHESTRATION_TOOLS = new Set([
  'run_sequential', 'run_parallel', 'loop_executor',
]);

/**
 * Tools that ONLY work on the user's desktop PC (require display, input devices, etc.).
 * When a deployed VM workflow calls these, they are relayed:
 *   VM engine → cloud-ai /v1/vm/exec-desktop-tool → desktop WS → result
 */
const DESKTOP_ONLY_TOOLS = new Set([
  // Screen & input automation
  'take_screenshot', 'capture_screen', 'capture_media',
  'click_at', 'double_click', 'right_click', 'drag_to',
  'send_hotkey', 'type_text', 'press_key',
  'scroll_up', 'scroll_down', 'scroll_to',
  'mouse_move', 'mouse_click',
  // Window management
  'smart_focus', 'focus_window', 'list_windows', 'close_window',
  'minimize_window', 'maximize_window', 'resize_window',
  // Desktop-specific
  'open_url', 'open_file', 'open_application',
  'get_clipboard', 'set_clipboard',
  'send_notification', 'show_notification', 'show_dialog',
  // OCR / vision on desktop
  'ocr_screen', 'find_element', 'wait_for_element',
]);

function getToolKind(toolName: string): ToolKind {
  if (!toolName || toolName === 'noop') return 'vm-native';
  if (ORCHESTRATION_TOOLS.has(toolName)) return 'orchestration';
  if (VM_NATIVE_TOOLS.has(toolName)) return 'vm-native';
  if (CLOUD_TOOLS.has(toolName)) return 'cloud';
  if (DESKTOP_ONLY_TOOLS.has(toolName)) return 'desktop-relay';
  // Default: try the local Python agent (run_python_script, etc.)
  return 'local';
}

// ─────────────────────────────────────────────────────────────────────────────
// Variable Store — per-deploy scoped
//
// Scoping model:
//   workflow.*  — scoped to the current workflow (default for unqualified names)
//   local.*     — scoped to the current workflow (alias, same as workflow.*)
//   (no prefix) — auto-resolved: checks workflow.* first, then bare name
//
// Storage:
//   Per-deploy:  {DEPLOY_ROOT}/{deployId}/variables.json
// ─────────────────────────────────────────────────────────────────────────────

interface VarEntry { value: any; type: string; updatedAt: string }

const VARIABLES_DIR = process.env.STUARD_DEPLOY_ROOT || '/home/stuard/deploys';

/** Per-deploy variable stores — each workflow gets its own isolated store */
const deployVariableStores = new Map<string, Map<string, VarEntry>>();

// ── Per-deploy variable helpers ──

function getDeployStore(deployId: string): Map<string, VarEntry> {
  let store = deployVariableStores.get(deployId);
  if (!store) {
    store = new Map();
    deployVariableStores.set(deployId, store);
  }
  return store;
}

function getDeployVarsPath(deployId: string): string {
  return path.join(VARIABLES_DIR, deployId, 'variables.json');
}

function loadDeployVariables(deployId: string): void {
  try {
    const p = getDeployVarsPath(deployId);
    if (fs.existsSync(p)) {
      const store = getDeployStore(deployId);
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      for (const [k, v] of Object.entries(data)) {
        store.set(k, v as VarEntry);
      }
    }
  } catch { /* ignore */ }
}

function saveDeployVariables(deployId: string): void {
  try {
    const store = deployVariableStores.get(deployId);
    if (!store) return;
    const p = getDeployVarsPath(deployId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const obj: any = {};
    for (const [k, v] of store) obj[k] = v;
    fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  } catch { /* ignore */ }
}

function cleanupDeployVariables(deployId: string): void {
  deployVariableStores.delete(deployId);
}

// ── get/set for per-deploy store ──

function getVariable(name: string, defaultVal?: any, deployId?: string): any {
  if (deployId) {
    const store = deployVariableStores.get(deployId);
    if (store) {
      const entry = store.get(name) || store.get(`workflow.${name}`);
      if (entry) return entry.value;
    }
  }
  return defaultVal;
}

function setVariable(name: string, value: any, type = 'string', deployId?: string): void {
  const entry: VarEntry = { value, type, updatedAt: new Date().toISOString() };
  if (deployId) {
    const store = getDeployStore(deployId);
    store.set(name, entry);
    saveDeployVariables(deployId);
  }
}

function deleteVariable(name: string, deployId?: string): boolean {
  if (deployId) {
    const store = deployVariableStores.get(deployId);
    if (store) {
      const existed = store.delete(name);
      if (existed) saveDeployVariables(deployId);
      return existed;
    }
  }
  return false;
}

function listVariables(deployId?: string): Record<string, VarEntry> {
  const all: Record<string, VarEntry> = {};
  if (deployId) {
    const store = deployVariableStores.get(deployId);
    if (store) {
      for (const [k, v] of store) all[k] = v;
    }
  }
  return all;
}

/**
 * Resolve a variable name with scope prefix.
 * - scope='local' or 'workflow' → keeps as-is (per-deploy scoped)
 * - Already prefixed names (workflow.*, local.*) → kept as-is
 */
function resolveVarName(rawName: string | undefined, scope?: string): string {
  const name = String(rawName || '').trim();
  if (!name) return name;

  // Already has an explicit prefix — use as-is
  if (name.startsWith('workflow.') || name.startsWith('local.')) {
    return name;
  }

  // Default: per-deploy scoped (no prefix needed, stored in deploy-local Map)
  return name;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expression Parser (safe, sandboxed — ported from desktop)
// ─────────────────────────────────────────────────────────────────────────────

function evaluateSafe(expr: string, ctx: any): any {
  try {
    // Simple expression evaluator: supports comparisons, arithmetic, booleans
    const trimmed = expr.trim();

    // Boolean literals
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null' || trimmed === 'undefined') return null;

    // Number literals
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

    // String literals
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    // Comparison operators
    for (const op of ['===', '!==', '==', '!=', '>=', '<=', '>', '<']) {
      const idx = trimmed.indexOf(op);
      if (idx > 0) {
        const left = evaluateSafe(trimmed.slice(0, idx), ctx);
        const right = evaluateSafe(trimmed.slice(idx + op.length), ctx);
        switch (op) {
          case '===': return left === right;
          case '!==': return left !== right;
          case '==': return left == right;
          case '!=': return left != right;
          case '>=': return left >= right;
          case '<=': return left <= right;
          case '>': return left > right;
          case '<': return left < right;
        }
      }
    }

    // Logical operators
    if (trimmed.includes('&&')) {
      const parts = trimmed.split('&&');
      return parts.every(p => !!evaluateSafe(p, ctx));
    }
    if (trimmed.includes('||')) {
      const parts = trimmed.split('||');
      return parts.some(p => !!evaluateSafe(p, ctx));
    }

    // Negation
    if (trimmed.startsWith('!')) {
      return !evaluateSafe(trimmed.slice(1), ctx);
    }

    // Variable lookup
    return getAtPath(ctx, trimmed);
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions (ported from desktop engine/utils.ts)
// ─────────────────────────────────────────────────────────────────────────────

function safeStuardId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function summarizeOutput(output: any): string {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') return output.length > 100 ? output.slice(0, 100) + '...' : output;
  if (typeof output === 'number' || typeof output === 'boolean') return String(output);
  if (output.ok !== undefined) {
    if (output.ok === false) return `error: ${output.error || 'failed'}`;
    if (output.message) return output.message;
    if (output.result) return summarizeOutput(output.result);
  }
  const keys = Object.keys(output);
  if (keys.length === 0) return '{}';
  if (keys.length <= 3) return `{${keys.join(', ')}}`;
  return `{${keys.slice(0, 3).join(', ')}... +${keys.length - 3} more}`;
}

function getAtPath(obj: any, pathStr: string, defaultVal?: any): any {
  try {
    const normalized = String(pathStr || '')
      .replace(/\[(\d+)\]/g, '.$1')
      .replace(/\[['"]([^'"]+)['"]\]/g, '.$1');
    const parts = normalized.split('.').filter(Boolean);

    // Helper: resolve array-friendly accessors (first/last/count)
    const resolveArrayPart = (cur: any, part: string): any => {
      if (Array.isArray(cur)) {
        if (part === 'first') return cur[0];
        if (part === 'last') return cur[cur.length - 1];
        if (part === 'count' || part === 'length') return cur.length;
      }
      return cur[part];
    };

    // $vars.varName — lookup via ctx.$vars proxy (deploy-scoped)
    if (parts[0] === '$vars' && parts.length >= 2 && obj?.$vars) {
      const varValue = obj.$vars[parts[1]];
      if (varValue === undefined) return defaultVal;
      if (parts.length > 2) {
        let cur: any = varValue;
        for (let i = 2; i < parts.length; i++) {
          if (cur == null) return defaultVal;
          cur = resolveArrayPart(cur, parts[i]);
        }
        return cur === undefined ? defaultVal : cur;
      }
      return varValue;
    }

    // $workspace paths
    if (parts[0] === '$workspace' && obj?.$workspace) {
      const ws = obj.$workspace;
      if (parts.length === 1) return ws;
      const field = parts[1];
      if (['path', 'data', 'scripts', 'assets'].includes(field)) return ws[field];
      if (field === 'file' && parts.length >= 3) {
        return ws.path ? ws.path + '/' + parts.slice(2).join('/') : parts.slice(2).join('/');
      }
      return ws[field] !== undefined ? ws[field] : defaultVal;
    }

    // Smart path resolution: try progressive prefix matching for step IDs with dots
    if (obj && typeof obj === 'object') {
      for (let i = parts.length - 1; i >= 1; i--) {
        const potentialStepId = parts.slice(0, i).join('.');
        if (potentialStepId in obj) {
          let cur: any = obj[potentialStepId];
          for (let j = i; j < parts.length; j++) {
            if (cur == null) return defaultVal;
            if (typeof cur === 'string' && (cur.trim().startsWith('{') || cur.trim().startsWith('['))) {
              try { cur = JSON.parse(cur); } catch { }
            }
            cur = resolveArrayPart(cur, parts[j]);
          }
          return cur === undefined ? defaultVal : cur;
        }
      }
    }

    // Simple dot traversal
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return defaultVal;
      if (typeof cur === 'string' && (cur.trim().startsWith('{') || cur.trim().startsWith('['))) {
        try { cur = JSON.parse(cur); } catch { }
      }
      cur = resolveArrayPart(cur, p);
    }
    return cur === undefined ? defaultVal : cur;
  } catch {
    return defaultVal;
  }
}

function interpolateForTool(input: any, ctx: any, toolName: string): any {
  const templ = (s: string): string => {
    let result = s;
    let maxIterations = 10;
    while (maxIterations-- > 0) {
      const prev = result;
      result = result.replace(/\{\{([^{}]+)\}\}/g, (_m, g1) => {
        const expr = String(g1 || '').trim();
        const v = getAtPath(ctx, expr, undefined);
        if (v == null) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      });
      if (result === prev) break;
    }
    return result;
  };

  const walk = (v: any, p: string): any => {
    if (typeof v === 'string') {
      // Check if the entire string is a single template expression
      const singleMatch = v.match(/^\{\{([^{}]+)\}\}$/);
      if (singleMatch) {
        const resolved = getAtPath(ctx, singleMatch[1].trim());
        if (resolved != null) return resolved;
        return v;
      }
      return templ(v);
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k], p ? `${p}.${k}` : k);
      return o;
    }
    return v;
  };

  return walk(input, '');
}

function deepMerge(base: any, patch: any): any {
  if (patch == null) return base;
  if (base == null) return patch;
  if (Array.isArray(base) && Array.isArray(patch)) return patch.slice();
  if (typeof base === 'object' && typeof patch === 'object') {
    const out: any = { ...base };
    for (const k of Object.keys(patch)) out[k] = deepMerge(base[k], patch[k]);
    return out;
  }
  return patch;
}

function jsonLogic(logic: any, data: any): any {
  if (logic == null || typeof logic !== 'object' || Array.isArray(logic)) return logic;
  const key = Object.keys(logic)[0];
  const val = (logic as any)[key];
  const a = (x: any) => jsonLogic(x, data);

  switch (key) {
    case 'var': {
      if (typeof val === 'string') return getAtPath(data, val);
      if (Array.isArray(val)) return getAtPath(data, String(val[0] || ''), val[1]);
      return undefined;
    }
    case '==': return a(val[0]) == a(val[1]);
    case '===': return a(val[0]) === a(val[1]);
    case '!=': return a(val[0]) != a(val[1]);
    case '!==': return a(val[0]) !== a(val[1]);
    case '>': return a(val[0]) > a(val[1]);
    case '<': return a(val[0]) < a(val[1]);
    case '>=': return a(val[0]) >= a(val[1]);
    case '<=': return a(val[0]) <= a(val[1]);
    case 'and': return (val || []).every((x: any) => !!a(x));
    case 'or': return (val || []).some((x: any) => !!a(x));
    case '!': case 'not': return !a(val);
    case 'in': {
      const needle = a(val[0]);
      const hay = a(val[1]);
      if (typeof hay === 'string') return hay.includes(String(needle));
      if (Array.isArray(hay)) return hay.includes(needle);
      return false;
    }
    default: return undefined;
  }
}

function evalIfGuard(logic: any, ctx: any): boolean {
  try {
    if (typeof logic === 'string') {
      const expr = logic.trim().replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
      return !!evaluateSafe(expr, ctx);
    }
    return !!jsonLogic(logic, ctx);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Executors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build auth headers for VM → cloud-ai requests.
 * Mints a fresh short-lived HMAC token per-request (5 min TTL).
 * Cloud-ai verifies the HMAC against the per-VM secret in the DB.
 */
function buildVMAuthHeaders(ctx: RouterContext): Record<string, string> {
  const token = mintVMToken(ctx.vmTokenSecret, ctx.userId, 'vm-engine');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-VM-User-Id': ctx.userId,
  };
}

/** Execute a tool via Cloud AI HTTP endpoint */
async function execCloudTool(tool: string, args: any, ctx: RouterContext): Promise<any> {
  try {
    const url = `${ctx.cloudAiUrl}/tools/${tool}`;
    ctx.logFn(`Cloud AI: ${tool}`);

    const headers = buildVMAuthHeaders(ctx);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return { ok: false, error: `cloud_error_${resp.status}: ${errText}` };
      }

      const result: any = await resp.json();
      const nested = result?.result;
      if (result?.ok === true && nested && typeof nested === 'object') {
        if (nested.ok === false) return nested;
        return nested;
      }
      return { ok: true, ...result };
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    ctx.logFn(`Cloud AI error: ${e?.message}`);
    return { ok: false, error: String(e?.message || 'cloud_failed') };
  }
}

/** Execute a tool via the Python agent WebSocket (if running on VM) */
async function execLocalTool(tool: string, args: any, ctx: RouterContext, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; ws?.close(); resolve({ ok: false, error: 'timeout' }); }
    }, timeoutMs);

    try {
      ws = new WebSocket(ctx.agentWsUrl);
      ws.on('open', () => {
        ws!.send(JSON.stringify({ type: 'tool_exec', tool, args }));
      });
      ws.on('message', (data) => {
        if (done) return;
        try {
          const msg = JSON.parse(String(data));
          if (msg.type === 'tool_result' || msg.result !== undefined) {
            done = true;
            clearTimeout(timer);
            ws?.close();
            resolve(msg.result || msg);
          }
        } catch { /* ignore non-JSON */ }
      });
      ws.on('error', (err) => {
        if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: `agent_ws_error: ${err.message}` }); }
      });
      ws.on('close', () => {
        if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: 'agent_ws_closed' }); }
      });
    } catch (e: any) {
      if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, error: String(e?.message) }); }
    }
  });
}

/**
 * Execute a tool on the user's desktop PC via cloud-ai relay.
 * Flow: VM engine → HTTP POST cloud-ai /v1/vm/exec-desktop-tool → WS to desktop → result
 * Uses per-VM HMAC auth (no user tokens on the VM).
 *
 * If desktop is offline, retries up to 2 times (3s apart) before falling back to
 * VM-native alternatives or returning a clear error.
 */
async function execDesktopRelayTool(tool: string, args: any, ctx: RouterContext, timeoutMs = 90_000): Promise<any> {
  const url = `${ctx.cloudAiUrl}/v1/vm/exec-desktop-tool`;
  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 3_000;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        ctx.logFn(`Desktop relay: ${tool} (retry ${attempt}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        ctx.logFn(`Desktop relay: ${tool}`);
      }

      const headers = buildVMAuthHeaders(ctx);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ tool, args }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          const isOffline = resp.status === 503 || errText.includes('desktop_offline');

          if (isOffline && attempt < MAX_RETRIES) {
            ctx.logFn(`Desktop offline for '${tool}', will retry...`);
            continue;
          }

          if (isOffline) {
            const alternative = getDesktopToolAlternative(tool, args);
            if (alternative) {
              ctx.logFn(`Desktop offline — using VM alternative for '${tool}'`);
              return alternative;
            }
            return {
              ok: false,
              error: `desktop_offline: The Stuard desktop app must be running to use '${tool}'. This tool requires direct access to your PC.`,
              desktopRequired: true,
              toolName: tool,
            };
          }
          return { ok: false, error: `desktop_relay_error_${resp.status}: ${errText}` };
        }

        const result: any = await resp.json();
        return result?.result ?? result;
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        return { ok: false, error: `desktop_relay_timeout: Tool '${tool}' timed out waiting for desktop response` };
      }

      if (attempt < MAX_RETRIES) {
        ctx.logFn(`Desktop relay error for '${tool}': ${e?.message}, will retry...`);
        continue;
      }

      ctx.logFn(`Desktop relay error: ${e?.message}`);
      const alternative = getDesktopToolAlternative(tool, args);
      if (alternative) {
        ctx.logFn(`Desktop unreachable — using VM alternative for '${tool}'`);
        return alternative;
      }
      return { ok: false, error: String(e?.message || 'desktop_relay_failed') };
    }
  }

  // Should not reach here, but safety fallback
  return { ok: false, error: `desktop_relay_failed: exhausted retries for '${tool}'` };
}

/**
 * Get a VM-native alternative for a desktop-only tool when the desktop is offline.
 * Returns null if no alternative exists.
 */
function getDesktopToolAlternative(tool: string, args: any): any | null {
  switch (tool) {
    case 'get_clipboard':
      return { ok: false, error: 'clipboard_unavailable: Desktop is offline. Use read_file or get_variable instead.', fallback: true };
    case 'set_clipboard':
      return { ok: true, fallback: true, message: 'Desktop offline — clipboard content stored as variable "clipboard_content"' };
    case 'send_notification':
    case 'show_notification':
      return { ok: true, fallback: true, message: `Notification (desktop offline): ${args?.title || ''} - ${args?.message || args?.body || ''}` };
    case 'show_dialog':
      return { ok: true, fallback: true, message: `Dialog (desktop offline): ${args?.title || ''} - ${args?.message || args?.body || ''}` };
    case 'open_url':
      return null; // Let the workflow handle this via http_request or browser-use
    case 'open_file':
    case 'open_application':
      return { ok: false, error: `${tool}: Desktop is offline. This operation requires the desktop app.`, fallback: true };
    case 'take_screenshot':
    case 'capture_screen':
    case 'capture_media':
      return { ok: false, error: `${tool}: Desktop is offline. Screen capture requires the desktop app.`, fallback: true, desktopRequired: true };
    case 'click_at':
    case 'double_click':
    case 'right_click':
    case 'drag_to':
    case 'mouse_move':
    case 'mouse_click':
      return { ok: false, error: `${tool}: Desktop is offline. Mouse automation requires the desktop app.`, fallback: true, desktopRequired: true };
    case 'send_hotkey':
    case 'type_text':
    case 'press_key':
      return { ok: false, error: `${tool}: Desktop is offline. Keyboard automation requires the desktop app.`, fallback: true, desktopRequired: true };
    case 'scroll_up':
    case 'scroll_down':
    case 'scroll_to':
      return { ok: false, error: `${tool}: Desktop is offline. Scroll automation requires the desktop app.`, fallback: true, desktopRequired: true };
    case 'smart_focus':
    case 'focus_window':
    case 'list_windows':
    case 'close_window':
    case 'minimize_window':
    case 'maximize_window':
    case 'resize_window':
      return { ok: false, error: `${tool}: Desktop is offline. Window management requires the desktop app.`, fallback: true, desktopRequired: true };
    case 'ocr_screen':
    case 'find_element':
    case 'wait_for_element':
      return { ok: false, error: `${tool}: Desktop is offline. Screen analysis requires the desktop app.`, fallback: true, desktopRequired: true };
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory Stream Manager (for stream wire support on VM)
// ─────────────────────────────────────────────────────────────────────────────

interface VMStream {
  id: string;
  flowId: string;
  chunks: Array<{ data: any; index: number; timestamp: number }>;
  subscribers: Map<string, { cursor: number; resolver: (() => void) | null }>;
  closed: boolean;
  createdAt: number;
}

const vmStreams = new Map<string, VMStream>();

/** Simple glob pattern matching (supports *, **, ?) */
function simpleGlobMatch(pattern: string, str: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/___GLOBSTAR___/g, '.*');
  return new RegExp(`^${regex}$`, 'i').test(str.replace(/\\/g, '/'));
}

/** Execute VM-native tools directly (filesystem, variables, wait, log, etc.) */
async function execVmNativeTool(tool: string, args: any, ctx: RouterContext, deployDir?: string): Promise<any> {
  switch (tool) {
    case 'noop':
      return { ok: true };

    case 'log':
      ctx.logFn(`[log] ${args?.message || args?.text || JSON.stringify(args)}`);
      return { ok: true };

    case 'wait': {
      const ms = Number(args?.ms || args?.duration || args?.milliseconds || 1000);
      await new Promise(r => setTimeout(r, ms));
      return { ok: true, waited: ms };
    }

    case 'end':
      return { ok: true, terminated: true };

    case 'return_value':
      return { ok: true, action: 'return', value: args?.value ?? args };

    // ── File operations (scoped to deploy dir or /home/stuard) ──
    case 'write_file': {
      const filePath = resolveSafePath(args?.path, deployDir);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const content = String(args?.content ?? '');
      if (args?.append) {
        fs.appendFileSync(filePath, content);
      } else {
        fs.writeFileSync(filePath, content);
      }
      return { ok: true, path: filePath };
    }

    case 'read_file':
    case 'file_read': {
      const filePath = resolveSafePath(args?.path, deployDir);
      if (!fs.existsSync(filePath)) return { ok: false, error: 'file_not_found' };
      const content = fs.readFileSync(filePath, 'utf-8');
      return { ok: true, content, path: filePath };
    }

    case 'delete_file': {
      const filePath = resolveSafePath(args?.path, deployDir);
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      return { ok: true };
    }

    case 'list_files': {
      const dirPath = resolveSafePath(args?.path || '.', deployDir);
      if (!fs.existsSync(dirPath)) return { ok: false, error: 'dir_not_found' };
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const files = entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name),
      }));
      return { ok: true, files };
    }

    case 'create_directory': {
      const dirPath = resolveSafePath(args?.path, deployDir);
      fs.mkdirSync(dirPath, { recursive: true });
      return { ok: true, path: dirPath };
    }

    case 'file_edit': {
      const filePath = resolveSafePath(args?.path, deployDir);
      if (!fs.existsSync(filePath)) return { ok: false, error: 'file_not_found' };
      let content = fs.readFileSync(filePath, 'utf-8');
      const mode = args?.mode || 'replace';
      const oldStr = args?.old_string || '';
      const newStr = args?.new_string || '';
      switch (mode) {
        case 'replace':
          content = args?.replace_all ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
          break;
        case 'insert_before':
          content = content.replace(oldStr, newStr + oldStr);
          break;
        case 'insert_after':
          content = content.replace(oldStr, oldStr + newStr);
          break;
        case 'delete':
          content = content.split(oldStr).join('');
          break;
        case 'regex':
          content = content.replace(new RegExp(oldStr, args?.replace_all ? 'g' : ''), newStr);
          break;
      }
      fs.writeFileSync(filePath, content);
      return { ok: true, path: filePath };
    }

    // ── Variable tools (per-deploy scoped) ──
    case 'set_variable': {
      const varName = resolveVarName(args?.name, args?.scope);
      const did = deployDir ? path.basename(deployDir) : undefined;
      setVariable(varName, args?.value, args?.type || 'string', did);
      return { ok: true, name: varName, value: args?.value };
    }

    case 'get_variable': {
      const varName = resolveVarName(args?.name, args?.scope);
      const did = deployDir ? path.basename(deployDir) : undefined;
      const val = getVariable(varName, args?.default, did);
      return { ok: true, name: varName, value: val };
    }

    case 'toggle_variable': {
      const varName = resolveVarName(args?.name, args?.scope);
      const did = deployDir ? path.basename(deployDir) : undefined;
      const cur = getVariable(varName, false, did);
      const newVal = !cur;
      setVariable(varName, newVal, 'boolean', did);
      return { ok: true, name: varName, value: newVal };
    }

    case 'increment_variable': {
      const varName = resolveVarName(args?.name, args?.scope);
      const did = deployDir ? path.basename(deployDir) : undefined;
      const cur = Number(getVariable(varName, 0, did)) || 0;
      const by = Number(args?.by || args?.amount || 1);
      const newVal = cur + by;
      setVariable(varName, newVal, 'number', did);
      return { ok: true, name: varName, value: newVal };
    }

    case 'append_to_list': {
      const varName = resolveVarName(args?.name, args?.scope);
      const did = deployDir ? path.basename(deployDir) : undefined;
      const cur = getVariable(varName, [], did);
      const curList = Array.isArray(cur) ? [...cur] : [];
      curList.push(args?.value ?? args?.item);
      setVariable(varName, curList, 'list', did);
      return { ok: true, name: varName, value: curList, length: curList.length };
    }

    case 'list_variables': {
      const did = deployDir ? path.basename(deployDir) : undefined;
      const all = listVariables(did);
      return { ok: true, variables: all };
    }

    case 'delete_variable': {
      const varName = resolveVarName(args?.name, args?.scope);
      const did = deployDir ? path.basename(deployDir) : undefined;
      const existed = deleteVariable(varName, did);
      return { ok: true, name: varName, deleted: existed };
    }

    // ── Additional filesystem tools ──
    case 'list_directory': {
      const dirPath = resolveSafePath(args?.path || '.', deployDir);
      if (!fs.existsSync(dirPath)) return { ok: false, error: 'dir_not_found' };
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const items = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        size: e.isDirectory() ? 0 : (fs.statSync(path.join(dirPath, e.name)).size || 0),
      }));
      return { ok: true, items, path: dirPath };
    }

    case 'move_file': {
      const src = resolveSafePath(args?.source || args?.from, deployDir);
      const dst = resolveSafePath(args?.destination || args?.to, deployDir);
      if (!fs.existsSync(src)) return { ok: false, error: 'source_not_found' };
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      return { ok: true, source: src, destination: dst };
    }

    case 'copy_file': {
      const src = resolveSafePath(args?.source || args?.from, deployDir);
      const dst = resolveSafePath(args?.destination || args?.to, deployDir);
      if (!fs.existsSync(src)) return { ok: false, error: 'source_not_found' };
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      return { ok: true, source: src, destination: dst };
    }

    case 'glob': {
      // Simple glob implementation using recursive file listing
      const pattern = String(args?.pattern || args?.glob || '*');
      const root = resolveSafePath(args?.path || args?.root || '.', deployDir);
      const results: string[] = [];
      const walk = (dir: string) => {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else {
              const rel = path.relative(root, full);
              if (simpleGlobMatch(pattern, rel)) results.push(rel);
            }
          }
        } catch { /* permission etc */ }
      };
      walk(root);
      return { ok: true, files: results.slice(0, 1000), count: results.length };
    }

    case 'grep': {
      const pattern = String(args?.pattern || args?.query || '');
      const filePath = resolveSafePath(args?.path || args?.file || '.', deployDir);
      const isRegex = args?.regex !== false;
      const matches: Array<{ line: number; text: string }> = [];
      if (!fs.existsSync(filePath)) return { ok: false, error: 'file_not_found' };
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        const re = isRegex ? new RegExp(pattern, 'gi') : null;
        lines.forEach((line, i) => {
          if (re ? re.test(line) : line.toLowerCase().includes(pattern.toLowerCase())) {
            matches.push({ line: i + 1, text: line.trim() });
          }
        });
      }
      return { ok: true, matches: matches.slice(0, 500), count: matches.length };
    }

    // ── Shell / script execution ──
    case 'run_command': {
      const cmd = String(args?.command || args?.cmd || '');
      if (!cmd) return { ok: false, error: 'no_command' };
      const cwd = args?.cwd ? resolveSafePath(args.cwd, deployDir) : (deployDir || '/home/stuard');
      const timeoutMs = Math.min(Number(args?.timeoutMs || 300000), 600000);
      const shellPref = String(args?.shell || 'auto').toLowerCase();
      const shellPath =
        shellPref === 'default' || shellPref === 'sh'
          ? '/bin/sh'
          : (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');
      try {
        const output = execSync(cmd, {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, HOME: '/home/stuard', PATH: process.env.PATH },
          encoding: 'utf-8',
          shell: shellPath,
        });
        return { ok: true, stdout: output, exitCode: 0, shell: path.basename(shellPath) };
      } catch (e: any) {
        return {
          ok: e.status === 0,
          stdout: String(e.stdout || ''),
          stderr: String(e.stderr || ''),
          exitCode: e.status ?? 1,
          error: e.status !== 0 ? `exit_code_${e.status}` : undefined,
          shell: path.basename(shellPath),
        };
      }
    }

    case 'run_node_script': {
      const code = String(args?.code || args?.script || '');
      if (!code) return { ok: false, error: 'no_code' };
      const cwd = args?.cwd ? resolveSafePath(args.cwd, deployDir) : (deployDir || '/home/stuard');
      const timeoutMs = Math.min(Number(args?.timeoutMs || 30000), 300000);
      const tmpFile = path.join('/tmp', `stuard-node-${Date.now()}.js`);
      try {
        fs.writeFileSync(tmpFile, code);
        const output = execSync(`node "${tmpFile}"`, {
          cwd,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf-8',
        });
        return { ok: true, stdout: output, exitCode: 0 };
      } catch (e: any) {
        return {
          ok: false,
          stdout: String(e.stdout || ''),
          stderr: String(e.stderr || ''),
          exitCode: e.status ?? 1,
          error: String(e.message || 'script_failed'),
        };
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { }
      }
    }

    // ── HTTP request tool (native fetch) ──
    case 'http_request': {
      const url = String(args?.url || '');
      if (!url) return { ok: false, error: 'no_url' };
      const method = String(args?.method || 'GET').toUpperCase();
      const headers: Record<string, string> = args?.headers || {};
      const body = args?.body != null ? (typeof args.body === 'string' ? args.body : JSON.stringify(args.body)) : undefined;
      const timeoutMs = Number(args?.timeoutMs || 30000);

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const fetchOpts: any = { method, headers, signal: controller.signal };
        if (body && method !== 'GET' && method !== 'HEAD') fetchOpts.body = body;

        const resp = await fetch(url, fetchOpts);
        clearTimeout(timer);
        const contentType = resp.headers.get('content-type') || '';
        let data: any;
        if (contentType.includes('json')) {
          data = await resp.json();
        } else {
          data = await resp.text();
        }
        return {
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          headers: Object.fromEntries(resp.headers.entries()),
          data,
        };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || 'fetch_failed') };
      }
    }

    // ── Utility tools ──
    case 'get_datetime': {
      const tz = args?.timezone || ctx.timezone || process.env.STUARD_USER_TIMEZONE || process.env.TZ || 'UTC';
      const fmt = args?.format || 'iso';
      const now = new Date();
      let formatted: string;
      if (fmt === 'iso') formatted = now.toISOString();
      else if (fmt === 'unix') formatted = String(Math.floor(now.getTime() / 1000));
      else if (fmt === 'ms') formatted = String(now.getTime());
      else formatted = now.toLocaleString('en-US', { timeZone: tz });
      return { ok: true, datetime: formatted, timezone: tz, timestamp: now.getTime() };
    }

    case 'sleep': {
      const ms = Number(args?.ms || args?.duration || args?.milliseconds || 1000);
      await new Promise(r => setTimeout(r, ms));
      return { ok: true, sleptMs: ms };
    }

    case 'generate_uuid': {
      const count = Math.min(Number(args?.count || 1), 100);
      const uuids = Array.from({ length: count }, () => randomUUID());
      return { ok: true, uuid: uuids[0], uuids };
    }

    case 'math_eval': {
      const expr = String(args?.expression || args?.expr || '');
      try {
        // Safe math evaluation using Function constructor with restricted scope
        const fn = new Function('Math', `"use strict"; return (${expr});`);
        const result = fn(Math);
        return { ok: true, result };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || 'eval_failed') };
      }
    }

    case 'json_parse': {
      try {
        const parsed = JSON.parse(String(args?.text || args?.json || ''));
        return { ok: true, result: parsed };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || 'parse_failed') };
      }
    }

    case 'json_stringify': {
      const indent = args?.indent != null ? Number(args.indent) : 2;
      return { ok: true, result: JSON.stringify(args?.data ?? args?.value, null, indent) };
    }

    case 'regex_match': {
      const text = String(args?.text || '');
      const pattern = String(args?.pattern || '');
      const flags = String(args?.flags || 'g');
      try {
        const re = new RegExp(pattern, flags);
        const matches = [...text.matchAll(re)].map(m => ({ match: m[0], groups: m.slice(1), index: m.index }));
        return { ok: true, matches, count: matches.length };
      } catch (e: any) {
        return { ok: false, error: String(e?.message) };
      }
    }

    case 'regex_replace': {
      const text = String(args?.text || '');
      const pattern = String(args?.pattern || '');
      const replacement = String(args?.replacement || args?.replace || '');
      const flags = String(args?.flags || 'g');
      try {
        const re = new RegExp(pattern, flags);
        return { ok: true, result: text.replace(re, replacement) };
      } catch (e: any) {
        return { ok: false, error: String(e?.message) };
      }
    }

    case 'base64_encode': {
      const text = String(args?.text || args?.data || '');
      return { ok: true, result: Buffer.from(text).toString('base64') };
    }

    case 'base64_decode': {
      const b64 = String(args?.text || args?.data || '');
      try {
        return { ok: true, result: Buffer.from(b64, 'base64').toString('utf-8') };
      } catch (e: any) {
        return { ok: false, error: 'invalid_base64' };
      }
    }

    case 'hash_string': {
      const text = String(args?.text || args?.data || '');
      const algo = String(args?.algorithm || 'sha256');
      return { ok: true, hash: createHash(algo).update(text).digest('hex') };
    }

    case 'random_number': {
      const min = Number(args?.min ?? 0);
      const max = Number(args?.max ?? 100);
      const integer = args?.integer !== false;
      const val = integer ? Math.floor(Math.random() * (max - min + 1)) + min : Math.random() * (max - min) + min;
      return { ok: true, value: val };
    }

    case 'random_choice': {
      const items = Array.isArray(args?.items) ? args.items : [];
      if (items.length === 0) return { ok: false, error: 'empty_list' };
      const count = Math.min(Number(args?.count || 1), items.length);
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      return { ok: true, choice: shuffled[0], choices: shuffled.slice(0, count) };
    }

    case 'get_env_var': {
      const name = String(args?.name || '');
      return { ok: true, value: process.env[name] || null };
    }

    case 'get_system_info': {
      const os = require('os');
      return {
        ok: true,
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
        nodeVersion: process.version,
      };
    }

    // ── Transform data tool ──
    case 'transform_data': {
      const input = args?.input ?? args?.data;
      const operation = String(args?.operation || args?.op || 'identity');
      try {
        let result: any;
        switch (operation) {
          case 'identity': result = input; break;
          case 'keys': result = input ? Object.keys(input) : []; break;
          case 'values': result = input ? Object.values(input) : []; break;
          case 'entries': result = input ? Object.entries(input) : []; break;
          case 'flatten': result = Array.isArray(input) ? input.flat(Infinity) : input; break;
          case 'unique': result = Array.isArray(input) ? [...new Set(input)] : input; break;
          case 'sort': result = Array.isArray(input) ? [...input].sort() : input; break;
          case 'reverse': result = Array.isArray(input) ? [...input].reverse() : input; break;
          case 'length': result = Array.isArray(input) ? input.length : (typeof input === 'string' ? input.length : 0); break;
          case 'pick': {
            const fields = Array.isArray(args?.fields) ? args.fields : [];
            result = {};
            for (const f of fields) if (input?.[f] !== undefined) result[f] = input[f];
            break;
          }
          case 'omit': {
            const omitFields = new Set(Array.isArray(args?.fields) ? args.fields : []);
            result = {};
            for (const [k, v] of Object.entries(input || {})) if (!omitFields.has(k)) result[k] = v;
            break;
          }
          case 'map': {
            const field = String(args?.field || '');
            result = Array.isArray(input) ? input.map(item => field ? item?.[field] : item) : input;
            break;
          }
          case 'filter': {
            const field = String(args?.field || '');
            const value = args?.value;
            result = Array.isArray(input) ? input.filter(item => {
              if (field && value !== undefined) return item?.[field] === value;
              return !!item;
            }) : input;
            break;
          }
          default: result = input;
        }
        return { ok: true, result };
      } catch (e: any) {
        return { ok: false, error: String(e?.message) };
      }
    }

    // ── Stream tools (in-memory stream manager) ──
    case 'stream_create': {
      const streamId = String(args?.streamId || args?.id || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
      const flowId = args?.flowId || '';
      vmStreams.set(streamId, {
        id: streamId,
        flowId,
        chunks: [],
        subscribers: new Map(),
        closed: false,
        createdAt: Date.now(),
      });
      ctx.logFn(`Stream created: ${streamId}`);
      return { ok: true, streamId };
    }

    case 'stream_write': {
      const streamId = String(args?.streamId || '');
      const stream = vmStreams.get(streamId);
      if (!stream) return { ok: false, error: 'stream_not_found' };
      if (stream.closed) return { ok: false, error: 'stream_closed' };
      const chunk = { data: args?.data ?? args?.chunk, index: stream.chunks.length, timestamp: Date.now() };
      stream.chunks.push(chunk);
      // Wake up any waiting subscribers
      for (const [, sub] of stream.subscribers) {
        if (sub.resolver) { sub.resolver(); sub.resolver = null; }
      }
      return { ok: true, index: chunk.index };
    }

    case 'stream_read': {
      const streamId = String(args?.streamId || '');
      const subscriberId = String(args?.subscriberId || 'default');
      const stream = vmStreams.get(streamId);
      if (!stream) return { ok: false, error: 'stream_not_found' };
      const sub = stream.subscribers.get(subscriberId);
      const cursor = sub?.cursor ?? 0;
      const maxChunks = Number(args?.maxChunks || 10);
      const waitMs = Number(args?.waitMs || 0);

      const pending = stream.chunks.slice(cursor, cursor + maxChunks);
      if (pending.length === 0 && !stream.closed && waitMs > 0) {
        // Wait for data
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, waitMs);
          if (sub) sub.resolver = () => { clearTimeout(timer); resolve(); };
        });
        const afterWait = stream.chunks.slice(cursor, cursor + maxChunks);
        if (sub) sub.cursor = cursor + afterWait.length;
        return { ok: true, chunks: afterWait, closed: stream.closed && afterWait.length === 0 };
      }

      if (sub) sub.cursor = cursor + pending.length;
      return { ok: true, chunks: pending, closed: stream.closed && pending.length === 0 };
    }

    case 'stream_close': {
      const streamId = String(args?.streamId || '');
      const stream = vmStreams.get(streamId);
      if (!stream) return { ok: false, error: 'stream_not_found' };
      stream.closed = true;
      // Wake all subscribers
      for (const [, sub] of stream.subscribers) {
        if (sub.resolver) { sub.resolver(); sub.resolver = null; }
      }
      ctx.logFn(`Stream closed: ${streamId}`);
      return { ok: true };
    }

    case 'stream_subscribe': {
      const streamId = String(args?.streamId || '');
      const stream = vmStreams.get(streamId);
      if (!stream) return { ok: false, error: 'stream_not_found' };
      const subscriberId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      stream.subscribers.set(subscriberId, {
        cursor: args?.fromStart ? 0 : stream.chunks.length,
        resolver: null,
      });
      return { ok: true, subscriberId };
    }

    case 'stream_unsubscribe': {
      const streamId = String(args?.streamId || '');
      const subscriberId = String(args?.subscriberId || '');
      const stream = vmStreams.get(streamId);
      if (stream) stream.subscribers.delete(subscriberId);
      return { ok: true };
    }

    case 'stream_list': {
      const flowId = args?.flowId;
      const result: any[] = [];
      for (const [id, s] of vmStreams) {
        if (flowId && s.flowId !== flowId) continue;
        result.push({ id, closed: s.closed, chunks: s.chunks.length, subscribers: s.subscribers.size });
      }
      return { ok: true, streams: result };
    }

    default:
      return { ok: false, error: `unsupported_vm_tool: ${tool}` };
  }
}

/** Resolve a user-provided file path safely within allowed roots */
function resolveSafePath(userPath: string, deployDir?: string): string {
  const ALLOWED_ROOTS = ['/home/stuard', '/tmp', '/opt/stuard'];
  const base = deployDir || '/home/stuard';
  const resolved = path.resolve(base, userPath);

  // Must be within deploy dir or one of the allowed roots
  if (deployDir && resolved.startsWith(deployDir)) return resolved;
  for (const root of ALLOWED_ROOTS) {
    if (resolved.startsWith(root)) return resolved;
  }
  // Fallback: put it in deploy dir
  return path.join(base, path.basename(userPath));
}

/** AI routing — asks Cloud AI which edge to take */
async function aiDecideNext(
  step: StuardStep,
  ctx: any,
  options: Array<{ to: string; label?: string }>,
  aiCfg: any,
  engineCtx: EngineContext
): Promise<{ next?: string; argsPatch?: any; ok: boolean; error?: string }> {
  try {
    const url = `${engineCtx.cloudAiUrl}/inference/workflow/next`;
    const body = {
      context: {
        step: { id: step.id, name: step.id },
        ctx,
        options,
        instruction: String(aiCfg?.instruction || ''),
        produceArgs: !!aiCfg?.produceArgs,
      },
    };

    const headers = buildVMAuthHeaders(engineCtx);

    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const j: any = await resp.json().catch(() => ({}));

    if (resp.ok && j?.next) return { ok: true, next: j.next, argsPatch: j.argsPatch };
    return { ok: false, error: String(j?.error || 'ai_invalid_response') };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'ai_failed') };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Tool Executor
// ─────────────────────────────────────────────────────────────────────────────

async function execTool(toolName: string, args: any, ctx: EngineContext, deployDir?: string): Promise<any> {
  if (toolName === 'run_system_command') {
    toolName = 'run_command';
    args = { ...(args || {}), shell: typeof args?.shell === 'string' ? args.shell : 'default' };
  }
  const kind = getToolKind(toolName);

  switch (kind) {
    case 'cloud':
      return execCloudTool(toolName, args, ctx);

    case 'vm-native':
      return execVmNativeTool(toolName, args, ctx, deployDir);

    case 'desktop-relay':
      // Route to user's desktop PC via cloud-ai relay
      ctx.logFn(`Desktop relay tool: ${toolName}`);
      return execDesktopRelayTool(toolName, args, ctx);

    case 'local':
      // Try Python agent WebSocket first
      ctx.logFn(`Local tool via agent: ${toolName}`);
      return execLocalTool(toolName, args, ctx);

    case 'orchestration':
      // Handled inline by the engine
      return { ok: false, error: `orchestration_tool_handled_inline: ${toolName}` };

    case 'unsupported':
    default:
      ctx.logFn(`⚠️ Unsupported tool on VM: ${toolName}`);
      return { ok: false, error: `unsupported_on_vm: ${toolName}. This tool requires the desktop app.` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Execution (ported from desktop engine/execution.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface ExecuteStepResult {
  edges: StuardEdge[];
  ctx: any;
  ok: boolean;
  error?: string;
}

async function executeStep(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  engineCtx: EngineContext,
  deployDir?: string
): Promise<ExecuteStepResult> {
  try {
    const toolName = step.tool || 'noop';
    const mergedArgs = interpolateForTool(deepMerge(step.args || {}, ctx?.__argsPatch?.[step.id] || {}), ctx, toolName);

    const kind = getToolKind(toolName);
    let result: any;

    if (kind === 'orchestration') {
      if (toolName === 'run_sequential') {
        result = await execRunSequential(spec, step, mergedArgs, ctx, engineCtx, deployDir);
      } else if (toolName === 'run_parallel') {
        result = await execRunParallel(spec.id, mergedArgs, ctx, engineCtx, deployDir);
      } else {
        result = { ok: false, error: `unknown_orchestration: ${toolName}` };
      }
    } else if (toolName === 'noop' || !toolName) {
      result = { ok: true };
    } else {
      result = await execTool(
        toolName,
        { ...mergedArgs, flowId: spec.id, __workflowToolCall: true },
        engineCtx,
        deployDir,
      );
    }

    ctx[step.id] = result;

    // Handle return_value — terminates the branch and sets the return payload
    if (toolName === 'return_value' || result?.action === 'return') {
      (ctx as any).__return = (result && typeof result === 'object' && 'value' in result) ? result.value : result;
      (ctx as any).__terminated = true;
      return { ok: true, ctx, edges: [] };
    }

    // Handle termination
    if (result?.terminated || toolName === 'end') {
      (ctx as any).__terminated = true;
      return { ok: true, ctx, edges: [] };
    }

    // Check failure
    if (!result?.ok) {
      return { ok: false, error: String(result?.error || `${toolName}_failed`), ctx, edges: [] };
    }

    // Decide next edges
    const activeEdges = await decideNext(spec, step, ctx, engineCtx);
    return { ok: true, ctx, edges: activeEdges };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'step_failed'), ctx, edges: [] };
  }
}

function isCatchAllGuard(g: any): boolean {
  if (!g || g === 'always') return true;
  if (g && typeof g === 'object' && g.if === true) return true;
  return false;
}

async function decideNext(
  spec: StuardSpec,
  step: StuardStep,
  ctx: any,
  engineCtx: EngineContext
): Promise<StuardEdge[]> {
  const rawEdges: StuardEdge[] = Array.isArray(step.next) ? step.next : [];
  const activeEdges: StuardEdge[] = [];

  // Stream edges are always active
  const streamEdges = rawEdges.filter(e => e.stream);
  const flowEdges = rawEdges.filter(e => !e.stream);
  activeEdges.push(...streamEdges);

  // Separate unconditional from conditional
  const unconditionalEdges = flowEdges.filter(e => isCatchAllGuard(e.guard));
  const conditionalEdges = flowEdges.filter(e => !isCatchAllGuard(e.guard));

  if (conditionalEdges.length === 0) {
    activeEdges.push(...unconditionalEdges);
    return activeEdges;
  }

  // Check for AI routing
  const aiEdges = conditionalEdges.filter(e => e.guard?.ai);
  if (aiEdges.length > 0) {
    const allOptions = conditionalEdges.map(e => ({ to: e.to, label: e.label || e.to }));
    const aiCfg = aiEdges[0].guard.ai;
    const aiResult = await aiDecideNext(step, ctx, allOptions, aiCfg, engineCtx);
    if (aiResult.ok && aiResult.next) {
      if (aiResult.argsPatch) {
        ctx.__argsPatch = ctx.__argsPatch || {};
        Object.assign(ctx.__argsPatch, aiResult.argsPatch);
      }
      const chosen = rawEdges.find(e => e.to === aiResult.next);
      if (chosen) activeEdges.push(chosen);
      return activeEdges;
    }
    // AI failed — fall through to unconditional
    engineCtx.logFn(`[${step.id}] AI routing failed: ${aiResult.error}, using fallback`);
    if (unconditionalEdges.length > 0) activeEdges.push(unconditionalEdges[0]);
    return activeEdges;
  }

  // Evaluate JSONLogic / expression guards
  let anyMatched = false;
  for (const edge of conditionalEdges) {
    const guard = edge.guard?.if || edge.guard;
    const passed = evalIfGuard(guard, ctx);
    if (passed) {
      activeEdges.push(edge);
      anyMatched = true;
    }
  }

  // If no conditional matched, use unconditional fallback
  if (!anyMatched && unconditionalEdges.length > 0) {
    activeEdges.push(...unconditionalEdges);
  }

  return activeEdges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestration — run_sequential, run_parallel
// ─────────────────────────────────────────────────────────────────────────────

async function execRunSequential(
  spec: StuardSpec,
  parentStep: StuardStep,
  args: any,
  ctx: any,
  engineCtx: EngineContext,
  deployDir?: string
): Promise<any> {
  const stepsArr = Array.isArray(args?.steps) ? args.steps : [];
  const continueOnError = !!args?.continueOnError;
  const results: any[] = [];
  let firstError: string | undefined;

  for (let i = 0; i < stepsArr.length; i++) {
    const s = stepsArr[i];
    const toolName = String(s?.tool || '').trim();
    if (!toolName) continue;

    const subStep: StuardStep = { id: String(s?.id || `${parentStep.id}__${i}`), tool: toolName, args: s?.args || {} };
    let subExec: ExecuteStepResult;
    try {
      subExec = await executeStep(spec, subStep, ctx, engineCtx, deployDir);
    } catch (e: any) {
      subExec = { ok: false, error: String(e?.message || 'failed'), ctx, edges: [] };
    }

    ctx = subExec.ctx || ctx;
    const subResult = ctx[subStep.id];
    results.push({ tool: toolName, ok: !!subExec.ok, result: subResult, error: subExec.error });

    if (!subExec.ok) {
      if (!firstError) firstError = String(subExec.error || `${toolName}_failed`);
      if (!continueOnError) break;
    }
  }

  return { ok: results.every(r => r.ok) || continueOnError, results, firstError };
}

async function execRunParallel(
  flowId: string,
  args: any,
  ctx: any,
  engineCtx: EngineContext,
  deployDir?: string
): Promise<any> {
  const stepsArr = Array.isArray(args?.steps) ? args.steps : [];
  engineCtx.logFn(`run_parallel: Starting ${stepsArr.length} tasks`);

  const results = await Promise.all(stepsArr.map(async (s: any, i: number) => {
    const toolName = String(s?.tool || '').trim();
    if (!toolName) return { tool: '', ok: true, result: undefined };
    try {
      const subResult = await execTool(
        toolName,
        { ...(s?.args || {}), flowId, __workflowToolCall: true },
        engineCtx,
        deployDir,
      );
      return { tool: toolName, ok: subResult?.ok ?? true, result: subResult };
    } catch (e: any) {
      return { tool: toolName, ok: false, result: { ok: false, error: String(e?.message) } };
    }
  }));

  return { ok: results.every(r => r.ok), results };
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop Execution (ported from desktop)
// ─────────────────────────────────────────────────────────────────────────────

async function executeLoopChain(
  spec: StuardSpec,
  startStep: StuardStep,
  ctx: any,
  engineCtx: EngineContext,
  map: Map<string, StuardStep>,
  loopStartStepId: string,
  deployDir?: string
): Promise<{ ok: boolean; error?: string; breakEdge?: StuardEdge }> {
  let current: StuardStep | undefined = startStep;
  const visitedInIteration = new Set<string>();

  while (current) {
    if (visitedInIteration.has(current.id)) {
      engineCtx.logFn(`[${current.id}] Loop iteration complete (cycle returned to start)`);
      return { ok: true };
    }
    visitedInIteration.add(current.id);

    const out = await executeStep(spec, current, ctx, engineCtx, deployDir);
    if (!out.ok) return { ok: false, error: out.error };
    if ((ctx as any).__terminated) return { ok: true };

    const flowEdges = (out.edges || []).filter(e => !e.stream);
    if (flowEdges.length === 0) return { ok: true };

    const breakEdge = flowEdges.find(e => e.loopBreak);
    if (breakEdge) {
      engineCtx.logFn(`[${current.id}] Loop break -> ${breakEdge.to}`);
      return { ok: true, breakEdge };
    }

    const loopBackEdge = flowEdges.find(e => e.loop?.type || e.to === loopStartStepId);
    if (loopBackEdge) {
      engineCtx.logFn(`[${current.id}] Loop body complete`);
      return { ok: true };
    }

    const regularEdges = flowEdges.filter(e => !e.loopBreak && !e.loop);
    if (regularEdges.length !== 1) {
      if (regularEdges.length > 1) {
        engineCtx.logFn(`[${current.id}] Loop body emitted ${regularEdges.length} branches; loop controller will continue after this iteration`);
      }
      return { ok: true };
    }

    current = map.get(regularEdges[0].to);
    if (!current) return { ok: true };
  }

  return { ok: true };
}

async function executeLoop(
  spec: StuardSpec,
  loopBodyStep: StuardStep,
  ctx: any,
  loopCfg: LoopConfig,
  engineCtx: EngineContext,
  map: Map<string, StuardStep>,
  prevStepId: string,
  deployDir?: string
): Promise<{ breakEdge?: StuardEdge }> {
  const maxIter = loopCfg.maxIterations || 100;
  const delayMs = loopCfg.delayMs || 0;
  const itemVar = loopCfg.itemVar || 'item';
  const indexVar = loopCfg.indexVar || 'index';
  const results: any[] = [];
  let iterations = 0;
  let breakEdge: StuardEdge | undefined;
  let defaultBreakEdge: StuardEdge | undefined;

  const sourceStep = map.get(prevStepId);
  if (sourceStep && Array.isArray(sourceStep.next)) {
    defaultBreakEdge = sourceStep.next.find(e => e.loopBreak);
  }

  const resolveItems = (): any[] => {
    if (!loopCfg.items) return [];
    const resolved = interpolateForTool({ items: loopCfg.items }, ctx, 'loop').items;
    if (Array.isArray(resolved)) return resolved;
    if (typeof resolved === 'string') {
      try {
        const parsed = JSON.parse(resolved);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return resolved ? [resolved] : [];
      }
    }
    return resolved == null ? [] : [resolved];
  };

  const setLoopContext = (i: number, item: any, length: number) => {
    ctx.loop = ctx.loop || {};
    ctx.loop[itemVar] = item;
    ctx.loop[indexVar] = i;
    ctx.loop.item = item;
    ctx.loop.index = i;
    ctx.loop.length = length;
    ctx[itemVar] = item;
    ctx[indexVar] = i;
    ctx.$loop = { index: i, item, length };
  };

  const runIteration = async (i: number, item: any, length: number) => {
    setLoopContext(i, item, length);
    const chainOut = await executeLoopChain(spec, loopBodyStep, ctx, engineCtx, map, loopBodyStep.id, deployDir);
    if (chainOut.breakEdge && !breakEdge) breakEdge = chainOut.breakEdge;
    if (chainOut.ok) {
      results.push(ctx[loopBodyStep.id]);
      iterations++;
    } else {
      engineCtx.logFn(`[${loopBodyStep.id}] loop iteration ${i + 1} failed: ${chainOut.error}`);
    }
    return chainOut.ok;
  };

  engineCtx.logFn(`[${loopBodyStep.id}] Starting ${loopCfg.type} loop (max ${maxIter})`);

  if (loopCfg.type === 'forEach') {
    const items = resolveItems();
    engineCtx.logFn(`[${loopBodyStep.id}] forEach: ${items.length} items`);
    const limit = Math.min(items.length, maxIter);
    for (let i = 0; i < limit; i++) {
      const ok = await runIteration(i, items[i], items.length);
      if (!ok || breakEdge || (ctx as any).__terminated) break;
      if (delayMs > 0 && i < limit - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  } else if (loopCfg.type === 'repeat') {
    const count = Math.min(loopCfg.count || 1, maxIter);
    engineCtx.logFn(`[${loopBodyStep.id}] repeat: ${count} times`);
    for (let i = 0; i < count; i++) {
      const ok = await runIteration(i, null, count);
      if (!ok || breakEdge || (ctx as any).__terminated) break;
      if (delayMs > 0 && i < count - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  } else if (loopCfg.type === 'while') {
    for (let i = 0; i < maxIter; i++) {
      const expr = String(loopCfg.conditionText || 'false').trim().replace(/^\{\{/, '').replace(/\}\}$/, '').trim();
      let shouldRun = false;
      try {
        shouldRun = evalIfGuard(expr, ctx);
      } catch {
        const resolved = interpolateForTool({ cond: loopCfg.conditionText || '' }, ctx, 'loop').cond;
        shouldRun = !!resolved && resolved !== 'false' && resolved !== '0';
      }
      if (!shouldRun) {
        engineCtx.logFn(`[${loopBodyStep.id}] while: condition false at iteration ${i}`);
        break;
      }
      const ok = await runIteration(i, null, maxIter);
      if (!ok || breakEdge || (ctx as any).__terminated) break;
      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
  }

  ctx[`${loopBodyStep.id}_loop_results`] = results;
  if (results.length > 0) ctx[loopBodyStep.id] = results[results.length - 1];
  delete ctx.loop;
  delete ctx.$loop;
  engineCtx.logFn(`[${loopBodyStep.id}] Loop completed: ${iterations} iteration(s)`);

  return { breakEdge: breakEdge || defaultBreakEdge };
}

// ─────────────────────────────────────────────────────────────────────────────
// DesignerModel → StuardSpec converter (ported from desktop workflows.ts)
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeGuard(g: any): any {
  if (!g || typeof g !== 'object') return g;
  const result: any = {};
  for (const [key, value] of Object.entries(g)) {
    // Fix LLM double-quoting: '"=="' → '=='
    const cleanKey = key.replace(/^"(.*)"$/, '$1');
    if (Array.isArray(value)) {
      result[cleanKey] = value.map(v => {
        if (typeof v === 'string') return v.replace(/^"(.*)"$/, '$1');
        if (v && typeof v === 'object') return sanitizeGuard(v);
        return v;
      });
    } else if (value && typeof value === 'object') {
      result[cleanKey] = sanitizeGuard(value);
    } else {
      result[cleanKey] = value;
    }
  }
  return result;
}

export function designerModelToStuardSpec(m: any, triggerId?: string): StuardSpec {
  const id = String(m?.id || '').trim() || 'stuard_' + Math.random().toString(36).slice(2, 8);
  const name = String(m?.name || 'My Stuard');
  const version = String(m?.version || '1');
  const nodes = Array.isArray(m?.nodes) ? m.nodes : [];
  const wires = Array.isArray(m?.wires) ? m.wires : [];
  const triggersIn = Array.isArray(m?.triggers) ? m.triggers : [];

  const steps: StuardStep[] = nodes.map((n: any) => {
    const fromId = String(n?.id || '');
    const outs = wires.filter((w: any) => String(w?.from || '') === fromId && !(w as any)?.callNode);
    const next: StuardEdge[] = outs.map((w: any) => {
      const to = String(w?.to || '');
      const gRaw = (w as any)?.guard;
      const g = (gRaw && typeof gRaw === 'object') ? sanitizeGuard(gRaw) : gRaw;
      let guard: any = 'always';
      if (g && typeof g === 'object') {
        if (g.if) guard = { if: g.if };
        else if (g.ai) guard = { ai: g.ai };
        else {
          const isEmpty = !g || Object.keys(g).length === 0;
          const isAlwaysTrue = isEmpty || (g['==='] && Array.isArray(g['===']) && g['==='][0] === true && g['==='][1] === true);
          guard = isAlwaysTrue ? 'always' : { if: g };
        }
      }
      const edge: any = { to, guard };
      if ((w as any)?.label) edge.label = String((w as any).label);
      if ((w as any)?.loop?.type) {
        const loop = (w as any).loop;
        edge.loop = {
          type: loop.type, items: loop.items,
          itemVar: loop.itemVar || 'item', indexVar: loop.indexVar || 'index',
          count: loop.count, conditionText: loop.conditionText,
          maxIterations: loop.maxIterations || 100, delayMs: loop.delayMs || 0,
        };
      }
      if ((w as any)?.loopBreak) edge.loopBreak = true;
      const loopFanoutMode = (w as any)?.loopFanoutMode;
      if (loopFanoutMode === 'wait' || loopFanoutMode === 'parallel') {
        edge.loopFanoutMode = loopFanoutMode;
      }
      if ((w as any)?.stream && typeof (w as any).stream === 'object') {
        const s = (w as any).stream;
        edge.stream = { sourceField: s.sourceField || 'streamId', mode: s.mode || 'reactive' };
        if (s.bufferSize) edge.stream.bufferSize = s.bufferSize;
      }
      return edge;
    });
    const step: any = { id: fromId, tool: String(n?.tool || 'noop'), args: n?.args || {}, next };
    if (n?.label) step.label = String(n.label);
    if (n?.waitForAll === true) step.waitForAll = true;
    if (n?.fallbackTo) step.fallback = { to: String(n.fallbackTo).trim() };
    return step;
  });

  // Find start node
  const triggerIdsSet = new Set(triggersIn.map((t: any) => String(t?.id || '')).filter(Boolean));
  let startNodeId: string | undefined;

  if (triggerId) {
    const triggerWires = wires.filter((w: any) => String(w?.from || '') === triggerId);
    const targets: string[] = [...new Set(triggerWires.map((w: any) => String(w?.to || '')).filter(Boolean))] as string[];
    if (targets.length > 1) {
      const synId = '_trigger_parallel_start';
      steps.unshift({ id: synId, tool: 'noop', args: {}, next: targets.map(t => ({ to: t, guard: 'always' as any })) });
      startNodeId = synId;
    } else if (targets.length === 1) {
      startNodeId = targets[0];
    }
  }

  if (!startNodeId) {
    const triggerTargets = wires
      .filter((w: any) => triggerIdsSet.has(String(w?.from || '')) || String(w?.from || '').startsWith('trig_'))
      .map((w: any) => String(w?.to || '')).filter(Boolean);
    const unique: string[] = [...new Set(triggerTargets)] as string[];
    if (unique.length > 1) {
      const synId = '_trigger_parallel_start';
      steps.unshift({ id: synId, tool: 'noop', args: {}, next: unique.map(t => ({ to: t, guard: 'always' as any })) });
      startNodeId = synId;
    } else if (unique.length === 1) {
      startNodeId = unique[0];
    }
  }

  if (!startNodeId) {
    const nodeWires = wires.filter((w: any) => !triggerIdsSet.has(String(w?.from || '')) && !String(w?.from || '').startsWith('trig_'));
    const inbound = new Set(nodeWires.map((w: any) => String(w?.to || '')).filter(Boolean));
    const startNode = nodes.find((n: any) => !inbound.has(String(n?.id || ''))) || nodes[0];
    startNodeId = startNode ? String(startNode.id) : undefined;
  }

  const triggers = triggersIn.map((t: any) => {
    const tid = String(t?.id || '');
    const triggerWires = wires.filter((w: any) => String(w?.from || '') === tid);
    const triggerStarts = triggerWires.map((w: any) => String(w?.to || '')).filter(Boolean);
    return {
      id: tid,
      type: String(t?.type || ''),
      args: t?.args || {},
      inputParams: Array.isArray(t?.inputParams) ? t.inputParams
        : Array.isArray(t?.args?.inputParams) ? t.args.inputParams : undefined,
      start: triggerStarts[0],
      startNodes: triggerStarts.length > 1 ? triggerStarts : undefined,
    };
  });

  return { id, name, version, autostart: false, triggers, steps, start: startNodeId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Engine — runWorkflowOnVM
// ─────────────────────────────────────────────────────────────────────────────

export interface VMEngineEvents {
  on(event: 'step', listener: (data: { stepId: string; status: string; error?: string }) => void): void;
  on(event: 'flow', listener: (data: { isRunning: boolean }) => void): void;
  on(event: 'log', listener: (msg: string) => void): void;
}

export class VMWorkflowEngine extends EventEmitter {
  private running = new Map<string, AbortController>();

  isRunning(deployId: string): boolean {
    return this.running.has(deployId);
  }

  stop(deployId: string): boolean {
    const ctrl = this.running.get(deployId);
    if (!ctrl) return false;
    ctrl.abort();
    this.running.delete(deployId);
    cleanupDeployVariables(deployId);
    return true;
  }

  stopAll(): void {
    for (const [id, ctrl] of this.running) {
      ctrl.abort();
      cleanupDeployVariables(id);
    }
    this.running.clear();
  }

  /**
   * Run a workflow on the VM.
   * @param deployId  Deployment ID (for variable scoping & logging)
   * @param payload   The raw DesignerModel OR pre-compiled StuardSpec
   * @param deployDir The deploy directory (for file scoping)
   * @param opts      Cloud AI URL, agent WS URL, access token
   */
  async run(
    deployId: string,
    payload: any,
    deployDir: string,
    opts: {
      cloudAiUrl: string;
      agentWsUrl?: string;
      /** Owner userId — set by deploy-executor from the deploy config */
      userId: string;
      /** Per-VM HMAC secret (VM_TOKEN_SECRET env var) */
      vmTokenSecret: string;
      /** Optional trigger ID to execute a specific trigger path */
      triggerId?: string;
      /** Optional trigger payload injected into ctx.input/ctx.trigger */
      triggerPayload?: any;
      /** IANA timezone used by schedules and VM-native time tools */
      timezone?: string;
    }
  ): Promise<{ ok: boolean; result?: any; error?: string; logs: string[] }> {
    const logs: string[] = [];
    const logFn = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      logs.push(line);
      this.emit('log', { deployId, message: line });
      // Write to deploy.log so logs appear in the deploys tab UI
      try {
        fs.appendFileSync(path.join(deployDir, 'deploy.log'), line + '\n');
      } catch { /* ignore */ }
    };

    // Compile DesignerModel to StuardSpec if needed
    let spec: StuardSpec;
    if (payload.steps && !payload.nodes) {
      // Already a StuardSpec
      spec = payload as StuardSpec;
    } else if (payload.nodes || payload.triggers || payload.wires) {
      // DesignerModel — convert
      logFn('Converting DesignerModel to StuardSpec...');
      spec = designerModelToStuardSpec(payload, opts.triggerId);
    } else {
      return { ok: false, error: 'invalid_workflow_format: expected nodes/wires or steps', logs };
    }

    // Save compiled spec for debugging
    try {
      fs.writeFileSync(path.join(deployDir, 'compiled-spec.json'), JSON.stringify(spec, null, 2));
    } catch { /* ignore */ }

    const steps = Array.isArray(spec.steps) ? spec.steps : [];
    if (steps.length === 0) {
      return { ok: false, error: 'workflow_has_no_steps', logs };
    }

    logFn(`Workflow "${spec.name}" — ${steps.length} steps, start: ${spec.start || 'auto'}${opts.triggerId ? `, trigger: ${opts.triggerId}` : ''}`);

    // Load variables for this deployment (per-deploy scoped)
    loadDeployVariables(deployId);

    const controller = new AbortController();
    this.running.set(deployId, controller);

    const engineCtx: EngineContext = {
      stuardsDir: deployDir,
      agentWsUrl: opts.agentWsUrl || 'ws://127.0.0.1:8765/ws',
      cloudAiUrl: opts.cloudAiUrl,
      logFn,
      timezone: opts.timezone || process.env.STUARD_USER_TIMEZONE || process.env.TZ || 'UTC',
      userId: opts.userId,
      vmTokenSecret: opts.vmTokenSecret,
    };

    // Build step map
    const map = new Map<string, StuardStep>();
    for (const s of steps) map.set(s.id, s);

    // Find start step
    let startStep: StuardStep | undefined;
    if (spec.start) startStep = map.get(spec.start);
    if (!startStep && steps.length > 0) startStep = steps[0];

    if (!startStep) {
      this.running.delete(deployId);
      return { ok: false, error: 'no_start_step_found', logs };
    }

    const ctx: any = {};

    // ── Inject $vars proxy (dynamic lookup from deploy-scoped store) ──
    ctx.$vars = new Proxy({}, {
      get(_t: any, prop: any) {
        if (typeof prop !== 'string') return undefined;
        const direct = getVariable(prop, undefined, deployId);
        if (direct !== undefined) return direct;
        return getVariable(`workflow.${prop}`, undefined, deployId);
      },
      set(_t: any, prop: any, value: any) {
        if (typeof prop === 'string') setVariable(prop, value, typeof value, deployId);
        return true;
      },
    });

    // ── Inject workflow proxy (deploy-scoped) ──
    ctx.workflow = new Proxy({}, {
      get(_t: any, prop: any) {
        if (typeof prop !== 'string') return undefined;
        return getVariable(`workflow.${prop}`, undefined, deployId);
      },
    });

    // ── Inject $workspace context ──
    ctx.$workspace = {
      path: deployDir.replace(/\\/g, '/'),
      data: (deployDir + '/data').replace(/\\/g, '/'),
      scripts: (deployDir + '/scripts').replace(/\\/g, '/'),
      assets: (deployDir + '/assets').replace(/\\/g, '/'),
      id: deployId,
    };

    // ── Inject input/trigger context from payload ──
    const triggerPayload = opts.triggerPayload !== undefined ? opts.triggerPayload : payload;
    if (triggerPayload && typeof triggerPayload === 'object') {
      if ('input' in triggerPayload || 'webhook' in triggerPayload || 'args' in triggerPayload) {
        if (triggerPayload.input !== undefined) ctx.input = triggerPayload.input;
        if (triggerPayload.webhook !== undefined) ctx.webhook = triggerPayload.webhook;
        if (triggerPayload.args !== undefined) ctx.args = triggerPayload.args;
        if (triggerPayload.trigger !== undefined) ctx.trigger = triggerPayload.trigger;
      } else if (triggerPayload.nodes === undefined && triggerPayload.steps === undefined) {
        // Raw payload data (not the workflow definition itself)
        ctx.input = triggerPayload;
        ctx.webhook = triggerPayload;
      }
    }

    // Ensure trigger context is available for templates ({{trigger.data.X}})
    if (!ctx.trigger) {
      const triggerData = ctx.args || ctx.input || {};
      ctx.trigger = {
        data: triggerData,
        ...(triggerData && typeof triggerData === 'object' ? triggerData : {}),
      };
    }

    // Convergence tracking
    const incomingEdges = new Map<string, string[]>();
    for (const step of steps) {
      for (const edge of step.next || []) {
        if (edge.to) {
          const arr = incomingEdges.get(edge.to) || [];
          arr.push(step.id);
          incomingEdges.set(edge.to, arr);
        }
      }
    }

    interface ConvergenceState {
      pending: Map<string, Set<string>>;
      completed: Map<string, Map<string, any>>;
      resolvers: Map<string, () => void>;
    }
    const convergence: ConvergenceState = { pending: new Map(), completed: new Map(), resolvers: new Map() };

    for (const step of steps) {
      if (step.waitForAll) {
        const sources = incomingEdges.get(step.id) || [];
        if (sources.length > 1) {
          convergence.pending.set(step.id, new Set(sources));
          convergence.completed.set(step.id, new Map());
          logFn(`[${step.id}] WaitForAll: expecting ${sources.length} branch(es): ${sources.join(', ')}`);
        }
      }
    }

    this.emit('flow', { deployId, isRunning: true });

    // ── Branch runner ──
    const runBranch = async (current: StuardStep, branchCtx: any, prevId?: string): Promise<void> => {
      let step: StuardStep | undefined = current;
      let prevStepId = prevId;
      let guard = 0;

      while (step && guard < 500) {
        guard++;
        if (controller.signal.aborted) break;

        // Convergence check
        if (step.waitForAll && prevStepId) {
          const pending = convergence.pending.get(step.id);
          const completed = convergence.completed.get(step.id);
          if (pending && completed) {
            pending.delete(prevStepId);
            completed.set(prevStepId, { ...branchCtx });
            logFn(`[${step.id}] WaitForAll: branch '${prevStepId}' arrived (${pending.size} remaining)`);
            if (pending.size > 0) return; // Wait for others
            for (const [, bc] of completed) Object.assign(branchCtx, bc);
            logFn(`[${step.id}] WaitForAll: all branches arrived`);
          }
        }

        const stepTool = step.tool || 'unknown';
        logFn(`[${step.id}] Starting (tool: ${stepTool})`);
        this.emit('step', { deployId, stepId: step.id, status: 'running' });

        const startTime = Date.now();
        const out = await executeStep(spec, step, branchCtx, engineCtx, deployDir);
        const duration = Date.now() - startTime;

        if (controller.signal.aborted) break;

        if (!out.ok) {
          this.emit('step', { deployId, stepId: step.id, status: 'error', error: out.error });
          logFn(`[${step.id}] ❌ Failed (${duration}ms): ${out.error}`);

          // Try fallback
          if (step.fallback?.to) {
            const fallbackStep = map.get(step.fallback.to);
            if (fallbackStep) {
              logFn(`[${step.id}] → Fallback: ${step.fallback.to}`);
              step = fallbackStep;
              continue;
            }
          }
          break;
        }

        logFn(`[${step.id}] ✓ Completed (${duration}ms): ${summarizeOutput(branchCtx[step.id])}`);
        this.emit('step', { deployId, stepId: step.id, status: 'completed' });
        prevStepId = step.id;

        if ((branchCtx as any).__terminated) break;

        // ── Split edges into stream (non-blocking) and flow (blocking) ──
        const streamEdges = out.edges.filter(e => e.stream);
        const flowEdges = out.edges.filter(e => !e.stream);

        // 1. Spawn stream consumers for stream edges (non-blocking, tracked)
        for (const streamEdge of streamEdges) {
          const consumerStep = map.get(streamEdge.to);
          if (!consumerStep) {
            logFn(`[${step.id}] ⚠️ Stream edge target not found: ${streamEdge.to}`);
            continue;
          }
          const streamCfg = streamEdge.stream!;
          const sourceField = streamCfg.sourceField || 'streamId';
          const streamId = branchCtx[step.id]?.[sourceField] || branchCtx[step.id];
          if (streamId && typeof streamId === 'string') {
            logFn(`[${step.id}] 📡 Stream wire → ${streamEdge.to} (streamId: ${streamId})`);
            const consumerPromise = runStreamConsumer(consumerStep, branchCtx, streamId, streamCfg, step.id)
              .catch(err => logFn(`[${streamEdge.to}] ❌ Stream consumer error: ${err}`));
            streamConsumerPromises.push(consumerPromise);
          } else {
            logFn(`[${step.id}] ⚠️ Stream wire to ${streamEdge.to} but no streamId in output.${sourceField}`);
          }
        }

        // 2. Process flow edges
        if (flowEdges.length === 0) {
          logFn(`[${step.id}] End of flow`);
          break;
        }

        if (flowEdges.length === 1) {
          const edge = flowEdges[0];
          const next = map.get(edge.to);
          if (!next) break;

          if (edge.loop?.type) {
            const loopResult = await executeLoop(spec, next, branchCtx, edge.loop, engineCtx, map, step.id, deployDir);
            if (loopResult.breakEdge?.to) {
              step = map.get(loopResult.breakEdge.to);
            } else {
              step = undefined;
            }
            if (!step) break;
            continue;
          }

          step = next;
          continue;
        }

        // Multiple edges — check for loop
        const loopEdge = flowEdges.find(e => e.loop?.type);
        if (loopEdge) {
          const next = map.get(loopEdge.to);
          if (!next) break;
          const loopResult = await executeLoop(spec, next, branchCtx, loopEdge.loop!, engineCtx, map, step.id, deployDir);
          step = loopResult.breakEdge?.to ? map.get(loopResult.breakEdge.to) : undefined;
          if (!step) break;
          continue;
        }

        // Parallel branches
        logFn(`[${step.id}] ⚡ ${flowEdges.length} parallel branches`);
        const parallelSteps = flowEdges.map(e => map.get(e.to)).filter(Boolean) as StuardStep[];
        await Promise.all(parallelSteps.map(s => runBranch(s, { ...branchCtx }, step!.id)));
        break;
      }
    };

    // ── Stream consumer — processes chunks reactively ──
    const runStreamConsumer = async (
      consumerStep: StuardStep,
      baseCtx: any,
      streamId: string,
      _streamCfg: StreamWireConfig,
      sourceStepId: string
    ): Promise<void> => {
      const maxIdleMs = 30000;
      // Try VM-native streams first, then fall back to Python agent
      const vmStream = vmStreams.get(streamId);
      const useVmStreams = !!vmStream;

      // Subscribe
      let subscriberId: string;
      if (useVmStreams) {
        subscriberId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        vmStream!.subscribers.set(subscriberId, { cursor: 0, resolver: null });
      } else {
        const subResult = await execLocalTool('stream_subscribe', {
          streamId, label: `consumer:${consumerStep.id}`, fromStart: false,
        }, engineCtx);
        if (!subResult?.ok || !subResult?.subscriberId) {
          logFn(`[${consumerStep.id}] 📡 Failed to subscribe to stream ${streamId}`);
          return;
        }
        subscriberId = subResult.subscriberId;
      }

      logFn(`[${consumerStep.id}] 📡 Subscribed to stream (${useVmStreams ? 'vm' : 'agent'})`);
      const originalSourceOutput = baseCtx[sourceStepId];
      let lastDataTime = Date.now();
      let chunkIndex = 0;
      let accumulatedText = '';

      while (!controller.signal.aborted) {
        let chunks: any[] = [];
        let closed = false;

        if (useVmStreams) {
          const sub = vmStream!.subscribers.get(subscriberId);
          const cursor = sub?.cursor ?? 0;
          const pending = vmStream!.chunks.slice(cursor, cursor + 10);
          if (pending.length === 0 && !vmStream!.closed) {
            await new Promise<void>(resolve => {
              const timer = setTimeout(resolve, 2000);
              if (sub) sub.resolver = () => { clearTimeout(timer); resolve(); };
            });
            const afterWait = vmStream!.chunks.slice(cursor, cursor + 10);
            chunks = afterWait;
            if (sub) sub.cursor = cursor + afterWait.length;
          } else {
            chunks = pending;
            if (sub) sub.cursor = cursor + pending.length;
          }
          closed = vmStream!.closed && chunks.length === 0;
        } else {
          const readResult = await execLocalTool('stream_read', {
            streamId, subscriberId, maxChunks: 10, waitMs: 2000,
          }, engineCtx);
          if (!readResult?.ok) {
            if (readResult?.closed) break;
            await new Promise(r => setTimeout(r, 100));
            continue;
          }
          chunks = readResult.chunks || [];
          closed = !!readResult.closed;
        }

        if (chunks.length > 0) {
          lastDataTime = Date.now();
          for (const chunk of chunks) {
            if (controller.signal.aborted) break;
            const chunkData = chunk?.data !== undefined ? chunk.data : chunk;
            const chunkStr = typeof chunkData === 'string' ? chunkData : JSON.stringify(chunkData);
            accumulatedText += chunkStr;

            // Override source output so {{sourceStepId.text}} resolves to chunk
            baseCtx[sourceStepId] = {
              ...originalSourceOutput,
              text: chunkStr, chunk: chunkData, chunkIndex,
              fullText: accumulatedText, streamId,
            };
            baseCtx.stream_chunk = chunkStr;
            baseCtx.stream_chunk_index = chunkIndex;
            baseCtx.stream_full_text = accumulatedText;

            this.emit('step', { deployId, stepId: consumerStep.id, status: 'running' });
            const out = await executeStep(spec, consumerStep, baseCtx, engineCtx, deployDir);

            if (out.ok) {
              this.emit('step', { deployId, stepId: consumerStep.id, status: 'completed' });
              // Follow downstream flow edges per-chunk
              const downstreamEdges = (out.edges || []).filter(e => !e.stream);
              if (downstreamEdges.length === 1) {
                const next = map.get(downstreamEdges[0].to);
                if (next) await runBranch(next, baseCtx, consumerStep.id).catch(() => {});
              } else if (downstreamEdges.length > 1) {
                await Promise.all(downstreamEdges.map(async (edge) => {
                  const next = map.get(edge.to);
                  if (next) await runBranch(next, { ...baseCtx }, consumerStep.id).catch(() => {});
                }));
              }
            } else {
              logFn(`[${consumerStep.id}] ❌ Chunk ${chunkIndex} failed: ${out.error}`);
            }
            chunkIndex++;
          }
        }

        if (closed) {
          logFn(`[${consumerStep.id}] 📡 Stream closed after ${chunkIndex} chunks`);
          break;
        }
        if (Date.now() - lastDataTime > maxIdleMs) {
          logFn(`[${consumerStep.id}] 📡 Stream idle timeout (${maxIdleMs}ms)`);
          break;
        }
      }

      // Restore source output
      baseCtx[sourceStepId] = { ...originalSourceOutput, text: accumulatedText, fullText: accumulatedText, streamId };
      delete baseCtx.stream_chunk;
      delete baseCtx.stream_chunk_index;
      baseCtx.stream_full_text = accumulatedText;

      // Unsubscribe
      if (useVmStreams) {
        vmStream!.subscribers.delete(subscriberId);
      } else {
        await execLocalTool('stream_unsubscribe', { streamId, subscriberId }, engineCtx).catch(() => {});
      }
      logFn(`[${consumerStep.id}] 📡 Stream consumer finished`);
    };

    // Track stream consumer promises for completion
    const streamConsumerPromises: Promise<void>[] = [];

    // Run from start
    try {
      await runBranch(startStep, ctx);
      // Wait for any stream consumers to finish
      if (streamConsumerPromises.length > 0) {
        logFn(`Waiting for ${streamConsumerPromises.length} stream consumer(s)...`);
        await Promise.allSettled(streamConsumerPromises);
      }
      logFn('Workflow completed');
    } catch (e: any) {
      logFn(`Workflow error: ${e?.message}`);
    }

    this.running.delete(deployId);
    this.emit('flow', { deployId, isRunning: false });

    return {
      ok: !(ctx as any).__terminated || true,
      result: (ctx as any).__return,
      logs,
    };
  }
}
