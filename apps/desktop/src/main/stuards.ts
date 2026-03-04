import { app, BrowserWindow, globalShortcut, net } from "electron";
import * as fs from "fs";
import * as path from "path";
import WebSocket from "ws";

import { unifiedTasksService } from "./services";
let nodeCron: any = null;
try { nodeCron = require('node-cron'); } catch { }

export type StuardEdge = { to: string; guard?: any; label?: string };
export type StuardStep = {
  id: string;
  tool?: string;
  args?: any;
  next?: StuardEdge[];
  fallback?: { to: string };
  waitForAll?: boolean;
};
export type OllamaConfig = {
  provider: 'ollama';
  model?: string;
  baseUrl?: string;
};

export type StuardSpec = {
  id: string;
  name?: string;
  version?: string;
  autostart?: boolean;
  triggers?: Array<{ type: string; args?: any }>;
  steps?: StuardStep[];
  start?: string;
  globals?: {
    ai?: OllamaConfig;
    [key: string]: any;
  };
};

export type StuardRuntime = { id: string; timers: NodeJS.Timeout[]; hotkeys: string[]; cronJobs: any[] };

const stuardRuntimes = new Map<string, StuardRuntime>();
const webhookEnabledStuards = new Set<string>();
let agentWs: WebSocket | null = null;
let agentReady: Promise<WebSocket> | null = null;

function getAgentWsUrl() {
  const raw = String(process.env.AGENT_WS || '').trim();
  if (raw) return raw.endsWith('/ws') ? raw : (raw.replace(/\/$/, '') + '/ws');
  return 'ws://127.0.0.1:8765/ws';
}

export function handleStuardWebhook(idOrNull: string | null, payload: any): number {
  let delivered = 0;
  try {
    if (idOrNull) {
      const safe = safeStuardId(idOrNull);
      if (webhookEnabledStuards.has(safe)) {
        try { runStuardOnce(safe, payload); delivered++; } catch { }
      }
    } else {
      for (const sid of Array.from(webhookEnabledStuards.values())) {
        try { runStuardOnce(sid, payload); delivered++; } catch { }
      }
    }
  } catch { }
  return delivered;
}

// Helper to attach unified tasks listener
function attachUnifiedTasksListener(ws: WebSocket) {
  if ((ws as any).__unifiedTasksListenerAttached) return;
  (ws as any).__unifiedTasksListenerAttached = true;

  ws.on('message', async (raw: WebSocket.RawData) => {
    try {
      const s = raw.toString('utf8');
      const msg = JSON.parse(s);

      if (msg?.type === 'request' && msg.event && msg.event.startsWith('unified_tasks_')) {
        const { event, data, id } = msg;
        let result: any = { ok: false, error: 'unknown_event' };

        if (event === 'unified_tasks_get_pending') {
          result = unifiedTasksService.getPendingAssignments();
        } else if (event === 'unified_tasks_mark_triggered') {
          result = { ok: true };
        } else if (event === 'unified_tasks_mark_completed') {
          if (data?.taskId && data?.assignmentId) {
            result = unifiedTasksService.updateAgentAssignment(data.taskId, data.assignmentId, { status: 'completed' });
          } else {
            result = { ok: false, error: 'missing_ids' };
          }
        } else if (event === 'unified_tasks_get_task') {
          if (data?.taskId) {
            result = unifiedTasksService.get(data.taskId);
          } else {
            result = { ok: false, error: 'missing_id' };
          }
        } else if (event === 'unified_tasks_add') {
          result = unifiedTasksService.add(data);
        } else if (event === 'unified_tasks_list') {
          result = unifiedTasksService.list();
        } else if (event === 'unified_tasks_update') {
          result = unifiedTasksService.update(data);
        } else if (event === 'unified_tasks_delete') {
          result = unifiedTasksService.delete(data?.id);
        } else if (event === 'unified_tasks_add_subtodo') {
          result = unifiedTasksService.addSubtodo(data?.taskId, data?.subtodo);
        } else if (event === 'unified_tasks_update_subtodo') {
          result = unifiedTasksService.updateSubtodo(data?.taskId, data?.subtodoId, data?.updates);
        } else if (event === 'unified_tasks_toggle_subtodo') {
          result = unifiedTasksService.toggleSubtodo(data?.taskId, data?.subtodoId);
        } else if (event === 'unified_tasks_delete_subtodo') {
          result = unifiedTasksService.deleteSubtodo(data?.taskId, data?.subtodoId);
        } else if (event === 'unified_tasks_add_agent_assignment') {
          result = unifiedTasksService.addAgentAssignment(data?.taskId, data?.assignment);
        } else if (event === 'unified_tasks_update_agent_assignment') {
          result = unifiedTasksService.updateAgentAssignment(data?.taskId, data?.assignmentId, data?.updates);
        } else if (event === 'unified_tasks_delete_agent_assignment') {
          result = unifiedTasksService.deleteAgentAssignment(data?.taskId, data?.assignmentId);
        }

        if (id) {
          ws.send(JSON.stringify({
            type: 'response',
            id,
            event: event + '_response',
            data: result,
            source: 'desktop-main'
          }));
        }
      }
    } catch (e) {
      console.error('[stuards] Error in unified tasks message handler:', e);
    }
  });
}

