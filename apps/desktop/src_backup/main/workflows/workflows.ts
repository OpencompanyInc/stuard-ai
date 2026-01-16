import { app, BrowserWindow, globalShortcut, net } from "electron";
import * as http from "http";
import * as fs from "fs";
import path from "path";
import { ChildProcess } from "child_process";
import { getOutlookAccessTokenLocal } from "../integrations/outlook";
import { handleStuardWebhook, runStuardOnce, stuards_save, StuardSpec, stopStuardRuntime, getStuardPathById } from "../stuards";
import { runStuardEngine, EngineContext, stopStuardEngineRuns, isStuardEngineRunning } from "../engine";
import { prepareForSave, prepareForLoad, isEncrypted } from "../crypto";
import { setVariable, initializeWorkflowVariables, cleanupWorkflowVariables } from "../workflow-variables";

let chokidar: any = null;
try { chokidar = require('chokidar'); } catch { }
let nodeCron: any = null;
try { nodeCron = require('node-cron'); } catch { }
let uiohook: any = null;
try {
  uiohook = require('uiohook-napi');
  console.log('[Workflows] uiohook-napi loaded successfully');
} catch (e) {
  console.error('[Workflows] Failed to load uiohook-napi:', e);
}

// Keystroke capture state
let keystrokeHookStarted = false;
const keystrokeListeners = new Map<string, { flowId: string; sequence: string; buffer: string; timeout: NodeJS.Timeout | null; triggerId?: string }>();

// Pass-through hotkey state (non-blocking hotkeys using uiohook)
interface PassthroughHotkeyListener {
  flowId: string;
  accelerator: string;
  modifiers: Set<string>; // 'ctrl', 'alt', 'shift', 'meta'
  key: string; // The main key (lowercase)
  triggerId?: string;
}
const passthroughHotkeyListeners = new Map<string, PassthroughHotkeyListener>();
const activeModifiers = new Set<string>(); // Track currently held modifiers

function startKeystrokeHook() {
  if (keystrokeHookStarted || !uiohook) return;
  try {
    const { uIOhook, UiohookKey } = uiohook;

    // Map key codes to characters
    const keyMap: Record<number, string> = {};
    for (const [name, code] of Object.entries(UiohookKey)) {
      if (typeof code === 'number') {
        const char = name.length === 1 ? name.toLowerCase() : '';
        if (char) keyMap[code] = char;
      }
    }
    // Add special keys
    keyMap[UiohookKey.Space] = ' ';
    keyMap[UiohookKey.Enter] = '\n';

    // Modifier key codes (explicit codes for reliability)
    // See: https://github.com/pqrs-org/Karabiner-Elements/issues/925#issuecomment-626178578
    const modifierKeys: Record<number, string> = {
      // Left/Right Ctrl
      29: 'ctrl',      // LeftCtrl
      3613: 'ctrl',    // RightCtrl (0xE1D)
      // Left/Right Alt
      56: 'alt',       // LeftAlt
      3640: 'alt',     // RightAlt (0xE38)
      // Left/Right Shift
      42: 'shift',     // LeftShift
      54: 'shift',     // RightShift
      // Left/Right Meta/Win
      3675: 'meta',    // LeftMeta (0xE5B)
      3676: 'meta',    // RightMeta (0xE5C)
    };

    console.log('[Workflows] Keystroke hook modifier keys configured');

    uIOhook.on('keydown', (e: any) => {
      // Track modifiers
      const modifier = modifierKeys[e.keycode];
      if (modifier) {
        activeModifiers.add(modifier);
        return;
      }

      const char = keyMap[e.keycode] || '';

      // Check pass-through hotkey listeners first
      if (char && passthroughHotkeyListeners.size > 0) {
        for (const [listenerId, listener] of passthroughHotkeyListeners.entries()) {
          // Check if key matches
          if (char.toLowerCase() !== listener.key) continue;

          // Check if all required modifiers are active
          let modifiersMatch = true;
          for (const mod of listener.modifiers) {
            if (!activeModifiers.has(mod)) {
              modifiersMatch = false;
              break;
            }
          }

          // Check that no extra modifiers are held (strict matching)
          if (modifiersMatch && activeModifiers.size === listener.modifiers.size) {
            console.log('[Workflows] Pass-through hotkey matched:', listener.accelerator);
            // Execute asynchronously to not block
            setImmediate(() => {
              executeWorkflowFromTrigger(listener.flowId, `hotkey.passthrough:${listener.accelerator}`, { accelerator: listener.accelerator }, listener.triggerId);
            });
          }
        }
      }

      // Continue with keystroke sequence handling
      if (!char) return;

      // Update all keystroke listeners
      for (const [listenerId, listener] of keystrokeListeners.entries()) {
        // Reset timeout
        if (listener.timeout) clearTimeout(listener.timeout);

        // Add character to buffer
        listener.buffer += char;

        // Keep buffer limited to sequence length + some padding
        if (listener.buffer.length > listener.sequence.length * 2) {
          listener.buffer = listener.buffer.slice(-listener.sequence.length);
        }

        // Check if sequence matches
        if (listener.buffer.endsWith(listener.sequence)) {
          console.log('[Workflows] Keystroke sequence matched:', listener.sequence);
          executeWorkflowFromTrigger(listener.flowId, `keystroke:${listener.sequence}`, { sequence: listener.sequence }, listener.triggerId);
          listener.buffer = ''; // Reset buffer after match
        }

        // Clear buffer after 2 seconds of inactivity
        listener.timeout = setTimeout(() => {
          listener.buffer = '';
        }, 2000);
      }
    });

    // Track modifier release
    uIOhook.on('keyup', (e: any) => {
      const modifier = modifierKeys[e.keycode];
      if (modifier) {
        activeModifiers.delete(modifier);
      }
    });

    uIOhook.start();
    keystrokeHookStarted = true;
    console.log('[Workflows] Keystroke hook started');
  } catch (e) {
    console.error('[Workflows] Failed to start keystroke hook:', e);
  }
}

