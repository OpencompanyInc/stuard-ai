import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execLocalTool, getBridgeSecrets, hasClientBridge, getBridgeWs, withClientBridge } from '../bridge';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDesktopWs } from '../../services/vm-bridge';

export { execLocalTool, getBridgeSecrets, hasClientBridge };

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

type ActiveBridgeContext = {
  ws: any;
  secrets?: Record<string, any>;
};

export type LocalToolSpec = {
  timeoutMs?: number | ((ctx: any) => number);
  noFallback: boolean;
};

// ── Module-level bridge fallback ────────────────────────────────────────────
// Mastra's agent.stream/generate breaks AsyncLocalStorage propagation,
// so wrapToolWithBridge cannot reliably re-enter the ALS context for tools.
// This module-level store provides a reliable fallback: set it before running
// a subagent, and makeLocalTool will use it when ALS returns nothing.
const activeBridgeALS = new AsyncLocalStorage<ActiveBridgeContext>();
type ActiveBridgeScope = ActiveBridgeContext & { id: symbol };
const _activeBridgeScopes: ActiveBridgeScope[] = [];

function getScopedBridgeContext(): ActiveBridgeContext | undefined {
  try {
    return activeBridgeALS.getStore();
  } catch {
    return undefined;
  }
}

function getFallbackBridgeScope(): ActiveBridgeScope | undefined {
  if (_activeBridgeScopes.length > 0) {
    const states = _activeBridgeScopes.map(s => s?.ws?.readyState ?? -1);
    console.log(`[bridge-scope] GET fallback | scopes=${_activeBridgeScopes.length} readyStates=[${states.join(',')}]`);
  }
  for (let i = _activeBridgeScopes.length - 1; i >= 0; i--) {
    const scope = _activeBridgeScopes[i];
    if (scope?.ws && scope.ws.readyState === 1) return scope;
  }
  return undefined;
}

function getResolvedBridgeSecretsFallbackOnly(): Record<string, any> | undefined {
  const alsSecrets = getBridgeSecrets();
  if (alsSecrets && Object.keys(alsSecrets).length > 0) return alsSecrets;

  const scopedSecrets = getScopedBridgeContext()?.secrets;
  if (scopedSecrets && Object.keys(scopedSecrets).length > 0) return scopedSecrets;

  for (let i = _activeBridgeScopes.length - 1; i >= 0; i--) {
    const scope = _activeBridgeScopes[i];
    if (scope?.secrets && Object.keys(scope.secrets).length > 0) return scope.secrets;
  }

  const globalSecrets = (globalThis as any).__stuardActiveBridgeSecrets;
  if (globalSecrets && typeof globalSecrets === 'object' && globalSecrets.userId) {
    return globalSecrets;
  }

  return undefined;
}

function getResolvedBridgeContext(): ActiveBridgeContext | undefined {
  const bridgeWs = getBridgeWs();
  if (bridgeWs?.readyState === 1) {
    return { ws: bridgeWs, secrets: getBridgeSecrets() };
  }

  const scoped = getScopedBridgeContext();
  if (scoped?.ws?.readyState === 1) {
    return scoped;
  }

  const fallback = getFallbackBridgeScope();
  if (fallback) {
    return { ws: fallback.ws, secrets: fallback.secrets };
  }

  const secrets = getResolvedBridgeSecretsFallbackOnly();
  const userId = typeof secrets?.userId === 'string' ? secrets.userId : '';
  if (userId) {
    const desktopWs = getDesktopWs(userId);
    if (desktopWs?.readyState === 1) {
      console.log(`[bridge-scope] GET desktop fallback | userId=${userId.slice(0, 8)}`);
      return { ws: desktopWs, secrets };
    }
  }

  return undefined;
}

export function withActiveBridgeContext<T>(
  ws: any,
  secrets: Record<string, any> | undefined,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return activeBridgeALS.run({ ws, secrets }, fn as any);
}

/** Set the active bridge WS for tool dispatch (call before subagent execution). */
export function setActiveBridge(ws: any, secrets?: Record<string, any>) {
  const scope: ActiveBridgeScope = {
    id: Symbol('activeBridgeScope'),
    ws,
    secrets,
  };
  _activeBridgeScopes.push(scope);
  // Also maintain a globalThis-level secrets ref that survives ALL async context
  // breaks (ALS, promise boundaries, Mastra internals, module duplication).
  if (secrets && (secrets as any).userId) {
    (globalThis as any).__stuardActiveBridgeSecrets = secrets;
  }
  console.log(`[bridge-scope] SET scope #${_activeBridgeScopes.length} | ws=${!!ws} readyState=${ws?.readyState ?? 'N/A'} userId=${secrets?.userId?.slice(0, 8) || 'none'}`);
  return scope;
}

