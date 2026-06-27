// Stuard Browser Connector — background service worker.
//
// Responsibilities:
//   1. Hold a persistent WebSocket to the Stuard desktop bridge and keep it
//      alive across MV3 service-worker recycling (the old extension's #1 bug:
//      the worker died after 30s and you had to click the popup to wake it).
//      Fix: chrome.alarms wakes the worker every 30s and re-opens the socket;
//      an open socket's inbound traffic also resets the idle timer.
//   2. Execute commands from the desktop against the user's real tabs using
//      on-demand injection (chrome.scripting / chrome.userScripts) — no declared
//      content scripts, so there is never a "refresh the page (F5)" dead end.

import {
  BRIDGE_PORTS,
  PROTOCOL_VERSION,
  type BridgeAction,
  type CommandMessage,
  type DesktopMessage,
} from '../shared/protocol';
import { pageSnapshot, extractRows, runScriptMainWorld } from './page-functions';

const VERSION = '1.0.0';
const KEEPALIVE_ALARM = 'stuard-keepalive';
const STORAGE_TOKEN = 'stuard_pairing_token';
const STORAGE_PORT = 'stuard_bridge_port';

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'paired' | 'needs_pairing';

let socket: WebSocket | null = null;
let portIndex = 0;
let backoffMs = 1000;
let connState: ConnState = 'disconnected';
let lastError = '';

// ── Connection lifecycle ─────────────────────────────────────────────────────

function setState(state: ConnState, error = '') {
  connState = state;
  lastError = error;
  const text = state === 'paired' ? '' : state === 'needs_pairing' ? 'key' : '!';
  const color = state === 'paired' ? '#16a34a' : state === 'needs_pairing' ? '#d97706' : '#dc2626';
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
  // Popup may be open; ignore "no receiver" errors.
  chrome.runtime.sendMessage({ type: 'state', state, error }).catch(() => {});
}

async function getToken(): Promise<string> {
  const got = await chrome.storage.local.get(STORAGE_TOKEN);
  return String(got[STORAGE_TOKEN] || '');
}

async function ensureConnected() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  connect();
}