function stopKeystrokeHook() {
  if (!keystrokeHookStarted || !uiohook) return;
  try {
    // Only stop if no listeners remain
    if (keystrokeListeners.size === 0 && passthroughHotkeyListeners.size === 0) {
      const { uIOhook } = uiohook;
      uIOhook.stop();
      keystrokeHookStarted = false;
      activeModifiers.clear();
      console.log('[Workflows] Keystroke hook stopped');
    }
  } catch (e) {
    console.error('[Workflows] Failed to stop keystroke hook:', e);
  }
}

// Parse accelerator string like "Ctrl+Shift+C" into modifiers and key
function parseAccelerator(accel: string): { modifiers: Set<string>; key: string } | null {
  const parts = accel.split('+').map(p => p.trim().toLowerCase());
  if (parts.length === 0) return null;

  const modifiers = new Set<string>();
  let key = '';

  for (const part of parts) {
    if (part === 'ctrl' || part === 'control' || part === 'commandorcontrol') {
      modifiers.add('ctrl');
    } else if (part === 'alt' || part === 'option') {
      modifiers.add('alt');
    } else if (part === 'shift') {
      modifiers.add('shift');
    } else if (part === 'meta' || part === 'cmd' || part === 'command' || part === 'super' || part === 'win' || part === 'windows') {
      modifiers.add('meta');
    } else {
      // This is the main key
      key = part;
    }
  }

  if (!key) return null;
  return { modifiers, key };
}

export type FlowRuntime = { id: string; fsWatchers: any[]; cronJobs: any[]; hotkeys: string[]; intervals: any[]; procs: Array<ChildProcess | null>; lastOutlookCalendarStamp?: string };

const flowRuntimes = new Map<string, FlowRuntime>();
// Map of flowId -> triggerId for webhook-enabled flows
const webhookEnabledFlows = new Map<string, string>();
const simRuns = new Map<string, NodeJS.Timeout>();
const runningFlows = new Map<string, NodeJS.Timeout>();
const runCounts = new Map<string, number>();

let localWebhookServer: http.Server | null = null;
let localWebhookPort: number = Number(process.env.LOCAL_WEBHOOK_PORT || 18080);

export function getLocalWebhookPort() {
  return localWebhookPort;
}

export function safeFlowId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function getWorkflowPathById(id: string) {
  const dir = path.join(app.getPath('userData'), 'workflows');
  return path.join(dir, `${id}.json`);
}

export function readWorkflowModel(id: string): any {
  try {
    const p = getWorkflowPathById(id);
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

export function logFlow(flowId: string, message: string) {
  const payload = { flowId, ts: new Date().toISOString(), message } as any;
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send('workflows:log', payload); } catch { }
    }
  } catch { }
}

