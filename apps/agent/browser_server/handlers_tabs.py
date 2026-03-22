import asyncio
import json
from pathlib import Path
from typing import Any

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _clamp_int
from browser_server.profile import (
    _current_profile_dir, _read_sync_meta, _write_sync_meta,
    _managed_profile_dir_name, _clone_profile_into_managed_root,
)
from browser_server.lifecycle import (
    _ensure_browser, _get_page_url, _get_page_title, _page_is_alive, _close_browser,
)
from browser_server.cookie_sync import (
    _find_chrome_user_data_dirs, _resolve_sync_source, _inject_cookies_into_session,
)


async def handle_tabs(req: web.Request) -> web.Response:
    body = await req.json()
    action = body.get("action", "list")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if action == "list":
                pages = state._context.pages if state._context else []
                tabs = []
                for i, p in enumerate(pages):
                    tabs.append({
                        "index": i,
                        "url": p.url,
                        "title": await p.title(),
                        "active": p == state._page,
                    })
                return _ok({"tabs": tabs, "count": len(tabs)})

            elif action == "new":
                state._page = await state._context.new_page()
                url = body.get("url")
                if url:
                    await state._page.goto(url, wait_until="domcontentloaded")
                return _ok({"url": state._page.url, "title": await state._page.title()})

            elif action == "switch":
                index = body.get("index", 0)
                pages = state._context.pages if state._context else []
                if 0 <= index < len(pages):
                    state._page = pages[index]
                    await state._page.bring_to_front()
                    return _ok({"url": state._page.url, "title": await state._page.title()})
                return _err(f"Tab index {index} out of range (0-{len(pages) - 1})")

            elif action == "close":
                index = body.get("index")
                pages = state._context.pages if state._context else []
                if index is not None and 0 <= index < len(pages):
                    target = pages[index]
                    await target.close()
                    pages = state._context.pages
                    state._page = pages[-1] if pages else await state._context.new_page()
                    return _ok({"closed": index, "remaining": len(state._context.pages)})
                return _err("index is required for close action")

            return _err(f"Unknown tabs action: {action}")
        except Exception as e:
            return _err(f"Tabs operation failed: {e}")


async def handle_cookies(req: web.Request) -> web.Response:
    body = await req.json()
    action = body.get("action", "get")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if action == "get":
                urls = body.get("urls")
                cookies = await state._context.cookies(urls) if urls else await state._context.cookies()
                return _ok({"cookies": cookies, "count": len(cookies)})

            elif action == "set":
                cookies = body.get("cookies", [])
                if not cookies:
                    return _err("cookies array is required for set action")
                await state._context.add_cookies(cookies)
                return _ok({"set": len(cookies)})

            elif action == "clear":
                await state._context.clear_cookies()
                return _ok({"cleared": True})

            elif action == "export":
                cookies = await state._context.cookies()
                export_path = body.get("path")
                if export_path:
                    Path(export_path).parent.mkdir(parents=True, exist_ok=True)
                    Path(export_path).write_text(json.dumps(cookies, indent=2))
                    return _ok({"exported": len(cookies), "path": export_path})
                return _ok({"cookies": cookies, "count": len(cookies)})

            elif action == "import":
                import_path = body.get("path")
                if not import_path or not Path(import_path).exists():
                    return _err("Valid path is required for import action")
                cookies = json.loads(Path(import_path).read_text())
                await state._context.add_cookies(cookies)
                return _ok({"imported": len(cookies)})

            return _err(f"Unknown cookies action: {action}")
        except Exception as e:
            return _err(f"Cookies operation failed: {e}")


