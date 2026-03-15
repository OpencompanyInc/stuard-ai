"""
browser-use bridge server — lightweight HTTP wrapper around the browser-use library.
Managed by the Stuard desktop app as a child process.

Requires: pip install browser-use aiohttp
Runs on port 18082 by default.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any, Optional

from aiohttp import web

# Standalone cross-platform cookie extraction module
try:
    from app.browser_cookies import (
        discover_browsers,
        read_cookies_as_dicts,
        import_cookies as import_browser_cookies,
        resolve_browser,
        list_cookie_domains,
    )
except ImportError:
    # When running browser_use_server.py directly (not as part of the app package)
    _agent_dir = Path(__file__).resolve().parent
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
# Globals
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


def _profile_root() -> Path:
    return PROFILE_ROOT


def _current_profile_dir() -> Path:
    return _profile_root() / _config["profile"]


def _sync_meta_path(target_root: Path) -> Path:
    return target_root / SYNC_META_FILE


def _read_sync_meta(target_root: Path) -> dict[str, Any]:
    try:
        path = _sync_meta_path(target_root)
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _write_sync_meta(target_root: Path, data: dict[str, Any]) -> None:
    path = _sync_meta_path(target_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _normalize_profile_name(value: Any) -> str:
    raw = str(value or "default").strip()
    if not raw:
        return "default"
    # Prevent path traversal or accidental nested paths.
    safe = "".join(ch for ch in raw if ch.isalnum() or ch in ("-", "_", "."))
    return safe[:64] or "default"


def _clamp_int(value: Any, default: int, min_value: int, max_value: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    if n < min_value:
        return min_value
    if n > max_value:
        return max_value
    return n


def _normalize_wait_until(value: Any) -> str:
    v = str(value or "domcontentloaded").strip().lower()
    if v in ("load", "domcontentloaded", "networkidle", "commit"):
        return v
    return "domcontentloaded"


def _profile_copy_ignore(dir_path: str, names: list[str]) -> set[str]:
    ignored: set[str] = set()
    for name in names:
        lowered = name.strip().lower()
        if lowered in PROFILE_COPY_SKIP_NAMES:
            ignored.add(name)
            continue
        if any(lowered.startswith(prefix) for prefix in PROFILE_COPY_SKIP_PREFIXES):
            ignored.add(name)
            continue
        if lowered.endswith((".tmp", ".temp", ".log")):
            ignored.add(name)
            continue
        if lowered in {SYNC_META_FILE.lower(), "lockfile", "current tabs", "current session", "last tabs", "last session"}:
            ignored.add(name)
    return ignored


def _is_locked_profile_copy_error(src: str, err: BaseException) -> bool:
    try:
        winerror = getattr(err, "winerror", None)
        if winerror != 32:
            return False
    except Exception:
        return False

    lowered = str(src).replace("\\", "/").lower()
    lock_prone_markers = (
        "/network/cookies",
        "/network/cookies-journal",
        "/cookies",
        "/cookies-journal",
        "/safe browsing network/",
        "/sessions/",
        "/session storage/",
    )
    return any(marker in lowered for marker in lock_prone_markers)


def _copy_profile_file_resilient(src: str, dst: str) -> str:
    try:
        return shutil.copy2(src, dst)
    except OSError as e:
        if _is_locked_profile_copy_error(src, e):
            return dst
        raise


def _path_signature(path: Path, recursive: bool = False) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False}
    try:
        if path.is_file():
            stat = path.stat()
            return {
                "exists": True,
                "type": "file",
                "size": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
            }

        file_count = 0
        total_size = 0
        latest_mtime_ns = 0
        if recursive:
            for item in path.rglob("*"):
                try:
                    if not item.is_file():
                        continue
                    stat = item.stat()
                    file_count += 1
                    total_size += stat.st_size
                    latest_mtime_ns = max(latest_mtime_ns, stat.st_mtime_ns)
                except Exception:
                    continue
        else:
            stat = path.stat()
            latest_mtime_ns = stat.st_mtime_ns
        return {
            "exists": True,
            "type": "dir",
            "recursive": recursive,
            "files": file_count,
            "size": total_size,
            "mtime_ns": latest_mtime_ns,
        }
    except Exception:
        return {"exists": False}


def _resolve_profile_display_name(profile_path: Path, fallback_name: str) -> str:
    generic_names = {"default", "your chrome"}

    def _is_generic(value: str) -> bool:
        normalized = value.strip().lower()
        return (
            not normalized
            or normalized in generic_names
            or normalized.startswith("profile ")
            or normalized.startswith("person ")
        )

    prefs_path = profile_path / "Preferences"
    if prefs_path.exists():
        try:
            prefs = json.loads(prefs_path.read_text(encoding="utf-8", errors="replace"))
            profile = prefs.get("profile", {}) if isinstance(prefs, dict) else {}
            account_info = prefs.get("account_info") if isinstance(prefs, dict) else None
            primary_account = None
            if isinstance(account_info, list):
                for entry in account_info:
                    if not isinstance(entry, dict):
                        continue
                    email = str(entry.get("email") or "").strip()
                    full_name = str(entry.get("full_name") or entry.get("given_name") or "").strip()
                    if email or full_name:
                        primary_account = entry
                        break

            candidates = [
                profile.get("gaia_name") if isinstance(profile, dict) else None,
                profile.get("gaia_given_name") if isinstance(profile, dict) else None,
                primary_account.get("full_name") if isinstance(primary_account, dict) else None,
                primary_account.get("given_name") if isinstance(primary_account, dict) else None,
                profile.get("shortcut_name") if isinstance(profile, dict) else None,
                profile.get("name") if isinstance(profile, dict) else None,
                primary_account.get("email") if isinstance(primary_account, dict) else None,
            ]
            for candidate in candidates:
                value = str(candidate or "").strip()
                if value and not _is_generic(value):
                    return value
        except Exception:
            pass

    return fallback_name


def _build_source_profile_signature(profile_path: str, user_data_dir: str) -> dict[str, Any]:
    source_profile = Path(profile_path)
    source_user_data_dir = Path(user_data_dir)
    paths: dict[str, Any] = {}
    for rel_path, recursive in PROFILE_SIGNATURE_PATHS:
        if rel_path == "Local State":
            candidate = source_user_data_dir / rel_path
        else:
            candidate = source_profile / rel_path
        paths[rel_path] = _path_signature(candidate, recursive=recursive)
    return {
        "userDataDir": str(source_user_data_dir),
        "profilePath": str(source_profile),
        "profileName": _resolve_profile_display_name(source_profile, source_profile.name),
        "paths": paths,
    }


def _hash_signature(signature: dict[str, Any]) -> str:
    payload = json.dumps(signature, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8", errors="replace")).hexdigest()


def _clone_profile_into_managed_root(profile_path: str, user_data_dir: str, target_root: str, force: bool = False) -> dict[str, Any]:
    source_profile = Path(profile_path)
    source_user_data_dir = Path(user_data_dir)
    managed_root = Path(target_root)
    signature = _build_source_profile_signature(str(source_profile), str(source_user_data_dir))
    signature_hash = _hash_signature(signature)
    existing_meta = _read_sync_meta(managed_root)
    target_profile_name = source_profile.name or "Default"
    existing_target_profile_name = _managed_profile_dir_name(existing_meta, target_profile_name)

    if not force and existing_meta.get("sourceSignatureHash") == signature_hash and existing_target_profile_name == target_profile_name and (managed_root / target_profile_name).exists():
        return {
            "cloned": False,
            "skipped": True,
            "sourceSignatureHash": signature_hash,
            "targetRoot": str(managed_root),
            "targetProfilePath": str(managed_root / target_profile_name),
            "lastSyncedAt": existing_meta.get("syncedAt"),
        }

    temp_root = managed_root.parent / f".{managed_root.name}.sync-tmp"
    if temp_root.exists():
        shutil.rmtree(temp_root, ignore_errors=True)
    temp_root.mkdir(parents=True, exist_ok=True)

    source_local_state = source_user_data_dir / "Local State"
    if source_local_state.exists():
        shutil.copy2(source_local_state, temp_root / "Local State")

    target_profile = temp_root / target_profile_name
    shutil.copytree(source_profile, target_profile, ignore=_profile_copy_ignore, copy_function=_copy_profile_file_resilient, dirs_exist_ok=True)

    # Remove lock files and session data that would conflict with a new Chrome instance
    for lock_rel in ("lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock_path = target_profile / lock_rel
        if lock_path.exists():
            try:
                lock_path.unlink()
            except Exception:
                pass
    # Also remove from the root (Local State level locks)
    for lock_rel in ("lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock_path = temp_root / lock_rel
        if lock_path.exists():
            try:
                lock_path.unlink()
            except Exception:
                pass

    meta = {
        "sourceSignatureHash": signature_hash,
        "sourceSignature": signature,
        "sourceProfilePath": str(source_profile),
        "sourceProfileDirName": target_profile_name,
        "sourceUserDataDir": str(source_user_data_dir),
        "targetProfileDirName": target_profile_name,
        "targetProfilePath": str(target_profile),
        "syncedAt": int(__import__("time").time()),
        "mode": "profile_clone",
    }
    _write_sync_meta(temp_root, meta)

    if managed_root.exists():
        shutil.rmtree(managed_root, ignore_errors=True)
    temp_root.replace(managed_root)

    return {
        "cloned": True,
        "skipped": False,
        "sourceSignatureHash": signature_hash,
        "targetRoot": str(managed_root),
        "targetProfilePath": str(managed_root / target_profile_name),
        "lastSyncedAt": meta["syncedAt"],
    }


def _managed_profile_dir_name(sync_meta: dict[str, Any], default_name: str = "Default") -> str:
    for key in ("targetProfileDirName", "sourceProfileDirName"):
        value = str(sync_meta.get(key) or "").strip()
        if value:
            return Path(value).name or default_name
    for key in ("targetProfilePath", "sourceProfilePath"):
        value = str(sync_meta.get(key) or "").strip()
        if value:
            return Path(value).name or default_name
    return default_name


def _guess_source_browser_name(sync_meta: dict[str, Any]) -> str | None:
    source_browser = str(sync_meta.get("sourceBrowser") or "").strip()
    if source_browser:
        return source_browser

    source_user_data_dir = str(sync_meta.get("sourceUserDataDir") or "").strip().lower()
    if not source_user_data_dir:
        return None
    if "brave" in source_user_data_dir:
        return "Brave"
    if "microsoft" in source_user_data_dir and "edge" in source_user_data_dir:
        return "Edge"
    if "chrome beta" in source_user_data_dir:
        return "Chrome Beta"
    if "google" in source_user_data_dir and "chrome" in source_user_data_dir:
        return "Chrome"
    return None


def _find_local_browser_executable(browser_name: str) -> str | None:
    normalized = browser_name.strip().lower()
    home = Path.home()
    candidates: list[Path] = []

    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local")))
        program_files = Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
        program_files_x86 = Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
        if normalized == "chrome":
            candidates = [
                program_files / "Google" / "Chrome" / "Application" / "chrome.exe",
                program_files_x86 / "Google" / "Chrome" / "Application" / "chrome.exe",
                local / "Google" / "Chrome" / "Application" / "chrome.exe",
            ]
        elif normalized == "chrome beta":
            candidates = [
                program_files / "Google" / "Chrome Beta" / "Application" / "chrome.exe",
                program_files_x86 / "Google" / "Chrome Beta" / "Application" / "chrome.exe",
                local / "Google" / "Chrome Beta" / "Application" / "chrome.exe",
            ]
        elif normalized == "edge":
            candidates = [
                program_files / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                program_files_x86 / "Microsoft" / "Edge" / "Application" / "msedge.exe",
                local / "Microsoft" / "Edge" / "Application" / "msedge.exe",
            ]
        elif normalized == "brave":
            candidates = [
                program_files / "BraveSoftware" / "Brave-Browser" / "Application" / "brave.exe",
                program_files_x86 / "BraveSoftware" / "Brave-Browser" / "Application" / "brave.exe",
                local / "BraveSoftware" / "Brave-Browser" / "Application" / "brave.exe",
            ]
    elif sys.platform == "darwin":
        if normalized == "chrome":
            candidates = [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
        elif normalized == "chrome beta":
            candidates = [Path("/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta")]
        elif normalized == "edge":
            candidates = [Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")]
        elif normalized == "brave":
            candidates = [Path("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser")]
    else:
        if normalized == "chrome":
            candidates = [Path("/usr/bin/google-chrome"), Path("/usr/bin/google-chrome-stable")]
        elif normalized == "chrome beta":
            candidates = [Path("/usr/bin/google-chrome-beta")]
        elif normalized == "edge":
            candidates = [Path("/usr/bin/microsoft-edge"), Path("/usr/bin/microsoft-edge-stable")]
        elif normalized == "brave":
            candidates = [Path("/usr/bin/brave-browser"), Path("/usr/bin/brave-browser-stable")]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


_DEBUG_PORT_SETUP_DONE = False  # Only attempt setup once per server lifetime


def _auto_setup_debug_port_if_needed(user_data_dir: str) -> None:
    """
    Automatically enable Chrome's debug port if not already configured.
    This is a safe, non-destructive operation — it only adds a flag to Chrome
    shortcuts so that NEXT TIME Chrome starts, it opens a debug port.
    Does nothing if already set up. Only runs once per server session.
    """
    global _DEBUG_PORT_SETUP_DONE
    if _DEBUG_PORT_SETUP_DONE:
        return
    _DEBUG_PORT_SETUP_DONE = True

    # Check if debug port is already active — nothing to do
    if _detect_chrome_debug_port(user_data_dir):
        return

    # Check if we already set up the shortcuts before (persistent marker)
    marker = Path(user_data_dir) / ".stuard_debug_port_configured"
    if marker.exists():
        print(f"[browser-use-server] Chrome debug port was configured previously. "
              f"Restart Chrome to activate it (close fully, including system tray).",
              flush=True)
        return

    try:
        from app.browser_cookies import enable_chrome_debug_port
    except ImportError:
        from browser_cookies import enable_chrome_debug_port  # type: ignore[no-redef]

    result = enable_chrome_debug_port(9222)
    if result.get("success"):
        # Write marker so we don't modify shortcuts again
        try:
            marker.write_text("9222")
        except Exception:
            pass
        print(f"[browser-use-server] Auto-configured Chrome debug port for future sessions. "
              f"Restart Chrome to activate (close fully, then reopen).",
              flush=True)
    else:
        print(f"[browser-use-server] Chrome is running without a debug port. "
              f"For full auth support, close Chrome or add --remote-debugging-port=9222 "
              f"to your Chrome shortcut.", flush=True)


def _detect_chrome_debug_port(user_data_dir: str) -> int | None:
    """Check if Chrome is running with --remote-debugging-port.
    Chrome writes the port to DevToolsActivePort in the user data dir.
    Returns the port number, or None if debugging is not enabled.
    """
    dt_file = Path(user_data_dir) / "DevToolsActivePort"
    if not dt_file.exists():
        return None
    try:
        content = dt_file.read_text().strip()
        lines = content.split("\n")
        if lines:
            port = int(lines[0].strip())
            if 1024 <= port <= 65535:
                # Verify the port is actually responding
                import urllib.request
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
                return port
    except Exception:
        pass
    return None


def _is_browser_user_data_dir_locked(user_data_dir: str) -> bool:
    """Check if a browser's User Data dir is locked by a running instance.
    Checks for Chrome's SingletonLock (Unix) or lockfile (Windows).
    """
    ud = Path(user_data_dir)

    # Windows: Chrome uses "lockfile" in the User Data dir
    if sys.platform == "win32":
        lockfile = ud / "lockfile"
        if lockfile.exists():
            # The lockfile exists — try to remove it to see if Chrome holds a lock.
            # If we can't, Chrome is running.
            try:
                lockfile.unlink()
                # We could delete it — Chrome isn't holding it. (Shouldn't normally happen
                # because Chrome removes it on exit, but stale locks exist.)
                return False
            except (PermissionError, OSError):
                return True
    else:
        # macOS/Linux: Chrome uses "SingletonLock" (a symlink)
        singleton = ud / "SingletonLock"
        if singleton.exists() or singleton.is_symlink():
            # Check if the process pointed to by the symlink is alive
            try:
                target = os.readlink(str(singleton))
                # target is like "hostname-pid"
                parts = target.rsplit("-", 1)
                if len(parts) == 2:
                    pid = int(parts[1])
                    # Check if this process is alive
                    os.kill(pid, 0)
                    return True  # Process is alive — locked
            except (OSError, ValueError):
                pass
            # Symlink exists but process is dead — stale lock
            return False

    return False


def _resolve_real_browser_profile(sync_meta: dict[str, Any]) -> dict[str, Any] | None:
    """
    Find a usable real browser profile, handling locked profiles.

    Priority:
    1. Use the profile from sync_meta (what the user configured)
    2. Auto-detect Chrome Default profile
    3. If the preferred profile's User Data dir is locked (browser running),
       try other profiles in different browsers that aren't locked
    4. Return None if nothing is available

    Returns dict with: browser, userDataDir, profileName, profilePath, wasActive
    """
    candidates: list[dict[str, Any]] = []

    # Priority 1: sync_meta source
    source_profile_path = str(sync_meta.get("sourceProfilePath") or "").strip()
    source_user_data_dir = str(sync_meta.get("sourceUserDataDir") or "").strip()
    source_browser = str(sync_meta.get("sourceBrowser") or "").strip()

    if source_profile_path and source_user_data_dir and Path(source_user_data_dir).is_dir():
        candidates.append({
            "browser": source_browser or "Chrome",
            "userDataDir": source_user_data_dir,
            "profileName": Path(source_profile_path).name or "Default",
            "profilePath": source_profile_path,
            "preferred": True,
        })

    # Priority 2: auto-detect all browsers
    try:
        browsers = discover_browsers()
        for b in browsers:
            if b.get("isFirefox"):
                continue  # Firefox profiles can't be used with Chromium's launch_persistent_context
            for profile in b.get("profiles", []):
                entry = {
                    "browser": b["browser"],
                    "userDataDir": b["userDataDir"],
                    "profileName": Path(profile["path"]).name,
                    "profilePath": profile["path"],
                    "preferred": False,
                }
                # Avoid duplicates with the sync_meta source
                if not (source_user_data_dir and entry["userDataDir"] == source_user_data_dir
                        and entry["profileName"] == (Path(source_profile_path).name if source_profile_path else "")):
                    candidates.append(entry)
    except Exception:
        pass

    if not candidates:
        return None

    # Try the preferred profile first, then fall back to others
    for candidate in candidates:
        user_data_dir = candidate["userDataDir"]
        if _is_browser_user_data_dir_locked(user_data_dir):
            continue  # This browser is running — skip all its profiles

        return {
            "browser": candidate["browser"],
            "userDataDir": user_data_dir,
            "profileName": candidate["profileName"],
            "profilePath": candidate["profilePath"],
            "wasActive": False,
        }

    # All profiles are locked. Report which browsers are running.
    running_browsers = set()
    for c in candidates:
        if _is_browser_user_data_dir_locked(c["userDataDir"]):
            running_browsers.add(c["browser"])

    running_str = ", ".join(sorted(running_browsers)) if running_browsers else "Unknown"
    print(f"[browser-use-server] All browser profiles are locked. "
          f"Running browsers: {running_str}. "
          f"Close one of them to allow Playwright to use its profile, "
          f"or the managed profile will be used as fallback.",
          flush=True)

    # Return the preferred one with wasActive flag so the caller knows
    preferred = candidates[0]
    return {
        "browser": preferred["browser"],
        "userDataDir": preferred["userDataDir"],
        "profileName": preferred["profileName"],
        "profilePath": preferred["profilePath"],
        "wasActive": True,
    }


def _browser_launch_overrides(sync_meta: dict[str, Any]) -> dict[str, Any]:
    source_browser = _guess_source_browser_name(sync_meta)

    # If we know the source browser from sync meta, use it
    if source_browser:
        executable_path = _find_local_browser_executable(source_browser)
        if executable_path:
            return {"executable_path": executable_path}

        normalized = source_browser.strip().lower()
        if normalized == "chrome":
            return {"channel": "chrome"}
        if normalized == "chrome beta":
            return {"channel": "chrome-beta"}
        if normalized == "edge":
            return {"channel": "msedge"}

    # Always try to find any installed Chrome-family browser, even without sync meta.
    # This is critical: Playwright's bundled Chromium can't decrypt cookies from a
    # cloned Chrome profile because DPAPI keys are tied to the original Chrome binary's
    # encryption context. Using the user's actual Chrome makes cookie encryption work.
    for browser_name in ("Chrome", "Edge", "Brave", "Chrome Beta"):
        exe = _find_local_browser_executable(browser_name)
        if exe:
            return {"executable_path": exe}

    # Fall back to Playwright channels
    return {"channel": "chrome"}


async def _safe_json(req: web.Request) -> dict[str, Any]:
    try:
        body = await req.json()
        if isinstance(body, dict):
            return body
        return {}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Browser lifecycle
# ---------------------------------------------------------------------------

def _jsonable_cookie(cookie: Any) -> dict[str, Any]:
    if isinstance(cookie, dict):
        return cookie
    if hasattr(cookie, "model_dump"):
        try:
            return dict(cookie.model_dump())
        except Exception:
            pass
    if hasattr(cookie, "__dict__"):
        try:
            return dict(cookie.__dict__)
        except Exception:
            pass
    return {"value": str(cookie)}


async def _page_is_alive() -> bool:
    if _page is None:
        return False
    try:
        if hasattr(_page, "is_closed"):
            return not _page.is_closed()
        # Newer browser-use page wrapper does not expose is_closed.
        if hasattr(_page, "get_url"):
            await _page.get_url()
            return True
        return True
    except Exception:
        return False


async def _get_page_url() -> str:
    if _page is None:
        return ""
    try:
        if hasattr(_page, "get_url"):
            return await _page.get_url()
        return getattr(_page, "url", "") or ""
    except Exception:
        return ""


async def _get_page_title(timeout: float | None = None) -> str:
    if _page is None:
        return ""
    try:
        if hasattr(_page, "get_title"):
            coro = _page.get_title()
        elif hasattr(_page, "title"):
            coro = _page.title()
        else:
            return ""
        if timeout:
            return await asyncio.wait_for(coro, timeout=timeout)
        return await coro
    except Exception:
        return ""


async def _evaluate(js_arrow_fn: str, *args: Any) -> Any:
    if _page is None:
        return ""
    # New browser-use page wrappers require arrow-function evaluate format.
    if hasattr(_page, "evaluate"):
        return await _page.evaluate(js_arrow_fn, *args)
    # Fallback for Playwright pages.
    if args:
        raise RuntimeError("This page implementation does not support evaluate args")
    return str(await _page.evaluate(js_arrow_fn))


async def _wait_for_ready(wait_until: str = "domcontentloaded", timeout: int = 30000) -> None:
    if _page is None:
        raise RuntimeError("No active page")

    timeout_s = max(0.25, float(timeout) / 1000.0)
    deadline = asyncio.get_event_loop().time() + timeout_s

    async def _wait_for_state(target_states: tuple[str, ...]) -> None:
        while True:
            if asyncio.get_event_loop().time() >= deadline:
                raise TimeoutError(f"Timed out waiting for {wait_until}")
            try:
                state = await _evaluate("() => document.readyState")
            except Exception:
                state = ""
            if state in target_states:
                return
            await asyncio.sleep(0.1)

    if wait_until == "commit":
        return
    if wait_until == "domcontentloaded":
        await _wait_for_state(("interactive", "complete"))
        return
    if wait_until == "load":
        await _wait_for_state(("complete",))
        return
    if wait_until == "networkidle":
        await _wait_for_state(("complete",))
        await asyncio.sleep(0.5)
        return
    await _wait_for_state(("interactive", "complete"))


async def _wait_for_selector(selector: str, timeout: int = 5000) -> bool:
    if not selector:
        return True
    timeout_s = max(0.25, float(timeout) / 1000.0)
    deadline = asyncio.get_event_loop().time() + timeout_s
    while True:
        if asyncio.get_event_loop().time() >= deadline:
            return False
        try:
            found = await _evaluate(
                """(sel) => {
                  const el = document.querySelector(String(sel));
                  if (!el) return false;
                  const style = window.getComputedStyle(el);
                  if (!style) return true;
                  const hidden = style.display === 'none' || style.visibility === 'hidden';
                  const r = el.getBoundingClientRect();
                  return !hidden && (r.width > 0 || r.height > 0);
                }""",
                selector,
            )
            if bool(found):
                return True
        except Exception:
            pass
        await asyncio.sleep(0.12)


def _is_allowed_url(url: str) -> bool:
    u = (url or "").strip().lower()
    if not u:
        return False
    return (
        u.startswith("http://")
        or u.startswith("https://")
        or u.startswith("about:")
    )


async def _goto(url: str, wait_until: str = "domcontentloaded", timeout: int = 30000) -> None:
    if _page is None:
        raise RuntimeError("No active page")
    wait_until = _normalize_wait_until(wait_until)
    timeout = _clamp_int(timeout, 30000, 1000, 180000)
    # New browser-use page wrappers.
    if hasattr(_page, "navigate"):
        await _page.navigate(url)
        await _wait_for_ready(wait_until=wait_until, timeout=timeout)
        return
    if hasattr(_page, "goto"):
        try:
            await _page.goto(url, wait_until=wait_until, timeout=timeout)
        except TypeError:
            await _page.goto(url)
            await _wait_for_ready(wait_until=wait_until, timeout=timeout)
        return
    raise RuntimeError("Page navigation is not supported")


async def _find_elements(selector: str) -> list[Any]:
    if _page is None:
        return []
    if hasattr(_page, "get_elements_by_css_selector"):
        return await _page.get_elements_by_css_selector(selector)
    # Playwright fallback path: return locator as pseudo-element wrapper.
    class _PlaywrightElement:
        def __init__(self, page, css: str):
            self._page = page
            self._css = css

        async def click(self) -> None:
            await self._page.click(self._css)

        async def fill(self, value: str, clear: bool = True) -> None:
            if clear:
                await self._page.fill(self._css, value)
            else:
                await self._page.type(self._css, value)

    return [_PlaywrightElement(_page, selector)]


def _get_playwright_page() -> Any:
    """Try to get the underlying Playwright Page object for robust operations."""
    if _page is None:
        return None
    # Already a Playwright page
    if hasattr(_page, "locator") and hasattr(_page, "fill") and hasattr(_page, "get_by_text"):
        return _page
    # browser-use wraps Playwright page — check common wrapper attributes
    for attr in ("_page", "page", "_playwright_page", "playwright_page"):
        inner = getattr(_page, attr, None)
        if inner and hasattr(inner, "locator") and hasattr(inner, "fill"):
            return inner
    # Walk context pages
    if _context and hasattr(_context, "pages"):
        pages = _context.pages if not callable(_context.pages) else []
        if pages:
            return pages[0]
    return None


async def _smart_wait_for_element(selector: str = "", text: str = "", timeout: int = 5000) -> bool:
    """Wait for an element matching selector or text to be visible on the page."""
    if not selector and not text:
        return True
    timeout_s = max(0.25, float(timeout) / 1000.0)
    deadline = asyncio.get_event_loop().time() + timeout_s

    while asyncio.get_event_loop().time() < deadline:
        try:
            if selector:
                found = await _evaluate(
                    """(sel) => {
                        const el = document.querySelector(sel);
                        if (!el) return false;
                        const r = el.getBoundingClientRect();
                        const s = window.getComputedStyle(el);
                        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                    }""",
                    selector,
                )
                if bool(found):
                    return True
            if text:
                found = await _evaluate(
                    """(needle) => {
                        const all = document.querySelectorAll('*');
                        for (const el of all) {
                            const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
                            if (t && t.toLowerCase().includes(String(needle).toLowerCase())) {
                                const r = el.getBoundingClientRect();
                                const s = window.getComputedStyle(el);
                                if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden') return true;
                            }
                        }
                        return false;
                    }""",
                    text,
                )
                if bool(found):
                    return True
        except Exception:
            pass
        await asyncio.sleep(0.15)
    return False


async def _auto_inject_cookies_on_startup() -> None:
    """Read cookies from the source Chrome profile and inject them into the browser session.

    Called automatically after _ensure_browser launches the browser.
    This compensates for the fact that we remove encrypted Cookie DB files from the
    cloned profile (since they can't be decrypted by a different Chromium instance).
    """
    profile_dir = _current_profile_dir()
    sync_meta = _read_sync_meta(profile_dir)

    source_profile_path = str(sync_meta.get("sourceProfilePath") or "").strip()
    source_user_data_dir = str(sync_meta.get("sourceUserDataDir") or "").strip()

    if not source_profile_path or not source_user_data_dir:
        # No sync source configured — try to auto-detect Chrome
        resolved = await asyncio.to_thread(
            _resolve_sync_source, None, None, "Chrome", "Default"
        )
        if resolved:
            source_profile_path = str(resolved.get("profilePath") or "")
            source_user_data_dir = str(resolved.get("userDataDir") or "")

    if not source_profile_path or not source_user_data_dir:
        return

    if not Path(source_profile_path).exists():
        return

    cookies = await asyncio.to_thread(_read_chrome_cookies, source_profile_path, source_user_data_dir)
    if not cookies:
        print(f"[browser-use-server] No cookies read from Chrome profile", flush=True)
        return

    try:
        result = await _inject_cookies_into_session(cookies)
        injected = result.get("injected", 0)
        failed = result.get("failed", 0)
        print(f"[browser-use-server] Auto-injected {injected} cookies ({failed} failed) from {source_profile_path}", flush=True)
    except Exception as e:
        print(f"[browser-use-server] Cookie injection error: {e}", flush=True)


async def _ensure_browser() -> tuple[bool, Optional[str]]:
    """Lazily start the browser + context + page.

    Uses Playwright's launch_persistent_context for proper cookie/auth persistence.
    Falls back to browser-use library if Playwright direct launch fails.

    Returns:
        (ok, error_message)
    """
    global _browser, _context, _page

    if await _page_is_alive():
        return True, None
    _page = None

    profile_dir = _current_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)
    sync_meta = _read_sync_meta(profile_dir)
    launch_overrides = _browser_launch_overrides(sync_meta)
    managed_profile_dir_name = _managed_profile_dir_name(sync_meta)

    headless = _config["mode"] == "headless"
    cdp_url = _config.get("cdp_url") if _config["mode"] == "connect" else None

    # ── Resolve profile: use Chrome's REAL profile when possible ──
    # Chrome v127+ uses App-Bound Encryption (v20) for cookies. Cloned profiles
    # can't decrypt these cookies. Using Chrome's real User Data dir + real binary
    # means Chrome handles its own cookie decryption natively — everything just works.
    resolved_profile = _resolve_real_browser_profile(sync_meta)

    if resolved_profile:
        effective_user_data_dir = resolved_profile["userDataDir"]
        effective_profile_name = resolved_profile["profileName"]
        use_real_profile = True
        browser_is_running = resolved_profile.get("wasActive", False)
    else:
        effective_user_data_dir = str(profile_dir)
        effective_profile_name = managed_profile_dir_name
        use_real_profile = False
        browser_is_running = False

    full_profile_path = Path(effective_user_data_dir) / effective_profile_name
    if not full_profile_path.exists():
        full_profile_path = Path(effective_user_data_dir)

    # ── Strategy 0: Connect to running Chrome via CDP ──
    # If Chrome is already running with --remote-debugging-port, connect to it
    # directly. This is the best option when Chrome is open — we piggyback on the
    # existing session with all auth intact, no new process needed.
    if not cdp_url and browser_is_running and use_real_profile:
        cdp_port = _detect_chrome_debug_port(effective_user_data_dir)
        if cdp_port:
            cdp_url = f"http://127.0.0.1:{cdp_port}"
            print(f"[browser-use-server] Chrome is running with debug port {cdp_port} — connecting via CDP",
                  flush=True)

    if cdp_url:
        try:
            from playwright.async_api import async_playwright
            pw_instance = await async_playwright().start()
            _playwright = pw_instance

            browser_obj = await pw_instance.chromium.connect_over_cdp(cdp_url)
            contexts = browser_obj.contexts
            if contexts:
                _context = contexts[0]
                pages = _context.pages
                _page = pages[0] if pages else await _context.new_page()
            else:
                _context = await browser_obj.new_context()
                _page = await _context.new_page()

            _browser = None
            print(f"[browser-use-server] Connected to running Chrome via CDP ({cdp_url})",
                  flush=True)
            return True, None
        except Exception as cdp_err:
            print(f"[browser-use-server] CDP connection failed: {cdp_err}", flush=True)
            _browser = _context = _page = None
            cdp_url = None  # Fall through to other strategies

    # ── Strategy 1: Playwright persistent context (BEST for auth) ──
    # launch_persistent_context opens Chrome with a REAL persistent profile.
    # Using the user's actual Chrome binary + real profile directory means Chrome
    # handles v20 App-Bound Encryption natively — no external decryption needed.
    # NOTE: This only works when Chrome is NOT running (profile lock conflict).
    if not cdp_url and not browser_is_running:
        try:
            from playwright.async_api import async_playwright

            pw_instance = await async_playwright().start()

            launch_args: list[str] = [
                f"--profile-directory={effective_profile_name}",
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ]

            launch_kwargs: dict[str, Any] = {
                "headless": headless,
                "args": launch_args,
                # Suppress the "--no-sandbox" unsupported flag warning banner
                "ignore_default_args": ["--enable-automation", "--no-sandbox"],
                "viewport": {"width": 1280, "height": 900},
                "no_viewport": False,
            }

            # Use user's Chrome binary for proper cookie decryption
            exe = launch_overrides.get("executable_path")
            channel = launch_overrides.get("channel")
            if exe:
                launch_kwargs["executable_path"] = exe
            elif channel:
                launch_kwargs["channel"] = channel

            _context = await pw_instance.chromium.launch_persistent_context(
                effective_user_data_dir,
                **launch_kwargs,
            )
            _browser = None  # No separate browser object in persistent mode
            pages = _context.pages
            _page = pages[0] if pages else await _context.new_page()

            mode_label = "REAL profile" if use_real_profile else "managed profile"
            print(f"[browser-use-server] Launched persistent context ({mode_label}) from {effective_user_data_dir} "
                  f"(profile: {effective_profile_name}, exe: {exe or channel or 'default'})",
                  flush=True)

            return True, None
        except Exception as pw_err:
            print(f"[browser-use-server] Playwright persistent context failed, falling back to browser-use: {pw_err}", flush=True)
            # Clean up partial state
            try:
                if _context:
                    await _context.close()
            except Exception:
                pass
            _browser = _context = _page = None

    # If Chrome is running but has no debug port, set it up for next time
    # and fall back to browser-use library for now.
    if browser_is_running and use_real_profile:
        _auto_setup_debug_port_if_needed(effective_user_data_dir)
        print(f"[browser-use-server] Falling back to browser-use library (no auth persistence).", flush=True)

    # ── Strategy 2: browser-use library (fallback) ──
    try:
        from browser_use import Browser
    except ImportError:
        return False, "browser-use is not installed. Run: pip install browser-use"
    except Exception as e:
        return False, f"browser-use import failed: {e}"

    try:
        BrowserConfig = None
        try:
            from browser_use import BrowserConfig as _BrowserConfig  # type: ignore
            BrowserConfig = _BrowserConfig
        except Exception:
            BrowserConfig = None

        if BrowserConfig is not None:
            config_kwargs: dict[str, Any] = {"headless": headless}
            if cdp_url:
                config_kwargs["cdp_url"] = cdp_url
            else:
                config_kwargs["chrome_instance_path"] = launch_overrides.get("executable_path")
                config_kwargs["extra_chromium_args"] = [
                    f"--user-data-dir={profile_dir}",
                    f"--profile-directory={managed_profile_dir_name}",
                    "--disable-blink-features=AutomationControlled",
                ]

            _browser = await asyncio.to_thread(lambda: Browser(config=BrowserConfig(**config_kwargs)))

            # Try to use existing default context (has profile cookies) instead of new_context()
            _context = None
            try:
                if hasattr(_browser, "browser") and hasattr(_browser.browser, "contexts"):
                    contexts = _browser.browser.contexts
                    if contexts:
                        _context = contexts[0]
                        print("[browser-use-server] Using default browser context (preserves auth)", flush=True)
            except Exception:
                pass

            if _context is None:
                _context = await _browser.new_context()
                print("[browser-use-server] Warning: Using new_context() — auth may not persist", flush=True)

            pages = _context.pages if hasattr(_context, "pages") else []
            _page = pages[0] if pages else await _context.new_page()
        else:
            browser_kwargs: dict[str, Any] = {
                "headless": headless,
                "is_local": True,
            }
            if cdp_url:
                browser_kwargs["cdp_url"] = cdp_url
            else:
                browser_kwargs["user_data_dir"] = str(profile_dir)
                browser_kwargs["profile_directory"] = managed_profile_dir_name
                browser_kwargs["args"] = [
                    f"--user-data-dir={profile_dir}",
                    f"--profile-directory={managed_profile_dir_name}",
                    "--disable-blink-features=AutomationControlled",
                ]
                if launch_overrides.get("channel"):
                    browser_kwargs["channel"] = launch_overrides["channel"]
                if launch_overrides.get("executable_path"):
                    browser_kwargs["executable_path"] = launch_overrides["executable_path"]

            _browser = Browser(**browser_kwargs)
            _context = None
            if hasattr(_browser, "start"):
                await _browser.start()
            pages: list[Any] = []
            if hasattr(_browser, "get_pages"):
                try:
                    pages = await _browser.get_pages()
                except Exception:
                    pages = []
            _page = pages[0] if pages else await _browser.new_page()

        # Inject decrypted cookies as a safety net
        try:
            await _auto_inject_cookies_on_startup()
        except Exception as cookie_err:
            print(f"[browser-use-server] Cookie auto-inject failed (non-fatal): {cookie_err}", flush=True)

        return True, None
    except Exception as e:
        try:
            await _close_browser()
        except Exception:
            pass
        print(f"[browser-use-server] init error: {e}", flush=True)
        return False, f"Browser init failed: {e}"


async def _close_browser():
    global _browser, _context, _page
    try:
        if _context:
            await _context.close()
    except Exception:
        pass
    try:
        if _browser:
            if hasattr(_browser, "stop"):
                await _browser.stop()
            elif hasattr(_browser, "close"):
                await _browser.close()
            elif hasattr(_browser, "kill"):
                await _browser.kill()
    except Exception:
        pass
    _browser = _context = _page = None


def _ok(data: dict | None = None) -> web.Response:
    body = {"ok": True, **(data or {})}
    return web.json_response(body)


def _err(msg: str, status: int = 400) -> web.Response:
    return web.json_response({"ok": False, "error": msg}, status=status)


def _make_json_safe(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx >= 200:
                break
            out[str(k)] = _make_json_safe(v, depth + 1)
        return out
    if isinstance(value, (list, tuple, set)):
        return [_make_json_safe(v, depth + 1) for idx, v in enumerate(value) if idx < 200]
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

async def handle_status(_req: web.Request) -> web.Response:
    has_browser_use = True
    try:
        import browser_use  # noqa: F401
    except ImportError:
        has_browser_use = False

    browser_running = await _page_is_alive()
    current_url = ""
    title = ""
    sync_meta = _read_sync_meta(_current_profile_dir())
    if browser_running and _page is not None:
        current_url = await _get_page_url()
        # Guard against slow/frozen browser targets stalling status checks.
        title = await _get_page_title(timeout=0.75)

    # Check Chrome debug port status
    resolved = _resolve_real_browser_profile(sync_meta)
    chrome_debug_port = None
    chrome_is_running = False
    debug_port_configured = False
    if resolved:
        chrome_is_running = resolved.get("wasActive", False)
        chrome_debug_port = _detect_chrome_debug_port(resolved["userDataDir"])
        marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
        debug_port_configured = marker.exists() or chrome_debug_port is not None

    return _ok({
        "installed": has_browser_use,
        "running": browser_running,
        "mode": _config["mode"],
        "profile": _config["profile"],
        "profileDir": str(_current_profile_dir()),
        "currentUrl": current_url,
        "title": title,
        "chromeSync": {
            "enabled": True,
            "managedProfileRoot": str(_current_profile_dir()),
            "sourceProfilePath": sync_meta.get("sourceProfilePath"),
            "sourceUserDataDir": sync_meta.get("sourceUserDataDir"),
            "sourceProfileName": sync_meta.get("sourceSignature", {}).get("profileName") if isinstance(sync_meta.get("sourceSignature"), dict) else None,
            "lastSyncedAt": sync_meta.get("syncedAt"),
            "mode": sync_meta.get("mode"),
        },
        "debugPort": {
            "active": chrome_debug_port is not None,
            "port": chrome_debug_port,
            "configured": debug_port_configured,
            "chromeRunning": chrome_is_running,
        },
    })


async def handle_setup_debug_port(req: web.Request) -> web.Response:
    """Enable Chrome's remote debugging port for CDP connection.

    This modifies Chrome's shortcuts to include --remote-debugging-port=9222.
    Safe and non-destructive — only adds a flag. Chrome must be restarted
    for the change to take effect.

    POST /setup-debug-port
    Optional body: {"port": 9222, "undo": false}
    """
    body = await _safe_json(req)
    port = _clamp_int(body.get("port", 9222), 9222, 1024, 65535)
    undo = bool(body.get("undo", False))

    if undo:
        # Remove the debug port from shortcuts
        try:
            from app.browser_cookies import enable_chrome_debug_port
        except ImportError:
            from browser_cookies import enable_chrome_debug_port  # type: ignore[no-redef]

        # To undo, we'd need a separate function. For now, just remove the marker.
        resolved = _resolve_real_browser_profile(_read_sync_meta(_current_profile_dir()))
        if resolved:
            marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
            if marker.exists():
                marker.unlink()
        return _ok({"undone": True, "message": "Debug port marker removed. Manually remove --remote-debugging-port from your Chrome shortcut to fully disable."})

    try:
        from app.browser_cookies import enable_chrome_debug_port
    except ImportError:
        from browser_cookies import enable_chrome_debug_port  # type: ignore[no-redef]

    result = enable_chrome_debug_port(port)

    if result.get("success"):
        # Write marker
        resolved = _resolve_real_browser_profile(_read_sync_meta(_current_profile_dir()))
        if resolved:
            try:
                marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
                marker.write_text(str(port))
            except Exception:
                pass

    return _ok(result)


async def handle_configure(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    mode = body.get("mode")
    if mode and mode in ("headed", "headless", "connect"):
        _config["mode"] = mode
    if "cdp_url" in body:
        _config["cdp_url"] = body["cdp_url"]
    if "profile" in body:
        _config["profile"] = _normalize_profile_name(body["profile"])

    was_running = await _page_is_alive()
    if was_running:
        await _close_browser()

    return _ok({"mode": _config["mode"], "profile": _config["profile"], "restarted": was_running})


def _resolve_llm(body: dict[str, Any], model_override: str | None = None) -> Any:
    """Build a langchain LLM from request body or environment.

    Priority:
      1. Cloud proxy URL + session token (secure — no API key on user machine)
      2. OPENAI_API_KEY from env (local dev fallback)
      3. GOOGLE_API_KEY from env (local dev fallback; optional adapter)
      4. None (let browser-use fall back to its default, which needs BROWSER_USE_API_KEY)
    """
    proxy_url = body.get("_llm_proxy_url") or ""
    session_token = body.get("_llm_session_token") or ""
    model_name = model_override or body.get("model") or ""

    def _mk_openai_chat(api_key: str, base_url: str | None, model: str):
        # Prefer browser_use bundled ChatOpenAI to avoid extra local dependencies.
        try:
            from browser_use import ChatOpenAI  # type: ignore
            kwargs: dict[str, Any] = {
                "model": model,
                "api_key": api_key,
            }
            if base_url:
                kwargs["base_url"] = base_url
            return ChatOpenAI(**kwargs)
        except Exception:
            pass
        # Fallback for environments that still use langchain_openai.
        try:
            from langchain_openai import ChatOpenAI  # type: ignore
            kwargs2: dict[str, Any] = {
                "model": model,
                "api_key": api_key,
            }
            if base_url:
                kwargs2["base_url"] = base_url
            return ChatOpenAI(**kwargs2)
        except Exception:
            return None

    # Preferred: cloud proxy (OpenAI-compatible endpoint on our cloud server)
    if proxy_url and session_token:
        try:
            base_url = proxy_url.rstrip("/") + "/v1"
            chat = _mk_openai_chat(
                api_key=session_token,
                base_url=base_url,
                model=model_name or "gemini-3-flash-preview",
            )
            if chat is not None:
                return chat
        except Exception as e:
            print(f"[browser-use-server] Cloud proxy LLM init failed: {e}", flush=True)

    # Local dev fallback: OPENAI_API_KEY from env
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if openai_key:
        try:
            chat = _mk_openai_chat(
                api_key=openai_key,
                base_url=None,
                model=model_name or "gpt-4o-mini",
            )
            if chat is not None:
                return chat
        except Exception as e:
            print(f"[browser-use-server] ChatOpenAI init failed: {e}", flush=True)

    # Local dev fallback: GOOGLE_API_KEY from env
    google_key = os.environ.get("GOOGLE_API_KEY", "")
    if google_key:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model=model_name or "gemini-3-flash-preview",
                google_api_key=google_key,
            )
        except Exception as e:
            print(f"[browser-use-server] ChatGoogleGenerativeAI init failed: {e}", flush=True)

    return None


def _fallback_model_candidates(requested_model: str) -> list[str]:
    m = (requested_model or "").strip().lower()
    out: list[str] = []
    if "gemini" in m or m.startswith("google/"):
        # Prefer flash-tier fallbacks first for better availability/latency.
        out.extend([
            "google/gemini-2.5-flash",
            "openai/gpt-4.1-mini",
            "openai/gpt-4o-mini",
            "google/gemini-3-flash-preview",
        ])
    elif "gpt" in m or m.startswith("openai/") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        out.extend([
            "openai/gpt-4o-mini",
            "google/gemini-2.5-flash",
            "google/gemini-3-flash-preview",
        ])
    else:
        out.extend([
            "openai/gpt-4.1-mini",
            "openai/gpt-4o-mini",
            "google/gemini-2.5-flash",
            "google/gemini-3-flash-preview",
        ])
    # Deduplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for x in out:
        if x in seen:
            continue
        seen.add(x)
        deduped.append(x)
    return deduped


async def handle_task(req: web.Request) -> web.Response:
    return _err(
        "browser_use_task is disabled. Use browser_use_execute_script for complex page logic or launch a browser-use subagent for autonomous multi-step browsing.",
        status=410,
    )


async def handle_navigate(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    url = str(body.get("url", "")).strip()
    if not url:
        return _err("url is required")
    if not _is_allowed_url(url):
        return _err("Only http/https/about URLs are allowed")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            wait_until = _normalize_wait_until(body.get("wait_until", "domcontentloaded"))
            timeout = _clamp_int(body.get("timeout", 30000), 30000, 1000, 180000)
            await _goto(url, wait_until=wait_until, timeout=timeout)
            selector = str(body.get("wait_for_selector") or "").strip()
            if selector:
                found = await _wait_for_selector(selector, timeout=_clamp_int(timeout, 5000, 500, 180000))
                if not found:
                    return _err(f"Navigation finished, but selector not found: {selector}")
            return _ok({"url": await _get_page_url(), "title": await _get_page_title()})
        except Exception as e:
            return _err(f"Navigation failed: {e}")


async def handle_click(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    text = str(body.get("text", "")).strip()
    exact = bool(body.get("exact", False))
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not selector and not text:
        return _err("selector or text is required")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            # Strategy 1: Playwright native click by selector (handles waiting, scrolling, retry)
            if selector and pw:
                try:
                    await pw.click(selector, timeout=timeout)
                    return _ok({"clicked": selector, "method": "playwright_selector"})
                except Exception:
                    pass

            # Strategy 2: Playwright text locator
            if text and pw:
                try:
                    locator = pw.get_by_text(text, exact=exact)
                    await locator.first.click(timeout=timeout)
                    return _ok({"clicked": text, "method": "playwright_text"})
                except Exception:
                    pass

            # Strategy 3: Playwright role locator (buttons, links, etc.)
            if text and pw:
                for role in ["button", "link", "menuitem", "tab", "option", "checkbox", "radio"]:
                    try:
                        locator = pw.get_by_role(role, name=text, exact=exact)
                        await locator.first.click(timeout=min(timeout, 2000))
                        return _ok({"clicked": text, "method": f"playwright_role_{role}"})
                    except Exception:
                        continue

            # Strategy 4: Playwright label locator (for form labels that activate inputs)
            if text and pw:
                try:
                    locator = pw.get_by_label(text, exact=exact)
                    await locator.first.click(timeout=min(timeout, 2000))
                    return _ok({"clicked": text, "method": "playwright_label"})
                except Exception:
                    pass

            # Strategy 5: Playwright placeholder locator
            if text and pw:
                try:
                    locator = pw.get_by_placeholder(text, exact=exact)
                    await locator.first.click(timeout=min(timeout, 2000))
                    return _ok({"clicked": text, "method": "playwright_placeholder"})
                except Exception:
                    pass

            # Strategy 6: browser-use native click by selector
            if selector:
                try:
                    els = await _find_elements(selector)
                    if els:
                        await els[0].click()
                        return _ok({"clicked": selector, "method": "browser_use_selector"})
                except Exception:
                    pass

            # Strategy 7: Enhanced JS click with broad element search, scoring, and full event dispatch
            if text:
                clicked = await _evaluate(
                    """(needle, exact, timeoutMs) => {
                      return new Promise((resolve) => {
                        const deadline = Date.now() + timeoutMs;
                        function attempt() {
                          const textOf = (el) => {
                            if (!el) return '';
                            return [
                              el.innerText, el.textContent,
                              el.getAttribute('aria-label'),
                              el.getAttribute('title'),
                              el.getAttribute('placeholder'),
                              el.getAttribute('value'),
                              el.getAttribute('alt'),
                            ].filter(Boolean).map(t => t.trim()).join(' ');
                          };
                          const all = document.querySelectorAll('*');
                          const matches = [];
                          for (const el of all) {
                            const t = textOf(el);
                            if (!t) continue;
                            const isMatch = exact
                              ? t === needle
                              : t.toLowerCase().includes(String(needle).toLowerCase());
                            if (!isMatch) continue;
                            const r = el.getBoundingClientRect();
                            const s = window.getComputedStyle(el);
                            if (r.width === 0 && r.height === 0) continue;
                            if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
                            let score = 0;
                            const tag = el.tagName.toLowerCase();
                            if (['button','a','input','select','textarea'].includes(tag)) score += 100;
                            if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') score += 90;
                            if (el.onclick || el.getAttribute('onclick')) score += 80;
                            if (el.getAttribute('tabindex')) score += 50;
                            if (s.cursor === 'pointer') score += 40;
                            score -= Math.abs(t.length - needle.length) * 0.1;
                            matches.push({ el, score });
                          }
                          if (matches.length > 0) {
                            matches.sort((a, b) => b.score - a.score);
                            const target = matches[0].el;
                            target.scrollIntoView({ block: 'center', inline: 'center' });
                            setTimeout(() => {
                              const r = target.getBoundingClientRect();
                              const cx = r.left + r.width / 2;
                              const cy = r.top + r.height / 2;
                              const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
                              target.dispatchEvent(new PointerEvent('pointerdown', opts));
                              target.dispatchEvent(new MouseEvent('mousedown', opts));
                              target.dispatchEvent(new PointerEvent('pointerup', opts));
                              target.dispatchEvent(new MouseEvent('mouseup', opts));
                              target.dispatchEvent(new MouseEvent('click', opts));
                              if (typeof target.focus === 'function') target.focus();
                              resolve('clicked');
                            }, 50);
                            return;
                          }
                          if (Date.now() < deadline) {
                            setTimeout(attempt, 200);
                          } else {
                            resolve('not_found');
                          }
                        }
                        attempt();
                      });
                    }""",
                    text,
                    exact,
                    timeout,
                )
                if clicked == "clicked":
                    return _ok({"clicked": text, "method": "js_enhanced"})

            # Strategy 8: JS selector click as last resort
            if selector:
                clicked = await _evaluate(
                    """(sel) => {
                      const el = document.querySelector(sel);
                      if (!el) return 'not_found';
                      el.scrollIntoView({ block: 'center', inline: 'center' });
                      const r = el.getBoundingClientRect();
                      const cx = r.left + r.width / 2;
                      const cy = r.top + r.height / 2;
                      const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
                      el.dispatchEvent(new PointerEvent('pointerdown', opts));
                      el.dispatchEvent(new MouseEvent('mousedown', opts));
                      el.dispatchEvent(new PointerEvent('pointerup', opts));
                      el.dispatchEvent(new MouseEvent('mouseup', opts));
                      el.dispatchEvent(new MouseEvent('click', opts));
                      if (typeof el.focus === 'function') el.focus();
                      return 'clicked';
                    }""",
                    selector,
                )
                if clicked == "clicked":
                    return _ok({"clicked": selector, "method": "js_selector"})

            target_desc = selector or text
            return _err(f"Click failed: no element found matching '{target_desc}'")
        except Exception as e:
            return _err(f"Click failed: {e}")


async def handle_type(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    text = str(body.get("text", ""))
    clear = body.get("clear", True)
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            # Strategy 1: Playwright fill (best for React/Vue/Angular — triggers proper change events)
            if selector and pw:
                try:
                    if clear:
                        await pw.fill(selector, text, timeout=timeout)
                    else:
                        await pw.type(selector, text, timeout=timeout)
                    return _ok({"typed": len(text), "method": "playwright_fill"})
                except Exception:
                    pass

            # Strategy 2: Playwright keyboard typing into focused element
            if not selector and pw:
                try:
                    if clear:
                        # Select all and delete before typing
                        await pw.keyboard.press("Control+a")
                        await pw.keyboard.press("Delete")
                    await pw.keyboard.type(text, delay=20)
                    return _ok({"typed": len(text), "method": "playwright_keyboard"})
                except Exception:
                    pass

            # Strategy 3: browser-use native fill by selector
            if selector:
                try:
                    els = await _find_elements(selector)
                    if els:
                        await els[0].fill(text, clear=clear)
                        return _ok({"typed": len(text), "method": "browser_use_fill"})
                except Exception:
                    pass

            # Strategy 4: Enhanced JS with React/Vue-compatible event simulation
            result = await _evaluate(
                """(value, clearFirst, sel) => {
                  let el = sel ? document.querySelector(sel) : document.activeElement;
                  if (!el) return { status: 'no_element', detail: 'No element found' };

                  // If element isn't an input, try to find the input inside it
                  const tag = el.tagName.toLowerCase();
                  if (!['input', 'textarea'].includes(tag) && !el.isContentEditable) {
                    const child = el.querySelector('input, textarea, [contenteditable="true"]');
                    if (child) el = child;
                  }

                  // Focus the element
                  if (typeof el.focus === 'function') el.focus();
                  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
                  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

                  if ('value' in el) {
                    // Use the native setter to bypass React's synthetic event system
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                      el.tagName === 'TEXTAREA'
                        ? window.HTMLTextAreaElement.prototype
                        : window.HTMLInputElement.prototype,
                      'value'
                    )?.set;

                    if (clearFirst) {
                      if (nativeSetter) nativeSetter.call(el, '');
                      else el.value = '';
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    const newValue = clearFirst ? String(value ?? '') : (el.value || '') + String(value ?? '');
                    if (nativeSetter) nativeSetter.call(el, newValue);
                    else el.value = newValue;

                    // Dispatch full event chain for framework compatibility
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    // Also dispatch InputEvent for modern frameworks
                    try {
                      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
                    } catch(e) {}
                    return { status: 'ok', typed: newValue.length };
                  } else if (el.isContentEditable) {
                    if (clearFirst) el.textContent = '';
                    el.textContent = (el.textContent || '') + String(value ?? '');
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return { status: 'ok', typed: el.textContent.length };
                  }
                  return { status: 'not_text_target', detail: 'Element is not a text input' };
                }""",
                text,
                clear,
                selector or "",
            )

            if isinstance(result, dict) and result.get("status") == "ok":
                return _ok({"typed": len(text), "method": "js_enhanced"})
            detail = result.get("detail", "Unknown error") if isinstance(result, dict) else str(result)
            return _err(f"Type failed: {detail}")
        except Exception as e:
            return _err(f"Type failed: {e}")


async def handle_press_key(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    key = str(body.get("key", "")).strip()
    selector = str(body.get("selector", "")).strip()
    if not key:
        return _err("key is required")
    if len(key) > 64:
        return _err("key is too long")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                focused = await _evaluate(
                    """(sel, dir, amt) => {
                      const el = document.querySelector(sel);
                      if (!el) return 'not_found';
                      if (typeof el.focus === 'function') el.focus();
                      return 'ok';
                    }""",
                    selector,
                )
                if focused != "ok":
                    return _err(f"Press key failed: selector not found: {selector}")

            # Prefer native keyboard APIs when available.
            keyboard = getattr(_page, "keyboard", None)
            if keyboard is not None and hasattr(keyboard, "press"):
                await keyboard.press(key)
                return _ok({"key": key})
            if hasattr(_page, "send_keys"):
                await _page.send_keys(key)
                return _ok({"key": key})

            # JS fallback for wrappers without keyboard API.
            dispatched = await _evaluate(
                """(k) => {
                  const key = String(k || '');
                  const target = document.activeElement || document.body;
                  if (!target) return 'no_target';
                  const keyCodeMap = {
                    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
                    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
                  };
                  const keyCode = keyCodeMap[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
                  const evtInit = {
                    key,
                    code: key,
                    keyCode,
                    which: keyCode,
                    bubbles: true,
                    cancelable: true,
                  };
                  target.dispatchEvent(new KeyboardEvent('keydown', evtInit));
                  target.dispatchEvent(new KeyboardEvent('keypress', evtInit));
                  target.dispatchEvent(new KeyboardEvent('keyup', evtInit));
                  if (key === 'Enter') {
                    const form = target && target.form;
                    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
                  }
                  return 'ok';
                }""",
                key,
            )
            if dispatched != "ok":
                return _err("Press key failed")
            return _ok({"key": key})
        except Exception as e:
            return _err(f"Press key failed: {e}")


async def handle_screenshot(req: web.Request) -> web.Response:
    body = await req.json() if req.content_length else {}

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            full_page = body.get("full_page", False)
            if hasattr(_page, "screenshot"):
                screenshot_dir = Path(tempfile.gettempdir()) / "stuard-browser-use-screenshots"
                screenshot_dir.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(delete=False, suffix=".png", prefix="browser-use-", dir=str(screenshot_dir)) as tmp:
                    screenshot_path = Path(tmp.name)
                if "full_page" in str(_page.screenshot):
                    raw_screenshot = await _page.screenshot(full_page=full_page)
                else:
                    raw_screenshot = await _page.screenshot()
                if isinstance(raw_screenshot, memoryview):
                    screenshot_bytes = raw_screenshot.tobytes()
                elif isinstance(raw_screenshot, (bytes, bytearray)):
                    screenshot_bytes = bytes(raw_screenshot)
                else:
                    raw_text = str(raw_screenshot or "").strip()
                    if raw_text.startswith("data:") and "," in raw_text:
                        raw_text = raw_text.split(",", 1)[1]
                    try:
                        screenshot_bytes = base64.b64decode(raw_text, validate=False)
                    except Exception as decode_error:
                        raise RuntimeError(f"Unsupported screenshot payload: {decode_error}")
                screenshot_path.write_bytes(screenshot_bytes)
            else:
                return _err("Screenshot not supported")
            return _ok({
                "image_path": str(screenshot_path),
                "screenshot_path": str(screenshot_path),
                "format": "png",
                "url": await _get_page_url(),
                "width": int(await _evaluate("() => String(window.innerWidth || 0)") or "0"),
                "height": int(await _evaluate("() => String(window.innerHeight || 0)") or "0"),
            })
        except Exception as e:
            return _err(f"Screenshot failed: {e}")


async def handle_content(req: web.Request) -> web.Response:
    body = await _safe_json(req) if req.content_length else {}

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            mode = str(body.get("mode", "text")).strip().lower()
            if mode not in ("text", "html"):
                mode = "text"
            max_length = _clamp_int(body.get("max_length", 50000), 50000, 500, 200000)
            selector = str(body.get("wait_for_selector") or "").strip()
            wait_timeout = _clamp_int(body.get("wait_timeout", 5000), 5000, 500, 60000)
            if selector:
                await _wait_for_selector(selector, timeout=wait_timeout)
            url = await _get_page_url()
            title = await _get_page_title()

            if mode == "html":
                if hasattr(_page, "content"):
                    content = await _page.content()
                else:
                    content = await _evaluate("() => document.documentElement.outerHTML")
            else:
                content = await _evaluate(
                    """() => {
                      // Remove hidden/script/style elements from consideration
                      const hidden = new Set();
                      document.querySelectorAll('script, style, noscript, [hidden], [aria-hidden="true"]').forEach(el => hidden.add(el));

                      // Try semantic content areas first, fall back to body
                      const root =
                        document.querySelector('article') ||
                        document.querySelector('main') ||
                        document.querySelector('[role="main"]') ||
                        document.querySelector('#content') ||
                        document.querySelector('.content') ||
                        document.body ||
                        document.documentElement;
                      if (!root) return '';

                      // Build structured text with headings and sections
                      const parts = [];
                      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                        acceptNode: (node) => {
                          if (hidden.has(node) || hidden.has(node.parentElement)) return NodeFilter.FILTER_REJECT;
                          if (node.nodeType === Node.ELEMENT_NODE) {
                            const s = window.getComputedStyle(node);
                            if (s.display === 'none' || s.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
                          }
                          return NodeFilter.FILTER_ACCEPT;
                        }
                      });

                      let node;
                      while (node = walker.nextNode()) {
                        if (node.nodeType === Node.TEXT_NODE) {
                          const text = node.textContent.replace(/\\u00a0/g, ' ').trim();
                          if (text) parts.push(text);
                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                          const tag = node.tagName.toLowerCase();
                          if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
                            parts.push('\\n\\n### ' + (node.innerText || '').trim() + '\\n');
                          } else if (tag === 'br' || tag === 'hr') {
                            parts.push('\\n');
                          } else if (['p','div','section','li','tr'].includes(tag)) {
                            parts.push('\\n');
                          }
                        }
                      }

                      return parts.join(' ').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
                    }"""
                )

            return _ok({
                "url": url,
                "title": title,
                "content": str(content or "")[:max_length],
                "mode": mode,
            })
        except Exception as e:
            return _err(f"Content extraction failed: {e}")


async def handle_execute_script(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    script = str(body.get("script", "")).strip()
    if not script:
        return _err("script is required")
    if len(script) > 50000:
        return _err("script is too long")

    raw_args = body.get("args")
    if raw_args is None:
        script_args: dict[str, Any] = {}
    elif isinstance(raw_args, dict):
        script_args = raw_args
    else:
        return _err("args must be an object")

    wait_for_selector = str(body.get("wait_for_selector") or "").strip()
    wait_timeout = _clamp_int(body.get("wait_timeout", 5000), 5000, 250, 120000)
    timeout_ms = _clamp_int(body.get("timeout", 30000), 30000, 250, 300000)
    wrapped_script = (
        "async (input) => {\n"
        "  const args = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};\n"
        f"{script}\n"
        "}"
    )

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if wait_for_selector:
                found = await _wait_for_selector(wait_for_selector, timeout=wait_timeout)
                if not found:
                    return _err(f"Timed out waiting for selector: {wait_for_selector}")

            started_at = asyncio.get_event_loop().time()
            result = await asyncio.wait_for(
                _evaluate(wrapped_script, script_args),
                timeout=max(0.25, float(timeout_ms) / 1000.0),
            )
            elapsed_ms = int((asyncio.get_event_loop().time() - started_at) * 1000)
            return _ok({
                "result": _make_json_safe(result),
                "url": await _get_page_url(),
                "title": await _get_page_title(),
                "elapsedMs": elapsed_ms,
            })
        except asyncio.TimeoutError:
            return _err(f"Execute script timed out after {timeout_ms}ms")
        except Exception as e:
            return _err(f"Execute script failed: {e}")


async def handle_scroll(req: web.Request) -> web.Response:
    body = await req.json()
    direction = body.get("direction", "down")
    amount = body.get("amount", 500)
    selector = body.get("selector")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                await _evaluate(
                    """(sel, dir, amt) => {
                      const el = document.querySelector(sel);
                      if (!el) return 'not_found';
                      const delta = dir === 'down' ? amt : -amt;
                      if (dir === 'left' || dir === 'right') {
                        el.scrollBy({ left: dir === 'right' ? amt : -amt, top: 0, behavior: 'auto' });
                      } else {
                        el.scrollBy({ top: delta, left: 0, behavior: 'auto' });
                      }
                      return 'ok';
                    }""",
                    selector,
                    direction,
                    amount,
                )
            else:
                delta = amount if direction == "down" else -amount
                if direction in ("left", "right"):
                    await _evaluate(
                        "(dir, amt) => { window.scrollBy(dir === 'right' ? amt : -amt, 0); return 'ok'; }",
                        direction,
                        amount,
                    )
                else:
                    await _evaluate("(d) => { window.scrollBy(0, d); return 'ok'; }", delta)
            return _ok({"direction": direction, "amount": amount})
        except Exception as e:
            return _err(f"Scroll failed: {e}")


async def handle_tabs(req: web.Request) -> web.Response:
    body = await req.json()
    action = body.get("action", "list")

    global _page
    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if _browser and hasattr(_browser, "get_pages") and hasattr(_browser, "new_page"):
                pages = await _browser.get_pages()
                active_idx = 0
                for i, p in enumerate(pages):
                    if p is _page:
                        active_idx = i
                        break

                if action == "list":
                    tabs: list[dict[str, Any]] = []
                    for i, p in enumerate(pages):
                        url = ""
                        title = ""
                        try:
                            if hasattr(p, "get_url"):
                                url = await p.get_url()
                            else:
                                url = getattr(p, "url", "") or ""
                        except Exception:
                            pass
                        try:
                            if hasattr(p, "get_title"):
                                title = await p.get_title()
                            elif hasattr(p, "title"):
                                title = await p.title()
                        except Exception:
                            pass
                        tabs.append({
                            "index": i,
                            "url": url,
                            "title": title,
                            "active": i == active_idx,
                        })
                    return _ok({"tabs": tabs, "count": len(tabs)})

                elif action == "new":
                    url = body.get("url")
                    _page = await _browser.new_page(url) if url else await _browser.new_page()
                    return _ok({"url": await _get_page_url(), "title": await _get_page_title()})

                elif action == "switch":
                    index = body.get("index", 0)
                    if 0 <= index < len(pages):
                        _page = pages[index]
                        return _ok({"url": await _get_page_url(), "title": await _get_page_title()})
                    return _err(f"Tab index {index} out of range (0-{len(pages) - 1})")

                elif action == "close":
                    index = body.get("index")
                    if index is not None and 0 <= index < len(pages):
                        target = pages[index]
                        if hasattr(_browser, "close_page"):
                            await _browser.close_page(target)
                        pages = await _browser.get_pages()
                        if pages:
                            _page = pages[-1]
                        else:
                            _page = await _browser.new_page()
                        return _ok({"closed": index, "remaining": len(pages)})
                    return _err("index is required for close action")

                return _err(f"Unknown tabs action: {action}")

            if action == "list":
                pages = _context.pages if _context else []
                tabs = []
                for i, p in enumerate(pages):
                    tabs.append({
                        "index": i,
                        "url": p.url,
                        "title": await p.title(),
                        "active": p == _page,
                    })
                return _ok({"tabs": tabs, "count": len(tabs)})

            elif action == "new":
                _page = await _context.new_page()
                url = body.get("url")
                if url:
                    await _page.goto(url, wait_until="domcontentloaded")
                return _ok({"url": _page.url, "title": await _page.title()})

            elif action == "switch":
                index = body.get("index", 0)
                pages = _context.pages if _context else []
                if 0 <= index < len(pages):
                    _page = pages[index]
                    await _page.bring_to_front()
                    return _ok({"url": _page.url, "title": await _page.title()})
                return _err(f"Tab index {index} out of range (0-{len(pages) - 1})")

            elif action == "close":
                index = body.get("index")
                pages = _context.pages if _context else []
                if index is not None and 0 <= index < len(pages):
                    target = pages[index]
                    await target.close()
                    pages = _context.pages
                    _page = pages[-1] if pages else await _context.new_page()
                    return _ok({"closed": index, "remaining": len(_context.pages)})
                return _err("index is required for close action")

            return _err(f"Unknown tabs action: {action}")
        except Exception as e:
            return _err(f"Tabs operation failed: {e}")


async def handle_cookies(req: web.Request) -> web.Response:
    body = await req.json()
    action = body.get("action", "get")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if _browser and hasattr(_browser, "cookies"):
                if action == "get":
                    raw_cookies = await _browser.cookies()
                    cookies = [_jsonable_cookie(c) for c in raw_cookies]
                    urls = body.get("urls")
                    if urls:
                        try:
                            from urllib.parse import urlparse
                            hosts = {urlparse(u).hostname or "" for u in urls}
                            cookies = [
                                c for c in cookies
                                if any(
                                    h and (h == str(c.get("domain", "")).lstrip(".") or h.endswith(str(c.get("domain", "")).lstrip(".")))
                                    for h in hosts
                                )
                            ]
                        except Exception:
                            pass
                    return _ok({"cookies": cookies, "count": len(cookies)})

                elif action == "set":
                    cookies = body.get("cookies", [])
                    if not cookies:
                        return _err("cookies array is required for set action")
                    if hasattr(_browser, "_cdp_set_cookies"):
                        await _browser._cdp_set_cookies(cookies)
                    else:
                        return _err("Cookie set not supported by this browser-use version")
                    return _ok({"set": len(cookies)})

                elif action == "clear":
                    if hasattr(_browser, "clear_cookies"):
                        await _browser.clear_cookies()
                    elif hasattr(_browser, "_cdp_clear_cookies"):
                        await _browser._cdp_clear_cookies()
                    return _ok({"cleared": True})

                elif action == "export":
                    raw_cookies = await _browser.cookies()
                    cookies = [_jsonable_cookie(c) for c in raw_cookies]
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
                    if hasattr(_browser, "_cdp_set_cookies"):
                        await _browser._cdp_set_cookies(cookies)
                    else:
                        return _err("Cookie import not supported by this browser-use version")
                    return _ok({"imported": len(cookies)})

                return _err(f"Unknown cookies action: {action}")

            if action == "get":
                urls = body.get("urls")
                cookies = await _context.cookies(urls) if urls else await _context.cookies()
                return _ok({"cookies": cookies, "count": len(cookies)})

            elif action == "set":
                cookies = body.get("cookies", [])
                if not cookies:
                    return _err("cookies array is required for set action")
                await _context.add_cookies(cookies)
                return _ok({"set": len(cookies)})

            elif action == "clear":
                await _context.clear_cookies()
                return _ok({"cleared": True})

            elif action == "export":
                cookies = await _context.cookies()
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
                await _context.add_cookies(cookies)
                return _ok({"imported": len(cookies)})

            return _err(f"Unknown cookies action: {action}")
        except Exception as e:
            return _err(f"Cookies operation failed: {e}")


# ---------------------------------------------------------------------------
# Chrome cookie sync — read cookies from real Chrome and inject into session
# ---------------------------------------------------------------------------

def _find_chrome_user_data_dirs() -> list[dict[str, Any]]:
    """Detect Chrome/Edge/Brave/Arc/Opera/Vivaldi user data dirs on this system.
    Delegates to the standalone browser_cookies module.
    """
    return discover_browsers()


def _read_chrome_cookies(profile_path: str, user_data_dir: str) -> list[dict[str, Any]]:
    """Read and decrypt cookies from a Chrome-compatible profile.
    Delegates to the standalone browser_cookies module.
    """
    return read_cookies_as_dicts(
        profile_path=profile_path,
        user_data_dir=user_data_dir,
        is_firefox=False,
    )


def _resolve_sync_source(
    profile_path: str | None,
    user_data_dir: str | None,
    browser_name: str | None = None,
    profile_name: str | None = None,
) -> dict[str, Any] | None:
    browsers = _find_chrome_user_data_dirs()

    if profile_path:
        profile_candidate = Path(profile_path)
        if not profile_candidate.exists():
            return None
        if not user_data_dir:
            user_data_dir = str(profile_candidate.parent)
        browser_label = None
        resolved_profile_name = profile_candidate.name
        for browser in browsers:
            for profile in browser.get("profiles", []):
                if Path(profile.get("path", "")) == profile_candidate:
                    browser_label = browser.get("browser")
                    resolved_profile_name = profile.get("name") or resolved_profile_name
                    user_data_dir = browser.get("userDataDir") or user_data_dir
                    break
            if browser_label:
                break
        return {
            "browser": browser_label or browser_name or "Chrome",
            "userDataDir": str(user_data_dir),
            "profilePath": str(profile_candidate),
            "profileName": resolved_profile_name,
        }

    preferred_browser = str(browser_name or "Chrome").strip().lower()
    preferred_profile = str(profile_name or "Default").strip().lower()

    exact_browser = None
    fallback_browser = None
    for browser in browsers:
        browser_label = str(browser.get("browser") or "")
        browser_matches = browser_label.lower() == preferred_browser if preferred_browser else True
        if browser_matches and exact_browser is None:
            exact_browser = browser
        if browser_label.lower() == "chrome" and fallback_browser is None:
            fallback_browser = browser

    selected_browser = exact_browser or fallback_browser or (browsers[0] if browsers else None)
    if not selected_browser:
        return None

    profiles = selected_browser.get("profiles") or []
    selected_profile = None
    for profile in profiles:
        if str(profile.get("name") or "").strip().lower() == preferred_profile:
            selected_profile = profile
            break
    if selected_profile is None and profiles:
        selected_profile = profiles[0]
    if not selected_profile:
        return None

    return {
        "browser": selected_browser.get("browser") or "Chrome",
        "userDataDir": selected_browser.get("userDataDir"),
        "profilePath": selected_profile.get("path"),
        "profileName": selected_profile.get("name") or Path(str(selected_profile.get("path") or "Default")).name,
    }


def _normalize_cookies_for_playwright(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize cookies to be compatible with Playwright's add_cookies format.

    Playwright requires either 'url' or ('domain' + 'path').
    Chrome stores domains with leading dots (e.g., '.google.com') which is fine.
    """
    normalized = []
    for cookie in cookies:
        c = dict(cookie)  # shallow copy

        domain = str(c.get("domain", "")).strip()
        if not domain:
            continue

        # Ensure path is set
        if "path" not in c or not c["path"]:
            c["path"] = "/"

        # Playwright needs sameSite to be a specific enum
        same_site = str(c.get("sameSite", "None")).strip()
        if same_site not in ("Strict", "Lax", "None"):
            same_site = "None"
        c["sameSite"] = same_site

        # If domain starts with dot, add a url for better compatibility
        if "url" not in c:
            scheme = "https" if c.get("secure") else "http"
            clean_domain = domain.lstrip(".")
            c["url"] = f"{scheme}://{clean_domain}/"

        # Remove None/empty values that could cause Playwright errors
        c = {k: v for k, v in c.items() if v is not None}

        normalized.append(c)
    return normalized


