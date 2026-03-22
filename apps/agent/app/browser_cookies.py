"""
Cross-platform browser cookie extraction for Playwright injection.

Reads encrypted cookies from Chromium-based browsers (Chrome, Edge, Brave, Arc, Opera)
and unencrypted cookies from Firefox, then returns them in Playwright's addCookies() format.

Supports: Windows (DPAPI), macOS (Keychain + PBKDF2), Linux (PBKDF2 with fixed key).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Browser registry — per-browser metadata for cookie decryption
# ---------------------------------------------------------------------------

@dataclass
class BrowserInfo:
    """Metadata for a single Chromium-based browser."""
    name: str
    # Relative to the platform-specific application data root
    win_rel: str = ""
    mac_rel: str = ""
    linux_rel: str = ""
    # macOS Keychain service + account for Safe Storage password
    keychain_service: str = ""
    keychain_account: str = ""


# Chromium browsers with their platform-specific data dirs and macOS keychain entries
CHROMIUM_BROWSERS: list[BrowserInfo] = [
    BrowserInfo(
        name="Chrome",
        win_rel=r"Google\Chrome\User Data",
        mac_rel="Google/Chrome",
        linux_rel="google-chrome",
        keychain_service="Chrome Safe Storage",
        keychain_account="Chrome",
    ),
    BrowserInfo(
        name="Chrome Beta",
        win_rel=r"Google\Chrome Beta\User Data",
        mac_rel="Google/Chrome Beta",
        linux_rel="google-chrome-beta",
        keychain_service="Chrome Safe Storage",
        keychain_account="Chrome",
    ),
    BrowserInfo(
        name="Edge",
        win_rel=r"Microsoft\Edge\User Data",
        mac_rel="Microsoft Edge",
        linux_rel="microsoft-edge",
        keychain_service="Microsoft Edge Safe Storage",
        keychain_account="Microsoft Edge",
    ),
    BrowserInfo(
        name="Brave",
        win_rel=r"BraveSoftware\Brave-Browser\User Data",
        mac_rel="BraveSoftware/Brave-Browser",
        linux_rel="BraveSoftware/Brave-Browser",
        keychain_service="Brave Safe Storage",
        keychain_account="Brave",
    ),
    BrowserInfo(
        name="Arc",
        win_rel=r"Arc\User Data",
        mac_rel="Arc/User Data",
        linux_rel="arc",
        keychain_service="Arc Safe Storage",
        keychain_account="Arc",
    ),
    BrowserInfo(
        name="Opera",
        win_rel=r"Opera Software\Opera Stable",
        mac_rel="com.operasoftware.Opera",
        linux_rel="opera",
        keychain_service="Opera Safe Storage",
        keychain_account="Opera",
    ),
    BrowserInfo(
        name="Vivaldi",
        win_rel=r"Vivaldi\User Data",
        mac_rel="Vivaldi",
        linux_rel="vivaldi",
        keychain_service="Vivaldi Safe Storage",
        keychain_account="Vivaldi",
    ),
]


@dataclass
class FirefoxInfo:
    """Metadata for Firefox."""
    name: str = "Firefox"
    win_rel: str = r"Mozilla\Firefox\Profiles"
    mac_rel: str = "Firefox/Profiles"
    linux_rel: str = ".mozilla/firefox"


FIREFOX = FirefoxInfo()


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class BrowserProfile:
    """A detected browser profile on the system."""
    browser: str
    profile_name: str
    profile_path: str
    user_data_dir: str
    is_firefox: bool = False


@dataclass
class PlaywrightCookie:
    """A cookie in Playwright's addCookies() format."""
    name: str
    value: str
    domain: str
    path: str
    secure: bool = False
    httpOnly: bool = False
    sameSite: str = "None"  # "Strict" | "Lax" | "None"
    expires: float = -1  # -1 = session cookie

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "name": self.name,
            "value": self.value,
            "domain": self.domain,
            "path": self.path,
            "secure": self.secure,
            "httpOnly": self.httpOnly,
            "sameSite": self.sameSite,
        }
        if self.expires > 0:
            d["expires"] = self.expires
        # Playwright needs either 'url' or 'domain'+'path'. Add url for safety.
        scheme = "https" if self.secure else "http"
        clean_domain = self.domain.lstrip(".")
        d["url"] = f"{scheme}://{clean_domain}/"
        return d