// Convert DesignerModel (workflow builder format) to StuardSpec (execution format)
export function designerModelToStuardSpec(m: any, triggerId?: string): StuardSpec {
  const id = String(m?.id || '').trim() || 'stuard_' + Math.random().toString(36).slice(2, 8);
  const name = String(m?.name || 'My Stuard');
  const version = String(m?.version || '1');
  const autostart = !!m?.autostart;
  const nodes = Array.isArray(m?.nodes) ? m.nodes : [];
  const wires = Array.isArray(m?.wires) ? m.wires : [];
  const triggersIn = Array.isArray(m?.triggers) ? m.triggers : [];

  const steps = nodes.map((n: any) => {
    const fromId = String(n?.id || '');
    const outs = wires.filter((w: any) => String(w?.from || '') === fromId);
    const next = outs.map((w: any) => {
      const to = String(w?.to || '');
      const g = (w as any)?.guard;
      let guard: any = 'always';
      if (g && typeof g === 'object') {
        // Check for wrapped formats first
        if (g.if) {
          guard = { if: g.if };
        } else if (g.ai) {
          guard = { ai: g.ai };
        } else {
          // Raw JSONLogic guard (not wrapped in .if)
          // Check if it's empty or a trivial always-true guard like {"===": [true, true]}
          const isEmpty = !g || Object.keys(g).length === 0;
          const isAlwaysTrue = isEmpty || (g['==='] && Array.isArray(g['===']) &&
            g['==='][0] === true && g['==='][1] === true);
          if (isAlwaysTrue) {
            guard = 'always';
          } else {
            // Wrap raw JSONLogic in { if: ... } for the engine
            guard = { if: g };
          }
        }
      }
      const label = (w as any)?.label;
      const edge: any = { to, guard };
      if (label) edge.label = String(label);
      return edge;
    });
    const step: any = { id: fromId, tool: String(n?.tool || 'noop'), args: n?.args || {}, next };
    if (n?.waitForAll === true) {
      step.waitForAll = true;
    }
    if (n && typeof n.fallbackTo === 'string' && n.fallbackTo.trim()) {
      step.fallback = { to: n.fallbackTo.trim() };
    }
    return step;
  });

  // Find start node: the node that trigger wires point to, or first node with no inbound wires
  const triggerIdsSet = new Set(triggersIn.map((t: any) => String(t?.id || '')).filter(Boolean));

  let startNodeId: string | undefined;

  // If a specific triggerId is provided, use only that trigger's wire
  if (triggerId) {
    const triggerWire = wires.find((w: any) => String(w?.from || '') === triggerId);
    if (triggerWire) {
      startNodeId = String(triggerWire.to || '');
    }
  }

  // If no specific trigger or trigger not found, use legacy behavior
  if (!startNodeId) {
    const triggerTargets = wires
      .filter((w: any) => triggerIdsSet.has(String(w?.from || '')) || String(w?.from || '').startsWith('trig_'))
      .map((w: any) => String(w?.to || ''))
      .filter(Boolean);

    // Deduplicate trigger targets (in case multiple triggers point to same node)
    const uniqueTriggerTargets: string[] = Array.from(new Set(triggerTargets)) as string[];

    if (uniqueTriggerTargets.length > 1) {
      // Multiple trigger targets: create a synthetic parallel start node
      // This node is a noop that immediately branches to all targets in parallel
      const syntheticStartId = '_trigger_parallel_start';
      const parallelNext = uniqueTriggerTargets.map(targetId => ({
        to: targetId,
        guard: 'always' as const
      }));
      steps.unshift({
        id: syntheticStartId,
        tool: 'noop',
        args: {},
        next: parallelNext
      });
      startNodeId = syntheticStartId;
    } else if (uniqueTriggerTargets.length === 1) {
      // Single trigger target: use it as the start
      startNodeId = uniqueTriggerTargets[0];
    }
  }

  if (!startNodeId) {
    // Fallback: find node with no inbound wires (excluding trigger wires)
    const nodeWires = wires.filter((w: any) => !triggerIdsSet.has(String(w?.from || '')) && !String(w?.from || '').startsWith('trig_'));
    const inbound = new Set<string>(nodeWires.map((w: any) => String(w?.to || '')).filter(Boolean));
    const startNode = nodes.find((n: any) => !inbound.has(String(n?.id || ''))) || nodes[0];
    startNodeId = startNode ? String(startNode.id) : undefined;
  }
  const triggers = triggersIn.map((t: any) => ({ type: String(t?.type || ''), args: t?.args || {} }));

  return {
    id,
    name,
    version,
    autostart,
    triggers,
    steps,
    start: startNodeId
  };
}

// Emit step execution events for visual flow highlighting
export type StepExecutionStatus = 'pending' | 'running' | 'completed' | 'error';
export interface StepExecutionEvent {
  flowId: string;
  stepId: string;
  status: StepExecutionStatus;
  ts: string;
  error?: string;
  result?: any;
  wireFromId?: string; // The previous step ID for wire animation
}

export function emitStepExecution(flowId: string, stepId: string, status: StepExecutionStatus, opts?: { error?: string; result?: any; wireFromId?: string }) {
  const payload: StepExecutionEvent = {
    flowId,
    stepId,
    status,
    ts: new Date().toISOString(),
    ...opts,
  };
  console.log('[Workflows] emitStepExecution:', stepId, status);
  try {
    const windows = BrowserWindow.getAllWindows();
    console.log('[Workflows] Broadcasting to', windows.length, 'windows');
    for (const w of windows) {
      try { w.webContents.send('workflows:step', payload); } catch (e) { console.error('[Workflows] Send error:', e); }
    }
  } catch (e) { console.error('[Workflows] emitStepExecution error:', e); }
}

// Emit flow execution start/end events
export function emitFlowExecutionState(flowId: string, isRunning: boolean) {
  const payload = { flowId, isRunning, ts: new Date().toISOString() };
  console.log('[Workflows] emitFlowExecutionState:', flowId, isRunning);
  try {
    const windows = BrowserWindow.getAllWindows();
    for (const w of windows) {
      try { w.webContents.send('workflows:execution', payload); } catch (e) { console.error('[Workflows] Send error:', e); }
    }
  } catch (e) { console.error('[Workflows] emitFlowExecutionState error:', e); }
}

/**
 * Execute a workflow from a trigger (cron, file watch, webhook, etc.)
 * @param triggerId - Optional trigger ID to execute only the path connected to that specific trigger
 */