/** Clear the active bridge (call after subagent completes). */
export function clearActiveBridge(scope?: ActiveBridgeScope | symbol) {
  if (!scope) {
    _activeBridgeScopes.length = 0;
    // Only clear globalThis ref if no scopes remain
    if (_activeBridgeScopes.length === 0) {
      delete (globalThis as any).__stuardActiveBridgeSecrets;
    }
    return;
  }

  const scopeId = typeof scope === 'symbol' ? scope : scope.id;
  const index = _activeBridgeScopes.findIndex((entry) => entry.id === scopeId);
  if (index >= 0) {
    _activeBridgeScopes.splice(index, 1);
  }
  // Update globalThis to the most recent remaining scope's secrets, or clear it
  if (_activeBridgeScopes.length === 0) {
    delete (globalThis as any).__stuardActiveBridgeSecrets;
  } else {
    // Point to the most recent scope with userId
    for (let i = _activeBridgeScopes.length - 1; i >= 0; i--) {
      if (_activeBridgeScopes[i]?.secrets?.userId) {
        (globalThis as any).__stuardActiveBridgeSecrets = _activeBridgeScopes[i].secrets;
        break;
      }
    }
  }
}

/** Check if a bridge is available (ALS or module-level fallback). */
function hasAnyBridge(): boolean {
  return !!getResolvedBridgeContext();
}

/**
 * Get bridge secrets with full fallback chain (ALS → scoped ALS → module-level stack).
 * Use this instead of getBridgeSecrets() when ALS propagation may be broken
 * (e.g. inside Mastra's tool execution pipeline).
 */
export function getResolvedBridgeSecrets(): Record<string, any> | undefined {
  const fallbackOnly = getResolvedBridgeSecretsFallbackOnly();
  if (fallbackOnly && Object.keys(fallbackOnly).length > 0) return fallbackOnly;

  const resolved = getResolvedBridgeContext()?.secrets;
  if (resolved && Object.keys(resolved).length > 0) return resolved;

  return undefined;
}

function injectLocalToolInput(
  id: string,
  inputData: any,
  secrets?: Record<string, any>,
) {
  if (!id.startsWith('browser_use_')) return inputData;
  const base = inputData && typeof inputData === 'object' ? { ...(inputData as any) } : {};
  const injectedSessionId = String(base.session_id || secrets?.browserUseSessionId || '').trim();
  if (injectedSessionId) {
    base.session_id = injectedSessionId;
  }
  return base;
}

export function getLocalToolSpec(tool: any): LocalToolSpec | undefined {
  if (!tool || typeof tool !== 'object') return undefined;
  return (tool as any).__localToolSpec as LocalToolSpec | undefined;
}

export async function execLocalToolWithCapturedBridge(
  id: string,
  inputData: any,
  writer: any,
  spec: LocalToolSpec,
  bridgeContext: ActiveBridgeContext,
): Promise<any> {
  const effectiveInput = injectLocalToolInput(id, inputData, bridgeContext?.secrets);
  const resolvedTimeout = typeof spec.timeoutMs === 'function'
    ? (spec.timeoutMs as any)(effectiveInput)
    : spec.timeoutMs;

  if (bridgeContext?.ws && bridgeContext.ws.readyState === 1) {
    return await withClientBridge(
      bridgeContext.ws,
      async () => execLocalTool(
        id,
        effectiveInput as any,
        writer as any,
        typeof resolvedTimeout === 'number' ? resolvedTimeout : undefined,
        { noFallback: spec.noFallback },
      ),
      bridgeContext.secrets,
    );
  }

  return await execLocalTool(
    id,
    effectiveInput as any,
    writer as any,
    typeof resolvedTimeout === 'number' ? resolvedTimeout : undefined,
    { noFallback: spec.noFallback },
  );
}

/**
 * Route a tool call to the user's VM agent via HTTP when no desktop bridge is available.
 * This allows browser_use_* and other device tools to run headlessly on the VM.
 */
async function execViaVM(toolId: string, args: any, timeoutMs: number): Promise<any> {
  const secrets = getBridgeSecrets() || getResolvedBridgeContext()?.secrets;
  const userId = secrets?.userId;
  if (!userId) return null; // no user context — can't route to VM

  try {
    const { sendVMCommand, resolveVMAddress } = await import('../../services/vm-command');
    const vmIp = await resolveVMAddress(userId);
    if (!vmIp) return null; // no VM running

    // Forward as a tool_exec command to the VM's Python agent via the Node.js relay
    const result = await sendVMCommand(userId, 'tool_exec', { tool: toolId, args }, timeoutMs);
    if (result.ok && result.result) return result.result;
    if (!result.ok && result.error === 'vm_not_reachable') return null;
    return result.result || { ok: false, error: result.error || 'vm_tool_failed' };
  } catch {
    return null; // VM routing failed — fall through to error
  }
}

