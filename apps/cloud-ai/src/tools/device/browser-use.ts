import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { makeLocalTool, execLocalTool, hasClientBridge, getBridgeSecrets } from './shared';
import { PUBLIC_BASE_URL } from '../../utils/config';

// ─── browser_use_status ─────────────────────────────────────────────────────

export const browser_use_status = makeLocalTool(
  'browser_use_status',
  'Check if browser-use is installed and running. Returns current mode (headed/headless/connect), active profile, and current page URL. Use this before other browser_use_* tools.',
  z.object({}),
  z.object({
    ok: z.boolean(),
    installed: z.boolean().optional(),
    running: z.boolean().optional(),
    mode: z.string().optional(),
    profile: z.string().optional(),
    profileDir: z.string().optional(),
    currentUrl: z.string().optional(),
    title: z.string().optional(),
    error: z.string().optional(),
  }),
  5000,
  { noFallback: true },
);

// ─── browser_use_configure ──────────────────────────────────────────────────

export const browser_use_configure = makeLocalTool(
  'browser_use_configure',
  'Configure the browser-use browser mode and profile. Modes: "headed" (visible window), "headless" (no UI), "connect" (attach to existing browser via CDP). Changing mode restarts the browser.',
  z.object({
    mode: z.enum(['headed', 'headless', 'connect']).optional().describe('Browser mode'),
    cdp_url: z.string().optional().describe('Chrome DevTools Protocol URL (only for "connect" mode, e.g. "http://localhost:9222")'),
    profile: z.string().optional().describe('Named profile for persistent cookies/sessions (default: "default")'),
  }),
  z.object({
    ok: z.boolean(),
    mode: z.string().optional(),
    profile: z.string().optional(),
    restarted: z.boolean().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_use_task ───────────────────────────────────────────────────────

export const browser_use_task = createTool({
  id: 'browser_use_task',
  description: 'Give a natural language task to the browser-use AI agent for autonomous web browsing. The agent will navigate, click, type, and extract data as needed to complete the task. Best for complex multi-step web tasks like "find the cheapest flight from NYC to LA on Google Flights" or "fill out this form with my information".',
  inputSchema: z.object({
    task: z.string().describe('Natural language description of the web task to accomplish'),
    max_steps: z.number().optional().describe('Maximum number of browser actions the agent can take (default: 25)'),
    model: z.string().optional().describe('LLM model for the browser agent (uses default if not specified)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    result: z.string().optional().describe('The agent\'s final result/answer'),
    task: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (inputData, { writer }) => {
    if (!hasClientBridge()) {
      return { ok: false, error: 'No desktop bridge available. browser_use_task requires the Stuard desktop app.' };
    }
    const raw = (inputData as any) || {};
    const task = String(raw.task || '').trim();
    if (!task) return { ok: false, error: 'task is required' };

    const args: Record<string, any> = {
      task: task.slice(0, 10000),
    };
    if (Number.isFinite(raw.max_steps)) {
      args.max_steps = Math.max(1, Math.min(120, Math.floor(Number(raw.max_steps))));
    }
    if (typeof raw.model === 'string' && /^[a-z0-9._/-]{1,120}$/i.test(raw.model.trim())) {
      args.model = raw.model.trim();
    }

    // Send cloud proxy URL + user's session token so the local Python server
    // calls back to our cloud for LLM inference. No API keys leave the server.
    const proxyUrl = PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8082}`;
    const secrets = getBridgeSecrets();
    const sessionToken = secrets?.accessToken || '';

    if (proxyUrl && sessionToken) {
      args._llm_proxy_url = proxyUrl;
      args._llm_session_token = sessionToken;
    }

    if (!args.model) {
      args.model = 'google/gemini-3-flash-preview';
    }

    return execLocalTool('browser_use_task', args, writer as any, 600000, { noFallback: true });
  },
});

// ─── browser_use_navigate ───────────────────────────────────────────────────

export const browser_use_navigate = makeLocalTool(
  'browser_use_navigate',
  'Navigate the browser to a URL. Waits for the page to load before returning. Cookies and sessions from the active profile are preserved.',
  z.object({
    url: z.string().describe('URL to navigate to'),
    wait_until: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional().describe('Wait condition (default: "domcontentloaded")'),
    timeout: z.number().optional().describe('Navigation timeout in ms (default: 30000)'),
    wait_for_selector: z.string().optional().describe('Optional CSS selector to wait for after navigation (more reliable on SPAs)'),
  }),
  z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    title: z.string().optional(),
    error: z.string().optional(),
  }),
  60000,
  { noFallback: true },
);

// ─── browser_use_click ──────────────────────────────────────────────────────

export const browser_use_click = makeLocalTool(
  'browser_use_click',
  'Click an element on the current page. Identify by CSS selector or visible text.',
  z.object({
    selector: z.string().optional().describe('CSS selector of the element to click'),
    text: z.string().optional().describe('Visible text of the element to click (alternative to selector)'),
    exact: z.boolean().optional().describe('Require exact text match when using text (default: false)'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    clicked: z.string().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_type ───────────────────────────────────────────────────────

export const browser_use_type = makeLocalTool(
  'browser_use_type',
  'Type text into an input field or the active element. Can clear existing content before typing.',
  z.object({
    selector: z.string().optional().describe('CSS selector of the input field (if omitted, types into focused element)'),
    text: z.string().describe('Text to type'),
    clear: z.boolean().optional().describe('Clear existing content before typing (default: true)'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    typed: z.number().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_press_key ──────────────────────────────────────────────────

export const browser_use_press_key = makeLocalTool(
  'browser_use_press_key',
  'Press a keyboard key in the browser (for example Enter, Tab, Escape, ArrowDown). Optionally focus an element first using a CSS selector.',
  z.object({
    key: z.string().describe('Key to press, for example "Enter", "Tab", "Escape", "ArrowDown"'),
    selector: z.string().optional().describe('Optional CSS selector to focus before pressing the key'),
  }),
  z.object({
    ok: z.boolean(),
    key: z.string().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_use_screenshot ─────────────────────────────────────────────────

export const browser_use_screenshot = makeLocalTool(
  'browser_use_screenshot',
  'Take a screenshot of the current browser page. Returns a base64-encoded PNG image.',
  z.object({
    full_page: z.boolean().optional().describe('Capture the full scrollable page instead of just the viewport (default: false)'),
  }),
  z.object({
    ok: z.boolean(),
    screenshot: z.string().optional().describe('Base64-encoded PNG screenshot'),
    format: z.string().optional(),
    url: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_content ────────────────────────────────────────────────────

export const browser_use_content = makeLocalTool(
  'browser_use_content',
  'Get the text or HTML content of the current page. Use "text" mode for readable content or "html" mode for the full HTML source.',
  z.object({
    mode: z.enum(['text', 'html']).optional().describe('Content mode: "text" for readable text (default), "html" for raw HTML'),
    max_length: z.number().optional().describe('Maximum content length in characters (default: 50000)'),
    wait_for_selector: z.string().optional().describe('Optional CSS selector to wait for before extracting content'),
    wait_timeout: z.number().optional().describe('Wait timeout in ms for wait_for_selector (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    mode: z.string().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_scroll ─────────────────────────────────────────────────────

export const browser_use_scroll = makeLocalTool(
  'browser_use_scroll',
  'Scroll the page or a specific element in any direction.',
  z.object({
    direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Scroll direction (default: "down")'),
    amount: z.number().optional().describe('Pixels to scroll (default: 500)'),
    selector: z.string().optional().describe('CSS selector of a scrollable container (scrolls page if omitted)'),
  }),
  z.object({
    ok: z.boolean(),
    direction: z.string().optional(),
    amount: z.number().optional(),
    error: z.string().optional(),
  }),
  5000,
  { noFallback: true },
);

// ─── browser_use_tabs ───────────────────────────────────────────────────────

export const browser_use_tabs = makeLocalTool(
  'browser_use_tabs',
  'Manage browser tabs: list open tabs, open a new tab, switch between tabs, or close a tab.',
  z.object({
    action: z.enum(['list', 'new', 'switch', 'close']).describe('Tab action'),
    index: z.number().optional().describe('Tab index for switch/close actions'),
    url: z.string().optional().describe('URL to open in a new tab'),
  }),
  z.object({
    ok: z.boolean(),
    tabs: z.array(z.object({
      index: z.number(),
      url: z.string(),
      title: z.string(),
      active: z.boolean(),
    })).optional(),
    count: z.number().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    closed: z.number().optional(),
    remaining: z.number().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_use_cookies ────────────────────────────────────────────────────

export const browser_use_cookies = makeLocalTool(
  'browser_use_cookies',
  'Manage browser cookies: get all cookies, set cookies, clear all cookies, export to file, or import from file. Useful for saving/restoring auth sessions.',
  z.object({
    action: z.enum(['get', 'set', 'clear', 'export', 'import']).describe('Cookie action'),
    cookies: z.array(z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string().optional(),
      path: z.string().optional(),
      url: z.string().optional(),
    })).optional().describe('Cookies to set (for "set" action)'),
    urls: z.array(z.string()).optional().describe('Filter cookies by URLs (for "get" action)'),
    path: z.string().optional().describe('File path for export/import'),
  }),
  z.object({
    ok: z.boolean(),
    cookies: z.array(z.any()).optional(),
    count: z.number().optional(),
    set: z.number().optional(),
    cleared: z.boolean().optional(),
    exported: z.number().optional(),
    imported: z.number().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);
