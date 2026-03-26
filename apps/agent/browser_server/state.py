"""Shared mutable state and constants for the browser server."""

import asyncio
import os
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Mutable globals
# ---------------------------------------------------------------------------

_context = None          # Playwright BrowserContext
_page = None             # Active Playwright Page
_playwright = None       # Playwright instance
_cdp_session = None      # Reusable Playwright CDPSession (lazily created for raw CDP commands)
_config: dict[str, Any] = {
    "mode": os.environ.get("STUARD_BROWSER_MODE", os.environ.get("BROWSER_USE_MODE", "headless")),  # headed | headless
    "profile": "default",
    "profile_dir": None, # resolved at startup
}
_lock = asyncio.Lock()
_viewport_cache: dict[str, int] = {"w": 1280, "h": 900}  # cached viewport size for mirror

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PORT = int(os.environ.get("STUARD_BROWSER_PORT", os.environ.get("BROWSER_USE_PORT", "18082")))
HOST = os.environ.get("STUARD_BROWSER_HOST", os.environ.get("BROWSER_USE_HOST", "127.0.0.1"))
AUTH_HEADER = "x-stuard-browser-token"
AUTH_TOKEN = os.environ.get("STUARD_BROWSER_AUTH_TOKEN", os.environ.get("BROWSER_USE_AUTH_TOKEN", "")).strip()
PROFILE_ROOT = Path(os.environ.get("STUARD_BROWSER_PROFILE_DIR", os.environ.get("BROWSER_USE_PROFILE_DIR", str(Path.home() / ".stuard" / "browser-profiles"))))
