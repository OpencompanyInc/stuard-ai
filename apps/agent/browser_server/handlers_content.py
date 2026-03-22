import asyncio
import base64
import json
import tempfile
from pathlib import Path
from typing import Any

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _clamp_int, _make_json_safe
from browser_server.lifecycle import (
    _ensure_browser, _page_is_alive, _get_page_url, _get_page_title, _evaluate, _wait_for_selector,
)


async def handle_screenshot(req: web.Request) -> web.Response:
    body = await req.json() if req.content_length else {}

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            full_page = body.get("full_page", False)
            if hasattr(state._page, "screenshot"):
                screenshot_dir = Path(tempfile.gettempdir()) / "stuard-browser-screenshots"
                screenshot_dir.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(delete=False, suffix=".png", prefix="browser-", dir=str(screenshot_dir)) as tmp:
                    screenshot_path = Path(tmp.name)
                if "full_page" in str(state._page.screenshot):
                    raw_screenshot = await state._page.screenshot(full_page=full_page)
                else:
                    raw_screenshot = await state._page.screenshot()
                if isinstance(raw_screenshot, memoryview):
                    screenshot_bytes = raw_screenshot.tobytes()
                elif isinstance(raw_screenshot, (bytes, bytearray)):
                    screenshot_bytes = bytes(raw_screenshot)
                else:
                    raw_text = str(raw_screenshot or "").strip()
                    if raw_text.startswith("data:") and "," in raw_text:
                        raw_text = raw_text.split(",", 1)[1]
                    try:
                        screenshot_bytes = base64.b64decode(raw_text, validate=False)
                    except Exception as decode_error:
                        raise RuntimeError(f"Unsupported screenshot payload: {decode_error}")
                screenshot_path.write_bytes(screenshot_bytes)
            else:
                return _err("Screenshot not supported")
            include_base64 = body.get("include_base64", False)
            result = {
                "image_path": str(screenshot_path),
                "screenshot_path": str(screenshot_path),
                "format": "png",
                "url": await _get_page_url(),
                "width": int(await _evaluate("() => String(window.innerWidth || 0)") or "0"),
                "height": int(await _evaluate("() => String(window.innerHeight || 0)") or "0"),
            }
            if include_base64:
                result["base64"] = base64.b64encode(screenshot_bytes).decode("ascii")
            return _ok(result)
        except Exception as e:
            return _err(f"Screenshot failed: {e}")


async def handle_screenshot_mirror(req: web.Request) -> web.Response:
    """Fast screenshot endpoint for sidebar mirroring.

    Returns raw JPEG bytes with image/jpeg content-type for efficiency.
    Query params: quality (1-100, default 60), width (optional resize).

    This is a hot-path endpoint called every 500-1000ms by the sidebar.
    It does NOT acquire state._lock or call _ensure_browser() — the browser
    must already be running. This avoids lock contention that causes the
    headed window to shake/glitch.
    """
    quality = min(100, max(1, int(req.query.get("quality", "60"))))
    resize_width = int(req.query.get("width", "0")) or 0

    if state._page is None or not await _page_is_alive():
        return web.Response(status=503, text="Browser not running")

    try:
        if not hasattr(state._page, "screenshot"):
            return web.Response(status=503, text="Screenshot not supported")

        raw = await state._page.screenshot(type="jpeg", quality=quality)
        if isinstance(raw, memoryview):
            img_bytes = raw.tobytes()
        elif isinstance(raw, (bytes, bytearray)):
            img_bytes = bytes(raw)
        else:
            return web.Response(status=500, text="Unexpected screenshot format")

        if resize_width > 0:
            try:
                import io
                from PIL import Image
                img = Image.open(io.BytesIO(img_bytes))
                ratio = resize_width / img.width
                new_h = int(img.height * ratio)
                img = img.resize((resize_width, new_h), Image.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=quality)
                img_bytes = buf.getvalue()
            except ImportError:
                pass  # PIL not available, return original size

        url = await _get_page_url()
        title = await _get_page_title(timeout=0.3)

        # Cache viewport size — avoid JS eval on every poll
        vw = str(state._viewport_cache.get("w", 1280))
        vh = str(state._viewport_cache.get("h", 900))

        return web.Response(
            body=img_bytes,
            content_type="image/jpeg",
            headers={
                "X-Page-Url": url or "",
                "X-Page-Title": title or "",
                "X-Viewport-Width": vw,
                "X-Viewport-Height": vh,
                "Cache-Control": "no-cache, no-store",
            },
        )
    except Exception as e:
        return web.Response(status=500, text=f"Screenshot failed: {e}")


