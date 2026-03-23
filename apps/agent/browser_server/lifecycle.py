"""Browser lifecycle: initialization, page state, shutdown."""

import asyncio
from pathlib import Path
from typing import Any, Optional

from browser_server import state
from browser_server.utils import _clamp_int, _normalize_wait_until, _is_allowed_url
from browser_server.profile import (
    _current_profile_dir,
    _read_sync_meta,
)
from browser_server.cookie_sync import (
    _resolve_sync_source,
    _read_chrome_cookies,
    _inject_cookies_into_session,
)


async def _page_is_alive() -> bool:
    if state._page is None:
        return False
    try:
        return not state._page.is_closed()
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
    if len(args) == 0:
        return await state._page.evaluate(js_arrow_fn)
    elif len(args) == 1:
        return await state._page.evaluate(js_arrow_fn, args[0])
    else:
        return await state._page.evaluate(js_arrow_fn, list(args))


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


async def _auto_inject_cookies_on_startup() -> None:
    profile_dir = _current_profile_dir()
    sync_meta = _read_sync_meta(profile_dir)

    source_profile_path = str(sync_meta.get("sourceProfilePath") or "").strip()
    source_user_data_dir = str(sync_meta.get("sourceUserDataDir") or "").strip()

    if not source_profile_path or not source_user_data_dir:
        resolved = await asyncio.to_thread(
            _resolve_sync_source, None, None, "Chrome", "Default"
        )
        if resolved:
            source_profile_path = str(resolved.get("profilePath") or "")
            source_user_data_dir = str(resolved.get("userDataDir") or "")

    if not source_profile_path or not source_user_data_dir:
        return

    if not Path(source_profile_path).exists():
        return

    cookies = await asyncio.to_thread(_read_chrome_cookies, source_profile_path, source_user_data_dir)
    if not cookies:
        print(f"[browser-server] No cookies read from Chrome profile", flush=True)
        return

    try:
        result = await _inject_cookies_into_session(cookies)
        injected = result.get("injected", 0)
        failed = result.get("failed", 0)
        print(f"[browser-server] Auto-injected {injected} cookies ({failed} failed) from {source_profile_path}", flush=True)
    except Exception as e:
        print(f"[browser-server] Cookie injection error: {e}", flush=True)


