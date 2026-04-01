"""Config / status HTTP handlers for the browser server."""

from __future__ import annotations

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _normalize_profile_name
from browser_server.profile import _current_profile_dir
from browser_server.lifecycle import _page_is_alive, _get_page_url, _get_page_title, _close_browser, _ensure_browser


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

_chromium_check_cache: bool | None = None  # cached chromium binary check


def _check_chromium_installed() -> bool:
    """Check if playwright pip package AND Chromium binary exist (sync, for thread)."""
    try:
        from playwright.sync_api import sync_playwright
        import os
        p = sync_playwright().start()
        exe = p.chromium.executable_path
        p.stop()
        return bool(exe and os.path.exists(exe))
    except Exception:
        return False


async def handle_status(_req: web.Request) -> web.Response:
    global _chromium_check_cache
    has_playwright = True
    try:
        import playwright  # noqa: F401
    except ImportError:
        has_playwright = False

    # If browser is already running, chromium is definitely installed
    browser_running = await _page_is_alive()
    if browser_running:
        has_chromium = True
        _chromium_check_cache = True
    elif _chromium_check_cache is not None:
        has_chromium = _chromium_check_cache
    elif has_playwright:
        import asyncio
        has_chromium = await asyncio.to_thread(_check_chromium_installed)
        _chromium_check_cache = has_chromium
    else:
        has_chromium = False

    current_url = ""
    title = ""
    if browser_running and state._page is not None:
        current_url = await _get_page_url()
        title = await _get_page_title(timeout=0.75)

    return _ok({
        "installed": has_playwright and has_chromium,
        "running": browser_running,
        "mode": state._config["mode"],
        "profile": state._config["profile"],
        "profileDir": str(_current_profile_dir()),
        "currentUrl": current_url,
        "title": title,
    })


# ---------------------------------------------------------------------------
# POST /configure
# ---------------------------------------------------------------------------

async def handle_configure(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    mode = body.get("mode")
    if mode and mode in ("headed", "headless"):
        state._config["mode"] = mode
    if "profile" in body:
        state._config["profile"] = _normalize_profile_name(body["profile"])

    async with state._lock:
        was_running = await _page_is_alive()
        if was_running:
            # _close_browser saves session cookies before closing so they are
            # restored automatically when _ensure_browser opens the new context.
            await _close_browser()

        # Start browser with new config so it's immediately usable
        ok, err = await _ensure_browser()

    result = {
        "mode": state._config["mode"],
        "profile": state._config["profile"],
        "restarted": was_running,
        "running": ok,
    }
    if not ok and err:
        result["error"] = err
    return _ok(result)


# ---------------------------------------------------------------------------
# POST /task (disabled)
# ---------------------------------------------------------------------------

async def handle_task(req: web.Request) -> web.Response:
    return _err(
        "browser_use_task is disabled. Use browser_use_execute_script for complex page logic.",
        status=410,
    )
