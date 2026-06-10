"""Browser lifecycle: initialization, page state, shutdown — pure CDP."""

import asyncio
import base64
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from browser_server import state
from browser_server.utils import _clamp_int, _normalize_wait_until, _is_allowed_url
from browser_server.profile import _current_profile_dir
from browser_server.cdp_client import CDPBrowser

_COOKIE_BACKUP_FILE = "stuard_cookies.json"
_LEGACY_SESSION_COOKIES_FILE = "stuard_session_cookies.json"
_COOKIE_RESTORE_FIELDS = {
    "name",
    "value",
    "url",
    "domain",
    "path",
    "secure",
    "httpOnly",
    "sameSite",
    "expires",
    "priority",
    "sameParty",
    "sourceScheme",
    "sourcePort",
    "partitionKey",
}


# ---------------------------------------------------------------------------
# Cookie persistence backup. This protects auth/session state across mode
# switches when Chrome has not fully flushed the profile to disk yet.
# ---------------------------------------------------------------------------

def _save_cookie_backup(profile_dir: Path, cookies: list[dict]) -> None:
    """Persist the current cookie jar so restarts can restore it if needed."""
    backup_file = profile_dir / _COOKIE_BACKUP_FILE
    try:
        profile_dir.mkdir(parents=True, exist_ok=True)
        if cookies:
            backup_file.write_text(json.dumps(cookies), encoding="utf-8")
        else:
            backup_file.unlink(missing_ok=True)
            (profile_dir / _LEGACY_SESSION_COOKIES_FILE).unlink(missing_ok=True)
    except Exception:
        pass


def _cookie_params_for_restore(cookie: dict[str, Any]) -> dict[str, Any] | None:
    if not cookie.get("name"):
        return None

    restored: dict[str, Any] = {
        key: value
        for key, value in cookie.items()
        if key in _COOKIE_RESTORE_FIELDS and value not in (None, "")
    }
    if "expires" in restored:
        try:
            if float(restored["expires"]) <= 0:
                restored.pop("expires", None)
        except Exception:
            restored.pop("expires", None)
    if "path" not in restored:
        restored["path"] = "/"
    if "url" not in restored and "domain" not in restored:
        return None
    return restored


async def _restore_cookie_backup(profile_dir: Path) -> None:
    """Re-inject saved cookies via CDP Network.setCookies."""
    cookie_file = profile_dir / _COOKIE_BACKUP_FILE
    if not cookie_file.exists():
        cookie_file = profile_dir / _LEGACY_SESSION_COOKIES_FILE
    if not cookie_file.exists():
        return
    try:
        cookies = json.loads(cookie_file.read_text(encoding="utf-8"))
        if cookies and state._page and state._page.is_connected:
            cdp_cookies = [
                restored
                for restored in (_cookie_params_for_restore(c) for c in cookies)
                if restored
            ]
            if cdp_cookies:
                await state._page.send("Network.setCookies", {"cookies": cdp_cookies})
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Page state helpers
# ---------------------------------------------------------------------------

def _active_page() -> Optional["CDPConnectionLike"]:
    """The CDP page connection for the CURRENT request.

    Each aiohttp request task sets `state.current_page` to the tab it resolved (see
    `browser_op` / `_ensure_browser_session`). Concurrent requests therefore each see
    their own tab. When unset (legacy / session-less calls), fall back to the shared
    default page so existing single-session behavior is unchanged.
    """
    page = state.current_page.get()
    if page is not None:
        return page
    return state._page


# Type alias kept loose to avoid importing CDPConnection here just for hints.
CDPConnectionLike = Any


async def _page_is_alive() -> bool:
    page = _active_page()
    if page is None or not page.is_connected:
        return False
    try:
        result = await asyncio.wait_for(
            page.evaluate("() => true"), timeout=2.0
        )
        return result is True
    except Exception:
        return False


async def _get_page_url() -> str:
    page = _active_page()
    if page is None:
        return ""
    try:
        return str(await page.evaluate("() => window.location.href") or "")
    except Exception:
        return ""