export function executeWorkflowFromTrigger(flowId: string, origin: string, payload?: any, triggerId?: string) {
  console.log('[Workflows] executeWorkflowFromTrigger called:', flowId, origin, 'triggerId:', triggerId);
  try {
    const safe = safeFlowId(flowId);
    if (!safe) return;

    const model = readWorkflowModel(safe);
    if (!model) {
      console.error('[Workflows] Workflow not found:', safe);
      return;
    }

    // Ensure workflow variables are registered and available for this run
    // Note: We don't reset here since startFlowRuntime already initialized them
    // This just ensures the registry is up to date for any late-registered variables
    if (Array.isArray(model.variables) && model.variables.length > 0) {
      initializeWorkflowVariables(safe, model.variables, false);
    }

    // Log trigger
    logFlow(safe, `Triggered (${origin})`);
    emitFlowExecutionState(safe, true);

    // Convert workflow to stuard spec, passing triggerId to use only that trigger's start node
    const spec = designerModelToStuardSpec(model, triggerId);

    // IMPORTANT: Set autostart to false when saving for execution
    // This prevents the legacy stuards system from registering hotkeys/triggers
    // which would conflict with the workflows system
    spec.autostart = false;

    // Save as stuard for execution
    const saveRes = stuards_save({ id: safe, content: JSON.stringify(spec, null, 2) });
    if (!saveRes?.ok) {
      console.error('[Workflows] Failed to save as stuard:', saveRes?.error);
      emitFlowExecutionState(safe, false);
      return;
    }

    // Build engine context
    const stuardsDir = path.join(app.getPath('userData'), 'stuards');
    const engineCtx: EngineContext = {
      stuardsDir,
      agentWsUrl: process.env.AGENT_WS_URL || 'ws://127.0.0.1:8765/ws',
      cloudAiUrl: process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || process.env.CLOUD_AI_URL || 'http://localhost:8082',
      logFn: (msg: string) => logFlow(safe, msg),
    };

    // Actually execute the workflow
    runStuardEngine(safe, payload, engineCtx).then(() => {
      console.log('[Workflows] Trigger execution completed:', safe);
      logFlow(safe, 'Run completed');
      emitFlowExecutionState(safe, false);
    }).catch((e: any) => {
      console.error('[Workflows] Trigger execution error:', e);
      logFlow(safe, `Error: ${e?.message || 'execution_failed'}`);
      emitFlowExecutionState(safe, false);
    });
  } catch (e: any) {
    console.error('[Workflows] executeWorkflowFromTrigger error:', e);
  }
}

export function startLocalWebhookServer() {
  try {
    if (localWebhookServer) return;
  } catch { }
  try {
    const create = (port: number) => {
      const srv = http.createServer((req, res) => {
        try {
          const method = String(req.method || 'GET').toUpperCase();
          const u = new URL(req.url || '/', `http://127.0.0.1:${localWebhookPort}`);
          const pathname = String(u.pathname || '').replace(/\/+$/, '');
          // CORS preflight
          if (method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Authorization, Content-Type',
              'Access-Control-Max-Age': '600',
            });
            res.end();
            return;
          }
          // Accept both:
          // - /webhooks/incoming/:id?   (canonical)
          // - /webhook/:id?            (back-compat / friendly)
          if (
            method === 'POST' &&
            (pathname === '/webhook' || pathname.startsWith('/webhook/') || pathname.startsWith('/webhooks/incoming'))
          ) {
            let topicId = '';
            if (pathname === '/webhook' || pathname.startsWith('/webhook/')) {
              topicId = pathname.split('/').slice(2).join('/'); // /webhook/<id>
            } else {
              // /webhooks/incoming/<id>
              topicId = pathname.split('/').slice(3).join('/');
            }
            topicId = (topicId || '').replace(/^\/+|\/+$/g, '');
            const chunks: Buffer[] = [];
            (req as any).on('data', (c: any) => { try { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch { } });
            (req as any).on('end', () => {
              const raw = Buffer.concat(chunks).toString('utf8');
              let json: any = null;
              try { json = JSON.parse(raw); } catch { json = null; }
              let delivered = 0;
              if (topicId) {
                const safe = safeFlowId(topicId);
                if (webhookEnabledFlows.has(safe)) {
                  const tId = webhookEnabledFlows.get(safe);
                  try { executeWorkflowFromTrigger(safe, 'webhook.local', json, tId); } catch { }
                  delivered = 1;
                }
                try { delivered += handleStuardWebhook(topicId, json); } catch { }
              } else {
                try {
                  for (const [fid, tId] of webhookEnabledFlows.entries()) {
                    try { executeWorkflowFromTrigger(fid, 'webhook.local', json, tId); delivered++; } catch { }
                  }
                } catch { }
                try { delivered += handleStuardWebhook(null, json); } catch { }
              }
              const body = JSON.stringify({ ok: true, delivered });
              try {
                res.writeHead(200, {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(body),
                  'Access-Control-Allow-Origin': '*',
                });
              } catch { }
              try { res.end(body); } catch { }
            });
            return;
          }
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end('{"ok":false,"error":"not_found"}');
        } catch {
          try { res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end('{"ok":false,"error":"internal"}'); } catch { }
        }
      });
      srv.on('error', (e: any) => {
        try {
          const code = String(((e as any) && (e as any).code) || '');
          if (code === 'EADDRINUSE') {
            // Retry with ephemeral port
            const alt = http.createServer((srv as any).listeners('request')[0] as any);
            alt.listen(0, '127.0.0.1', () => {
              try {
                const addr = alt.address();
                if (addr && typeof addr === 'object') {
                  localWebhookPort = (addr as any).port as number;
                  localWebhookServer = alt;
                }
              } catch { }
            });
            return;
          }
        } catch { }
      });
      srv.listen(port, '127.0.0.1', () => {
        try { localWebhookServer = srv; } catch { }
      });
    };
    create(localWebhookPort);
  } catch { }
}

