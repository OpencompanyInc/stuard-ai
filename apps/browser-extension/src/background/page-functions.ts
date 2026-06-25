// Functions injected into pages via chrome.scripting.executeScript({ func }).
//
// CRITICAL: each function is serialized with Function.prototype.toString and
// re-parsed inside the page, so it must be FULLY self-contained — it may only
// reference its own parameters and page globals (document, window, location).
// No imports, no module-scope variables, no helper functions defined outside.
// Because they are compiled (not eval'd), they run on every site regardless of
// Content-Security-Policy — unlike run_script, which needs userScripts/eval.

/** Snapshot the page: url, title, selection, meta tags, and readable text. */
export function pageSnapshot(opts: { maxChars?: number; includeHtml?: boolean }) {
  const o = opts || {};
  const max = typeof o.maxChars === 'number' && o.maxChars > 0 ? o.maxChars : 20000;

  let text = (document.body && document.body.innerText) || '';
  const fullLen = text.length;
  if (text.length > max) text = text.slice(0, max);

  const selection = (window.getSelection && String(window.getSelection())) || '';

  const meta: Record<string, string> = {};
  document.querySelectorAll('meta[name],meta[property]').forEach((m) => {
    const key = m.getAttribute('name') || m.getAttribute('property');
    const val = m.getAttribute('content');
    if (key && val && !meta[key]) meta[key] = val.slice(0, 400);
  });

  const result: Record<string, unknown> = {
    ok: true,
    url: location.href,
    title: document.title,
    selection: selection.slice(0, 8000),
    text,
    textLength: fullLen,
    truncated: fullLen > max,
    meta,
    readyState: document.readyState,
  };
  if (o.includeHtml) {
    result.html = document.documentElement.outerHTML.slice(0, 200000);
  }
  return result;
}

/**
 * Structured DOM extraction. Reliable on every site (no eval).
 * spec = {
 *   container?: string,          // optional scope selector
 *   item: string,                // selector for each row (e.g. reddit comment)
 *   limit?: number,
 *   fields?: { [name]: { selector?: string, attr?: string, html?: boolean } },
 * }
 * Returns rows of objects (or raw text when no fields are given).
 */
export function extractRows(spec: {
  container?: string;
  item?: string;
  limit?: number;
  fields?: Record<string, { selector?: string; attr?: string; html?: boolean }>;
}) {
  const s = spec || {};
  const limit = typeof s.limit === 'number' && s.limit > 0 ? s.limit : 200;
  const root: ParentNode | null = s.container ? document.querySelector(s.container) : document;
  if (!root) return { ok: false, error: 'container_not_found', count: 0, rows: [] };

  const items = Array.from(root.querySelectorAll(s.item || '*')).slice(0, limit);

  const readField = (
    el: Element,
    def: { selector?: string; attr?: string; html?: boolean } | undefined,
  ): string | null => {
    const target = def && def.selector ? el.querySelector(def.selector) : el;
    if (!target) return null;
    if (def && def.attr) return target.getAttribute(def.attr);
    if (def && def.html) return (target as HTMLElement).innerHTML;
    return ((target as HTMLElement).innerText || target.textContent || '').trim();
  };

  const rows = items.map((el) => {
    if (!s.fields) return ((el as HTMLElement).innerText || el.textContent || '').trim();
    const row: Record<string, string | null> = {};
    for (const key of Object.keys(s.fields)) row[key] = readField(el, s.fields[key]);
    return row;
  });

  return { ok: true, count: rows.length, rows };
}

/**
 * Run arbitrary agent-authored JS in the MAIN world via the Function
 * constructor. Used only as a fallback when chrome.userScripts is unavailable.
 * Subject to the page's CSP — strict sites (e.g. Reddit) that forbid
 * 'unsafe-eval' will throw here, which the worker reports back clearly.
 */
export async function runScriptMainWorld(codeStr: string, args: Record<string, unknown>) {
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as any;
    const fn = new AsyncFunction('args', codeStr);
    const value = await fn(args || {});
    // Force JSON-serializability so the result survives structured cloning.
    return { ok: true, result: value === undefined ? null : JSON.parse(JSON.stringify(value)) };
  } catch (e: any) {
    const msg = String(e?.message || e);
    const cspBlocked = /unsafe-eval|EvalError|Content Security Policy|Refused to evaluate/i.test(msg);
    return { ok: false, error: msg, cspBlocked };
  }
}