async def handle_sync_chrome(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    action = body.get("action", "sync")

    if action == "list_profiles":
        profiles = await asyncio.to_thread(_find_chrome_user_data_dirs)
        return _ok({"browsers": profiles})

    if action == "list_domains":
        resolved = await asyncio.to_thread(
            _resolve_sync_source,
            body.get("profile_path"),
            body.get("user_data_dir"),
            body.get("browser") or body.get("browser_name"),
            body.get("profile_name"),
        )
        if not resolved or not resolved.get("profilePath"):
            return _err("No Chrome-compatible profile found.")
        domains = await asyncio.to_thread(
            state.list_cookie_domains,
            resolved["profilePath"],
            False,
        )
        return _ok({
            "domains": domains,
            "browser": resolved.get("browser"),
            "profile": resolved.get("profileName"),
        })

    if action == "sync":
        resolved = await asyncio.to_thread(
            _resolve_sync_source,
            body.get("profile_path"),
            body.get("user_data_dir"),
            body.get("browser") or body.get("browser_name"),
            body.get("profile_name"),
        )
        if not resolved or not resolved.get("profilePath") or not resolved.get("userDataDir"):
            return _err("No Chrome-compatible profile found. Install Chrome or specify a valid browser/profile.")

        profile_path = str(resolved["profilePath"])
        user_data_dir = str(resolved["userDataDir"])
        profile_name = str(resolved.get("profileName") or Path(profile_path).name)
        browser_name = str(resolved.get("browser") or "Chrome")
        force_clone = bool(body.get("force_clone"))
        restart_browser = bool(body.get("restart_browser"))
        domain_filter = body.get("domains")

        cookies = await asyncio.to_thread(
            lambda: state.read_cookies_as_dicts(
                profile_path=profile_path,
                user_data_dir=user_data_dir,
                domains=domain_filter,
                is_firefox=False,
            )
        )
        desired_target_profile_name = Path(profile_path).name or "Default"
        clone_result: dict[str, Any] = {
            "cloned": False,
            "skipped": True,
            "targetRoot": str(_current_profile_dir()),
            "targetProfilePath": str(_current_profile_dir() / desired_target_profile_name),
        }

        async with state._lock:
            browser_running = await _page_is_alive()
            restarted = False
            existing_sync_meta = _read_sync_meta(_current_profile_dir())
            existing_source_profile_path = str(existing_sync_meta.get("sourceProfilePath") or "").strip()
            existing_target_profile_name = _managed_profile_dir_name(existing_sync_meta, desired_target_profile_name)

            if browser_running and not restart_browser:
                if existing_source_profile_path != profile_path or existing_target_profile_name != desired_target_profile_name:
                    await _close_browser()
                    browser_running = False
                    restarted = True

            if restart_browser and browser_running:
                await _close_browser()
                browser_running = False
                restarted = True

            managed_profile_exists = (_current_profile_dir() / desired_target_profile_name).exists()
            should_clone = force_clone or (not browser_running and not managed_profile_exists)
            if should_clone:
                try:
                    clone_result = await asyncio.to_thread(
                        _clone_profile_into_managed_root,
                        profile_path,
                        user_data_dir,
                        str(_current_profile_dir()),
                        force_clone,
                    )
                    clone_result["sourceBrowser"] = browser_name
                    sync_meta_for_browser = _read_sync_meta(_current_profile_dir())
                    if isinstance(sync_meta_for_browser, dict):
                        sync_meta_for_browser["sourceBrowser"] = browser_name
                        _write_sync_meta(_current_profile_dir(), sync_meta_for_browser)
                except Exception as e:
                    return _err(f"Profile clone failed: {e}")

            injected = 0
            failed = 0
            should_inject_cookies = bool(cookies) and browser_running
            if should_inject_cookies:
                try:
                    inject_result = await _inject_cookies_into_session(cookies)
                    injected = inject_result["injected"]
                    failed = inject_result["failed"]
                except Exception as e:
                    return _err(f"Cookie sync failed: {e}")

            sync_meta = _read_sync_meta(_current_profile_dir())
            return _ok({
                "synced": injected,
                "failed": failed,
                "total": len(cookies),
                "browser": browser_name,
                "profile": profile_path,
                "profileName": profile_name,
                "userDataDir": user_data_dir,
                "clone": clone_result,
                "browserWasRunning": browser_running,
                "restarted": restarted,
                "message": "Live cookies refreshed" if injected else ("Profile snapshot updated" if clone_result.get("cloned") else "Profile already up to date"),
                "lastSyncedAt": sync_meta.get("syncedAt") or clone_result.get("lastSyncedAt"),
            })

    return _err(f"Unknown sync-chrome action: {action}")