async def _get_page_title(timeout: float | None = None) -> str:
    page = _active_page()
    if page is None:
        return ""
    try:
        coro = page.evaluate("() => document.title")
        if timeout:
            return str(await asyncio.wait_for(coro, timeout=timeout) or "")
        return str(await coro or "")
    except Exception:
        return ""


def _normalize_session_id(value: Any) -> str:
    session_id = str(value or "").strip()
    if not session_id:
        return ""
    return session_id[:128]


def _normalize_tab_index(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        index = int(value)
    except Exception:
        return None
    return index if index >= 0 else None


async def _cleanup_tab_sessions() -> set[str]:
    """Drop expired sessions and ownership for tabs that no longer exist."""
    browser = state._browser
    if browser is None:
        state._tab_session_targets.clear()
        state._tab_target_owners.clear()
        state._tab_session_touched.clear()
        return set()

    targets = await browser.list_targets()
    live_target_ids = {str(t.get("id", "")) for t in targets if t.get("id")}
    now = time.monotonic()
    stale_sessions: list[str] = []

    for session_id, target_id in list(state._tab_session_targets.items()):
        touched = float(state._tab_session_touched.get(session_id, 0) or 0)
        expired = touched > 0 and now - touched > state.TAB_SESSION_TTL_SECONDS
        if target_id not in live_target_ids or expired:
            stale_sessions.append(session_id)

    for session_id in stale_sessions:
        await _release_tab_session(session_id)

    for target_id, owner in list(state._tab_target_owners.items()):
        if target_id not in live_target_ids or state._tab_session_targets.get(owner) != target_id:
            state._tab_target_owners.pop(target_id, None)

    return live_target_ids


async def _claim_tab_for_session(session_id: str, target_id: str) -> None:
    previous_target = state._tab_session_targets.get(session_id)
    if previous_target and previous_target != target_id:
        state._tab_target_owners.pop(previous_target, None)

    previous_owner = state._tab_target_owners.get(target_id)
    if previous_owner and previous_owner != session_id:
        state._tab_session_targets.pop(previous_owner, None)
        state._tab_session_touched.pop(previous_owner, None)

    state._tab_session_targets[session_id] = target_id
    state._tab_target_owners[target_id] = session_id
    state._tab_session_touched[session_id] = time.monotonic()


async def _release_tab_session(session_id: str) -> bool:
    session_id = _normalize_session_id(session_id)
    if not session_id:
        return False
    target_id = state._tab_session_targets.pop(session_id, None)
    state._tab_session_touched.pop(session_id, None)
    state._session_locks.pop(session_id, None)
    if target_id and state._tab_target_owners.get(target_id) == session_id:
        state._tab_target_owners.pop(target_id, None)
    return target_id is not None


async def _resolve_tab_for_session(body: dict[str, Any] | None = None):
    """Resolve and RETURN the CDP page for this request's session.

    Each browser session (one per parallel subagent) owns a dedicated tab, tracked by
    session ownership rather than by tab index — so two sessions never collide even
    though Chrome's /json/list order is unstable. Session-less / legacy calls get the
    shared default page. Does NOT mutate `state._page` (the default page) for sessions,
    so the sidebar mirror and legacy callers keep pointing at the default tab.

    Must be called while holding the structural lock (`state._lock`).
    """
    body = body or {}
    session_id = _normalize_session_id(body.get("session_id") or body.get("sessionId"))
    if not session_id:
        return state._page

    browser = state._browser
    if browser is None:
        return state._page

    live_target_ids = await _cleanup_tab_sessions()

    # Reuse the tab this session already owns, if it's still alive.
    owned_target_id = state._tab_session_targets.get(session_id)
    if owned_target_id and owned_target_id in live_target_ids:
        state._tab_session_touched[session_id] = time.monotonic()
        return await browser.get_page(owned_target_id)

    # Otherwise reuse an unowned tab before creating a new one (caps tab growth across
    # batches). Prefer a non-default tab so parallel siblings spread across tabs, but
    # a lone session may adopt the default tab rather than leave a blank "New Tab"
    # behind it — so a single browser subagent uses the existing tab, not a second one.
    target_id: Optional[str] = None
    fallback_default: Optional[str] = None
    for t in await browser.list_targets():
        tid = str(t.get("id") or "")
        if not tid or tid in state._tab_target_owners:
            continue
        if tid == state._default_target_id:
            fallback_default = tid
            continue
        target_id = tid
        break
    if target_id is None and fallback_default is not None:
        target_id = fallback_default

    if target_id is None:
        # No reusable tab — create a fresh one for this session.
        page = await browser.new_page("about:blank")
        target_id = browser._active_id
        if not target_id:
            targets = await browser.list_targets()
            target_id = str(targets[-1]["id"]) if targets else None
        if target_id is None:
            return state._page
        await _claim_tab_for_session(session_id, target_id)
        return page

    await _claim_tab_for_session(session_id, target_id)
    return await browser.get_page(target_id)


async def _ensure_browser_session(body: dict[str, Any] | None = None) -> tuple[bool, Optional[str]]:
    """Structural-path session ensure (used by tabs/cookies-style handlers).

    Launches the browser if needed, resolves this request's tab, and pins it as the
    per-request active page so the handler's helper calls target the right tab.
    Operation handlers should use `browser_op` instead, which additionally avoids
    holding the structural lock for the whole operation.
    """
    ok, err = await _ensure_browser()
    if not ok:
        return ok, err
    try:
        page = await _resolve_tab_for_session(body)
        if page is not None:
            state.current_page.set(page)
    except Exception as exc:
        return False, f"Browser tab session failed: {exc}"
    return True, None


@asynccontextmanager
async def browser_op(body: dict[str, Any] | None = None):
    """Context manager for per-tab browser OPERATIONS that run concurrently.

    Phase 1 (structural lock, brief): launch Chrome if needed and resolve/claim this
    request's tab. Phase 2 (per-session lock, for the operation body): the structural
    lock is released so requests on OTHER tabs run in parallel; the per-session lock
    serializes only same-session requests. The resolved tab is pinned via the
    `current_page` ContextVar for the duration of the body.

    Usage:
        async with browser_op(body) as (ok, err):
            if not ok:
                return _err(err or "Browser init failed", status=500)
            ... operation using lifecycle helpers ...
    """
    body = body or {}
    page = None
    ok = False
    err: Optional[str] = None

    async with state._lock:
        ok, err = await _ensure_browser()
        if ok:
            try:
                page = await _resolve_tab_for_session(body)
            except Exception as exc:
                ok, err = False, f"Browser tab session failed: {exc}"

    if not ok:
        yield (False, err)
        return
    if page is None:
        yield (False, err or "Browser init failed")
        return

    session_id = _normalize_session_id(body.get("session_id") or body.get("sessionId"))
    token = state.current_page.set(page)
    try:
        async with state._session_lock(session_id):
            yield (True, None)
    finally:
        state.current_page.reset(token)


async def _tab_owner_snapshot() -> dict[str, str]:
    await _cleanup_tab_sessions()
    return dict(state._tab_target_owners)


async def _capture_screenshot(
    image_format: str = "png",
    *,
    quality: int | None = None,
    full_page: bool = False,
) -> bytes:
    """Capture a screenshot from the active page via CDP."""
    page = _active_page()
    if page is None:
        raise RuntimeError("No active page")

    fmt = "jpeg" if str(image_format).lower() in ("jpeg", "jpg") else "png"
    params: dict[str, Any] = {
        "format": fmt,
        "fromSurface": True,
    }
    if fmt == "jpeg" and quality is not None:
        params["quality"] = _clamp_int(quality, 80, 1, 100)
    if full_page:
        params["captureBeyondViewport"] = True
        try:
            metrics = await page.send("Page.getLayoutMetrics")
            content_size = metrics.get("contentSize", {})
            width = float(content_size.get("width", 0) or 0)
            height = float(content_size.get("height", 0) or 0)
            if width > 0 and height > 0:
                params["clip"] = {
                    "x": 0,
                    "y": 0,
                    "width": width,
                    "height": height,
                    "scale": 1,
                }
        except Exception:
            pass

    result = await page.send("Page.captureScreenshot", params)
    data = str(result.get("data", "") or "")
    if not data:
        raise RuntimeError("Chrome returned an empty screenshot payload")
    return base64.b64decode(data)


# ---------------------------------------------------------------------------
# JS evaluation — drop-in replacement for Playwright's page.evaluate()
# ---------------------------------------------------------------------------

async def _evaluate(js_arrow_fn: str, *args: Any) -> Any:
    """Evaluate a JS arrow function via CDP Runtime.evaluate.

    Supports 0, 1, or multiple args (multiple args passed as a list, matching
    Playwright's convention for destructured parameters).
    """
    page = _active_page()
    if page is None:
        return ""
    try:
        coro = page.evaluate(js_arrow_fn, *args)
        return await asyncio.wait_for(coro, timeout=30.0)
    except asyncio.TimeoutError:
        return ""
    except Exception as exc:
        msg = str(exc).lower()
        if "context" in msg or "destroyed" in msg or "closed" in msg or "connection" in msg:
            print(f"[browser-server] Page connection lost, will re-launch: {exc}", flush=True)
            # Only clear the shared default page (which gates re-launch). A dead
            # background-tab connection is re-resolved on the session's next call.
            if page is state._page:
                state._page = None
        raise


# ---------------------------------------------------------------------------
# Navigation & waiting
# ---------------------------------------------------------------------------

async def _wait_for_ready(wait_until: str = "domcontentloaded", timeout: int = 30000) -> None:
    if _active_page() is None:
        raise RuntimeError("No active page")

    timeout_s = max(0.25, float(timeout) / 1000.0)
    deadline = asyncio.get_event_loop().time() + timeout_s

    async def _wait_for_state(target_states: tuple[str, ...]) -> None:
        while True:
            if asyncio.get_event_loop().time() >= deadline:
                raise TimeoutError(f"Timed out waiting for {wait_until}")
            try:
                page_state = await _evaluate("() => document.readyState")
            except Exception:
                page_state = ""
            if page_state in target_states:
                return
            await asyncio.sleep(0.1)

    if wait_until == "commit":
        return
    if wait_until == "domcontentloaded":
        await _wait_for_state(("interactive", "complete"))
        return
    if wait_until == "load":
        await _wait_for_state(("complete",))
        return
    if wait_until == "networkidle":
        await _wait_for_state(("complete",))
        await asyncio.sleep(0.5)
        return
    await _wait_for_state(("interactive", "complete"))


async def _wait_for_selector(selector: str, timeout: int = 5000) -> bool:
    if not selector:
        return True
    timeout_s = max(0.25, float(timeout) / 1000.0)
    deadline = asyncio.get_event_loop().time() + timeout_s
    while True:
        if asyncio.get_event_loop().time() >= deadline:
            return False
        try:
            found = await _evaluate(
                """(sel) => {
                  let el = document.querySelector(String(sel));
                  if (!el) {
                    const iframes = document.querySelectorAll('iframe');
                    for (const iframe of iframes) {
                      try { el = iframe.contentDocument?.querySelector(sel); if (el) break; } catch(e) {}
                    }
                  }
                  if (!el) return false;
                  const w = el.ownerDocument?.defaultView || window;
                  const style = w.getComputedStyle(el);
                  if (!style) return true;
                  const hidden = style.display === 'none' || style.visibility === 'hidden';
                  const r = el.getBoundingClientRect();
                  return !hidden && (r.width > 0 || r.height > 0);
                }""",
                selector,
            )
            if bool(found):
                return True
        except Exception:
            pass
        await asyncio.sleep(0.12)


async def _goto(url: str, wait_until: str = "domcontentloaded", timeout: int = 30000) -> None:
    page = _active_page()
    if page is None:
        raise RuntimeError("No active page")
    wait_until = _normalize_wait_until(wait_until)
    timeout = _clamp_int(timeout, 30000, 1000, 180000)
    # CDP Page.navigate starts the navigation; then we poll readyState
    await page.send("Page.navigate", {"url": url})
    await asyncio.sleep(0.1)
    await _wait_for_ready(wait_until=wait_until, timeout=timeout)


async def _smart_wait_for_element(selector: str = "", text: str = "", timeout: int = 5000) -> bool:
    if not selector and not text:
        return True
    timeout_s = max(0.25, float(timeout) / 1000.0)
    deadline = asyncio.get_event_loop().time() + timeout_s

    while asyncio.get_event_loop().time() < deadline:
        try:
            if selector:
                found = await _evaluate(
                    """(sel) => {
                        let el = document.querySelector(sel);
                        if (!el) {
                            const iframes = document.querySelectorAll('iframe');
                            for (const iframe of iframes) {
                                try { el = iframe.contentDocument?.querySelector(sel); if (el) break; } catch(e) {}
                            }
                        }
                        if (!el) return false;
                        const w = el.ownerDocument?.defaultView || window;
                        const r = el.getBoundingClientRect();
                        const s = w.getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                    }""",
                    selector,
                )
                if bool(found):
                    return True
            if text:
                found = await _evaluate(
                    """(needle) => {
                        const searchDocs = [document];
                        try {
                            document.querySelectorAll('iframe').forEach(iframe => {
                                try { if (iframe.contentDocument) searchDocs.push(iframe.contentDocument); } catch(e) {}
                            });
                        } catch(e) {}
                        for (const doc of searchDocs) {
                            const all = doc.querySelectorAll('*');
                            for (const el of all) {
                                const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
                                if (t && t.toLowerCase().includes(String(needle).toLowerCase())) {
                                    const w = el.ownerDocument?.defaultView || window;
                                    const r = el.getBoundingClientRect();
                                    const s = w.getComputedStyle(el);
                                    if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden') return true;
                                }
                            }
                        }
                        return false;
                    }""",
                    text,
                )
                if bool(found):
                    return True
        except Exception:
            pass
        await asyncio.sleep(0.15)
    return False


# ---------------------------------------------------------------------------
# CDP input helpers (used by handlers_nav and handlers_advanced)
# ---------------------------------------------------------------------------

async def _cdp_click_at(x: float, y: float, click_count: int = 1) -> None:
    """Dispatch CDP mouse events at the given viewport coordinates."""
    page = _active_page()
    if page is None:
        raise RuntimeError("No active page")
    ix, iy = int(x), int(y)
    await page.send("Input.dispatchMouseEvent",
                    {"type": "mouseMoved", "x": ix, "y": iy})
    await asyncio.sleep(0.02)
    await page.send("Input.dispatchMouseEvent",
                    {"type": "mousePressed", "x": ix, "y": iy,
                     "button": "left", "clickCount": click_count})
    await asyncio.sleep(0.05)
    await page.send("Input.dispatchMouseEvent",
                    {"type": "mouseReleased", "x": ix, "y": iy,
                     "button": "left", "clickCount": click_count})


async def _cdp_click_selector(selector: str) -> bool:
    """Find an element by CSS, scroll it into view, and click via CDP mouse.

    Searches the main document first, then same-origin iframes.
    """
    coords = await _evaluate(
        """(sel) => {
          let el = document.querySelector(sel);
          let iframeEl = null;
          if (!el) {
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
              try {
                const doc = iframe.contentDocument;
                if (!doc) continue;
                el = doc.querySelector(sel);
                if (el) { iframeEl = iframe; break; }
              } catch(e) {}
            }
          }
          if (!el) return null;
          if (iframeEl) iframeEl.scrollIntoView({ block: 'center', inline: 'center' });
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return null;
          let x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (iframeEl) {
            const ir = iframeEl.getBoundingClientRect();
            x += ir.left; y += ir.top;
          }
          return { x, y };
        }""",
        selector,
    )
    if isinstance(coords, dict) and "x" in coords and "y" in coords:
        try:
            await _cdp_click_at(float(coords["x"]), float(coords["y"]))
            await asyncio.sleep(0.05)
            return True
        except Exception:
            pass
    result = await _evaluate(
        """(sel) => {
          let el = document.querySelector(sel);
          if (!el) {
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
              try { el = iframe.contentDocument?.querySelector(sel); if (el) break; } catch(e) {}
            }
          }
          if (el) { el.click(); return true; }
          return false;
        }""",
        selector,
    )
    return result is True


async def _cdp_type_text(text: str) -> bool:
    """Type text char-by-char via CDP Input.dispatchKeyEvent."""
    page = _active_page()
    if page is None:
        return False
    try:
        for char in text:
            if char == "\n":
                await page.send("Input.dispatchKeyEvent",
                    {"type": "keyDown", "key": "Enter", "code": "Enter",
                     "windowsVirtualKeyCode": 13})
                await asyncio.sleep(0.001)
                await page.send("Input.dispatchKeyEvent",
                    {"type": "char", "text": "\r", "key": "Enter"})
                await page.send("Input.dispatchKeyEvent",
                    {"type": "keyUp", "key": "Enter", "code": "Enter",
                     "windowsVirtualKeyCode": 13})
            else:
                await page.send("Input.dispatchKeyEvent",
                    {"type": "keyDown", "key": char,
                     "code": f"Key{char.upper()}" if char.isalpha() else char})
                await asyncio.sleep(0.001)
                await page.send("Input.dispatchKeyEvent",
                    {"type": "char", "text": char, "key": char})
                await page.send("Input.dispatchKeyEvent",
                    {"type": "keyUp", "key": char,
                     "code": f"Key{char.upper()}" if char.isalpha() else char})
            await asyncio.sleep(0.03)
        return True
    except Exception:
        return False


async def _cdp_press_key(key: str) -> bool:
    """Press a key or key combo (e.g. 'Enter', 'Control+a') via CDP."""
    page = _active_page()
    if page is None:
        return False

    _KEY_CODES: dict[str, int] = {
        "Enter": 13, "Tab": 9, "Escape": 27, "Backspace": 8, "Delete": 46,
        "ArrowUp": 38, "ArrowDown": 40, "ArrowLeft": 37, "ArrowRight": 39,
        "Home": 36, "End": 35, "PageUp": 33, "PageDown": 34,
        "Space": 32, " ": 32,
    }

    parts = key.split("+")
    modifiers = 0
    mod_keys: list[str] = []
    main_key = parts[-1]

    for p in parts[:-1]:
        lp = p.lower()
        if lp in ("control", "ctrl"):
            modifiers |= 2
            mod_keys.append("Control")
        elif lp in ("shift",):
            modifiers |= 8
            mod_keys.append("Shift")
        elif lp in ("alt",):
            modifiers |= 1
            mod_keys.append("Alt")
        elif lp in ("meta", "cmd", "command"):
            modifiers |= 4
            mod_keys.append("Meta")

    try:
        # Press modifier keys down
        for mk in mod_keys:
            await page.send("Input.dispatchKeyEvent", {
                "type": "keyDown", "key": mk, "code": mk + "Left",
                "windowsVirtualKeyCode": _KEY_CODES.get(mk, 0),
                "modifiers": modifiers,
            })

        key_code = _KEY_CODES.get(main_key, 0)
        if not key_code and len(main_key) == 1:
            key_code = ord(main_key.upper())

        await page.send("Input.dispatchKeyEvent", {
            "type": "keyDown", "key": main_key,
            "code": f"Key{main_key.upper()}" if len(main_key) == 1 and main_key.isalpha() else main_key,
            "windowsVirtualKeyCode": key_code,
            "modifiers": modifiers,
        })
        if len(main_key) == 1:
            await page.send("Input.dispatchKeyEvent", {
                "type": "char", "text": main_key, "key": main_key,
                "modifiers": modifiers,
            })
        await page.send("Input.dispatchKeyEvent", {
            "type": "keyUp", "key": main_key,
            "code": f"Key{main_key.upper()}" if len(main_key) == 1 and main_key.isalpha() else main_key,
            "windowsVirtualKeyCode": key_code,
            "modifiers": modifiers,
        })

        # Release modifier keys
        for mk in reversed(mod_keys):
            await page.send("Input.dispatchKeyEvent", {
                "type": "keyUp", "key": mk, "code": mk + "Left",
                "modifiers": 0,
            })
        return True
    except Exception:
        return False


async def _cdp_clear_and_type(selector: str, text: str) -> bool:
    """Click an input, select-all + delete to clear, then type char-by-char."""
    await _cdp_click_selector(selector)
    await asyncio.sleep(0.1)

    # Select all + delete
    ok = await _cdp_press_key("Control+a")
    if ok:
        await asyncio.sleep(0.02)
        await _cdp_press_key("Backspace")
        await asyncio.sleep(0.05)
    else:
        # Fallback: JS clear
        await _evaluate(
            """(sel) => {
              const el = document.querySelector(sel);
              if (el && 'value' in el) { el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true})); }
            }""",
            selector,
        )

    return await _cdp_type_text(text)


# ---------------------------------------------------------------------------
# Browser lifecycle
# ---------------------------------------------------------------------------

async def _ensure_browser() -> tuple[bool, Optional[str]]:
    """Lazily launch Chrome via CDP — uses system Chrome with user's profile."""
    if await _page_is_alive():
        return True, None

    print("[browser-server] Page not alive, cleaning up before re-launch...", flush=True)
    await _close_browser()

    profile_dir = _current_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)

    headless = state._config["mode"] == "headless"

    try:
        browser = CDPBrowser()
        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        )

        page = await browser.launch(
            profile_dir=str(profile_dir),
            headless=headless,
            width=1280,
            height=900,
            user_agent=user_agent,
        )

        state._browser = browser
        state._page = page
        # Reserve the launch tab as the default page; sessions never claim it, so the
        # sidebar mirror / legacy callers keep a stable foreground tab.
        state._default_target_id = browser._active_id
        state._viewport_cache["w"] = 1280
        state._viewport_cache["h"] = 900

        # Restore cookies after launch so auth survives fast mode switches.
        await _restore_cookie_backup(profile_dir)

        mode_label = "headless" if headless else "headed"
        print(f"[browser-server] Launched {mode_label} Chrome via CDP (profile: {profile_dir})", flush=True)
        return True, None
    except Exception as err:
        print(f"[browser-server] Chrome launch failed: {err}", flush=True)
        try:
            if state._browser:
                await state._browser.close()
        except Exception:
            pass
        state._browser = state._page = None
        return False, f"Chrome launch failed: {err}"