// ── Local browser server direct HTTP fallback ───────────────────────────────
const LOCAL_BROWSER_HOST = process.env.STUARD_BROWSER_HOST || '127.0.0.1';
const LOCAL_BROWSER_PORT = Number(process.env.STUARD_BROWSER_PORT || process.env.BROWSER_USE_PORT || '18082');
const LOCAL_BROWSER_URL = `http://${LOCAL_BROWSER_HOST}:${LOCAL_BROWSER_PORT}`;
const LOCAL_BROWSER_AUTH_TOKEN = process.env.STUARD_BROWSER_AUTH_TOKEN || process.env.BROWSER_USE_AUTH_TOKEN || '';

let _browserServerProcess: ChildProcess | null = null;
let _browserServerStarting: Promise<boolean> | null = null;
let _loggedRemoteLocalBrowserSkip = false;

function canUseLocalBrowserFallback(): boolean {
  // Cloud Run and similar managed deployments do not have access to the
  // developer's local Python/browser environment, so localhost fallback is invalid.
  if (process.env.K_SERVICE || process.env.K_REVISION || process.env.CLOUD_RUN_JOB || process.env.CLOUD_RUN_EXECUTION) {
    return false;
  }
  return true;
}

function resolveBrowserServerMainScript(): string | null {
  const candidates = [
    pathResolve(MODULE_DIR, '..', '..', '..', '..', 'agent', 'browser_server_main.py'),
    pathResolve(MODULE_DIR, '..', '..', 'agent', 'browser_server_main.py'),
    pathResolve(process.cwd(), 'apps', 'agent', 'browser_server_main.py'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/** Check if the local browser server is reachable. */
async function isBrowserServerRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const headers: Record<string, string> = {};
    if (LOCAL_BROWSER_AUTH_TOKEN) headers['x-stuard-browser-token'] = LOCAL_BROWSER_AUTH_TOKEN;
    const resp = await fetch(`${LOCAL_BROWSER_URL}/status`, { signal: controller.signal, headers });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

/** Try to start the local Python browser server if not already running. */
async function ensureBrowserServer(): Promise<boolean> {
  if (!canUseLocalBrowserFallback()) {
    if (!_loggedRemoteLocalBrowserSkip) {
      _loggedRemoteLocalBrowserSkip = true;
      console.log('[local-browser] Skipping localhost browser fallback in managed cloud environment');
    }
    return false;
  }

  if (await isBrowserServerRunning()) return true;
  if (_browserServerStarting) return _browserServerStarting;

  _browserServerStarting = (async () => {
    try {
      // Resolve the browser_server_main.py entry point
      const mainScript = resolveBrowserServerMainScript();
      if (!mainScript) {
        console.warn('[local-browser] browser_server_main.py not found');
        return false;
      }
      const agentDir = dirname(mainScript);

      const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        STUARD_BROWSER_MODE: 'headed',
        STUARD_BROWSER_PORT: String(LOCAL_BROWSER_PORT),
        STUARD_BROWSER_HOST: LOCAL_BROWSER_HOST,
      };
      if (LOCAL_BROWSER_AUTH_TOKEN) {
        env.STUARD_BROWSER_AUTH_TOKEN = LOCAL_BROWSER_AUTH_TOKEN;
      }

      console.log(`[local-browser] Starting browser server: ${pythonBin} ${mainScript}`);
      _browserServerProcess = spawn(pythonBin, [mainScript], {
        env,
        cwd: agentDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        ...(process.platform === 'win32' ? { windowsHide: true } : {}),
      });

      _browserServerProcess.on('exit', (code) => {
        console.log(`[local-browser] Browser server exited with code ${code}`);
        _browserServerProcess = null;
      });
      _browserServerProcess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) console.warn(`[local-browser:stderr] ${text}`);
      });

      // Wait for the server to become reachable (up to 15s)
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isBrowserServerRunning()) {
          console.log('[local-browser] Browser server is ready');
          return true;
        }
      }
      console.warn('[local-browser] Browser server did not start in time');
      return false;
    } catch (e) {
      console.warn('[local-browser] Failed to start browser server:', e);
      return false;
    } finally {
      _browserServerStarting = null;
    }
  })();

  return _browserServerStarting;
}

/**
 * Execute a browser_use_* tool by calling the local browser server HTTP API directly.
 * Falls back to starting the server if not already running.
 */
