"""
Database storage tools for workflows.
Provides local SQLite-based persistent storage that workflows can use
to store, query, and manage structured data.

Individual tools:
  db_query       – Execute raw SQL (CREATE TABLE, INSERT, SELECT, etc.)
  db_store       – Upsert a JSON document into a named collection
  db_retrieve    – Get a document by ID from a collection
  db_search      – Search documents with key-value filters
  db_delete      – Delete a document by ID
  db_list_tables – List all tables/collections in the database
"""
from __future__ import annotations

import os
import sys
import sqlite3
import json
import logging
from typing import Any, Dict, List
from uuid import uuid4
from datetime import datetime, timezone

logger = logging.getLogger("agent")


def _get_user_data_dir() -> str:
    """Get platform-appropriate user data directory (matches other agent DB modules)."""
    if os.getenv("AGENT_DATA_DIR"):
        return os.getenv("AGENT_DATA_DIR")

    if sys.platform == "win32":
        base = os.getenv("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.getenv("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")

    return os.path.join(base, "StuardAI", "agent")


DB_PATH = os.path.abspath(os.path.join(_get_user_data_dir(), "workflow.db"))
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def _maybe_migrate_legacy_db_path() -> None:
    """One-time migration: workflow.db previously used LOCALAPPDATA on Windows."""
    if sys.platform != "win32" or os.getenv("AGENT_DATA_DIR") or os.path.exists(DB_PATH):
        return
    legacy = os.path.join(
        os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local"),
        "StuardAI", "agent", "workflow.db",
    )
    if not os.path.exists(legacy):
        return
    try:
        import shutil
        shutil.copy2(legacy, DB_PATH)
        logger.info("Migrated workflow.db from legacy LOCALAPPDATA path to APPDATA")
    except Exception:
        logger.warning("Failed to migrate workflow.db from legacy path", exc_info=True)


_maybe_migrate_legacy_db_path()


def _query_returns_rows(cursor: sqlite3.Cursor) -> bool:
    """True when the statement produces result columns (SELECT, WITH ... SELECT, PRAGMA, etc.)."""
    return cursor.description is not None


def _get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_kv_table(conn: sqlite3.Connection, table_name: str):
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS "{table_name}" (
            id TEXT PRIMARY KEY,
            data TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    conn.commit()


def _safe_table_name(name: str) -> str:
    """Validate and return a safe table name."""
    clean = name.strip()
    if not clean or not clean.replace("_", "").replace("-", "").isalnum():
        raise ValueError(f"Invalid table name: {name}")
    return clean


# ─── Individual tool handlers (match dispatch.py pattern) ─────────────────────

async def db_query(args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute raw SQL against the workflow database."""
    query = args.get("query") or args.get("sql")
    if not query:
        return {"ok": False, "error": "missing 'query' parameter"}

    params = args.get("params") or []
    try:
        with _get_conn() as conn:
            cursor = conn.execute(query, params)
            if _query_returns_rows(cursor):
                rows = [dict(row) for row in cursor.fetchall()]
                return {"ok": True, "results": rows, "count": len(rows)}
            conn.commit()
            return {"ok": True, "affected_rows": cursor.rowcount}
    except Exception as e:
        logger.exception("db_query error")
        return {"ok": False, "error": str(e)}


async def db_store(args: Dict[str, Any]) -> Dict[str, Any]:
    """Store/upsert a JSON document in a named collection."""
    table = _safe_table_name(args.get("table") or args.get("collection") or "default_store")
    data = args.get("data")
    if not data or not isinstance(data, dict):
        return {"ok": False, "error": "missing 'data' (must be an object)"}

    doc_id = str(data.get("id") or args.get("id") or uuid4())
    data = {**data, "id": doc_id}
    now = datetime.now(timezone.utc).isoformat()

    try:
        with _get_conn() as conn:
            _ensure_kv_table(conn, table)
            cur = conn.execute(f'SELECT created_at FROM "{table}" WHERE id = ?', (doc_id,))
            row = cur.fetchone()
            if row:
                conn.execute(
                    f'UPDATE "{table}" SET data = ?, updated_at = ? WHERE id = ?',
                    (json.dumps(data), now, doc_id),
                )
            else:
                conn.execute(
                    f'INSERT INTO "{table}" (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)',
                    (doc_id, json.dumps(data), now, now),
                )
            conn.commit()
        return {"ok": True, "id": doc_id, "table": table}
    except Exception as e:
        logger.exception("db_store error")
        return {"ok": False, "error": str(e)}


async def db_retrieve(args: Dict[str, Any]) -> Dict[str, Any]:
    """Retrieve a document by ID from a collection."""
    table = _safe_table_name(args.get("table") or args.get("collection") or "default_store")
    doc_id = args.get("id")
    if not doc_id:
        return {"ok": False, "error": "missing 'id' parameter"}

    try:
        with _get_conn() as conn:
            cur = conn.execute(f'SELECT data, created_at, updated_at FROM "{table}" WHERE id = ?', (doc_id,))
            row = cur.fetchone()
            if row:
                return {
                    "ok": True,
                    "result": json.loads(row["data"]),
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
            else:
                return {"ok": False, "error": "not_found"}
    except sqlite3.OperationalError:
        return {"ok": False, "error": "table_not_found"}
    except Exception as e:
        logger.exception("db_retrieve error")
        return {"ok": False, "error": str(e)}


async def db_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search documents in a collection with optional key-value filters and limit."""
    table = _safe_table_name(args.get("table") or args.get("collection") or "default_store")
    filters = args.get("filters") or {}
    limit = int(args.get("limit") or 100)

    try:
        with _get_conn() as conn:
            try:
                cur = conn.execute(f'SELECT data FROM "{table}"')
                rows = cur.fetchall()
            except sqlite3.OperationalError:
                return {"ok": True, "results": [], "count": 0}

            results: List[Dict[str, Any]] = []
            for row in rows:
                doc = json.loads(row["data"])
                match = True
                for k, v in filters.items():
                    if doc.get(k) != v:
                        match = False
                        break
                if match:
                    results.append(doc)
                    if len(results) >= limit:
                        break

            return {"ok": True, "results": results, "count": len(results)}
    except Exception as e:
        logger.exception("db_search error")
        return {"ok": False, "error": str(e)}


async def db_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a document by ID from a collection."""
    table = _safe_table_name(args.get("table") or args.get("collection") or "default_store")
    doc_id = args.get("id")
    if not doc_id:
        return {"ok": False, "error": "missing 'id' parameter"}

    try:
        with _get_conn() as conn:
            cursor = conn.execute(f'DELETE FROM "{table}" WHERE id = ?', (doc_id,))
            conn.commit()
            return {"ok": True, "deleted": cursor.rowcount > 0}
    except sqlite3.OperationalError:
        return {"ok": False, "error": "table_not_found"}
    except Exception as e:
        logger.exception("db_delete error")
        return {"ok": False, "error": str(e)}


async def db_list_tables(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all tables in the workflow database."""
    try:
        with _get_conn() as conn:
            cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            tables = [row["name"] for row in cur.fetchall()]
            return {"ok": True, "tables": tables, "count": len(tables)}
    except Exception as e:
        logger.exception("db_list_tables error")
        return {"ok": False, "error": str(e)}
