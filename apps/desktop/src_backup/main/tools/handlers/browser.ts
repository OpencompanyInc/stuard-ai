import { sendRequestToBrowser } from '../../services/browser-server';
import { RouterContext } from '../types';

// Helper to normalize browser extension responses
function handleBrowserResponse(res: any, ctx: RouterContext, actionName: string): any {
    if (!res) {
        ctx.logFn(`${actionName}: No response from browser extension`);
        return { ok: false, error: 'No response from browser extension. Is the extension connected?' };
    }

    // Check for error responses
    if (res.ok === false) {
        const errorMsg = res.error || res.details || 'Browser action failed';
        ctx.logFn(`${actionName}: Error - ${errorMsg}`);
        return { ok: false, error: errorMsg, details: res.details };
    }

    // Success - return the result
    const data = res.result || res;
    return { ok: true, ...data };
}

// ============================================================================
// BASIC BROWSER TOOLS
// ============================================================================

export async function execBrowserGetContent(args: any, ctx: RouterContext): Promise<any> {
    try {
        ctx.logFn('browser_get_content: Fetching page content...');
        const res = await sendRequestToBrowser('get_content');
        const result = handleBrowserResponse(res, ctx, 'browser_get_content');
        if (result.ok) {
            ctx.logFn(`browser_get_content: Success. Title: "${result.title || 'Unknown'}"`);
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_get_content: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function execBrowserClickElement(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { text, label, selector, index, rightClick, ctrlKey, shiftKey } = args;
        const clickText = text || label;
        ctx.logFn(`browser_click_element: Clicking "${clickText || selector}"...`);
        const res = await sendRequestToBrowser('click', {
            text: clickText,
            selector,
            index,
            rightClick,
            ctrlKey,
            shiftKey
        });
        const result = handleBrowserResponse(res, ctx, 'browser_click_element');
        if (result.ok) {
            ctx.logFn('browser_click_element: Success');
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_click_element: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function execBrowserTypeText(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { text, value, selector, replace, pressEnter } = args;
        const typeText = text || value;
        ctx.logFn(`browser_type_text: Typing "${typeText?.substring(0, 50)}..."...`);
        const res = await sendRequestToBrowser('type', { text: typeText, selector, replace, pressEnter });
        const result = handleBrowserResponse(res, ctx, 'browser_type_text');
        if (result.ok) {
            ctx.logFn('browser_type_text: Success');
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_type_text: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ============================================================================
// ELEMENT DISCOVERY & POSITIONING
// ============================================================================

export async function execBrowserFindText(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { text, caseSensitive, limit } = args;
        ctx.logFn(`browser_find_text: Searching for "${text}"...`);
        const res = await sendRequestToBrowser('find_text', { text, caseSensitive, limit });
        const result = handleBrowserResponse(res, ctx, 'browser_find_text');
        if (result.ok) {
            ctx.logFn(`browser_find_text: Found ${result.count || 0} matches`);
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_find_text: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function execBrowserGetElementPosition(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { selector, text, index } = args;
        ctx.logFn(`browser_get_element_position: Getting position of "${selector || text}"...`);
        const res = await sendRequestToBrowser('get_element_position', { selector, text, index });
        const result = handleBrowserResponse(res, ctx, 'browser_get_element_position');
        if (result.ok) {
            ctx.logFn('browser_get_element_position: Success');
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_get_element_position: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function execBrowserFindClickable(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { limit, visibleOnly, includeText } = args;
        ctx.logFn('browser_find_clickable: Finding clickable elements...');
        const res = await sendRequestToBrowser('find_clickable', { limit, visibleOnly, includeText });
        const result = handleBrowserResponse(res, ctx, 'browser_find_clickable');
        if (result.ok) {
            ctx.logFn(`browser_find_clickable: Found ${result.count || 0} elements`);
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_find_clickable: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ============================================================================
// INTERACTION TOOLS
// ============================================================================

export async function execBrowserHover(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { selector, text, index, duration } = args;
        ctx.logFn(`browser_hover: Hovering over "${selector || text}"...`);
        const res = await sendRequestToBrowser('hover', { selector, text, index, duration });
        const result = handleBrowserResponse(res, ctx, 'browser_hover');
        if (result.ok) {
            ctx.logFn('browser_hover: Success');
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_hover: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function execBrowserSelectOption(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { selector, value, text, index } = args;
        ctx.logFn(`browser_select_option: Selecting "${value || text || `index ${index}`}"...`);
        const res = await sendRequestToBrowser('select_option', { selector, value, text, index });
        const result = handleBrowserResponse(res, ctx, 'browser_select_option');
        if (result.ok) {
            ctx.logFn(`browser_select_option: Selected "${result.text || 'option'}"`);
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_select_option: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function execBrowserPressKey(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { key, ctrl, shift, alt, meta, target } = args;
        const modifiers = [ctrl && 'Ctrl', shift && 'Shift', alt && 'Alt', meta && 'Meta'].filter(Boolean).join('+');
        ctx.logFn(`browser_press_key: Pressing ${modifiers ? modifiers + '+' : ''}${key}...`);
        const res = await sendRequestToBrowser('press_key', { key, ctrl, shift, alt, meta, target });
        const result = handleBrowserResponse(res, ctx, 'browser_press_key');
        if (result.ok) {
            ctx.logFn('browser_press_key: Success');
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_press_key: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ============================================================================
// FORM TOOLS
// ============================================================================

export async function execBrowserGetFormFields(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { selector, formIndex } = args;
        ctx.logFn('browser_get_form_fields: Getting form fields...');
        const res = await sendRequestToBrowser('get_form_fields', { selector, formIndex });
        const result = handleBrowserResponse(res, ctx, 'browser_get_form_fields');
        if (result.ok) {
            ctx.logFn(`browser_get_form_fields: Found ${result.fields?.length || 0} fields`);
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_get_form_fields: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function execBrowserFillForm(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { fields, selector, formIndex, submit } = args;
        ctx.logFn(`browser_fill_form: Filling ${Object.keys(fields || {}).length} fields...`);
        const res = await sendRequestToBrowser('fill_form', { fields, selector, formIndex, submit });
        const result = handleBrowserResponse(res, ctx, 'browser_fill_form');
        if (result.ok) {
            ctx.logFn(`browser_fill_form: Filled ${result.filled?.length || 0} fields`);
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_fill_form: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ============================================================================
// NAVIGATION & WAITING
// ============================================================================

export async function execBrowserWaitForElement(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { selector, text, timeout, pollInterval } = args;
        ctx.logFn(`browser_wait_for_element: Waiting for "${selector || text}"...`);
        const res = await sendRequestToBrowser('wait_for_element', { selector, text, timeout, pollInterval }, timeout || 10000);
        const result = handleBrowserResponse(res, ctx, 'browser_wait_for_element');
        if (result.ok) {
            if (result.found) {
                ctx.logFn(`browser_wait_for_element: Found after ${result.waitTime}ms`);
            } else {
                ctx.logFn('browser_wait_for_element: Element not found within timeout');
            }
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_wait_for_element: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function execBrowserScrollTo(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { selector, text, x, y, direction, amount, smooth } = args;
        ctx.logFn(`browser_scroll_to: Scrolling ${direction || 'to element'}...`);
        const res = await sendRequestToBrowser('scroll_to', { selector, text, x, y, direction, amount, smooth });
        const result = handleBrowserResponse(res, ctx, 'browser_scroll_to');
        if (result.ok) {
            ctx.logFn('browser_scroll_to: Success');
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_scroll_to: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ============================================================================
// PAGE INFORMATION
// ============================================================================

export async function execBrowserGetPageInfo(args: any, ctx: RouterContext): Promise<any> {
    try {
        ctx.logFn('browser_get_page_info: Getting page information...');
        const res = await sendRequestToBrowser('get_page_info');
        const result = handleBrowserResponse(res, ctx, 'browser_get_page_info');
        if (result.ok) {
            ctx.logFn(`browser_get_page_info: ${result.title || 'Unknown'} (${result.url || 'Unknown URL'})`);
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_get_page_info: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}

// ============================================================================
// ADVANCED
// ============================================================================

export async function execBrowserExecuteScript(args: any, ctx: RouterContext): Promise<any> {
    try {
        const { script, args: scriptArgs } = args;
        ctx.logFn('browser_execute_script: Executing script...');
        const res = await sendRequestToBrowser('execute_script', { script, args: scriptArgs });
        const result = handleBrowserResponse(res, ctx, 'browser_execute_script');
        if (result.ok) {
            ctx.logFn('browser_execute_script: Success');
        }
        return result;
    } catch (e: any) {
        ctx.logFn(`browser_execute_script: Error - ${e.message}`);
        return { ok: false, error: e.message };
    }
}
