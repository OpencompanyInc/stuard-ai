from __future__ import annotations

import os
import sqlite3
import json
import logging
from typing import Any, Dict, List, Optional, Union
from uuid import uuid4
from datetime import datetime, timezone
from pydantic import Field

from ..db import LANCE_DB_PATH
from .types import tool, ToolInput, ToolOutput

logger = logging.getLogger("agent")

# Use a separate SQLite file for the workflow database, stored alongside the LanceDB data
DB_PATH = os.path.join(os.path.dirname(LANCE_DB_PATH), "workflow.db")

def _get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _ensure_kv_table(conn: sqlite3.Connection, table_name: str):
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            id TEXT PRIMARY KEY,
            data TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)
    conn.commit()

class DatabaseToolInput(ToolInput):
    action: str = Field(..., description="Action to perform: sql, store, retrieve, search, delete, list_tables")
    query: Optional[str] = Field(None, description="SQL query for 'sql' action")
    params: Optional[List[Any]] = Field(None, description="Parameters for SQL query")
    table: Optional[str] = Field("default_store", description="Table name for store/retrieve/search/delete")
    id: Optional[str] = Field(None, description="Document ID for store/retrieve/delete")
    data: Optional[Dict[str, Any]] = Field(None, description="Data to store")
    filters: Optional[Dict[str, Any]] = Field(None, description="Filters for search")

class DatabaseToolOutput(ToolOutput):
    results: Optional[List[Dict[str, Any]]] = None
    affected_rows: Optional[int] = None
    id: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    tables: Optional[List[str]] = None

@tool(
    name="database_tool",
    input_model=DatabaseToolInput,
    output_model=DatabaseToolOutput,
    description="A versatile database tool for workflows. Supports raw SQL and a document store."
)
async def database_tool(args: DatabaseToolInput) -> Union[DatabaseToolOutput, Dict[str, Any]]:
    action = args.action.lower()
    
    try:
        with _get_conn() as conn:
            if action == "sql":
                if not args.query:
                    raise ValueError("missing query")
                params = args.params or []
                cursor = conn.execute(args.query, params)
                if args.query.strip().upper().startswith("SELECT") or "RETURNING" in args.query.upper():
                    rows = [dict(row) for row in cursor.fetchall()]
                    return DatabaseToolOutput(ok=True, results=rows)
                else:
                    conn.commit()
                    return DatabaseToolOutput(ok=True, affected_rows=cursor.rowcount)

            elif action == "store":
                table = args.table or "default_store"
                if not table.replace("_", "").isalnum():
                    raise ValueError("invalid table name")
                
                _ensure_kv_table(conn, table)
                
                if not args.data:
                    raise ValueError("missing data")
                
                doc_id = str(args.data.get("id") or args.id or uuid4())
                data = args.data.copy()
                data["id"] = doc_id
                
                now = datetime.now(timezone.utc).isoformat()
                
                cur = conn.execute(f"SELECT created_at FROM {table} WHERE id = ?", (doc_id,))
                row = cur.fetchone()
                
                if row:
                    created_at = row["created_at"]
                    conn.execute(
                        f"UPDATE {table} SET data = ?, updated_at = ? WHERE id = ?",
                        (json.dumps(data), now, doc_id)
                    )
                else:
                    created_at = now
                    conn.execute(
                        f"INSERT INTO {table} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
                        (doc_id, json.dumps(data), created_at, now)
                    )
                conn.commit()
                return DatabaseToolOutput(ok=True, id=doc_id)

            elif action == "retrieve":
                table = args.table or "default_store"
                if not args.id:
                    raise ValueError("missing id")
                
                try:
                    cur = conn.execute(f"SELECT data FROM {table} WHERE id = ?", (args.id,))
                    row = cur.fetchone()
                    if row:
                        return DatabaseToolOutput(ok=True, result=json.loads(row["data"]))
                    else:
                        return DatabaseToolOutput(ok=False, error="not_found")
                except sqlite3.OperationalError:
                     return DatabaseToolOutput(ok=False, error="table_not_found")

            elif action == "search":
                table = args.table or "default_store"
                try:
                    cur = conn.execute(f"SELECT data FROM {table}")
                    rows = cur.fetchall()
                except sqlite3.OperationalError:
                    return DatabaseToolOutput(ok=True, results=[])
                
                results = []
                filters = args.filters or {}
                
                for row in rows:
                    doc = json.loads(row["data"])
                    match = True
                    for k, v in filters.items():
                        if doc.get(k) != v:
                            match = False
                            break
                    if match:
                        results.append(doc)
                
                return DatabaseToolOutput(ok=True, results=results)

            elif action == "delete":
                table = args.table or "default_store"
                if not args.id:
                    raise ValueError("missing id")
                
                try:
                    conn.execute(f"DELETE FROM {table} WHERE id = ?", (args.id,))
                    conn.commit()
                    return DatabaseToolOutput(ok=True)
                except sqlite3.OperationalError:
                    return DatabaseToolOutput(ok=False, error="table_not_found")

            elif action == "list_tables":
                cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
                tables = [row["name"] for row in cur.fetchall()]
                return DatabaseToolOutput(ok=True, tables=tables)

            else:
                return DatabaseToolOutput(ok=False, error="unknown_action")

    except Exception as e:
        logger.exception("database_tool_error")
        return DatabaseToolOutput(ok=False, error=str(e))
