import asyncio
from pathlib import Path
from typing import Any

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _clamp_int
from browser_server.lifecycle import (
    _ensure_browser, _get_page_url, _get_page_title, _get_playwright_page,
    _find_elements, _evaluate, _wait_for_selector, _smart_wait_for_element,
    _close_browser,
)


async def _select_dropdown(selector: str, value: Any = None, label: Any = None, index: Any = None, timeout: int = 5000) -> dict[str, Any]:
    pw = _get_playwright_page()
    if pw:
        try:
            locator = pw.locator(selector).first
            tag = await locator.evaluate("(el) => (el.tagName || '').toLowerCase()")
            if tag == "select":
                if value is not None:
                    selected = await locator.select_option(value=str(value), timeout=timeout)
                elif label is not None:
                    selected = await locator.select_option(label=str(label), timeout=timeout)
                elif index is not None:
                    selected = await locator.select_option(index=int(index), timeout=timeout)
                else:
                    selected = []
                selected_text = await locator.evaluate(
                    """(el) => {
                      const opt = el.options && el.options[el.selectedIndex];
                      return opt ? (opt.text || '').trim() : '';
                    }"""
                )
                selected_value = selected[0] if selected else await locator.evaluate("(el) => el.value || ''")
                return {"status": "ok", "selected": selected_value, "text": selected_text, "method": "playwright_select"}
        except Exception:
            pass

    result = await _evaluate(
        """(sel, val, lbl, idx, timeoutMs) => {
          return new Promise((resolve) => {
            const control = document.querySelector(sel);
            if (!control) {
              resolve({ status: 'not_found', detail: `Selector not found: ${sel}` });
              return;
            }

            const desiredValue = val === null || val === undefined ? null : String(val);
            const desiredLabel = lbl === null || lbl === undefined ? '' : String(lbl).trim().toLowerCase();
            const desiredIndex = idx === null || idx === undefined || Number.isNaN(Number(idx)) ? null : Number(idx);

            function isVisible(el) {
              if (!el) return false;
              const r = el.getBoundingClientRect();
              const s = window.getComputedStyle(el);
              return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
            }

            function textOf(el) {
              return [
                el?.innerText,
                el?.textContent,
                el?.getAttribute?.('aria-label'),
                el?.getAttribute?.('title'),
                el?.getAttribute?.('data-value'),
                el?.getAttribute?.('value'),
              ].filter(Boolean).map((part) => String(part).trim()).find(Boolean) || '';
            }

            function valueOf(el) {
              if (!el) return '';
              if ('value' in el && el.value) return String(el.value);
              return String(
                el.getAttribute('data-value')
                || el.getAttribute('value')
                || el.getAttribute('aria-valuetext')
                || ''
              ).trim();
            }

            function clickLike(el) {
              if (!el) return;
              el.scrollIntoView({ block: 'center', inline: 'center' });
              const r = el.getBoundingClientRect();
              const opts = {
                bubbles: true,
                cancelable: true,
                clientX: r.left + r.width / 2,
                clientY: r.top + r.height / 2,
                view: window,
              };
              try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch {}
              try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch {}
              try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch {}
              try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch {}
              try { el.dispatchEvent(new MouseEvent('click', opts)); } catch {}
              if (typeof el.focus === 'function') {
                try { el.focus(); } catch {}
              }
              if (typeof el.click === 'function') {
                try { el.click(); } catch {}
              }
            }

            function popupFor(el) {
              const controlsId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '';
              if (controlsId) {
                const popup = document.getElementById(controlsId);
                if (popup) return popup;
              }
              const within = el.closest('[role="combobox"], [role="listbox"], [data-headlessui-state], [data-radix-popper-content-wrapper]');
              if (within && within !== el) return within;
              const siblingPopup = el.parentElement?.querySelector?.('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state]');
              if (siblingPopup) return siblingPopup;
              return null;
            }

            function optionNodes(root) {
              const scopes = [];
              if (root) scopes.push(root);
              scopes.push(document);
              const seen = new Set();
              const nodes = [];
              const selector = [
                '[role="option"]',
                '[role="menuitemradio"]',
                '[role="menuitemcheckbox"]',
                '[role="listbox"] [data-value]',
                '[role="menu"] [data-value]',
                '[aria-selected="true"]',
                '[aria-selected="false"]',
                'option',
                'li',
                'button',
              ].join(', ');
              for (const scope of scopes) {
                for (const candidate of Array.from(scope.querySelectorAll(selector))) {
                  if (seen.has(candidate)) continue;
                  seen.add(candidate);
                  if (candidate === control) continue;
                  const text = textOf(candidate);
                  const valueText = valueOf(candidate);
                  if (!isVisible(candidate) || (!text && !valueText)) continue;
                  nodes.push(candidate);
                }
                if (nodes.length > 0) break;
              }
              return nodes;
            }

            function matchOption(options) {
              if (desiredValue !== null) {
                const exactValue = options.find((opt) => valueOf(opt) === desiredValue || textOf(opt) === desiredValue);
                if (exactValue) return exactValue;
              }
              if (desiredLabel) {
                const byLabel = options.find((opt) => {
                  const text = textOf(opt).toLowerCase();
                  const valueText = valueOf(opt).toLowerCase();
                  return text.includes(desiredLabel) || valueText === desiredLabel;
                });
                if (byLabel) return byLabel;
              }
              if (desiredIndex !== null && desiredIndex >= 0 && desiredIndex < options.length) {
                return options[desiredIndex];
              }
              return null;
            }

            if ((control.tagName || '').toLowerCase() === 'select') {
              let matched = false;
              for (let i = 0; i < control.options.length; i++) {
                const opt = control.options[i];
                if (desiredValue !== null && opt.value === desiredValue) {
                  control.selectedIndex = i;
                  matched = true;
                  break;
                }
                if (desiredLabel && (opt.text || '').trim().toLowerCase().includes(desiredLabel)) {
                  control.selectedIndex = i;
                  matched = true;
                  break;
                }
                if (desiredIndex !== null && i === desiredIndex) {
                  control.selectedIndex = i;
                  matched = true;
                  break;
                }
              }
              if (!matched) {
                resolve({ status: 'no_match', detail: 'No matching option found' });
                return;
              }
              control.dispatchEvent(new Event('input', { bubbles: true }));
              control.dispatchEvent(new Event('change', { bubbles: true }));
              const selectedOption = control.options[control.selectedIndex];
              resolve({
                status: 'ok',
                selected: control.value || '',
                text: selectedOption ? (selectedOption.text || '').trim() : '',
                method: 'js_select',
              });
              return;
            }

            const deadline = Date.now() + timeoutMs;
            function attempt(alreadyOpened) {
              const popup = popupFor(control);
              const options = optionNodes(popup);
              const match = matchOption(options);
              if (match) {
                const matchedText = textOf(match);
                const matchedValue = valueOf(match) || matchedText;
                clickLike(match);
                resolve({
                  status: 'ok',
                  selected: matchedValue,
                  text: matchedText,
                  method: 'js_custom_dropdown',
                });
                return;
              }
              if (!alreadyOpened) {
                clickLike(control);
              }
              if (Date.now() >= deadline) {
                resolve({
                  status: 'no_match',
                  detail: 'No matching visible dropdown option found',
                  options: options.slice(0, 20).map((opt) => ({ text: textOf(opt), value: valueOf(opt) })),
                });
                return;
              }
              setTimeout(() => attempt(true), 150);
            }

            attempt(false);
          });
        }""",
        selector,
        value,
        label,
        index,
        timeout,
    )
    return result if isinstance(result, dict) else {"status": "error", "detail": str(result)}


