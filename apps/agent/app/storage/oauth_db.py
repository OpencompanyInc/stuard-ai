"""
Desktop-local OAuth token store (encrypted at rest).

Mirrors the VM agent's oauth-tokens store (apps/vm-agent/src/vm-agent.ts) so
cloud-ai can fetch tokens over the desktop bridge using the same command
contract it already uses for the VM:
  store_oauth_tokens / get_oauth_token / oauth_list / remove_oauth_tokens

Difference from the VM: the VM runs in plaintext mode and writes a JSON file in
the clear; the desktop has the user's device key, so tokens are encrypted at
rest with AES-256-GCM via the shared CryptoManager. The key lives in the OS
keychain and never leaves the device.

Token dicts use camelCase keys to stay wire-compatible with cloud-ai's
normalizeVmOAuthToken() (provider / profileLabel / isDefault / accessToken /
refreshToken / expiresAt / scopes / accountEmail / syncedAt).
"""

from __future__ import annotations

import json
import os
import sys
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .crypto import get_crypto_manager


def _get_user_data_dir() -> str:
    """Platform-appropriate user data dir — kept identical to memory_db so all
    desktop stores live side by side under the same StuardAI/agent folder."""
    override = os.getenv("AGENT_DATA_DIR")
    if override:
        return override
    if sys.platform == "win32":
        base = os.getenv("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.getenv("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "StuardAI", "agent")


_OAUTH_PATH = os.path.abspath(os.path.join(_get_user_data_dir(), "oauth-tokens.enc"))
_lock = threading.RLock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_all() -> List[Dict[str, Any]]:
    """Decrypt + parse the on-disk store. Returns [] on any error so a corrupt
    or unreadable file degrades to 'not connected' rather than crashing a tool."""
    try:
        if not os.path.exists(_OAUTH_PATH):
            return []
        with open(_OAUTH_PATH, "r", encoding="utf-8") as f:
            blob = f.read().strip()
        if not blob:
            return []
        plaintext = get_crypto_manager().decrypt_string(blob)
        if not plaintext:
            return []
        data = json.loads(plaintext)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_all(tokens: List[Dict[str, Any]]) -> None:
    """Encrypt + atomically write the store."""
    os.makedirs(os.path.dirname(_OAUTH_PATH), exist_ok=True)
    blob = get_crypto_manager().encrypt_string(json.dumps(tokens))
    tmp = _OAUTH_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(blob)
    os.replace(tmp, _OAUTH_PATH)
    try:
        os.chmod(_OAUTH_PATH, 0o600)
    except OSError:
        pass


def _normalize_incoming(t: Dict[str, Any], now: str) -> Dict[str, Any]:
    return {
        "provider": str(t.get("provider") or ""),
        "profileLabel": str(t.get("profileLabel") or "default"),
        "isDefault": bool(t.get("isDefault")),
        "accessToken": str(t.get("accessToken") or ""),
        "refreshToken": t.get("refreshToken") or None,
        "expiresAt": t.get("expiresAt") or None,
        "scopes": t.get("scopes") if isinstance(t.get("scopes"), list) else [],
        "accountEmail": t.get("accountEmail") or None,
        "syncedAt": now,
    }


def _same_account(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return (
        str(a.get("provider", "")).lower() == str(b.get("provider", "")).lower()
        and a.get("profileLabel") == b.get("profileLabel")
    )


# ── Command handlers (sync core) ──────────────────────────────────────────────

def store_oauth_tokens(args: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert tokens. `replace=False` (default for incremental connects) merges
    by (provider, profileLabel): preserves a prior refreshToken when the new
    payload omits one, and unions scopes — matching the VM's semantics."""
    tokens = args.get("tokens")
    if not isinstance(tokens, list):
        return {"ok": False, "error": "tokens must be an array"}

    now = _now_iso()
    incoming = [_normalize_incoming(t, now) for t in tokens if isinstance(t, dict)]

    with _lock:
        if args.get("replace") is False:
            existing = _read_all()
            for nxt in incoming:
                prev = next((s for s in existing if _same_account(s, nxt)), None)
                if not prev:
                    continue
                if not nxt["refreshToken"] and prev.get("refreshToken"):
                    nxt["refreshToken"] = prev["refreshToken"]
                nxt["scopes"] = list(dict.fromkeys(
                    [*(prev.get("scopes") or []), *(nxt["scopes"] or [])]
                ))
            kept = [s for s in existing if not any(_same_account(s, nxt) for nxt in incoming)]
            merged = [*kept, *incoming]
        else:
            merged = incoming
        _write_all(merged)

    return {"ok": True, "count": len(merged)}


def get_oauth_token(args: Dict[str, Any]) -> Dict[str, Any]:
    """Return the stored token (with secrets) for a provider/profile. Falls back
    to the provider's default profile, mirroring the VM lookup."""
    provider = str(args.get("provider") or "").lower()
    profile_label = args.get("profileLabel") or "default"

    with _lock:
        tokens = _read_all()

    match = next(
        (
            t for t in tokens
            if str(t.get("provider", "")).lower() == provider
            and (t.get("profileLabel") == profile_label or t.get("isDefault"))
        ),
        None,
    )
    if not match:
        return {"ok": False, "error": f"no_token_for_{provider}"}
    return {"ok": True, "token": match}


def remove_oauth_tokens(args: Dict[str, Any]) -> Dict[str, Any]:
    provider = str(args.get("provider") or "").strip().lower()
    profile_label_raw = args.get("profileLabel")
    profile_label = profile_label_raw.strip() if isinstance(profile_label_raw, str) else ""
    if not provider:
        return {"ok": False, "error": "provider_required"}

    with _lock:
        existing = _read_all()
        before = len(existing)
        remaining = [
            t for t in existing
            if not (
                str(t.get("provider", "")).lower() == provider
                and (not profile_label or t.get("profileLabel") == profile_label)
            )
        ]
        _write_all(remaining)

    return {"ok": True, "removed": before - len(remaining), "count": len(remaining)}


def oauth_list(_args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Secrets-stripped listing for UI / status. Never returns access or refresh
    tokens — only the metadata needed to render which integrations are local."""
    with _lock:
        tokens = _read_all()
    now_ms = datetime.now(timezone.utc).timestamp() * 1000

    def _row(t: Dict[str, Any]) -> Dict[str, Any]:
        expires_at = t.get("expiresAt")
        expires_ms = None
        if expires_at:
            try:
                expires_ms = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")).timestamp() * 1000
            except Exception:
                expires_ms = None
        return {
            "provider": t.get("provider"),
            "profileLabel": t.get("profileLabel") or "default",
            "isDefault": bool(t.get("isDefault")),
            "accountEmail": t.get("accountEmail") or None,
            "scopes": t.get("scopes") if isinstance(t.get("scopes"), list) else [],
            "hasAccessToken": bool(t.get("accessToken")),
            "hasRefreshToken": bool(t.get("refreshToken")),
            "expiresAt": expires_at or None,
            "expired": expires_ms is not None and expires_ms < now_ms,
            "syncedAt": t.get("syncedAt") or None,
        }

    return {"ok": True, "tokens": [_row(t) for t in tokens]}


# ── Async dispatch wrappers (file IO is small + fast; run inline) ─────────────

async def store_oauth_tokens_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    return store_oauth_tokens(args)


async def get_oauth_token_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    return get_oauth_token(args)


async def remove_oauth_tokens_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    return remove_oauth_tokens(args)


async def oauth_list_handler(args: Dict[str, Any]) -> Dict[str, Any]:
    return oauth_list(args)
