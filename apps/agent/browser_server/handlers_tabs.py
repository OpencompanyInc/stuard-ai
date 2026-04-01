import json
from pathlib import Path

from aiohttp import web

from browser_server import state
from browser_server.utils import _ok, _err
from browser_server.lifecycle import _ensure_browser, _get_page_url, _get_page_title


async def handle_tabs(req: web.Request) -> web.Response:
    body = await req.json()
    action = body.get("action", "list")

    async with state._lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            browser = state._browser
            if browser is None:
                return _err("Browser not initialized", status=500)

            if action == "list":
                targets = await browser.list_targets()
                tabs = []
                for i, t in enumerate(targets):
                    is_active = t["id"] == browser._active_id
                    tabs.append({
                        "index": i,
                        "url": t.get("url", ""),
                        "title": t.get("title", ""),
                        "active": is_active,
                    })
                return _ok({"tabs": tabs, "count": len(tabs)})

            elif action == "new":
                url = body.get("url", "about:blank")
                page = await browser.new_page(url)
                state._page = page
                return _ok({
                    "url": await _get_page_url(),
                    "title": await _get_page_title(),
                })

            elif action == "switch":
                index = body.get("index", 0)
                targets = await browser.list_targets()
                if 0 <= index < len(targets):
                    page = await browser.activate_target(targets[index]["id"])
                    state._page = page
                    return _ok({
                        "url": await _get_page_url(),
                        "title": await _get_page_title(),
                    })
                return _err(f"Tab index {index} out of range (0-{len(targets) - 1})")

            elif action == "close":
                index = body.get("index")
                targets = await browser.list_targets()
                if index is not None and 0 <= index < len(targets):
                    target_id = targets[index]["id"]
                    await browser.close_target(target_id)
                    # Switch to remaining tab
                    remaining = await browser.list_targets()
                    if remaining:
                        page = await browser.activate_target(remaining[-1]["id"])
                        state._page = page
                    else:
                        page = await browser.new_page()
                        state._page = page
                    return _ok({"closed": index, "remaining": len(remaining) if remaining else 1})
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
            page = state._page
            if page is None:
                return _err("No active page", status=500)

            if action == "get":
                urls = body.get("urls")
                if urls:
                    result = await page.send("Network.getCookies", {"urls": urls})
                else:
                    result = await page.send("Network.getAllCookies")
                cookies = result.get("cookies", [])
                return _ok({"cookies": cookies, "count": len(cookies)})

            elif action == "set":
                cookies = body.get("cookies", [])
                if not cookies:
                    return _err("cookies array is required for set action")
                await page.send("Network.setCookies", {"cookies": cookies})
                return _ok({"set": len(cookies)})

            elif action == "clear":
                await page.send("Network.clearBrowserCookies")
                return _ok({"cleared": True})

            elif action == "export":
                result = await page.send("Network.getAllCookies")
                cookies = result.get("cookies", [])
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
                await page.send("Network.setCookies", {"cookies": cookies})
                return _ok({"imported": len(cookies)})

            return _err(f"Unknown cookies action: {action}")
        except Exception as e:
            return _err(f"Cookies operation failed: {e}")
