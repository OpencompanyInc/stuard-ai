import { z } from 'zod';
import { makeLocalTool } from './shared';

const browserViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
  pageWidth: z.number(),
  pageHeight: z.number(),
  topRatio: z.number(),
  bottomRatio: z.number(),
  atTop: z.boolean(),
  atBottom: z.boolean(),
});

const browserScrollContainerSchema = z.object({
  scrollTop: z.number(),
  scrollLeft: z.number(),
  scrollHeight: z.number(),
  scrollWidth: z.number(),
  clientHeight: z.number(),
  clientWidth: z.number(),
  atTop: z.boolean(),
  atBottom: z.boolean(),
});

const interactiveElementSchema = z.object({
  index: z.number(),
  elementId: z.string(),
  controlType: z.string(),
  tag: z.string(),
  selector: z.string().optional(),
  type: z.string().optional(),
  role: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  value: z.string().optional(),
  selectedText: z.string().optional(),
  popupRole: z.string().optional(),
  optionCount: z.number().optional(),
  href: z.string().optional(),
  checked: z.boolean().optional(),
  expanded: z.boolean().optional(),
  disabled: z.boolean().optional(),
  required: z.boolean().optional(),
  readonly: z.boolean().optional(),
  accept: z.string().optional(),
  multiple: z.boolean().optional(),
  iconOnly: z.boolean().optional(),
});

const interactiveFormSchema = z.object({
  selector: z.string().optional(),
  action: z.string().optional(),
  method: z.string().optional(),
  name: z.string().optional(),
  fieldElementIds: z.array(z.string()).optional(),
});

// ─── browser_use_status ─────────────────────────────────────────────────────

