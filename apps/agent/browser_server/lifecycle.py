"""Browser lifecycle: initialization, page state, shutdown."""

import asyncio
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from browser_server import state
from browser_server.utils import _clamp_int, _normalize_wait_until, _is_allowed_url
from browser_server.profile import _current_profile_dir

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext

_SESSION_COOKIES_FILE = "stuard_session_cookies.json"


def _save_session_cookies(profile_dir: Path, cookies: list[Any]) -> None:
    """Persist session cookies (expires=-1) to a JSON file in the profile dir.

    Chromium never writes these to its Cookies database because they're
    designed to expire when the browser closes. We save them ourselves so
    they survive browser restarts (mode switches, app restarts, etc.).
    """
    session_cookies = [c for c in cookies if c.get("expires", 0) == -1]
    if not session_cookies:
        return
    try:
        (profile_dir / _SESSION_COOKIES_FILE).write_text(
            json.dumps(session_cookies), encoding="utf-8"
        )
    except Exception:
        pass


def _restore_session_cookies(profile_dir: Path, context: "BrowserContext") -> None:
    """Synchronously schedule re-injection of saved session cookies into a new context.

    Called right after launch_persistent_context so cookies are in place
    before the first navigation occurs.
    """
    cookie_file = profile_dir / _SESSION_COOKIES_FILE
    if not cookie_file.exists():
        return
    try:
        cookies = json.loads(cookie_file.read_text(encoding="utf-8"))
        if cookies:
            asyncio.ensure_future(context.add_cookies(cookies))
    except Exception:
        pass


async def _page_is_alive() -> bool:
    if state._page is None:
        return False
    try:
        if state._page.is_closed():
            return False
        # Verify the page is actually usable — is_closed() can return False
        # even when the execution context is destroyed (e.g. after force stop
        # during navigation). Do a quick evaluate to confirm.
        await asyncio.wait_for(state._page.evaluate("() => true"), timeout=2.0)
        return True
    except Exception:
        return False


async def _get_page_url() -> str:
    if state._page is None:
        return ""
    try:
        return state._page.url or ""
    except Exception:
        return ""


async def _get_page_title(timeout: float | None = None) -> str:
    if state._page is None:
        return ""
    try:
        coro = state._page.title()
        if timeout:
            return await asyncio.wait_for(coro, timeout=timeout)
        return await coro
    except Exception:
        return ""


async def _evaluate(js_arrow_fn: str, *args: Any) -> Any:
    if state._page is None:
        return ""
    try:
        if len(args) == 0:
            coro = state._page.evaluate(js_arrow_fn)
        elif len(args) == 1:
            coro = state._page.evaluate(js_arrow_fn, args[0])
        else:
            coro = state._page.evaluate(js_arrow_fn, list(args))
        return await asyncio.wait_for(coro, timeout=30.0)
    except asyncio.TimeoutError:
        return ""
    except Exception as exc:
        # If execution context is destroyed, mark the page as dead so
        # _ensure_browser will re-launch on the next call.
        msg = str(exc).lower()
        if "execution context" in msg or "destroyed" in msg or "target closed" in msg:
            print(f"[browser-server] Page execution context lost, will re-launch: {exc}", flush=True)
            state._page = None
        raise


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
    try:
        await state._page.goto(url, wait_until=wait_until, timeout=timeout)
    except TypeError:
        await state._page.goto(url)
        await _wait_for_ready(wait_until=wait_until, timeout=timeout)


async def _find_elements(selector: str) -> list[Any]:
    if state._page is None:
        return []

    class _PlaywrightElement:
        def __init__(self, page, css: str):
            self._page = page
            self._css = css

        async def click(self) -> None:
            await self._page.click(self._css)

        async def fill(self, value: str, clear: bool = True) -> None:
            if clear:
                await self._page.fill(self._css, value)
            else:
                await self._page.type(self._css, value)

    return [_PlaywrightElement(state._page, selector)]