# ---------------------------------------------------------------------------
# Platform helpers
# ---------------------------------------------------------------------------

def _local_app_data() -> Path:
    """Windows %LOCALAPPDATA%."""
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))


def _mac_app_support() -> Path:
    """macOS ~/Library/Application Support."""
    return Path.home() / "Library" / "Application Support"


def _linux_config() -> Path:
    """Linux ~/.config."""
    return Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))


def _user_data_dir_for(browser: BrowserInfo) -> Path:
    """Resolve the user data directory for a Chromium browser on the current OS."""
    if sys.platform == "win32":
        return _local_app_data() / browser.win_rel
    elif sys.platform == "darwin":
        return _mac_app_support() / browser.mac_rel
    else:
        return _linux_config() / browser.linux_rel


def _firefox_profiles_dir() -> Path:
    """Resolve the Firefox profiles root on the current OS."""
    if sys.platform == "win32":
        appdata = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
        return appdata / FIREFOX.win_rel
    elif sys.platform == "darwin":
        return _mac_app_support() / FIREFOX.mac_rel
    else:
        return Path.home() / FIREFOX.linux_rel


# ---------------------------------------------------------------------------
# Profile discovery
# ---------------------------------------------------------------------------

def _resolve_profile_display_name(profile_path: Path, fallback_name: str) -> str:
    """Try to extract a human-friendly name from the profile's Preferences file."""
    generic_names = {"default", "your chrome"}

    def _is_generic(value: str) -> bool:
        n = value.strip().lower()
        return (
            not n
            or n in generic_names
            or n.startswith("profile ")
            or n.startswith("person ")
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
                    if isinstance(entry, dict):
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


def discover_browsers() -> list[dict[str, Any]]:
    """
    Detect all installed Chromium-based browsers and Firefox with their profiles.

    Returns a list of dicts:
        [{"browser": "Chrome", "userDataDir": "...", "profiles": [{"name": "...", "path": "..."}], "isFirefox": False}, ...]
    """
    results: list[dict[str, Any]] = []

    # --- Chromium browsers ---
    for browser in CHROMIUM_BROWSERS:
        user_data_dir = _user_data_dir_for(browser)
        if not user_data_dir.is_dir():
            continue

        profiles: list[dict[str, str]] = []

        # Default profile
        default_dir = user_data_dir / "Default"
        if default_dir.is_dir() and _find_cookies_db(default_dir):
            display = _resolve_profile_display_name(default_dir, "Default")
            profiles.append({"name": display, "path": str(default_dir)})

        # Numbered profiles (Profile 1, Profile 2, ...)
        for p in sorted(user_data_dir.iterdir()):
            if p.name.startswith("Profile ") and p.is_dir() and _find_cookies_db(p):
                display = _resolve_profile_display_name(p, p.name)
                profiles.append({"name": display, "path": str(p)})

        if profiles:
            results.append({
                "browser": browser.name,
                "userDataDir": str(user_data_dir),
                "profiles": profiles,
                "isFirefox": False,
            })

    # --- Firefox ---
    firefox_root = _firefox_profiles_dir()
    if firefox_root.is_dir():
        ff_profiles: list[dict[str, str]] = []
        # Firefox profile dirs are like "abc123.default-release"
        for p in sorted(firefox_root.iterdir()):
            if p.is_dir() and (p / "cookies.sqlite").exists():
                # Parse profile name from dirname: "xxx.ProfileName" -> "ProfileName"
                parts = p.name.split(".", 1)
                display = parts[1] if len(parts) > 1 else p.name
                ff_profiles.append({"name": display, "path": str(p)})

        if ff_profiles:
            results.append({
                "browser": "Firefox",
                "userDataDir": str(firefox_root),
                "profiles": ff_profiles,
                "isFirefox": True,
            })

    return results


def _find_cookies_db(profile_dir: Path) -> Path | None:
    """Find the Chromium Cookies SQLite DB inside a profile directory."""
    # Chrome 96+ moved Cookies into Network/ subdirectory
    network_cookies = profile_dir / "Network" / "Cookies"
    if network_cookies.exists():
        return network_cookies
    legacy_cookies = profile_dir / "Cookies"
    if legacy_cookies.exists():
        return legacy_cookies
    return None


# ---------------------------------------------------------------------------
# Cookie domain listing (no decryption needed — fast)
# ---------------------------------------------------------------------------

def list_cookie_domains(
    profile_path: str,
    is_firefox: bool = False,
) -> list[dict[str, Any]]:
    """
    List all unique cookie domains in a profile, with counts.
    Does NOT decrypt values — just reads domain names from the DB.

    Returns: [{"domain": ".google.com", "count": 42}, ...]
    """
    if is_firefox:
        db_path = Path(profile_path) / "cookies.sqlite"
        query = "SELECT host, COUNT(*) as cnt FROM moz_cookies GROUP BY host ORDER BY cnt DESC"
        domain_col = "host"
    else:
        db_path = _find_cookies_db(Path(profile_path))
        if not db_path:
            return []
        query = "SELECT host_key, COUNT(*) as cnt FROM cookies GROUP BY host_key ORDER BY cnt DESC"
        domain_col = "host_key"

    if not db_path or not db_path.exists():
        return []

    try:
        handle = _open_locked_db(db_path)
        rows = handle.conn.execute(query).fetchall()
        result = [{"domain": row[domain_col], "count": row["cnt"]} for row in rows]
        handle.close()
        return result
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Encryption key extraction (platform-specific)
# ---------------------------------------------------------------------------

# Cache: user_data_dir -> derived AES key
_key_cache: dict[str, bytes] = {}


def _get_encryption_key(user_data_dir: str, browser: BrowserInfo | None = None) -> bytes | None:
    """
    Extract the AES key a Chromium browser uses to encrypt cookie values.

    - Windows: DPAPI decryption of the key from Local State
    - macOS:   Keychain password + PBKDF2 derivation
    - Linux:   Fixed "peanuts" password + PBKDF2 (1 iteration)
    """
    cache_key = user_data_dir
    if cache_key in _key_cache:
        return _key_cache[cache_key]

    local_state_path = Path(user_data_dir) / "Local State"
    if not local_state_path.exists():
        return None

    try:
        local_state = json.loads(local_state_path.read_text(encoding="utf-8", errors="replace"))
        encrypted_key_b64 = local_state.get("os_crypt", {}).get("encrypted_key", "")
        if not encrypted_key_b64:
            return None
        encrypted_key = base64.b64decode(encrypted_key_b64)

        if sys.platform == "win32":
            key = _decrypt_key_dpapi(encrypted_key)
        elif sys.platform == "darwin":
            key = _decrypt_key_macos(browser)
        else:
            key = _decrypt_key_linux()

        if key:
            _key_cache[cache_key] = key
        return key
    except Exception as e:
        print(f"[browser-cookies] Failed to get encryption key: {e}", flush=True)
        return None


def _decrypt_key_dpapi(encrypted_key: bytes) -> bytes | None:
    """Windows: decrypt the AES key using DPAPI (CryptUnprotectData)."""
    # Strip "DPAPI" prefix (5 bytes)
    if encrypted_key[:5] == b"DPAPI":
        encrypted_key = encrypted_key[5:]
    else:
        return None

    import ctypes
    import ctypes.wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [
            ("cbData", ctypes.wintypes.DWORD),
            ("pbData", ctypes.POINTER(ctypes.c_char)),
        ]

    blob_in = DATA_BLOB(len(encrypted_key), ctypes.create_string_buffer(encrypted_key, len(encrypted_key)))
    blob_out = DATA_BLOB()

    if ctypes.windll.crypt32.CryptUnprotectData(  # type: ignore[attr-defined]
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    ):
        key = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)  # type: ignore[attr-defined]
        return key
    return None