export function startFlowRuntime(id: string) {
  const safe = safeFlowId(id);
  const model = readWorkflowModel(safe);
  const triggers = Array.isArray(model?.triggers) ? model.triggers : [];
  const rt: FlowRuntime = { id: safe, fsWatchers: [], cronJobs: [], hotkeys: [], intervals: [], procs: [] };

  // Initialize workflow variables before starting any triggers
  // This ensures variables are available when triggers fire
  if (Array.isArray(model?.variables) && model.variables.length > 0) {
    initializeWorkflowVariables(safe, model.variables, false);
  }

  let started = 0;
  for (const t of triggers) {
    const type = String(t?.type || t?.t || '').trim();
    const args = t?.args || {};
    const triggerId = String(t?.id || '').trim();

    // Skip manual triggers - they are only executed via manual invocation
    if (type === 'manual') {
      continue;
    }

    if (type === 'fs.watch' && chokidar) {
      try {
        const base = String(args?.path || '');
        const pat = String(args?.pattern || '**/*');
        const glob = base && pat ? path.join(base, pat) : (base || pat || '**/*');
        const watcher = chokidar.watch(glob, { ignoreInitial: true, persistent: true });
        const tId = triggerId; // Capture for closure
        watcher.on('add', (p: string) => executeWorkflowFromTrigger(safe, `fs.add:${p}`, { filePath: p, event: 'add' }, tId));
        watcher.on('change', (p: string) => executeWorkflowFromTrigger(safe, `fs.change:${p}`, { filePath: p, event: 'change' }, tId));
        watcher.on('unlink', (p: string) => executeWorkflowFromTrigger(safe, `fs.unlink:${p}`, { filePath: p, event: 'unlink' }, tId));
        rt.fsWatchers.push(watcher);
        started++;
      } catch { }
    } else if (type === 'schedule.cron' && nodeCron && typeof nodeCron.schedule === 'function') {
      try {
        const cronExp = String(args?.cron || '*/5 * * * *');
        const maxRunsRaw = (args as any)?.maxRuns;
        const maxRuns = Number(maxRunsRaw || 0); // 0 or NaN => unlimited
        let count = 0;
        const tId = triggerId; // Capture for closure
        const job = nodeCron.schedule(cronExp, () => {
          try {
            count++;
            if (maxRuns && count > maxRuns) {
              try { job.stop?.(); } catch { }
              return;
            }
            executeWorkflowFromTrigger(safe, 'schedule.cron', undefined, tId);
          } catch { }
        });
        try { job.start?.(); } catch { }
        rt.cronJobs.push(job);
        started++;
      } catch { }
    } else if (type === 'webhook.local') {
      webhookEnabledFlows.set(safe, triggerId);
      started++;
    } else if (type === 'hotkey') {
      const accel = String(args?.accelerator || 'CommandOrControl+Alt+K');
      const passthrough = Boolean(args?.passthrough);
      const tId = triggerId; // Capture for closure

      console.log('[Workflows] Hotkey trigger:', { accel, passthrough, uiohookLoaded: !!uiohook });

      if (passthrough && uiohook) {
        // Use pass-through mode (non-blocking via uiohook)
        const parsed = parseAccelerator(accel);
        console.log('[Workflows] Parsed accelerator:', parsed);
        if (parsed) {
          const listenerId = `${safe}_hotkey_${Date.now()}`;
          passthroughHotkeyListeners.set(listenerId, {
            flowId: safe,
            accelerator: accel,
            modifiers: parsed.modifiers,
            key: parsed.key,
            triggerId: tId,
          });
          startKeystrokeHook();
          (rt as any).passthroughHotkeyIds = (rt as any).passthroughHotkeyIds || [];
          (rt as any).passthroughHotkeyIds.push(listenerId);
          started++;
          console.log('[Workflows] Pass-through hotkey registered:', accel, 'modifiers:', [...parsed.modifiers], 'key:', parsed.key);
        } else {
          console.error('[Workflows] Failed to parse accelerator for pass-through:', accel);
        }
      } else {
        // Use blocking mode (globalShortcut) - either passthrough=false or uiohook not loaded
        if (passthrough && !uiohook) {
          console.warn('[Workflows] Pass-through requested but uiohook not available, falling back to blocking mode');
        }
        try {
          const registered = globalShortcut.register(accel, () => {
            try {
              executeWorkflowFromTrigger(safe, `hotkey:${accel}`, undefined, tId);
            } catch (e) {
              console.error('[Workflows] Hotkey trigger error:', e);
            }
          });
          if (registered) {
            rt.hotkeys.push(accel);
            started++;
            console.log('[Workflows] Hotkey registered:', accel, 'for workflow:', safe);
          } else {
            console.error('[Workflows] Failed to register hotkey:', accel, '- shortcut may be in use by another application');
          }
        } catch (e) {
          console.error('[Workflows] Exception registering hotkey:', accel, e);
        }
      }
    } else if (type === 'keystroke') {
      // Keystroke sequence trigger - fires when user types a specific sequence
      const sequence = String(args?.sequence || '').toLowerCase();
      if (sequence && uiohook) {
        try {
          const listenerId = `${safe}_${Date.now()}`;
          keystrokeListeners.set(listenerId, {
            flowId: safe,
            sequence,
            buffer: '',
            timeout: null,
            triggerId: triggerId
          });
          startKeystrokeHook();
          (rt as any).keystrokeListenerIds = (rt as any).keystrokeListenerIds || [];
          (rt as any).keystrokeListenerIds.push(listenerId);
          started++;
          console.log('[Workflows] Keystroke trigger registered:', sequence);
        } catch (e) {
          console.error('[Workflows] Failed to register keystroke trigger:', e);
        }
      }
    } else if (type === 'outlook.calendar.poll') {
      const sec = Math.max(10, Number(args?.intervalSec || 60));
      const tId = triggerId; // Capture for closure
      try {
        const h = setInterval(async () => {
          try {
            const tok = await getOutlookAccessTokenLocal();
            if (!tok?.ok || !tok?.accessToken) return;
            const url = 'https://graph.microsoft.com/v1.0/me/events?$orderby=lastModifiedDateTime%20desc&$top=1';
            const resp = await net.fetch(url, { headers: { Authorization: `Bearer ${tok.accessToken}` } });
            const j: any = await resp.json().catch(() => ({}));
            const latest = String(j?.value?.[0]?.lastModifiedDateTime || '');
            if (latest && rt.lastOutlookCalendarStamp !== latest) {
              rt.lastOutlookCalendarStamp = latest;
              executeWorkflowFromTrigger(safe, 'outlook.calendar', { lastModified: latest }, tId);
            }
          } catch { }
        }, sec * 1000);
        rt.intervals.push(h);
        started++;
      } catch { }
    }
  }
  if (started > 0) {
    flowRuntimes.set(safe, rt);
    logFlow(safe, `Watchers started (${started})`);
  }
}