function ensureAgentWs(): Promise<WebSocket> {
  if (agentWs && agentWs.readyState === WebSocket.OPEN) {
    attachUnifiedTasksListener(agentWs);
    return Promise.resolve(agentWs);
  }
  if (agentReady) return agentReady;
  agentReady = new Promise<WebSocket>((resolve, reject) => {
    try {
      const url = getAgentWsUrl();
      const ws = new WebSocket(url);
      const to = setTimeout(() => {
        try { ws.terminate(); } catch { }
        reject(new Error('agent_ws_timeout'));
      }, 10000);
      ws.on('open', () => {
        clearTimeout(to);
        agentWs = ws;
        attachUnifiedTasksListener(ws);
        resolve(ws);
      });
      ws.on('error', (e: Error) => {
        clearTimeout(to);
        reject(e);
      });
      ws.on('close', () => {
        agentWs = null;
        agentReady = null;
      });
    } catch (e) {
      reject(e as any);
    }
  });
  return agentReady;
}

export async function execLocalTool(tool: string, args: any): Promise<any> {
  const ws = await ensureAgentWs();
  const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = { type: 'tool_exec', id, tool, args } as any;
  return new Promise((resolve) => {
    let done = false;
    let timeoutId: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
      ws.off('message', onMessage);
      ws.off('close', onClose);
    };

    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const s = raw.toString('utf8');
        const msg = JSON.parse(s);
        const t = String(msg?.type || '').toLowerCase();
        if (t === 'tool_event' && String(msg?.id || '') === id) {
          if (String(msg?.status || '') === 'approval_required') {
            if (!done) {
              done = true;
              cleanup();
              resolve({ ok: false, error: 'approval_required' });
            }
          }
          return;
        }
        if (t === 'tool_result' && String(msg?.id || '') === id) {
          if (!done) {
            done = true;
            cleanup();
            resolve(msg?.result ?? { ok: false, error: 'invalid_result' });
          }
          return;
        }
      } catch { }
    };

    const onClose = () => {
      if (!done) {
        done = true;
        cleanup();
        resolve({ ok: false, error: 'agent_ws_closed' });
      }
    };

    ws.on('message', onMessage);
    ws.once('close', onClose);
    
    timeoutId = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ ok: false, error: 'timeout' });
    }, 60000);
    
    try { 
      ws.send(JSON.stringify(payload)); 
    } catch {
      if (!done) {
        done = true;
        cleanup();
        resolve({ ok: false, error: 'send_failed' });
      }
    }
  });
}

function getStuardsDir() {
  const dir = path.join(app.getPath("userData"), "stuards");
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { }
  return dir;
}

export function safeStuardId(id: string) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function getStuardPathById(id: string) {
  return path.join(getStuardsDir(), `${id}.json`);
}

