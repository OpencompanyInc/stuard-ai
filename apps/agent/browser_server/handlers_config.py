"""Config / status HTTP handlers for the browser server."""

from __future__ import annotations

import time
from pathlib import Path

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _clamp_int, _normalize_profile_name
from browser_server.profile import _current_profile_dir, _read_sync_meta, _resolve_real_browser_profile, _detect_chrome_debug_port
from browser_server.lifecycle import _page_is_alive, _get_page_url, _get_page_title, _close_browser, _ensure_browser


# ---------------------------------------------------------------------------
# GET /status
# ---------------------------------------------------------------------------

_chromium_check_cache: bool | None = None  # cached chromium binary check
_debug_port_cache: dict | None = None
_debug_port_cache_ts: float = 0.0
_DEBUG_PORT_CACHE_TTL = 30.0  # seconds — avoid spamming _resolve_real_browser_profile


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
    sync_meta = _read_sync_meta(_current_profile_dir())
    if browser_running and state._page is not None:
        current_url = await _get_page_url()
        title = await _get_page_title(timeout=0.75)

    # Cache debug port info to avoid spamming _resolve_real_browser_profile on every poll
    global _debug_port_cache, _debug_port_cache_ts
    now = time.monotonic()
    if _debug_port_cache is None or (now - _debug_port_cache_ts) > _DEBUG_PORT_CACHE_TTL:
        chrome_debug_port = None
        chrome_is_running = False
        debug_port_configured = False
        try:
            resolved = _resolve_real_browser_profile(sync_meta)
            if resolved:
                chrome_is_running = resolved.get("wasActive", False)
                chrome_debug_port = _detect_chrome_debug_port(resolved["userDataDir"])
                marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
                debug_port_configured = marker.exists() or chrome_debug_port is not None
        except Exception:
            pass
        _debug_port_cache = {
            "active": chrome_debug_port is not None,
            "port": chrome_debug_port,
            "configured": debug_port_configured,
            "chromeRunning": chrome_is_running,
        }
        _debug_port_cache_ts = now

    return _ok({
        "installed": has_playwright and has_chromium,
        "running": browser_running,
        "mode": state._config["mode"],
        "profile": state._config["profile"],
        "profileDir": str(_current_profile_dir()),
        "currentUrl": current_url,
        "title": title,
        "chromeSync": {
            "enabled": True,
            "managedProfileRoot": str(_current_profile_dir()),
            "sourceProfilePath": sync_meta.get("sourceProfilePath"),
            "sourceUserDataDir": sync_meta.get("sourceUserDataDir"),
            "sourceProfileName": sync_meta.get("sourceSignature", {}).get("profileName") if isinstance(sync_meta.get("sourceSignature"), dict) else None,
            "lastSyncedAt": sync_meta.get("syncedAt"),
            "mode": sync_meta.get("mode"),
        },
        "debugPort": _debug_port_cache,
    })


# ---------------------------------------------------------------------------
# POST /setup-debug-port
# ---------------------------------------------------------------------------