async def _get_child_frames() -> list[dict]:
    """Get child frames (iframes) with their CDP execution context IDs."""
    page = _active_page()
    if page is None:
        return []
    try:
        result = await page.send("Page.getFrameTree")
        frames: list[dict] = []

        def _collect(tree: dict, depth: int = 0) -> None:
            for child in tree.get("childFrames", []):
                f = child.get("frame", {})
                fid = f.get("id", "")
                frames.append({
                    "frameId": fid,
                    "url": f.get("url", ""),
                    "name": f.get("name", ""),
                    "contextId": page._frame_contexts.get(fid),
                })
                _collect(child, depth + 1)

        _collect(result.get("frameTree", {}))
        return frames
    except Exception:
        return []


async def _evaluate_in_frame(frame_id: str, js_arrow_fn: str, *args: Any) -> Any:
    """Evaluate JS in a child frame's execution context."""
    page = _active_page()
    if page is None:
        return ""
    ctx_id = page._frame_contexts.get(frame_id)
    if ctx_id is None:
        return ""
    try:
        coro = page.evaluate_in_context(ctx_id, js_arrow_fn, *args)
        return await asyncio.wait_for(coro, timeout=30.0)
    except asyncio.TimeoutError:
        return ""
    except Exception:
        return ""


async def _close_browser(profile_dir: Path | None = None) -> None:
    """Save cookies and shut down Chrome."""
    target_profile_dir = profile_dir or _current_profile_dir()

    # Save the full cookie jar before closing.
    try:
        if state._page and state._page.is_connected:
            result = await asyncio.wait_for(
                state._page.send("Network.getAllCookies"), timeout=3.0
            )
            cookies = result.get("cookies", [])
            _save_cookie_backup(target_profile_dir, cookies)
    except Exception:
        pass

    try:
        if state._browser:
            await asyncio.wait_for(state._browser.close(), timeout=10.0)
    except Exception:
        pass

    state._browser = state._page = None
    state._default_target_id = None
    state._tab_session_targets.clear()
    state._tab_target_owners.clear()
    state._tab_session_touched.clear()
    state._session_locks.clear()