export const browser_use_status = makeLocalTool(
  'browser_use_status',
  'Check if the browser is installed and running. Returns the current mode, active profile, and current page URL. Use this before other browser_use_* tools.',
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
  'Configure the browser mode and profile. Modes: "headed" (visible window) or "headless" (no UI). Changing mode restarts the browser.',
  z.object({
    mode: z.enum(['headed', 'headless']).optional().describe('Browser mode.'),
    profile: z.string().optional().describe('Named profile for persistent cookies/sessions (default: "default")'),
  }),
  z.object({
    ok: z.boolean(),
    mode: z.string().optional(),
    profile: z.string().optional(),
    restarted: z.boolean().optional(),
    connectedProfiles: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  30000,
  { noFallback: true },
);

// ─── browser_use_execute_script ─────────────────────────────────────────────

export const browser_use_execute_script = makeLocalTool(
  'browser_use_execute_script',
  'Execute JavaScript inside the current browser page context. Best for complex extraction, DOM transformation, or page logic where one script is cleaner than many tool calls. The script runs inside an async function and should return JSON-serializable data.',
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
  'Click an element on the current page. Prefer passing elementId from browser_use_get_interactive_elements for the leanest, most reliable targeting. CSS selector and visible text are still supported as fallbacks.',
  z.object({
    elementId: z.string().optional().describe('Element ID returned by browser_use_get_interactive_elements'),
    selector: z.string().optional().describe('CSS selector of the element to click'),
    text: z.string().optional().describe('Visible text of the element to click (alternative to selector)'),
    exact: z.boolean().optional().describe('Require exact text match when using text (default: false)'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    clicked: z.string().optional(),
    elementId: z.string().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_type ───────────────────────────────────────────────────────

export const browser_use_type = makeLocalTool(
  'browser_use_type',
  'Type text into an input field or the active element. Prefer elementId from browser_use_get_interactive_elements so you can target the current viewport snapshot without hauling full selectors around. If no target is given, types into the currently focused element.',
  z.object({
    elementId: z.string().optional().describe('Element ID returned by browser_use_get_interactive_elements'),
    selector: z.string().optional().describe('CSS selector of the input field (if omitted, types into focused element)'),
    text: z.string().describe('Text to type'),
    clear: z.boolean().optional().describe('Clear existing content before typing (default: true)'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    typed: z.number().optional(),
    elementId: z.string().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_press_key ──────────────────────────────────────────────────

export const browser_use_press_key = makeLocalTool(
  'browser_use_press_key',
  'Press a keyboard key in the browser (for example Enter, Tab, Escape, ArrowDown). Optionally focus an element first using elementId or a CSS selector.',
  z.object({
    key: z.string().describe('Key to press, for example "Enter", "Tab", "Escape", "ArrowDown"'),
    elementId: z.string().optional().describe('Optional element ID to focus before pressing the key'),
    selector: z.string().optional().describe('Optional CSS selector to focus before pressing the key'),
  }),
  z.object({
    ok: z.boolean(),
    key: z.string().optional(),
    elementId: z.string().optional(),
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
  'Get a viewport-first content snapshot from the current page. Text mode preserves headings and visible tables in a compact, readable format and returns scroll metadata so the model can decide whether to scroll next.',
  z.object({
    mode: z.enum(['text', 'html']).optional().describe('Content mode: "text" for readable text (default), "html" for raw HTML'),
    max_length: z.number().optional().describe('Maximum content length in characters (default: 15000)'),
    viewport_only: z.boolean().optional().describe('Limit extraction to the visible viewport (default: true)'),
    wait_for_selector: z.string().optional().describe('Optional CSS selector to wait for before extracting content'),
    wait_timeout: z.number().optional().describe('Wait timeout in ms for wait_for_selector (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    contentLength: z.number().optional(),
    mode: z.string().optional(),
    scanScope: z.string().optional(),
    viewport: browserViewportSchema.optional(),
    blockCount: z.number().optional(),
    tableCount: z.number().optional(),
    truncated: z.boolean().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_scroll ─────────────────────────────────────────────────────

export const browser_use_scroll = makeLocalTool(
  'browser_use_scroll',
  'Scroll the page or a specific element in any direction. Returns fresh viewport or container scroll metrics so the model can tell whether more content remains.',
  z.object({
    direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Scroll direction (default: "down")'),
    amount: z.number().optional().describe('Pixels to scroll (default: 500)'),
    selector: z.string().optional().describe('CSS selector of a scrollable container (scrolls page if omitted)'),
  }),
  z.object({
    ok: z.boolean(),
    direction: z.string().optional(),
    amount: z.number().optional(),
    target: z.string().optional(),
    selector: z.string().optional(),
    viewport: browserViewportSchema.optional(),
    container: browserScrollContainerSchema.optional(),
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
  'Hover over an element on the page. Useful for revealing tooltips, dropdown menus, or hover-triggered content. Prefer elementId from browser_use_get_interactive_elements when available.',
  z.object({
    elementId: z.string().optional().describe('Element ID returned by browser_use_get_interactive_elements'),
    selector: z.string().optional().describe('CSS selector of the element to hover over'),
    text: z.string().optional().describe('Visible text of the element to hover over'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    hovered: z.string().optional(),
    elementId: z.string().optional(),
    method: z.string().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_use_select_option ──────────────────────────────────────────────

export const browser_use_select_option = makeLocalTool(
  'browser_use_select_option',
  'Select an option from a dropdown or searchable combobox. Use this only AFTER you have already inspected the page and, for dropdowns, read the available options first. The correct sequence is: browser_use_get_interactive_elements -> browser_use_get_dropdown_options -> reason about the returned options -> browser_use_select_option. Do NOT call get_dropdown_options and select_option in parallel. Pass the exact text/value returned by get_dropdown_options whenever possible. For searchable dropdowns, provide the "search" parameter after first inspecting the control/options. Works with native <select> elements, custom listbox/combobox dropdowns, and searchable autocomplete inputs (React Select, MUI Autocomplete, Headless UI, etc.).',
  z.object({
    elementId: z.string().optional().describe('Element ID returned by browser_use_get_interactive_elements'),
    selector: z.string().optional().describe('CSS selector of the dropdown control (select, input, button, or combobox element)'),
    value: z.string().optional().describe('Option value attribute to select'),
    label: z.string().optional().describe('Option visible text to select (case-insensitive partial match)'),
    index: z.number().optional().describe('Option index to select (0-based)'),
    search: z.string().optional().describe('Text to type into a searchable/autocomplete dropdown to filter options before selecting. Use this for combobox inputs where options only appear after typing.'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    selected: z.any().optional(),
    text: z.string().optional(),
    elementId: z.string().optional(),
    method: z.string().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_use_get_dropdown_options ────────────────────────────────────────

export const browser_use_get_dropdown_options = makeLocalTool(
  'browser_use_get_dropdown_options',
  'Read all available options from a dropdown or select element WITHOUT selecting anything. This is the required first step before selecting from a dropdown. Use the sequence: browser_use_get_interactive_elements -> browser_use_get_dropdown_options -> reason about the returned options -> browser_use_select_option. Do NOT call this in parallel with browser_use_select_option. For native <select> elements, reads options directly. For custom dropdowns (React Select, MUI, Headless UI, etc.), clicks to open, reads the visible options, then closes the dropdown. Returns the full list of options with their text and value so you can choose the exact text/value to pass into browser_use_select_option.',
  z.object({
    elementId: z.string().optional().describe('Element ID returned by browser_use_get_interactive_elements'),
    selector: z.string().optional().describe('CSS selector of the dropdown control (select, input, button, or combobox element)'),
    timeout: z.number().optional().describe('Timeout in ms for custom dropdowns to open (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    type: z.string().optional().describe('Either "native_select" or "custom_dropdown"'),
    elementId: z.string().optional(),
    options: z.array(z.object({
      text: z.string(),
      value: z.string(),
      index: z.number().optional(),
      selected: z.boolean().optional(),
    })).optional(),
    optionCount: z.number().optional(),
    selectedIndex: z.number().optional(),
    selectedText: z.string().optional(),
    error: z.string().optional(),
  }),
  10000,
  { noFallback: true },
);

// ─── browser_use_get_interactive_elements ───────────────────────────────────

export const browser_use_get_interactive_elements = makeLocalTool(
  'browser_use_get_interactive_elements',
  'Get a compact, viewport-first scan of interactive elements on the current page. Returns stable elementIds for the current snapshot so follow-up click/type/select/upload calls can target elements without carrying bulky selectors. This is the default discovery step before acting on a page.',
  z.object({
    wait_for_selector: z.string().optional().describe('Optional CSS selector to wait for before scanning the page'),
    wait_timeout: z.number().optional().describe('Wait timeout in ms (default: 3000)'),
    viewport_only: z.boolean().optional().describe('Limit the scan to the current viewport (default: true)'),
    include_selectors: z.boolean().optional().describe('Include CSS selectors in the response for debugging or fallback targeting (default: false)'),
    include_forms: z.boolean().optional().describe('Include compact form groupings when visible (default: true)'),
    max_elements: z.number().optional().describe('Maximum number of returned elements after visual-order sorting (default: 80)'),
  }),
  z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    title: z.string().optional(),
    elements: z.array(interactiveElementSchema).optional(),
    forms: z.array(interactiveFormSchema).optional(),
    counts: z.record(z.string(), z.number()).optional(),
    scanScope: z.string().optional(),
    viewport: browserViewportSchema.optional(),
    elementCount: z.number().optional(),
    formCount: z.number().optional(),
    truncated: z.boolean().optional(),
    totalFound: z.number().optional(),
    error: z.string().optional(),
  }),
  15000,
  { noFallback: true },
);

// ─── browser_use_fill_form ──────────────────────────────────────────────────

export const browser_use_fill_form = makeLocalTool(
  'browser_use_fill_form',
  'Fill multiple form fields at once and optionally submit the form. More reliable than calling browser_use_type for each field individually. Supports text fields, dropdowns, toggles, and file inputs. Array items can target fields by elementId from browser_use_get_interactive_elements.',
  z.object({
    fields: z.union([
      z.record(z.string(), z.string()),
      z.array(z.object({
        elementId: z.string().optional(),
        selector: z.string().optional(),
        name: z.string().optional(),
        value: z.string(),
        type: z.string().optional().describe('"text" (default), "select", "checkbox", "radio", "toggle", "switch", or "file". For toggles/switches/checkboxes, value should be "true"/"false".'),
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

// ─── browser_use_upload_file ────────────────────────────────────────────────

export const browser_use_upload_file = makeLocalTool(
  'browser_use_upload_file',
  'Upload a local file from disk into a browser file input. Pass a local file path and optionally an elementId or selector for the visible upload control or associated file input.',
  z.object({
    elementId: z.string().optional().describe('Optional element ID returned by browser_use_get_interactive_elements'),
    selector: z.string().optional().describe('Optional CSS selector of the file input, upload button, label, or container associated with the file input'),
    filePath: z.string().describe('Absolute or workspace-relative path to the local file on disk'),
    timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
  }),
  z.object({
    ok: z.boolean(),
    uploaded: z.boolean().optional(),
    elementId: z.string().optional(),
    filePath: z.string().optional(),
    fileName: z.string().optional(),
    selector: z.string().optional(),
    accept: z.string().optional(),
    multiple: z.boolean().optional(),
    hidden: z.boolean().optional(),
    label: z.string().optional(),
    method: z.string().optional(),
    error: z.string().optional(),
  }),
  15000,
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
