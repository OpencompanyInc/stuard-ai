// Content script to handle DOM interactions

console.log('Stuard AI Extension Content Script Ready');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'content') return;

    const { action, payload, requestId } = message;
    console.log(`[Stuard-Content] Action: ${action}`, payload);

    handleAction(action, payload)
        .then(result => {
            sendResponse({ requestId, ok: true, result });
        })
        .catch(error => {
            console.error(`[Stuard-Content] Action ${action} failed:`, error);
            sendResponse({ requestId, ok: false, error: error.message || 'action_failed' });
        });

    return true; // Keep channel open for async response
});

async function handleAction(action: string, payload: any): Promise<any> {
    switch (action) {
        case 'ping':
            return { ok: true, ready: true, url: window.location.href };
        case 'get_content':
            return getPageContent();
        case 'click':
            return clickElement(payload);
        case 'type':
            return typeIntoElement(payload);
        case 'find_text':
            return findTextOnPage(payload);
        case 'get_element_position':
            return getElementPosition(payload);
        case 'find_clickable':
            return findClickableElements(payload);
        case 'hover':
            return hoverElement(payload);
        case 'select_option':
            return selectDropdownOption(payload);
        case 'wait_for_element':
            return waitForElement(payload);
        case 'execute_script':
            return executeScript(payload);
        case 'scroll_to':
            return scrollTo(payload);
        case 'get_page_info':
            return getPageInfo();
        case 'press_key':
            return pressKey(payload);
        case 'get_form_fields':
            return getFormFields(payload);
        case 'fill_form':
            return fillForm(payload);
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}

function getPageContent() {
    return {
        title: document.title,
        url: window.location.href,
        innerText: document.body.innerText.substring(0, 100000),
        html: document.documentElement.outerHTML.substring(0, 200000)
    };
}

async function clickElement(payload: any) {
    const { text, selector, index = 0, rightClick = false, ctrlKey = false, shiftKey = false } = payload;
    let element: HTMLElement | null = null;

    if (selector) {
        const elements = document.querySelectorAll(selector);
        element = elements[index] as HTMLElement || null;
    } else if (text) {
        const matches = findElementsByText(text);
        element = matches[index] || null;
    }

    if (!element) throw new Error('Element not found');

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Wait for scroll to complete
    await sleep(100);

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    if (rightClick) {
        element.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: centerX,
            clientY: centerY,
            ctrlKey,
            shiftKey
        }));
    } else {
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, ctrlKey, shiftKey }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, ctrlKey, shiftKey }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY, ctrlKey, shiftKey }));
    }

    return {
        clicked: true,
        tag: element.tagName,
        text: element.innerText?.substring(0, 100),
        position: { x: centerX, y: centerY }
    };
}

async function typeIntoElement(payload: any) {
    const { text, selector, replace = true, pressEnter = false } = payload;
    let element: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null = null;

    if (selector) {
        element = document.querySelector(selector);
    } else {
        element = document.activeElement as HTMLElement;
        if (!element || element === document.body) {
            element = document.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])');
        }
    }

    if (!element) throw new Error('Input element not found');

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (element as HTMLElement).focus();

    // Handle contenteditable elements (rich text editors)
    if (element.getAttribute('contenteditable') === 'true') {
        if (replace) {
            element.innerHTML = '';
        }
        document.execCommand('insertText', false, text);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if ('value' in element) {
        // Standard input/textarea
        if (replace) {
            (element as HTMLInputElement).value = '';
        }
        (element as HTMLInputElement).value += text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (pressEnter) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

        // Submit form if in a form
        const form = element.closest('form');
        if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
    }

    return { typed: true, length: text.length };
}

