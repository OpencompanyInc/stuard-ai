"""Config / status HTTP handlers for the browser server."""

from __future__ import annotations

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _normalize_profile_name, _is_allowed_url
from browser_server.profile import _current_profile_dir
from browser_server.lifecycle import (
    _page_is_alive,
    _get_page_url,
    _get_page_title,
    _goto,
    _close_browser,
    _ensure_browser,
)
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
    requested_mode = body.get("mode")
    requested_profile = body.get("profile") if "profile" in body else None

    async with state._lock:
        current_mode = str(state._config.get("mode") or "headless")
        current_profile = str(state._config.get("profile") or "default")
        next_mode = requested_mode if requested_mode in ("headed", "headless") else current_mode
        next_profile = (
            _normalize_profile_name(requested_profile)
            if requested_profile is not None
            else current_profile
        )

        was_running = await _page_is_alive()
        needs_restart = was_running and (
            next_mode != current_mode or next_profile != current_profile
        )
        resume_url = ""
        if was_running:
            resume_url = await _get_page_url()

        if needs_restart:
            old_profile_dir = _current_profile_dir()
            await _close_browser(profile_dir=old_profile_dir)

        state._config["mode"] = next_mode
        state._config["profile"] = next_profile

        if was_running and not needs_restart:
            return _ok({
                "mode": state._config["mode"],
                "profile": state._config["profile"],
                "restarted": False,
                "running": True,
            })

        # Start browser with new config so it's immediately usable
        ok, err = await _ensure_browser()
        if ok and needs_restart and _is_allowed_url(resume_url) and resume_url != "about:blank":
            try:
                await _goto(resume_url, wait_until="domcontentloaded", timeout=30000)
            except Exception:
                pass

    result = {
        "mode": state._config["mode"],
        "profile": state._config["profile"],
        "restarted": needs_restart,
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
