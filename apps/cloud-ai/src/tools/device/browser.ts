import { z } from 'zod';
import { makeLocalTool } from './shared';

// ============================================================================
// BASIC BROWSER TOOLS
// ============================================================================

export const browser_get_content = makeLocalTool(
    'browser_get_content',
    'Get the content of the currently active tab in the browser extension. Returns title, URL, and page text.',
    z.object({}),
);

export const browser_click_element = makeLocalTool(
    'browser_click_element',
    'Click an element in the active browser tab. Can click by text label or CSS selector. Supports right-click and modifier keys.',
    z.object({
        text: z.string().optional().describe('Text label of the element to click (fuzzy match)'),
        selector: z.string().optional().describe('CSS selector of the element to click'),
        index: z.number().optional().describe('Index if multiple elements match (default: 0)'),
        rightClick: z.boolean().optional().describe('Right-click to open context menu'),
        ctrlKey: z.boolean().optional().describe('Hold Ctrl while clicking'),
        shiftKey: z.boolean().optional().describe('Hold Shift while clicking'),
    }),
);

export const browser_type_text = makeLocalTool(
    'browser_type_text',
    'Type text into an input field in the active browser tab. Supports contenteditable elements and can press Enter after typing.',
    z.object({
        text: z.string().describe('The text to type'),
        selector: z.string().optional().describe('CSS selector of the input field'),
        replace: z.boolean().optional().describe('Replace existing content (default: true)'),
        pressEnter: z.boolean().optional().describe('Press Enter after typing to submit'),
    }),
);

// ============================================================================
// ELEMENT DISCOVERY & POSITIONING
// ============================================================================

export const browser_find_text = makeLocalTool(
    'browser_find_text',
    'Find all occurrences of text on the page with their positions. Returns element info, coordinates, and whether each match is clickable.',
    z.object({
        text: z.string().describe('Text to search for'),
        caseSensitive: z.boolean().optional().describe('Case sensitive search (default: false)'),
        limit: z.number().optional().describe('Maximum results to return (default: 20)'),
    }),
);

export const browser_get_element_position = makeLocalTool(
    'browser_get_element_position',
    'Get the exact position and bounding box of an element. Returns viewport and document coordinates, dimensions, and element metadata.',
    z.object({
        selector: z.string().optional().describe('CSS selector of the element'),
        text: z.string().optional().describe('Text content to find element by'),
        index: z.number().optional().describe('Index if multiple elements match (default: 0)'),
    }),
);

export const browser_find_clickable = makeLocalTool(
    'browser_find_clickable',
    'Find all clickable elements on the page (buttons, links, interactive elements). Returns their positions, text, and selectors.',
    z.object({
        limit: z.number().optional().describe('Maximum elements to return (default: 50)'),
        visibleOnly: z.boolean().optional().describe('Only return visible elements (default: true)'),
        includeText: z.boolean().optional().describe('Include element text in results (default: true)'),
    }),
);

// ============================================================================
// INTERACTION TOOLS
// ============================================================================

export const browser_hover = makeLocalTool(
    'browser_hover',
    'Hover over an element to trigger hover effects, tooltips, or dropdown menus.',
    z.object({
        selector: z.string().optional().describe('CSS selector of the element'),
        text: z.string().optional().describe('Text content to find element by'),
        index: z.number().optional().describe('Index if multiple elements match (default: 0)'),
        duration: z.number().optional().describe('How long to hover in ms (default: 100)'),
    }),
);

export const browser_select_option = makeLocalTool(
    'browser_select_option',
    'Select an option from a dropdown/select element. Can select by value, visible text, or index.',
    z.object({
        selector: z.string().optional().describe('CSS selector of the select element'),
        value: z.string().optional().describe('Option value to select'),
        text: z.string().optional().describe('Visible text of the option to select'),
        index: z.number().optional().describe('Index of the option to select'),
    }),
);

export const browser_press_key = makeLocalTool(
    'browser_press_key',
    'Press a keyboard key, optionally with modifier keys (Ctrl, Shift, Alt, Meta).',
    z.object({
        key: z.string().describe('Key to press (e.g., "Enter", "Escape", "Tab", "a", "1")'),
        ctrl: z.boolean().optional().describe('Hold Ctrl'),
        shift: z.boolean().optional().describe('Hold Shift'),
        alt: z.boolean().optional().describe('Hold Alt'),
        meta: z.boolean().optional().describe('Hold Meta/Command'),
        target: z.string().optional().describe('CSS selector of element to send key to'),
    }),
);

// ============================================================================
// FORM TOOLS
// ============================================================================

export const browser_get_form_fields = makeLocalTool(
    'browser_get_form_fields',
    'Get all form fields on the page with their types, names, labels, and current values. Useful for understanding what data to fill.',
    z.object({
        selector: z.string().optional().describe('CSS selector of specific form'),
        formIndex: z.number().optional().describe('Index of form on page (default: 0)'),
    }),
);

export const browser_fill_form = makeLocalTool(
    'browser_fill_form',
    'Fill multiple form fields at once using a field name/value mapping. Can optionally submit the form.',
    z.object({
        fields: z.record(z.string(), z.any()).describe('Object mapping field names to values'),
        selector: z.string().optional().describe('CSS selector of specific form'),
        formIndex: z.number().optional().describe('Index of form on page (default: 0)'),
        submit: z.boolean().optional().describe('Submit the form after filling'),
    }),
);

// ============================================================================
// NAVIGATION & WAITING
// ============================================================================

export const browser_wait_for_element = makeLocalTool(
    'browser_wait_for_element',
    'Wait for an element to appear on the page. Useful after clicking something that loads new content.',
    z.object({
        selector: z.string().optional().describe('CSS selector to wait for'),
        text: z.string().optional().describe('Text content to wait for'),
        timeout: z.number().optional().describe('Maximum wait time in ms (default: 10000)'),
        pollInterval: z.number().optional().describe('Check interval in ms (default: 100)'),
    }),
);

export const browser_scroll_to = makeLocalTool(
    'browser_scroll_to',
    'Scroll the page to an element, coordinates, or direction (up/down/left/right/top/bottom).',
    z.object({
        selector: z.string().optional().describe('CSS selector to scroll to'),
        text: z.string().optional().describe('Text content to scroll to'),
        x: z.number().optional().describe('X coordinate to scroll to'),
        y: z.number().optional().describe('Y coordinate to scroll to'),
        direction: z.enum(['up', 'down', 'left', 'right', 'top', 'bottom']).optional().describe('Direction to scroll'),
        amount: z.number().optional().describe('Pixels to scroll (default: 300)'),
        smooth: z.boolean().optional().describe('Use smooth scrolling (default: true)'),
    }),
);

// ============================================================================
// PAGE INFORMATION
// ============================================================================

export const browser_get_page_info = makeLocalTool(
    'browser_get_page_info',
    'Get comprehensive page information including URL, forms, links, inputs, and buttons. Useful for understanding page structure.',
    z.object({}),
);

// ============================================================================
// ADVANCED
// ============================================================================

export const browser_execute_script = makeLocalTool(
    'browser_execute_script',
    'Execute JavaScript code in the browser page context. Use for advanced interactions not covered by other tools.',
    z.object({
        script: z.string().describe('JavaScript code to execute'),
        args: z.record(z.string(), z.any()).optional().describe('Arguments to pass to the script'),
    }),
);