async function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  // Prefer the port that worked last time, then sweep the range.
  const stored = await chrome.storage.local.get(STORAGE_PORT);
  if (typeof stored[STORAGE_PORT] === 'number') {
    const idx = BRIDGE_PORTS.indexOf(stored[STORAGE_PORT]);
    if (idx >= 0) portIndex = idx;
  }

  const port = BRIDGE_PORTS[portIndex % BRIDGE_PORTS.length];
  setState('connecting');

  let ws: WebSocket;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/stuard-extension`);
  } catch (e: any) {
    scheduleReconnect(`connect_failed: ${e?.message || e}`);
    return;
  }
  socket = ws;

  ws.onopen = async () => {
    backoffMs = 1000;
    await chrome.storage.local.set({ [STORAGE_PORT]: port });
    const token = await getToken();
    send({
      type: 'hello',
      client: 'extension',
      protocol: PROTOCOL_VERSION,
      extId: chrome.runtime.id,
      version: VERSION,
      token,
      browser: detectBrowser(),
    });
    setState('connected');
  };

  ws.onmessage = (ev) => {
    let msg: DesktopMessage;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleDesktopMessage(msg);
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    scheduleReconnect('socket_closed');
  };

  ws.onerror = () => {
    // onclose fires next; advance the port so the next attempt sweeps the range.
    portIndex = (portIndex + 1) % BRIDGE_PORTS.length;
  };
}

function scheduleReconnect(reason: string) {
  setState('disconnected', reason);
  const delay = Math.min(backoffMs, 15000);
  backoffMs = Math.min(backoffMs * 2, 15000);
  setTimeout(() => ensureConnected(), delay);
}

function send(obj: unknown) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
  }
}

/** @types/chrome lags the API; userScripts.execute (Chrome 135+) may be untyped. */
function userScriptsReady(): boolean {
  return typeof (chrome.userScripts as any)?.execute === 'function';
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Brave/.test(ua) || (navigator as any).brave) return 'brave';
  if (/OPR\//.test(ua)) return 'opera';
  return 'chrome';
}

// ── Desktop → extension dispatch ─────────────────────────────────────────────

async function handleDesktopMessage(msg: DesktopMessage) {
  switch (msg.type) {
    case 'welcome':
      setState(msg.paired ? 'paired' : 'needs_pairing');
      return;
    case 'ping':
      send({ type: 'pong', ts: Date.now() });
      return;
    case 'command':
      await handleCommand(msg);
      return;
  }
}

async function handleCommand(cmd: CommandMessage) {
  const reply = (ok: boolean, result?: unknown, error?: string) =>
    send({ type: 'result', id: cmd.id, ok, result, error });
  try {
    const result = await runAction(cmd.action, (cmd.payload || {}) as Record<string, unknown>);
    reply(true, result);
  } catch (e: any) {
    reply(false, undefined, String(e?.message || e));
  }
}

async function runAction(action: BridgeAction, payload: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case 'status':
      return getStatus();
    case 'get_page':
      return injectFunc(await resolveTabId(payload), pageSnapshot, [
        {
          maxChars: payload.maxChars as number | undefined,
          includeHtml: payload.includeHtml as boolean | undefined,
        },
      ]);
    case 'extract':
      return injectFunc(await resolveTabId(payload), extractRows, [payload.spec ?? payload]);
    case 'run_script':
      return runUserScript(await resolveTabId(payload), payload);
    case 'tabs':
      return handleTabs(payload);
    case 'capture_screenshot':
      return captureScreenshot(payload);
    default:
      throw new Error(`unknown_action: ${action}`);
  }
}

async function getStatus() {
  const tab = await activeTab();
  return {
    ok: true,
    connected: connState,
    version: VERSION,
    browser: detectBrowser(),
    userScriptsAvailable: userScriptsReady(),
    activeTab: tab ? simplifyTab(tab) : null,
  };
}

// ── Tab helpers ──────────────────────────────────────────────────────────────

function simplifyTab(t: chrome.tabs.Tab) {
  return {
    id: t.id,
    index: t.index,
    windowId: t.windowId,
    url: t.url || t.pendingUrl || '',
    title: t.title || '',
    active: !!t.active,
    pinned: !!t.pinned,
    audible: !!t.audible,
    groupId: t.groupId,
    favIconUrl: t.favIconUrl,
  };
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs[0]) tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function resolveTabId(payload: Record<string, unknown>): Promise<number> {
  if (typeof payload.tabId === 'number') return payload.tabId;
  const tab = await activeTab();
  if (!tab?.id) throw new Error('no_active_tab');
  assertScriptable(tab.url || '');
  return tab.id;
}

function assertScriptable(url: string) {
  if (
    !url ||
    /^(chrome|edge|brave|about|chrome-extension|moz-extension|view-source|devtools):/i.test(url) ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  ) {
    throw new Error(`restricted_page: cannot run on "${url || 'this page'}". Open a normal website tab.`);
  }
}

async function injectFunc<A extends any[], R>(
  tabId: number,
  func: (...args: A) => R,
  args: A,
): Promise<R> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: func as any,
    args: args as any[],
  });
  if (res?.result === undefined && (res as any)?.error) throw new Error(String((res as any).error));
  return res?.result as R;
}

// ── run_script: userScripts (CSP-proof) → MAIN-world eval fallback ───────────

async function runUserScript(tabId: number, payload: Record<string, unknown>) {
  const code = String(payload.script || payload.code || '');
  if (!code.trim()) return { ok: false, error: 'empty_script' };
  const args = (payload.args && typeof payload.args === 'object' ? payload.args : {}) as Record<string, unknown>;

  // Preferred engine: chrome.userScripts.execute runs in an isolated USER_SCRIPT
  // world that is exempt from the page's CSP, so eval-free dynamic code works on
  // every site (including Reddit's strict CSP). Requires the user to enable
  // "Allow user scripts" once on chrome://extensions.
  if (userScriptsReady()) {
    try {
      const wrapped = `(async () => { const args = ${JSON.stringify(args)}; ${code} })()`;
      const results: any[] = await (chrome.userScripts as any).execute({
        target: { tabId },
        injectImmediately: true,
        world: 'USER_SCRIPT',
        js: [{ code: wrapped }],
      });
      const first = results?.[0];
      if (first?.error) return { ok: false, error: String(first.error), engine: 'userScripts' };
      const value = first?.result;
      return { ok: true, engine: 'userScripts', result: value === undefined ? null : value };
    } catch (e: any) {
      // Fall through to MAIN-world eval.
      lastError = String(e?.message || e);
    }
  }

  // Fallback: MAIN-world Function constructor. Works where the page CSP allows
  // eval; otherwise returns a clear, actionable error.
  const out = await injectFunc(tabId, runScriptMainWorld, [code, args]);
  if (!(out as any).ok && (out as any).cspBlocked) {
    return {
      ok: false,
      engine: 'main',
      error:
        "This site's Content-Security-Policy blocks dynamic scripts. Enable 'Allow user scripts' " +
        'for Stuard on chrome://extensions, or use browser_ext_extract for DOM scraping.',
    };
  }
  return { ...(out as any), engine: 'main' };
}

// ── tabs ─────────────────────────────────────────────────────────────────────

async function handleTabs(p: Record<string, any>) {
  const action = String(p.action || 'list');
  switch (action) {
    case 'list': {
      const tabs = await chrome.tabs.query({});
      return { ok: true, count: tabs.length, tabs: tabs.map(simplifyTab) };
    }
    case 'query': {
      const tabs = await chrome.tabs.query(p.query || {});
      return { ok: true, count: tabs.length, tabs: tabs.map(simplifyTab) };
    }
    case 'activate': {
      const tab = await chrome.tabs.update(p.tabId, { active: true });
      if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true, tab: tab ? simplifyTab(tab) : null };
    }
    case 'close': {
      const ids: number[] = p.tabIds || (p.tabId != null ? [p.tabId] : []);
      if (!ids.length) return { ok: false, error: 'no_tab_ids' };
      await chrome.tabs.remove(ids);
      return { ok: true, closed: ids.length };
    }
    case 'create': {
      const tab = await chrome.tabs.create({ url: p.url, active: p.active !== false });
      return { ok: true, tab: simplifyTab(tab) };
    }
    case 'reload': {
      await chrome.tabs.reload(p.tabId, { bypassCache: !!p.bypassCache });
      return { ok: true };
    }
    case 'move': {
      const tab = await chrome.tabs.move(p.tabId, { index: typeof p.index === 'number' ? p.index : -1 });
      return { ok: true, tab: Array.isArray(tab) ? tab.map(simplifyTab) : simplifyTab(tab) };
    }
    case 'group': {
      const ids: number[] = p.tabIds || [];
      if (!ids.length) return { ok: false, error: 'no_tab_ids' };
      const groupId = await chrome.tabs.group({ tabIds: ids as [number, ...number[]] });
      if (p.title || p.color) {
        await chrome.tabGroups.update(groupId, {
          title: p.title,
          color: p.color,
          collapsed: p.collapsed,
        });
      }
      return { ok: true, groupId };
    }
    case 'ungroup': {
      const ids: number[] = p.tabIds || (p.tabId != null ? [p.tabId] : []);
      await chrome.tabs.ungroup(ids as [number, ...number[]]);
      return { ok: true };
    }
    default:
      return { ok: false, error: `unknown_tabs_action: ${action}` };
  }
}

async function captureScreenshot(p: Record<string, any>) {
  const tab = p.tabId != null ? await chrome.tabs.get(p.tabId) : await activeTab();
  if (!tab?.windowId) return { ok: false, error: 'no_window' };
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: p.format === 'png' ? 'png' : 'jpeg',
    quality: typeof p.quality === 'number' ? p.quality : 60,
  });
  return { ok: true, dataUrl, url: tab.url, title: tab.title };
}

// ── Popup messaging ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'getState') {
      sendResponse({ state: connState, error: lastError, userScriptsAvailable: userScriptsReady() });
      return;
    }
    if (message?.type === 'setToken') {
      await chrome.storage.local.set({ [STORAGE_TOKEN]: String(message.token || '') });
      // Force a fresh handshake with the new token.
      try { socket?.close(); } catch {}
      socket = null;
      backoffMs = 1000;
      await ensureConnected();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'reconnect') {
      try { socket?.close(); } catch {}
      socket = null;
      backoffMs = 1000;
      await ensureConnected();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: 'unknown_message' });
  })();
  return true; // async response
});

// ── Boot + keepalive ─────────────────────────────────────────────────────────

chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void ensureConnected();
});

chrome.runtime.onStartup.addListener(() => void ensureConnected());
chrome.runtime.onInstalled.addListener(() => void ensureConnected());

void ensureConnected();