export function stuards_list() {
  try {
    const dir = getStuardsDir();
    const files = (fs.readdirSync(dir) || []).filter(f => f.endsWith('.json'));
    const items = files.map(f => {
      const id = f.replace(/\.json$/i, '');
      const p = path.join(dir, f);
      let name = id;
      let updatedAt = '';
      let triggers: string[] = [];
      try {
        const stat = fs.statSync(p);
        updatedAt = new Date(stat.mtimeMs).toISOString();
        const raw = fs.readFileSync(p, 'utf-8');
        const j = JSON.parse(raw || '{}');
        if (j && typeof j.name === 'string' && j.name.trim()) name = j.name.trim();
        if (Array.isArray(j?.triggers)) {
          triggers = (j.triggers as any[]).map((t: any) => String(t?.type || '')).filter((s: string) => !!s);
        }
      } catch { }
      const hasRuntime = stuardRuntimes.has(id);
      return { id, name, updatedAt, hasRuntime, triggers, isRunning: hasRuntime };
    });
    return { ok: true, items };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

async function aiVisionStructured(args: any): Promise<{ ok: boolean; object?: any; error?: string }> {
  try {
    const aiConfig = args.__aiConfig as OllamaConfig | undefined;
    if (aiConfig?.provider === 'ollama') {
      const promptText = String(args?.prompt || '').trim() || 'Analyze the image and return structured results.';
      const imagePath = String(args?.imagePath || args?.filePath || '').trim();
      const schema = args?.schema;

      if (!imagePath) return { ok: false, error: 'missing_imagePath' };

      let imageB64: string;
      try {
        const buf = fs.readFileSync(imagePath);
        imageB64 = buf.toString('base64');
      } catch (e: any) {
        return { ok: false, error: 'read_image_failed' };
      }

      const prompt = `
${promptText}

Analyze the image and fill the schema.
`;

      const msg = {
        role: 'user',
        content: prompt,
        images: [imageB64]
      };

      const res = await callOllama(aiConfig, [msg], { format: schema });
      if (!res.ok) return { ok: false, error: res.error };

      return { ok: true, object: res.content };
    }

    const base = String(process.env.CLOUD_AI_HTTP || '').trim();
    if (!base) return { ok: false, error: 'cloud_ai_unset' };
    const url = new URL('/inference/ai/vision-structured', base).toString();

    const prompt = String(args?.prompt || '').trim() || 'Analyze the image and return structured results.';
    const imagePath = String(args?.imagePath || args?.filePath || '').trim();
    const mimeType = String(args?.mimeType || 'image/jpeg');
    const schema = args?.schema;

    if (!imagePath) return { ok: false, error: 'missing_imagePath' };
    if (!schema || typeof schema !== 'object') return { ok: false, error: 'missing_schema' };

    let imageB64: string;
    try {
      const buf = fs.readFileSync(imagePath);
      imageB64 = buf.toString('base64');
    } catch (e: any) {
      return { ok: false, error: 'read_image_failed' };
    }

    const payload = { prompt, imageB64, mimeType, schema };
    const resp = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !j?.ok) {
      return { ok: false, error: String(j?.error || 'ai_failed') };
    }
    return { ok: true, object: j.object };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'ai_failed') };
  }
}

export function stuards_read(id: string) {
  try {
    const safe = safeStuardId(id);
    if (!safe) return { ok: false, error: 'invalid_id' };
    const p = getStuardPathById(safe);
    if (!fs.existsSync(p)) return { ok: false, error: 'not_found' };
    const content = fs.readFileSync(p, 'utf-8');
    return { ok: true, id: safe, content };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function stuards_save(payload: { id: string; content: string }) {
  try {
    const safe = safeStuardId(String(payload?.id || ''));
    const content = String(payload?.content || '');
    if (!safe) return { ok: false, error: 'invalid_id' };
    try { JSON.parse(content); } catch { return { ok: false, error: 'invalid_json' }; }
    const p = getStuardPathById(safe);
    fs.writeFileSync(p, content, { encoding: 'utf-8' });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

function logStuard(id: string, message: string) {
  const payload = { stuardId: id, ts: new Date().toISOString(), message } as any;
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send('stuards:log', payload); } catch { }
    }
  } catch { }
}

function pickStartStep(spec: StuardSpec): StuardStep | null {
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  if (!steps.length) return null;
  if (spec.start) return steps.find(s => s.id === spec.start) || steps[0];
  return steps[0];
}

function getAtPath(obj: any, pathStr: string, defaultVal?: any) {
  try {
    const parts = String(pathStr || '').split('.').filter(Boolean);
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return defaultVal;
      cur = cur[p];
    }
    return cur === undefined ? defaultVal : cur;
  } catch {
    return defaultVal;
  }
}

