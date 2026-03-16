import asyncio
from typing import Any

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _clamp_int
from browser_server.lifecycle import (
    _ensure_browser, _get_page_url, _get_page_title, _get_playwright_page,
    _find_elements, _evaluate, _wait_for_selector, _smart_wait_for_element,
    _close_browser,
)


async def handle_hover(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    text = str(body.get("text", "")).strip()
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not selector and not text:
        return _err("selector or text is required")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            if selector and pw:
                try:
                    await pw.hover(selector, timeout=timeout)
                    return _ok({"hovered": selector, "method": "playwright_selector"})
                except Exception:
                    pass

            if text and pw:
                try:
                    locator = pw.get_by_text(text)
                    await locator.first.hover(timeout=timeout)
                    return _ok({"hovered": text, "method": "playwright_text"})
                except Exception:
                    pass

            target = selector or text
            result = await _evaluate(
                """(sel, needle) => {
                  let el = sel ? document.querySelector(sel) : null;
                  if (!el && needle) {
                    const all = document.querySelectorAll('*');
                    for (const candidate of all) {
                      const t = (candidate.innerText || candidate.textContent || '').trim();
                      if (t && t.toLowerCase().includes(needle.toLowerCase())) {
                        const r = candidate.getBoundingClientRect();
                        const s = window.getComputedStyle(candidate);
                        if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden') {
                          el = candidate;
                          break;
                        }
                      }
                    }
                  }
                  if (!el) return 'not_found';
                  el.scrollIntoView({ block: 'center', inline: 'center' });
                  const r = el.getBoundingClientRect();
                  const opts = { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
                  el.dispatchEvent(new PointerEvent('pointerover', opts));
                  el.dispatchEvent(new MouseEvent('mouseover', opts));
                  el.dispatchEvent(new PointerEvent('pointerenter', opts));
                  el.dispatchEvent(new MouseEvent('mouseenter', opts));
                  return 'hovered';
                }""",
                selector,
                text,
            )
            if result == "hovered":
                return _ok({"hovered": target, "method": "js_hover"})
            return _err(f"Hover failed: element not found for '{target}'")
        except Exception as e:
            return _err(f"Hover failed: {e}")


async def handle_select_option(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    value = body.get("value")
    label = body.get("label")
    index = body.get("index")
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not selector:
        return _err("selector is required for select_option")
    if value is None and label is None and index is None:
        return _err("One of value, label, or index is required")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            if pw:
                try:
                    if value is not None:
                        selected = await pw.select_option(selector, value=str(value), timeout=timeout)
                    elif label is not None:
                        selected = await pw.select_option(selector, label=str(label), timeout=timeout)
                    elif index is not None:
                        selected = await pw.select_option(selector, index=int(index), timeout=timeout)
                    else:
                        selected = []
                    return _ok({"selected": selected, "method": "playwright"})
                except Exception:
                    pass

            result = await _evaluate(
                """(sel, val, lbl, idx) => {
                  const el = document.querySelector(sel);
                  if (!el || el.tagName !== 'SELECT') return { status: 'not_select', detail: 'Element is not a <select>' };
                  let matched = false;
                  for (let i = 0; i < el.options.length; i++) {
                    const opt = el.options[i];
                    if (val !== null && val !== undefined && opt.value === String(val)) {
                      el.selectedIndex = i; matched = true; break;
                    }
                    if (lbl !== null && lbl !== undefined && opt.text.trim().toLowerCase().includes(String(lbl).toLowerCase())) {
                      el.selectedIndex = i; matched = true; break;
                    }
                    if (idx !== null && idx !== undefined && i === Number(idx)) {
                      el.selectedIndex = i; matched = true; break;
                    }
                  }
                  if (!matched) return { status: 'no_match', detail: 'No matching option found' };
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return { status: 'ok', value: el.value, text: el.options[el.selectedIndex].text };
                }""",
                selector,
                value,
                label,
                index,
            )
            if isinstance(result, dict) and result.get("status") == "ok":
                return _ok({"selected": result.get("value"), "text": result.get("text"), "method": "js"})
            detail = result.get("detail", "Unknown error") if isinstance(result, dict) else str(result)
            return _err(f"Select option failed: {detail}")
        except Exception as e:
            return _err(f"Select option failed: {e}")


async def handle_get_interactive_elements(req: web.Request) -> web.Response:
    body = await _safe_json(req) if req.content_length else {}

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            wait_selector = str(body.get("wait_for_selector", "")).strip()
            wait_timeout = _clamp_int(body.get("wait_timeout", 3000), 3000, 500, 30000)
            if wait_selector:
                await _wait_for_selector(wait_selector, timeout=wait_timeout)

            result = await _evaluate(
                """() => {
                  const elements = [];
                  const forms = [];

                  function getSelector(el) {
                    if (el.id) return '#' + CSS.escape(el.id);
                    if (el.name && el.tagName !== 'DIV' && el.tagName !== 'SPAN') {
                      const byName = document.querySelectorAll(el.tagName.toLowerCase() + '[name="' + el.name + '"]');
                      if (byName.length === 1) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
                    }
                    if (el.className && typeof el.className === 'string') {
                      const classes = el.className.trim().split(/\\s+/).filter(c => c && !c.startsWith('css-') && c.length < 40).slice(0, 3);
                      if (classes.length > 0) {
                        const sel = el.tagName.toLowerCase() + '.' + classes.map(c => CSS.escape(c)).join('.');
                        const found = document.querySelectorAll(sel);
                        if (found.length === 1) return sel;
                      }
                    }
                    const path = [];
                    let current = el;
                    while (current && current !== document.body && path.length < 5) {
                      let seg = current.tagName.toLowerCase();
                      if (current.id) { path.unshift('#' + CSS.escape(current.id)); break; }
                      const parent = current.parentElement;
                      if (parent) {
                        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                        if (siblings.length > 1) {
                          const idx = siblings.indexOf(current) + 1;
                          seg += ':nth-of-type(' + idx + ')';
                        }
                      }
                      path.unshift(seg);
                      current = parent;
                    }
                    return path.join(' > ');
                  }

                  function getLabel(el) {
                    if (el.id) {
                      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
                      if (label) return (label.innerText || label.textContent || '').trim();
                    }
                    const parentLabel = el.closest('label');
                    if (parentLabel) {
                      const text = (parentLabel.innerText || parentLabel.textContent || '').trim();
                      const inputVal = el.value || '';
                      return text.replace(inputVal, '').trim();
                    }
                    const ariaLabel = el.getAttribute('aria-label');
                    if (ariaLabel) return ariaLabel.trim();
                    const labelledBy = el.getAttribute('aria-labelledby');
                    if (labelledBy) {
                      const labelEl = document.getElementById(labelledBy);
                      if (labelEl) return (labelEl.innerText || labelEl.textContent || '').trim();
                    }
                    const prev = el.previousElementSibling;
                    if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
                      const t = (prev.innerText || prev.textContent || '').trim();
                      if (t && t.length < 80) return t;
                    }
                    return '';
                  }

                  function isVisible(el) {
                    const r = el.getBoundingClientRect();
                    const s = window.getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
                  }

                  const interactiveSelectors = 'input, textarea, select, button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="searchbox"], [role="textbox"], [contenteditable="true"]';
                  const all = document.querySelectorAll(interactiveSelectors);

                  for (const el of all) {
                    if (!isVisible(el)) continue;

                    const tag = el.tagName.toLowerCase();
                    const type = el.getAttribute('type') || '';
                    const role = el.getAttribute('role') || '';
                    const name = el.getAttribute('name') || '';
                    const id = el.id || '';
                    const placeholder = el.getAttribute('placeholder') || '';
                    const ariaLabel = el.getAttribute('aria-label') || '';
                    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
                    const required = el.required || el.getAttribute('aria-required') === 'true';
                    const readonly = el.readOnly || el.getAttribute('aria-readonly') === 'true';

                    const entry = {
                      index: elements.length,
                      tag: tag,
                      selector: getSelector(el),
                    };

                    if (type) entry.type = type;
                    if (role) entry.role = role;
                    if (name) entry.name = name;
                    if (id) entry.id = id;

                    if (['button', 'a'].includes(tag) || ['button', 'link', 'tab', 'menuitem'].includes(role)) {
                      const text = (el.innerText || el.textContent || ariaLabel || '').trim();
                      if (text) entry.text = text.substring(0, 200);
                      if (tag === 'a') entry.href = el.getAttribute('href') || '';
                    }

                    if (['input', 'textarea', 'select'].includes(tag) || ['textbox', 'searchbox', 'combobox'].includes(role)) {
                      const label = getLabel(el);
                      if (label) entry.label = label.substring(0, 200);
                      if (placeholder) entry.placeholder = placeholder;

                      if (tag === 'select') {
                        entry.value = el.value;
                        const selectedOption = el.options && el.options[el.selectedIndex];
                        if (selectedOption) entry.selectedText = selectedOption.text.trim();
                        entry.options = Array.from(el.options || []).slice(0, 30).map(o => ({
                          value: o.value, text: o.text.trim(), selected: o.selected
                        }));
                      } else if (type === 'checkbox' || type === 'radio') {
                        entry.checked = el.checked;
                        const label = getLabel(el);
                        if (label) entry.label = label.substring(0, 200);
                      } else {
                        entry.value = (el.value || '').substring(0, 500);
                      }
                    }

                    if (disabled) entry.disabled = true;
                    if (required) entry.required = true;
                    if (readonly) entry.readonly = true;

                    elements.push(entry);
                  }

                  const allForms = document.querySelectorAll('form');
                  for (const form of allForms) {
                    if (!isVisible(form)) continue;
                    const formEntry = {
                      selector: getSelector(form),
                      action: form.action || '',
                      method: (form.method || 'GET').toUpperCase(),
                      name: form.name || form.id || '',
                      fieldIndices: [],
                    };
                    for (const field of form.elements) {
                      const idx = elements.findIndex(e => {
                        try { return document.querySelector(e.selector) === field; } catch { return false; }
                      });
                      if (idx >= 0) formEntry.fieldIndices.push(idx);
                    }
                    forms.push(formEntry);
                  }

                  return { elements: elements, forms: forms };
                }"""
            )

            url = await _get_page_url()
            title = await _get_page_title()
            elements = result.get("elements", []) if isinstance(result, dict) else []
            forms_data = result.get("forms", []) if isinstance(result, dict) else []

            return _ok({
                "url": url,
                "title": title,
                "elements": elements,
                "forms": forms_data,
                "elementCount": len(elements),
                "formCount": len(forms_data),
            })
        except Exception as e:
            return _err(f"Get interactive elements failed: {e}")


async def handle_fill_form(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    fields = body.get("fields")
    submit = bool(body.get("submit", False))
    form_selector = str(body.get("form_selector", "")).strip()

    if not fields or not isinstance(fields, (dict, list)):
        return _err("fields is required (object mapping selector/name to value, or array of {selector, value})")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()
            filled = 0
            errors = []

            field_list: list[dict[str, Any]] = []
            if isinstance(fields, dict):
                for key, val in fields.items():
                    field_list.append({"selector": key, "value": str(val)})
            else:
                for item in fields:
                    if isinstance(item, dict) and ("selector" in item or "name" in item):
                        sel = item.get("selector") or f'[name="{item.get("name")}"]'
                        field_list.append({"selector": sel, "value": str(item.get("value", ""))})

            for field in field_list:
                sel = field["selector"]
                val = field["value"]
                field_type = field.get("type", "text")

                try:
                    if field_type == "select" and pw:
                        await pw.select_option(sel, label=val, timeout=5000)
                        filled += 1
                    elif field_type in ("checkbox", "radio"):
                        if pw:
                            checked = await pw.is_checked(sel)
                            should_check = val.lower() in ("true", "1", "yes", "on")
                            if checked != should_check:
                                await pw.click(sel, timeout=5000)
                        filled += 1
                    elif pw:
                        await pw.fill(sel, val, timeout=5000)
                        filled += 1
                    else:
                        els = await _find_elements(sel)
                        if els:
                            await els[0].fill(val, clear=True)
                            filled += 1
                        else:
                            errors.append(f"Field not found: {sel}")
                except Exception as e:
                    errors.append(f"{sel}: {str(e)[:100]}")

            submitted = False
            if submit and filled > 0:
                try:
                    if form_selector and pw:
                        submit_btn = pw.locator(f"{form_selector} [type='submit'], {form_selector} button")
                        await submit_btn.first.click(timeout=5000)
                        submitted = True
                    elif pw:
                        submit_btn = pw.locator("[type='submit'], button[type='submit']")
                        await submit_btn.first.click(timeout=5000)
                        submitted = True
                    else:
                        await _evaluate(
                            """(formSel) => {
                              const form = formSel ? document.querySelector(formSel) : document.querySelector('form');
                              if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); return 'ok'; }
                              if (form && typeof form.submit === 'function') { form.submit(); return 'ok'; }
                              return 'no_form';
                            }""",
                            form_selector,
                        )
                        submitted = True
                except Exception as e:
                    errors.append(f"Submit failed: {str(e)[:100]}")

            return _ok({
                "filled": filled,
                "total": len(field_list),
                "submitted": submitted,
                "errors": errors if errors else None,
            })
        except Exception as e:
            return _err(f"Fill form failed: {e}")


async def handle_wait_for(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    text = str(body.get("text", "")).strip()
    url_pattern = str(body.get("url_pattern", "")).strip()
    wait_state = str(body.get("state", "visible")).strip()
    timeout = _clamp_int(body.get("timeout", 10000), 10000, 500, 60000)

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            if url_pattern:
                timeout_s = float(timeout) / 1000.0
                deadline = asyncio.get_event_loop().time() + timeout_s
                while asyncio.get_event_loop().time() < deadline:
                    current = await _get_page_url()
                    if url_pattern in current:
                        return _ok({"matched": True, "url": current, "type": "url_pattern"})
                    await asyncio.sleep(0.2)
                return _err(f"Timed out waiting for URL matching '{url_pattern}'")

            if selector and pw:
                try:
                    if wait_state == "hidden":
                        await pw.wait_for_selector(selector, state="hidden", timeout=timeout)
                    elif wait_state == "detached":
                        await pw.wait_for_selector(selector, state="detached", timeout=timeout)
                    else:
                        await pw.wait_for_selector(selector, state="visible", timeout=timeout)
                    return _ok({"matched": True, "selector": selector, "type": "selector"})
                except Exception as e:
                    return _err(f"Timed out waiting for selector '{selector}': {e}")

            if selector or text:
                found = await _smart_wait_for_element(selector=selector, text=text, timeout=timeout)
                if found:
                    return _ok({"matched": True, "type": "element"})
                target = selector or text
                return _err(f"Timed out waiting for element '{target}'")

            return _err("One of selector, text, or url_pattern is required")
        except Exception as e:
            return _err(f"Wait failed: {e}")


async def handle_close(_req: web.Request) -> web.Response:
    await _close_browser()
    return _ok({"closed": True})