async function findTextOnPage(payload: any) {
    const { text, caseSensitive = false, limit = 20 } = payload;
    const results: Array<{
        text: string;
        element: string;
        position: { x: number; y: number; width: number; height: number };
        index: number;
        isVisible: boolean;
        isClickable: boolean;
    }> = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    let searchText = caseSensitive ? text : text.toLowerCase();
    let foundIndex = 0;

    while ((node = walker.nextNode()) && results.length < limit) {
        const nodeText = node.textContent || '';
        const compareText = caseSensitive ? nodeText : nodeText.toLowerCase();

        if (compareText.includes(searchText)) {
            const parent = node.parentElement;
            if (parent && isElementVisible(parent)) {
                const rect = getElementRect(parent);
                results.push({
                    text: nodeText.trim().substring(0, 200),
                    element: getElementDescriptor(parent),
                    position: rect,
                    index: foundIndex++,
                    isVisible: rect.width > 0 && rect.height > 0,
                    isClickable: isElementClickable(parent)
                });
            }
        }
    }

    return {
        found: results.length > 0,
        count: results.length,
        matches: results
    };
}

async function getElementPosition(payload: any) {
    const { selector, text, index = 0 } = payload;
    let element: HTMLElement | null = null;

    if (selector) {
        const elements = document.querySelectorAll(selector);
        element = elements[index] as HTMLElement || null;
    } else if (text) {
        const matches = findElementsByText(text);
        element = matches[index] || null;
    }

    if (!element) throw new Error('Element not found');

    const rect = element.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(element);

    return {
        found: true,
        position: {
            x: rect.left + window.scrollX,
            y: rect.top + window.scrollY,
            width: rect.width,
            height: rect.height,
            centerX: rect.left + rect.width / 2 + window.scrollX,
            centerY: rect.top + rect.height / 2 + window.scrollY,
            viewportX: rect.left,
            viewportY: rect.top
        },
        element: {
            tag: element.tagName.toLowerCase(),
            id: element.id || undefined,
            className: element.className || undefined,
            text: element.innerText?.substring(0, 200),
            isVisible: isElementVisible(element),
            isClickable: isElementClickable(element)
        },
        styles: {
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity
        }
    };
}

async function findClickableElements(payload: any) {
    const { limit = 50, visibleOnly = true, includeText = true } = payload;
    const clickableSelectors = [
        'a[href]',
        'button',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="reset"]',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[onclick]',
        '[tabindex]:not([tabindex="-1"])',
        'label[for]',
        '.btn',
        '.button',
        '[class*="click"]',
        '[class*="btn"]'
    ];

    const elements = document.querySelectorAll(clickableSelectors.join(','));
    const results: Array<{
        index: number;
        tag: string;
        text: string;
        selector: string;
        position: { x: number; y: number; width: number; height: number };
        attributes: Record<string, string>;
    }> = [];

    let index = 0;
    for (const el of elements) {
        if (results.length >= limit) break;

        const htmlEl = el as HTMLElement;
        if (visibleOnly && !isElementVisible(htmlEl)) continue;

        const rect = getElementRect(htmlEl);
        if (rect.width === 0 || rect.height === 0) continue;

        results.push({
            index: index++,
            tag: htmlEl.tagName.toLowerCase(),
            text: includeText ? (htmlEl.innerText?.trim().substring(0, 100) || htmlEl.getAttribute('aria-label') || htmlEl.getAttribute('title') || '') : '',
            selector: generateSelector(htmlEl),
            position: rect,
            attributes: {
                id: htmlEl.id || '',
                href: htmlEl.getAttribute('href') || '',
                role: htmlEl.getAttribute('role') || '',
                ariaLabel: htmlEl.getAttribute('aria-label') || ''
            }
        });
    }

    return {
        count: results.length,
        elements: results
    };
}

async function hoverElement(payload: any) {
    const { selector, text, index = 0, duration = 100 } = payload;
    let element: HTMLElement | null = null;

    if (selector) {
        const elements = document.querySelectorAll(selector);
        element = elements[index] as HTMLElement || null;
    } else if (text) {
        const matches = findElementsByText(text);
        element = matches[index] || null;
    }

    if (!element) throw new Error('Element not found');

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(100);

    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Trigger hover events
    element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY }));
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window, clientX: centerX, clientY: centerY }));

    await sleep(duration);

    return {
        hovered: true,
        tag: element.tagName,
        text: element.innerText?.substring(0, 100),
        position: { x: centerX, y: centerY }
    };
}

