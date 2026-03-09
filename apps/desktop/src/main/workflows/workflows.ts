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
import { getTimezone } from "../settings";

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

// Hold hotkey state (fires on press AND release)
interface HoldHotkeyListener {
  flowId: string;
  accelerator: string;
  modifiers: Set<string>;
  key: string;
  triggerId?: string;
  pressed: boolean; // Track whether currently held down
}
const holdHotkeyListeners = new Map<string, HoldHotkeyListener>();

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

      // Check hold hotkey listeners (fire on press, suppress repeat)
      if (char && holdHotkeyListeners.size > 0) {
        for (const [listenerId, listener] of holdHotkeyListeners.entries()) {
          // Skip release-only listeners on keydown
          if ((listener as any).releaseOnly) continue;

          if (char.toLowerCase() !== listener.key) continue;
          let modifiersMatch = true;
          for (const mod of listener.modifiers) {
            if (!activeModifiers.has(mod)) { modifiersMatch = false; break; }
          }
          if (modifiersMatch && activeModifiers.size === listener.modifiers.size) {
            // Only fire on initial press, not on key repeat
            if (!listener.pressed) {
              listener.pressed = true;
              console.log('[Workflows] Hold hotkey PRESSED:', listener.accelerator);
              setImmediate(() => {
                executeWorkflowFromTrigger(listener.flowId, `hotkey.hold:press:${listener.accelerator}`, { accelerator: listener.accelerator, event: 'press' }, listener.triggerId);
              });
            }
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

    // Track modifier release + hold hotkey release
    uIOhook.on('keyup', (e: any) => {
      const modifier = modifierKeys[e.keycode];
      if (modifier) {
        activeModifiers.delete(modifier);
        // Also check hold listeners: if a modifier is part of a held combo, fire release
        if (holdHotkeyListeners.size > 0) {
          for (const [listenerId, listener] of holdHotkeyListeners.entries()) {
            if (listener.pressed && listener.modifiers.has(modifier)) {
              listener.pressed = false;
              console.log('[Workflows] Hold hotkey RELEASED (modifier up):', listener.accelerator);
              setImmediate(() => {
                executeWorkflowFromTrigger(listener.flowId, `hotkey.hold:release:${listener.accelerator}`, { accelerator: listener.accelerator, event: 'release' }, listener.triggerId);
              });
            }
          }
        }
        return;
      }

      // Check hold hotkey listeners for main key release
      const char = keyMap[e.keycode] || '';
      if (char && holdHotkeyListeners.size > 0) {
        for (const [listenerId, listener] of holdHotkeyListeners.entries()) {
          if (char.toLowerCase() !== listener.key) continue;

          // Check modifiers match for release-only triggers
          const isReleaseOnly = (listener as any).releaseOnly;
          if (isReleaseOnly) {
            // For release-only, check modifiers are still held
            let modifiersMatch = true;
            for (const mod of listener.modifiers) {
              if (!activeModifiers.has(mod)) { modifiersMatch = false; break; }
            }
            if (modifiersMatch && activeModifiers.size === listener.modifiers.size) {
              console.log('[Workflows] Release-only hotkey fired:', listener.accelerator);
              setImmediate(() => {
                executeWorkflowFromTrigger(listener.flowId, `hotkey.release:${listener.accelerator}`, { accelerator: listener.accelerator, event: 'release' }, listener.triggerId);
              });
            }
          } else if (listener.pressed) {
            // Normal hold listener - only fire if was pressed
            listener.pressed = false;
            console.log('[Workflows] Hold hotkey RELEASED:', listener.accelerator);
            setImmediate(() => {
              executeWorkflowFromTrigger(listener.flowId, `hotkey.hold:release:${listener.accelerator}`, { accelerator: listener.accelerator, event: 'release' }, listener.triggerId);
            });
          }
        }
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
    if (keystrokeListeners.size === 0 && passthroughHotkeyListeners.size === 0 && holdHotkeyListeners.size === 0) {
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

let cachedRendererToken: { token?: string; expiresAt: number } = { token: undefined, expiresAt: 0 };

async function getRendererAccessToken(forceRefresh = false): Promise<string | undefined> {
  const now = Date.now();
  if (!forceRefresh && cachedRendererToken.token && cachedRendererToken.expiresAt > now) {
    return cachedRendererToken.token;
  }

  try {
    const allWindows = BrowserWindow.getAllWindows();
    for (const bw of allWindows) {
      if (bw.isDestroyed() || !bw.webContents) continue;
      try {
        const token = await bw.webContents.executeJavaScript(
          `(async () => { try { const sb = window.__supabase || window.supabase; if (!sb?.auth) return null; const { data } = await sb.auth.getSession(); return data?.session?.access_token || null; } catch { return null; } })()`,
          true
        );
        if (token && typeof token === 'string') {
          cachedRendererToken = { token, expiresAt: now + 15_000 };
          return token;
        }
      } catch { }
    }
  } catch { }

  cachedRendererToken = { token: undefined, expiresAt: now + 3_000 };
  return undefined;
}

function getCloudAiHttpBase(): string {
  return String(
    process.env.CLOUD_AI_HTTP ||
    process.env.CLOUD_PUBLIC_URL ||
    process.env.CLOUD_AI_URL ||
    'http://localhost:8082'
  ).trim().replace(/\/+$/, '');
}

/**
 * Ensure a cloud webhook entry exists for a workflow so the incoming URL works.
 * Uses the flowId as the slug. Silently succeeds if already created.
 */
async function ensureCloudWebhook(flowId: string, flowName: string, triggerId?: string) {
  try {
    const token = await getRendererAccessToken();
    if (!token) return;
    const base = getCloudAiHttpBase();
    // Check if webhook already exists by listing and matching slug
    const listRes = await net.fetch(`${base}/v1/webhooks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (listRes.ok) {
      const listBody = await listRes.json() as any;
      const existing = (listBody?.webhooks || []).find((w: any) => w.slug === flowId);
      if (existing) {
        // Already exists, just make sure it's active and pointing to this workflow
        if (!existing.is_active || existing.target_workflow_id !== flowId) {
          await net.fetch(`${base}/v1/webhooks/${existing.id}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              is_active: true,
              target_workflow_id: flowId,
              target_workflow_trigger_id: triggerId || null,
            }),
          }).catch(() => {});
        }
        return;
      }
    }
    // Create new webhook with flowId as slug
    await net.fetch(`${base}/v1/webhooks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Webhook: ${flowName}`,
        slug: flowId,
        type: 'workflow',
        workflowId: flowId,
        triggerId: triggerId || undefined,
      }),
    });
    console.log(`[Workflows] Cloud webhook registered for ${flowId}`);
  } catch (e: any) {
    console.warn(`[Workflows] Failed to register cloud webhook for ${flowId}:`, e?.message);
  }
}

