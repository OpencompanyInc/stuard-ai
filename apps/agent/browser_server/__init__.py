"""browser-use bridge server — lightweight HTTP wrapper around the browser-use library.

Managed by the Stuard desktop app as a child process.
Requires: pip install browser-use aiohttp
Runs on port 18082 by default.
"""

import hmac

from aiohttp import web

from browser_server.state import HOST, PORT, AUTH_HEADER, AUTH_TOKEN
from browser_server.lifecycle import _close_browser

from browser_server.handlers_config import (
    handle_status,
    handle_setup_debug_port,
    handle_configure,
    handle_task,
)
from browser_server.handlers_nav import (
    handle_navigate,
    handle_click,
    handle_type,
    handle_press_key,
)
from browser_server.handlers_content import (
    handle_screenshot,
    handle_content,
    handle_execute_script,
    handle_scroll,
)
from browser_server.handlers_tabs import (
    handle_tabs,
    handle_cookies,
    handle_sync_chrome,
)
from browser_server.handlers_advanced import (
    handle_hover,
    handle_select_option,
    handle_get_dropdown_options,
    handle_get_interactive_elements,
    handle_fill_form,
    handle_upload_file,
    handle_wait_for,
    handle_close,
)


@web.middleware
async def auth_middleware(req: web.Request, handler):
    if not AUTH_TOKEN:
        return await handler(req)
    incoming = str(req.headers.get(AUTH_HEADER, "")).strip()
    if not incoming or not hmac.compare_digest(incoming, AUTH_TOKEN):
        return web.json_response({"ok": False, "error": "unauthorized"}, status=401)
    return await handler(req)


def create_app() -> web.Application:
    app = web.Application(middlewares=[auth_middleware])
    app.router.add_get("/status", handle_status)
    app.router.add_post("/configure", handle_configure)
    app.router.add_post("/task", handle_task)
    app.router.add_post("/navigate", handle_navigate)
    app.router.add_post("/click", handle_click)
    app.router.add_post("/type", handle_type)
    app.router.add_post("/press_key", handle_press_key)
    app.router.add_post("/screenshot", handle_screenshot)
    app.router.add_post("/content", handle_content)
    app.router.add_post("/execute-script", handle_execute_script)
    app.router.add_post("/scroll", handle_scroll)
    app.router.add_post("/tabs", handle_tabs)
    app.router.add_post("/cookies", handle_cookies)
    app.router.add_post("/sync-chrome", handle_sync_chrome)
    app.router.add_post("/setup-debug-port", handle_setup_debug_port)
    app.router.add_post("/hover", handle_hover)
    app.router.add_post("/select_option", handle_select_option)
    app.router.add_post("/get_dropdown_options", handle_get_dropdown_options)
    app.router.add_post("/get_interactive_elements", handle_get_interactive_elements)
    app.router.add_post("/fill_form", handle_fill_form)
    app.router.add_post("/upload_file", handle_upload_file)
    app.router.add_post("/wait_for", handle_wait_for)
    app.router.add_post("/close", handle_close)
    return app


async def on_shutdown(_app: web.Application):
    await _close_browser()


def main():
    app = create_app()
    app.on_shutdown.append(on_shutdown)
    print(f"[browser-use-server] Starting on {HOST}:{PORT}", flush=True)
    web.run_app(app, host=HOST, port=PORT, print=lambda msg: print(msg, flush=True))
