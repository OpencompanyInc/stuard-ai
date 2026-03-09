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

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

_browser = None          # browser_use.Browser instance
_context = None          # Playwright BrowserContext (persistent)
_page = None             # Active Playwright Page
_config: dict[str, Any] = {
    "mode": "headed",    # headed | headless | connect
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


def _browser_launch_overrides(sync_meta: dict[str, Any]) -> dict[str, Any]:
    source_browser = _guess_source_browser_name(sync_meta)
    if not source_browser:
        return {}

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
    return {}


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


async def _ensure_browser() -> tuple[bool, Optional[str]]:
    """Lazily start the browser + context + page.

    Returns:
        (ok, error_message)
    """
    global _browser, _context, _page

    if await _page_is_alive():
        return True, None
    _page = None

    try:
        from browser_use import Browser
    except ImportError:
        return False, "browser-use is not installed. Run: pip install browser-use"
    except Exception as e:
        return False, f"browser-use import failed: {e}"

    profile_dir = _current_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)
    sync_meta = _read_sync_meta(profile_dir)
    launch_overrides = _browser_launch_overrides(sync_meta)
    managed_profile_dir_name = _managed_profile_dir_name(sync_meta)

    headless = _config["mode"] == "headless"
    cdp_url = _config.get("cdp_url") if _config["mode"] == "connect" else None

    try:
        # Compatibility: old browser-use exposed BrowserConfig/new_context,
        # newer versions use Browser(...kwargs) + start()/new_page().
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
                config_kwargs["extra_chromium_args"] = [f"--user-data-dir={profile_dir}", f"--profile-directory={managed_profile_dir_name}"]

            _browser = await asyncio.to_thread(lambda: Browser(config=BrowserConfig(**config_kwargs)))
            _context = await _browser.new_context()
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
                browser_kwargs["args"] = [f"--user-data-dir={profile_dir}", f"--profile-directory={managed_profile_dir_name}"]
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
        return True, None
    except Exception as e:
        # Always reset partially initialized state so future calls can recover.
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
    })


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
    body = await req.json()
    selector = body.get("selector")
    text = body.get("text")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if text:
                # Text click compatibility for both Playwright and browser-use page wrappers.
                exact = bool(body.get("exact", False))
                clicked = await _evaluate(
                    """(needle, exact) => {
                      const textOf = (el) => (el && (el.innerText || el.textContent || '') || '').trim();
                      const all = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role=\"button\"],[onclick],*[tabindex]'));
                      const target = all.find((el) => {
                        const t = textOf(el);
                        return exact ? t === needle : t.toLowerCase().includes(String(needle).toLowerCase());
                      });
                      if (!target) return 'not_found';
                      target.scrollIntoView({block:'center', inline:'center'});
                      target.click();
                      return 'clicked';
                    }""",
                    text,
                    exact,
                )
                if clicked != "clicked":
                    return _err("Click failed: no matching element text found")
            elif selector:
                els = await _find_elements(selector)
                if not els:
                    return _err(f"Click failed: selector not found: {selector}")
                await els[0].click()
            else:
                return _err("selector or text is required")
            return _ok({"clicked": selector or text})
        except Exception as e:
            return _err(f"Click failed: {e}")


