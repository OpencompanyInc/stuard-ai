import { z } from 'zod';
import { makeLocalTool } from './shared';

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

// ─── browser_use_execute_script ─────────────────────────────────────────────

export const browser_use_execute_script = makeLocalTool(
  'browser_use_execute_script',
  'Execute JavaScript inside the current browser-use page context. Best for complex extraction, DOM transformation, or page logic where one script is cleaner than many tool calls. The script runs inside an async function and should return JSON-serializable data.',
  z.object({
    script: z.string().describe('JavaScript body to execute in the page context. The script runs inside an async function with an `args` object in scope; return a JSON-serializable value.'),
    args: z.record(z.string(), z.any()).optional().describe('Named arguments exposed to the script as `args`'),
    wait_for_selector: z.string().optional().describe('Optional CSS selector to wait for before running the script'),
    wait_timeout: z.number().optional().describe('Wait timeout in ms for wait_for_selector (default: 5000)'),
    timeout: z.number().optional().describe('Maximum script execution time in ms (default: 30000)'),
  }),
  z.object({
    ok: z.boolean(),
    result: z.any().optional().describe('JSON-serializable value returned by the script'),
    url: z.string().optional(),
    title: z.string().optional(),
    elapsedMs: z.number().optional(),
    error: z.string().optional(),
  }),
  (inputData) => {
    const rawTimeout = Number((inputData as any)?.timeout ?? 30000);
    const timeout = Number.isFinite(rawTimeout) ? Math.max(1000, Math.min(300000, Math.floor(rawTimeout))) : 30000;
    return timeout + 5000;
  },
  { noFallback: true },
);

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
  'Click an element on the current page. Identify by CSS selector or visible text. For best results, call browser_use_get_interactive_elements first to discover available elements and their exact selectors. Uses multiple click strategies including Playwright native click, text matching, role-based matching, and label matching for maximum reliability.',
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
  'Type text into an input field or the active element. Can clear existing content before typing. Works with React, Vue, Angular and other frameworks. For best results, specify a CSS selector (use browser_use_get_interactive_elements to discover them). If no selector is given, types into the currently focused element.',
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
  'Take a screenshot of the current browser page. Returns the saved PNG image path.',
  z.object({
    full_page: z.boolean().optional().describe('Capture the full scrollable page instead of just the viewport (default: false)'),
  }),
  z.object({
    ok: z.boolean(),
    image_path: z.string().optional().describe('Absolute path to the saved PNG screenshot'),
    screenshot_path: z.string().optional().describe('Alias of image_path for compatibility'),
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
  'Get the text or HTML content of the current page. Use "text" mode for readable content or "html" mode for the full HTML source. For understanding page structure and interactive elements, prefer browser_use_get_interactive_elements instead — it returns structured data about all forms, inputs, buttons, and links with their selectors.',
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

// ─── browser_use_hover ──────────────────────────────────────────────────────

export const browser_use_hover = makeLocalTool(
  'browser_use_hover',
  'Hover over an element on the page. Useful for revealing tooltips, dropdown menus, or hover-triggered content. Identify by CSS selector or visible text.',
  z.object({
    selector: z.string().optional().describe('CSS selector of the element to hover over'),
    text: z.string().optional().describe('Visible text of the element to hover over'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    hovered: z.string().optional(),
    method: z.string().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_use_select_option ──────────────────────────────────────────────

export const browser_use_select_option = makeLocalTool(
  'browser_use_select_option',
  'Select an option from a <select> dropdown element. Use the CSS selector of the <select> element and specify which option to pick by value, label text, or index.',
  z.object({
    selector: z.string().describe('CSS selector of the <select> element'),
    value: z.string().optional().describe('Option value attribute to select'),
    label: z.string().optional().describe('Option visible text to select (case-insensitive partial match)'),
    index: z.number().optional().describe('Option index to select (0-based)'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    selected: z.any().optional(),
    text: z.string().optional(),
    method: z.string().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_use_get_interactive_elements ───────────────────────────────────

export const browser_use_get_interactive_elements = makeLocalTool(
  'browser_use_get_interactive_elements',
  'Get all interactive elements on the current page — inputs, buttons, links, selects, checkboxes, etc. Returns their CSS selectors, labels, current values, placeholder text, and form associations. ALWAYS call this before filling forms or clicking buttons so you know exactly what elements are available and what selectors to use.',
  z.object({
    wait_for_selector: z.string().optional().describe('Optional CSS selector to wait for before scanning the page'),
    wait_timeout: z.number().optional().describe('Wait timeout in ms (default: 3000)'),
  }),
  z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    title: z.string().optional(),
    elements: z.array(z.object({
      index: z.number(),
      tag: z.string(),
      selector: z.string(),
      type: z.string().optional(),
      role: z.string().optional(),
      name: z.string().optional(),
      id: z.string().optional(),
      text: z.string().optional(),
      href: z.string().optional(),
      label: z.string().optional(),
      placeholder: z.string().optional(),
      value: z.string().optional(),
      selectedText: z.string().optional(),
      checked: z.boolean().optional(),
      disabled: z.boolean().optional(),
      required: z.boolean().optional(),
      readonly: z.boolean().optional(),
      options: z.array(z.object({
        value: z.string(),
        text: z.string(),
        selected: z.boolean(),
      })).optional(),
    })).optional(),
    forms: z.array(z.object({
      selector: z.string(),
      action: z.string().optional(),
      method: z.string().optional(),
      name: z.string().optional(),
      fieldIndices: z.array(z.number()).optional(),
    })).optional(),
    elementCount: z.number().optional(),
    formCount: z.number().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_fill_form ──────────────────────────────────────────────────

export const browser_use_fill_form = makeLocalTool(
  'browser_use_fill_form',
  'Fill multiple form fields at once and optionally submit the form. More reliable than calling browser_use_type for each field individually. Pass fields as an object mapping CSS selectors to values, or as an array of {selector, value} pairs.',
  z.object({
    fields: z.union([
      z.record(z.string(), z.string()),
      z.array(z.object({
        selector: z.string().optional(),
        name: z.string().optional(),
        value: z.string(),
        type: z.string().optional().describe('"text" (default), "select", "checkbox", or "radio"'),
      })),
    ]).describe('Fields to fill: object { "css-selector": "value" } or array of { selector, value, type? }'),
    submit: z.boolean().optional().describe('Submit the form after filling (default: false)'),
    form_selector: z.string().optional().describe('CSS selector of the form element (helps find the submit button)'),
  }),
  z.object({
    ok: z.boolean(),
    filled: z.number().optional(),
    total: z.number().optional(),
    submitted: z.boolean().optional(),
    errors: z.array(z.string()).nullable().optional(),
    error: z.string().optional(),
  }),
  30000,
  { noFallback: true },
);

// ─── browser_use_wait_for ───────────────────────────────────────────────────

export const browser_use_wait_for = makeLocalTool(
  'browser_use_wait_for',
  'Wait for a specific condition before proceeding: an element to appear/disappear, a URL change, or page content to load. Essential for SPAs and dynamic pages where content loads asynchronously.',
  z.object({
    selector: z.string().optional().describe('CSS selector to wait for'),
    text: z.string().optional().describe('Text content to wait for on the page'),
    url_pattern: z.string().optional().describe('URL substring to wait for (e.g., "/results" or "search?q=")'),
    state: z.enum(['visible', 'hidden', 'detached']).optional().describe('Element state to wait for (default: "visible")'),
    timeout: z.number().optional().describe('Timeout in ms (default: 10000)'),
  }),
  z.object({
    ok: z.boolean(),
    matched: z.boolean().optional(),
    url: z.string().optional(),
    type: z.string().optional(),
    error: z.string().optional(),
  }),
  65000,
  { noFallback: true },
);
