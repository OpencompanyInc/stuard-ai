/**
 * browser_ext_* handlers — drive the user's REAL browser through the paired
 * Stuard Browser Connector extension (see services/extension-bridge.ts).
 *
 * Safety posture ("approve sensitive, auto-run the rest"): read-only actions
 * (status, get_page, extract, screenshot, tab list/query) run instantly.
 * Anything that runs arbitrary code or mutates the browser (run_script, closing/
 * creating/moving/grouping tabs, saving/running/deleting services) asks for a
 * desktop approval first — unless ctx.preapproved (bot runs gate upstream).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { RouterContext } from '../types';
import { sendExtensionCommand, isExtensionConnected, getExtensionBridgeInfo } from '../../services/extension-bridge';
import { requestToolApproval } from '../../services/tool-approval';

// ── Sensitive-action gate ────────────────────────────────────────────────────

const MUTATING_TAB_ACTIONS = new Set(['close', 'create', 'activate', 'reload', 'move', 'group', 'ungroup']);

function hostFromArgs(args: any): string {
  const url = String(args?.url || '');
  try { return url ? new URL(url).hostname : ''; } catch { return ''; }
}

async function gate(
  ctx: RouterContext,
  toolName: string,
  description: string,
): Promise<boolean> {
  if (ctx.preapproved === true) return true;
  ctx.logFn?.(`${toolName}: waiting for permission...`);
  return requestToolApproval({
    id: crypto.randomBytes(10).toString('hex'),
    tool: toolName,
    toolOriginal: toolName,
    description,
    timeoutMs: 55_000,
  });
}

function denied() {
  return { ok: false, error: 'denied_by_user' };
}

// ── Bridge forwarding ────────────────────────────────────────────────────────

async function forward(action: string, payload: Record<string, any>, timeoutMs: number): Promise<any> {
  const resp = await sendExtensionCommand(action, payload, timeoutMs);
  if (!resp.ok) return { ok: false, error: resp.error || 'extension_command_failed' };
  // The extension returns a structured result (already shaped { ok, ... }).
  return resp.result ?? { ok: true };
}

// ── Saved services store (userData JSON) ─────────────────────────────────────

export interface BrowserExtService {
  id: string;
  name: string;
  description?: string;
  action: string; // bridge action: run_script | extract | tabs | get_page | capture_screenshot
  payload: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

function servicesPath(): string {
  return path.join(app.getPath('userData'), 'browser-ext-services.json');
}

function readServices(): BrowserExtService[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(servicesPath(), 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeServices(list: BrowserExtService[]): void {
  try {
    fs.writeFileSync(servicesPath(), JSON.stringify(list, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch (e: any) {
    throw new Error(`failed_to_save_services: ${e?.message || e}`);
  }
}

function findService(list: BrowserExtService[], idOrName: string): BrowserExtService | undefined {
  const key = String(idOrName || '').trim().toLowerCase();
  return list.find((s) => s.id.toLowerCase() === key || s.name.toLowerCase() === key);
}

/** Read-only accessor for the Settings UI / IPC. */
export function listBrowserExtServices(): BrowserExtService[] {
  return readServices();
}

// ── Tool handlers ────────────────────────────────────────────────────────────

export async function execBrowserExtStatus(_args: any, _ctx: RouterContext): Promise<any> {
  const info = getExtensionBridgeInfo();
  if (!isExtensionConnected()) {
    return {
      ok: true,
      connected: false,
      bridgeRunning: info.running,
      paired: info.paired,
      error: info.running
        ? 'No paired browser. Install the Stuard Browser Connector and pair it (Settings → Browser Extension).'
        : 'Browser bridge not running.',
    };
  }
  const live = await forward('status', {}, 8000);
  return { ok: true, connected: true, browser: info.browser, version: info.version, ...live };
}

export async function execBrowserExtGetPage(args: any, _ctx: RouterContext): Promise<any> {
  return forward('get_page', {
    tabId: args?.tabId,
    maxChars: args?.max_chars ?? args?.maxChars,
    includeHtml: args?.include_html ?? args?.includeHtml,
  }, 15000);
}

export async function execBrowserExtExtract(args: any, _ctx: RouterContext): Promise<any> {
  const spec = args?.spec && typeof args.spec === 'object' ? args.spec : args;
  return forward('extract', { tabId: args?.tabId, spec }, 15000);
}

export async function execBrowserExtCaptureScreenshot(args: any, _ctx: RouterContext): Promise<any> {
  return forward('capture_screenshot', {
    tabId: args?.tabId,
    format: args?.format,
    quality: args?.quality,
  }, 15000);
}