async function selectDropdownOption(payload: any) {
    const { selector, value, text, index } = payload;

    let selectElement: HTMLSelectElement | null = null;

    if (selector) {
        selectElement = document.querySelector(selector);
    }

    if (!selectElement) {
        // Try to find any select element
        selectElement = document.querySelector('select');
    }

    if (!selectElement || selectElement.tagName !== 'SELECT') {
        throw new Error('Select element not found');
    }

    selectElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    selectElement.focus();

    let selectedOption: HTMLOptionElement | null = null;
    const options = Array.from(selectElement.options);

    if (typeof index === 'number') {
        selectedOption = options[index] || null;
    } else if (value !== undefined) {
        selectedOption = options.find(opt => opt.value === value) || null;
    } else if (text !== undefined) {
        const searchText = text.toLowerCase();
        selectedOption = options.find(opt => opt.text.toLowerCase().includes(searchText)) || null;
    }

    if (!selectedOption) {
        throw new Error(`Option not found. Available options: ${options.map(o => o.text).join(', ')}`);
    }

    selectElement.value = selectedOption.value;
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    selectElement.dispatchEvent(new Event('input', { bubbles: true }));

    return {
        selected: true,
        value: selectedOption.value,
        text: selectedOption.text,
        index: selectedOption.index
    };
}

async function waitForElement(payload: any) {
    const { selector, text, timeout = 10000, pollInterval = 100 } = payload;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        let element: HTMLElement | null = null;

        if (selector) {
            element = document.querySelector(selector);
        } else if (text) {
            const matches = findElementsByText(text);
            element = matches[0] || null;
        }

        if (element && isElementVisible(element)) {
            const rect = getElementRect(element);
            return {
                found: true,
                waitTime: Date.now() - startTime,
                element: {
                    tag: element.tagName.toLowerCase(),
                    text: element.innerText?.substring(0, 200),
                    selector: generateSelector(element)
                },
                position: rect
            };
        }

        await sleep(pollInterval);
    }

    return {
        found: false,
        waitTime: timeout,
        error: 'Element not found within timeout'
    };
}

async function executeScript(payload: any) {
    const { script, args = {} } = payload;

    return new Promise((resolve) => {
        try {
            // Inject script into page context to bypass CSP restrictions
            const scriptEl = document.createElement('script');
            const resultId = `__stuard_result_${Date.now()}_${Math.random().toString(36).slice(2)}`;

            // Create a global result holder
            (window as any)[resultId] = { pending: true };

            scriptEl.textContent = `
                (function() {
                    try {
                        const args = ${JSON.stringify(args)};
                        const result = (function() { ${script} })();
                        window['${resultId}'] = { success: true, result: result };
                    } catch (e) {
                        window['${resultId}'] = { success: false, error: e.message };
                    }
                })();
            `;

            document.documentElement.appendChild(scriptEl);
            scriptEl.remove();

            // Get the result
            const result = (window as any)[resultId];
            delete (window as any)[resultId];

            if (result.success) {
                resolve({
                    success: true,
                    result: result.result !== undefined ? JSON.parse(JSON.stringify(result.result)) : null
                });
            } else {
                resolve({
                    success: false,
                    error: result.error || 'Script execution failed'
                });
            }
        } catch (e: any) {
            resolve({
                success: false,
                error: e.message
            });
        }
    });
}