function jsonLogic(logic: any, data: any): any {
  // Minimal JSONLogic subset: var, ==, !=, >, <, >=, <=, and, or, !/not, in
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
    case '!':
    case 'not': return !a(val);
    case 'in': {
      const needle = a(val[0]);
      const hay = a(val[1]);
      if (typeof hay === 'string') return hay.indexOf(String(needle)) !== -1;
      if (Array.isArray(hay)) return hay.includes(needle);
      return false;
    }
    default:
      return undefined;
  }
}

function evalIfGuard(logic: any, ctx: any): boolean {
  try { return !!jsonLogic(logic, ctx); } catch { return false; }
}

function deepMerge(base: any, patch: any): any {
  if (patch == null) return base;
  if (base == null) return patch;
  if (Array.isArray(base) && Array.isArray(patch)) return patch.slice();
  if (typeof base === 'object' && typeof patch === 'object') {
    const out: any = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(base[k], patch[k]);
    }
    return out;
  }
  return patch;
}

function interpolate(input: any, ctx: any): any {
  // Resolve templates iteratively from inside-out to support nested syntax like {{arr[{{i}}]}}
  const templ = (s: string) => {
    let result = s;
    let maxIterations = 10; // Prevent infinite loops
    while (maxIterations-- > 0) {
      // Match innermost {{...}} that contains no nested braces
      const newResult = result.replace(/\{\{([^{}]+)\}\}/g, (_m, g1) => {
        const path = String(g1 || '').trim();
        const v = getAtPath(ctx, path, '');
        if (v == null) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      });
      if (newResult === result) break; // No more replacements
      result = newResult;
    }
    return result;
  };
  const walk = (v: any): any => {
    if (typeof v === 'string') return templ(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o: any = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  return walk(input);
}

async function callOllama(config: OllamaConfig, messages: any[], options: { format?: any } = {}): Promise<any> {
  try {
    const baseUrl = (config.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const model = config.model || 'llama3';
    const url = `${baseUrl}/api/chat`;

    const body: any = {
      model,
      messages,
      stream: false,
    };

    if (options.format) {
      body.format = options.format;
    }

    const resp = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      return { ok: false, error: `ollama_error_${resp.status}` };
    }

    const data: any = await resp.json();
    if (data && data.message && data.message.content) {
      let content = data.message.content;
      // If structured output was requested (json or schema), try to parse it
      if (options.format) {
        try {
          if (typeof content === 'string') {
            content = JSON.parse(content);
          }
        } catch (e) {
          // Fallback: try to find JSON block if strict parse fails (though schema mode should prevent this)
          if (typeof content === 'string') {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                content = JSON.parse(jsonMatch[0]);
              } catch { }
            }
          }
        }
      }
      return { ok: true, content };
    }

    return { ok: false, error: 'ollama_invalid_response' };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'ollama_failed') };
  }
}

async function aiDecideNext(spec: StuardSpec, step: StuardStep, ctx: any, options: StuardEdge[], aiCfg: any): Promise<{ next?: string; argsPatch?: any; ok: boolean; error?: string }> {
  try {
    // Check for local AI config
    const globalAi = spec.globals?.ai;
    const useOllama = globalAi?.provider === 'ollama';

    if (useOllama) {
      const config = globalAi as OllamaConfig;
      const instruction = String(aiCfg?.instruction || '');
      const prompt = `
You are an agentic workflow router.
Current Step: ${step.id}
Instruction: ${instruction}
Context Keys: ${Object.keys(ctx).join(', ')}

Available Options (Next Steps):
${options.map(o => `- ${o.to} (Label: ${o.label || o.to})`).join('\n')}

Context Data:
${JSON.stringify(ctx, null, 2)}

Analyze the context and instruction to decide the best next step from the available options.
Return a JSON object with:
- "next": The "to" value of the chosen option (must match exactly).
- "reason": A short explanation.
- "argsPatch": (Optional) A dictionary of arguments to pass/override for the next step.
`;
      const res = await callOllama(config, [{ role: 'user', content: prompt }], {
        format: {
          type: 'object',
          properties: {
            next: { type: 'string', enum: options.map(o => o.to) },
            reason: { type: 'string' },
            argsPatch: { type: 'object', additionalProperties: true }
          },
          required: ['next', 'reason']
        }
      });
      if (!res.ok) return { ok: false, error: res.error };

      const j = res.content;
      if (j && typeof j.next === 'string' && j.next) {
        // Validate "next" is a valid option
        if (options.some(o => o.to === j.next)) {
          return { ok: true, next: j.next, argsPatch: j.argsPatch };
        }
        return { ok: false, error: `ollama_invalid_choice: ${j.next}` };
      }
      return { ok: false, error: 'ollama_invalid_structure' };
    }

    const base = String(process.env.CLOUD_AI_HTTP || '').trim();
    if (!base) return { ok: false, error: 'cloud_ai_unset' };
    const url = new URL('/inference/workflow/next', base).toString();
    const body = {
      context: {
        step: { id: step.id, name: step.id },
        ctx,
        options: options.map(o => ({ to: o.to, label: o.label || o.to })),
        instruction: String(aiCfg?.instruction || ''),
        produceArgs: !!aiCfg?.produceArgs,
      },
    };
    const resp = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j: any = await resp.json().catch(() => ({}));
    if (resp.ok && j && typeof j.next === 'string' && j.next) {
      return { ok: true, next: j.next, argsPatch: j.argsPatch };
    }
    return { ok: false, error: String(j?.error || 'ai_invalid_response') };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'ai_failed') };
  }
}