async function execViaLocalBrowser(toolId: string, args: any, timeoutMs: number): Promise<any> {
  const serverReady = await ensureBrowserServer();
  if (!serverReady) return null;

  const rawAction = toolId.replace('browser_use_', '');
  // Map underscored tool names to hyphenated server endpoints where they differ
  const action = rawAction === 'execute_script' ? 'execute-script' : rawAction;
  const method = action === 'status' ? 'GET' : 'POST';
  const url = `${LOCAL_BROWSER_URL}/${action}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (LOCAL_BROWSER_AUTH_TOKEN) headers['x-stuard-browser-token'] = LOCAL_BROWSER_AUTH_TOKEN;

    const fetchOpts: RequestInit = { method, headers, signal: controller.signal };
    if (method === 'POST') fetchOpts.body = JSON.stringify(args || {});

    const resp = await fetch(url, fetchOpts);
    clearTimeout(timer);
    const data: any = await resp.json();
    if (!data?.ok) {
      console.warn(`[local-browser] ${toolId} → ${method} ${url} returned:`, JSON.stringify(data).slice(0, 300));
    }
    return data;
  } catch (e: any) {
    console.warn(`[local-browser] ${toolId} → ${method} ${url} failed:`, e?.message || e);
    return { ok: false, error: `local_browser_error: ${e?.message || e}` };
  }
}

/**
 * Strip top-level null values from a tool result so that Zod `.optional()` fields
 * don't fail validation. Python backends use `None` (→ JSON `null`) for absent
 * fields, but Zod `.optional()` only accepts `undefined` or missing keys.
 */
function stripNulls(result: any): any {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(result)) {
    if (v !== null) cleaned[k] = v;
  }
  return cleaned;
}

export function makeLocalTool(
  id: string,
  description: string,
  inputSchema: any,
  outputSchema?: any,
  timeoutMs?: number | ((ctx: any) => number),
  options?: { noFallback?: boolean },
) {
  const noFallback = options?.noFallback ?? false;
  const localToolSpec: LocalToolSpec = { timeoutMs, noFallback };
  const tool = createTool({
    id,
    description,
    inputSchema,
    outputSchema: outputSchema || z.any(),
    execute: async (inputData, { writer }) => {
      const bridgeContext = getResolvedBridgeContext();
      const effectiveInput = injectLocalToolInput(id, inputData, bridgeContext?.secrets);

      // Desktop bridge available — use it (fastest path)
      // Check both ALS-based bridge and module-level fallback (for subagent context where ALS is broken)
      const hasBridge = !!bridgeContext;
      if (id.startsWith('browser_use_')) {
        const scopedBridge = getScopedBridgeContext();
        const fallbackBridge = getFallbackBridgeScope();
        const source = hasClientBridge()
          ? 'als'
          : scopedBridge?.ws?.readyState === 1
            ? 'scoped'
            : fallbackBridge?.ws?.readyState === 1
              ? 'fallback'
              : 'none';
        console.log(
          `[makeLocalTool:${id}] hasBridge=${hasBridge} source=${source} ws=${!!bridgeContext?.ws} readyState=${bridgeContext?.ws?.readyState ?? 'N/A'}`,
        );
      }
      if (hasBridge) {
        return stripNulls(await execLocalToolWithCapturedBridge(id, inputData, writer, localToolSpec, bridgeContext!));
      }

      // No desktop bridge — try routing to VM, then local browser server
      if (noFallback && id.startsWith('browser_use_')) {
        const t = typeof timeoutMs === 'function' ? (timeoutMs as any)(effectiveInput) : timeoutMs;
        const effectiveTimeout = typeof t === 'number' ? t : 60000;

        // Try VM fallback first
        console.warn(`[makeLocalTool:${id}] No bridge — trying VM fallback`);
        const vmResult = await execViaVM(id, effectiveInput, effectiveTimeout);
        if (vmResult !== null) return stripNulls(vmResult);

        // Try local browser server (direct HTTP to localhost:18082)
        if (canUseLocalBrowserFallback()) {
          console.warn(`[makeLocalTool:${id}] No VM — trying local browser server`);
        } else {
          console.warn(`[makeLocalTool:${id}] No VM — skipping local browser server in managed cloud`);
        }
        const localResult = await execViaLocalBrowser(id, effectiveInput, effectiveTimeout);
        if (localResult !== null) return stripNulls(localResult);

        if (canUseLocalBrowserFallback()) {
          return { ok: false, error: `No desktop, VM, or local browser server available. ${id} requires a running Stuard desktop app, cloud VM, or local browser server.` };
        }

        return { ok: false, error: `No desktop bridge or VM available. ${id} requires a live Stuard desktop bridge or cloud VM in managed cloud environments.` };
      }

      if (noFallback) {
        return { ok: false, error: `No desktop bridge available. ${id} requires the Stuard desktop app.` };
      }

      const t = typeof timeoutMs === 'function' ? (timeoutMs as any)(effectiveInput) : timeoutMs;
      return stripNulls(await execLocalTool(id, effectiveInput as any, writer as any, typeof t === 'number' ? t : undefined, { noFallback }));
    },
  });
  (tool as any).__localToolSpec = localToolSpec;
  return tool;
}