async def _inject_cookies_into_session(cookies: list[dict[str, Any]]) -> dict[str, int]:
    injected = 0
    failed = 0

    # Normalize cookies for Playwright compatibility
    normalized = _normalize_cookies_for_playwright(cookies)
    if not normalized:
        return {"injected": 0, "failed": 0}

    if _browser and hasattr(_browser, "_cdp_set_cookies"):
        try:
            await _browser._cdp_set_cookies(normalized)
            injected = len(normalized)
        except Exception as e:
            print(f"[browser-use-server] CDP cookie set failed: {e}", flush=True)
            failed = len(normalized)
        return {"injected": injected, "failed": failed}

    if _context:
        batch_size = 50
        for i in range(0, len(normalized), batch_size):
            batch = normalized[i:i + batch_size]
            try:
                await _context.add_cookies(batch)
                injected += len(batch)
            except Exception:
                # If batch fails, try one at a time to maximize success
                for cookie in batch:
                    try:
                        await _context.add_cookies([cookie])
                        injected += 1
                    except Exception:
                        failed += 1
        return {"injected": injected, "failed": failed}

    raise RuntimeError("No browser context available for cookie injection")


async def handle_sync_chrome(req: web.Request) -> web.Response:
    """Sync cookies from a real Chrome profile into the browser-use session."""
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
            list_cookie_domains,
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
        domain_filter = body.get("domains")  # Optional: list of domains to import

        cookies = await asyncio.to_thread(
            lambda: read_cookies_as_dicts(
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

        async with _lock:
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

            # Only clone the profile on first-time setup or when explicitly forced.
            # Re-cloning when the browser is not running would destroy any sessions
            # the user logged into manually in the browser-use window.
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
            # Only inject cookies if the browser is already running — don't launch
            # the browser just to inject cookies during background sync
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


async def handle_hover(req: web.Request) -> web.Response:
    """Hover over an element identified by selector or text."""
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    text = str(body.get("text", "")).strip()
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not selector and not text:
        return _err("selector or text is required")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            if selector and pw:
                try:
                    await pw.hover(selector, timeout=timeout)
                    return _ok({"hovered": selector, "method": "playwright_selector"})
                except Exception:
                    pass

            if text and pw:
                try:
                    locator = pw.get_by_text(text)
                    await locator.first.hover(timeout=timeout)
                    return _ok({"hovered": text, "method": "playwright_text"})
                except Exception:
                    pass

            # JS fallback
            target = selector or text
            result = await _evaluate(
                """(sel, needle) => {
                  let el = sel ? document.querySelector(sel) : null;
                  if (!el && needle) {
                    const all = document.querySelectorAll('*');
                    for (const candidate of all) {
                      const t = (candidate.innerText || candidate.textContent || '').trim();
                      if (t && t.toLowerCase().includes(needle.toLowerCase())) {
                        const r = candidate.getBoundingClientRect();
                        const s = window.getComputedStyle(candidate);
                        if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden') {
                          el = candidate;
                          break;
                        }
                      }
                    }
                  }
                  if (!el) return 'not_found';
                  el.scrollIntoView({ block: 'center', inline: 'center' });
                  const r = el.getBoundingClientRect();
                  const opts = { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 };
                  el.dispatchEvent(new PointerEvent('pointerover', opts));
                  el.dispatchEvent(new MouseEvent('mouseover', opts));
                  el.dispatchEvent(new PointerEvent('pointerenter', opts));
                  el.dispatchEvent(new MouseEvent('mouseenter', opts));
                  return 'hovered';
                }""",
                selector,
                text,
            )
            if result == "hovered":
                return _ok({"hovered": target, "method": "js_hover"})
            return _err(f"Hover failed: element not found for '{target}'")
        except Exception as e:
            return _err(f"Hover failed: {e}")


async def handle_select_option(req: web.Request) -> web.Response:
    """Select an option from a dropdown/select element."""
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    value = body.get("value")
    label = body.get("label")
    index = body.get("index")
    timeout = _clamp_int(body.get("timeout", 5000), 5000, 500, 30000)

    if not selector:
        return _err("selector is required for select_option")
    if value is None and label is None and index is None:
        return _err("One of value, label, or index is required")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            if pw:
                try:
                    if value is not None:
                        selected = await pw.select_option(selector, value=str(value), timeout=timeout)
                    elif label is not None:
                        selected = await pw.select_option(selector, label=str(label), timeout=timeout)
                    elif index is not None:
                        selected = await pw.select_option(selector, index=int(index), timeout=timeout)
                    else:
                        selected = []
                    return _ok({"selected": selected, "method": "playwright"})
                except Exception:
                    pass

            # JS fallback
            result = await _evaluate(
                """(sel, val, lbl, idx) => {
                  const el = document.querySelector(sel);
                  if (!el || el.tagName !== 'SELECT') return { status: 'not_select', detail: 'Element is not a <select>' };
                  let matched = false;
                  for (let i = 0; i < el.options.length; i++) {
                    const opt = el.options[i];
                    if (val !== null && val !== undefined && opt.value === String(val)) {
                      el.selectedIndex = i; matched = true; break;
                    }
                    if (lbl !== null && lbl !== undefined && opt.text.trim().toLowerCase().includes(String(lbl).toLowerCase())) {
                      el.selectedIndex = i; matched = true; break;
                    }
                    if (idx !== null && idx !== undefined && i === Number(idx)) {
                      el.selectedIndex = i; matched = true; break;
                    }
                  }
                  if (!matched) return { status: 'no_match', detail: 'No matching option found' };
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  return { status: 'ok', value: el.value, text: el.options[el.selectedIndex].text };
                }""",
                selector,
                value,
                label,
                index,
            )
            if isinstance(result, dict) and result.get("status") == "ok":
                return _ok({"selected": result.get("value"), "text": result.get("text"), "method": "js"})
            detail = result.get("detail", "Unknown error") if isinstance(result, dict) else str(result)
            return _err(f"Select option failed: {detail}")
        except Exception as e:
            return _err(f"Select option failed: {e}")


async def handle_get_interactive_elements(req: web.Request) -> web.Response:
    """Return all interactive elements on the page with their attributes, labels, and current values.

    This is the key tool for the AI to understand page structure and make informed decisions
    about what to click, type, or interact with.
    """
    body = await _safe_json(req) if req.content_length else {}

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            wait_selector = str(body.get("wait_for_selector", "")).strip()
            wait_timeout = _clamp_int(body.get("wait_timeout", 3000), 3000, 500, 30000)
            if wait_selector:
                await _wait_for_selector(wait_selector, timeout=wait_timeout)

            result = await _evaluate(
                """() => {
                  const elements = [];
                  const forms = [];

                  // Helper: get best CSS selector for an element
                  function getSelector(el) {
                    if (el.id) return '#' + CSS.escape(el.id);
                    if (el.name && el.tagName !== 'DIV' && el.tagName !== 'SPAN') {
                      const byName = document.querySelectorAll(el.tagName.toLowerCase() + '[name="' + el.name + '"]');
                      if (byName.length === 1) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
                    }
                    // Try class-based selector
                    if (el.className && typeof el.className === 'string') {
                      const classes = el.className.trim().split(/\\s+/).filter(c => c && !c.startsWith('css-') && c.length < 40).slice(0, 3);
                      if (classes.length > 0) {
                        const sel = el.tagName.toLowerCase() + '.' + classes.map(c => CSS.escape(c)).join('.');
                        const found = document.querySelectorAll(sel);
                        if (found.length === 1) return sel;
                      }
                    }
                    // Fall back to nth-child path
                    const path = [];
                    let current = el;
                    while (current && current !== document.body && path.length < 5) {
                      let seg = current.tagName.toLowerCase();
                      if (current.id) { path.unshift('#' + CSS.escape(current.id)); break; }
                      const parent = current.parentElement;
                      if (parent) {
                        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                        if (siblings.length > 1) {
                          const idx = siblings.indexOf(current) + 1;
                          seg += ':nth-of-type(' + idx + ')';
                        }
                      }
                      path.unshift(seg);
                      current = parent;
                    }
                    return path.join(' > ');
                  }

                  // Helper: find associated label for an input
                  function getLabel(el) {
                    // Check for <label for="id">
                    if (el.id) {
                      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
                      if (label) return (label.innerText || label.textContent || '').trim();
                    }
                    // Check for wrapping <label>
                    const parentLabel = el.closest('label');
                    if (parentLabel) {
                      const text = (parentLabel.innerText || parentLabel.textContent || '').trim();
                      // Remove the input's own value from the label text
                      const inputVal = el.value || '';
                      return text.replace(inputVal, '').trim();
                    }
                    // Check aria-label
                    const ariaLabel = el.getAttribute('aria-label');
                    if (ariaLabel) return ariaLabel.trim();
                    // Check aria-labelledby
                    const labelledBy = el.getAttribute('aria-labelledby');
                    if (labelledBy) {
                      const labelEl = document.getElementById(labelledBy);
                      if (labelEl) return (labelEl.innerText || labelEl.textContent || '').trim();
                    }
                    // Check preceding sibling or adjacent text
                    const prev = el.previousElementSibling;
                    if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
                      const t = (prev.innerText || prev.textContent || '').trim();
                      if (t && t.length < 80) return t;
                    }
                    return '';
                  }

                  function isVisible(el) {
                    const r = el.getBoundingClientRect();
                    const s = window.getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
                  }

                  // Collect all interactive elements
                  const interactiveSelectors = 'input, textarea, select, button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="searchbox"], [role="textbox"], [contenteditable="true"]';
                  const all = document.querySelectorAll(interactiveSelectors);

                  for (const el of all) {
                    if (!isVisible(el)) continue;

                    const tag = el.tagName.toLowerCase();
                    const type = el.getAttribute('type') || '';
                    const role = el.getAttribute('role') || '';
                    const name = el.getAttribute('name') || '';
                    const id = el.id || '';
                    const placeholder = el.getAttribute('placeholder') || '';
                    const ariaLabel = el.getAttribute('aria-label') || '';
                    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
                    const required = el.required || el.getAttribute('aria-required') === 'true';
                    const readonly = el.readOnly || el.getAttribute('aria-readonly') === 'true';

                    const entry = {
                      index: elements.length,
                      tag: tag,
                      selector: getSelector(el),
                    };

                    if (type) entry.type = type;
                    if (role) entry.role = role;
                    if (name) entry.name = name;
                    if (id) entry.id = id;

                    // Text content for buttons/links
                    if (['button', 'a'].includes(tag) || ['button', 'link', 'tab', 'menuitem'].includes(role)) {
                      const text = (el.innerText || el.textContent || ariaLabel || '').trim();
                      if (text) entry.text = text.substring(0, 200);
                      if (tag === 'a') entry.href = el.getAttribute('href') || '';
                    }

                    // Label and value for form elements
                    if (['input', 'textarea', 'select'].includes(tag) || ['textbox', 'searchbox', 'combobox'].includes(role)) {
                      const label = getLabel(el);
                      if (label) entry.label = label.substring(0, 200);
                      if (placeholder) entry.placeholder = placeholder;

                      if (tag === 'select') {
                        entry.value = el.value;
                        const selectedOption = el.options && el.options[el.selectedIndex];
                        if (selectedOption) entry.selectedText = selectedOption.text.trim();
                        entry.options = Array.from(el.options || []).slice(0, 30).map(o => ({
                          value: o.value, text: o.text.trim(), selected: o.selected
                        }));
                      } else if (type === 'checkbox' || type === 'radio') {
                        entry.checked = el.checked;
                        const label = getLabel(el);
                        if (label) entry.label = label.substring(0, 200);
                      } else {
                        entry.value = (el.value || '').substring(0, 500);
                      }
                    }

                    if (disabled) entry.disabled = true;
                    if (required) entry.required = true;
                    if (readonly) entry.readonly = true;

                    elements.push(entry);
                  }

                  // Collect forms
                  const allForms = document.querySelectorAll('form');
                  for (const form of allForms) {
                    if (!isVisible(form)) continue;
                    const formEntry = {
                      selector: getSelector(form),
                      action: form.action || '',
                      method: (form.method || 'GET').toUpperCase(),
                      name: form.name || form.id || '',
                      fieldIndices: [],
                    };
                    // Map form fields to element indices
                    for (const field of form.elements) {
                      const idx = elements.findIndex(e => {
                        try { return document.querySelector(e.selector) === field; } catch { return false; }
                      });
                      if (idx >= 0) formEntry.fieldIndices.push(idx);
                    }
                    forms.push(formEntry);
                  }

                  return { elements: elements, forms: forms };
                }"""
            )

            url = await _get_page_url()
            title = await _get_page_title()
            elements = result.get("elements", []) if isinstance(result, dict) else []
            forms_data = result.get("forms", []) if isinstance(result, dict) else []

            return _ok({
                "url": url,
                "title": title,
                "elements": elements,
                "forms": forms_data,
                "elementCount": len(elements),
                "formCount": len(forms_data),
            })
        except Exception as e:
            return _err(f"Get interactive elements failed: {e}")


async def handle_fill_form(req: web.Request) -> web.Response:
    """Fill multiple form fields at once. More reliable than individual type calls."""
    body = await _safe_json(req)
    fields = body.get("fields")
    submit = bool(body.get("submit", False))
    form_selector = str(body.get("form_selector", "")).strip()

    if not fields or not isinstance(fields, (dict, list)):
        return _err("fields is required (object mapping selector/name to value, or array of {selector, value})")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()
            filled = 0
            errors = []

            # Normalize fields to a list of {selector, value}
            field_list: list[dict[str, Any]] = []
            if isinstance(fields, dict):
                for key, val in fields.items():
                    field_list.append({"selector": key, "value": str(val)})
            else:
                for item in fields:
                    if isinstance(item, dict) and ("selector" in item or "name" in item):
                        sel = item.get("selector") or f'[name="{item.get("name")}"]'
                        field_list.append({"selector": sel, "value": str(item.get("value", ""))})

            for field in field_list:
                sel = field["selector"]
                val = field["value"]
                field_type = field.get("type", "text")

                try:
                    if field_type == "select" and pw:
                        await pw.select_option(sel, label=val, timeout=5000)
                        filled += 1
                    elif field_type in ("checkbox", "radio"):
                        # For checkbox/radio, click to toggle
                        if pw:
                            checked = await pw.is_checked(sel)
                            should_check = val.lower() in ("true", "1", "yes", "on")
                            if checked != should_check:
                                await pw.click(sel, timeout=5000)
                        filled += 1
                    elif pw:
                        await pw.fill(sel, val, timeout=5000)
                        filled += 1
                    else:
                        els = await _find_elements(sel)
                        if els:
                            await els[0].fill(val, clear=True)
                            filled += 1
                        else:
                            errors.append(f"Field not found: {sel}")
                except Exception as e:
                    errors.append(f"{sel}: {str(e)[:100]}")

            # Optionally submit the form
            submitted = False
            if submit and filled > 0:
                try:
                    if form_selector and pw:
                        submit_btn = pw.locator(f"{form_selector} [type='submit'], {form_selector} button")
                        await submit_btn.first.click(timeout=5000)
                        submitted = True
                    elif pw:
                        submit_btn = pw.locator("[type='submit'], button[type='submit']")
                        await submit_btn.first.click(timeout=5000)
                        submitted = True
                    else:
                        await _evaluate(
                            """(formSel) => {
                              const form = formSel ? document.querySelector(formSel) : document.querySelector('form');
                              if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); return 'ok'; }
                              if (form && typeof form.submit === 'function') { form.submit(); return 'ok'; }
                              return 'no_form';
                            }""",
                            form_selector,
                        )
                        submitted = True
                except Exception as e:
                    errors.append(f"Submit failed: {str(e)[:100]}")

            return _ok({
                "filled": filled,
                "total": len(field_list),
                "submitted": submitted,
                "errors": errors if errors else None,
            })
        except Exception as e:
            return _err(f"Fill form failed: {e}")


async def handle_wait_for(req: web.Request) -> web.Response:
    """Wait for an element to appear, a URL pattern, or a page load state."""
    body = await _safe_json(req)
    selector = str(body.get("selector", "")).strip()
    text = str(body.get("text", "")).strip()
    url_pattern = str(body.get("url_pattern", "")).strip()
    state = str(body.get("state", "visible")).strip()
    timeout = _clamp_int(body.get("timeout", 10000), 10000, 500, 60000)

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            pw = _get_playwright_page()

            if url_pattern:
                # Wait for URL to match pattern
                timeout_s = float(timeout) / 1000.0
                deadline = asyncio.get_event_loop().time() + timeout_s
                while asyncio.get_event_loop().time() < deadline:
                    current = await _get_page_url()
                    if url_pattern in current:
                        return _ok({"matched": True, "url": current, "type": "url_pattern"})
                    await asyncio.sleep(0.2)
                return _err(f"Timed out waiting for URL matching '{url_pattern}'")

            if selector and pw:
                try:
                    if state == "hidden":
                        await pw.wait_for_selector(selector, state="hidden", timeout=timeout)
                    elif state == "detached":
                        await pw.wait_for_selector(selector, state="detached", timeout=timeout)
                    else:
                        await pw.wait_for_selector(selector, state="visible", timeout=timeout)
                    return _ok({"matched": True, "selector": selector, "type": "selector"})
                except Exception as e:
                    return _err(f"Timed out waiting for selector '{selector}': {e}")

            if selector or text:
                found = await _smart_wait_for_element(selector=selector, text=text, timeout=timeout)
                if found:
                    return _ok({"matched": True, "type": "element"})
                target = selector or text
                return _err(f"Timed out waiting for element '{target}'")

            return _err("One of selector, text, or url_pattern is required")
        except Exception as e:
            return _err(f"Wait failed: {e}")


async def handle_close(_req: web.Request) -> web.Response:
    await _close_browser()
    return _ok({"closed": True})


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

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
    app.router.add_post("/get_interactive_elements", handle_get_interactive_elements)
    app.router.add_post("/fill_form", handle_fill_form)
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


if __name__ == "__main__":
    main()