async function executeStep(spec: StuardSpec, step: StuardStep, ctx: any): Promise<{ nextId?: string; ctx: any; ok: boolean; error?: string }> {
  // Execute tool (skeleton)
  try {
    const patchForThis = (ctx && ctx.__argsPatch && ctx.__argsPatch[step.id]) ? ctx.__argsPatch[step.id] : undefined;
    const mergedArgs = interpolate(deepMerge(step.args || {}, patchForThis || {}), ctx);
    if (step.tool === 'log') {
      const msg = String(mergedArgs?.message || mergedArgs?.msg || step.id);
      logStuard(spec.id, msg);
      (ctx as any)[step.id] = { ok: true, logged: msg };
    } else if (step.tool === 'run_command') {
      const result = await execLocalTool('run_command', mergedArgs);
      (ctx as any)[step.id] = result;
      if (!result?.ok) return { ok: false, error: String(result?.error || 'run_command_failed'), ctx };
    } else if (step.tool === 'run_python_script') {
      const args = { ...mergedArgs };
      if (args.path && typeof args.path === 'string' && !path.isAbsolute(args.path)) {
        const workflowsDir = path.join(app.getPath('userData'), 'workflows');
        const p = path.join(workflowsDir, args.path);
        try {
          if (fs.existsSync(p)) {
            args.path = p;
          }
        } catch { }
      }
      const result = await execLocalTool('run_python_script', args);
      (ctx as any)[step.id] = result;
      if (!result?.ok) return { ok: false, error: String(result?.error || 'run_python_script_failed'), ctx };
    } else if (step.tool === 'wait') {
      const msRaw = mergedArgs?.ms ?? mergedArgs?.milliseconds ?? mergedArgs?.delayMs;
      const ms = Math.max(0, Number(msRaw || 0));
      if (ms > 0) {
        await new Promise(resolve => setTimeout(resolve, ms));
      }
      (ctx as any)[step.id] = { ok: true, waitedMs: ms };
    } else if (step.tool === 'run_sequential') {
      const stepsArr = Array.isArray((mergedArgs as any)?.steps) ? (mergedArgs as any).steps : [];
      const continueOnError = !!(mergedArgs as any)?.continueOnError;
      const results: any[] = [];
      let firstError: string | undefined;
      for (let index = 0; index < stepsArr.length; index++) {
        const s: any = stepsArr[index];
        const toolName = String((s?.tool || '').trim());
        if (!toolName) continue;

        const subStep: StuardStep = {
          id: String(s?.id || `${step.id}__${index}`),
          tool: toolName,
          args: s?.args || {},
        };

        let subExec: { ok: boolean; error?: string; ctx: any };
        try {
          subExec = await executeStep(spec, subStep, ctx);
        } catch (e: any) {
          subExec = { ok: false, error: String(e?.message || 'failed'), ctx };
        }

        ctx = subExec.ctx || ctx;
        const subResult = (ctx as any)[subStep.id];
        const ok = !!subExec.ok;
        results.push({ tool: toolName, ok, result: subResult, error: subExec.error });
        if (!ok) {
          if (!firstError) firstError = String(subExec.error || `${toolName}_failed`);
          if (!continueOnError) break;
        }
      }
      const allOk = results.every((r: any) => (r.ok ?? true) === true);
      const combined: any = {};
      try {
        let autoIdx = 0;
        for (const it of results) {
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
      (ctx as any)[step.id] = { ok: allOk, results, combined, firstError };
      if (!allOk) return { ok: false, error: String(firstError || 'run_sequential_failed'), ctx };
    } else if (step.tool === 'run_parallel') {
      const stepsArr = Array.isArray((mergedArgs as any)?.steps) ? (mergedArgs as any).steps : [];
      const results: any[] = new Array(stepsArr.length);
      await Promise.all(stepsArr.map(async (s: any, index: number) => {
        const toolName = String((s?.tool || '').trim());
        if (!toolName) {
          results[index] = { tool: '', ok: true, result: undefined };
          return;
        }
        const subArgs = s?.args || {};
        let subResult: any;
        try {
          subResult = await execLocalTool(toolName, subArgs);
        } catch (e: any) {
          subResult = { ok: false, error: String(e?.message || 'failed') };
        }
        const ok = (subResult && typeof subResult.ok === 'boolean') ? !!subResult.ok : true;
        results[index] = { tool: toolName, ok, result: subResult };
      }));
      const allOk = results.every((r: any) => (r?.ok ?? true) === true);
      const combined: any = {};
      try {
        let autoIdx = 0;
        for (const it of results) {
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
      (ctx as any)[step.id] = { ok: allOk, results, combined };
      if (!allOk) return { ok: false, error: 'run_parallel_failed', ctx };
    } else if (step.tool === 'analyze_current_screen') {
      const shot = await execLocalTool('take_screenshot', {});
      const filePath = String((shot as any)?.filePath || (shot as any)?.path || '');
      if (!filePath) {
        const result = { ok: false, error: 'screenshot_failed' };
        (ctx as any)[step.id] = result;
        logStuard(spec.id, `${step.id}: analyze_current_screen -> screenshot_failed`);
        return { ok: false, error: result.error, ctx };
      }
      const visionArgs: any = {
        ...mergedArgs,
        imagePath: filePath,
        __aiConfig: spec.globals?.ai,
      };
      const modeRaw = String((mergedArgs as any)?.mode || '').toLowerCase();
      const useBooleanMode = modeRaw === 'boolean' || modeRaw === 'bool';
      if (!visionArgs.schema) {
        if (useBooleanMode) {
          const boolKey = String((mergedArgs as any)?.booleanKey || 'value');
          visionArgs.schema = {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              [boolKey]: { type: 'boolean' },
            },
          };
        } else {
          visionArgs.schema = {
            type: 'object',
            properties: {
              summary: { type: 'string' },
            },
          };
        }
      }
      const result = await aiVisionStructured(visionArgs);
      try {
        const raw: any = (result as any)?.object ?? result;
        const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
        logStuard(spec.id, `${step.id}: analyze_current_screen -> ${s}`);
      } catch { }
      const stepOut: any = { ...(result || {}), filePath };
      try {
        const obj: any = (result as any)?.object;
        if (obj && typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) {
            stepOut[k] = v;
            (ctx as any)[k] = v;
          }
        }
      } catch { }
      (ctx as any)[step.id] = stepOut;
      if (!result?.ok) return { ok: false, error: String(result?.error || 'analyze_current_screen_failed'), ctx };
    } else if (step.tool === 'cloud_ai_vision') {
      const visionArgs = { ...mergedArgs, __aiConfig: spec.globals?.ai };
      const result = await aiVisionStructured(visionArgs);
      (ctx as any)[step.id] = result;
      if (!result?.ok) return { ok: false, error: String(result?.error || 'cloud_ai_vision_failed'), ctx };
    } else {
      // Route any other tool name to the local Python agent via WS
      if (typeof step.tool === 'string' && step.tool.trim()) {
        const result = await execLocalTool(step.tool, mergedArgs);
        (ctx as any)[step.id] = result;
        if (!result?.ok) return { ok: false, error: String(result?.error || `${step.tool}_failed`), ctx };
      } else {
        (ctx as any)[step.id] = { ok: true };
      }
    }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'step_failed'), ctx };
  }

  // Decide next
  const edges = Array.isArray(step.next) ? step.next : [];
  for (const edge of edges) {
    const g = edge.guard;
    if (!g || g === 'always') {
      return { ok: true, nextId: edge.to, ctx };
    }
    if (g && typeof g === 'object' && g.if) {
      try {
        const pass = evalIfGuard(g.if, ctx);
        if (pass) return { ok: true, nextId: edge.to, ctx };
      } catch { }
    }
    if (g && typeof g === 'object' && g.ai) {
      // AI decision: if the AI cannot pick a route (no_routing_decision), fall back or end gracefully instead of hard erroring.
      const options = edges.filter(e => e.to).map(e => ({ to: e.to, label: e.label }));
      try {
        logStuard(spec.id, `${step.id}: ai_route_request options=${JSON.stringify(options)}`);
      } catch { }
      const out = await aiDecideNext(spec, step, ctx, options, g.ai);
      try {
        logStuard(spec.id, `${step.id}: ai_route_response result=${JSON.stringify(out)}`);
      } catch { }
      if (!out.ok) {
        const fb = step.fallback && typeof step.fallback.to === 'string' ? step.fallback.to : '';
        const err = String(out.error || '');
        if (err === 'no_routing_decision') {
          if (fb) {
            logStuard(spec.id, `${step.id}: ai_route -> no_routing_decision, using fallback to ${fb}`);
            return { ok: true, nextId: fb, ctx };
          }
          // Treat as "no next" but not an error; stop at this step.
          logStuard(spec.id, `${step.id}: ai_route -> no_routing_decision, stopping with no next step`);
          return { ok: true, ctx };
        }
        if (fb) {
          logStuard(spec.id, `${step.id}: ai_route_error=${err}, using fallback to ${fb}`);
          return { ok: true, nextId: fb, ctx };
        }
        return { ok: false, error: out.error || 'ai_failed', ctx };
      }
      if (out.argsPatch && out.next) {
        try {
          if (!ctx.__argsPatch) ctx.__argsPatch = {};
          ctx.__argsPatch[out.next] = deepMerge(ctx.__argsPatch[out.next] || {}, out.argsPatch);
        } catch { }
      }
      if (out.next) {
        try { logStuard(spec.id, `${step.id}: ai_route -> next=${out.next}`); } catch { }
      }
      return { ok: true, nextId: out.next, ctx };
    }
  }
  // No edge matched
  if (step.fallback && typeof step.fallback.to === 'string' && step.fallback.to) {
    return { ok: true, nextId: step.fallback.to, ctx };
  }
  return { ok: true, ctx };
}