export async function execBrowserExtRunScript(args: any, ctx: RouterContext): Promise<any> {
  const script = String(args?.script || '').trim();
  if (!script) return { ok: false, error: 'script is required' };

  const host = hostFromArgs(args);
  const where = host ? ` on ${host}` : ' on the current tab';
  const approved = await gate(ctx, 'browser_ext_run_script', `Stuard wants to run a script${where} in your browser.`);
  if (!approved) return denied();

  const timeoutRaw = Number(args?.timeout ?? 30000);
  const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(1000, Math.min(120000, Math.floor(timeoutRaw))) : 30000;
  return forward('run_script', {
    tabId: args?.tabId,
    script,
    args: args?.args && typeof args.args === 'object' ? args.args : undefined,
  }, timeoutMs + 3000);
}

export async function execBrowserExtTabs(args: any, ctx: RouterContext): Promise<any> {
  const action = String(args?.action || 'list');
  const payload = {
    action,
    tabId: args?.tabId,
    tabIds: args?.tabIds,
    url: args?.url,
    index: args?.index,
    query: args?.query,
    title: args?.title,
    color: args?.color,
    collapsed: args?.collapsed,
    bypassCache: args?.bypassCache,
  };

  if (MUTATING_TAB_ACTIONS.has(action)) {
    const approved = await gate(ctx, 'browser_ext_tabs', `Stuard wants to ${action} tab(s) in your browser.`);
    if (!approved) return denied();
  }
  return forward('tabs', payload, 10000);
}

// ── Services ─────────────────────────────────────────────────────────────────

export async function execBrowserExtServiceList(_args: any, _ctx: RouterContext): Promise<any> {
  const list = readServices();
  return {
    ok: true,
    count: list.length,
    services: list.map((s) => ({ id: s.id, name: s.name, description: s.description, action: s.action, updatedAt: s.updatedAt })),
  };
}

export async function execBrowserExtServiceSave(args: any, ctx: RouterContext): Promise<any> {
  const name = String(args?.name || '').trim();
  const action = String(args?.action || '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  if (!action) return { ok: false, error: 'action is required (run_script | extract | tabs | get_page | capture_screenshot)' };

  const approved = await gate(ctx, 'browser_ext_service_save', `Stuard wants to save a browser mini-service "${name}".`);
  if (!approved) return denied();

  const list = readServices();
  const existing = args?.id ? findService(list, String(args.id)) : findService(list, name);
  const now = new Date().toISOString();
  const payload = args?.payload && typeof args.payload === 'object' ? args.payload : {};

  if (existing) {
    existing.name = name;
    existing.description = args?.description ?? existing.description;
    existing.action = action;
    existing.payload = payload;
    existing.updatedAt = now;
  } else {
    list.push({
      id: `svc_${crypto.randomBytes(6).toString('hex')}`,
      name,
      description: args?.description,
      action,
      payload,
      createdAt: now,
      updatedAt: now,
    });
  }
  writeServices(list);
  const saved = existing || list[list.length - 1];
  return { ok: true, service: { id: saved.id, name: saved.name, action: saved.action } };
}

export async function execBrowserExtServiceDelete(args: any, ctx: RouterContext): Promise<any> {
  const key = String(args?.id || args?.name || '').trim();
  if (!key) return { ok: false, error: 'id or name is required' };
  const list = readServices();
  const svc = findService(list, key);
  if (!svc) return { ok: false, error: 'service_not_found' };

  const approved = await gate(ctx, 'browser_ext_service_delete', `Stuard wants to delete the mini-service "${svc.name}".`);
  if (!approved) return denied();

  writeServices(list.filter((s) => s.id !== svc.id));
  return { ok: true, deleted: svc.id };
}

export async function execBrowserExtServiceRun(args: any, ctx: RouterContext): Promise<any> {
  const key = String(args?.id || args?.name || '').trim();
  if (!key) return { ok: false, error: 'id or name is required' };
  const svc = findService(readServices(), key);
  if (!svc) return { ok: false, error: 'service_not_found' };

  const overrides = args?.overrides && typeof args.overrides === 'object' ? args.overrides : {};
  const payload = { ...svc.payload, ...overrides };

  // Running a saved service is sensitive: it may script or mutate the browser.
  const approved = await gate(ctx, 'browser_ext_service_run', `Stuard wants to run the browser service "${svc.name}".`);
  if (!approved) return denied();

  const timeoutMs = svc.action === 'run_script' ? 33000 : 15000;
  const result = await forward(svc.action, payload, timeoutMs);
  return { ok: result?.ok !== false, service: svc.name, action: svc.action, result };
}