async function registerGoogleNativeTrigger(
  flowId: string,
  triggerId: string,
  type: 'gmail.new_email' | 'drive.new_file',
  args: any
) {
  // Retry logic: the renderer may not have loaded the Supabase session yet
  // during app startup autostart, so we retry a few times with a delay.
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 3000;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const token = await getRendererAccessToken(attempt > 0);
      if (!token) {
        if (attempt < MAX_RETRIES - 1) {
          logFlow(flowId, `Google trigger '${type}' waiting for auth session (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        logFlow(flowId, `Google trigger '${type}' not registered (missing auth session after ${MAX_RETRIES} attempts)`);
        return { ok: false, error: 'missing_access_token' };
      }
      const base = getCloudAiHttpBase();
      const resp = await net.fetch(`${base}/integrations/google/native-triggers/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workflowId: flowId, triggerId, type, args: args || {} }),
      });
      const out: any = await resp.json().catch(() => ({}));
      if (!resp.ok || !out?.ok) {
        const err = String(out?.error || `http_${resp.status}`);
        const hint = out?.hint ? ` (${out.hint})` : '';
        logFlow(flowId, `Google trigger '${type}' registration failed: ${err}${hint}`);
        return { ok: false, error: err, hint: out?.hint };
      }
      return { ok: true };
    } catch (e: any) {
      if (attempt < MAX_RETRIES - 1) {
        logFlow(flowId, `Google trigger '${type}' registration error, retrying: ${e?.message}`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      return { ok: false, error: String(e?.message || 'register_failed') };
    }
  }
  return { ok: false, error: 'max_retries_exceeded' };
}

async function unregisterGoogleNativeTrigger(
  flowId: string,
  triggerId: string,
  type: 'gmail.new_email' | 'drive.new_file'
) {
  try {
    const token = await getRendererAccessToken();
    if (!token) return { ok: false, error: 'missing_access_token' };
    const base = getCloudAiHttpBase();
    const resp = await net.fetch(`${base}/integrations/google/native-triggers/unregister`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workflowId: flowId, triggerId, type }),
    });
    const out: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !out?.ok) {
      return { ok: false, error: String(out?.error || `http_${resp.status}`) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'unregister_failed') };
  }
}

export type FlowRuntime = {
  id: string;
  fsWatchers: any[];
  cronJobs: any[];
  hotkeys: string[];
  intervals: any[];
  procs: Array<ChildProcess | null>;
  googleNativeTriggers: Array<{ type: 'gmail.new_email' | 'drive.new_file'; triggerId: string }>;
  lastOutlookCalendarStamp?: string;
};

const flowRuntimes = new Map<string, FlowRuntime>();
// Map of flowId -> triggerId for webhook-enabled flows
const webhookEnabledFlows = new Map<string, string>();
const cloudWebhookEnabledFlows = new Map<string, string>();
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

/** Default subdirectories created in every new workflow workspace */
const WORKSPACE_SUBDIRS = ['data', 'scripts', 'assets'];

/** Get the workspace directory for a workflow (if it uses workspace format) */
export function getWorkspaceDir(id: string): string | null {
  const safe = safeFlowId(id);
  if (!safe) return null;
  const base = path.join(app.getPath('userData'), 'workflows');
  // Check root workspace dir
  const rootWs = path.join(base, safe);
  if (fs.existsSync(path.join(rootWs, 'main.stuard'))) return rootWs;
  // Check inside group folders
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== safe) {
        const subWs = path.join(base, entry.name, safe);
        if (fs.existsSync(path.join(subWs, 'main.stuard'))) return subWs;
      }
    }
  } catch { }
  return null;
}