def _decrypt_key_macos(browser: BrowserInfo | None = None) -> bytes | None:
    """macOS: read password from Keychain, derive AES-128 key with PBKDF2."""
    import subprocess

    service = browser.keychain_service if browser else "Chrome Safe Storage"
    account = browser.keychain_account if browser else "Chrome"

    try:
        proc = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", service, "-a", account],
            capture_output=True, text=True, timeout=10,
        )
        if proc.returncode != 0:
            # Fallback: try without -a (account) flag
            proc = subprocess.run(
                ["security", "find-generic-password", "-w", "-s", service],
                capture_output=True, text=True, timeout=10,
            )
            if proc.returncode != 0:
                return None
    except Exception:
        return None

    password = proc.stdout.strip()
    return hashlib.pbkdf2_hmac("sha1", password.encode(), b"saltysalt", 1003, dklen=16)


def _decrypt_key_linux() -> bytes:
    """Linux: fixed key derivation (all Chromium browsers use the same approach)."""
    return hashlib.pbkdf2_hmac("sha1", b"peanuts", b"saltysalt", 1, dklen=16)


# ---------------------------------------------------------------------------
# Cookie value decryption
# ---------------------------------------------------------------------------

def _decrypt_cookie_value(encrypted_value: bytes, key: bytes | None) -> str:
    """Decrypt a single Chromium-encrypted cookie value."""
    if not encrypted_value:
        return ""

    # v10/v80 on Windows = AES-256-GCM
    if sys.platform == "win32" and encrypted_value[:3] == b"v10":
        if key is None:
            return ""
        try:
            nonce = encrypted_value[3:15]          # 12 bytes
            ciphertext_tag = encrypted_value[15:]   # rest is ciphertext + GCM tag
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            return AESGCM(key).decrypt(nonce, ciphertext_tag, None).decode("utf-8", errors="replace")
        except Exception:
            return ""

    # v10/v11 on macOS/Linux = AES-128-CBC
    if encrypted_value[:3] in (b"v10", b"v11"):
        if key is None:
            return ""
        try:
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            from cryptography.hazmat.primitives import padding as sym_padding
            iv = b" " * 16  # 16 bytes of 0x20
            ciphertext = encrypted_value[3:]
            decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
            decrypted = decryptor.update(ciphertext) + decryptor.finalize()
            unpadder = sym_padding.PKCS7(128).unpadder()
            return (unpadder.update(decrypted) + unpadder.finalize()).decode("utf-8", errors="replace")
        except Exception:
            return ""

    # Unencrypted fallback
    try:
        return encrypted_value.decode("utf-8", errors="replace")
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Safe DB copy (handles locked DB + WAL/SHM)
# ---------------------------------------------------------------------------

