"""Shared mutable state and constants for the browser-use server."""

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

_browser = None          # browser_use.Browser instance (None when using Playwright directly)
_context = None          # Playwright BrowserContext (persistent in Strategy 1)
_page = None             # Active Playwright Page
_playwright = None       # Playwright instance (only set when using Strategy 1)
_config: dict[str, Any] = {
    "mode": os.environ.get("BROWSER_USE_MODE", "headed"),  # headed | headless | connect
    "cdp_url": None,     # only used when mode == "connect"
    "profile": "default",
    "profile_dir": None, # resolved at startup
}
_lock = asyncio.Lock()
_DEBUG_PORT_SETUP_DONE = False  # Only attempt setup once per server lifetime

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PORT = int(os.environ.get("BROWSER_USE_PORT", "18082"))
HOST = os.environ.get("BROWSER_USE_HOST", "127.0.0.1")
AUTH_HEADER = "x-stuard-browser-token"
AUTH_TOKEN = os.environ.get("BROWSER_USE_AUTH_TOKEN", "").strip()
PROFILE_ROOT = Path(os.environ.get("BROWSER_USE_PROFILE_DIR", str(Path.home() / ".stuard" / "browser-profiles")))
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