export function getWorkflowPathById(id: string) {
  // Try workspace directory first (flowId/main.stuard)
  const wsDir = getWorkspaceDir(id);
  if (wsDir) return path.join(wsDir, 'main.stuard');
  // Try subfolder-aware lookup (legacy flat .json), fall back to root
  const found = findWorkflowPath(id);
  if (found) return found;
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

/**
 * Sanitize a guard object to fix LLM serialization issues.
 * LLMs sometimes double-quote JSONLogic operators, producing keys like
 * '"=="' (with embedded quotes) instead of '==' .
 * Recursively strips leading/trailing quote characters from object keys.
 */
function sanitizeGuard(guard: any): any {
  if (!guard || typeof guard !== 'object') return guard;
  if (guard === 'always') return guard;
  if (Array.isArray(guard)) return guard.map(sanitizeGuard);

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(guard)) {
    const stripped = key.replace(/^"+|"+$/g, '');
    cleaned[stripped || key] = sanitizeGuard(value);
  }
  return cleaned;
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
    // Filter out callNode wires — they're on-demand dispatches from custom_ui,
    // not part of the normal execution flow. The engine should not auto-traverse them.
    const outs = wires.filter((w: any) => String(w?.from || '') === fromId && !(w as any)?.callNode);
    const next = outs.map((w: any) => {
      const to = String(w?.to || '');
      const gRaw = (w as any)?.guard;
      // Sanitize guard keys first to fix LLM double-quoting (e.g. '"=="' → '==')
      const g = (gRaw && typeof gRaw === 'object') ? sanitizeGuard(gRaw) : gRaw;
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
      const loop = (w as any)?.loop;
      const loopBreak = (w as any)?.loopBreak;
      const loopFanoutMode = (w as any)?.loopFanoutMode;
      const stream = (w as any)?.stream;
      const edge: any = { to, guard };
      if (label) edge.label = String(label);
      // Include loop configuration if present
      if (loop && typeof loop === 'object' && loop.type) {
        edge.loop = {
          type: loop.type, // 'forEach', 'repeat', 'while'
          items: loop.items,
          itemVar: loop.itemVar || 'item',
          indexVar: loop.indexVar || 'index',
          count: loop.count,
          conditionText: loop.conditionText,
          maxIterations: loop.maxIterations || 100,
          delayMs: loop.delayMs || 0,
        };
      }
      // Include loopBreak flag if present
      if (loopBreak) {
        edge.loopBreak = true;
      }

      // Include loop fanout behavior if present
      if (loopFanoutMode === 'wait' || loopFanoutMode === 'parallel') {
        edge.loopFanoutMode = loopFanoutMode;
      }

      // Include stream wire configuration if present
      if (stream && typeof stream === 'object') {
        edge.stream = {
          sourceField: stream.sourceField || 'streamId',
          mode: stream.mode || 'reactive',
          ...(stream.bufferSize ? { bufferSize: stream.bufferSize } : {}),
        };
      }
      return edge;
    });
    const step: any = { id: fromId, tool: String(n?.tool || 'noop'), args: n?.args || {}, next };
    if (n?.label) step.label = String(n.label);
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

  // If a specific triggerId is provided, use only that trigger's wires
  if (triggerId) {
    const triggerWires = wires.filter((w: any) => String(w?.from || '') === triggerId);
    const triggerTargetIds: string[] = Array.from(new Set(triggerWires.map((w: any) => String(w?.to || '')).filter(Boolean))) as string[];

    if (triggerTargetIds.length > 1) {
      // Multiple targets from this trigger: create synthetic parallel start
      const syntheticStartId = '_trigger_parallel_start';
      const parallelNext = triggerTargetIds.map(targetId => ({
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
    } else if (triggerTargetIds.length === 1) {
      startNodeId = triggerTargetIds[0];
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
  // Map triggers with their IDs and start nodes for call_function support
  const triggers = triggersIn.map((t: any) => {
    const tid = String(t?.id || '');
    // Find the wire from this trigger to its start node
    const triggerWire = wires.find((w: any) => String(w?.from || '') === tid);
    const triggerStart = triggerWire ? String(triggerWire.to || '') : undefined;

    return {
      id: tid,
      type: String(t?.type || ''),
      args: t?.args || {},
      inputParams: Array.isArray(t?.inputParams) ? t.inputParams : undefined,
      start: triggerStart // Start node for this trigger (used by call_function)
    };
  });

  const spec: StuardSpec = {
    id,
    name,
    version,
    autostart,
    triggers,
    steps,
    start: startNodeId
  };

  // Add output schema if defined
  if (Array.isArray(m?.outputSchema) && m.outputSchema.length > 0) {
    (spec as any).outputSchema = m.outputSchema;
  }

  return spec;
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
export async function executeWorkflowFromTrigger(flowId: string, origin: string, payload?: any, triggerId?: string) {
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
    const triggerAccessToken = await getRendererAccessToken();

    const engineCtx: EngineContext = {
      stuardsDir,
      agentWsUrl: process.env.AGENT_WS || process.env.AGENT_WS_URL || 'ws://127.0.0.1:8765/ws',
      cloudAiUrl: process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || process.env.CLOUD_AI_URL || 'http://localhost:8082',
      logFn: (msg: string) => logFlow(safe, msg),
      accessToken: triggerAccessToken,
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

export function handleCloudWebhookEvent(msg: any) {
  try {
    const t = String(msg?.type || '');
    const data = msg?.data;

    const workflowId = typeof msg?.workflow?.id === 'string' ? msg.workflow.id : '';
    const triggerId = typeof msg?.workflow?.triggerId === 'string' ? msg.workflow.triggerId : undefined;

    if (workflowId) {
      executeWorkflowFromTrigger(workflowId, t || 'webhook.cloud', data, triggerId);
      return { ok: true, delivered: 1 };
    }

    if (t === 'webhook_trigger') {
      const slug = typeof msg?.webhook?.slug === 'string' ? msg.webhook.slug : '';
      const candidate = safeFlowId(slug);
      if (candidate && cloudWebhookEnabledFlows.has(candidate)) {
        const tId = cloudWebhookEnabledFlows.get(candidate);
        executeWorkflowFromTrigger(candidate, 'webhook.cloud', data, tId);
        return { ok: true, delivered: 1 };
      }
    }

    let delivered = 0;
    for (const [fid, tId] of cloudWebhookEnabledFlows.entries()) {
      try {
        executeWorkflowFromTrigger(fid, 'webhook.cloud', data, tId);
        delivered++;
      } catch { }
    }
    return { ok: true, delivered };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
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
  const rt: FlowRuntime = {
    id: safe,
    fsWatchers: [],
    cronJobs: [],
    hotkeys: [],
    intervals: [],
    procs: [],
    googleNativeTriggers: [],
  };

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
        const userTz = getTimezone(); // User's timezone (auto-detected or manual override)
        const job = nodeCron.schedule(cronExp, () => {
          try {
            count++;
            if (maxRuns && count > maxRuns) {
              try { job.stop?.(); } catch { }
              return;
            }
            executeWorkflowFromTrigger(safe, 'schedule.cron', undefined, tId);
          } catch { }
        }, { timezone: userTz });
        try { job.start?.(); } catch { }
        rt.cronJobs.push(job);
        started++;
      } catch { }
    } else if (type === 'webhook' || type === 'webhook.local' || type === 'webhook.cloud') {
      // Unified webhook trigger: check args.mode to determine cloud vs local
      const webhookMode = type === 'webhook.local' ? 'local' :
                          type === 'webhook.cloud' ? 'cloud' :
                          String(args?.mode || 'cloud');
      if (webhookMode === 'local') {
        webhookEnabledFlows.set(safe, triggerId);
      } else {
        cloudWebhookEnabledFlows.set(safe, triggerId);
        // Auto-register cloud webhook endpoint so the URL works
        ensureCloudWebhook(safe, model?.name || safe, triggerId).catch(() => {});
      }
      started++;
    } else if (type === 'hotkey') {
      const accel = String(args?.accelerator || 'CommandOrControl+Alt+K');
      const passthrough = Boolean(args?.passthrough);
      const holdMode = Boolean(args?.hold); // NEW: hold setting fires on press AND release
      const tId = triggerId; // Capture for closure

      console.log('[Workflows] Hotkey trigger:', { accel, passthrough, holdMode, uiohookLoaded: !!uiohook });

      // If hold mode is enabled, use the hold listener pattern (fires on press AND release)
      if (holdMode && uiohook) {
        const parsed = parseAccelerator(accel);
        if (parsed) {
          const listenerId = `${safe}_hotkey_hold_${tId || Date.now()}`;
          holdHotkeyListeners.set(listenerId, {
            flowId: safe,
            accelerator: accel,
            modifiers: parsed.modifiers,
            key: parsed.key,
            triggerId: tId,
            pressed: false,
          });
          startKeystrokeHook();
          (rt as any).holdHotkeyIds = (rt as any).holdHotkeyIds || [];
          (rt as any).holdHotkeyIds.push(listenerId);
          started++;
          console.log('[Workflows] Hotkey with hold=true registered:', accel, '(press+release)');
        } else {
          console.error('[Workflows] Failed to parse accelerator for hold hotkey:', accel);
        }
      } else if (passthrough && uiohook) {
        // Use pass-through mode (non-blocking via uiohook)
        const parsed = parseAccelerator(accel);
        console.log('[Workflows] Parsed accelerator:', parsed);
        if (parsed) {
          const listenerId = `${safe}_hotkey_${tId || Date.now()}`;
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
    } else if (type === 'hotkey.hold') {
      // DEPRECATED: Use hotkey with hold:true instead
      // Kept for backward compatibility — fires on press AND release
      const accel = String(args?.accelerator || '').trim();
      const tId = triggerId;
      if (accel && uiohook) {
        const parsed = parseAccelerator(accel);
        if (parsed) {
          const listenerId = `${safe}_hold_${tId || Date.now()}`;
          holdHotkeyListeners.set(listenerId, {
            flowId: safe,
            accelerator: accel,
            modifiers: parsed.modifiers,
            key: parsed.key,
            triggerId: tId,
            pressed: false,
          });
          startKeystrokeHook();
          (rt as any).holdHotkeyIds = (rt as any).holdHotkeyIds || [];
          (rt as any).holdHotkeyIds.push(listenerId);
          started++;
          console.log('[Workflows] Hold hotkey registered (legacy):', accel);
        } else {
          console.error('[Workflows] Failed to parse accelerator for hold hotkey:', accel);
        }
      } else if (accel && !uiohook) {
        console.warn('[Workflows] hotkey.hold requires uiohook-napi which is not available');
      }
    } else if (type === 'hotkey.release') {
      // NEW: Fires ONLY on key release — use for "release to stop" patterns
      const accel = String(args?.accelerator || '').trim();
      const tId = triggerId;
      if (accel && uiohook) {
        const parsed = parseAccelerator(accel);
        if (parsed) {
          const listenerId = `${safe}_release_${tId || Date.now()}`;
          // Store as a hold listener but mark it as release-only
          holdHotkeyListeners.set(listenerId, {
            flowId: safe,
            accelerator: accel,
            modifiers: parsed.modifiers,
            key: parsed.key,
            triggerId: tId,
            pressed: false,
            releaseOnly: true, // Only fire on release
          } as any);
          startKeystrokeHook();
          (rt as any).holdHotkeyIds = (rt as any).holdHotkeyIds || [];
          (rt as any).holdHotkeyIds.push(listenerId);
          started++;
          console.log('[Workflows] Release-only hotkey registered:', accel);
        } else {
          console.error('[Workflows] Failed to parse accelerator for release hotkey:', accel);
        }
      } else if (accel && !uiohook) {
        console.warn('[Workflows] hotkey.release requires uiohook-napi which is not available');
      }
    } else if (type === 'keystroke') {
      // Keystroke sequence trigger - fires when user types a specific sequence
      const sequence = String(args?.sequence || '').toLowerCase();
      if (sequence && uiohook) {
        try {
          const listenerId = `${safe}_keystroke_${triggerId || Date.now()}`;
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
    } else if (type === 'gmail.new_email' || type === 'drive.new_file') {
      const nativeType: 'gmail.new_email' | 'drive.new_file' = type;
      const tId = triggerId;
      rt.googleNativeTriggers.push({ type: nativeType, triggerId: tId });
      started++;
      // Register native Google watch trigger in cloud-ai (push-based, no polling).
      void registerGoogleNativeTrigger(safe, tId, nativeType, args).then((result) => {
        if (!result?.ok) {
          logFlow(safe, `Google native trigger '${nativeType}' registration failed: ${result?.error || 'unknown_error'}`);
        } else {
          logFlow(safe, `Google native trigger '${nativeType}' registered`);
        }
      });
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
    // Cleanup hold hotkey listeners
    const holdIds = (rt as any).holdHotkeyIds || [];
    for (const lid of holdIds) {
      holdHotkeyListeners.delete(lid);
    }
    stopKeystrokeHook();
  } catch { }
  try { for (const t of rt.intervals) { try { clearInterval(t as any); } catch { } } } catch { }
  try {
    for (const g of rt.googleNativeTriggers || []) {
      if (!g?.triggerId) continue;
      void unregisterGoogleNativeTrigger(safe, g.triggerId, g.type);
    }
  } catch { }
  try { for (const p of rt.procs) { try { if (p && !p.killed) { if (process.platform === 'win32') { try { process.kill((p as any).pid); } catch { } } else { try { p.kill('SIGTERM'); } catch { } } } } catch { } } } catch { }
  webhookEnabledFlows.delete(safe);
  cloudWebhookEnabledFlows.delete(safe);
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

    // Collect all workflow files from root and subfolders (both flat .json and workspace main.stuard)
    const allFiles: { path: string; id: string }[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        allFiles.push({ path: path.join(dir, entry.name), id: entry.name.replace(/\.json$/i, '') });
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        // Check if this directory IS a workspace dir (has main.stuard)
        const wsPath = path.join(dir, entry.name, 'main.stuard');
        if (fs.existsSync(wsPath)) {
          allFiles.push({ path: wsPath, id: entry.name });
        } else {
          // Otherwise scan subfolder for flat .json files and nested workspace dirs
          try {
            const subEntries = fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.isFile() && sub.name.endsWith('.json')) {
                allFiles.push({ path: path.join(dir, entry.name, sub.name), id: sub.name.replace(/\.json$/i, '') });
              } else if (sub.isDirectory() && !sub.name.startsWith('.')) {
                const nestedWs = path.join(dir, entry.name, sub.name, 'main.stuard');
                if (fs.existsSync(nestedWs)) {
                  allFiles.push({ path: nestedWs, id: sub.name });
                }
              }
            }
          } catch { }
        }
      }
    }

    console.log(`[workflows] Found ${allFiles.length} workflow file(s), checking for autostart...`);
    let started = 0;
    for (const { path: filePath, id } of allFiles) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const model = JSON.parse(raw || '{}');
        if (model && model.autostart) {
          const triggerTypes = (model.triggers || []).map((t: any) => t?.type || 'unknown').join(', ');

          // IMPORTANT: Clean up any legacy stuard runtime/file that might conflict
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
        console.error(`[workflows] Failed to autostart workflow ${id}:`, e);
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
    const userData = app.getPath('userData');
    const dir = path.join(userData, 'workflows');
    console.log('[workflows_list] userData path:', userData);
    console.log('[workflows_list] workflows dir:', dir);
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { }

    const items: any[] = [];
    const folders: string[] = [];
    const seenIds = new Set<string>();

    // Helper to read workflow metadata from a file
    const readItem = (filePath: string, id: string, folder?: string, isWorkspace?: boolean) => {
      if (seenIds.has(id)) return null; // Deduplicate
      seenIds.add(id);
      let name = id;
      let updatedAt = '';
      let version = '';
      let marketplaceSlug = '';
      let triggers: string[] = [];
      try {
        const stat = fs.statSync(filePath);
        updatedAt = new Date(stat.mtimeMs).toISOString();
        const raw = fs.readFileSync(filePath, 'utf-8');
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
      return { id, name, updatedAt, version, marketplaceSlug, hasRuntime, running, triggers, folder: folder || undefined, isWorkspace: !!isWorkspace };
    };

    // Scan root-level entries
    const rootEntries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        // Legacy flat .json file
        const id = entry.name.replace(/\.json$/i, '');
        const item = readItem(path.join(dir, entry.name), id);
        if (item) items.push(item);
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subDir = path.join(dir, entry.name);
        const mainStuard = path.join(subDir, 'main.stuard');
        if (fs.existsSync(mainStuard)) {
          // Workspace directory — the dir name IS the flow ID
          const item = readItem(mainStuard, entry.name, undefined, true);
          if (item) items.push(item);
        } else {
          // Group folder — contains workflows
          folders.push(entry.name);
          try {
            const subEntries = fs.readdirSync(subDir, { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.isFile() && sub.name.endsWith('.json')) {
                const id = sub.name.replace(/\.json$/i, '');
                const item = readItem(path.join(subDir, sub.name), id, entry.name);
                if (item) items.push(item);
              } else if (sub.isDirectory() && !sub.name.startsWith('.')) {
                // Could be a workspace dir inside a group folder
                const nestedMain = path.join(subDir, sub.name, 'main.stuard');
                if (fs.existsSync(nestedMain)) {
                  const item = readItem(nestedMain, sub.name, entry.name, true);
                  if (item) items.push(item);
                }
              }
            }
          } catch { }
        }
      }
    }

    console.log('[workflows_list] found', items.length, 'workflows in', folders.length + 1, 'locations');
    return { ok: true, items, folders };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

// Find the actual file path for a workflow ID (searches workspace dirs, root, and subfolders)
function findWorkflowPath(id: string): string | null {
  const dir = path.join(app.getPath('userData'), 'workflows');
  // 1. Check workspace dir at root level (flowId/main.stuard)
  const wsPath = path.join(dir, id, 'main.stuard');
  if (fs.existsSync(wsPath)) return wsPath;
  // 2. Check root flat file
  const rootPath = path.join(dir, `${id}.json`);
  if (fs.existsSync(rootPath)) return rootPath;
  // 3. Search subfolders for both workspace dirs and flat files
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== id) {
        // Workspace dir inside a group folder
        const subWsPath = path.join(dir, entry.name, id, 'main.stuard');
        if (fs.existsSync(subWsPath)) return subWsPath;
        // Flat file inside a group folder
        const subPath = path.join(dir, entry.name, `${id}.json`);
        if (fs.existsSync(subPath)) return subPath;
      }
    }
  } catch { }
  return null;
}

export function workflows_read(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };
    const p = findWorkflowPath(safe);
    if (!p) return { ok: false, error: 'not_found' };
    const rawContent = fs.readFileSync(p, 'utf-8');
    // Decrypt if encrypted (locked workflows)
    const content = prepareForLoad(rawContent);
    const wsDir = getWorkspaceDir(safe);
    return { ok: true, id: safe, content, isWorkspace: !!wsDir, workspacePath: wsDir || undefined };
  } catch (e: any) {
    // If decryption fails, the workflow may be from a different machine
    if (String(e?.message || '').includes('Decryption failed')) {
      return { ok: false, error: 'This locked workflow was created on a different machine and cannot be opened here.' };
    }
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_save(payload: { id: string; content: string; folder?: string }) {
  try {
    const safe = safeFlowId(String(payload?.id || ''));
    const content = String(payload?.content || '');
    if (!safe) return { ok: false, error: 'invalid_id' };
    try { JSON.parse(content); } catch { return { ok: false, error: 'invalid_json' }; }
    const dir = path.join(app.getPath('userData'), 'workflows');
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { }

    // Check if this workflow already exists (workspace or flat file)
    const existing = findWorkflowPath(safe);

    if (existing) {
      // Preserve autostart flag from existing file if the incoming content doesn't have it
      // This prevents the UI from accidentally removing the deployed state when saving changes
      try {
        const existingRaw = fs.readFileSync(existing, 'utf-8');
        const existingModel = JSON.parse(existingRaw || '{}');
        if (existingModel.autostart) {
          const incoming = JSON.parse(content);
          if (!incoming.autostart) {
            incoming.autostart = true;
            // Use the updated content with autostart preserved
            const contentToSave = prepareForSave(JSON.stringify(incoming, null, 2));
            fs.writeFileSync(existing, contentToSave, { encoding: 'utf-8' });
            return { ok: true, isWorkspace: existing.endsWith('main.stuard') };
          }
        }
      } catch { }

      // Save to existing location (workspace main.stuard or flat .json)
      const contentToSave = prepareForSave(content);
      fs.writeFileSync(existing, contentToSave, { encoding: 'utf-8' });
      return { ok: true, isWorkspace: existing.endsWith('main.stuard') };
    }

    // New workflow — always create workspace directory
    let baseDir = dir;
    if (payload.folder) {
      const safeFolder = String(payload.folder).replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
      if (safeFolder) {
        baseDir = path.join(dir, safeFolder);
        try { if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true }); } catch { }
      }
    }

    const wsDir = path.join(baseDir, safe);
    fs.mkdirSync(wsDir, { recursive: true });
    // Create default subdirectories
    for (const sub of WORKSPACE_SUBDIRS) {
      const subPath = path.join(wsDir, sub);
      try { if (!fs.existsSync(subPath)) fs.mkdirSync(subPath, { recursive: true }); } catch { }
    }
    // Seed default starter script
    const helloPath = path.join(wsDir, 'scripts', 'hello.py');
    try {
      if (!fs.existsSync(helloPath)) {
        fs.writeFileSync(helloPath, `# Workspace starter script\n# Edit this file or add more scripts to the scripts/ folder.\n# Reference in workflow nodes with: {{$workspace.scripts}}/hello.py\n\nimport json, os, sys\n\nprint("Hello from workspace!")\nprint(f"Python {sys.version}")\nprint(f"Working dir: {os.getcwd()}")\n`, 'utf-8');
      }
    } catch { }
    const p = path.join(wsDir, 'main.stuard');
    const contentToSave = prepareForSave(content);
    fs.writeFileSync(p, contentToSave, { encoding: 'utf-8' });
    console.log(`[workflows] Created workspace directory: ${wsDir}`);
    return { ok: true, isWorkspace: true, workspacePath: wsDir };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_delete(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };

    // Check for workspace directory first
    const wsDir = getWorkspaceDir(safe);
    if (wsDir && fs.existsSync(wsDir)) {
      // Remove entire workspace directory
      fs.rmSync(wsDir, { recursive: true, force: true });
      console.log(`[workflows] Deleted workspace directory: ${wsDir}`);
      return { ok: true };
    }

    // Fallback: search for flat .json file
    const p = findWorkflowPath(safe);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
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

    // Save with autostart enabled (subfolder-aware)
    const p = getWorkflowPathById(safe);
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

    // Save with autostart disabled (subfolder-aware)
    const p = getWorkflowPathById(safe);
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
      agentWsUrl: process.env.AGENT_WS || process.env.AGENT_WS_URL || 'ws://127.0.0.1:8765/ws',
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

    // Close any custom_ui windows associated with this workflow (resolves blocking promises)
    try {
      const { closeCustomUiByFlowId } = require('../custom-ui');
      const closedWindows = closeCustomUiByFlowId(safe);
      if (closedWindows > 0) {
        logFlow(safe, `Closed ${closedWindows} custom UI window(s)`);
      }
    } catch { }

    // Stop any media capture sessions started by this workflow (fire-and-forget)
    try {
      const { execLocalTool } = require('../tools/handlers/local');
      const ctx = { agentWsUrl: '', cloudAiUrl: '', logFn: (m: string) => logFlow(safe, m) };
      execLocalTool('stop_captures_by_flow', { flowId: safe }, ctx, 15000)
        .then((r: any) => { if (r?.stopped > 0) logFlow(safe, `Stopped ${r.stopped} capture session(s)`); })
        .catch(() => { });
      execLocalTool('close_all_streams', { flowId: safe }, ctx, 15000)
        .then((r: any) => { if (r?.closed > 0) logFlow(safe, `Closed ${r.closed} stream(s)`); })
        .catch(() => { });
    } catch { }

    // Emit flow execution ended + log (best-effort; engine will also emit when it observes abort)
    emitFlowExecutionState(safe, false);
    logFlow(safe, stopRes.ok ? 'Run stopped' : 'Stop requested (not running)');

    return { ok: true, stopped: stopRes.ok ? stopRes.stopped : 0 };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/**
 * Run a single step (for testing/debugging individual steps)
 */
export async function workflows_runStep(id: string, options: { step: { id: string; tool: string; args: any }; accessToken?: string }) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };

    const { step, accessToken } = options;
    if (!step || !step.tool) return { ok: false, error: 'invalid_step' };

    console.log('[Workflows] Running single step:', step.id, step.tool);
    logFlow(safe, `Running step: ${step.id} (${step.tool})`);

    // Emit step running state
    emitStepExecution(safe, step.id, 'running');

    // Import and use execTool for running the step
    const { execTool } = await import('../tools/index');
    const stuardsDir = path.join(app.getPath('userData'), 'stuards');
    const ctx = {
      stuardsDir,
      agentWsUrl: process.env.AGENT_WS || process.env.AGENT_WS_URL || 'ws://127.0.0.1:8765/ws',
      cloudAiUrl: process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || process.env.CLOUD_AI_URL || 'http://localhost:8082',
      logFn: (msg: string) => logFlow(safe, msg),
      accessToken,
    };

    try {
      const result = await execTool(step.tool, step.args || {}, ctx);
      console.log('[Workflows] Step result:', result);
      emitStepExecution(safe, step.id, 'completed', { result });
      logFlow(safe, `Step completed: ${step.id}`);
      return { ok: true, result };
    } catch (e: any) {
      console.error('[Workflows] Step error:', e);
      emitStepExecution(safe, step.id, 'error', { error: e?.message || 'failed' });
      logFlow(safe, `Step error: ${step.id} - ${e?.message || 'failed'}`);
      return { ok: false, error: e?.message || 'step_failed' };
    }
  } catch (e: any) {
    console.error('[Workflows] workflows_runStep error:', e);
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/**
 * Run workflow starting from a specific step
 */
export function workflows_runFromStep(id: string, options: { startStepId: string; accessToken?: string }) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };

    const { startStepId, accessToken } = options;
    if (!startStepId) return { ok: false, error: 'invalid_start_step' };

    const model = readWorkflowModel(safe);
    if (!model) return { ok: false, error: 'workflow_not_found' };

    // Verify the step exists
    const step = model.nodes.find((n: any) => n.id === startStepId);
    if (!step) return { ok: false, error: 'step_not_found' };

    console.log('[Workflows] Running from step:', startStepId);
    logFlow(safe, `Running from step: ${startStepId}`);
    emitFlowExecutionState(safe, true);

    // Convert to spec with the specified start step
    const spec = designerModelToStuardSpec(model);
    spec.start = startStepId;
    spec.autostart = false;

    // Save as stuard for execution
    const saveRes = stuards_save({ id: safe, content: JSON.stringify(spec, null, 2) });
    if (!saveRes?.ok) {
      console.error('[Workflows] Failed to save as stuard:', saveRes?.error);
      emitFlowExecutionState(safe, false);
      return { ok: false, error: saveRes?.error || 'save_failed' };
    }

    // Build engine context
    const stuardsDir = path.join(app.getPath('userData'), 'stuards');
    const engineCtx: EngineContext = {
      stuardsDir,
      agentWsUrl: process.env.AGENT_WS || process.env.AGENT_WS_URL || 'ws://127.0.0.1:8765/ws',
      cloudAiUrl: process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || process.env.CLOUD_AI_URL || 'http://localhost:8082',
      logFn: (msg: string) => logFlow(safe, msg),
      accessToken,
    };

    // Execute
    runStuardEngine(safe, undefined, engineCtx).then(() => {
      console.log('[Workflows] Run from step completed:', safe);
      logFlow(safe, 'Run completed');
      emitFlowExecutionState(safe, false);
    }).catch((e: any) => {
      console.error('[Workflows] Run from step error:', e);
      logFlow(safe, `Error: ${e?.message || 'execution_failed'}`);
      emitFlowExecutionState(safe, false);
    });

    return { ok: true };
  } catch (e: any) {
    console.error('[Workflows] workflows_runFromStep error:', e);
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

// ─── Folder CRUD ───────────────────────────────────────────────────

function safeFolderName(name: string): string {
  return String(name || '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 64);
}

export function workflows_createFolder(name: string) {
  try {
    const safe = safeFolderName(name);
    if (!safe) return { ok: false, error: 'invalid_folder_name' };
    const dir = path.join(app.getPath('userData'), 'workflows', safe);
    if (fs.existsSync(dir)) return { ok: false, error: 'folder_exists' };
    fs.mkdirSync(dir, { recursive: true });
    console.log('[workflows] Created folder:', safe);
    return { ok: true, folder: safe };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_renameFolder(oldName: string, newName: string) {
  try {
    const safeOld = safeFolderName(oldName);
    const safeNew = safeFolderName(newName);
    if (!safeOld || !safeNew) return { ok: false, error: 'invalid_folder_name' };
    const base = path.join(app.getPath('userData'), 'workflows');
    const oldDir = path.join(base, safeOld);
    const newDir = path.join(base, safeNew);
    if (!fs.existsSync(oldDir)) return { ok: false, error: 'folder_not_found' };
    if (fs.existsSync(newDir)) return { ok: false, error: 'target_folder_exists' };
    fs.renameSync(oldDir, newDir);
    console.log('[workflows] Renamed folder:', safeOld, '->', safeNew);
    return { ok: true, folder: safeNew };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_deleteFolder(name: string, deleteContents?: boolean) {
  try {
    const safe = safeFolderName(name);
    if (!safe) return { ok: false, error: 'invalid_folder_name' };
    const dir = path.join(app.getPath('userData'), 'workflows', safe);
    if (!fs.existsSync(dir)) return { ok: false, error: 'folder_not_found' };
    // Check if folder has contents
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    if (files.length > 0 && !deleteContents) {
      return { ok: false, error: 'folder_not_empty', count: files.length };
    }
    // Delete contents if requested
    if (deleteContents) {
      for (const f of files) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { }
      }
    }
    fs.rmdirSync(dir);
    console.log('[workflows] Deleted folder:', safe);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

export function workflows_moveToFolder(id: string, targetFolder: string | null) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };
    const base = path.join(app.getPath('userData'), 'workflows');

    let targetDir: string;
    if (!targetFolder) {
      targetDir = base;
    } else {
      const safeFolder = safeFolderName(targetFolder);
      if (!safeFolder) return { ok: false, error: 'invalid_folder_name' };
      targetDir = path.join(base, safeFolder);
      try { if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true }); } catch { }
    }

    // Check if this is a workspace directory
    const wsDir = getWorkspaceDir(safe);
    if (wsDir) {
      const newWsDir = path.join(targetDir, safe);
      if (wsDir === newWsDir) return { ok: true };
      fs.renameSync(wsDir, newWsDir);
      console.log('[workflows] Moved workspace', safe, 'to', targetFolder || 'root');
      return { ok: true };
    }

    // Fallback: flat .json file
    const currentPath = findWorkflowPath(safe);
    if (!currentPath) return { ok: false, error: 'workflow_not_found' };
    const newPath = path.join(targetDir, `${safe}.json`);
    if (currentPath === newPath) return { ok: true };
    fs.renameSync(currentPath, newPath);
    console.log('[workflows] Moved workflow', safe, 'to', targetFolder || 'root');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

// ─── Workspace File Management ─────────────────────────────────────────────

interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  updatedAt?: string;
}

/** Ensure a workspace directory exists for a workflow, creating if needed */
export function workflows_ensureWorkspace(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };

    // Already a workspace?
    const existing = getWorkspaceDir(safe);
    if (existing) return { ok: true, workspacePath: existing, created: false };

    // Find existing flat file to migrate
    const flatPath = findWorkflowPath(safe);
    if (!flatPath) return { ok: false, error: 'workflow_not_found' };

    // Migrate: read flat file, create workspace, write main.stuard, delete flat file
    const content = fs.readFileSync(flatPath, 'utf-8');
    const base = path.dirname(flatPath);
    const wsDir = path.join(base, safe);
    fs.mkdirSync(wsDir, { recursive: true });
    for (const sub of WORKSPACE_SUBDIRS) {
      try { fs.mkdirSync(path.join(wsDir, sub), { recursive: true }); } catch { }
    }
    fs.writeFileSync(path.join(wsDir, 'main.stuard'), content, 'utf-8');
    fs.unlinkSync(flatPath);
    console.log(`[workflows] Migrated ${safe} to workspace format`);
    return { ok: true, workspacePath: wsDir, created: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Get workspace info: path, subdirs, file count */
export function workflows_getWorkspaceInfo(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const files: WorkspaceFileEntry[] = [];
    const walkDir = (dir: string, prefix: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const fullPath = path.join(dir, e.name);
          const relPath = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) {
            files.push({ name: e.name, path: relPath, type: 'directory' });
            walkDir(fullPath, relPath);
          } else {
            const stat = fs.statSync(fullPath);
            files.push({
              name: e.name,
              path: relPath,
              type: 'file',
              size: stat.size,
              updatedAt: new Date(stat.mtimeMs).toISOString(),
            });
          }
        }
      } catch { }
    };
    walkDir(wsDir, '');

    return {
      ok: true,
      workspacePath: wsDir,
      subdirs: WORKSPACE_SUBDIRS,
      files,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** List files in a workspace subpath */
export function workflows_listWorkspaceFiles(id: string, subpath?: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const targetDir = subpath ? path.join(wsDir, ...subpath.split('/').filter(Boolean)) : wsDir;
    // Safety: ensure target is within workspace
    if (!targetDir.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (!fs.existsSync(targetDir)) return { ok: false, error: 'subpath_not_found' };

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const files: WorkspaceFileEntry[] = [];
    for (const e of entries) {
      const fullPath = path.join(targetDir, e.name);
      if (e.isDirectory()) {
        files.push({ name: e.name, path: subpath ? `${subpath}/${e.name}` : e.name, type: 'directory' });
      } else {
        const stat = fs.statSync(fullPath);
        files.push({
          name: e.name,
          path: subpath ? `${subpath}/${e.name}` : e.name,
          type: 'file',
          size: stat.size,
          updatedAt: new Date(stat.mtimeMs).toISOString(),
        });
      }
    }
    return { ok: true, files };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Read a file from the workspace */
export function workflows_readWorkspaceFile(id: string, filePath: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !filePath) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const target = path.join(wsDir, ...filePath.split('/').filter(Boolean));
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (!fs.existsSync(target)) return { ok: false, error: 'file_not_found' };

    const stat = fs.statSync(target);
    if (stat.isDirectory()) return { ok: false, error: 'is_directory' };
    // Limit file size for reading (10MB)
    if (stat.size > 10 * 1024 * 1024) return { ok: false, error: 'file_too_large' };

    const content = fs.readFileSync(target, 'utf-8');
    return { ok: true, content, size: stat.size, updatedAt: new Date(stat.mtimeMs).toISOString() };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Read a binary file from the workspace as base64 (for media preview) */
export function workflows_readWorkspaceFileBinary(id: string, filePath: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !filePath) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const target = path.join(wsDir, ...filePath.split('/').filter(Boolean));
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (!fs.existsSync(target)) return { ok: false, error: 'file_not_found' };

    const stat = fs.statSync(target);
    if (stat.isDirectory()) return { ok: false, error: 'is_directory' };
    if (stat.size > 50 * 1024 * 1024) return { ok: false, error: 'file_too_large' };

    const buffer = fs.readFileSync(target);
    const base64 = buffer.toString('base64');
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mimeMap: Record<string, string> = {
      wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac',
      m4a: 'audio/mp4', aac: 'audio/aac', wma: 'audio/x-ms-wma', opus: 'audio/opus',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo',
      mkv: 'video/x-matroska', wmv: 'video/x-ms-wmv', m4v: 'video/mp4', ogv: 'video/ogg',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
      tiff: 'image/tiff', avif: 'image/avif',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    return { ok: true, base64, mime, size: stat.size };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Write a file to the workspace */
export function workflows_writeWorkspaceFile(id: string, filePath: string, content: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !filePath) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const target = path.join(wsDir, ...filePath.split('/').filter(Boolean));
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };

    // Ensure parent directory exists
    const parentDir = path.dirname(target);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    fs.writeFileSync(target, content, 'utf-8');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Delete a file or empty directory from the workspace */
export function workflows_deleteWorkspaceFile(id: string, filePath: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !filePath) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const target = path.join(wsDir, ...filePath.split('/').filter(Boolean));
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (!fs.existsSync(target)) return { ok: false, error: 'not_found' };

    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Create a subdirectory in the workspace */
export function workflows_createWorkspaceSubdir(id: string, subpath: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !subpath) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const target = path.join(wsDir, ...subpath.split('/').filter(Boolean));
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };

    fs.mkdirSync(target, { recursive: true });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Rename a file or directory in the workspace */
export function workflows_renameWorkspaceFile(id: string, oldPath: string, newName: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !oldPath || !newName) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const sanitizedName = String(newName).replace(/[<>:"|?*]/g, '').trim();
    if (!sanitizedName) return { ok: false, error: 'invalid_name' };

    const source = path.join(wsDir, ...oldPath.split('/').filter(Boolean));
    if (!source.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (!fs.existsSync(source)) return { ok: false, error: 'not_found' };

    const parentDir = path.dirname(source);
    const target = path.join(parentDir, sanitizedName);
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (fs.existsSync(target)) return { ok: false, error: 'target_exists' };

    fs.renameSync(source, target);
    // Compute new relative path
    const newRelPath = path.relative(wsDir, target).replace(/\\/g, '/');
    return { ok: true, newPath: newRelPath };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Move a file or directory to a different location in the workspace */
export function workflows_moveWorkspaceFile(id: string, sourcePath: string, destFolder: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !sourcePath) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const source = path.join(wsDir, ...sourcePath.split('/').filter(Boolean));
    if (!source.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (!fs.existsSync(source)) return { ok: false, error: 'not_found' };

    // destFolder can be empty string for root, or a relative path
    const destDir = destFolder
      ? path.join(wsDir, ...destFolder.split('/').filter(Boolean))
      : wsDir;
    if (!destDir.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };

    // Ensure destination directory exists
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const fileName = path.basename(source);
    const target = path.join(destDir, fileName);
    if (fs.existsSync(target)) return { ok: false, error: 'target_exists' };

    fs.renameSync(source, target);
    const newRelPath = path.relative(wsDir, target).replace(/\\/g, '/');
    return { ok: true, newPath: newRelPath };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Create a new .stuard sub-workflow file in the workspace */
export function workflows_createWorkspaceStuard(id: string, subPath: string, name?: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !subPath) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    // Ensure path ends with .stuard
    const resolvedPath = subPath.endsWith('.stuard') ? subPath : `${subPath}.stuard`;
    const target = path.join(wsDir, ...resolvedPath.split('/').filter(Boolean));
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (fs.existsSync(target)) return { ok: false, error: 'file_exists' };

    // Ensure parent directory exists
    const parentDir = path.dirname(target);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    const displayName = name || path.basename(resolvedPath, '.stuard').replace(/[-_]/g, ' ');

    // Create a minimal workflow model with a function trigger
    // Use DesignerModel format with position: { x, y } for nodes
    const triggerId = `trig_fn_${Date.now().toString(36)}`;
    const subWorkflow = {
      id: `sub_${Date.now().toString(36)}`,
      name: displayName,
      version: '1',
      triggers: [{
        id: triggerId,
        type: 'function',
        args: {},
        inputParams: [],
        position: { x: 300, y: 80 },
      }],
      nodes: [{
        id: `log_1`,
        tool: 'log',
        args: { message: `Hello from ${displayName}` },
        position: { x: 300, y: 200 },
      }, {
        id: `return_1`,
        tool: 'return_value',
        args: { value: '{{log_1.ok}}', success: true },
        position: { x: 300, y: 320 },
      }],
      wires: [{
        from: triggerId,
        to: 'log_1',
      }, {
        from: 'log_1',
        to: 'return_1',
      }],
      outputSchema: [
        { name: 'value', type: 'any', description: 'Return value' },
      ],
    };

    fs.writeFileSync(target, JSON.stringify(subWorkflow, null, 2), 'utf-8');
    const relPath = path.relative(wsDir, target).replace(/\\/g, '/');
    console.log(`[workflows] Created workspace sub-workflow: ${relPath}`);
    return { ok: true, path: relPath, name: displayName };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Read a .stuard sub-workflow from workspace (for opening in canvas) */
export function workflows_readWorkspaceStuard(id: string, subPath: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !subPath) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    const target = path.join(wsDir, ...subPath.split('/').filter(Boolean));
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };
    if (!fs.existsSync(target)) return { ok: false, error: 'not_found' };

    const raw = fs.readFileSync(target, 'utf-8');
    return { ok: true, content: raw, subPath };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** Save a .stuard sub-workflow in workspace */
export function workflows_saveWorkspaceStuard(id: string, subPath: string, content: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe || !subPath || !content) return { ok: false, error: 'invalid_args' };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace' };

    try { JSON.parse(content); } catch { return { ok: false, error: 'invalid_json' }; }

    const target = path.join(wsDir, ...subPath.split('/').filter(Boolean));
    if (!target.startsWith(wsDir)) return { ok: false, error: 'path_traversal' };

    // Ensure parent directory exists
    const parentDir = path.dirname(target);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    fs.writeFileSync(target, content, 'utf-8');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

/** List all .stuard sub-workflows in workspace (for function discovery) */
export function workflows_listWorkspaceFunctions(id: string) {
  try {
    const safe = safeFlowId(String(id || ''));
    if (!safe) return { ok: false, error: 'invalid_id', functions: [] };
    const wsDir = getWorkspaceDir(safe);
    if (!wsDir) return { ok: false, error: 'not_a_workspace', functions: [] };

    const functions: Array<{
      path: string;
      name: string;
      description?: string;
      isFunction: boolean;
      triggers?: string[];
      inputParams?: any[];
      outputSchema?: any[];
    }> = [];

    const walkDir = (dir: string, prefix: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walkDir(fullPath, relPath);
          } else if (entry.name.endsWith('.stuard') && entry.name !== 'main.stuard') {
            try {
              const raw = fs.readFileSync(fullPath, 'utf-8');
              const model = JSON.parse(raw || '{}');
              const triggers = Array.isArray(model?.triggers)
                ? model.triggers.map((t: any) => String(t?.type || ''))
                : [];
              const functionTrigger = model?.triggers?.find((t: any) => t.type === 'function');
              functions.push({
                path: relPath,
                name: model?.name || entry.name.replace('.stuard', ''),
                description: model?.description || '',
                isFunction: triggers.includes('function'),
                triggers: triggers.filter(Boolean),
                inputParams: functionTrigger?.inputParams || [],
                outputSchema: model?.outputSchema || [],
              });
            } catch {
              functions.push({
                path: relPath,
                name: entry.name.replace('.stuard', ''),
                isFunction: false,
              });
            }
          }
        }
      } catch { }
    };

    walkDir(wsDir, '');
    return { ok: true, functions };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed'), functions: [] };
  }
}