@dataclass
class _DBHandle:
    """Wraps a sqlite3.Connection with optional temp file cleanup."""
    conn: sqlite3.Connection
    tmp_path: str | None = None

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass
        if self.tmp_path:
            for suffix in ("", "-wal", "-shm"):
                try:
                    p = self.tmp_path + suffix
                    if os.path.exists(p):
                        os.unlink(p)
                except Exception:
                    pass


def _open_locked_db(db_path: Path) -> _DBHandle:
    """
    Open a SQLite database that may be locked by a running browser.

    Strategy priority:
    1. Copy to temp file and open normally (cleanest — full WAL consistency)
    2. Open directly in immutable mode via URI (no file copy needed)
    3. Raise RuntimeError with guidance to close the browser

    Returns a _DBHandle. Caller must call .close() when done.
    """
    # Strategy 1: copy to temp file (works on macOS/Linux, sometimes Windows)
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".db")
    os.close(tmp_fd)
    try:
        shutil.copy2(str(db_path), tmp_path)
        # Also copy WAL and SHM for consistency
        for journal_suffix in ("-wal", "-shm"):
            journal = db_path.parent / (db_path.name + journal_suffix)
            if journal.exists():
                try:
                    shutil.copy2(str(journal), tmp_path + journal_suffix)
                except Exception:
                    pass
        conn = sqlite3.connect(tmp_path)
        conn.row_factory = sqlite3.Row
        return _DBHandle(conn=conn, tmp_path=tmp_path)
    except (PermissionError, OSError):
        # Clean up failed temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    # Strategy 2: open via immutable URI (bypasses file locking)
    # On Windows, use the native path format; on Unix, use posix path
    if sys.platform == "win32":
        # Windows file URI: file:///C:/path/to/file
        # Spaces must be percent-encoded
        from urllib.parse import quote
        posix_path = db_path.as_posix()
        encoded = quote(posix_path, safe="/:")
        uri = f"file:///{encoded}?immutable=1"
    else:
        uri = f"file://{db_path}?immutable=1"

    try:
        conn = sqlite3.connect(uri, uri=True)
        conn.row_factory = sqlite3.Row
        # Quick sanity check — try to read something
        conn.execute("SELECT 1")
        return _DBHandle(conn=conn, tmp_path=None)
    except Exception:
        pass

    # Strategy 3: no more fallbacks — tell the user
    raise RuntimeError(
        f"Cannot read database {db_path} — the browser has it locked. "
        f"The active browser profile's cookies cannot be read while the browser is running. "
        f"Either close the browser, or use a different (non-active) profile."
    )