async def handle_click_at(req: web.Request) -> web.Response:
    """Click at specific x,y coordinates using Playwright mouse."""
    body = await _safe_json(req)
    x = body.get("x")
    y = body.get("y")
    if x is None or y is None:
        return _err("x and y are required")
    x = float(x)
    y = float(y)
    click_type = str(body.get("type", "click"))  # click, dblclick

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            mouse = getattr(state._page, "mouse", None)
            if mouse is None:
                return _err("Mouse not available")

            if click_type == "dblclick":
                await mouse.dblclick(x, y)
            else:
                await mouse.click(x, y)

            return _ok({"clicked_at": {"x": x, "y": y}, "type": click_type})
        except Exception as e:
            return _err(f"Click at coordinates failed: {e}")


async def handle_content(req: web.Request) -> web.Response:
    body = await _safe_json(req) if req.content_length else {}

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            mode = str(body.get("mode", "text")).strip().lower()
            if mode not in ("text", "html"):
                mode = "text"
            max_length = _clamp_int(body.get("max_length", 15000), 15000, 500, 200000)
            viewport_only = True
            selector = str(body.get("wait_for_selector") or "").strip()
            wait_timeout = _clamp_int(body.get("wait_timeout", 5000), 5000, 500, 60000)
            if selector:
                await _wait_for_selector(selector, timeout=wait_timeout)
            url = await _get_page_url()
            title = await _get_page_title()

            if mode == "html":
                content = await _evaluate(
                    """() => {
                      const vpW = window.innerWidth || document.documentElement.clientWidth;
                      const vpH = window.innerHeight || document.documentElement.clientHeight;

                      const NOISE = 'script, style, noscript, [hidden], [aria-hidden="true"], '
                        + 'nav, header, footer, .nav, .navbar, .header, .footer, .sidebar, '
                        + '.cookie-banner, .cookie-consent, .cookie-notice, [class*="cookie"], '
                        + '.ad, .ads, .advertisement, [class*="advert"], '
                        + '.popup, .modal-backdrop, .overlay, '
                        + '[role="navigation"], [role="banner"], [role="contentinfo"]';

                      const KEPT_ATTRS = new Set([
                        'action', 'alt', 'aria-current', 'aria-label', 'checked', 'datetime',
                        'disabled', 'for', 'href', 'method', 'name', 'placeholder', 'role',
                        'selected', 'src', 'title', 'type', 'value'
                      ]);
                      const VOID_LIKE = new Set([
                        'audio', 'button', 'canvas', 'iframe', 'img', 'input', 'option',
                        'path', 'picture', 'source', 'svg', 'textarea', 'video'
                      ]);

                      function inViewport(el) {
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 && r.height === 0) return false;
                        if (r.bottom < 0 || r.top > vpH) return false;
                        if (r.right < 0 || r.left > vpW) return false;
                        return true;
                      }

                      function shouldDrop(el) {
                        if (!(el instanceof Element)) return false;
                        if (el.matches(NOISE)) return true;
                        const s = window.getComputedStyle(el);
                        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity || '1') === 0) return true;
                        return !inViewport(el);
                      }

                      function sanitizeAttributes(original, cloned) {
                        if (!(original instanceof Element) || !(cloned instanceof Element)) return;
                        const isSvg = original.namespaceURI === 'http://www.w3.org/2000/svg';
                        if (isSvg) return;
                        for (const attr of Array.from(cloned.attributes)) {
                          if (!KEPT_ATTRS.has(attr.name.toLowerCase())) {
                            cloned.removeAttribute(attr.name);
                          }
                        }
                      }

                      const root =
                        document.querySelector('article') ||
                        document.querySelector('main') ||
                        document.querySelector('[role="main"]') ||
                        document.querySelector('#content') ||
                        document.querySelector('.content') ||
                        document.body ||
                        document.documentElement;
                      if (!root) return '';

                      const clone = root.cloneNode(true);

                      function prune(source, target) {
                        const sourceChildren = Array.from(source.childNodes);
                        for (let i = sourceChildren.length - 1; i >= 0; i -= 1) {
                          const sourceChild = sourceChildren[i];
                          const targetChild = target.childNodes[i];
                          if (!targetChild) continue;

                          if (sourceChild.nodeType === Node.ELEMENT_NODE) {
                            const sourceEl = sourceChild;
                            if (shouldDrop(sourceEl)) {
                              target.removeChild(targetChild);
                              continue;
                            }
                            if (!(targetChild instanceof Element)) {
                              target.removeChild(targetChild);
                              continue;
                            }
                            sanitizeAttributes(sourceEl, targetChild);
                            prune(sourceEl, targetChild);

                            const isSvg = sourceEl.namespaceURI === 'http://www.w3.org/2000/svg';
                            const hasElementChildren = targetChild.children.length > 0;
                            const hasMeaningfulText = !!(targetChild.textContent || '').replace(/\\u00a0/g, ' ').trim();
                            const tag = sourceEl.tagName.toLowerCase();
                            if (!isSvg && !hasElementChildren && !hasMeaningfulText && !VOID_LIKE.has(tag)) {
                              target.removeChild(targetChild);
                            }
                          } else if (sourceChild.nodeType === Node.TEXT_NODE) {
                            const rawText = (sourceChild.textContent || '').replace(/\\u00a0/g, ' ');
                            if (!rawText.trim()) {
                              target.removeChild(targetChild);
                            } else {
                              targetChild.textContent = rawText;
                            }
                          } else {
                            target.removeChild(targetChild);
                          }
                        }
                      }

                      sanitizeAttributes(root, clone);
                      prune(root, clone);

                      const html = root === document.body || root === document.documentElement
                        ? clone.innerHTML
                        : clone.outerHTML;

                      return html
                        .replace(/>\\s+</g, '><')
                        .replace(/\\n{3,}/g, '\\n\\n')
                        .trim();
                    }"""
                )
            else:
                viewport_only_js = "true" if viewport_only else "false"
                content = await _evaluate(
                    f"""() => {{
                      const VIEWPORT_ONLY = {viewport_only_js};
                      const vpW = window.innerWidth || document.documentElement.clientWidth;
                      const vpH = window.innerHeight || document.documentElement.clientHeight;

                      // Noise selectors to always strip
                      const NOISE = 'script, style, noscript, [hidden], [aria-hidden="true"], '
                        + 'nav, header, footer, .nav, .navbar, .header, .footer, .sidebar, '
                        + '.cookie-banner, .cookie-consent, .cookie-notice, [class*="cookie"], '
                        + '.ad, .ads, .advertisement, [class*="advert"], '
                        + '.popup, .modal-backdrop, .overlay, '
                        + '[role="navigation"], [role="banner"], [role="contentinfo"]';

                      const hidden = new Set();
                      document.querySelectorAll(NOISE).forEach(el => hidden.add(el));

                      // Check if an element is within the viewport
                      function inViewport(el) {{
                        if (!VIEWPORT_ONLY) return true;
                        const r = el.getBoundingClientRect();
                        // Element has no size — skip
                        if (r.width === 0 && r.height === 0) return false;
                        // Element is fully above or below viewport
                        if (r.bottom < 0 || r.top > vpH) return false;
                        // Element is fully left or right of viewport
                        if (r.right < 0 || r.left > vpW) return false;
                        return true;
                      }}

                      // Try semantic content areas first, fall back to body
                      const root =
                        document.querySelector('article') ||
                        document.querySelector('main') ||
                        document.querySelector('[role="main"]') ||
                        document.querySelector('#content') ||
                        document.querySelector('.content') ||
                        document.body ||
                        document.documentElement;
                      if (!root) return '';

                      const parts = [];
                      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {{
                        acceptNode: (node) => {{
                          if (hidden.has(node)) return NodeFilter.FILTER_REJECT;
                          let parent = node.parentElement;
                          while (parent) {{
                            if (hidden.has(parent)) return NodeFilter.FILTER_REJECT;
                            parent = parent.parentElement;
                          }}
                          if (node.nodeType === Node.ELEMENT_NODE) {{
                            const s = window.getComputedStyle(node);
                            if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return NodeFilter.FILTER_REJECT;
                            if (!inViewport(node)) return NodeFilter.FILTER_REJECT;
                          }}
                          return NodeFilter.FILTER_ACCEPT;
                        }}
                      }});

                      let node;
                      while (node = walker.nextNode()) {{
                        if (node.nodeType === Node.TEXT_NODE) {{
                          const text = node.textContent.replace(/\\u00a0/g, ' ').trim();
                          if (text) parts.push(text);
                        }} else if (node.nodeType === Node.ELEMENT_NODE) {{
                          const tag = node.tagName.toLowerCase();
                          if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {{
                            parts.push('\\n\\n### ' + (node.innerText || '').trim() + '\\n');
                          }} else if (tag === 'br' || tag === 'hr') {{
                            parts.push('\\n');
                          }} else if (['p','div','section','li','tr'].includes(tag)) {{
                            parts.push('\\n');
                          }}
                        }}
                      }}

                      return parts.join(' ').replace(/[ \\t]+/g, ' ').replace(/\\n{{3,}}/g, '\\n\\n').trim();
                    }}"""
                )

            return _ok({
                "url": url,
                "title": title,
                "content": str(content or "")[:max_length],
                "mode": mode,
            })
        except Exception as e:
            return _err(f"Content extraction failed: {e}")