async def handle_type(req: web.Request) -> web.Response:
    body = await req.json()
    selector = body.get("selector")
    text = body.get("text", "")
    clear = body.get("clear", True)

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                els = await _find_elements(selector)
                if not els:
                    return _err(f"Type failed: selector not found: {selector}")
                await els[0].fill(text, clear=clear)
            else:
                # Type into currently focused element.
                await _evaluate(
                    """(value, clearFirst) => {
                      const el = document.activeElement;
                      if (!el) return 'no_active';
                      const isTextInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
                      if (!isTextInput) return 'not_text_target';
                      if ('value' in el) {
                        if (clearFirst) el.value = '';
                        el.value = (el.value || '') + String(value ?? '');
                      } else if (el.isContentEditable) {
                        if (clearFirst) el.textContent = '';
                        el.textContent = (el.textContent || '') + String(value ?? '');
                      }
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      return 'ok';
                    }""",
                    text,
                    clear,
                )
            return _ok({"typed": len(text)})
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
                      const root =
                        document.querySelector('article') ||
                        document.querySelector('main') ||
                        document.querySelector('[role="main"]') ||
                        document.body ||
                        document.documentElement;
                      if (!root) return '';
                      const text = (root.innerText || root.textContent || '').replace(/\\u00a0/g, ' ');
                      return text.replace(/\\n{3,}/g, '\\n\\n').trim();
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
    """Detect Chrome/Edge/Brave user data directories on this system."""
    results: list[dict[str, Any]] = []
    home = Path.home()

    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local")))
        candidates = [
            ("Chrome", local / "Google" / "Chrome" / "User Data"),
            ("Chrome Beta", local / "Google" / "Chrome Beta" / "User Data"),
            ("Edge", local / "Microsoft" / "Edge" / "User Data"),
            ("Brave", local / "BraveSoftware" / "Brave-Browser" / "User Data"),
        ]
    elif sys.platform == "darwin":
        candidates = [
            ("Chrome", home / "Library" / "Application Support" / "Google" / "Chrome"),
            ("Chrome Beta", home / "Library" / "Application Support" / "Google" / "Chrome Beta"),
            ("Edge", home / "Library" / "Application Support" / "Microsoft Edge"),
            ("Brave", home / "Library" / "Application Support" / "BraveSoftware" / "Brave-Browser"),
        ]
    else:  # Linux
        candidates = [
            ("Chrome", home / ".config" / "google-chrome"),
            ("Chrome Beta", home / ".config" / "google-chrome-beta"),
            ("Edge", home / ".config" / "microsoft-edge"),
            ("Brave", home / ".config" / "BraveSoftware" / "Brave-Browser"),
        ]

    for browser_name, user_data_dir in candidates:
        if not user_data_dir.is_dir():
            continue
        profiles: list[dict[str, str]] = []
        # Default profile
        default_cookies = user_data_dir / "Default" / "Network" / "Cookies"
        if not default_cookies.exists():
            default_cookies = user_data_dir / "Default" / "Cookies"
        if default_cookies.exists():
            default_profile = user_data_dir / "Default"
            profiles.append({"name": _resolve_profile_display_name(default_profile, "Default"), "path": str(default_profile)})
        # Numbered profiles
        for p in sorted(user_data_dir.iterdir()):
            if p.name.startswith("Profile ") and p.is_dir():
                profile_display = _resolve_profile_display_name(p, p.name)
                cookies_path = p / "Network" / "Cookies"
                if not cookies_path.exists():
                    cookies_path = p / "Cookies"
                if cookies_path.exists():
                    profiles.append({"name": profile_display, "path": str(p)})
        if profiles:
            results.append({
                "browser": browser_name,
                "userDataDir": str(user_data_dir),
                "profiles": profiles,
            })
    return results


def _get_chrome_encryption_key(user_data_dir: str) -> bytes | None:
    """Extract the AES key Chrome uses to encrypt cookie values (v10/v80+)."""
    local_state_path = Path(user_data_dir) / "Local State"
    if not local_state_path.exists():
        return None
    try:
        local_state = json.loads(local_state_path.read_text(encoding="utf-8", errors="replace"))
        encrypted_key_b64 = local_state.get("os_crypt", {}).get("encrypted_key", "")
        if not encrypted_key_b64:
            return None
        encrypted_key = base64.b64decode(encrypted_key_b64)
        # Strip the "DPAPI" prefix (5 bytes)
        if encrypted_key[:5] == b"DPAPI":
            encrypted_key = encrypted_key[5:]
        else:
            return None

        if sys.platform == "win32":
            import ctypes
            import ctypes.wintypes

            class DATA_BLOB(ctypes.Structure):
                _fields_ = [
                    ("cbData", ctypes.wintypes.DWORD),
                    ("pbData", ctypes.POINTER(ctypes.c_char)),
                ]

            blob_in = DATA_BLOB(len(encrypted_key), ctypes.create_string_buffer(encrypted_key, len(encrypted_key)))
            blob_out = DATA_BLOB()

            if ctypes.windll.crypt32.CryptUnprotectData(
                ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
            ):
                key = ctypes.string_at(blob_out.pbData, blob_out.cbData)
                ctypes.windll.kernel32.LocalFree(blob_out.pbData)
                return key
            return None
        elif sys.platform == "darwin":
            import subprocess
            proc = subprocess.run(
                ["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage", "-a", "Chrome"],
                capture_output=True, text=True, timeout=10,
            )
            if proc.returncode != 0:
                return None
            password = proc.stdout.strip()
            import hashlib
            return hashlib.pbkdf2_hmac("sha1", password.encode(), b"saltysalt", 1003, dklen=16)
        else:
            # Linux: fixed key derivation
            import hashlib
            password = "peanuts"
            return hashlib.pbkdf2_hmac("sha1", password.encode(), b"saltysalt", 1, dklen=16)
    except Exception as e:
        print(f"[chrome-sync] Failed to get encryption key: {e}", flush=True)
        return None


