import { z } from 'zod';
import { makeLocalTool } from './shared';

// browser_ext_* — act on the user's REAL, logged-in browser through the paired
// Stuard Browser Connector extension. This is distinct from browser_use_*, which
// drives a separate sandboxed Chrome. Use these when the user means "the tab I'm
// looking at", "my tabs", or wants something done in their own browser session.
//
// All are noFallback: they require the Stuard desktop app + a paired extension.

const tabSchema = z.object({
  id: z.number().optional(),
  index: z.number().optional(),
  windowId: z.number().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  active: z.boolean().optional(),
  pinned: z.boolean().optional(),
  audible: z.boolean().optional(),
  groupId: z.number().optional(),
  favIconUrl: z.string().optional(),
});

// ─── browser_ext_status ──────────────────────────────────────────────────────

export const browser_ext_status = makeLocalTool(
  'browser_ext_status',
  "Check whether the user's real browser is connected via the Stuard Browser Connector extension. Returns the connected browser, capabilities (whether full scripting is enabled), and the active tab. Use this before other browser_ext_* tools when unsure if a browser is paired.",
  z.object({}),
  z.object({
    ok: z.boolean(),
    connected: z.boolean().optional(),
    bridgeRunning: z.boolean().optional(),
    paired: z.boolean().optional(),
    browser: z.string().optional(),
    version: z.string().optional(),
    userScriptsAvailable: z.boolean().optional(),
    activeTab: tabSchema.nullable().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_ext_get_page ────────────────────────────────────────────────────

export const browser_ext_get_page = makeLocalTool(
  'browser_ext_get_page',
  "Read the page the user is currently looking at (or a specific tab): URL, title, current text selection, meta tags, and readable text. Read-only and CSP-safe — works on every site. Use this to answer questions about 'this page' / 'what I'm reading'.",
  z.object({
    tabId: z.number().optional().describe('Target tab id (from browser_ext_tabs). Defaults to the active tab.'),
    max_chars: z.number().optional().describe('Max characters of readable text to return (default 20000).'),
    include_html: z.boolean().optional().describe('Also include the raw outer HTML (capped). Default false.'),
  }),
  z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    title: z.string().optional(),
    selection: z.string().optional(),
    text: z.string().optional(),
    textLength: z.number().optional(),
    truncated: z.boolean().optional(),
    meta: z.record(z.string(), z.string()).optional(),
    html: z.string().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_ext_extract ─────────────────────────────────────────────────────

export const browser_ext_extract = makeLocalTool(
  'browser_ext_extract',
  "Extract structured rows from the current page by CSS selectors. Reliable on every site (compiled, no eval) — the best tool for scraping repeated items like Reddit comments, search results, or table rows. Provide `item` (selector for each row) and optional `fields` mapping names to sub-selectors.",
  z.object({
    tabId: z.number().optional().describe('Target tab id. Defaults to the active tab.'),
    container: z.string().optional().describe('Optional CSS selector to scope the search.'),
    item: z.string().describe("CSS selector matching each row, e.g. 'shreddit-comment' or '.comment'."),
    limit: z.number().optional().describe('Max rows to return (default 200).'),
    fields: z.record(
      z.string(),
      z.object({
        selector: z.string().optional().describe('Sub-selector within the row; omit to use the row itself.'),
        attr: z.string().optional().describe("Return this attribute instead of text (e.g. 'href')."),
        html: z.boolean().optional().describe('Return innerHTML instead of text.'),
      }),
    ).optional().describe("Map of fieldName -> extraction. Omit to return each row's text."),
  }),
  z.object({
    ok: z.boolean(),
    count: z.number().optional(),
    rows: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_ext_run_script ──────────────────────────────────────────────────

export const browser_ext_run_script = makeLocalTool(
  'browser_ext_run_script',
  "Run agent-authored JavaScript in the user's current tab and return JSON. Use for logic beyond plain selector extraction (clicking through state, computing, transforming the DOM). The script body runs inside an async function with an `args` object in scope; return a JSON-serializable value. Requires the user's approval. On strict-CSP sites it needs 'Allow user scripts' enabled; prefer browser_ext_extract for pure scraping.",
  z.object({
    script: z.string().describe('JavaScript body. Runs in an async function; an `args` object is in scope; return JSON-serializable data.'),
    args: z.record(z.string(), z.any()).optional().describe('Named values exposed to the script as `args`.'),
    tabId: z.number().optional().describe('Target tab id. Defaults to the active tab.'),
    timeout: z.number().optional().describe('Max execution time in ms (default 30000).'),
  }),
  z.object({
    ok: z.boolean(),
    result: z.any().optional(),
    engine: z.string().optional().describe("Which engine ran it: 'userScripts' or 'main'."),
    error: z.string().optional(),
  }),
  (input) => {
    const raw = Number((input as any)?.timeout ?? 30000);
    const t = Number.isFinite(raw) ? Math.max(1000, Math.min(120000, Math.floor(raw))) : 30000;
    return t + 6000;
  },
  { noFallback: true },
);

// ─── browser_ext_tabs ────────────────────────────────────────────────────────

export const browser_ext_tabs = makeLocalTool(
  'browser_ext_tabs',
  "Manage the user's real browser tabs. Read-only actions (list, query) run instantly; mutating actions (activate, close, create, reload, move, group, ungroup) require the user's approval. This powers 'organize my tabs' and study-mode automations. Use list/query first to get tab ids.",
  z.object({
    action: z.enum(['list', 'query', 'activate', 'close', 'create', 'reload', 'move', 'group', 'ungroup']).describe('Tab action.'),
    tabId: z.number().optional().describe('Single tab id for activate/close/reload/move.'),
    tabIds: z.array(z.number()).optional().describe('Tab ids for close/group/ungroup.'),
    url: z.string().optional().describe('URL for create.'),
    index: z.number().optional().describe('Target index for move.'),
    query: z.record(z.string(), z.any()).optional().describe('chrome.tabs.query filter, e.g. { url: "*://*.reddit.com/*", audible: true }.'),
    title: z.string().optional().describe('Group title (for group).'),
    color: z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']).optional().describe('Group color (for group).'),
    collapsed: z.boolean().optional().describe('Collapse the group after creating it.'),
  }),
  z.object({
    ok: z.boolean(),
    count: z.number().optional(),
    tabs: z.array(tabSchema).optional(),
    tab: tabSchema.nullable().optional(),
    closed: z.number().optional(),
    groupId: z.number().optional(),
    error: z.string().optional(),
  }),
  12000,
  { noFallback: true },
);

// ─── browser_ext_capture_screenshot ──────────────────────────────────────────

export const browser_ext_capture_screenshot = makeLocalTool(
  'browser_ext_capture_screenshot',
  "Capture a screenshot of the visible area of the user's current tab. Returns a base64 data URL. Read-only.",
  z.object({
    tabId: z.number().optional().describe('Target tab id. Defaults to the active tab.'),
    format: z.enum(['jpeg', 'png']).optional().describe('Image format (default jpeg).'),
    quality: z.number().optional().describe('JPEG quality 0-100 (default 60).'),
  }),
  z.object({
    ok: z.boolean(),
    dataUrl: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_ext_service_* (saved mini-scripts) ──────────────────────────────

export const browser_ext_service_list = makeLocalTool(
  'browser_ext_service_list',
  'List the saved browser "mini-services" — reusable scripts/actions the user can run on demand or from a scheduled workflow (e.g. a "study-mode" tab cleaner). Read-only.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    count: z.number().optional(),
    services: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      action: z.string(),
      updatedAt: z.string().optional(),
    })).optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

export const browser_ext_service_save = makeLocalTool(
  'browser_ext_service_save',
  'Save (or update) a reusable browser mini-service: a named action + payload the user can re-run or schedule. `action` is one of run_script | extract | tabs | get_page | capture_screenshot, and `payload` is the arguments for that action. Requires the user\'s approval. Example: a "study-mode" service with action="run_script" that closes non-study tabs.',
  z.object({
    id: z.string().optional().describe('Existing service id to update. Omit to create (or match by name).'),
    name: z.string().describe('Human name, e.g. "Study mode".'),
    description: z.string().optional().describe('What it does.'),
    action: z.enum(['run_script', 'extract', 'tabs', 'get_page', 'capture_screenshot']).describe('Bridge action to run.'),
    payload: z.record(z.string(), z.any()).describe('Arguments for the action (e.g. { script: "..." } or { action: "close", tabIds: [...] }).'),
  }),
  z.object({
    ok: z.boolean(),
    service: z.object({ id: z.string(), name: z.string(), action: z.string() }).optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

export const browser_ext_service_run = makeLocalTool(
  'browser_ext_service_run',
  "Run a saved browser mini-service by id or name, optionally overriding its payload. Requires the user's approval. This is the tool a scheduled workflow calls to, e.g., enforce study-mode tabs at a set time.",
  z.object({
    id: z.string().optional().describe('Service id.'),
    name: z.string().optional().describe('Service name (alternative to id).'),
    overrides: z.record(z.string(), z.any()).optional().describe('Payload fields to override for this run.'),
  }),
  z.object({
    ok: z.boolean(),
    service: z.string().optional(),
    action: z.string().optional(),
    result: z.any().optional(),
    error: z.string().optional(),
  }),
  40000,
  { noFallback: true },
);

export const browser_ext_service_delete = makeLocalTool(
  'browser_ext_service_delete',
  "Delete a saved browser mini-service by id or name. Requires the user's approval.",
  z.object({
    id: z.string().optional().describe('Service id.'),
    name: z.string().optional().describe('Service name (alternative to id).'),
  }),
  z.object({
    ok: z.boolean(),
    deleted: z.string().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);