# ---------------------------------------------------------------------------
# Chrome timestamp conversion
# ---------------------------------------------------------------------------

# Chrome epoch: microseconds since 1601-01-01
_CHROME_EPOCH_OFFSET = 11644473600  # seconds between 1601-01-01 and 1970-01-01

def _chrome_ts_to_unix(chrome_ts: int) -> float:
    """Convert Chrome's microsecond timestamp to Unix epoch seconds."""
    if chrome_ts == 0:
        return -1
    return (chrome_ts / 1_000_000) - _CHROME_EPOCH_OFFSET


# Firefox uses seconds since Unix epoch directly (or microseconds in some versions)
def _firefox_ts_to_unix(ts: int) -> float:
    """Convert Firefox cookie expiry to Unix epoch seconds."""
    if ts == 0:
        return -1
    # Firefox stores expiry as Unix seconds
    return float(ts)


# ---------------------------------------------------------------------------
# Cookie reading — Chromium
# ---------------------------------------------------------------------------

_SAMESITE_MAP = {0: "None", 1: "Lax", 2: "Strict", -1: "None"}


def _lookup_browser_info(user_data_dir: str) -> BrowserInfo | None:
    """Try to match a user_data_dir to a known BrowserInfo for keychain lookup."""
    udd_lower = user_data_dir.replace("\\", "/").lower()
    for browser in CHROMIUM_BROWSERS:
        for rel in (browser.win_rel, browser.mac_rel, browser.linux_rel):
            if rel and rel.replace("\\", "/").lower() in udd_lower:
                return browser
    return None


def read_chromium_cookies(
    profile_path: str,
    user_data_dir: str,
    domains: list[str] | None = None,
) -> list[PlaywrightCookie]:
    """
    Read and decrypt cookies from a Chromium profile.

    Args:
        profile_path: Path to the profile directory (e.g., .../User Data/Default)
        user_data_dir: Path to the browser's User Data directory
        domains: Optional list of domains to filter (e.g., [".google.com", "github.com"]).
                 If None, reads ALL cookies.

    Returns:
        List of PlaywrightCookie objects ready for context.addCookies().
    """
    cookies_db = _find_cookies_db(Path(profile_path))
    if not cookies_db:
        return []

    browser_info = _lookup_browser_info(user_data_dir)
    key = _get_encryption_key(user_data_dir, browser_info)

    try:
        handle = _open_locked_db(cookies_db)
    except RuntimeError as e:
        print(f"[browser-cookies] {e}", flush=True)
        return []

    try:
        if domains:
            where_clauses = []
            params: list[str] = []
            for d in domains:
                clean = d.strip().lstrip(".")
                where_clauses.append("host_key = ?")
                where_clauses.append("host_key = ?")
                params.extend([clean, f".{clean}"])
            domain_filter = " OR ".join(where_clauses)
            query = (
                f"SELECT host_key, name, path, encrypted_value, value, "
                f"is_secure, is_httponly, expires_utc, samesite "
                f"FROM cookies WHERE ({domain_filter})"
            )
            rows = handle.conn.execute(query, params).fetchall()
        else:
            rows = handle.conn.execute(
                "SELECT host_key, name, path, encrypted_value, value, "
                "is_secure, is_httponly, expires_utc, samesite "
                "FROM cookies"
            ).fetchall()

        cookies: list[PlaywrightCookie] = []
        for row in rows:
            value = row["value"]
            if not value and row["encrypted_value"]:
                value = _decrypt_cookie_value(bytes(row["encrypted_value"]), key)
            if not value:
                continue

            cookies.append(PlaywrightCookie(
                name=row["name"],
                value=value,
                domain=row["host_key"],
                path=row["path"] or "/",
                secure=bool(row["is_secure"]),
                httpOnly=bool(row["is_httponly"]),
                sameSite=_SAMESITE_MAP.get(row["samesite"], "None"),
                expires=_chrome_ts_to_unix(row["expires_utc"]),
            ))

        return cookies
    except Exception as e:
        print(f"[browser-cookies] Failed to read Chromium cookies: {e}", flush=True)
        return []
    finally:
        handle.close()