def _is_playwright_page(obj: Any) -> bool:
    """Check if an object is a Playwright Page (has locator + fill + get_by_text)."""
    return obj is not None and hasattr(obj, "locator") and hasattr(obj, "fill") and hasattr(obj, "get_by_text")


def _get_playwright_page() -> Any:
    """Return the underlying Playwright Page object.

    state._page IS always a Playwright page now.
    """
    if state._page is None:
        return None

    if _is_playwright_page(state._page):
        return state._page

    # Fallback: check context pages
    if state._context and hasattr(state._context, "pages"):
        pages = state._context.pages if not callable(state._context.pages) else []
        for p in pages:
            if _is_playwright_page(p):
                return p

    return None


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


async def _ensure_browser() -> tuple[bool, Optional[str]]:
    """Lazily start the browser + context + page.

    Uses a single persistent Playwright Chromium instance that remembers
    passwords, Google auth, cookies, etc. across sessions.
    """
    if await _page_is_alive():
        return True, None

    # Page is dead/gone — clean up stale Playwright resources before re-launching.
    # Without this, a force-stop during navigation leaves a zombie context that
    # blocks the persistent-context profile directory lock.
    print("[browser-server] Page not alive, cleaning up before re-launch...", flush=True)
    await _close_browser()

    profile_dir = _current_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)

    headless = state._config["mode"] == "headless"

    try:
        from playwright.async_api import async_playwright

        pw_instance = await async_playwright().start()
        state._playwright = pw_instance

        launch_args: list[str] = [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-infobars",
            # Hide automation signals that SSO providers (ForgeRock, Shibboleth, etc.)
            # use to detect and block headless/automated browsers.
            "--disable-blink-features=AutomationControlled",
        ]

        # Use a realistic user agent so SSO providers can't fingerprint headless mode.
        # Playwright's default headless UA contains "HeadlessChrome" which is a dead
        # giveaway that triggers bot-detection on many SSO login flows.
        user_agent = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        )

        state._context = await pw_instance.chromium.launch_persistent_context(
            str(profile_dir),
            headless=headless,
            args=launch_args,
            ignore_default_args=["--enable-automation"],
            user_agent=user_agent,
            viewport={"width": 1280, "height": 900},
            no_viewport=False,
        )

        # Patch navigator.webdriver at the page level — belt-and-suspenders on top of
        # --disable-blink-features=AutomationControlled, since some SSO providers check
        # this property directly and the flag alone isn't always reliable in persistent contexts.
        await state._context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )

        # Restore session cookies (expires=-1) that Chromium doesn't write to disk.
        # Without this, sites like Canvas lose their auth state every time the browser
        # restarts because their session cookies are never persisted by Chromium itself.
        _restore_session_cookies(profile_dir, state._context)

        pages = state._context.pages
        state._page = pages[0] if pages else await state._context.new_page()

        mode_label = "headless" if headless else "headed"
        print(f"[browser-server] Launched {mode_label} Chromium (profile: {profile_dir})", flush=True)
        return True, None
    except Exception as pw_err:
        print(f"[browser-server] Browser launch failed: {pw_err}", flush=True)
        try:
            if state._context:
                await state._context.close()
        except Exception:
            pass
        state._context = state._page = None
        return False, f"Browser launch failed: {pw_err}"


async def _close_browser():
    # Use timeouts on every close operation — if the browser process
    # crashed or the protocol pipe is broken, these can hang forever.
    try:
        if state._cdp_session:
            await asyncio.wait_for(state._cdp_session.detach(), timeout=5.0)
    except Exception:
        pass

    # Save session cookies before closing so they survive the restart.
    try:
        if state._context is not None:
            cookies = await asyncio.wait_for(state._context.cookies(), timeout=3.0)
            _save_session_cookies(_current_profile_dir(), cookies)
    except Exception:
        pass

    try:
        if state._context:
            await asyncio.wait_for(state._context.close(), timeout=10.0)
    except Exception:
        pass

    try:
        if state._playwright:
            await asyncio.wait_for(state._playwright.stop(), timeout=5.0)
    except Exception:
        pass
    state._context = state._page = state._playwright = state._cdp_session = None