async function scrollTo(payload: any) {
    const { selector, text, x, y, direction, amount = 300, smooth = true } = payload;

    // Scroll to element
    if (selector || text) {
        let element: HTMLElement | null = null;

        if (selector) {
            element = document.querySelector(selector);
        } else if (text) {
            const matches = findElementsByText(text);
            element = matches[0] || null;
        }

        if (element) {
            element.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
            await sleep(smooth ? 300 : 50);
            return { scrolled: true, target: 'element' };
        }
    }

    // Scroll to coordinates
    if (x !== undefined || y !== undefined) {
        window.scrollTo({
            left: x ?? window.scrollX,
            top: y ?? window.scrollY,
            behavior: smooth ? 'smooth' : 'auto'
        });
        await sleep(smooth ? 300 : 50);
        return { scrolled: true, target: 'coordinates', x: window.scrollX, y: window.scrollY };
    }

    // Scroll by direction
    if (direction) {
        const scrollOptions: ScrollToOptions = { behavior: smooth ? 'smooth' : 'auto' };

        switch (direction) {
            case 'up':
                window.scrollBy({ top: -amount, ...scrollOptions });
                break;
            case 'down':
                window.scrollBy({ top: amount, ...scrollOptions });
                break;
            case 'left':
                window.scrollBy({ left: -amount, ...scrollOptions });
                break;
            case 'right':
                window.scrollBy({ left: amount, ...scrollOptions });
                break;
            case 'top':
                window.scrollTo({ top: 0, ...scrollOptions });
                break;
            case 'bottom':
                window.scrollTo({ top: document.body.scrollHeight, ...scrollOptions });
                break;
        }
        await sleep(smooth ? 300 : 50);
        return { scrolled: true, target: 'direction', direction, x: window.scrollX, y: window.scrollY };
    }

    return { scrolled: false, error: 'No scroll target specified' };
}

async function getPageInfo() {
    // Wrap each section in try-catch to prevent one failure from breaking everything
    let forms: any[] = [];
    let links: any[] = [];
    let inputs: any[] = [];
    let buttons: any[] = [];

    try {
        forms = Array.from(document.forms).map((form, i) => ({
            index: i,
            id: form.id || undefined,
            name: form.name || undefined,
            action: form.action || undefined,
            method: form.method || 'get',
            fieldCount: form.elements.length
        }));
    } catch (e) {
        console.warn('[Stuard-Content] Failed to get forms:', e);
    }

    try {
        links = Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map((a, i) => {
            try {
                return {
                    index: i,
                    text: (a as HTMLAnchorElement).innerText?.trim().substring(0, 100) || '',
                    href: (a as HTMLAnchorElement).href,
                    target: (a as HTMLAnchorElement).target || '_self'
                };
            } catch {
                return { index: i, text: '', href: '', target: '_self' };
            }
        });
    } catch (e) {
        console.warn('[Stuard-Content] Failed to get links:', e);
    }

    try {
        inputs = Array.from(document.querySelectorAll('input, textarea, select')).slice(0, 50).map((el, i) => {
            try {
                const input = el as HTMLInputElement;
                return {
                    index: i,
                    tag: el.tagName.toLowerCase(),
                    type: input.type || 'text',
                    name: input.name || undefined,
                    id: input.id || undefined,
                    placeholder: input.placeholder || undefined,
                    value: input.type === 'password' ? '***' : (input.value?.substring(0, 100) || ''),
                    selector: generateSelector(el as HTMLElement)
                };
            } catch {
                return { index: i, tag: 'input', type: 'text', selector: 'input' };
            }
        });
    } catch (e) {
        console.warn('[Stuard-Content] Failed to get inputs:', e);
    }

    try {
        buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')).slice(0, 30).map((el, i) => {
            try {
                return {
                    index: i,
                    tag: el.tagName.toLowerCase(),
                    text: (el as HTMLElement).innerText?.trim().substring(0, 100) || (el as HTMLInputElement).value || '',
                    type: (el as HTMLButtonElement).type || undefined,
                    selector: generateSelector(el as HTMLElement)
                };
            } catch {
                return { index: i, tag: 'button', text: '', selector: 'button' };
            }
        });
    } catch (e) {
        console.warn('[Stuard-Content] Failed to get buttons:', e);
    }

    return {
        url: window.location.href,
        title: document.title,
        domain: window.location.hostname,
        protocol: window.location.protocol,
        path: window.location.pathname,
        hash: window.location.hash,
        scrollPosition: { x: window.scrollX, y: window.scrollY },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentSize: {
            width: document.body?.scrollWidth || window.innerWidth,
            height: document.body?.scrollHeight || window.innerHeight
        },
        forms,
        links,
        inputs,
        buttons,
        hasFocus: document.hasFocus(),
        readyState: document.readyState
    };
}

