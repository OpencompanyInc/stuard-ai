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
    _ensure_browser, _page_is_alive, _get_page_url, _get_page_title,
    _evaluate, _wait_for_selector, _capture_screenshot, _cdp_click_at,
)


async def handle_screenshot(req: web.Request) -> web.Response:
    body = await _safe_json(req) if req.content_length else {}

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            full_page = body.get("full_page", False)
            screenshot_dir = Path(tempfile.gettempdir()) / "stuard-browser-screenshots"
            screenshot_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(delete=False, suffix=".png", prefix="browser-", dir=str(screenshot_dir)) as tmp:
                screenshot_path = Path(tmp.name)
            screenshot_bytes = await _capture_screenshot("png", full_page=bool(full_page))
            screenshot_path.write_bytes(screenshot_bytes)
            include_base64 = body.get("include_base64", False)
            viewport = await _evaluate(
                """() => ({
                  w: Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0),
                  h: Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0),
                })"""
            )
            if isinstance(viewport, dict):
                state._viewport_cache["w"] = int(viewport.get("w", state._viewport_cache["w"]) or state._viewport_cache["w"])
                state._viewport_cache["h"] = int(viewport.get("h", state._viewport_cache["h"]) or state._viewport_cache["h"])
            result = {
                "image_path": str(screenshot_path),
                "screenshot_path": str(screenshot_path),
                "format": "png",
                "url": await _get_page_url(),
                "width": int(state._viewport_cache.get("w", 0)),
                "height": int(state._viewport_cache.get("h", 0)),
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
    It does NOT acquire state._lock or call _ensure_browser() - the browser
    must already be running. This avoids lock contention that causes the
    headed window to shake/glitch.
    """
    quality = min(100, max(1, int(req.query.get("quality", "60"))))
    resize_width = int(req.query.get("width", "0")) or 0

    if state._page is None or not await _page_is_alive():
        return web.Response(status=503, text="Browser not running")

    try:
        img_bytes = await _capture_screenshot("jpeg", quality=quality)

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
                pass

        url = await _get_page_url()
        title = await _get_page_title(timeout=0.3)

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
    """Click at specific x,y coordinates using CDP input events."""
    body = await _safe_json(req)
    x = body.get("x")
    y = body.get("y")
    if x is None or y is None:
        return _err("x and y are required")
    x = float(x)
    y = float(y)
    click_type = str(body.get("type", "click"))

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if click_type == "dblclick":
                await _cdp_click_at(x, y, click_count=1)
                await asyncio.sleep(0.05)
                await _cdp_click_at(x, y, click_count=2)
            else:
                await _cdp_click_at(x, y, click_count=1)

            return _ok({"clicked_at": {"x": x, "y": y}, "type": click_type})
        except Exception as e:
            return _err(f"Click at coordinates failed: {e}")


async def _get_page_viewport_metrics() -> dict[str, Any]:
    result = await _evaluate(
        """() => {
          const width = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
          const height = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0);
          const scrollX = Math.max(window.scrollX || window.pageXOffset || 0, 0);
          const scrollY = Math.max(window.scrollY || window.pageYOffset || 0, 0);
          const pageWidth = Math.max(
            document.documentElement?.scrollWidth || 0,
            document.body?.scrollWidth || 0,
            width
          );
          const pageHeight = Math.max(
            document.documentElement?.scrollHeight || 0,
            document.body?.scrollHeight || 0,
            height
          );
          const maxScrollY = Math.max(pageHeight - height, 0);
          const topRatio = maxScrollY > 0 ? Number((scrollY / maxScrollY).toFixed(4)) : 0;
          const bottomRatio = pageHeight > 0 ? Number((Math.min(scrollY + height, pageHeight) / pageHeight).toFixed(4)) : 1;
          return {
            width,
            height,
            scrollX,
            scrollY,
            pageWidth,
            pageHeight,
            topRatio,
            bottomRatio,
            atTop: scrollY <= 4,
            atBottom: scrollY + height >= pageHeight - 4,
          };
        }"""
    )
    if isinstance(result, dict):
        state._viewport_cache["w"] = int(result.get("width", state._viewport_cache["w"]) or state._viewport_cache["w"])
        state._viewport_cache["h"] = int(result.get("height", state._viewport_cache["h"]) or state._viewport_cache["h"])
        return _make_json_safe(result)
    return {}


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
            viewport_only = False if body.get("viewport_only", True) is False else True
            selector = str(body.get("wait_for_selector") or "").strip()
            wait_timeout = _clamp_int(body.get("wait_timeout", 5000), 5000, 500, 60000)
            if selector:
                await _wait_for_selector(selector, timeout=wait_timeout)

            url = await _get_page_url()
            title = await _get_page_title()
            viewport = await _get_page_viewport_metrics()
            block_count = None
            table_count = None

            if mode == "html":
                content = await _evaluate(
                    """(viewportOnly) => {
                      const VIEWPORT_ONLY = viewportOnly !== false;
                      const vpW = window.innerWidth || document.documentElement.clientWidth;
                      const vpH = window.innerHeight || document.documentElement.clientHeight;

                      const NOISE = 'script, style, noscript, [hidden], [aria-hidden="true"], '
                        + 'nav, header, footer, aside, .nav, .navbar, .header, .footer, .sidebar, '
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
                        if (!VIEWPORT_ONLY) return true;
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
                        if (original.namespaceURI === 'http://www.w3.org/2000/svg') return;
                        for (const attr of Array.from(cloned.attributes)) {
                          if (!KEPT_ATTRS.has(attr.name.toLowerCase())) cloned.removeAttribute(attr.name);
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
                            if (!rawText.trim()) target.removeChild(targetChild);
                            else targetChild.textContent = rawText;
                          } else {
                            target.removeChild(targetChild);
                          }
                        }
                      }

                      sanitizeAttributes(root, clone);
                      prune(root, clone);

                      let html = root === document.body || root === document.documentElement
                        ? clone.innerHTML
                        : clone.outerHTML;

                      // ── Iframe HTML extraction ──
                      try {
                        const __iframes = document.querySelectorAll('iframe');
                        for (const __iframe of __iframes) {
                          let __iDoc;
                          try {
                            __iDoc = __iframe.contentDocument;
                            if (!__iDoc) continue;
                            void __iDoc.documentElement;
                          } catch(e) { continue; }

                          const __ir = __iframe.getBoundingClientRect();
                          if (__ir.width < 10 || __ir.height < 10) continue;

                          const __iRoot = __iDoc.querySelector('article') || __iDoc.querySelector('main')
                            || __iDoc.querySelector('[role="main"]') || __iDoc.body;
                          if (!__iRoot) continue;

                          const __iClone = __iRoot.cloneNode(true);
                          // Light pruning of noise elements
                          __iClone.querySelectorAll(NOISE).forEach(n => n.remove());
                          const __iHtml = __iRoot === __iDoc.body ? __iClone.innerHTML : __iClone.outerHTML;
                          if (__iHtml && __iHtml.length > 20) {
                            html += '\\n<!-- iframe content -->\\n' + __iHtml;
                          }
                        }
                      } catch(e) {}

                      return html
                        .replace(/>\\s+</g, '><')
                        .replace(/\\n{3,}/g, '\\n\\n')
                        .trim();
                    }""",
                    viewport_only,
                )
            else:
                snapshot = await _evaluate(
                    """(viewportOnly) => {
                      const VIEWPORT_ONLY = viewportOnly !== false;
                      const MAX_BLOCKS = 120;
                      const MAX_TABLE_ROWS = 8;
                      const MAX_TABLE_COLS = 6;
                      const MAX_CELL_LENGTH = 80;
                      const BLOCK_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, code, figcaption, dt, dd, table, div, section, article';
                      const BLOCK_CHILD_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'pre', 'code', 'figcaption', 'dt', 'dd', 'table', 'div', 'section', 'article', 'ul', 'ol']);
                      const NOISE = 'script, style, noscript, [hidden], [aria-hidden="true"], '
                        + 'nav, header, footer, aside, .nav, .navbar, .header, .footer, .sidebar, '
                        + '.cookie-banner, .cookie-consent, .cookie-notice, [class*="cookie"], '
                        + '.ad, .ads, .advertisement, [class*="advert"], '
                        + '.popup, .modal-backdrop, .overlay, '
                        + '[role="navigation"], [role="banner"], [role="contentinfo"]';
                      const vpW = window.innerWidth || document.documentElement.clientWidth;
                      const vpH = window.innerHeight || document.documentElement.clientHeight;

                      function normalizeText(value, maxLen = 500) {
                        const text = String(value || '')
                          .replace(/\\u00a0/g, ' ')
                          .replace(/\\s+/g, ' ')
                          .trim();
                        if (!text) return '';
                        return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
                      }

                      function isVisible(el) {
                        if (!el || !el.getBoundingClientRect) return false;
                        const r = el.getBoundingClientRect();
                        const w = el.ownerDocument?.defaultView || window;
                        const s = w.getComputedStyle(el);
                        if (r.width === 0 && r.height === 0) return false;
                        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity || '1') === 0) return false;
                        return true;
                      }

                      function inViewport(el) {
                        if (!VIEWPORT_ONLY) return true;
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 && r.height === 0) return false;
                        if (r.bottom < 0 || r.top > vpH) return false;
                        if (r.right < 0 || r.left > vpW) return false;
                        return true;
                      }

                      function isNoise(el) {
                        if (!el || !el.matches) return false;
                        if (el.matches(NOISE)) return true;
                        return !!el.closest(NOISE);
                      }

                      function hasBlockChildren(el) {
                        return Array.from(el.children || []).some((child) => {
                          const tag = String(child?.tagName || '').toLowerCase();
                          return BLOCK_CHILD_TAGS.has(tag);
                        });
                      }

                      function clipCell(value) {
                        const text = normalizeText(value, MAX_CELL_LENGTH).replace(/\\|/g, '\\\\|');
                        return text || ' ';
                      }

                      function renderTable(table) {
                        if (!table || String(table.tagName || '').toLowerCase() !== 'table' || !isVisible(table) || !inViewport(table) || isNoise(table)) return '';
                        const rowEls = Array.from(table.querySelectorAll('tr')).filter((row) => isVisible(row) && inViewport(row));
                        if (rowEls.length === 0) return '';
                        const rawRows = rowEls
                          .map((row) => Array.from(row.children || []).map((cell) => clipCell(cell.innerText || cell.textContent || '')))
                          .filter((row) => row.some((cell) => cell && cell !== ' '));
                        if (rawRows.length === 0) return '';

                        const colCount = Math.max(1, Math.min(MAX_TABLE_COLS, Math.max(...rawRows.map((row) => row.length || 0))));
                        const firstRowHasHeaders = rowEls[0]
                          ? Array.from(rowEls[0].children || []).some((cell) => String(cell.tagName || '').toLowerCase() === 'th')
                          : false;
                        const header = firstRowHasHeaders
                          ? rawRows[0].slice(0, colCount)
                          : Array.from({ length: colCount }, (_, idx) => 'Column ' + (idx + 1));
                        while (header.length < colCount) header.push(' ');

                        const bodyRows = (firstRowHasHeaders ? rawRows.slice(1) : rawRows)
                          .slice(0, MAX_TABLE_ROWS)
                          .map((row) => {
                            const cells = row.slice(0, colCount);
                            while (cells.length < colCount) cells.push(' ');
                            return cells;
                          });

                        const caption = normalizeText(table.caption?.innerText || table.caption?.textContent || table.getAttribute('aria-label') || '', 120);
                        const lines = [];
                        if (caption) lines.push('Table: ' + caption);
                        lines.push('| ' + header.join(' | ') + ' |');
                        lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
                        bodyRows.forEach((row) => lines.push('| ' + row.join(' | ') + ' |'));
                        const remainingRows = Math.max(rawRows.length - (firstRowHasHeaders ? 1 : 0) - bodyRows.length, 0);
                        if (remainingRows > 0) lines.push('... ' + remainingRows + ' more row(s)');
                        return lines.join('\\n');
                      }

                      const root =
                        document.querySelector('article') ||
                        document.querySelector('main') ||
                        document.querySelector('[role="main"]') ||
                        document.querySelector('#content') ||
                        document.querySelector('.content') ||
                        document.body ||
                        document.documentElement;
                      if (!root) return { content: '', blockCount: 0, tableCount: 0 };

                      const blocks = [];
                      const seen = new Set();
                      let tableCount = 0;

                      for (const el of Array.from(root.querySelectorAll(BLOCK_SELECTOR))) {
                        if (blocks.length >= MAX_BLOCKS) break;
                        const tag = String(el.tagName || '').toLowerCase();
                        if (!tag || !isVisible(el) || !inViewport(el) || isNoise(el)) continue;
                        if (tag !== 'table' && el.closest('table')) continue;
                        if (['div', 'section', 'article'].includes(tag) && hasBlockChildren(el)) continue;
                        if (['button', 'input', 'textarea', 'select', 'option'].includes(tag)) continue;

                        let text = '';
                        if (tag === 'table') {
                          text = renderTable(el);
                          if (!text) continue;
                          tableCount += 1;
                        } else {
                          text = normalizeText(el.innerText || el.textContent || '', ['pre', 'code'].includes(tag) ? 800 : 400);
                          if (!text) continue;
                          if (['div', 'section', 'article'].includes(tag) && text.length < 24) continue;
                          if (/^h[1-6]$/.test(tag)) text = '#'.repeat(Number(tag.slice(1))) + ' ' + text;
                          else if (tag === 'li') text = '- ' + text;
                          else if (tag === 'blockquote') text = '> ' + text;
                          else if (tag === 'pre' || tag === 'code') text = '```\\n' + text + '\\n```';
                        }

                        const key = text.toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        blocks.push(text);
                      }

                      if (blocks.length === 0) {
                        const fallback = normalizeText(root.innerText || root.textContent || '', 4000);
                        if (fallback) blocks.push(fallback);
                      }

                      // ── Iframe content extraction ──
                      try {
                        const __iframes = document.querySelectorAll('iframe');
                        for (const __iframe of __iframes) {
                          if (blocks.length >= MAX_BLOCKS) break;
                          let __iDoc, __iWin;
                          try {
                            __iDoc = __iframe.contentDocument;
                            __iWin = __iframe.contentWindow;
                            if (!__iDoc || !__iWin) continue;
                            void __iDoc.documentElement;
                          } catch(e) { continue; }

                          const __ir = __iframe.getBoundingClientRect();
                          if (__ir.width < 10 || __ir.height < 10) continue;
                          try {
                            const __is = window.getComputedStyle(__iframe);
                            if (__is.display === 'none' || __is.visibility === 'hidden') continue;
                          } catch(e) { continue; }

                          if (VIEWPORT_ONLY && (__ir.bottom < 0 || __ir.top > vpH || __ir.right < 0 || __ir.left > vpW)) continue;

                          const __iRoot = __iDoc.querySelector('article') || __iDoc.querySelector('main')
                            || __iDoc.querySelector('[role="main"]') || __iDoc.querySelector('#content')
                            || __iDoc.querySelector('.content') || __iDoc.body;
                          if (!__iRoot) continue;

                          const blocksBefore = blocks.length;

                          for (const el of Array.from(__iRoot.querySelectorAll(BLOCK_SELECTOR))) {
                            if (blocks.length >= MAX_BLOCKS) break;
                            const tag = String(el.tagName || '').toLowerCase();
                            if (!tag) continue;
                            try {
                              const __s = __iWin.getComputedStyle(el);
                              if (__s.display === 'none' || __s.visibility === 'hidden') continue;
                            } catch(e) { continue; }
                            try { if (el.matches(NOISE) || el.closest(NOISE)) continue; } catch(e) {}
                            if (tag !== 'table' && el.closest('table')) continue;
                            if (['div', 'section', 'article'].includes(tag) && hasBlockChildren(el)) continue;
                            if (['button', 'input', 'textarea', 'select', 'option'].includes(tag)) continue;

                            let text = '';
                            if (tag === 'table') {
                              text = renderTable(el);
                              if (!text) continue;
                              tableCount += 1;
                            } else {
                              text = normalizeText(el.innerText || el.textContent || '', ['pre', 'code'].includes(tag) ? 800 : 400);
                              if (!text) continue;
                              if (['div', 'section', 'article'].includes(tag) && text.length < 24) continue;
                              if (/^h[1-6]$/.test(tag)) text = '#'.repeat(Number(tag.slice(1))) + ' ' + text;
                              else if (tag === 'li') text = '- ' + text;
                              else if (tag === 'blockquote') text = '> ' + text;
                              else if (tag === 'pre' || tag === 'code') text = '```\\n' + text + '\\n```';
                            }

                            const key = text.toLowerCase();
                            if (seen.has(key)) continue;
                            seen.add(key);
                            blocks.push(text);
                          }

                          if (blocks.length === blocksBefore) {
                            const __fallback = normalizeText(__iRoot.innerText || __iRoot.textContent || '', 4000);
                            if (__fallback && __fallback.length > 20) {
                              const key = __fallback.toLowerCase().slice(0, 200);
                              if (!seen.has(key)) {
                                seen.add(key);
                                blocks.push(__fallback);
                              }
                            }
                          }
                        }
                      } catch(e) {}

                      return {
                        content: blocks.join('\\n\\n').replace(/\\n{3,}/g, '\\n\\n').trim(),
                        blockCount: blocks.length,
                        tableCount,
                      };
                    }""",
                    viewport_only,
                )
                if isinstance(snapshot, dict):
                    content = snapshot.get("content", "")
                    block_count = int(snapshot.get("blockCount", 0) or 0)
                    table_count = int(snapshot.get("tableCount", 0) or 0)
                else:
                    content = snapshot

            content_text = str(content or "")
            return _ok({
                "url": url,
                "title": title,
                "content": content_text[:max_length],
                "contentLength": len(content_text),
                "mode": mode,
                "scanScope": "viewport" if viewport_only else "page",
                "viewport": viewport,
                "blockCount": block_count,
                "tableCount": table_count,
                "truncated": len(content_text) > max_length,
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
    body = await _safe_json(req)
    direction = body.get("direction", "down")
    amount = body.get("amount", 500)
    selector = body.get("selector")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                result = await _evaluate(
                    """([sel, dir, amt]) => {
                      const el = document.querySelector(sel);
                      if (!el) return { status: 'not_found' };
                      const delta = dir === 'down' ? amt : -amt;
                      if (dir === 'left' || dir === 'right') {
                        el.scrollBy({ left: dir === 'right' ? amt : -amt, top: 0, behavior: 'auto' });
                      } else {
                        el.scrollBy({ top: delta, left: 0, behavior: 'auto' });
                      }
                      return {
                        status: 'ok',
                        scrollTop: Math.max(el.scrollTop || 0, 0),
                        scrollLeft: Math.max(el.scrollLeft || 0, 0),
                        scrollHeight: Math.max(el.scrollHeight || 0, el.clientHeight || 0),
                        scrollWidth: Math.max(el.scrollWidth || 0, el.clientWidth || 0),
                        clientHeight: Math.max(el.clientHeight || 0, 0),
                        clientWidth: Math.max(el.clientWidth || 0, 0),
                        atTop: (el.scrollTop || 0) <= 4,
                        atBottom: (el.scrollTop || 0) + (el.clientHeight || 0) >= (el.scrollHeight || 0) - 4,
                      };
                    }""",
                    selector,
                    direction,
                    amount,
                )
                if not isinstance(result, dict) or result.get("status") != "ok":
                    return _err(f"Scroll failed: selector not found: {selector}")
                return _ok({
                    "direction": direction,
                    "amount": amount,
                    "target": "element",
                    "selector": selector,
                    "container": _make_json_safe({k: v for k, v in result.items() if k != "status"}),
                })

            delta = amount if direction == "down" else -amount
            if direction in ("left", "right"):
                await _evaluate(
                    "([dir, amt]) => { window.scrollBy(dir === 'right' ? amt : -amt, 0); return 'ok'; }",
                    direction,
                    amount,
                )
            else:
                await _evaluate("(d) => { window.scrollBy(0, d); return 'ok'; }", delta)

            return _ok({
                "direction": direction,
                "amount": amount,
                "target": "page",
                "viewport": await _get_page_viewport_metrics(),
            })
        except Exception as e:
            return _err(f"Scroll failed: {e}")