export function stopFlowRuntime(id: string) {
  const safe = safeFlowId(id);
  const rt = flowRuntimes.get(safe);
  if (!rt) return;
  try { for (const w of rt.fsWatchers) { try { w.close?.(); } catch { } } } catch { }
  try { for (const j of rt.cronJobs) { try { j.stop?.(); } catch { } } } catch { }
  try { for (const a of rt.hotkeys) { try { globalShortcut.unregister(a); } catch { } } } catch { }
  try {
    // Cleanup keystroke listeners
    const listenerIds = (rt as any).keystrokeListenerIds || [];
    for (const lid of listenerIds) {
      const listener = keystrokeListeners.get(lid);
      if (listener?.timeout) clearTimeout(listener.timeout);
      keystrokeListeners.delete(lid);
    }
    // Cleanup pass-through hotkey listeners
    const hotkeyIds = (rt as any).passthroughHotkeyIds || [];
    for (const lid of hotkeyIds) {
      passthroughHotkeyListeners.delete(lid);
    }
    stopKeystrokeHook();
  } catch { }
  try { for (const t of rt.intervals) { try { clearInterval(t as any); } catch { } } } catch { }
  try { for (const p of rt.procs) { try { if (p && !p.killed) { if (process.platform === 'win32') { try { process.kill((p as any).pid); } catch { } } else { try { p.kill('SIGTERM'); } catch { } } } } catch { } } } catch { }
  webhookEnabledFlows.delete(safe);
  flowRuntimes.delete(safe);

  // Cleanup workflow variables (only non-persistent ones)
  try { cleanupWorkflowVariables(safe); } catch { }

  logFlow(safe, 'Watchers stopped');
}

/**
 * Start all workflows that have autostart: true
 * Called on app startup to enable cron triggers, hotkeys, etc.
 */
export function workflows_autostart() {
  try {
    const dir = path.join(app.getPath('userData'), 'workflows');
    if (!fs.existsSync(dir)) {
      console.log('[workflows] No workflows directory found, skipping autostart');
      return;
    }
    const files = (fs.readdirSync(dir) || []).filter(f => f.endsWith('.json'));
    console.log(`[workflows] Found ${files.length} workflow file(s), checking for autostart...`);
    let started = 0;
    for (const f of files) {
      try {
        const p = path.join(dir, f);
        const raw = fs.readFileSync(p, 'utf-8');
        const model = JSON.parse(raw || '{}');
        if (model && model.autostart) {
          const id = f.replace(/\.json$/i, '');
          const triggerTypes = (model.triggers || []).map((t: any) => t?.type || 'unknown').join(', ');

          // IMPORTANT: Clean up any legacy stuard runtime/file that might conflict
          // The legacy stuards_autostart runs before this, so we need to unregister
          // any hotkeys it registered and delete the stuard file
          try {
            stopStuardRuntime(id);
            const stuardPath = getStuardPathById(id);
            if (fs.existsSync(stuardPath)) {
              fs.unlinkSync(stuardPath);
              console.log(`[workflows] Cleaned up conflicting legacy stuard: ${id}`);
            }
          } catch (e) {
            // Ignore - stuard may not exist
          }

          console.log(`[workflows] Autostarting workflow: ${id} (${model.name || 'unnamed'}) - triggers: [${triggerTypes}]`);
          startFlowRuntime(id);
          started++;
        }
      } catch (e) {
        console.error(`[workflows] Failed to autostart workflow ${f}:`, e);
      }
    }
    if (started > 0) {
      console.log(`[workflows] Autostarted ${started} workflow(s)`);
    } else {
      console.log('[workflows] No workflows with autostart=true found');
    }
  } catch (e) {
    console.error('[workflows] Autostart failed:', e);
  }
}