export async function runStuardOnce(id: string, payload?: any) {
  const safe = safeStuardId(id);
  const p = getStuardPathById(safe);
  if (!fs.existsSync(p)) throw new Error('not_found');
  const spec: StuardSpec = JSON.parse(fs.readFileSync(p, 'utf-8'));
  logStuard(safe, 'Run started');
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const map = new Map<string, StuardStep>();
  for (const s of steps) map.set(s.id, s);
  let current = pickStartStep(spec);
  const ctx: any = {};
  // Initialize input/webhook payloads.
  //
  // Semantics:
  // - For webhook runs, existing callers pass the raw HTTP body as `payload`.
  //   We treat it as both ctx.input and ctx.webhook for backwards compatibility.
  // - For manual/agent runs, callers should pass an object like { input: {...} }.
  //   We only assign ctx.input (and ctx.webhook if explicitly provided).
  if (payload !== undefined) {
    try {
      if (payload && typeof payload === 'object' && ('input' in payload || 'webhook' in payload)) {
        const pAny: any = payload;
        if (pAny.input !== undefined) ctx.input = pAny.input;
        if (pAny.webhook !== undefined) ctx.webhook = pAny.webhook;
      } else {
        ctx.input = payload;
        ctx.webhook = payload;
      }
    } catch { }
  }
  let guard = 0;
  while (current && guard < 500) {
    guard++;
    const out = await executeStep(spec, current, ctx);
    if (!out.ok) {
      logStuard(safe, `Error at step ${current.id}: ${out.error || 'failed'}`);
      break;
    }
    if (!out.nextId) break;
    const next = map.get(out.nextId);
    if (!next) {
      logStuard(safe, `Next step not found: ${out.nextId}`);
      break;
    }
    current = next;
  }
  logStuard(safe, 'Run completed');
}