async function pressKey(payload: any) {
    const { key, ctrl = false, shift = false, alt = false, meta = false, target } = payload;

    let element: HTMLElement = document.activeElement as HTMLElement || document.body;

    if (target) {
        const found = document.querySelector(target);
        if (found) element = found as HTMLElement;
    }

    const keyEvent = {
        key,
        code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
        keyCode: key.charCodeAt(0),
        ctrlKey: ctrl,
        shiftKey: shift,
        altKey: alt,
        metaKey: meta,
        bubbles: true,
        cancelable: true
    };

    element.dispatchEvent(new KeyboardEvent('keydown', keyEvent));
    element.dispatchEvent(new KeyboardEvent('keypress', keyEvent));
    element.dispatchEvent(new KeyboardEvent('keyup', keyEvent));

    return { pressed: true, key, target: element.tagName };
}

async function getFormFields(payload: any) {
    const { selector, formIndex = 0 } = payload;

    let form: HTMLFormElement | null = null;

    if (selector) {
        form = document.querySelector(selector);
    } else {
        form = document.forms[formIndex] || null;
    }

    if (!form) {
        // If no form, get all inputs on page
        const allInputs = document.querySelectorAll('input, textarea, select');
        return {
            formFound: false,
            fields: Array.from(allInputs).map((el, i) => getFieldInfo(el as HTMLElement, i))
        };
    }

    const fields = Array.from(form.elements).map((el, i) => getFieldInfo(el as HTMLElement, i));

    return {
        formFound: true,
        formId: form.id || undefined,
        formName: form.name || undefined,
        action: form.action,
        method: form.method,
        fields
    };
}

