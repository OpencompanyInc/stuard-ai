"""Shared mutable state and constants for the browser server."""

import asyncio
import os
from pathlib import Path
from typing import Optional

from browser_server.cdp_client import CDPBrowser, CDPConnection

# ---------------------------------------------------------------------------
# Mutable globals
# ---------------------------------------------------------------------------

_browser: Optional[CDPBrowser] = None      # Chrome process + target manager
_page: Optional[CDPConnection] = None      # Active page CDP connection (also serves as CDP session)
_config: dict = {
    "mode": os.environ.get("STUARD_BROWSER_MODE", os.environ.get("BROWSER_USE_MODE", "headless")),  # headed | headless
    "profile": "default",
    "profile_dir": None,  # resolved at startup
}
_lock = asyncio.Lock()
_viewport_cache: dict[str, int] = {"w": 1280, "h": 900}  # cached viewport size for mirror
_tab_session_targets: dict[str, str] = {}  # session_id -> CDP target id
_tab_target_owners: dict[str, str] = {}    # CDP target id -> session_id
_tab_session_touched: dict[str, float] = {}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PORT = int(os.environ.get("STUARD_BROWSER_PORT", os.environ.get("BROWSER_USE_PORT", "18082")))
HOST = os.environ.get("STUARD_BROWSER_HOST", os.environ.get("BROWSER_USE_HOST", "127.0.0.1"))
AUTH_HEADER = "x-stuard-browser-token"
AUTH_TOKEN = os.environ.get("STUARD_BROWSER_AUTH_TOKEN", os.environ.get("BROWSER_USE_AUTH_TOKEN", "")).strip()
PROFILE_ROOT = Path(os.environ.get("STUARD_BROWSER_PROFILE_DIR", os.environ.get("BROWSER_USE_PROFILE_DIR", str(Path.home() / ".stuard" / "browser-profiles"))))
TAB_SESSION_TTL_SECONDS = int(os.environ.get("STUARD_BROWSER_TAB_SESSION_TTL_SECONDS", "7200"))