async def _upload_local_file(selector: str, file_path: str, timeout: int = 5000) -> dict[str, Any]:
    pw = _get_playwright_page()
    if not pw:
        raise RuntimeError("Playwright page is required for file uploads")

    raw_path = str(file_path or "").strip()
    if not raw_path:
        raise ValueError("file_path is required")

    resolved_path = Path(raw_path).expanduser()
    if not resolved_path.is_absolute():
        resolved_path = resolved_path.resolve()
    if not resolved_path.exists() or not resolved_path.is_file():
        raise FileNotFoundError(f"Local file not found: {resolved_path}")

    marker = f"stuard-upload-{int(asyncio.get_event_loop().time() * 1000)}"
    resolved_target = await _evaluate(
        """(sel, marker) => {
          document.querySelectorAll('[data-stuard-upload-target]').forEach((el) => {
            el.removeAttribute('data-stuard-upload-target');
          });

          function isVisible(el) {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
          }

          function isFileInput(el) {
            return !!el && el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'file';
          }

          function labelFor(el) {
            if (!el) return '';
            if (el.id) {
              const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
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
              if (forId) {
                const direct = document.getElementById(forId);
                if (isFileInput(direct)) return direct;
              }
            }
            const nested = target.querySelector?.('input[type="file"]');
            if (isFileInput(nested)) return nested;
            const labelAncestor = target.closest?.('label');
            const ancestorNested = labelAncestor?.querySelector?.('input[type="file"]');
            if (isFileInput(ancestorNested)) return ancestorNested;
            const form = target.closest?.('form');
            const formInput = form?.querySelector?.('input[type="file"]');
            if (isFileInput(formInput)) return formInput;
            const sibling = target.parentElement?.querySelector?.('input[type="file"]');
            if (isFileInput(sibling)) return sibling;
            return null;
          }

          const directTarget = sel ? document.querySelector(sel) : null;
          let input = findInput(directTarget);
          if (!input) {
            const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
            input = allInputs.find((candidate) => isVisible(candidate)) || allInputs[0] || null;
          }
          if (!input) {
            return { status: 'not_found', detail: 'No file input found on the page' };
          }

          input.setAttribute('data-stuard-upload-target', marker);
          return {
            status: 'ok',
            selector: `input[type="file"][data-stuard-upload-target="${marker}"]`,
            label: labelFor(input),
            accept: input.accept || '',
            multiple: !!input.multiple,
            hidden: !isVisible(input),
          };
        }""",
        selector or "",
        marker,
    )
    if not isinstance(resolved_target, dict) or resolved_target.get("status") != "ok":
        detail = resolved_target.get("detail", "File input not found") if isinstance(resolved_target, dict) else str(resolved_target)
        raise RuntimeError(detail)

    locator = pw.locator(str(resolved_target.get("selector"))).first
    try:
        await locator.set_input_files(str(resolved_path), timeout=timeout)
    except TypeError:
        await locator.set_input_files(str(resolved_path))

    return {
        "uploaded": True,
        "filePath": str(resolved_path),
        "fileName": resolved_path.name,
        "selector": str(resolved_target.get("selector") or selector or ""),
        "accept": str(resolved_target.get("accept") or ""),
        "multiple": bool(resolved_target.get("multiple", False)),
        "hidden": bool(resolved_target.get("hidden", False)),
        "label": str(resolved_target.get("label") or ""),
        "method": "playwright_set_input_files",
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
            result = await _select_dropdown(selector, value=value, label=label, index=index, timeout=timeout)
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
                    return el.parentElement?.querySelector?.('[role="listbox"], [role="menu"], [data-radix-popper-content-wrapper], [data-headlessui-state]') || null;
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
            pw = _get_playwright_page()
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
                        select_result = await _select_dropdown(sel, value=raw_val, label=val, timeout=5000)
                        if not isinstance(select_result, dict) or select_result.get("status") != "ok":
                            detail = select_result.get("detail", "Select failed") if isinstance(select_result, dict) else str(select_result)
                            raise RuntimeError(detail)
                        filled += 1
                    elif field_type == "file":
                        await _upload_local_file(sel, val, timeout=5000)
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