async def handle_execute_script(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    script = str(body.get("script", "")).strip()
    if not script:
        return _err("script is required")
    if len(script) > 50000:
        return _err("script is too long")

    raw_args = body.get("args")
    if raw_args is None:
        script_args: dict[str, Any] = {}
    elif isinstance(raw_args, dict):
        script_args = raw_args
    else:
        return _err("args must be an object")

    wait_for_selector = str(body.get("wait_for_selector") or "").strip()
    wait_timeout = _clamp_int(body.get("wait_timeout", 5000), 5000, 250, 120000)
    timeout_ms = _clamp_int(body.get("timeout", 30000), 30000, 250, 300000)
    # Inline args as JSON so we don't need to pass them through evaluate().
    # Outer () => wrapper ensures evaluate() receives a proper function expression,
    # and the inner async IIFE preserves await support for user scripts.
    args_json = json.dumps(script_args, default=str)
    wrapped_script = (
        "() => {\n"
        "  const args = " + args_json + ";\n"
        "  return (async () => {\n"
        + script + "\n"
        "  })();\n"
        "}"
    )

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if wait_for_selector:
                found = await _wait_for_selector(wait_for_selector, timeout=wait_timeout)
                if not found:
                    return _err(f"Timed out waiting for selector: {wait_for_selector}")

            started_at = asyncio.get_event_loop().time()
            result = await asyncio.wait_for(
                _evaluate(wrapped_script),
                timeout=max(0.25, float(timeout_ms) / 1000.0),
            )
            elapsed_ms = int((asyncio.get_event_loop().time() - started_at) * 1000)
            return _ok({
                "result": _make_json_safe(result),
                "url": await _get_page_url(),
                "title": await _get_page_title(),
                "elapsedMs": elapsed_ms,
            })
        except asyncio.TimeoutError:
            return _err(f"Execute script timed out after {timeout_ms}ms")
        except Exception as e:
            return _err(f"Execute script failed: {e}")


async def handle_scroll(req: web.Request) -> web.Response:
    body = await req.json()
    direction = body.get("direction", "down")
    amount = body.get("amount", 500)
    selector = body.get("selector")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                await _evaluate(
                    """(sel, dir, amt) => {
                      const el = document.querySelector(sel);
                      if (!el) return 'not_found';
                      const delta = dir === 'down' ? amt : -amt;
                      if (dir === 'left' || dir === 'right') {
                        el.scrollBy({ left: dir === 'right' ? amt : -amt, top: 0, behavior: 'auto' });
                      } else {
                        el.scrollBy({ top: delta, left: 0, behavior: 'auto' });
                      }
                      return 'ok';
                    }""",
                    selector,
                    direction,
                    amount,
                )
            else:
                delta = amount if direction == "down" else -amount
                if direction in ("left", "right"):
                    await _evaluate(
                        "(dir, amt) => { window.scrollBy(dir === 'right' ? amt : -amt, 0); return 'ok'; }",
                        direction,
                        amount,
                    )
                else:
                    await _evaluate("(d) => { window.scrollBy(0, d); return 'ok'; }", delta)
            return _ok({"direction": direction, "amount": amount})
        except Exception as e:
            return _err(f"Scroll failed: {e}")