async def handle_setup_debug_port(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    port = _clamp_int(body.get("port", 9222), 9222, 1024, 65535)
    undo = bool(body.get("undo", False))

    if undo:
        try:
            from app.browser_cookies import enable_chrome_debug_port
        except ImportError:
            from browser_cookies import enable_chrome_debug_port  # type: ignore[no-redef]

        resolved = _resolve_real_browser_profile(_read_sync_meta(_current_profile_dir()))
        if resolved:
            marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
            if marker.exists():
                marker.unlink()
        return _ok({"undone": True, "message": "Debug port marker removed. Manually remove --remote-debugging-port from your Chrome shortcut to fully disable."})

    try:
        from app.browser_cookies import enable_chrome_debug_port
    except ImportError:
        from browser_cookies import enable_chrome_debug_port  # type: ignore[no-redef]

    result = enable_chrome_debug_port(port)

    if result.get("success"):
        resolved = _resolve_real_browser_profile(_read_sync_meta(_current_profile_dir()))
        if resolved:
            try:
                marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
                marker.write_text(str(port))
            except Exception:
                pass

    return _ok(result)


# ---------------------------------------------------------------------------
# POST /configure
# ---------------------------------------------------------------------------

async def handle_configure(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    mode = body.get("mode")
    if mode and mode in ("headed", "headless", "connect"):
        state._config["mode"] = mode
    if "cdp_url" in body:
        state._config["cdp_url"] = body["cdp_url"]
    if "profile" in body:
        state._config["profile"] = _normalize_profile_name(body["profile"])
    if "connect_profile" in body:
        state._config["connect_profile"] = body["connect_profile"]

    async with state._lock:
        was_running = await _page_is_alive()
        if was_running:
            await _close_browser()

        # Start browser with new config so it's immediately usable
        ok, err = await _ensure_browser()

    result = {
        "mode": state._config["mode"],
        "profile": state._config["profile"],
        "restarted": was_running,
        "running": ok,
    }
    if state._config["mode"] == "connect" and state._connected_contexts:
        result["connectedProfiles"] = state._connected_contexts
    if not ok and err:
        result["error"] = err
    return _ok(result)


# ---------------------------------------------------------------------------
# GET /connected-profiles
# ---------------------------------------------------------------------------

async def handle_connected_profiles(_req: web.Request) -> web.Response:
    """List all browser profiles/contexts available via CDP connection."""
    if state._config["mode"] != "connect" or state._browser is None:
        return _ok({
            "connected": False,
            "profiles": [],
            "message": "Not in connect mode. Use POST /configure with mode='connect' first.",
        })

    # Refresh context info from live browser
    contexts = state._browser.contexts
    profiles: list[dict] = []
    active_idx = -1

    for i, ctx in enumerate(contexts):
        pages = ctx.pages
        page_summaries = []
        for p in pages[:8]:
            try:
                import asyncio as _aio
                title = await _aio.wait_for(p.title(), timeout=1.0)
            except Exception:
                title = ""
            page_summaries.append({"url": p.url or "", "title": title})
        is_active = (ctx == state._context)
        if is_active:
            active_idx = i
        profiles.append({
            "index": i,
            "active": is_active,
            "pageCount": len(pages),
            "pages": page_summaries,
        })

    return _ok({
        "connected": True,
        "activeProfile": active_idx,
        "profileCount": len(profiles),
        "profiles": profiles,
    })


# ---------------------------------------------------------------------------
# POST /switch-profile
# ---------------------------------------------------------------------------

async def handle_switch_profile(req: web.Request) -> web.Response:
    """Switch the active context to a different connected Chrome profile."""
    if state._config["mode"] != "connect" or state._browser is None:
        return _err("Not in connect mode", status=400)

    body = await _safe_json(req)
    target = body.get("profile")  # index (int) or search string

    contexts = state._browser.contexts
    if not contexts:
        return _err("No browser contexts available", status=400)

    selected_idx = None

    if isinstance(target, int) and 0 <= target < len(contexts):
        selected_idx = target
    elif isinstance(target, str):
        if target.isdigit():
            idx = int(target)
            if 0 <= idx < len(contexts):
                selected_idx = idx
        else:
            # Search by page title/URL
            needle = target.lower()
            for i, ctx in enumerate(contexts):
                for p in ctx.pages:
                    try:
                        import asyncio as _aio
                        title = await _aio.wait_for(p.title(), timeout=1.0)
                    except Exception:
                        title = ""
                    if needle in title.lower() or needle in (p.url or "").lower():
                        selected_idx = i
                        break
                if selected_idx is not None:
                    break

    if selected_idx is None:
        return _err(f"Could not find profile matching '{target}'. Use GET /connected-profiles to see available profiles.", status=404)

    async with state._lock:
        state._cdp_session = None
        state._context = contexts[selected_idx]
        pages = state._context.pages
        state._page = pages[0] if pages else await state._context.new_page()

    page_count = len(state._context.pages)
    current_url = await _get_page_url()

    return _ok({
        "switched": True,
        "profileIndex": selected_idx,
        "pageCount": page_count,
        "currentUrl": current_url,
    })


# ---------------------------------------------------------------------------
# POST /task (disabled)
# ---------------------------------------------------------------------------

async def handle_task(req: web.Request) -> web.Response:
    return _err(
        "browser_use_task is disabled. Use browser_use_execute_script for complex page logic.",
        status=410,
    )
