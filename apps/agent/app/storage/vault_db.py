"""
Secure Credential Vault for Stuard AI

Cross-platform encrypted storage for passwords, API keys, and credentials.
Uses AES-256-GCM encryption via the existing CryptoManager.
All sensitive fields are encrypted at rest in a local SQLite database.

Supports: Windows (DPAPI), macOS (Keychain), Linux (Secret Service)
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, asdict

from .crypto import get_crypto_manager, CryptoManager

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

VaultCategory = str  # "login", "api_key", "database", "ssh", "certificate", "note", "other"

DEFAULT_CATEGORIES = [
    "login", "api_key", "database", "ssh", "certificate", "wifi", "note", "other"
]


def _get_vault_db_path() -> str:
    """Get platform-appropriate vault database path."""
    import sys
    if os.getenv("AGENT_DATA_DIR"):
        base = os.getenv("AGENT_DATA_DIR")
    elif sys.platform == "win32":
        base = os.path.join(os.getenv("APPDATA") or os.path.expanduser("~"), "StuardAI", "agent")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "StuardAI", "agent")
    else:
        xdg = os.getenv("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
        base = os.path.join(xdg, "StuardAI", "agent")

    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "vault.db")


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class VaultEntry:
    """A single credential entry in the vault."""
    id: str
    name: str
    category: str  # login, api_key, database, ssh, certificate, wifi, note, other
    service: Optional[str] = None  # e.g. "GitHub", "AWS", "PostgreSQL"
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None  # or API key, token, etc.
    notes: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None  # extra fields (port, host, etc.)
    created_at: str = ""
    updated_at: str = ""
    last_used_at: Optional[str] = None
    favorite: bool = False
    tags: Optional[List[str]] = None


# Fields that are encrypted at rest
_ENCRYPTED_FIELDS = {"username", "password", "url", "notes", "metadata"}


# ═══════════════════════════════════════════════════════════════════════════════
# VAULT DATABASE
# ═══════════════════════════════════════════════════════════════════════════════

class VaultDB:
    """Encrypted credential vault backed by SQLite."""

    def __init__(self, db_path: Optional[str] = None):
        self._db_path = db_path or _get_vault_db_path()
        self._crypto = get_crypto_manager()
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
        return self._conn

    def _init_db(self):
        conn = self._get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS vault_entries (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'other',
                service TEXT,
                url_enc TEXT,
                username_enc TEXT,
                password_enc TEXT,
                notes_enc TEXT,
                metadata_enc TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                favorite INTEGER NOT NULL DEFAULT 0,
                tags TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_vault_category ON vault_entries(category);
            CREATE INDEX IF NOT EXISTS idx_vault_name ON vault_entries(name);
            CREATE INDEX IF NOT EXISTS idx_vault_service ON vault_entries(service);
            CREATE INDEX IF NOT EXISTS idx_vault_favorite ON vault_entries(favorite);
        """)
        conn.commit()

    def _encrypt(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return self._crypto.encrypt_string(value)

    def _decrypt(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        try:
            return self._crypto.decrypt_string(value)
        except Exception as e:
            logger.warning(f"[vault] Decryption failed: {e}")
            return None

    def _row_to_entry(self, row: sqlite3.Row, include_secrets: bool = False) -> Dict[str, Any]:
        """Convert a DB row to a dict, optionally decrypting secrets."""
        entry: Dict[str, Any] = {
            "id": row["id"],
            "name": row["name"],
            "category": row["category"],
            "service": row["service"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "last_used_at": row["last_used_at"],
            "favorite": bool(row["favorite"]),
            "tags": json.loads(row["tags"]) if row["tags"] else [],
        }

        if include_secrets:
            entry["url"] = self._decrypt(row["url_enc"])
            entry["username"] = self._decrypt(row["username_enc"])
            entry["password"] = self._decrypt(row["password_enc"])
            entry["notes"] = self._decrypt(row["notes_enc"])
            meta_str = self._decrypt(row["metadata_enc"])
            entry["metadata"] = json.loads(meta_str) if meta_str else None
        else:
            # Provide masked hints without exposing secrets
            entry["has_url"] = row["url_enc"] is not None
            entry["has_username"] = row["username_enc"] is not None
            entry["has_password"] = row["password_enc"] is not None
            entry["has_notes"] = row["notes_enc"] is not None
            entry["has_metadata"] = row["metadata_enc"] is not None

        return entry

    # ─────────────────────────────────────────────────────────────────────────
    # CRUD
    # ─────────────────────────────────────────────────────────────────────────

    def add(
        self,
        name: str,
        category: str = "other",
        service: Optional[str] = None,
        url: Optional[str] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        notes: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        favorite: bool = False,
        tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Add a new entry to the vault."""
        entry_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        conn = self._get_conn()
        conn.execute(
            """INSERT INTO vault_entries
               (id, name, category, service, url_enc, username_enc, password_enc,
                notes_enc, metadata_enc, created_at, updated_at, favorite, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entry_id,
                name,
                category,
                service,
                self._encrypt(url),
                self._encrypt(username),
                self._encrypt(password),
                self._encrypt(notes),
                self._encrypt(json.dumps(metadata)) if metadata else None,
                now,
                now,
                int(favorite),
                json.dumps(tags) if tags else None,
            ),
        )
        conn.commit()

        return {"ok": True, "id": entry_id, "created_at": now}

    def get(self, entry_id: str, include_secrets: bool = True) -> Optional[Dict[str, Any]]:
        """Get a single vault entry by ID."""
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM vault_entries WHERE id = ?", (entry_id,)).fetchone()
        if not row:
            return None

        # Update last_used_at when secrets are accessed
        if include_secrets:
            now = datetime.now(timezone.utc).isoformat()
            conn.execute("UPDATE vault_entries SET last_used_at = ? WHERE id = ?", (now, entry_id))
            conn.commit()

        return self._row_to_entry(row, include_secrets=include_secrets)

    def list_entries(
        self,
        category: Optional[str] = None,
        search: Optional[str] = None,
        favorites_only: bool = False,
        tag: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """List vault entries (without secrets)."""
        conn = self._get_conn()
        conditions = []
        params: List[Any] = []

        if category:
            conditions.append("category = ?")
            params.append(category)

        if search:
            conditions.append("(name LIKE ? OR service LIKE ? OR tags LIKE ?)")
            pattern = f"%{search}%"
            params.extend([pattern, pattern, pattern])

        if favorites_only:
            conditions.append("favorite = 1")

        if tag:
            conditions.append("tags LIKE ?")
            params.append(f'%"{tag}"%')

        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""

        # Get total count
        count_row = conn.execute(f"SELECT COUNT(*) as c FROM vault_entries{where}", params).fetchone()
        total = count_row["c"] if count_row else 0

        # Get page
        rows = conn.execute(
            f"SELECT * FROM vault_entries{where} ORDER BY favorite DESC, updated_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

        entries = [self._row_to_entry(r, include_secrets=False) for r in rows]

        return {"ok": True, "entries": entries, "total": total}

    def update(self, entry_id: str, **fields) -> Dict[str, Any]:
        """Update an existing vault entry."""
        conn = self._get_conn()

        # Check entry exists
        existing = conn.execute("SELECT id FROM vault_entries WHERE id = ?", (entry_id,)).fetchone()
        if not existing:
            return {"ok": False, "error": "Entry not found"}

        sets = []
        params: List[Any] = []
        now = datetime.now(timezone.utc).isoformat()

        simple_fields = {"name", "category", "service", "favorite"}
        encrypted_fields_map = {
            "url": "url_enc",
            "username": "username_enc",
            "password": "password_enc",
            "notes": "notes_enc",
        }

        for key, value in fields.items():
            if key in simple_fields:
                if key == "favorite":
                    sets.append(f"{key} = ?")
                    params.append(int(value))
                else:
                    sets.append(f"{key} = ?")
                    params.append(value)
            elif key in encrypted_fields_map:
                col = encrypted_fields_map[key]
                sets.append(f"{col} = ?")
                params.append(self._encrypt(value) if value is not None else None)
            elif key == "metadata":
                sets.append("metadata_enc = ?")
                params.append(self._encrypt(json.dumps(value)) if value is not None else None)
            elif key == "tags":
                sets.append("tags = ?")
                params.append(json.dumps(value) if value else None)

        if not sets:
            return {"ok": False, "error": "No valid fields to update"}

        sets.append("updated_at = ?")
        params.append(now)
        params.append(entry_id)

        conn.execute(f"UPDATE vault_entries SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()

        return {"ok": True, "updated_at": now}

    def delete(self, entry_id: str) -> Dict[str, Any]:
        """Delete a vault entry."""
        conn = self._get_conn()
        cursor = conn.execute("DELETE FROM vault_entries WHERE id = ?", (entry_id,))
        conn.commit()

        if cursor.rowcount == 0:
            return {"ok": False, "error": "Entry not found"}

        return {"ok": True, "deleted": entry_id}

    def get_credential(self, entry_id: str) -> Optional[Dict[str, Any]]:
        """Get just the credential (username + password) for agent use."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT id, name, service, username_enc, password_enc, url_enc, metadata_enc FROM vault_entries WHERE id = ?",
            (entry_id,),
        ).fetchone()

        if not row:
            return None

        # Update last_used_at
        now = datetime.now(timezone.utc).isoformat()
        conn.execute("UPDATE vault_entries SET last_used_at = ? WHERE id = ?", (now, entry_id))
        conn.commit()

        result: Dict[str, Any] = {
            "id": row["id"],
            "name": row["name"],
            "service": row["service"],
        }

        username = self._decrypt(row["username_enc"])
        password = self._decrypt(row["password_enc"])
        url = self._decrypt(row["url_enc"])
        meta_str = self._decrypt(row["metadata_enc"])

        if username:
            result["username"] = username
        if password:
            result["password"] = password
        if url:
            result["url"] = url
        if meta_str:
            try:
                result["metadata"] = json.loads(meta_str)
            except Exception:
                pass

        return result

    def search_by_service(self, service: str) -> List[Dict[str, Any]]:
        """Find entries by service name (case-insensitive)."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM vault_entries WHERE LOWER(service) LIKE LOWER(?) ORDER BY updated_at DESC",
            (f"%{service}%",),
        ).fetchall()
        return [self._row_to_entry(r, include_secrets=False) for r in rows]

    def get_stats(self) -> Dict[str, Any]:
        """Get vault statistics."""
        conn = self._get_conn()
        total = conn.execute("SELECT COUNT(*) as c FROM vault_entries").fetchone()["c"]
        by_category = {}
        for row in conn.execute("SELECT category, COUNT(*) as c FROM vault_entries GROUP BY category").fetchall():
            by_category[row["category"]] = row["c"]
        favorites = conn.execute("SELECT COUNT(*) as c FROM vault_entries WHERE favorite = 1").fetchone()["c"]

        return {
            "ok": True,
            "total": total,
            "by_category": by_category,
            "favorites": favorites,
            "categories": DEFAULT_CATEGORIES,
        }

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None


# ═══════════════════════════════════════════════════════════════════════════════
# SINGLETON
# ═══════════════════════════════════════════════════════════════════════════════

_vault: Optional[VaultDB] = None


def get_vault() -> VaultDB:
    """Get or create the vault singleton."""
    global _vault
    if _vault is None:
        _vault = VaultDB()
        logger.info("[vault] Initialized encrypted vault")
    return _vault
