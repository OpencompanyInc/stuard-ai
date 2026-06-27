"""Shared mutable state and constants for the browser server."""

import asyncio
import contextvars
import os
from pathlib import Path
from typing import Optional

from browser_server.cdp_client import CDPBrowser, CDPConnection

# ---------------------------------------------------------------------------
# Mutable globals
# ---------------------------------------------------------------------------

_browser: Optional[CDPBrowser] = None      # Chrome process + target manager
_page: Optional[CDPConnection] = None      # Default/visible page (legacy + session-less calls + sidebar mirror)
_default_target_id: Optional[str] = None   # CDP target id of the default page (never claimed by a session)
_config: dict = {
    "mode": os.environ.get("STUARD_BROWSER_MODE", os.environ.get("BROWSER_USE_MODE", "headless")),  # headed | headless
    "profile": "default",
    "profile_dir": None,  # resolved at startup
}
# Structural lock — held only briefly while launching Chrome or creating/claiming a
# tab (mutating the shared target/ownership maps). It is NOT held for the duration of
# a page operation, so requests targeting different tabs run concurrently. Per-tab
# operations are serialized by a per-session lock instead (see _session_lock).
_lock = asyncio.Lock()
_viewport_cache: dict[str, int] = {"w": 1280, "h": 900}  # cached viewport size for mirror
_tab_session_targets: dict[str, str] = {}  # session_id -> CDP target id
_tab_target_owners: dict[str, str] = {}    # CDP target id -> session_id
_tab_session_touched: dict[str, float] = {}

# Per-request active page. Each aiohttp request runs in its own asyncio task, so this
# ContextVar is isolated per request — concurrent browser sessions each operate on
# their own tab's CDP connection without stomping a shared global. When unset (legacy /
# session-less calls), helpers fall back to `_page`. See lifecycle._active_page().
current_page: "contextvars.ContextVar[Optional[CDPConnection]]" = contextvars.ContextVar(
    "stuard_browser_current_page", default=None,
)

# Per-session operation locks. One browser session (one tab) → one lock, so two
# concurrent requests for the SAME session serialize, while different sessions run
# in parallel. Session-less calls share the "__default__" lock (preserving the old
# exclusive access to the default tab). Created on demand; cleaned up on release/close.
_session_locks: dict[str, asyncio.Lock] = {}


def _session_lock(session_id: str) -> asyncio.Lock:
    key = session_id or "__default__"
    lock = _session_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _session_locks[key] = lock
    return lock

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PORT = int(os.environ.get("STUARD_BROWSER_PORT", os.environ.get("BROWSER_USE_PORT", "18082")))
HOST = os.environ.get("STUARD_BROWSER_HOST", os.environ.get("BROWSER_USE_HOST", "127.0.0.1"))
AUTH_HEADER = "x-stuard-browser-token"
AUTH_TOKEN = os.environ.get("STUARD_BROWSER_AUTH_TOKEN", os.environ.get("BROWSER_USE_AUTH_TOKEN", "")).strip()
PROFILE_ROOT = Path(os.environ.get("STUARD_BROWSER_PROFILE_DIR", os.environ.get("BROWSER_USE_PROFILE_DIR", str(Path.home() / ".stuard" / "browser-profiles"))))
TAB_SESSION_TTL_SECONDS = int(os.environ.get("STUARD_BROWSER_TAB_SESSION_TTL_SECONDS", "7200"))