async def _ensure_browser() -> tuple[bool, Optional[str]]:
    """Lazily start the browser + context + page.

    Three modes:
    - Headless: Playwright's own Chromium, managed profile
    - Headed: Playwright's own Chromium visible, managed profile
    - Connect: attach to existing browser via CDP URL
    """
    if await _page_is_alive():
        return True, None
    state._page = None
    state._cdp_session = None

    profile_dir = _current_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)

    headless = state._config["mode"] == "headless"
    cdp_url = state._config.get("cdp_url") if state._config["mode"] == "connect" else None

    # ── Headless mode: use Playwright's own Chromium with managed profile ──
    # Never touch the user's running Chrome — just launch a clean instance.
    if headless:
        try:
            from playwright.async_api import async_playwright

            pw_instance = await async_playwright().start()
            state._playwright = pw_instance

            launch_args: list[str] = [
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-infobars",
            ]

            state._context = await pw_instance.chromium.launch_persistent_context(
                str(profile_dir),
                headless=True,
                args=launch_args,
                ignore_default_args=["--enable-automation"],
                viewport={"width": 1280, "height": 900},
                no_viewport=False,
            )
            pages = state._context.pages
            state._page = pages[0] if pages else await state._context.new_page()

            print(f"[browser-server] Launched headless Chromium (managed profile: {profile_dir})",
                  flush=True)

            try:
                await _auto_inject_cookies_on_startup()
            except Exception as cookie_err:
                print(f"[browser-server] Cookie auto-inject failed (non-fatal): {cookie_err}", flush=True)

            return True, None
        except Exception as pw_err:
            print(f"[browser-server] Headless launch failed: {pw_err}", flush=True)
            try:
                if state._context:
                    await state._context.close()
            except Exception:
                pass
            state._context = state._page = None
            return False, f"Headless browser launch failed: {pw_err}"

    # ── Connect mode: attach to user's real browser via CDP ──
    if state._config["mode"] == "connect":
        # Auto-detect or set up CDP if no cdp_url was provided
        if not cdp_url:
            try:
                from browser_server.chrome_manager import ensure_chrome_debug_connection
                cdp_url = await ensure_chrome_debug_connection()
                if cdp_url:
                    state._config["cdp_url"] = cdp_url
                    print(f"[browser-server] Auto-detected CDP URL: {cdp_url}", flush=True)
                else:
                    return False, (
                        "Could not start Chrome with debug port. "
                        "Try closing Chrome completely and reopening it, or launch Chrome manually with:\n"
                        '  chrome.exe --remote-debugging-port=9222 --restore-last-session'
                    )
            except Exception as detect_err:
                print(f"[browser-server] Chrome debug detection failed: {detect_err}", flush=True)
                return False, f"Failed to detect Chrome debug port: {detect_err}"

        # Verify the debug port is actually responding via HTTP before
        # attempting the heavier Playwright CDP handshake.
        import urllib.request
        port_alive = False
        for pre_check in range(8):
            try:
                resp = urllib.request.urlopen(
                    f"{cdp_url}/json/version", timeout=2
                )
                if resp.status == 200:
                    port_alive = True
                    break
            except Exception:
                pass
            if pre_check < 7:
                print(f"[browser-server] Waiting for CDP port ({pre_check + 1}/8)...", flush=True)
                await asyncio.sleep(2)

        if not port_alive:
            print(f"[browser-server] CDP port at {cdp_url} never responded to HTTP", flush=True)
            state._config["cdp_url"] = None  # clear stale URL
            return False, (
                f"Chrome debug port at {cdp_url} is not responding. "
                "Close Chrome completely, then reopen it — the debug port flag "
                "should be configured automatically. If it still fails, launch Chrome with:\n"
                '  chrome.exe --remote-debugging-port=9222 --restore-last-session'
            )

        try:
            from playwright.async_api import async_playwright
            pw_instance = await async_playwright().start()
            state._playwright = pw_instance

            # Retry CDP connection — Chrome may still be finishing startup
            browser_obj = None
            last_err = None
            for attempt in range(6):
                try:
                    browser_obj = await pw_instance.chromium.connect_over_cdp(cdp_url)
                    break
                except Exception as retry_err:
                    last_err = retry_err
                    if attempt < 5:
                        print(f"[browser-server] CDP connect attempt {attempt + 1} failed, retrying in 2s...", flush=True)
                        await asyncio.sleep(2)
            if browser_obj is None:
                raise last_err  # type: ignore[misc]

            state._browser = browser_obj
            contexts = browser_obj.contexts

            # Enumerate all connected contexts (each Chrome profile = separate context)
            context_info: list[dict] = []
            for i, ctx in enumerate(contexts):
                pages = ctx.pages
                page_summaries = []
                for p in pages[:8]:
                    try:
                        title = await asyncio.wait_for(p.title(), timeout=1.0)
                    except Exception:
                        title = ""
                    page_summaries.append({"url": p.url or "", "title": title})
                context_info.append({
                    "index": i,
                    "pageCount": len(pages),
                    "pages": page_summaries,
                })
            state._connected_contexts = context_info

            if len(contexts) > 1:
                print(f"[browser-server] Found {len(contexts)} browser contexts (profiles):", flush=True)
                for info in context_info:
                    first_pages = ", ".join(
                        p.get("title") or p.get("url", "?") for p in info["pages"][:3]
                    )
                    print(f"  [{info['index']}] {info['pageCount']} tabs — {first_pages}", flush=True)

            # Select which context to use
            selected_idx = 0
            connect_profile = state._config.get("connect_profile")
            if connect_profile is not None and contexts:
                if isinstance(connect_profile, int) and 0 <= connect_profile < len(contexts):
                    selected_idx = connect_profile
                elif isinstance(connect_profile, str):
                    if connect_profile.isdigit():
                        idx = int(connect_profile)
                        if 0 <= idx < len(contexts):
                            selected_idx = idx
                    else:
                        # Try to match by page title/URL containing the profile name
                        for info in context_info:
                            needle = connect_profile.lower()
                            for p in info["pages"]:
                                if needle in (p.get("title") or "").lower() or needle in (p.get("url") or "").lower():
                                    selected_idx = info["index"]
                                    break

            if contexts:
                state._context = contexts[selected_idx]
                pages = state._context.pages
                state._page = pages[0] if pages else await state._context.new_page()
                print(f"[browser-server] Using context [{selected_idx}] with {len(pages)} tabs", flush=True)
            else:
                state._context = await browser_obj.new_context()
                state._page = await state._context.new_page()

            print(f"[browser-server] Connected via CDP ({cdp_url})", flush=True)
            return True, None
        except Exception as cdp_err:
            print(f"[browser-server] CDP connection failed: {cdp_err}", flush=True)
            state._context = state._page = None
            return False, f"CDP connection to {cdp_url} failed: {cdp_err}"

    # ── Headed mode: launch Playwright's own Chromium (never touch user's browser) ──
    # Window is positioned off-screen so it doesn't pop up — sidebar mirrors via screenshots.
    try:
        from playwright.async_api import async_playwright

        pw_instance = await async_playwright().start()
        state._playwright = pw_instance

        launch_args: list[str] = [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-infobars",
            "--window-position=-32000,-32000",
        ]

        state._context = await pw_instance.chromium.launch_persistent_context(
            str(profile_dir),
            headless=False,
            args=launch_args,
            ignore_default_args=["--enable-automation"],
            viewport={"width": 1280, "height": 900},
            no_viewport=False,
        )
        pages = state._context.pages
        state._page = pages[0] if pages else await state._context.new_page()

        print(f"[browser-server] Launched headed Chromium (managed profile: {profile_dir})", flush=True)

        try:
            await _auto_inject_cookies_on_startup()
        except Exception as cookie_err:
            print(f"[browser-server] Cookie auto-inject failed (non-fatal): {cookie_err}", flush=True)

        return True, None
    except Exception as pw_err:
        print(f"[browser-server] Headed launch failed: {pw_err}", flush=True)
        try:
            if state._context:
                await state._context.close()
        except Exception:
            pass
        state._context = state._page = None

    return False, "Browser init failed. Ensure playwright is installed: pip install playwright && python -m playwright install chromium"


async def _close_browser():
    is_cdp_connected = state._browser is not None

    try:
        if state._cdp_session:
            await state._cdp_session.detach()
    except Exception:
        pass

    if is_cdp_connected:
        # CDP connect mode — just disconnect, do NOT close the user's browser.
        # Skipping browser.close() intentionally — it would kill their Chrome.
        # playwright.stop() below just tears down the websocket, leaving Chrome running.
        pass
    else:
        # Headed/headless mode — we own this browser, close it.
        try:
            if state._context:
                await state._context.close()
        except Exception:
            pass

    try:
        if state._playwright:
            await state._playwright.stop()
    except Exception:
        pass
    state._context = state._page = state._playwright = state._browser = state._cdp_session = None
    state._connected_contexts = []