export function startStuardRuntime(id: string) {
  const safe = safeStuardId(id);
  if (stuardRuntimes.has(safe)) return;
  let spec: StuardSpec | null = null;
  try {
    const p = getStuardPathById(safe);
    const raw = fs.readFileSync(p, 'utf-8');
    spec = JSON.parse(raw || '{}');
  } catch { }
  if (!spec) return;
  const rt: StuardRuntime = { id: safe, timers: [], hotkeys: [], cronJobs: [] };
  const triggers = Array.isArray(spec.triggers) ? spec.triggers : [];
  for (const t of triggers) {
    const type = String(t?.type || '').trim();
    const args = t?.args || {};
    if (type === 'manual') {
      // no-op: will be triggered explicitly via stuards:run
    } else if (type === 'app_start') {
      // fire immediately
      try { runStuardOnce(safe); } catch { }
    } else if (type === 'one_time') {
      const ts = String(args?.at || args?.timestamp || '');
      const at = Date.parse(ts);
      if (!Number.isFinite(at)) continue;
      const delay = Math.max(0, at - Date.now());
      try {
        const h = setTimeout(() => { try { runStuardOnce(safe); } catch { } }, delay);
        rt.timers.push(h);
      } catch { }
    } else if (type === 'schedule.cron' && nodeCron && typeof nodeCron.schedule === 'function') {
      const cronExp = String(args?.cron || '*/5 * * * *');
      try {
        const job = nodeCron.schedule(cronExp, () => {
          try { runStuardOnce(safe); } catch { }
        });
        try { job.start?.(); } catch { }
        rt.cronJobs.push(job);
      } catch { }
    } else if (type === 'webhook.local') {
      webhookEnabledStuards.add(safe);
    } else if (type === 'hotkey') {
      const accel = String(args?.accelerator || 'CommandOrControl+Alt+K');
      try {
        try { globalShortcut.unregister(accel); } catch { }
        const ok = globalShortcut.register(accel, () => {
          try { runStuardOnce(safe); } catch { }
        });
        rt.hotkeys.push(accel);
        try {
          const reg = globalShortcut.isRegistered(accel);
          if (ok && reg) logStuard(safe, `Hotkey registered: ${accel}`);
          else logStuard(safe, `Hotkey FAILED to register: ${accel} (isRegistered=${reg})`);
        } catch { }
      } catch (e: any) {
        try { logStuard(safe, `Hotkey error for ${accel}: ${String(e?.message || e)}`); } catch { }
      }
    }
  }
  stuardRuntimes.set(safe, rt);
  logStuard(safe, `Stuard runtime started (${triggers.length} triggers)`);
}

