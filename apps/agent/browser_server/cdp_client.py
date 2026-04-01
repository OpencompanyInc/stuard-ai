"""Chrome DevTools Protocol client — replaces Playwright for browser automation.

Provides two classes:
  CDPConnection  — async WebSocket connection to a single CDP target (page/tab)
  CDPBrowser     — manages Chrome process + page connections

No Playwright dependency. Only requires aiohttp (already used for the HTTP server).
"""

import asyncio
import json
import os
import shutil
import socket
import subprocess
from typing import Any, Optional
from urllib.parse import quote

import aiohttp


# ---------------------------------------------------------------------------
# Chrome discovery
# ---------------------------------------------------------------------------

def _find_chrome() -> str:
    """Locate a Chrome/Chromium/Edge binary on the system."""
    env = os.environ.get("CHROME_PATH", "")
    if env and os.path.isfile(env):
        return env

    candidates = [
        os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p

    for name in ("chrome", "google-chrome", "google-chrome-stable",
                  "chromium", "chromium-browser", "msedge"):
        found = shutil.which(name)
        if found:
            return found

    raise FileNotFoundError(
        "Chrome/Chromium/Edge not found. Install Chrome or set CHROME_PATH env var."
    )


def _free_port() -> int:
    """Find an available TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# CDPConnection — WebSocket to one target
# ---------------------------------------------------------------------------

class CDPConnection:
    """Async WebSocket connection to a single CDP target (page/tab).

    Provides:
      send(method, params)  — raw CDP command → result dict
      evaluate(expr, *args) — JS evaluation matching Playwright's page.evaluate() API
    """

    def __init__(self) -> None:
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self._http: Optional[aiohttp.ClientSession] = None
        self._msg_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._listener: Optional[asyncio.Task] = None
        self._closed = False

    # -- lifecycle -----------------------------------------------------------

    async def connect(self, ws_url: str) -> None:
        self._http = aiohttp.ClientSession()
        self._ws = await self._http.ws_connect(
            ws_url, max_msg_size=100 * 1024 * 1024,  # 100 MB for large screenshots
        )
        self._closed = False
        self._listener = asyncio.create_task(self._listen())

    @property
    def is_connected(self) -> bool:
        return not self._closed and self._ws is not None and not self._ws.closed

    async def close(self) -> None:
        self._closed = True
        if self._listener:
            self._listener.cancel()
            try:
                await self._listener
            except (asyncio.CancelledError, Exception):
                pass
        if self._ws and not self._ws.closed:
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._http and not self._http.closed:
            try:
                await self._http.close()
            except Exception:
                pass
        self._ws = self._http = self._listener = None

    # -- CDP commands --------------------------------------------------------

    async def send(self, method: str, params: dict | None = None) -> dict:
        """Send a CDP command and wait for the result."""
        if self._closed or self._ws is None or self._ws.closed:
            raise RuntimeError("CDP connection closed")

        self._msg_id += 1
        mid = self._msg_id
        msg: dict[str, Any] = {"id": mid, "method": method}
        if params:
            msg["params"] = params

        future = asyncio.get_running_loop().create_future()
        self._pending[mid] = future
        await self._ws.send_json(msg)
        resp = await future

        if "error" in resp:
            err = resp["error"]
            raise RuntimeError(f"CDP {method}: {err.get('message', str(err))}")
        return resp.get("result", {})

    async def evaluate(self, expression: str, *args: Any) -> Any:
        """Evaluate a JS function/expression with optional arguments.

        Mimics Playwright's page.evaluate() signature:
          evaluate("() => 1+1")                → 2
          evaluate("(x) => x*2", 5)            → 10
          evaluate("([a,b]) => a+b", "a", "b") → passes ["a","b"] as first arg
        """
        if len(args) == 0:
            js = f"({expression})()"
        elif len(args) == 1:
            js = f"({expression})({json.dumps(args[0], default=str)})"
        else:
            js = f"({expression})({json.dumps(list(args), default=str)})"

        result = await self.send("Runtime.evaluate", {
            "expression": js,
            "returnByValue": True,
            "awaitPromise": True,
            "userGesture": True,
        })

        # Check for JS exceptions
        if result.get("exceptionDetails"):
            exc = result["exceptionDetails"]
            text = exc.get("text", "")
            if "exception" in exc:
                text = exc["exception"].get("description", text)
            raise RuntimeError(f"JS exception: {text}")

        obj = result.get("result", {})
        if obj.get("subtype") == "error":
            raise RuntimeError(obj.get("description", "JS evaluation error"))

        return obj.get("value")

    # -- background listener -------------------------------------------------

    async def _listen(self) -> None:
        try:
            async for msg in self._ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    mid = data.get("id")
                    if mid is not None and mid in self._pending:
                        self._pending.pop(mid).set_result(data)
                    # Events (no "id") are silently ignored — we poll state
                    # instead of relying on push events for simplicity.
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    break
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
        finally:
            self._closed = True
            for f in list(self._pending.values()):
                if not f.done():
                    f.set_exception(RuntimeError("CDP connection lost"))
            self._pending.clear()


# ---------------------------------------------------------------------------
# CDPBrowser — manages Chrome process + page connections
# ---------------------------------------------------------------------------

class CDPBrowser:
    """Manages a Chrome process and its CDP page connections."""

    def __init__(self) -> None:
        self._process: Optional[subprocess.Popen] = None
        self._port: int = 0
        self._pages: dict[str, CDPConnection] = {}  # target_id → connection
        self._active_id: Optional[str] = None

    @property
    def active_page(self) -> Optional[CDPConnection]:
        if self._active_id:
            return self._pages.get(self._active_id)
        return None

    @property
    def port(self) -> int:
        return self._port

    # -- launch --------------------------------------------------------------

    async def launch(
        self,
        profile_dir: str,
        headless: bool = False,
        width: int = 1280,
        height: int = 900,
        user_agent: str = "",
    ) -> CDPConnection:
        """Launch Chrome and return a CDPConnection to the first page."""
        chrome = _find_chrome()
        self._port = _free_port()
        os.makedirs(profile_dir, exist_ok=True)
        os.makedirs(os.path.join(profile_dir, "Default"), exist_ok=True)

        args = [
            chrome,
            f"--remote-debugging-port={self._port}",
            f"--user-data-dir={profile_dir}",
            "--profile-directory=Default",
            f"--window-size={width},{height}",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-startup-window",
            "--hide-crash-restore-bubble",
            "--disable-infobars",
            "--disable-blink-features=AutomationControlled",
            "--disable-features=RendererCodeIntegrity",
        ]
        if headless:
            args.append("--headless=new")
        if user_agent:
            args.append(f"--user-agent={user_agent}")

        self._process = subprocess.Popen(
            args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

        # Wait for Chrome to expose the debug endpoint
        targets = await self._wait_for_targets()

        for target in list(targets):
            if self._is_ignored_startup_target(target):
                try:
                    await self._http_json("GET", f"/json/close/{target['id']}")
                except Exception:
                    pass

        # Grab first real page, or create one.
        page_target = next(
            (
                t for t in targets
                if t.get("type") == "page" and not self._is_ignored_startup_target(t)
            ),
            None,
        )
        if not page_target:
            page_target = await self._http_json("PUT", "/json/new?about:blank")

        return await self._attach(page_target)

    # -- page / tab management -----------------------------------------------

    async def new_page(self, url: str = "about:blank") -> CDPConnection:
        encoded_url = quote(url, safe=":/?#[]@!$&'()*+,;=%")
        target = await self._http_json("PUT", f"/json/new?{encoded_url}")
        return await self._attach(target)

    async def list_targets(self) -> list[dict]:
        targets = await self._http_json("GET", "/json/list")
        return [t for t in targets if t.get("type") == "page"]

    async def activate_target(self, target_id: str) -> CDPConnection:
        """Bring a tab to front and return its connection."""
        try:
            await self._http_json("GET", f"/json/activate/{target_id}")
        except Exception:
            pass  # activate returns empty body on some Chrome versions

        if target_id not in self._pages:
            targets = await self.list_targets()
            for t in targets:
                if t["id"] == target_id:
                    return await self._attach(t)
            raise RuntimeError(f"Target {target_id} not found")

        self._active_id = target_id
        return self._pages[target_id]

    async def close_target(self, target_id: str) -> None:
        conn = self._pages.pop(target_id, None)
        if conn:
            await conn.close()
        try:
            await self._http_json("GET", f"/json/close/{target_id}")
        except Exception:
            pass
        if self._active_id == target_id:
            self._active_id = next(iter(self._pages), None)

    # -- shutdown ------------------------------------------------------------

    async def close(self) -> None:
        target_ids = list(self._pages.keys())
        for target_id in target_ids:
            try:
                await self.close_target(target_id)
            except Exception:
                pass
        self._pages.clear()
        self._active_id = None

        try:
            remaining_targets = await self.list_targets()
            for target in remaining_targets:
                try:
                    await self._http_json("GET", f"/json/close/{target['id']}")
                except Exception:
                    pass
        except Exception:
            pass

        if self._process:
            try:
                self._process.wait(timeout=2)
            except Exception:
                try:
                    self._process.terminate()
                    self._process.wait(timeout=5)
                except Exception:
                    try:
                        self._process.kill()
                    except Exception:
                        pass
            self._process = None

    # -- internals -----------------------------------------------------------

    async def _wait_for_targets(self, timeout: float = 15.0) -> list[dict]:
        deadline = asyncio.get_event_loop().time() + timeout
        last_err = None
        while asyncio.get_event_loop().time() < deadline:
            # Check Chrome process hasn't crashed
            if self._process and self._process.poll() is not None:
                raise RuntimeError(
                    f"Chrome exited immediately with code {self._process.returncode}"
                )
            try:
                return await self._http_json("GET", "/json/list")
            except Exception as e:
                last_err = e
                await asyncio.sleep(0.15)
        raise TimeoutError(f"Chrome did not start within {timeout}s: {last_err}")

    async def _http_json(self, method: str, path: str) -> Any:
        url = f"http://127.0.0.1:{self._port}{path}"
        async with aiohttp.ClientSession() as s:
            async with s.request(
                method, url, timeout=aiohttp.ClientTimeout(total=5)
            ) as r:
                return await r.json()

    async def _attach(self, target: dict) -> CDPConnection:
        """Connect to a target's WebSocket and enable required CDP domains."""
        tid = target["id"]
        ws_url = target.get("webSocketDebuggerUrl", "")
        if not ws_url:
            raise RuntimeError(f"No WebSocket URL for target {tid}")

        # Close stale connection
        old = self._pages.pop(tid, None)
        if old:
            await old.close()

        conn = CDPConnection()
        await conn.connect(ws_url)

        # Enable the CDP domains we need
        await conn.send("DOM.enable")
        await conn.send("Page.enable")
        await conn.send("Runtime.enable")
        await conn.send("Network.enable")

        # Anti-detection: ensure navigator.webdriver is undefined (not true)
        await conn.send("Page.addScriptToEvaluateOnNewDocument", {
            "source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        })

        self._pages[tid] = conn
        self._active_id = tid
        return conn

    @staticmethod
    def _is_ignored_startup_target(target: dict) -> bool:
        url = str(target.get("url", "") or "").lower()
        if not url:
            return False
        return (
            url.startswith("chrome://profile-picker")
            or url.startswith("edge://profile-picker")
            or url.startswith("chrome://welcome")
            or url.startswith("edge://welcome")
        )