# ---------------------------------------------------------------------------
# Cookie reading — Firefox
# ---------------------------------------------------------------------------

def read_firefox_cookies(
    profile_path: str,
    domains: list[str] | None = None,
) -> list[PlaywrightCookie]:
    """
    Read cookies from a Firefox profile. Firefox cookies are NOT encrypted.

    Args:
        profile_path: Path to the Firefox profile directory
        domains: Optional domain filter list

    Returns:
        List of PlaywrightCookie objects.
    """
    db_path = Path(profile_path) / "cookies.sqlite"
    if not db_path.exists():
        return []

    try:
        handle = _open_locked_db(db_path)
    except RuntimeError as e:
        print(f"[browser-cookies] {e}", flush=True)
        return []

    try:
        if domains:
            where_clauses = []
            params: list[str] = []
            for d in domains:
                clean = d.strip().lstrip(".")
                where_clauses.append("host = ?")
                where_clauses.append("host = ?")
                params.extend([clean, f".{clean}"])
            domain_filter = " OR ".join(where_clauses)
            query = (
                f"SELECT host, name, path, value, isSecure, isHttpOnly, expiry, sameSite "
                f"FROM moz_cookies WHERE ({domain_filter})"
            )
            rows = handle.conn.execute(query, params).fetchall()
        else:
            rows = handle.conn.execute(
                "SELECT host, name, path, value, isSecure, isHttpOnly, expiry, sameSite "
                "FROM moz_cookies"
            ).fetchall()

        # Firefox sameSite: 0 = None, 1 = Lax, 2 = Strict
        cookies: list[PlaywrightCookie] = []
        for row in rows:
            value = row["value"]
            if not value:
                continue

            cookies.append(PlaywrightCookie(
                name=row["name"],
                value=value,
                domain=row["host"],
                path=row["path"] or "/",
                secure=bool(row["isSecure"]),
                httpOnly=bool(row["isHttpOnly"]),
                sameSite=_SAMESITE_MAP.get(row["sameSite"], "None"),
                expires=_firefox_ts_to_unix(row["expiry"]),
            ))

        return cookies
    except Exception as e:
        print(f"[browser-cookies] Failed to read Firefox cookies: {e}", flush=True)
        return []
    finally:
        handle.close()


# ---------------------------------------------------------------------------
# High-level API
# ---------------------------------------------------------------------------

def read_cookies(
    profile_path: str,
    user_data_dir: str | None = None,
    domains: list[str] | None = None,
    is_firefox: bool = False,
) -> list[PlaywrightCookie]:
    """
    Read cookies from any supported browser profile.

    Args:
        profile_path: Path to the browser profile directory
        user_data_dir: For Chromium browsers, the parent User Data directory.
                       If None for Chromium, defaults to parent of profile_path.
        domains: Optional list of domains to filter (e.g., ["github.com", "google.com"])
        is_firefox: Set True for Firefox profiles

    Returns:
        List of PlaywrightCookie objects.
    """
    if is_firefox:
        return read_firefox_cookies(profile_path, domains)
    else:
        if not user_data_dir:
            user_data_dir = str(Path(profile_path).parent)
        return read_chromium_cookies(profile_path, user_data_dir, domains)


def read_cookies_as_dicts(
    profile_path: str,
    user_data_dir: str | None = None,
    domains: list[str] | None = None,
    is_firefox: bool = False,
) -> list[dict[str, Any]]:
    """Same as read_cookies() but returns plain dicts for Playwright's addCookies()."""
    return [c.to_dict() for c in read_cookies(profile_path, user_data_dir, domains, is_firefox)]


