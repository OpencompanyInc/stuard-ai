from typing import Any

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _clamp_int, _normalize_wait_until, _is_allowed_url
from browser_server.lifecycle import (
    _ensure_browser, _get_page_url, _get_page_title, _get_playwright_page,
    _find_elements, _evaluate, _goto, _wait_for_selector,
)


async def _try_click_locator(locator: Any, page: Any, timeout: int, method: str) -> tuple[bool, str]:
    target = getattr(locator, "first", locator)
    try:
        if hasattr(target, "wait_for"):
            try:
                await target.wait_for(state="visible", timeout=min(timeout, 2000))
            except Exception:
                pass
        if hasattr(target, "scroll_into_view_if_needed"):
            try:
                await target.scroll_into_view_if_needed(timeout=min(timeout, 2000))
            except Exception:
                pass
        if hasattr(target, "focus"):
            try:
                await target.focus()
            except Exception:
                pass
        if hasattr(target, "click"):
            try:
                await target.click(timeout=timeout)
                return True, method
            except Exception:
                pass
            try:
                await target.click(timeout=min(timeout, 3000), force=True)
                return True, f"{method}_force"
            except Exception:
                pass
        if hasattr(target, "dispatch_event"):
            try:
                await target.dispatch_event("click")
                return True, f"{method}_dispatch"
            except Exception:
                pass
        mouse = getattr(page, "mouse", None)
        if mouse is not None and hasattr(target, "bounding_box"):
            box = await target.bounding_box()
            if box and box.get("width", 0) > 0 and box.get("height", 0) > 0:
                await mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                return True, f"{method}_mouse"
    except Exception:
        pass
    return False, ""