export function workflows_list() {
  try {
    const dir = path.join(app.getPath('userData'), 'workflows');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { }
    const files = (fs.readdirSync(dir) || []).filter(f => f.endsWith('.json'));
    const items = files.map(f => {
      const id = f.replace(/\.json$/i, '');
      const p = path.join(dir, f);
      let name = id;
      let updatedAt = '';
      let version = '';
      let marketplaceSlug = '';
      let triggers: string[] = [];
      try {
        const stat = fs.statSync(p);
        updatedAt = new Date(stat.mtimeMs).toISOString();
        const raw = fs.readFileSync(p, 'utf-8');
        const j = JSON.parse(raw || '{}');
        if (j && typeof j.name === 'string' && j.name.trim()) name = j.name.trim();
        if (j && typeof j.version === 'string') version = j.version;
        if (j && typeof j.marketplaceSlug === 'string') marketplaceSlug = j.marketplaceSlug;
        if (Array.isArray(j?.triggers)) {
          triggers = (j.triggers as any[]).map((t: any) => String(t?.type || '')).filter((s: string) => !!s);
        }
      } catch { }
      const hasRuntime = flowRuntimes.has(id);
      const running = isStuardEngineRunning(id);
      return { id, name, updatedAt, version, marketplaceSlug, hasRuntime, running, triggers };
    });
    return { ok: true, items };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_read(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };
    const dir = path.join(app.getPath('userData'), 'workflows');
    const p = path.join(dir, `${safe}.json`);
    if (!fs.existsSync(p)) return { ok: false, error: 'not_found' };
    const rawContent = fs.readFileSync(p, 'utf-8');
    // Decrypt if encrypted (locked workflows)
    const content = prepareForLoad(rawContent);
    return { ok: true, id: safe, content };
  } catch (e: any) {
    // If decryption fails, the workflow may be from a different machine
    if (String(e?.message || '').includes('Decryption failed')) {
      return { ok: false, error: 'This locked workflow was created on a different machine and cannot be opened here.' };
    }
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_save(payload: { id: string; content: string }) {
  try {
    const safe = safeFlowId(String(payload?.id || ''));
    const content = String(payload?.content || '');
    if (!safe) return { ok: false, error: 'invalid_id' };
    try { JSON.parse(content); } catch { return { ok: false, error: 'invalid_json' }; }
    const dir = path.join(app.getPath('userData'), 'workflows');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { }
    const p = path.join(dir, `${safe}.json`);
    // Encrypt if locked workflow
    const contentToSave = prepareForSave(content);
    fs.writeFileSync(p, contentToSave, { encoding: 'utf-8' });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_delete(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };
    const dir = path.join(app.getPath('userData'), 'workflows');
    const p = path.join(dir, `${safe}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/**
 * Deploy a workflow: enable autostart and start the runtime immediately
 */
export function workflows_deploy(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };

    // Read current workflow
    const model = readWorkflowModel(safe);
    if (!model) return { ok: false, error: 'workflow_not_found' };

    // Enable autostart
    model.autostart = true;

    // Save with autostart enabled
    const dir = path.join(app.getPath('userData'), 'workflows');
    const p = path.join(dir, `${safe}.json`);
    fs.writeFileSync(p, JSON.stringify(model, null, 2), { encoding: 'utf-8' });

    // IMPORTANT: Stop and clean up any legacy stuard runtime with the same ID
    // This prevents hotkey/trigger conflicts between the old and new systems
    try {
      stopStuardRuntime(safe);
      // Delete the stuard file to prevent legacy system from picking it up on restart
      const stuardPath = getStuardPathById(safe);
      if (fs.existsSync(stuardPath)) {
        fs.unlinkSync(stuardPath);
        console.log(`[workflows] Cleaned up legacy stuard file: ${stuardPath}`);
      }
    } catch (e) {
      // Ignore errors - file may not exist or stuard may not be running
    }

    // Stop any existing runtime first to clean up old hotkeys/watchers
    stopFlowRuntime(safe);

    // Start the runtime immediately (cron jobs, hotkeys, file watchers, etc.)
    startFlowRuntime(safe);

    console.log(`[workflows] Deployed workflow: ${safe} (${model.name || 'unnamed'})`);
    return { ok: true, deployed: true, autostart: true };
  } catch (e: any) {
    console.error('[workflows] Deploy failed:', e);
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/**
 * Undeploy a workflow: disable autostart and stop the runtime
 */
export function workflows_undeploy(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };

    // Read current workflow
    const model = readWorkflowModel(safe);
    if (!model) return { ok: false, error: 'workflow_not_found' };

    // Disable autostart
    model.autostart = false;

    // Save with autostart disabled
    const dir = path.join(app.getPath('userData'), 'workflows');
    const p = path.join(dir, `${safe}.json`);
    fs.writeFileSync(p, JSON.stringify(model, null, 2), { encoding: 'utf-8' });

    // Stop the runtime
    stopFlowRuntime(safe);

    // Also stop and clean up any legacy stuard runtime
    try {
      stopStuardRuntime(safe);
      const stuardPath = getStuardPathById(safe);
      if (fs.existsSync(stuardPath)) {
        fs.unlinkSync(stuardPath);
        console.log(`[workflows] Cleaned up legacy stuard file: ${stuardPath}`);
      }
    } catch (e) {
      // Ignore - file may not exist
    }

    console.log(`[workflows] Undeployed workflow: ${safe}`);
    return { ok: true, deployed: false, autostart: false };
  } catch (e: any) {
    console.error('[workflows] Undeploy failed:', e);
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/**
 * Get deployment status for a workflow
 */
export function workflows_getDeployStatus(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };

    const model = readWorkflowModel(safe);
    if (!model) return { ok: false, error: 'workflow_not_found' };

    const hasRuntime = flowRuntimes.has(safe);
    const triggers = Array.isArray(model?.triggers) ? model.triggers.map((t: any) => String(t?.type || '')).filter(Boolean) : [];

    return {
      ok: true,
      deployed: !!model.autostart,
      running: hasRuntime,
      triggers,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_run(id: string, triggerId?: string, options?: { accessToken?: string }) {
  console.log('[Workflows] workflows_run called with id:', id, 'triggerId:', triggerId || '(all)', 'hasToken:', !!options?.accessToken);
  try {
    const safe = safeFlowId(String(id || ''));
    console.log('[Workflows] Safe ID:', safe);
    if (!safe) return { ok: false, error: 'invalid_id' };
    const model = readWorkflowModel(safe);
    console.log('[Workflows] Model loaded:', model ? 'yes' : 'no', 'triggers:', model?.triggers?.length, 'nodes:', model?.nodes?.length, 'wires:', model?.wires?.length);
    if (model?.wires) {
      for (const w of model.wires) {
        console.log(`[Workflows]   Wire: ${w.from} -> ${w.to} (guard: ${w.guard})`);
      }
    }

    if (!model) return { ok: false, error: 'workflow_not_found' };

    // Initialize workflow-level variables with their default values
    // These are accessible via {{workflow.varName}} in step args
    // Note: This respects persistState option - only non-persistent variables reset
    if (Array.isArray(model.variables) && model.variables.length > 0) {
      initializeWorkflowVariables(safe, model.variables, false);
    }

    // If a specific triggerId is provided, find the start node for that trigger
    let startNodeOverride: string | undefined;
    if (triggerId) {
      const trigger = model.triggers.find((t: any) => t.id === triggerId);
      if (!trigger) {
        return { ok: false, error: 'trigger_not_found' };
      }
      // Find the wire from this trigger to get the start node
      const triggerWire = model.wires.find((w: any) => w.from === triggerId);
      if (triggerWire) {
        startNodeOverride = triggerWire.to;
        console.log(`[Workflows] Running from trigger ${triggerId}, starting at node: ${startNodeOverride}`);
      } else {
        console.log(`[Workflows] Trigger ${triggerId} has no outgoing wire`);
        return { ok: false, error: 'trigger_has_no_connection' };
      }
    }

    // Convert workflow to stuard spec and execute it
    const spec = designerModelToStuardSpec(model);

    // If we have a specific start node from the trigger, override the start
    if (startNodeOverride) {
      spec.start = startNodeOverride;
    }

    console.log('[Workflows] Converted to StuardSpec:', spec.id, 'steps:', spec.steps?.length, 'start:', spec.start);
    for (const s of spec.steps || []) {
      console.log(`[Workflows]   Step: ${s.id}, tool: ${s.tool}, next: ${JSON.stringify(s.next?.map((n: any) => n.to) || [])}`);
    }

    // IMPORTANT: Set autostart to false when saving for execution
    // This prevents the legacy stuards system from registering hotkeys/triggers
    spec.autostart = false;

    // Save as a stuard for execution
    const saveRes = stuards_save({ id: safe, content: JSON.stringify(spec, null, 2) });
    if (!saveRes?.ok) {
      console.error('[Workflows] Failed to save as stuard:', saveRes?.error);
      return { ok: false, error: saveRes?.error || 'save_failed' };
    }

    // Log and emit execution state
    const triggerLabel = triggerId ? model.triggers.find((t: any) => t.id === triggerId)?.label || triggerId : 'all triggers';
    logFlow(safe, `Run started (${triggerLabel})`);
    emitFlowExecutionState(safe, true);

    // Build engine context
    const stuardsDir = path.join(app.getPath('userData'), 'stuards');
    const engineCtx: EngineContext = {
      stuardsDir,
      agentWsUrl: process.env.AGENT_WS_URL || 'ws://127.0.0.1:8765/ws',
      cloudAiUrl: process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || process.env.CLOUD_AI_URL || 'http://localhost:8082',
      logFn: (msg: string) => logFlow(safe, msg),
      accessToken: options?.accessToken,
    };

    // Actually execute the workflow via stuards engine (has custom_ui support)
    runStuardEngine(safe, undefined, engineCtx).then(() => {
      console.log('[Workflows] Execution completed:', safe);
      logFlow(safe, 'Run completed');
      emitFlowExecutionState(safe, false);
    }).catch((e: any) => {
      console.error('[Workflows] Execution error:', e);
      logFlow(safe, `Error: ${e?.message || 'execution_failed'}`);
      emitFlowExecutionState(safe, false);
    });

    return { ok: true };
  } catch (e: any) {
    console.error('[Workflows] workflows_run error:', e);
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_stop(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    // Stop any legacy interval-based runner (if present)
    const legacy = runningFlows.get(safe);
    if (legacy) {
      try { clearInterval(legacy as any); } catch { }
      runningFlows.delete(safe);
      runCounts.delete(safe);
    }

    // Abort any active engine runs (does NOT affect deployed triggers/runtime)
    const stopRes = stopStuardEngineRuns(safe);

    // Emit flow execution ended + log (best-effort; engine will also emit when it observes abort)
    emitFlowExecutionState(safe, false);
    logFlow(safe, stopRes.ok ? 'Run stopped' : 'Stop requested (not running)');

    return { ok: true, stopped: stopRes.ok ? stopRes.stopped : 0 };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}
