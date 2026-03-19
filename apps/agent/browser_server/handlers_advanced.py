import asyncio
from pathlib import Path
from typing import Any

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _clamp_int
from browser_server.lifecycle import (
    _ensure_browser, _get_page_url, _get_page_title,
    _find_elements, _evaluate, _wait_for_selector, _smart_wait_for_element,
    _close_browser,
)


async def _cdp_click_element_by_selector(selector: str) -> bool:
    """Click an element by CSS selector using CDP mouse events.

    Uses JS to find the element and get its bounding rect, then dispatches
    real CDP Input.dispatchMouseEvent at the element's center coordinates.
    Falls back to JS el.click() if coordinate-based click fails.
    """
    coords = await _evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return null;
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }""",
        selector,
    )
    if isinstance(coords, dict) and "x" in coords and "y" in coords:
        x, y = float(coords["x"]), float(coords["y"])
        # Use the browser-use page's mouse if available (CDP mouse events)
        page = state._page
        # Try CDP client directly (works with browser-use pages)
        if page and hasattr(page, "_client") and hasattr(page, "_ensure_session"):
            try:
                sid = await page._ensure_session()
                client = page._client
                await client.send.Input.dispatchMouseEvent(
                    {"type": "mouseMoved", "x": int(x), "y": int(y)}, session_id=sid)
                await asyncio.sleep(0.02)
                await client.send.Input.dispatchMouseEvent(
                    {"type": "mousePressed", "x": int(x), "y": int(y), "button": "left", "clickCount": 1},
                    session_id=sid)
                await asyncio.sleep(0.05)
                await client.send.Input.dispatchMouseEvent(
                    {"type": "mouseReleased", "x": int(x), "y": int(y), "button": "left", "clickCount": 1},
                    session_id=sid)
                await asyncio.sleep(0.05)
                return True
            except Exception:
                pass
    # Last resort: JS click
    result = await _evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          if (el) { el.click(); return true; }
          return false;
        }""",
        selector,
    )
    return result is True or result == "true"


