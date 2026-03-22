"""Shared mutable state and constants for the browser server."""

import asyncio
import os
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Browser-cookies module import (with standalone fallback)
# ---------------------------------------------------------------------------
try:
    from app.browser_cookies import (
        discover_browsers,
        read_cookies_as_dicts,
        import_cookies as import_browser_cookies,
        resolve_browser,
        list_cookie_domains,
    )
except ImportError:
    _agent_dir = Path(__file__).resolve().parent.parent
    if str(_agent_dir) not in sys.path:
        sys.path.insert(0, str(_agent_dir))
    from app.browser_cookies import (  # type: ignore[no-redef]
        discover_browsers,
        read_cookies_as_dicts,
        import_cookies as import_browser_cookies,
        resolve_browser,
        list_cookie_domains,
    )

# ---------------------------------------------------------------------------
# Mutable globals
# ---------------------------------------------------------------------------

_context = None          # Playwright BrowserContext
_page = None             # Active Playwright Page
_playwright = None       # Playwright instance
_browser = None          # Playwright Browser (used in CDP connect mode)
_cdp_session = None      # Reusable Playwright CDPSession (lazily created)
_connected_contexts: list[dict] = []  # Info about all CDP-connected profiles/contexts
_config: dict[str, Any] = {
    "mode": os.environ.get("STUARD_BROWSER_MODE", os.environ.get("BROWSER_USE_MODE", "headless")),  # headed | headless | connect
    "cdp_url": None,     # only used when mode == "connect"
    "profile": "default",
    "profile_dir": None, # resolved at startup
    "connect_profile": None,  # which Chrome profile to attach to in connect mode (index or name)
}
_lock = asyncio.Lock()
_viewport_cache: dict[str, int] = {"w": 1280, "h": 900}  # cached viewport size for mirror
_DEBUG_PORT_SETUP_DONE = False  # Only attempt setup once per server lifetime

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PORT = int(os.environ.get("STUARD_BROWSER_PORT", os.environ.get("BROWSER_USE_PORT", "18082")))
HOST = os.environ.get("STUARD_BROWSER_HOST", os.environ.get("BROWSER_USE_HOST", "127.0.0.1"))
AUTH_HEADER = "x-stuard-browser-token"
AUTH_TOKEN = os.environ.get("STUARD_BROWSER_AUTH_TOKEN", os.environ.get("BROWSER_USE_AUTH_TOKEN", "")).strip()
PROFILE_ROOT = Path(os.environ.get("STUARD_BROWSER_PROFILE_DIR", os.environ.get("BROWSER_USE_PROFILE_DIR", str(Path.home() / ".stuard" / "browser-profiles"))))
SYNC_META_FILE = ".stuard_sync_meta.json"

PROFILE_COPY_SKIP_NAMES = {
    "cache",
    "code cache",
    "dawncache",
    "gpucache",
    "grshadercache",
    "graphitecache",
    "shadercache",
    "component updater",
    "crashpad",
    "optimizationguidepredictionmodels",
    "safe browsing",
    "segmentation platform",
    "subresource filter",
    "webrtc_event_logs",
    "blob_storage",
    "session storage",
    "shared dictionary",
    "videoDecodeStats",
    "jumplisticons",
    "jumplisticonsrecentclosed",
    "proxy cache",
    "pnacltranslationcache",
    "explorer",
    "certificateverification",
}

PROFILE_COPY_SKIP_PREFIXES = (
    ".org.chromium.",
    ".com.google.chrome.",
    "singleton",
)

PROFILE_SIGNATURE_PATHS = (
    ("Local State", False),
    ("Preferences", False),
    ("Secure Preferences", False),
    ("Network/Cookies", False),
    ("Cookies", False),
    ("Login Data", False),
    ("Web Data", False),
    ("Local Storage", True),
    ("IndexedDB", True),
    ("Shared Storage", True),
    ("Service Worker", True),
    ("Extension State", True),
    ("Extensions", True),
)