async function fillForm(payload: any) {
    const { fields, selector, formIndex = 0, submit = false } = payload;

    let form: HTMLFormElement | null = null;

    if (selector) {
        form = document.querySelector(selector);
    } else if (formIndex !== undefined) {
        form = document.forms[formIndex] || null;
    }

    const filled: string[] = [];
    const errors: string[] = [];

    for (const [key, value] of Object.entries(fields)) {
        try {
            let element: HTMLElement | null = null;

            // Try to find by name, id, or selector
            if (form) {
                element = form.querySelector(`[name="${key}"], #${key}, ${key}`) as HTMLElement;
            } else {
                element = document.querySelector(`[name="${key}"], #${key}, ${key}`) as HTMLElement;
            }

            if (!element) {
                errors.push(`Field not found: ${key}`);
                continue;
            }

            if (element.tagName === 'SELECT') {
                (element as HTMLSelectElement).value = String(value);
            } else if (element.tagName === 'INPUT') {
                const input = element as HTMLInputElement;
                if (input.type === 'checkbox' || input.type === 'radio') {
                    input.checked = Boolean(value);
                } else {
                    input.value = String(value);
                }
            } else if (element.tagName === 'TEXTAREA') {
                (element as HTMLTextAreaElement).value = String(value);
            }

            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push(key);
        } catch (e: any) {
            errors.push(`Error filling ${key}: ${e.message}`);
        }
    }

    if (submit && form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    return { filled, errors, submitted: submit && !!form };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function findElementsByText(text: string): HTMLElement[] {
    const searchText = text.toLowerCase();
    const results: HTMLElement[] = [];

    // First search interactive elements
    const interactiveSelectors = 'button, a, input[type="button"], input[type="submit"], [role="button"], [role="link"], label';
    const interactiveElements = document.querySelectorAll(interactiveSelectors);

    for (const el of interactiveElements) {
        const htmlEl = el as HTMLElement;
        const elText = (htmlEl.innerText || htmlEl.getAttribute('aria-label') || htmlEl.getAttribute('title') || '').toLowerCase();
        if (elText.includes(searchText)) {
            results.push(htmlEl);
        }
    }

    // Then search other elements
    if (results.length === 0) {
        const allElements = document.querySelectorAll('span, div, p, li, td, th, h1, h2, h3, h4, h5, h6');
        for (const el of allElements) {
            const htmlEl = el as HTMLElement;
            if (htmlEl.innerText?.toLowerCase().includes(searchText)) {
                results.push(htmlEl);
            }
        }
    }

    return results;
}

function isElementVisible(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isElementClickable(element: HTMLElement): boolean {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    const hasClick = element.onclick !== null || element.getAttribute('onclick') !== null;
    const isInteractive = ['a', 'button', 'input', 'select', 'textarea', 'label'].includes(tag);
    const hasRole = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio'].includes(role || '');
    const hasTabIndex = element.getAttribute('tabindex') !== null && element.getAttribute('tabindex') !== '-1';

    return isInteractive || hasRole || hasClick || hasTabIndex;
}

function getElementRect(element: HTMLElement): { x: number; y: number; width: number; height: number } {
    const rect = element.getBoundingClientRect();
    return {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
    };
}

function getElementDescriptor(element: HTMLElement): string {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classes = element.className && typeof element.className === 'string'
        ? '.' + element.className.split(' ').filter(c => c).slice(0, 2).join('.')
        : '';
    return `${tag}${id}${classes}`;
}

function generateSelector(element: HTMLElement): string {
    try {
        // Try ID first (escape special characters)
        if (element.id) {
            const escapedId = CSS.escape(element.id);
            return `#${escapedId}`;
        }

        const tag = element.tagName.toLowerCase();

        // Try unique attributes
        for (const attr of ['name', 'data-testid', 'data-id', 'aria-label']) {
            const value = element.getAttribute(attr);
            if (value) {
                // Escape quotes in attribute values
                const escapedValue = value.replace(/"/g, '\\"');
                return `${tag}[${attr}="${escapedValue}"]`;
            }
        }

        // Try class combination (with validation)
        if (element.className && typeof element.className === 'string') {
            const classes = element.className.split(' ').filter(c => {
                // Filter out empty, pseudo-classes, and invalid class names
                if (!c || c.includes(':') || c.includes('[') || c.includes(']')) return false;
                // Check if class starts with a number or special char (invalid CSS)
                if (/^[0-9\-]/.test(c) && !/^-?[a-zA-Z_]/.test(c)) return false;
                return true;
            });

            if (classes.length > 0) {
                try {
                    const escapedClasses = classes.slice(0, 2).map(c => CSS.escape(c));
                    const selector = `${tag}.${escapedClasses.join('.')}`;
                    if (document.querySelectorAll(selector).length === 1) {
                        return selector;
                    }
                } catch {
                    // If CSS.escape or querySelectorAll fails, skip class-based selector
                }
            }
        }

        // Fall back to nth-child
        const parent = element.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
            const index = siblings.indexOf(element);
            if (index !== -1) {
                let parentSelector = parent.tagName.toLowerCase();
                if (parent.id) {
                    try {
                        parentSelector = `#${CSS.escape(parent.id)}`;
                    } catch {
                        // Use tag name if escape fails
                    }
                }
                return `${parentSelector} > ${tag}:nth-of-type(${index + 1})`;
            }
        }

        return tag;
    } catch {
        // Ultimate fallback
        return element.tagName.toLowerCase();
    }
}

function getFieldInfo(element: HTMLElement, index: number) {
    const input = element as HTMLInputElement;
    return {
        index,
        tag: element.tagName.toLowerCase(),
        type: input.type || 'text',
        name: input.name || undefined,
        id: input.id || undefined,
        placeholder: input.placeholder || undefined,
        label: findLabelFor(element),
        required: input.required || false,
        disabled: input.disabled || false,
        value: input.type === 'password' ? '***' : (input.value?.substring(0, 100) || ''),
        selector: generateSelector(element),
        options: element.tagName === 'SELECT'
            ? Array.from((element as HTMLSelectElement).options).map(o => ({ value: o.value, text: o.text }))
            : undefined
    };
}

function findLabelFor(element: HTMLElement): string | undefined {
    // Check for associated label
    if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) return (label as HTMLElement).innerText?.trim();
    }

    // Check for parent label
    const parentLabel = element.closest('label');
    if (parentLabel) {
        return parentLabel.innerText?.trim().replace(element.innerText || '', '').trim();
    }

    // Check for aria-label
    return element.getAttribute('aria-label') || undefined;
}