async def handle_navigate(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    url = str(body.get("url", "")).strip()
    if not url:
        return _err("url is required")
    if not _is_allowed_url(url):
        return _err("Only http/https/about URLs are allowed")

    async with state._lock:
        ok, err = await _ensure_browser()
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
    selector = str(body.get("selector", "")).strip()
    text = str(body.get("text", "")).strip()
    exact = bool(body.get("exact", False))
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not selector and not text:
        return _err("selector or text is required")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            # Strategy 1: Playwright locator click by selector with retries/fallbacks
            if selector and pw:
                try:
                    ok_clicked, method = await _try_click_locator(pw.locator(selector), pw, timeout, "playwright_selector")
                    if ok_clicked:
                        return _ok({"clicked": selector, "method": method})
                except Exception:
                    pass

            # Strategy 2: Prefer accessible roles for button-like targets
            if text and pw:
                for role in ["button", "link", "menuitem", "tab", "option", "checkbox", "radio", "combobox"]:
                    try:
                        locator = pw.get_by_role(role, name=text, exact=exact)
                        ok_clicked, method = await _try_click_locator(locator, pw, min(timeout, 3000), f"playwright_role_{role}")
                        if ok_clicked:
                            return _ok({"clicked": text, "method": method})
                    except Exception:
                        continue

            # Strategy 3: Playwright label locator
            if text and pw:
                try:
                    locator = pw.get_by_label(text, exact=exact)
                    ok_clicked, method = await _try_click_locator(locator, pw, min(timeout, 3000), "playwright_label")
                    if ok_clicked:
                        return _ok({"clicked": text, "method": method})
                except Exception:
                    pass

            # Strategy 4: Playwright placeholder locator
            if text and pw:
                try:
                    locator = pw.get_by_placeholder(text, exact=exact)
                    ok_clicked, method = await _try_click_locator(locator, pw, min(timeout, 3000), "playwright_placeholder")
                    if ok_clicked:
                        return _ok({"clicked": text, "method": method})
                except Exception:
                    pass

            # Strategy 5: Playwright text locator after button-like locators
            if text and pw:
                try:
                    locator = pw.get_by_text(text, exact=exact)
                    ok_clicked, method = await _try_click_locator(locator, pw, timeout, "playwright_text")
                    if ok_clicked:
                        return _ok({"clicked": text, "method": method})
                except Exception:
                    pass

            # Strategy 6: Playwright element click by selector
            if selector:
                try:
                    els = await _find_elements(selector)
                    if els:
                        await els[0].click()
                        return _ok({"clicked": selector, "method": "playwright_selector"})
                except Exception:
                    pass

            # Strategy 7: Enhanced JS click with broad element search, scoring, and full event dispatch
            if text:
                clicked = await _evaluate(
                    """(needle, exact, timeoutMs) => {
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
                          const all = document.querySelectorAll('*');
                          const matches = [];
                          for (const el of all) {
                            const t = textOf(el);
                            if (!t) continue;
                            const isMatch = exact
                              ? t === needle
                              : t.toLowerCase().includes(String(needle).toLowerCase());
                            if (!isMatch) continue;
                            const r = el.getBoundingClientRect();
                            const s = window.getComputedStyle(el);
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
                          if (matches.length > 0) {
                            matches.sort((a, b) => b.score - a.score);
                            const target = matches[0].el;
                            target.scrollIntoView({ block: 'center', inline: 'center' });
                            setTimeout(() => {
                              const r = target.getBoundingClientRect();
                              const cx = r.left + r.width / 2;
                              const cy = r.top + r.height / 2;
                              const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
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

            # Strategy 8: JS selector click as last resort
            if selector:
                clicked = await _evaluate(
                    """(sel) => {
                      const el = document.querySelector(sel);
                      if (!el) return 'not_found';
                      el.scrollIntoView({ block: 'center', inline: 'center' });
                      const r = el.getBoundingClientRect();
                      const cx = r.left + r.width / 2;
                      const cy = r.top + r.height / 2;
                      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
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
                    return _ok({"clicked": selector, "method": "js_selector"})

            target_desc = selector or text
            return _err(f"Click failed: no element found matching '{target_desc}'")
        except Exception as e:
            return _err(f"Click failed: {e}")


async def handle_type(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    text = str(body.get("text", ""))
    clear = body.get("clear", True)
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            # Strategy 1: Playwright fill
            if selector and pw:
                try:
                    if clear:
                        await pw.fill(selector, text, timeout=timeout)
                    else:
                        await pw.type(selector, text, timeout=timeout)
                    return _ok({"typed": len(text), "method": "playwright_fill"})
                except Exception:
                    pass

            # Strategy 2: Playwright keyboard typing into focused element
            if not selector and pw:
                try:
                    if clear:
                        await pw.keyboard.press("Control+a")
                        await pw.keyboard.press("Delete")
                    await pw.keyboard.type(text, delay=20)
                    return _ok({"typed": len(text), "method": "playwright_keyboard"})
                except Exception:
                    pass

            # Strategy 3: Playwright element fill by selector
            if selector:
                try:
                    els = await _find_elements(selector)
                    if els:
                        await els[0].fill(text, clear=clear)
                        return _ok({"typed": len(text), "method": "playwright_fill"})
                except Exception:
                    pass

            # Strategy 4: Enhanced JS with React/Vue-compatible event simulation
            result = await _evaluate(
                """(value, clearFirst, sel) => {
                  let el = sel ? document.querySelector(sel) : document.activeElement;
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
                return _ok({"typed": len(text), "method": "js_enhanced"})
            detail = result.get("detail", "Unknown error") if isinstance(result, dict) else str(result)
            return _err(f"Type failed: {detail}")
        except Exception as e:
            return _err(f"Type failed: {e}")


async def handle_press_key(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    key = str(body.get("key", "")).strip()
    selector = str(body.get("selector", "")).strip()
    if not key:
        return _err("key is required")
    if len(key) > 64:
        return _err("key is too long")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                focused = await _evaluate(
                    """(sel, dir, amt) => {
                      const el = document.querySelector(sel);
                      if (!el) return 'not_found';
                      if (typeof el.focus === 'function') el.focus();
                      return 'ok';
                    }""",
                    selector,
                )
                if focused != "ok":
                    return _err(f"Press key failed: selector not found: {selector}")

            keyboard = getattr(state._page, "keyboard", None)
            if keyboard is not None and hasattr(keyboard, "press"):
                await keyboard.press(key)
                return _ok({"key": key})
            if hasattr(state._page, "send_keys"):
                await state._page.send_keys(key)
                return _ok({"key": key})

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