def _decrypt_cookie_value(encrypted_value: bytes, key: bytes | None) -> str:
    """Decrypt a Chrome-encrypted cookie value."""
    if not encrypted_value:
        return ""

    # v10/v80 prefix = AES-256-GCM (Windows) or AES-128-CBC (macOS/Linux)
    if sys.platform == "win32" and encrypted_value[:3] == b"v10":
        if key is None:
            return ""
        try:
            nonce = encrypted_value[3:15]
            ciphertext_tag = encrypted_value[15:]
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            aes = AESGCM(key)
            return aes.decrypt(nonce, ciphertext_tag, None).decode("utf-8", errors="replace")
        except Exception:
            return ""
    elif encrypted_value[:3] in (b"v10", b"v11"):
        if key is None:
            return ""
        try:
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            from cryptography.hazmat.primitives import padding as sym_padding
            iv = b" " * 16
            ciphertext = encrypted_value[3:]
            cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
            decryptor = cipher.decryptor()
            decrypted = decryptor.update(ciphertext) + decryptor.finalize()
            # Remove PKCS7 padding
            unpadder = sym_padding.PKCS7(128).unpadder()
            return (unpadder.update(decrypted) + unpadder.finalize()).decode("utf-8", errors="replace")
        except Exception:
            return ""

    # Unencrypted
    try:
        return encrypted_value.decode("utf-8", errors="replace")
    except Exception:
        return ""


def _chrome_timestamp_to_unix(chrome_ts: int) -> float:
    """Convert Chrome's microsecond timestamp (epoch 1601-01-01) to Unix epoch seconds."""
    if chrome_ts == 0:
        return -1
    # Chrome epoch offset: Jan 1, 1601 to Jan 1, 1970 in seconds
    return (chrome_ts / 1_000_000) - 11644473600


def _read_chrome_cookies(profile_path: str, user_data_dir: str) -> list[dict[str, Any]]:
    """Read and decrypt cookies from a Chrome profile's Cookies SQLite DB."""
    profile = Path(profile_path)
    cookies_db = profile / "Network" / "Cookies"
    if not cookies_db.exists():
        cookies_db = profile / "Cookies"
    if not cookies_db.exists():
        return []

    key = _get_chrome_encryption_key(user_data_dir)

    # Copy DB to temp file to avoid locking issues with a running Chrome
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".db")
    os.close(tmp_fd)
    try:
        shutil.copy2(str(cookies_db), tmp_path)
        conn = sqlite3.connect(tmp_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT host_key, name, path, encrypted_value, value, "
            "is_secure, is_httponly, expires_utc, samesite "
            "FROM cookies"
        )
        cookies: list[dict[str, Any]] = []
        sameSiteMap = {0: "None", 1: "Lax", 2: "Strict", -1: "None"}
        for row in cursor.fetchall():
            value = row["value"]
            if not value and row["encrypted_value"]:
                value = _decrypt_cookie_value(bytes(row["encrypted_value"]), key)
            if not value:
                continue
            domain = row["host_key"]
            expires = _chrome_timestamp_to_unix(row["expires_utc"])
            cookies.append({
                "name": row["name"],
                "value": value,
                "domain": domain,
                "path": row["path"] or "/",
                "secure": bool(row["is_secure"]),
                "httpOnly": bool(row["is_httponly"]),
                "sameSite": sameSiteMap.get(row["samesite"], "None"),
                **({"expires": expires} if expires > 0 else {}),
            })
        conn.close()
        return cookies
    except Exception as e:
        print(f"[chrome-sync] Failed to read cookies: {e}", flush=True)
        return []
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


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


async def _inject_cookies_into_session(cookies: list[dict[str, Any]]) -> dict[str, int]:
    injected = 0
    failed = 0
    if _browser and hasattr(_browser, "_cdp_set_cookies"):
        await _browser._cdp_set_cookies(cookies)
        injected = len(cookies)
        return {"injected": injected, "failed": failed}
    if _context:
        batch_size = 50
        for i in range(0, len(cookies), batch_size):
            batch = cookies[i:i + batch_size]
            try:
                await _context.add_cookies(batch)
                injected += len(batch)
            except Exception:
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

        cookies = await asyncio.to_thread(_read_chrome_cookies, profile_path, user_data_dir)
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

            if force_clone or not browser_running:
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
            should_inject_cookies = bool(cookies) and (browser_running or clone_result.get("cloned"))
            if should_inject_cookies:
                ok, err = await _ensure_browser()
                if not ok:
                    return _err(err or "Browser init failed", status=500)
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
