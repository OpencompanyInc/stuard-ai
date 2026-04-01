"""Config / status HTTP handlers for the browser server."""

from __future__ import annotations

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _normalize_profile_name
from browser_server.profile import _current_profile_dir
from browser_server.lifecycle import _page_is_alive, _get_page_url, _get_page_title, _close_browser, _ensure_browser
from browser_server.cdp_client import _find_chrome


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

_browser_check_cache: bool | None = None  # cached browser binary check


def _check_browser_installed() -> bool:
    """Check if a Chrome-compatible browser binary is available."""
    try:
        return bool(_find_chrome())
    except Exception:
        return False


async def handle_status(_req: web.Request) -> web.Response:
    global _browser_check_cache

    # If the browser is already running, the binary is definitely available.
    browser_running = await _page_is_alive()
    if browser_running:
        has_browser = True
        _browser_check_cache = True
    elif _browser_check_cache is not None:
        has_browser = _browser_check_cache
    else:
        import asyncio
        has_browser = await asyncio.to_thread(_check_browser_installed)
        _browser_check_cache = has_browser

    current_url = ""
    title = ""
    if browser_running and state._page is not None:
        current_url = await _get_page_url()
        title = await _get_page_title(timeout=0.75)

    return _ok({
        "installed": has_browser,
        "running": browser_running,
        "mode": state._config["mode"],
        "profile": state._config["profile"],
        "profileDir": str(_current_profile_dir()),
        "currentUrl": current_url,
        "title": title,
        "engine": "chrome-cdp",
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
