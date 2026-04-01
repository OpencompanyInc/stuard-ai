"""Browser lifecycle: initialization, page state, shutdown — pure CDP."""

import asyncio
import base64
import json
from pathlib import Path
from typing import Any, Optional

from browser_server import state
from browser_server.utils import _clamp_int, _normalize_wait_until, _is_allowed_url
from browser_server.profile import _current_profile_dir
from browser_server.cdp_client import CDPBrowser

_SESSION_COOKIES_FILE = "stuard_session_cookies.json"


# ---------------------------------------------------------------------------
# Session cookie persistence (Chromium never writes expires=-1 to disk)
# ---------------------------------------------------------------------------

def _save_session_cookies(profile_dir: Path, cookies: list[dict]) -> None:
    """Persist session cookies to a JSON file so they survive browser restarts."""
    session_cookies = [c for c in cookies if c.get("expires", 0) == -1 or c.get("session", False)]
    if not session_cookies:
        return
    try:
        (profile_dir / _SESSION_COOKIES_FILE).write_text(
            json.dumps(session_cookies), encoding="utf-8"
        )
    except Exception:
        pass


async def _restore_session_cookies(profile_dir: Path) -> None:
    """Re-inject saved session cookies via CDP Network.setCookies."""
    cookie_file = profile_dir / _SESSION_COOKIES_FILE
    if not cookie_file.exists():
        return
    try:
        cookies = json.loads(cookie_file.read_text(encoding="utf-8"))
        if cookies and state._page and state._page.is_connected:
            cdp_cookies = []
            for c in cookies:
                cc: dict[str, Any] = {
                    "name": c.get("name", ""),
                    "value": c.get("value", ""),
                    "domain": c.get("domain", ""),
                    "path": c.get("path", "/"),
                }
                if c.get("secure"):
                    cc["secure"] = True
                if c.get("httpOnly"):
                    cc["httpOnly"] = True
                if c.get("sameSite"):
                    cc["sameSite"] = c["sameSite"]
                cdp_cookies.append(cc)
            if cdp_cookies:
                await state._page.send("Network.setCookies", {"cookies": cdp_cookies})
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Page state helpers
# ---------------------------------------------------------------------------

async def _page_is_alive() -> bool:
    if state._page is None or not state._page.is_connected:
        return False
    try:
        result = await asyncio.wait_for(
            state._page.evaluate("() => true"), timeout=2.0
        )
        return result is True
    except Exception:
        return False


async def _get_page_url() -> str:
    if state._page is None:
        return ""
    try:
        return str(await state._page.evaluate("() => window.location.href") or "")
    except Exception:
        return ""


async def _get_page_title(timeout: float | None = None) -> str:
    if state._page is None:
        return ""
    try:
        coro = state._page.evaluate("() => document.title")
        if timeout:
            return str(await asyncio.wait_for(coro, timeout=timeout) or "")
        return str(await coro or "")
    except Exception:
        return ""


async def _capture_screenshot(
    image_format: str = "png",
    *,
    quality: int | None = None,
    full_page: bool = False,
) -> bytes:
    """Capture a screenshot from the active page via CDP."""
    if state._page is None:
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
            metrics = await state._page.send("Page.getLayoutMetrics")
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

    result = await state._page.send("Page.captureScreenshot", params)
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
    if state._page is None:
        return ""
    try:
        coro = state._page.evaluate(js_arrow_fn, *args)
        return await asyncio.wait_for(coro, timeout=30.0)
    except asyncio.TimeoutError:
        return ""
    except Exception as exc:
        msg = str(exc).lower()
        if "context" in msg or "destroyed" in msg or "closed" in msg or "connection" in msg:
            print(f"[browser-server] Page connection lost, will re-launch: {exc}", flush=True)
            state._page = None
        raise


# ---------------------------------------------------------------------------
# Navigation & waiting
# ---------------------------------------------------------------------------

