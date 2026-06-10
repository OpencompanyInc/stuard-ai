import asyncio

from aiohttp import web

from browser_server import state
from browser_server.utils import (
    _safe_json, _ok, _err, _clamp_int, _normalize_wait_until, _is_allowed_url,
    _resolve_selector_target,
)
from browser_server.lifecycle import (
    browser_op, _get_page_url, _get_page_title,
    _evaluate, _goto, _wait_for_selector,
    _cdp_click_selector, _cdp_click_at, _cdp_type_text, _cdp_press_key,
    _cdp_clear_and_type,
)


async def handle_navigate(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    url = str(body.get("url", "")).strip()
    if not url:
        return _err("url is required")
    if not _is_allowed_url(url):
        return _err("Only http/https/about URLs are allowed")

    async with browser_op(body) as (ok, err):
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            wait_until = _normalize_wait_until(body.get("wait_until", "domcontentloaded"))
            timeout = _clamp_int(body.get("timeout", 30000), 30000, 1000, 180000)
            await _goto(url, wait_until=wait_until, timeout=timeout)
            selector = str(body.get("wait_for_selector") or "").strip()
            if selector:
                found = await _wait_for_selector(selector, timeout=_clamp_int(timeout, 5000, 500, 180000))
                if not found:
                    return _err(f"Navigation finished, but selector not found: {selector}")
            return _ok({"url": await _get_page_url(), "title": await _get_page_title()})
        except Exception as e:
            return _err(f"Navigation failed: {e}")


async def handle_click(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector, element_id = _resolve_selector_target(body)
    text = str(body.get("text", "")).strip()
    exact = bool(body.get("exact", False))
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not selector and not text:
        return _err("selector, elementId, or text is required")

    async with browser_op(body) as (ok, err):
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            # Strategy 1: CDP mouse click by CSS selector
            if selector:
                clicked = await _cdp_click_selector(selector)
                if clicked:
                    return _ok({
                        "clicked": selector,
                        "elementId": element_id or None,
                        "method": "cdp_selector",
                    })

            # Strategy 2: CDP mouse click by text — find element via JS, get coords, click via CDP
            if text:
                coords = await _evaluate(
                    """([needle, exact, timeoutMs]) => {
                      return new Promise((resolve) => {
                        const deadline = Date.now() + timeoutMs;
                        function attempt() {
                          const textOf = (el) => {
                            if (!el) return '';
                            return [
                              el.innerText, el.textContent,
                              el.getAttribute('aria-label'),
                              el.getAttribute('title'),
                              el.getAttribute('placeholder'),
                              el.getAttribute('value'),
                              el.getAttribute('alt'),
                            ].filter(Boolean).map(t => t.trim()).join(' ');
                          };
                          const searchScopes = [{ doc: document, offX: 0, offY: 0 }];
                          try {
                            document.querySelectorAll('iframe').forEach(iframe => {
                              try {
                                const iDoc = iframe.contentDocument;
                                if (!iDoc) return;
                                const ir = iframe.getBoundingClientRect();
                                searchScopes.push({ doc: iDoc, win: iframe.contentWindow, offX: ir.left, offY: ir.top });
                              } catch(e) {}
                            });
                          } catch(e) {}
                          const matches = [];
                          for (const scope of searchScopes) {
                            const all = scope.doc.querySelectorAll('*');
                            const w = scope.win || window;
                            for (const el of all) {
                              const t = textOf(el);
                              if (!t) continue;
                              const isMatch = exact
                                ? t === needle
                                : t.toLowerCase().includes(String(needle).toLowerCase());
                              if (!isMatch) continue;
                              const r = el.getBoundingClientRect();
                              let s;
                              try { s = w.getComputedStyle(el); } catch(e) { continue; }
                              if (r.width === 0 && r.height === 0) continue;
                              if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
                              let score = 0;
                              const tag = el.tagName.toLowerCase();
                              if (['button','a','input','select','textarea'].includes(tag)) score += 100;
                              if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') score += 90;
                              if (el.onclick || el.getAttribute('onclick')) score += 80;
                              if (el.getAttribute('tabindex')) score += 50;
                              if (s.cursor === 'pointer') score += 40;
                              score -= Math.abs(t.length - needle.length) * 0.1;
                              matches.push({ el, score, r, offX: scope.offX, offY: scope.offY });
                            }
                          }
                          if (matches.length > 0) {
                            matches.sort((a, b) => b.score - a.score);
                            const best = matches[0];
                            best.el.scrollIntoView({ block: 'center', inline: 'center' });
                            setTimeout(() => {
                              const r = best.el.getBoundingClientRect();
                              resolve({ x: r.left + r.width / 2 + best.offX, y: r.top + r.height / 2 + best.offY });
                            }, 50);
                            return;
                          }
                          if (Date.now() < deadline) {
                            setTimeout(attempt, 200);
                          } else {
                            resolve(null);
                          }
                        }
                        attempt();
                      });
                    }""",
                    text,
                    exact,
                    timeout,
                )
                if isinstance(coords, dict) and "x" in coords and "y" in coords:
                    try:
                        await _cdp_click_at(float(coords["x"]), float(coords["y"]))
                        return _ok({"clicked": text, "method": "cdp_text"})
                    except Exception:
                        pass

            # Strategy 3: JS dispatch click by text (fallback — works through overlays)
            if text:
                clicked = await _evaluate(
                    """([needle, exact, timeoutMs]) => {
                      return new Promise((resolve) => {
                        const deadline = Date.now() + timeoutMs;
                        function attempt() {
                          const textOf = (el) => {
                            if (!el) return '';
                            return [
                              el.innerText, el.textContent,
                              el.getAttribute('aria-label'),
                              el.getAttribute('title'),
                              el.getAttribute('placeholder'),
                              el.getAttribute('value'),
                              el.getAttribute('alt'),
                            ].filter(Boolean).map(t => t.trim()).join(' ');
                          };
                          const searchScopes = [{ doc: document, win: window }];
                          try {
                            document.querySelectorAll('iframe').forEach(iframe => {
                              try {
                                const iDoc = iframe.contentDocument;
                                if (iDoc) searchScopes.push({ doc: iDoc, win: iframe.contentWindow || window });
                              } catch(e) {}
                            });
                          } catch(e) {}
                          const matches = [];
                          for (const scope of searchScopes) {
                            const all = scope.doc.querySelectorAll('*');
                            for (const el of all) {
                              const t = textOf(el);
                              if (!t) continue;
                              const isMatch = exact
                                ? t === needle
                                : t.toLowerCase().includes(String(needle).toLowerCase());
                              if (!isMatch) continue;
                              const r = el.getBoundingClientRect();
                              let s;
                              try { s = scope.win.getComputedStyle(el); } catch(e) { continue; }
                              if (r.width === 0 && r.height === 0) continue;
                              if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
                              let score = 0;
                              const tag = el.tagName.toLowerCase();
                              if (['button','a','input','select','textarea'].includes(tag)) score += 100;
                              if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') score += 90;
                              if (el.onclick || el.getAttribute('onclick')) score += 80;
                              if (el.getAttribute('tabindex')) score += 50;
                              if (s.cursor === 'pointer') score += 40;
                              score -= Math.abs(t.length - needle.length) * 0.1;
                              matches.push({ el, score });
                            }
                          }
                          if (matches.length > 0) {
                            matches.sort((a, b) => b.score - a.score);
                            const target = matches[0].el;
                            target.scrollIntoView({ block: 'center', inline: 'center' });
                            setTimeout(() => {
                              const r = target.getBoundingClientRect();
                              const cx = r.left + r.width / 2;
                              const cy = r.top + r.height / 2;
                              const w = target.ownerDocument?.defaultView || window;
                              const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: w };
                              target.dispatchEvent(new PointerEvent('pointerdown', opts));
                              target.dispatchEvent(new MouseEvent('mousedown', opts));
                              target.dispatchEvent(new PointerEvent('pointerup', opts));
                              target.dispatchEvent(new MouseEvent('mouseup', opts));
                              target.dispatchEvent(new MouseEvent('click', opts));
                              if (typeof target.focus === 'function') target.focus();
                              resolve('clicked');
                            }, 50);
                            return;
                          }
                          if (Date.now() < deadline) {
                            setTimeout(attempt, 200);
                          } else {
                            resolve('not_found');
                          }
                        }
                        attempt();
                      });
                    }""",
                    text,
                    exact,
                    timeout,
                )
                if clicked == "clicked":
                    return _ok({"clicked": text, "method": "js_enhanced"})

            # Strategy 4: JS selector click as last resort (searches iframes too)
            if selector:
                clicked = await _evaluate(
                    """(sel) => {
                      let el = document.querySelector(sel);
                      if (!el) {
                        const iframes = document.querySelectorAll('iframe');
                        for (const iframe of iframes) {
                          try { el = iframe.contentDocument?.querySelector(sel); if (el) break; } catch(e) {}
                        }
                      }
                      if (!el) return 'not_found';
                      el.scrollIntoView({ block: 'center', inline: 'center' });
                      const r = el.getBoundingClientRect();
                      const cx = r.left + r.width / 2;
                      const cy = r.top + r.height / 2;
                      const w = el.ownerDocument?.defaultView || window;
                      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: w };
                      el.dispatchEvent(new PointerEvent('pointerdown', opts));
                      el.dispatchEvent(new MouseEvent('mousedown', opts));
                      el.dispatchEvent(new PointerEvent('pointerup', opts));
                      el.dispatchEvent(new MouseEvent('mouseup', opts));
                      el.dispatchEvent(new MouseEvent('click', opts));
                      if (typeof el.focus === 'function') el.focus();
                      return 'clicked';
                    }""",
                    selector,
                )
                if clicked == "clicked":
                    return _ok({
                        "clicked": selector,
                        "elementId": element_id or None,
                        "method": "js_selector",
                    })

            target_desc = f"elementId={element_id}" if element_id else (selector or text)
            return _err(f"Click failed: no element found matching '{target_desc}'")
        except Exception as e:
            return _err(f"Click failed: {e}")


async def handle_type(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector, element_id = _resolve_selector_target(body)
    text = str(body.get("text", ""))
    clear = body.get("clear", True)
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    async with browser_op(body) as (ok, err):
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            # Strategy 1: CDP clear-and-type into a CSS-selected element
            if selector:
                if clear:
                    typed = await _cdp_clear_and_type(selector, text)
                else:
                    # Focus then type without clearing
                    await _cdp_click_selector(selector)
                    await asyncio.sleep(0.05)
                    typed = await _cdp_type_text(text)
                if typed:
                    return _ok({
                        "typed": len(text),
                        "elementId": element_id or None,
                        "method": "cdp_type",
                    })

            # Strategy 2: CDP keyboard into currently focused element
            if not selector:
                if clear:
                    await _cdp_press_key("Control+a")
                    await _cdp_press_key("Delete")
                typed = await _cdp_type_text(text)
                if typed:
                    return _ok({"typed": len(text), "method": "cdp_keyboard"})

            # Strategy 3: JS fill with React/Vue-compatible event simulation
            result = await _evaluate(
                """([value, clearFirst, sel]) => {
                  let el = sel ? document.querySelector(sel) : document.activeElement;
                  if (!el && sel) {
                    const iframes = document.querySelectorAll('iframe');
                    for (const iframe of iframes) {
                      try { el = iframe.contentDocument?.querySelector(sel); if (el) break; } catch(e) {}
                    }
                  }
                  if (!el) return { status: 'no_element', detail: 'No element found' };

                  const tag = el.tagName.toLowerCase();
                  if (!['input', 'textarea'].includes(tag) && !el.isContentEditable) {
                    const child = el.querySelector('input, textarea, [contenteditable="true"]');
                    if (child) el = child;
                  }

                  if (typeof el.focus === 'function') el.focus();
                  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
                  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

                  if ('value' in el) {
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                      el.tagName === 'TEXTAREA'
                        ? window.HTMLTextAreaElement.prototype
                        : window.HTMLInputElement.prototype,
                      'value'
                    )?.set;

                    if (clearFirst) {
                      if (nativeSetter) nativeSetter.call(el, '');
                      else el.value = '';
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    const newValue = clearFirst ? String(value ?? '') : (el.value || '') + String(value ?? '');
                    if (nativeSetter) nativeSetter.call(el, newValue);
                    else el.value = newValue;

                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    try {
                      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
                    } catch(e) {}
                    return { status: 'ok', typed: newValue.length };
                  } else if (el.isContentEditable) {
                    if (clearFirst) el.textContent = '';
                    el.textContent = (el.textContent || '') + String(value ?? '');
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return { status: 'ok', typed: el.textContent.length };
                  }
                  return { status: 'not_text_target', detail: 'Element is not a text input' };
                }""",
                text,
                clear,
                selector or "",
            )

            if isinstance(result, dict) and result.get("status") == "ok":
                return _ok({
                    "typed": len(text),
                    "elementId": element_id or None,
                    "method": "js_enhanced",
                })
            detail = result.get("detail", "Unknown error") if isinstance(result, dict) else str(result)
            return _err(f"Type failed: {detail}")
        except Exception as e:
            return _err(f"Type failed: {e}")


async def handle_press_key(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    key = str(body.get("key", "")).strip()
    selector, element_id = _resolve_selector_target(body)
    if not key:
        return _err("key is required")
    if len(key) > 64:
        return _err("key is too long")

    async with browser_op(body) as (ok, err):
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            # Focus element if selector provided
            if selector:
                focused = await _evaluate(
                    """(sel) => {
                      let el = document.querySelector(sel);
                      if (!el) {
                        const iframes = document.querySelectorAll('iframe');
                        for (const iframe of iframes) {
                          try { el = iframe.contentDocument?.querySelector(sel); if (el) break; } catch(e) {}
                        }
                      }
                      if (!el) return 'not_found';
                      if (typeof el.focus === 'function') el.focus();
                      return 'ok';
                    }""",
                    selector,
                )
                if focused != "ok":
                    if element_id:
                        return _err(f"Press key failed: elementId not found: {element_id}")
                    return _err(f"Press key failed: selector not found: {selector}")

            # CDP key press (handles modifiers like Control+a)
            pressed = await _cdp_press_key(key)
            if pressed:
                return _ok({"key": key, "elementId": element_id or None})

            # Fallback: JS key dispatch
            dispatched = await _evaluate(
                """(k) => {
                  const key = String(k || '');
                  const target = document.activeElement || document.body;
                  if (!target) return 'no_target';
                  const keyCodeMap = {
                    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
                    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
                  };
                  const keyCode = keyCodeMap[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
                  const evtInit = {
                    key,
                    code: key,
                    keyCode,
                    which: keyCode,
                    bubbles: true,
                    cancelable: true,
                  };
                  target.dispatchEvent(new KeyboardEvent('keydown', evtInit));
                  target.dispatchEvent(new KeyboardEvent('keypress', evtInit));
                  target.dispatchEvent(new KeyboardEvent('keyup', evtInit));
                  if (key === 'Enter') {
                    const form = target && target.form;
                    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
                  }
                  return 'ok';
                }""",
                key,
            )
            if dispatched != "ok":
                return _err("Press key failed")
            return _ok({"key": key})
        except Exception as e:
            return _err(f"Press key failed: {e}")