def resolve_browser(
    browser_name: str | None = None,
    profile_name: str | None = None,
) -> BrowserProfile | None:
    """
    Find a browser + profile on the system by name.

    Args:
        browser_name: e.g., "Chrome", "Firefox", "Brave". Defaults to first found.
        profile_name: e.g., "Default", "Work". Defaults to first profile.

    Returns:
        BrowserProfile or None if nothing found.
    """
    browsers = discover_browsers()
    if not browsers:
        return None

    preferred_browser = (browser_name or "").strip().lower()
    preferred_profile = (profile_name or "").strip().lower()

    # Find matching browser
    selected = None
    fallback = None
    for b in browsers:
        label = b["browser"].lower()
        if preferred_browser and label == preferred_browser:
            selected = b
            break
        if label == "chrome" and fallback is None:
            fallback = b

    selected = selected or fallback or browsers[0]

    # Find matching profile
    profiles = selected.get("profiles", [])
    if not profiles:
        return None

    matched_profile = None
    if preferred_profile:
        for p in profiles:
            if p["name"].strip().lower() == preferred_profile:
                matched_profile = p
                break
    matched_profile = matched_profile or profiles[0]

    return BrowserProfile(
        browser=selected["browser"],
        profile_name=matched_profile["name"],
        profile_path=matched_profile["path"],
        user_data_dir=selected["userDataDir"],
        is_firefox=selected.get("isFirefox", False),
    )