async def _wait_for_ready(wait_until: str = "domcontentloaded", timeout: int = 30000) -> None:
    if state._page is None:
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
                  const el = document.querySelector(String(sel));
                  if (!el) return false;
                  const style = window.getComputedStyle(el);
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
    if state._page is None:
        raise RuntimeError("No active page")
    wait_until = _normalize_wait_until(wait_until)
    timeout = _clamp_int(timeout, 30000, 1000, 180000)
    # CDP Page.navigate starts the navigation; then we poll readyState
    await state._page.send("Page.navigate", {"url": url})
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
                        const el = document.querySelector(sel);
                        if (!el) return false;
                        const r = el.getBoundingClientRect();
                        const s = window.getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                    }""",
                    selector,
                )
                if bool(found):
                    return True
            if text:
                found = await _evaluate(
                    """(needle) => {
                        const all = document.querySelectorAll('*');
                        for (const el of all) {
                            const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
                            if (t && t.toLowerCase().includes(String(needle).toLowerCase())) {
                                const r = el.getBoundingClientRect();
                                const s = window.getComputedStyle(el);
                                if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden') return true;
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
    if state._page is None:
        raise RuntimeError("No active page")
    ix, iy = int(x), int(y)
    await state._page.send("Input.dispatchMouseEvent",
                           {"type": "mouseMoved", "x": ix, "y": iy})
    await asyncio.sleep(0.02)
    await state._page.send("Input.dispatchMouseEvent",
                           {"type": "mousePressed", "x": ix, "y": iy,
                            "button": "left", "clickCount": click_count})
    await asyncio.sleep(0.05)
    await state._page.send("Input.dispatchMouseEvent",
                           {"type": "mouseReleased", "x": ix, "y": iy,
                            "button": "left", "clickCount": click_count})


async def _cdp_click_selector(selector: str) -> bool:
    """Find an element by CSS, scroll it into view, and click via CDP mouse."""
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
        try:
            await _cdp_click_at(float(coords["x"]), float(coords["y"]))
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
    return result is True


async def _cdp_type_text(text: str) -> bool:
    """Type text char-by-char via CDP Input.dispatchKeyEvent."""
    if state._page is None:
        return False
    try:
        for char in text:
            if char == "\n":
                await state._page.send("Input.dispatchKeyEvent",
                    {"type": "keyDown", "key": "Enter", "code": "Enter",
                     "windowsVirtualKeyCode": 13})
                await asyncio.sleep(0.001)
                await state._page.send("Input.dispatchKeyEvent",
                    {"type": "char", "text": "\r", "key": "Enter"})
                await state._page.send("Input.dispatchKeyEvent",
                    {"type": "keyUp", "key": "Enter", "code": "Enter",
                     "windowsVirtualKeyCode": 13})
            else:
                await state._page.send("Input.dispatchKeyEvent",
                    {"type": "keyDown", "key": char,
                     "code": f"Key{char.upper()}" if char.isalpha() else char})
                await asyncio.sleep(0.001)
                await state._page.send("Input.dispatchKeyEvent",
                    {"type": "char", "text": char, "key": char})
                await state._page.send("Input.dispatchKeyEvent",
                    {"type": "keyUp", "key": char,
                     "code": f"Key{char.upper()}" if char.isalpha() else char})
            await asyncio.sleep(0.03)
        return True
    except Exception:
        return False


async def _cdp_press_key(key: str) -> bool:
    """Press a key or key combo (e.g. 'Enter', 'Control+a') via CDP."""
    if state._page is None:
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
            await state._page.send("Input.dispatchKeyEvent", {
                "type": "keyDown", "key": mk, "code": mk + "Left",
                "windowsVirtualKeyCode": _KEY_CODES.get(mk, 0),
                "modifiers": modifiers,
            })

        key_code = _KEY_CODES.get(main_key, 0)
        if not key_code and len(main_key) == 1:
            key_code = ord(main_key.upper())

        await state._page.send("Input.dispatchKeyEvent", {
            "type": "keyDown", "key": main_key,
            "code": f"Key{main_key.upper()}" if len(main_key) == 1 and main_key.isalpha() else main_key,
            "windowsVirtualKeyCode": key_code,
            "modifiers": modifiers,
        })
        if len(main_key) == 1:
            await state._page.send("Input.dispatchKeyEvent", {
                "type": "char", "text": main_key, "key": main_key,
                "modifiers": modifiers,
            })
        await state._page.send("Input.dispatchKeyEvent", {
            "type": "keyUp", "key": main_key,
            "code": f"Key{main_key.upper()}" if len(main_key) == 1 and main_key.isalpha() else main_key,
            "windowsVirtualKeyCode": key_code,
            "modifiers": modifiers,
        })

        # Release modifier keys
        for mk in reversed(mod_keys):
            await state._page.send("Input.dispatchKeyEvent", {
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
        state._viewport_cache["w"] = 1280
        state._viewport_cache["h"] = 900

        # Restore session cookies that Chromium doesn't persist
        await _restore_session_cookies(profile_dir)

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


async def _close_browser() -> None:
    """Save session cookies and shut down Chrome."""
    # Save session cookies before closing
    try:
        if state._page and state._page.is_connected:
            result = await asyncio.wait_for(
                state._page.send("Network.getAllCookies"), timeout=3.0
            )
            cookies = result.get("cookies", [])
            _save_session_cookies(_current_profile_dir(), cookies)
    except Exception:
        pass

    try:
        if state._browser:
            await asyncio.wait_for(state._browser.close(), timeout=10.0)
    except Exception:
        pass

    state._browser = state._page = None