export function stopStuardRuntime(id: string) {
  const safe = safeStuardId(id);
  const rt = stuardRuntimes.get(safe);
  if (!rt) return;
  try { for (const t of rt.timers) { try { clearTimeout(t); } catch { } } } catch { }
  try { for (const j of rt.cronJobs) { try { j.stop?.(); } catch { } } } catch { }
  try { for (const a of rt.hotkeys) { try { globalShortcut.unregister(a); } catch { } } } catch { }
  stuardRuntimes.delete(safe);
  logStuard(safe, 'Stuard runtime stopped');
  webhookEnabledStuards.delete(safe);
}

export function stuards_deploy(id: string) {
  try { startStuardRuntime(id); return { ok: true }; } catch (e: any) { return { ok: false, error: String(e?.message || 'failed') }; }
}

export function stuards_stop(id: string) {
  try { stopStuardRuntime(id); return { ok: true }; } catch (e: any) { return { ok: false, error: String(e?.message || 'failed') }; }
}

export function stuards_run(id: string, input?: any) {
  try {
    // For manual runs, treat the second argument as the initial ctx.input payload.
    // It will be available inside the Stuard as ctx.input (and spec steps can use
    // string interpolation like {{ input.filePath }}).
    if (typeof input === 'undefined') {
      runStuardOnce(id);
    } else {
      runStuardOnce(id, { input });
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function stuards_autostart() {
  try {
    const dir = getStuardsDir();
    const files = (fs.readdirSync(dir) || []).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        const spec: StuardSpec = JSON.parse(raw || '{}');
        if (spec && spec.autostart) startStuardRuntime(spec.id);
      } catch { }
    }
  } catch { }
}