def import_cookies(
    browser_name: str | None = None,
    profile_name: str | None = None,
    domains: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    One-call convenience: find a browser, read its cookies, return Playwright dicts.

    Args:
        browser_name: Browser to read from (default: auto-detect)
        profile_name: Profile name (default: first/default profile)
        domains: Optional domain filter

    Returns:
        List of cookie dicts ready for playwright_context.addCookies()
    """
    profile = resolve_browser(browser_name, profile_name)
    if not profile:
        return []

    return read_cookies_as_dicts(
        profile_path=profile.profile_path,
        user_data_dir=profile.user_data_dir,
        domains=domains,
        is_firefox=profile.is_firefox,
    )


def clear_key_cache() -> None:
    """Clear the cached encryption keys (useful after browser restart)."""
    _key_cache.clear()


# ---------------------------------------------------------------------------
# Chrome debug port setup (one-time, enables CDP connection while Chrome runs)
# ---------------------------------------------------------------------------

def enable_chrome_debug_port(port: int = 9222) -> dict[str, Any]:
    """
    Enable Chrome's remote debugging port so Playwright can connect while Chrome runs.

    On Windows: modifies the Chrome shortcut in Start Menu to add the flag.
    On macOS/Linux: creates a wrapper script or alias.

    Returns: {"success": bool, "message": str, "method": str}
    """
    if sys.platform == "win32":
        return _enable_debug_port_windows(port)
    elif sys.platform == "darwin":
        return _enable_debug_port_macos(port)
    else:
        return _enable_debug_port_linux(port)


def _enable_debug_port_windows(port: int) -> dict[str, Any]:
    """Add --remote-debugging-port to Chrome shortcuts and registry on Windows."""
    import subprocess
    flag = f"--remote-debugging-port={port}"
    modified: list[str] = []
    errors: list[str] = []

    # ── Method 1: Modify Chrome shortcuts (.lnk files) ──
    # This is what applies when you click the Chrome icon on Taskbar / Start Menu / Desktop.
    try:
        shortcuts: list[Path] = []
        for search_dir in [
            Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Internet Explorer" / "Quick Launch" / "User Pinned" / "TaskBar",
            Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "Microsoft" / "Windows" / "Start Menu" / "Programs",
            Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs",
            Path.home() / "Desktop",
        ]:
            if search_dir.is_dir():
                for f in search_dir.rglob("Google Chrome*.lnk"):
                    shortcuts.append(f)

        for shortcut in shortcuts:
            # NOTE: use $curArgs instead of $args — $args is a reserved
            # PowerShell automatic variable and using it causes silent bugs.
            ps_script = (
                '$ws = New-Object -ComObject WScript.Shell; '
                f'$s = $ws.CreateShortcut("{shortcut}"); '
                '$curArgs = $s.Arguments; '
                f'if ($curArgs -notlike "*--remote-debugging-port*") {{ '
                f'  $s.Arguments = ("$curArgs {flag}").Trim(); '
                '  $s.Save(); '
                '  Write-Output "modified" '
                '} else { '
                '  Write-Output "already_set" '
                '}'
            )
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_script],
                capture_output=True, text=True, timeout=10,
            )
            output = result.stdout.strip()
            if output == "modified":
                modified.append(f"shortcut: {shortcut}")
            elif output == "already_set":
                modified.append(f"shortcut: {shortcut} (already set)")
            elif result.returncode != 0:
                errors.append(f"shortcut {shortcut.name}: {result.stderr.strip()[:100]}")
    except Exception as e:
        errors.append(f"shortcut search: {e}")

    # ── Method 2: Modify Chrome's file-association registry command ──
    # This applies when you click a URL or .html file that opens Chrome.
    try:
        import winreg
        reg_keys = [
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Classes\ChromeHTML\shell\open\command"),
        ]
        for hive, key_path in reg_keys:
            try:
                with winreg.OpenKey(hive, key_path, 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
                    current_val, val_type = winreg.QueryValueEx(key, "")
                    if "--remote-debugging-port" not in current_val:
                        # Insert flag before the last argument (usually -- "%1" or --single-argument %1)
                        # Pattern: "C:\...\chrome.exe" --single-argument %1
                        # Result:  "C:\...\chrome.exe" --remote-debugging-port=9222 --single-argument %1
                        parts = current_val.split(" --", 1)
                        if len(parts) == 2:
                            new_val = f"{parts[0]} {flag} --{parts[1]}"
                        else:
                            new_val = f"{current_val} {flag}"
                        winreg.SetValueEx(key, "", 0, val_type, new_val)
                        modified.append(f"registry: {key_path}")
                    else:
                        modified.append(f"registry: {key_path} (already set)")
            except FileNotFoundError:
                pass
            except PermissionError:
                errors.append(f"registry {key_path}: permission denied")
    except Exception as e:
        errors.append(f"registry: {e}")

    if modified:
        return {
            "success": True,
            "message": f"Configured {flag} on {len(modified)} target(s). Restart Chrome for it to take effect.",
            "method": "shortcut+registry",
            "modified": modified,
            "errors": errors or None,
        }

    return {
        "success": False,
        "message": f"Could not configure Chrome. Errors: {'; '.join(errors) if errors else 'no shortcuts found'}. "
                   f"Manually add {flag} to your Chrome shortcut target.",
        "method": "manual",
    }


def _enable_debug_port_macos(port: int) -> dict[str, Any]:
    """On macOS, create a wrapper app or alias for Chrome with the debug flag."""
    flag = f"--remote-debugging-port={port}"
    chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if not Path(chrome_path).exists():
        return {"success": False, "message": "Chrome not found at standard path.", "method": "manual"}

    # Create an alias script
    script_path = Path.home() / ".local" / "bin" / "chrome-debug"
    script_path.parent.mkdir(parents=True, exist_ok=True)
    script_path.write_text(f'#!/bin/bash\nexec "{chrome_path}" {flag} "$@"\n')
    script_path.chmod(0o755)

    return {
        "success": True,
        "message": f"Created {script_path}. Launch Chrome with 'chrome-debug' for CDP support. "
                   f"Or add '{flag}' to your Chrome .app launch arguments.",
        "method": "script",
    }


def _enable_debug_port_linux(port: int) -> dict[str, Any]:
    """On Linux, modify the .desktop file or create a wrapper."""
    flag = f"--remote-debugging-port={port}"
    desktop_files = [
        Path.home() / ".local" / "share" / "applications" / "google-chrome.desktop",
        Path("/usr/share/applications/google-chrome.desktop"),
    ]

    for df in desktop_files:
        if df.exists():
            try:
                content = df.read_text()
                if flag not in content:
                    # Copy to user's local dir and modify
                    user_df = Path.home() / ".local" / "share" / "applications" / "google-chrome.desktop"
                    user_df.parent.mkdir(parents=True, exist_ok=True)
                    new_content = content.replace(
                        "Exec=/usr/bin/google-chrome-stable",
                        f"Exec=/usr/bin/google-chrome-stable {flag}",
                    )
                    user_df.write_text(new_content)
                    return {
                        "success": True,
                        "message": f"Modified {user_df}. Restart Chrome for CDP support.",
                        "method": "desktop_file",
                    }
                else:
                    return {"success": True, "message": "Already configured.", "method": "desktop_file"}
            except Exception as e:
                return {"success": False, "message": f"Failed: {e}", "method": "manual"}

    return {
        "success": False,
        "message": f"No .desktop file found. Add '{flag}' to your Chrome launch command.",
        "method": "manual",
    }
