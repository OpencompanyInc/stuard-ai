"""Profile management, Chrome detection, and profile cloning."""

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from browser_server import state
from browser_server.utils import _normalize_profile_name  # noqa: F401 — re-export


def _profile_root() -> Path:
    return state.PROFILE_ROOT


def _current_profile_dir() -> Path:
    return _profile_root() / state._config["profile"]


def _sync_meta_path(target_root: Path) -> Path:
    return target_root / state.SYNC_META_FILE


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


def _profile_copy_ignore(dir_path: str, names: list[str]) -> set[str]:
    ignored: set[str] = set()
    for name in names:
        lowered = name.strip().lower()
        if lowered in state.PROFILE_COPY_SKIP_NAMES:
            ignored.add(name)
            continue
        if any(lowered.startswith(prefix) for prefix in state.PROFILE_COPY_SKIP_PREFIXES):
            ignored.add(name)
            continue
        if lowered.endswith((".tmp", ".temp", ".log")):
            ignored.add(name)
            continue
        if lowered in {state.SYNC_META_FILE.lower(), "lockfile", "current tabs", "current session", "last tabs", "last session"}:
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
    for rel_path, recursive in state.PROFILE_SIGNATURE_PATHS:
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

    for lock_rel in ("lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock_path = target_profile / lock_rel
        if lock_path.exists():
            try:
                lock_path.unlink()
            except Exception:
                pass
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


def _detect_chrome_debug_port(user_data_dir: str) -> int | None:
    dt_file = Path(user_data_dir) / "DevToolsActivePort"
    if not dt_file.exists():
        return None
    try:
        content = dt_file.read_text().strip()
        lines = content.split("\n")
        if lines:
            port = int(lines[0].strip())
            if 1024 <= port <= 65535:
                import urllib.request
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
                return port
    except Exception:
        pass
    return None


def _is_browser_user_data_dir_locked(user_data_dir: str) -> bool:
    ud = Path(user_data_dir)

    if sys.platform == "win32":
        lockfile = ud / "lockfile"
        if lockfile.exists():
            try:
                lockfile.unlink()
                return False
            except (PermissionError, OSError):
                return True
    else:
        singleton = ud / "SingletonLock"
        if singleton.exists() or singleton.is_symlink():
            try:
                target = os.readlink(str(singleton))
                parts = target.rsplit("-", 1)
                if len(parts) == 2:
                    pid = int(parts[1])
                    os.kill(pid, 0)
                    return True
            except (OSError, ValueError):
                pass
            return False

    return False


def _resolve_real_browser_profile(sync_meta: dict[str, Any]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []

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

    try:
        browsers = state.discover_browsers()
        for b in browsers:
            if b.get("isFirefox"):
                continue
            for profile in b.get("profiles", []):
                entry = {
                    "browser": b["browser"],
                    "userDataDir": b["userDataDir"],
                    "profileName": Path(profile["path"]).name,
                    "profilePath": profile["path"],
                    "preferred": False,
                }
                if not (source_user_data_dir and entry["userDataDir"] == source_user_data_dir
                        and entry["profileName"] == (Path(source_profile_path).name if source_profile_path else "")):
                    candidates.append(entry)
    except Exception:
        pass

    if not candidates:
        return None

    for candidate in candidates:
        user_data_dir = candidate["userDataDir"]
        if _is_browser_user_data_dir_locked(user_data_dir):
            continue
        return {
            "browser": candidate["browser"],
            "userDataDir": user_data_dir,
            "profileName": candidate["profileName"],
            "profilePath": candidate["profilePath"],
            "wasActive": False,
        }

    running_browsers = set()
    for c in candidates:
        if _is_browser_user_data_dir_locked(c["userDataDir"]):
            running_browsers.add(c["browser"])

    running_str = ", ".join(sorted(running_browsers)) if running_browsers else "Unknown"
    print(f"[browser-server] All browser profiles are locked. "
          f"Running browsers: {running_str}. "
          f"Close one of them to allow Playwright to use its profile, "
          f"or the managed profile will be used as fallback.",
          flush=True)

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

    for browser_name in ("Chrome", "Edge", "Brave", "Chrome Beta"):
        exe = _find_local_browser_executable(browser_name)
        if exe:
            return {"executable_path": exe}

    return {"channel": "chrome"}