async def _cdp_type_text(text: str) -> bool:
    """Type text character-by-character using CDP Input.dispatchKeyEvent.

    Works with whatever element currently has focus.
    """
    page = state._page
    if page is None:
        return False

    # Use CDP client directly if available (browser-use Page)
    if hasattr(page, "_client") and hasattr(page, "_ensure_session"):
        try:
            sid = await page._ensure_session()
            client = page._client
            for char in text:
                if char == "\n":
                    await client.send.Input.dispatchKeyEvent(
                        {"type": "keyDown", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
                        session_id=sid)
                    await asyncio.sleep(0.001)
                    await client.send.Input.dispatchKeyEvent(
                        {"type": "char", "text": "\r", "key": "Enter"}, session_id=sid)
                    await client.send.Input.dispatchKeyEvent(
                        {"type": "keyUp", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
                        session_id=sid)
                else:
                    await client.send.Input.dispatchKeyEvent(
                        {"type": "keyDown", "key": char, "code": f"Key{char.upper()}" if char.isalpha() else char},
                        session_id=sid)
                    await asyncio.sleep(0.001)
                    await client.send.Input.dispatchKeyEvent(
                        {"type": "char", "text": char, "key": char}, session_id=sid)
                    await client.send.Input.dispatchKeyEvent(
                        {"type": "keyUp", "key": char, "code": f"Key{char.upper()}" if char.isalpha() else char},
                        session_id=sid)
                await asyncio.sleep(0.03)
            return True
        except Exception:
            pass

    # Fallback: use page.press if available (browser-use Page has this)
    if hasattr(page, "press"):
        try:
            for char in text:
                await page.press(char)
                await asyncio.sleep(0.03)
            return True
        except Exception:
            pass

    return False


async def _cdp_clear_and_type(selector: str, text: str) -> bool:
    """Click an input, clear it, and type new text character-by-character."""
    # Click to focus
    await _cdp_click_element_by_selector(selector)
    await asyncio.sleep(0.1)

    # Select all + delete to clear
    page = state._page
    if page and hasattr(page, "press"):
        try:
            await page.press("Control+a")
            await asyncio.sleep(0.02)
            await page.press("Backspace")
            await asyncio.sleep(0.05)
        except Exception:
            # Fallback: JS clear
            await _evaluate(
                """(sel) => {
                  const el = document.querySelector(sel);
                  if (el && 'value' in el) { el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true})); }
                }""",
                selector,
            )
    else:
        await _evaluate(
            """(sel) => {
              const el = document.querySelector(sel);
              if (el && 'value' in el) { el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true})); }
            }""",
            selector,
        )

    # Type character-by-character (triggers framework filtering)
    return await _cdp_type_text(text)


async def _searchable_combobox_select(
    selector: str,
    search_text: str,
    value: Any = None,
    label: Any = None,
    index: Any = None,
    timeout: int = 5000,
) -> dict[str, Any]:
    """Handle searchable combobox/autocomplete dropdowns.

    Strategy:
    1. Click the input to focus and possibly open the dropdown
    2. Clear existing text and type the search term character-by-character
       (many frameworks filter on each keystroke)
    3. Wait for option nodes to appear
    4. Find the best matching option and click it via CDP mouse events
    """
    MARKER_ATTR = "data-stuard-select-target"

    # 1. Click to focus and open dropdown, then clear and type
    typed = await _cdp_clear_and_type(selector, search_text)
    if not typed:
        return {"status": "error", "detail": "Failed to type search text"}

    # 2. Wait for options to appear and find match
    desired_value = str(value) if value is not None else None
    desired_label = str(label).strip().lower() if label is not None else search_text.strip().lower()
    desired_index = int(index) if index is not None else None

    deadline = asyncio.get_event_loop().time() + (timeout / 1000.0)
    last_options: list[dict] = []

    while asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(0.3)

        # Scan for visible option nodes, mark the match, and get its coordinates
        scan_result = await _evaluate(
            """(sel, desiredVal, desiredLbl, desiredIdx, markerAttr) => {
              document.querySelectorAll('[' + markerAttr + ']').forEach(el => el.removeAttribute(markerAttr));
              const control = document.querySelector(sel);
              if (!control) return { found: false, options: [] };

              function isVisible(el) {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                const s = window.getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
              }
              function textOf(el) {
                return [el?.innerText, el?.textContent, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title'), el?.getAttribute?.('data-value'), el?.getAttribute?.('value')].filter(Boolean).map(p => String(p).trim()).find(Boolean) || '';
              }
              function valueOf(el) {
                if (!el) return '';
                if ('value' in el && el.value) return String(el.value);
                return String(el.getAttribute('data-value') || el.getAttribute('value') || el.getAttribute('aria-valuetext') || '').trim();
              }

              const controlsId = control.getAttribute('aria-controls') || control.getAttribute('aria-owns') || '';
              let popup = controlsId ? document.getElementById(controlsId) : null;
              if (!popup) { popup = control.closest('[role="combobox"], [data-headlessui-state], [data-radix-popper-content-wrapper]'); if (popup === control) popup = null; }
              if (!popup) popup = control.parentElement?.querySelector?.('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state]');
              if (!popup) {
                const candidates = document.querySelectorAll('[role="listbox"], [role="menu"], [role="tree"], [data-radix-popper-content-wrapper], [data-headlessui-state], [class*="menu-list"], [class*="listbox"], [class*="select-menu"], [id*="listbox"], [id*="react-select"]');
                for (const c of candidates) { if (isVisible(c)) { popup = c; break; } }
              }

              const scopes = popup ? [popup] : [document];
              const optSel = '[role="option"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="listbox"] [data-value], [role="menu"] [data-value], [aria-selected], option, li';
              const seen = new Set();
              const options = [];
              for (const scope of scopes) {
                for (const candidate of Array.from(scope.querySelectorAll(optSel))) {
                  if (seen.has(candidate) || candidate === control) continue;
                  seen.add(candidate);
                  const text = textOf(candidate);
                  const val = valueOf(candidate);
                  if (!isVisible(candidate) || (!text && !val)) continue;
                  options.push({ text, value: val || text, el: candidate });
                }
                if (options.length > 0) break;
              }

              let matchIdx = -1;
              if (desiredVal !== null) {
                matchIdx = options.findIndex(o => o.value === desiredVal || o.text === desiredVal);
              }
              if (matchIdx < 0 && desiredLbl) {
                matchIdx = options.findIndex(o => o.text.toLowerCase() === desiredLbl);
                if (matchIdx < 0) matchIdx = options.findIndex(o => o.text.toLowerCase().includes(desiredLbl) || o.value.toLowerCase().includes(desiredLbl));
              }
              if (matchIdx < 0 && desiredIdx !== null && desiredIdx >= 0 && desiredIdx < options.length) {
                matchIdx = desiredIdx;
              }

              if (matchIdx < 0) {
                return { found: false, options: options.map(o => ({ text: o.text, value: o.value })).slice(0, 30), optionCount: options.length };
              }

              const match = options[matchIdx].el;
              match.setAttribute(markerAttr, 'true');
              match.scrollIntoView({ block: 'center', inline: 'center' });
              const r = match.getBoundingClientRect();
              return {
                found: true,
                matchIdx,
                text: textOf(match),
                selected: valueOf(match) || textOf(match),
                clickX: r.left + r.width / 2,
                clickY: r.top + r.height / 2,
                options: options.map(o => ({ text: o.text, value: o.value })).slice(0, 30),
                optionCount: options.length,
              };
            }""",
            selector,
            desired_value,
            desired_label,
            desired_index,
            MARKER_ATTR,
        )

        if not isinstance(scan_result, dict):
            continue

        last_options = scan_result.get("options", [])

        if scan_result.get("found"):
            # Click the matched option — try CDP coordinates first, then marker selector, then JS
            clicked = await _cdp_click_element_by_selector(f"[{MARKER_ATTR}]")
            if not clicked:
                await _evaluate(f"""() => {{ const el = document.querySelector('[{MARKER_ATTR}]'); if (el) el.click(); }}""")

            # Clean up marker
            await _evaluate(f"""() => {{ document.querySelectorAll('[{MARKER_ATTR}]').forEach(el => el.removeAttribute('{MARKER_ATTR}')); }}""")
            return {
                "status": "ok",
                "selected": scan_result.get("selected", ""),
                "text": scan_result.get("text", ""),
                "method": "searchable_combobox",
            }

        if scan_result.get("optionCount", 0) > 0:
            continue

    return {
        "status": "no_match",
        "detail": f"No matching option found for search '{search_text}' in searchable dropdown",
        "options": last_options[:20],
        "method": "searchable_combobox",
    }


async def _select_dropdown(selector: str, value: Any = None, label: Any = None, index: Any = None, timeout: int = 5000, search: str | None = None) -> dict[str, Any]:
    """Select an option from a dropdown (native <select>, custom dropdown, or searchable combobox).

    Works with CDP (browser-use) and Playwright pages alike.
    """
    # Check if it's a searchable combobox — route to specialized handler
    search_text = search or (str(label) if label is not None else None) or (str(value) if value is not None else None)
    if search_text:
        try:
            el_info = await _evaluate(
                """(sel) => {
                  const el = document.querySelector(sel);
                  if (!el) return null;
                  return {
                    tag: (el.tagName || '').toLowerCase(),
                    role: el.getAttribute('role') || '',
                    haspopup: el.getAttribute('aria-haspopup') || '',
                    type: (el.getAttribute('type') || '').toLowerCase(),
                  };
                }""",
                selector,
            )
            if isinstance(el_info, dict):
                is_searchable = (
                    el_info.get("tag") == "input" and el_info.get("type") not in ("checkbox", "radio", "file", "hidden")
                ) or el_info.get("role") == "combobox" or el_info.get("role") == "searchbox"

                if is_searchable:
                    result = await _searchable_combobox_select(selector, search_text, value, label, index, timeout)
                    if result.get("status") == "ok":
                        return result
        except Exception:
            pass

    # -- Generic dropdown path --
    MARKER_ATTR = "data-stuard-select-target"

    # Step 1: Open the dropdown via CDP click
    await _cdp_click_element_by_selector(selector)
    await asyncio.sleep(0.2)

    # Step 2: Poll for the matching option via JS — mark it and get its coordinates
    deadline = asyncio.get_event_loop().time() + (timeout / 1000.0)
    last_scan: dict[str, Any] = {}

    while asyncio.get_event_loop().time() < deadline:
        scan = await _evaluate(
            """(sel, val, lbl, idx, markerAttr) => {
              document.querySelectorAll('[' + markerAttr + ']').forEach(el => el.removeAttribute(markerAttr));
              const control = document.querySelector(sel);
              if (!control) return { status: 'not_found', detail: 'Selector not found: ' + sel };

              const desiredValue = val == null ? null : String(val);
              const desiredLabel = lbl == null ? '' : String(lbl).trim().toLowerCase();
              const desiredIndex = idx == null || Number.isNaN(Number(idx)) ? null : Number(idx);

              function isVisible(el) {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                const s = window.getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
              }
              function textOf(el) {
                return [el?.innerText, el?.textContent, el?.getAttribute?.('aria-label'), el?.getAttribute?.('title'), el?.getAttribute?.('data-value'), el?.getAttribute?.('value')]
                  .filter(Boolean).map(p => String(p).trim()).find(Boolean) || '';
              }
              function valueOf(el) {
                if (!el) return '';
                if ('value' in el && el.value) return String(el.value);
                return String(el.getAttribute('data-value') || el.getAttribute('value') || el.getAttribute('aria-valuetext') || '').trim();
              }

              // Handle native <select>
              if ((control.tagName || '').toLowerCase() === 'select') {
                let matchedIdx = -1;
                for (let i = 0; i < control.options.length; i++) {
                  const opt = control.options[i];
                  if (desiredValue !== null && opt.value === desiredValue) { matchedIdx = i; break; }
                  if (desiredLabel && (opt.text || '').trim().toLowerCase().includes(desiredLabel)) { matchedIdx = i; break; }
                  if (desiredIndex !== null && i === desiredIndex) { matchedIdx = i; break; }
                }
                if (matchedIdx < 0) return { status: 'no_match', detail: 'No matching <select> option' };
                control.selectedIndex = matchedIdx;
                control.dispatchEvent(new Event('input', { bubbles: true }));
                control.dispatchEvent(new Event('change', { bubbles: true }));
                const so = control.options[matchedIdx];
                return { status: 'ok', selected: control.value || '', text: so ? (so.text || '').trim() : '', method: 'js_select' };
              }

              function findPopup(el) {
                const cid = el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '';
                if (cid) { const p = document.getElementById(cid); if (p) return p; }
                const within = el.closest('[role="combobox"], [role="listbox"], [data-headlessui-state], [data-radix-popper-content-wrapper]');
                if (within && within !== el) return within;
                const sib = el.parentElement?.querySelector?.('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state]');
                if (sib) return sib;
                const portaled = document.querySelectorAll('[role="listbox"], [role="menu"], [role="tree"], [data-radix-popper-content-wrapper], [data-headlessui-state], [class*="menu-list"], [class*="listbox"], [class*="dropdown-menu"], [class*="select-menu"], [class*="options"], [id*="listbox"], [id*="react-select"]');
                for (const c of portaled) { if (isVisible(c)) return c; }
                return null;
              }

              const popup = findPopup(control);
              const scopes = popup ? [popup] : [document];
              const optSel = '[role="option"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="listbox"] [data-value], [role="menu"] [data-value], [aria-selected], option';
              const seen = new Set();
              let options = [];
              for (const scope of scopes) {
                for (const c of Array.from(scope.querySelectorAll(optSel))) {
                  if (seen.has(c) || c === control) continue;
                  seen.add(c);
                  if (!isVisible(c)) continue;
                  const t = textOf(c); const v = valueOf(c);
                  if (!t && !v) continue;
                  options.push(c);
                }
                if (options.length > 0) break;
              }
              if (options.length === 0 && popup) {
                for (const li of Array.from(popup.querySelectorAll('li'))) {
                  if (!isVisible(li)) continue;
                  if (textOf(li)) options.push(li);
                }
              }

              if (options.length === 0) {
                return { status: 'waiting', detail: 'No visible options yet', optionCount: 0, options: [] };
              }

              let match = null;
              if (desiredValue !== null) {
                match = options.find(o => valueOf(o) === desiredValue || textOf(o) === desiredValue);
              }
              if (!match && desiredLabel) {
                match = options.find(o => textOf(o).toLowerCase() === desiredLabel);
                if (!match) match = options.find(o => textOf(o).toLowerCase().includes(desiredLabel) || valueOf(o).toLowerCase().includes(desiredLabel));
              }
              if (!match && desiredIndex !== null && desiredIndex >= 0 && desiredIndex < options.length) {
                match = options[desiredIndex];
              }

              if (!match) {
                return {
                  status: 'no_match',
                  detail: 'Options visible but no match found',
                  optionCount: options.length,
                  options: options.slice(0, 20).map(o => ({ text: textOf(o), value: valueOf(o) })),
                };
              }

              match.setAttribute(markerAttr, 'true');
              match.scrollIntoView({ block: 'center', inline: 'center' });
              const r = match.getBoundingClientRect();
              return {
                status: 'matched',
                text: textOf(match),
                selected: valueOf(match) || textOf(match),
                optionCount: options.length,
                clickX: r.left + r.width / 2,
                clickY: r.top + r.height / 2,
              };
            }""",
            selector,
            value,
            label,
            index,
            MARKER_ATTR,
        )

        if not isinstance(scan, dict):
            await asyncio.sleep(0.2)
            continue

        last_scan = scan
        status = scan.get("status", "")

        if status == "ok":
            return scan

        if status == "matched":
            # Click the matched option — try CDP coordinates first, then JS
            clicked = await _cdp_click_element_by_selector(f"[{MARKER_ATTR}]")
            if not clicked:
                await _evaluate(f"""() => {{ const el = document.querySelector('[{MARKER_ATTR}]'); if (el) el.click(); }}""")

            await _evaluate(f"""() => {{ document.querySelectorAll('[{MARKER_ATTR}]').forEach(el => el.removeAttribute('{MARKER_ATTR}')); }}""")
            return {
                "status": "ok",
                "selected": scan.get("selected", ""),
                "text": scan.get("text", ""),
                "method": "cdp_custom_dropdown",
            }

        if status == "not_found":
            return scan
        if status == "no_match":
            return scan

        await asyncio.sleep(0.25)

    return last_scan if last_scan else {"status": "no_match", "detail": "Timed out waiting for dropdown options"}


async def _upload_local_file(selector: str, file_path: str, timeout: int = 5000) -> dict[str, Any]:
    """Upload a file to a file input using CDP DOM.setFileInputFiles.

    Works with both browser-use (CDP) and Playwright pages.
    Strategy:
    1. Find the <input type="file"> element (via selector, or by searching nearby)
    2. Use CDP DOM.setFileInputFiles to set the file directly (no file dialog needed)
    3. Dispatch change event so frameworks detect the upload
    """
    raw_path = str(file_path or "").strip()
    if not raw_path:
        raise ValueError("file_path is required")

    resolved_path = Path(raw_path).expanduser()
    if not resolved_path.is_absolute():
        resolved_path = resolved_path.resolve()
    if not resolved_path.exists() or not resolved_path.is_file():
        raise FileNotFoundError(f"Local file not found: {resolved_path}")

    # Use forward slashes for CDP (works cross-platform)
    file_path_str = str(resolved_path).replace("\\", "/")

    # Find the file input element and get its backendNodeId
    find_result = await _evaluate(
        """(sel) => {
          function isFileInput(el) {
            return !!el && el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'file';
          }
          function isVisible(el) {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
          }
          function labelFor(el) {
            if (!el) return '';
            if (el.id) {
              const forLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
              if (forLabel) return (forLabel.innerText || forLabel.textContent || '').trim();
            }
            const parentLabel = el.closest('label');
            if (parentLabel) return (parentLabel.innerText || parentLabel.textContent || '').trim();
            return String(el.getAttribute('aria-label') || '').trim();
          }
          function findInput(target) {
            if (!target) return null;
            if (isFileInput(target)) return target;
            if (target.tagName === 'LABEL') {
              const forId = target.getAttribute('for') || '';
              if (forId) { const direct = document.getElementById(forId); if (isFileInput(direct)) return direct; }
            }
            const nested = target.querySelector?.('input[type="file"]');
            if (isFileInput(nested)) return nested;
            const labelAncestor = target.closest?.('label');
            if (isFileInput(labelAncestor?.querySelector?.('input[type="file"]'))) return labelAncestor.querySelector('input[type="file"]');
            const form = target.closest?.('form');
            if (isFileInput(form?.querySelector?.('input[type="file"]'))) return form.querySelector('input[type="file"]');
            const sibling = target.parentElement?.querySelector?.('input[type="file"]');
            if (isFileInput(sibling)) return sibling;
            return null;
          }

          const directTarget = sel ? document.querySelector(sel) : null;
          let input = findInput(directTarget);
          if (!input) {
            const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
            input = allInputs.find(c => isVisible(c)) || allInputs[0] || null;
          }
          if (!input) return { status: 'not_found', detail: 'No file input found on the page' };

          // Mark it with a unique attribute so we can find it via CDP
          const marker = 'stuard-upload-' + Date.now();
          input.setAttribute('data-stuard-upload-target', marker);
          return {
            status: 'ok',
            marker: marker,
            label: labelFor(input),
            accept: input.accept || '',
            multiple: !!input.multiple,
            hidden: !isVisible(input),
          };
        }""",
        selector or "",
    )

    if not isinstance(find_result, dict) or find_result.get("status") != "ok":
        detail = find_result.get("detail", "File input not found") if isinstance(find_result, dict) else str(find_result)
        raise RuntimeError(detail)

    marker = find_result.get("marker", "")
    file_input_sel = f'input[type="file"][data-stuard-upload-target="{marker}"]'

    # Try CDP DOM.setFileInputFiles (works with browser-use CDP pages)
    page = state._page
    upload_success = False

    if page and hasattr(page, "_client") and hasattr(page, "_ensure_session"):
        try:
            sid = await page._ensure_session()
            client = page._client

            # Get the backendNodeId of the file input via CDP
            # First, get the document root
            doc_result = await client.send.DOM.getDocument(
                {"depth": 0}, session_id=sid)
            root_id = doc_result["root"]["nodeId"]

            # Find the file input by selector
            query_result = await client.send.DOM.querySelector(
                {"nodeId": root_id, "selector": file_input_sel}, session_id=sid)
            file_node_id = query_result.get("nodeId", 0)

            if file_node_id:
                # Get backendNodeId
                desc_result = await client.send.DOM.describeNode(
                    {"nodeId": file_node_id}, session_id=sid)
                backend_node_id = desc_result["node"]["backendNodeId"]

                # Set the files using CDP
                await client.send.DOM.setFileInputFiles(
                    {"files": [file_path_str], "backendNodeId": backend_node_id},
                    session_id=sid,
                )
                upload_success = True
        except Exception as cdp_err:
            print(f"[browser-use-server] CDP file upload failed: {cdp_err}", flush=True)

    # Fallback: use browser-use Element API if available
    if not upload_success and page and hasattr(page, "get_elements_by_css_selector"):
        try:
            elements = await page.get_elements_by_css_selector(file_input_sel)
            if elements:
                el = elements[0]
                # Try to set files via JS (limited but may work for some sites)
                await el.evaluate(
                    """(filePath) => {
                      const dt = new DataTransfer();
                      // We can't create real File objects from paths in JS, but we trigger the change event
                      this.dispatchEvent(new Event('change', { bubbles: true }));
                    }""",
                    file_path_str,
                )
        except Exception:
            pass

    # Fallback: try Playwright-style set_input_files if the page supports it
    if not upload_success and page and hasattr(page, "locator"):
        try:
            locator = page.locator(file_input_sel).first
            await locator.set_input_files(str(resolved_path), timeout=timeout)
            upload_success = True
        except Exception:
            pass

    if not upload_success:
        raise RuntimeError("File upload failed: could not set files via CDP or Playwright")

    # Dispatch change event to notify frameworks
    await _evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }""",
        file_input_sel,
    )

    # Clean up marker
    await _evaluate(
        """(sel) => {
          const el = document.querySelector(sel);
          if (el) el.removeAttribute('data-stuard-upload-target');
        }""",
        file_input_sel,
    )

    return {
        "uploaded": True,
        "filePath": str(resolved_path),
        "fileName": resolved_path.name,
        "selector": selector or file_input_sel,
        "accept": str(find_result.get("accept") or ""),
        "multiple": bool(find_result.get("multiple", False)),
        "hidden": bool(find_result.get("hidden", False)),
        "label": str(find_result.get("label") or ""),
        "method": "cdp_set_file_input_files",
    }


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
    search = body.get("search")
    if isinstance(search, str):
        search = search.strip() or None
    else:
        search = None
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not selector:
        return _err("selector is required for select_option")
    if value is None and label is None and index is None and search is None:
        return _err("One of value, label, index, or search is required")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            result = await _select_dropdown(selector, value=value, label=label, index=index, timeout=timeout, search=search)
            if isinstance(result, dict) and result.get("status") == "ok":
                return _ok({
                    "selected": result.get("selected"),
                    "text": result.get("text"),
                    "method": result.get("method", "dropdown"),
                })
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

                  function textOf(el) {
                    return [
                      el?.innerText,
                      el?.textContent,
                      el?.getAttribute?.('aria-label'),
                      el?.getAttribute?.('title'),
                      el?.getAttribute?.('placeholder'),
                      el?.getAttribute?.('aria-valuetext'),
                    ].filter(Boolean).map((part) => String(part).trim()).find(Boolean) || '';
                  }

                  function getLabel(el) {
                    if (el.id) {
                      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
                      if (label) return (label.innerText || label.textContent || '').trim();
                    }
                    const parentLabel = el.closest('label');
                    if (parentLabel) {
                      const text = (parentLabel.innerText || parentLabel.textContent || '').trim();
                      const inputVal = ('value' in el && el.value) ? el.value : '';
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

                  function popupFor(el) {
                    const controlsId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '';
                    if (controlsId) {
                      const popup = document.getElementById(controlsId);
                      if (popup) return popup;
                    }
                    const within = el.closest('[role="combobox"], [role="listbox"], [data-headlessui-state], [data-radix-popper-content-wrapper]');
                    if (within && within !== el) return within;
                    const sib = el.parentElement?.querySelector?.('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state]');
                    if (sib) return sib;
                    // Check portaled popups at document level
                    const portaled = document.querySelectorAll('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state], [id*="listbox"], [id*="react-select"]');
                    for (const c of portaled) { if (isVisible(c)) return c; }
                    return null;
                  }

                  function getDropdownMeta(el) {
                    const tag = el.tagName.toLowerCase();
                    const role = el.getAttribute('role') || '';
                    const popupHint = el.getAttribute('aria-haspopup') || '';
                    const popup = popupFor(el);
                    const isDropdown = tag === 'select'
                      || role === 'combobox'
                      || role === 'listbox'
                      || ['listbox', 'menu', 'tree', 'dialog'].includes(popupHint)
                      || (!!popup && ['button', 'div', 'span', 'input'].includes(tag));
                    if (!isDropdown) return { isDropdown: false };

                    let options = [];
                    let selectedText = '';
                    let currentValue = '';

                    if (tag === 'select') {
                      currentValue = el.value || '';
                      const selectedOption = el.options && el.options[el.selectedIndex];
                      selectedText = selectedOption ? (selectedOption.text || '').trim() : '';
                      options = Array.from(el.options || []).slice(0, 30).map((opt) => ({
                        value: opt.value || '',
                        text: (opt.text || '').trim(),
                        selected: !!opt.selected,
                      }));
                    } else {
                      options = popup
                        ? Array.from(popup.querySelectorAll('[role="option"], [role="menuitemradio"], [role="menuitemcheckbox"], [data-value], [aria-selected], li'))
                            .filter((candidate) => isVisible(candidate))
                            .map((candidate) => ({
                              value: String(candidate.getAttribute('data-value') || candidate.getAttribute('value') || '').trim(),
                              text: textOf(candidate).substring(0, 200),
                              selected: candidate.getAttribute('aria-selected') === 'true' || candidate.getAttribute('aria-checked') === 'true',
                            }))
                            .filter((opt) => opt.text || opt.value)
                            .slice(0, 30)
                        : [];
                      const activeId = el.getAttribute('aria-activedescendant') || '';
                      if (activeId) {
                        const activeEl = document.getElementById(activeId);
                        if (activeEl) selectedText = textOf(activeEl);
                      }
                      if (!selectedText) {
                        selectedText = String(el.getAttribute('aria-valuetext') || '').trim();
                      }
                      if (!selectedText && (role === 'combobox' || tag === 'button')) {
                        selectedText = textOf(el).substring(0, 200);
                      }
                      currentValue = String(el.getAttribute('data-value') || el.getAttribute('value') || '').trim();
                    }

                    const expandedAttr = el.getAttribute('aria-expanded');
                    return {
                      isDropdown: true,
                      expanded: expandedAttr == null ? undefined : expandedAttr === 'true',
                      popupRole: popup?.getAttribute?.('role') || popupHint || '',
                      options,
                      optionCount: options.length,
                      selectedText,
                      value: currentValue,
                    };
                  }

                  const interactiveSelectors = 'input, textarea, select, button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="listbox"], [role="searchbox"], [role="textbox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], [contenteditable="true"]';
                  const all = Array.from(new Set(Array.from(document.querySelectorAll(interactiveSelectors))));

                  for (const el of all) {
                    const tag = el.tagName.toLowerCase();
                    const type = (el.getAttribute('type') || '').toLowerCase();
                    const role = el.getAttribute('role') || '';
                    const name = el.getAttribute('name') || '';
                    const id = el.id || '';
                    const placeholder = el.getAttribute('placeholder') || '';
                    const ariaLabel = el.getAttribute('aria-label') || '';
                    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
                    const required = el.required || el.getAttribute('aria-required') === 'true';
                    const readonly = el.readOnly || el.getAttribute('aria-readonly') === 'true';
                    const visible = isVisible(el);
                    const isFileInput = tag === 'input' && type === 'file';
                    const dropdownMeta = getDropdownMeta(el);

                    if (!visible && !isFileInput) continue;

                    const entry = {
                      index: elements.length,
                      tag,
                      selector: getSelector(el),
                    };

                    if (!visible) entry.hidden = true;
                    if (type) entry.type = type;
                    if (role) entry.role = role;
                    if (name) entry.name = name;
                    if (id) entry.id = id;

                    const text = textOf(el);
                    if ((['button', 'a'].includes(tag) || ['button', 'link', 'tab', 'menuitem'].includes(role) || dropdownMeta.isDropdown) && text) {
                      entry.text = text.substring(0, 200);
                    }
                    if (tag === 'a') entry.href = el.getAttribute('href') || '';

                    const label = getLabel(el);
                    if (label) entry.label = label.substring(0, 200);
                    if (placeholder) entry.placeholder = placeholder;

                    if (isFileInput) {
                      entry.controlType = 'file';
                      entry.accept = el.getAttribute('accept') || '';
                      if (el.multiple) entry.multiple = true;
                    } else if (dropdownMeta.isDropdown) {
                      entry.controlType = 'dropdown';
                      if (dropdownMeta.value) entry.value = String(dropdownMeta.value).substring(0, 500);
                      if (dropdownMeta.selectedText) entry.selectedText = String(dropdownMeta.selectedText).substring(0, 200);
                      if (dropdownMeta.popupRole) entry.popupRole = dropdownMeta.popupRole;
                      if (typeof dropdownMeta.expanded === 'boolean') entry.expanded = dropdownMeta.expanded;
                      if (dropdownMeta.optionCount) entry.optionCount = dropdownMeta.optionCount;
                      if (dropdownMeta.options?.length) entry.options = dropdownMeta.options;
                    } else if (type === 'checkbox' || type === 'radio' || ['checkbox', 'radio', 'switch'].includes(role)) {
                      entry.controlType = 'toggle';
                      entry.checked = !!el.checked || el.getAttribute('aria-checked') === 'true';
                    } else if (['input', 'textarea'].includes(tag) || ['textbox', 'searchbox', 'combobox'].includes(role)) {
                      entry.controlType = 'text';
                      entry.value = String(el.value || '').substring(0, 500);
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

                  return { elements, forms };
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
            filled = 0
            errors = []

            field_list: list[dict[str, Any]] = []
            if isinstance(fields, dict):
                for key, val in fields.items():
                    field_list.append({"selector": key, "value": val, "type": "text"})
            else:
                for item in fields:
                    if isinstance(item, dict) and ("selector" in item or "name" in item):
                        sel = item.get("selector") or f'[name="{item.get("name")}"]'
                        field_list.append({
                            "selector": sel,
                            "value": item.get("value", ""),
                            "type": str(item.get("type", "text") or "text").lower(),
                        })

            for field in field_list:
                sel = field["selector"]
                raw_val = field.get("value", "")
                val = "" if raw_val is None else str(raw_val)
                field_type = str(field.get("type", "text") or "text").lower()

                try:
                    if field_type == "select":
                        select_result = await _select_dropdown(sel, value=raw_val, label=val, timeout=5000, search=val)
                        if not isinstance(select_result, dict) or select_result.get("status") != "ok":
                            detail = select_result.get("detail", "Select failed") if isinstance(select_result, dict) else str(select_result)
                            raise RuntimeError(detail)
                        filled += 1
                    elif field_type == "file":
                        await _upload_local_file(sel, val, timeout=5000)
                        filled += 1
                    elif field_type in ("checkbox", "radio", "toggle", "switch"):
                        should_check = val.lower() in ("true", "1", "yes", "on")
                        # Get current checked state via JS
                        checked = await _evaluate(
                            """(sel) => {
                              const el = document.querySelector(sel);
                              if (!el) return false;
                              if (el.type === 'checkbox' || el.type === 'radio') return !!el.checked;
                              return el.getAttribute('aria-checked') === 'true'
                                || el.classList.contains('checked')
                                || el.classList.contains('active')
                                || (el.dataset && el.dataset.state === 'checked');
                            }""",
                            sel,
                        )
                        if bool(checked) != should_check:
                            await _cdp_click_element_by_selector(sel)
                        filled += 1
                    else:
                        # Text input — use browser-use Element.fill() or CDP type
                        els = await _find_elements(sel)
                        if els:
                            await els[0].fill(val, clear=True)
                            filled += 1
                        else:
                            # Fallback: JS fill + events
                            fill_ok = await _evaluate(
                                """(sel, val) => {
                                  const el = document.querySelector(sel);
                                  if (!el) return false;
                                  if ('value' in el) {
                                    el.focus();
                                    el.value = val;
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                    return true;
                                  }
                                  if (el.getAttribute('contenteditable') === 'true') {
                                    el.focus();
                                    el.textContent = val;
                                    el.dispatchEvent(new Event('input', { bubbles: true }));
                                    return true;
                                  }
                                  return false;
                                }""",
                                sel, val,
                            )
                            if fill_ok:
                                filled += 1
                            else:
                                errors.append(f"Field not found: {sel}")
                except Exception as e:
                    errors.append(f"{sel}: {str(e)[:100]}")

            submitted = False
            if submit and filled > 0:
                try:
                    # Try clicking submit button via CDP
                    submit_sel = f"{form_selector} [type='submit'], {form_selector} button" if form_selector else "[type='submit'], button[type='submit']"
                    submit_clicked = await _cdp_click_element_by_selector(submit_sel)
                    if submit_clicked:
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


async def handle_upload_file(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    file_path = str(body.get("file_path") or body.get("filePath") or body.get("path") or "").strip()
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not file_path:
        return _err("file_path is required")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            result = await _upload_local_file(selector, file_path, timeout=timeout)
            return _ok(result)
        except Exception as e:
            return _err(f"Upload file failed: {e}")


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
            if url_pattern:
                timeout_s = float(timeout) / 1000.0
                deadline = asyncio.get_event_loop().time() + timeout_s
                while asyncio.get_event_loop().time() < deadline:
                    current = await _get_page_url()
                    if url_pattern in current:
                        return _ok({"matched": True, "url": current, "type": "url_pattern"})
                    await asyncio.sleep(0.2)
                return _err(f"Timed out waiting for URL matching '{url_pattern}'")

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
