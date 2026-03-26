import json
from pathlib import Path

from aiohttp import web

from browser_server import state
from browser_server.utils import _ok, _err
from browser_server.lifecycle import _ensure_browser


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


