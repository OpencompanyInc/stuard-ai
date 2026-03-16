"""Browser lifecycle: initialization, page state, shutdown."""

import asyncio
from pathlib import Path
from typing import Any, Optional

from browser_server import state
from browser_server.utils import _clamp_int, _normalize_wait_until, _is_allowed_url
from browser_server.profile import (
    _current_profile_dir,
    _read_sync_meta,
    _managed_profile_dir_name,
    _browser_launch_overrides,
    _resolve_real_browser_profile,
    _detect_chrome_debug_port,
    _auto_setup_debug_port_if_needed,
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
        if hasattr(state._page, "is_closed"):
            return not state._page.is_closed()
        if hasattr(state._page, "get_url"):
            await state._page.get_url()
            return True
        return True
    except Exception:
        return False


async def _get_page_url() -> str:
    if state._page is None:
        return ""
    try:
        if hasattr(state._page, "get_url"):
            return await state._page.get_url()
        return getattr(state._page, "url", "") or ""
    except Exception:
        return ""


async def _get_page_title(timeout: float | None = None) -> str:
    if state._page is None:
        return ""
    try:
        if hasattr(state._page, "get_title"):
            coro = state._page.get_title()
        elif hasattr(state._page, "title"):
            coro = state._page.title()
        else:
            return ""
        if timeout:
            return await asyncio.wait_for(coro, timeout=timeout)
        return await coro
    except Exception:
        return ""


async def _evaluate(js_arrow_fn: str, *args: Any) -> Any:
    if state._page is None:
        return ""
    if hasattr(state._page, "evaluate"):
        return await state._page.evaluate(js_arrow_fn, *args)
    if args:
        raise RuntimeError("This page implementation does not support evaluate args")
    return str(await state._page.evaluate(js_arrow_fn))


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
    if hasattr(state._page, "navigate"):
        await state._page.navigate(url)
        await _wait_for_ready(wait_until=wait_until, timeout=timeout)
        return
    if hasattr(state._page, "goto"):
        try:
            await state._page.goto(url, wait_until=wait_until, timeout=timeout)
        except TypeError:
            await state._page.goto(url)
            await _wait_for_ready(wait_until=wait_until, timeout=timeout)
        return
    raise RuntimeError("Page navigation is not supported")


async def _find_elements(selector: str) -> list[Any]:
    if state._page is None:
        return []
    if hasattr(state._page, "get_elements_by_css_selector"):
        return await state._page.get_elements_by_css_selector(selector)

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


def _get_playwright_page() -> Any:
    if state._page is None:
        return None
    if hasattr(state._page, "locator") and hasattr(state._page, "fill") and hasattr(state._page, "get_by_text"):
        return state._page
    for attr in ("_page", "page", "_playwright_page", "playwright_page"):
        inner = getattr(state._page, attr, None)
        if inner and hasattr(inner, "locator") and hasattr(inner, "fill"):
            return inner
    if state._context and hasattr(state._context, "pages"):
        pages = state._context.pages if not callable(state._context.pages) else []
        if pages:
            return pages[0]
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
        print(f"[browser-use-server] No cookies read from Chrome profile", flush=True)
        return

    try:
        result = await _inject_cookies_into_session(cookies)
        injected = result.get("injected", 0)
        failed = result.get("failed", 0)
        print(f"[browser-use-server] Auto-injected {injected} cookies ({failed} failed) from {source_profile_path}", flush=True)
    except Exception as e:
        print(f"[browser-use-server] Cookie injection error: {e}", flush=True)


async def _ensure_browser() -> tuple[bool, Optional[str]]:
    """Lazily start the browser + context + page.

    Uses Playwright's launch_persistent_context for proper cookie/auth persistence.
    Falls back to browser-use library if Playwright direct launch fails.
    """
    if await _page_is_alive():
        return True, None
    state._page = None

    profile_dir = _current_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)
    sync_meta = _read_sync_meta(profile_dir)
    launch_overrides = _browser_launch_overrides(sync_meta)
    managed_profile_dir_name_val = _managed_profile_dir_name(sync_meta)

    headless = state._config["mode"] == "headless"
    cdp_url = state._config.get("cdp_url") if state._config["mode"] == "connect" else None

    resolved_profile = _resolve_real_browser_profile(sync_meta)

    if resolved_profile:
        effective_user_data_dir = resolved_profile["userDataDir"]
        effective_profile_name = resolved_profile["profileName"]
        use_real_profile = True
        browser_is_running = resolved_profile.get("wasActive", False)
    else:
        effective_user_data_dir = str(profile_dir)
        effective_profile_name = managed_profile_dir_name_val
        use_real_profile = False
        browser_is_running = False

    full_profile_path = Path(effective_user_data_dir) / effective_profile_name
    if not full_profile_path.exists():
        full_profile_path = Path(effective_user_data_dir)

    # ── Strategy 0: Connect to running Chrome via CDP ──
    if not cdp_url and browser_is_running and use_real_profile:
        cdp_port = _detect_chrome_debug_port(effective_user_data_dir)
        if cdp_port:
            cdp_url = f"http://127.0.0.1:{cdp_port}"
            print(f"[browser-use-server] Chrome is running with debug port {cdp_port} — connecting via CDP",
                  flush=True)

    if cdp_url:
        try:
            from playwright.async_api import async_playwright
            pw_instance = await async_playwright().start()
            state._playwright = pw_instance

            browser_obj = await pw_instance.chromium.connect_over_cdp(cdp_url)
            contexts = browser_obj.contexts
            if contexts:
                state._context = contexts[0]
                pages = state._context.pages
                state._page = pages[0] if pages else await state._context.new_page()
            else:
                state._context = await browser_obj.new_context()
                state._page = await state._context.new_page()

            state._browser = None
            print(f"[browser-use-server] Connected to running Chrome via CDP ({cdp_url})",
                  flush=True)
            return True, None
        except Exception as cdp_err:
            print(f"[browser-use-server] CDP connection failed: {cdp_err}", flush=True)
            state._browser = state._context = state._page = None
            cdp_url = None

    # ── Strategy 1: Playwright persistent context (BEST for auth) ──
    if not cdp_url and not browser_is_running:
        try:
            from playwright.async_api import async_playwright

            pw_instance = await async_playwright().start()

            launch_args: list[str] = [
                f"--profile-directory={effective_profile_name}",
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ]

            launch_kwargs: dict[str, Any] = {
                "headless": headless,
                "args": launch_args,
                "ignore_default_args": ["--enable-automation", "--no-sandbox"],
                "viewport": {"width": 1280, "height": 900},
                "no_viewport": False,
            }

            exe = launch_overrides.get("executable_path")
            channel = launch_overrides.get("channel")
            if exe:
                launch_kwargs["executable_path"] = exe
            elif channel:
                launch_kwargs["channel"] = channel

            state._context = await pw_instance.chromium.launch_persistent_context(
                effective_user_data_dir,
                **launch_kwargs,
            )
            state._browser = None
            pages = state._context.pages
            state._page = pages[0] if pages else await state._context.new_page()

            mode_label = "REAL profile" if use_real_profile else "managed profile"
            print(f"[browser-use-server] Launched persistent context ({mode_label}) from {effective_user_data_dir} "
                  f"(profile: {effective_profile_name}, exe: {exe or channel or 'default'})",
                  flush=True)

            return True, None
        except Exception as pw_err:
            print(f"[browser-use-server] Playwright persistent context failed, falling back to browser-use: {pw_err}", flush=True)
            try:
                if state._context:
                    await state._context.close()
            except Exception:
                pass
            state._browser = state._context = state._page = None

    if browser_is_running and use_real_profile:
        _auto_setup_debug_port_if_needed(effective_user_data_dir)
        print(f"[browser-use-server] Falling back to browser-use library (no auth persistence).", flush=True)

    # ── Strategy 2: browser-use library (fallback) ──
    try:
        from browser_use import Browser
    except ImportError:
        return False, "browser-use is not installed. Run: pip install browser-use"
    except Exception as e:
        return False, f"browser-use import failed: {e}"

    try:
        BrowserConfig = None
        try:
            from browser_use import BrowserConfig as _BrowserConfig  # type: ignore
            BrowserConfig = _BrowserConfig
        except Exception:
            BrowserConfig = None

        if BrowserConfig is not None:
            config_kwargs: dict[str, Any] = {"headless": headless}
            if cdp_url:
                config_kwargs["cdp_url"] = cdp_url
            else:
                config_kwargs["chrome_instance_path"] = launch_overrides.get("executable_path")
                config_kwargs["extra_chromium_args"] = [
                    f"--user-data-dir={profile_dir}",
                    f"--profile-directory={managed_profile_dir_name_val}",
                    "--disable-blink-features=AutomationControlled",
                ]

            state._browser = await asyncio.to_thread(lambda: Browser(config=BrowserConfig(**config_kwargs)))

            state._context = None
            try:
                if hasattr(state._browser, "browser") and hasattr(state._browser.browser, "contexts"):
                    contexts = state._browser.browser.contexts
                    if contexts:
                        state._context = contexts[0]
                        print("[browser-use-server] Using default browser context (preserves auth)", flush=True)
            except Exception:
                pass

            if state._context is None:
                state._context = await state._browser.new_context()
                print("[browser-use-server] Warning: Using new_context() — auth may not persist", flush=True)

            pages = state._context.pages if hasattr(state._context, "pages") else []
            state._page = pages[0] if pages else await state._context.new_page()
        else:
            browser_kwargs: dict[str, Any] = {
                "headless": headless,
                "is_local": True,
            }
            if cdp_url:
                browser_kwargs["cdp_url"] = cdp_url
            else:
                browser_kwargs["user_data_dir"] = str(profile_dir)
                browser_kwargs["profile_directory"] = managed_profile_dir_name_val
                browser_kwargs["args"] = [
                    f"--user-data-dir={profile_dir}",
                    f"--profile-directory={managed_profile_dir_name_val}",
                    "--disable-blink-features=AutomationControlled",
                ]
                if launch_overrides.get("channel"):
                    browser_kwargs["channel"] = launch_overrides["channel"]
                if launch_overrides.get("executable_path"):
                    browser_kwargs["executable_path"] = launch_overrides["executable_path"]

            state._browser = Browser(**browser_kwargs)
            state._context = None
            if hasattr(state._browser, "start"):
                await state._browser.start()
            pages_list: list[Any] = []
            if hasattr(state._browser, "get_pages"):
                try:
                    pages_list = await state._browser.get_pages()
                except Exception:
                    pages_list = []
            state._page = pages_list[0] if pages_list else await state._browser.new_page()

        try:
            await _auto_inject_cookies_on_startup()
        except Exception as cookie_err:
            print(f"[browser-use-server] Cookie auto-inject failed (non-fatal): {cookie_err}", flush=True)

        return True, None
    except Exception as e:
        try:
            await _close_browser()
        except Exception:
            pass
        print(f"[browser-use-server] init error: {e}", flush=True)
        return False, f"Browser init failed: {e}"


async def _close_browser():
    try:
        if state._context:
            await state._context.close()
    except Exception:
        pass
    try:
        if state._browser:
            if hasattr(state._browser, "stop"):
                await state._browser.stop()
            elif hasattr(state._browser, "close"):
                await state._browser.close()
            elif hasattr(state._browser, "kill"):
                await state._browser.kill()
    except Exception:
        pass
    state._browser = state._context = state._page = None
