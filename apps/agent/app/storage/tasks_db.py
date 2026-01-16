from __future__ import annotations

import json
import os
import sys
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional


def _get_user_data_dir() -> str:
    """Get platform-appropriate user data directory, works in frozen/dev."""
    # Allow override via env var
    if os.getenv("AGENT_DATA_DIR"):
        return os.getenv("AGENT_DATA_DIR")
    
    # Use platform-standard user data location
    if sys.platform == "win32":
        base = os.getenv("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.getenv("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    
    return os.path.join(base, "StuardAI", "agent")


_DATA_DIR = _get_user_data_dir()
_DB_PATH = os.path.abspath(os.path.join(_DATA_DIR, "tasks.db"))

os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS calendars (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              calendar_id TEXT NOT NULL,
              due TEXT,
              priority TEXT,
              tags TEXT,
              completed INTEGER DEFAULT 0,
              created_at TEXT NOT NULL,
              recurrence TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS reminders (
              id TEXT PRIMARY KEY,
              task_id TEXT,
              message TEXT NOT NULL,
              when_iso TEXT NOT NULL,
              when_epoch_ms INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              fired_at TEXT,
              canceled_at TEXT,
              recurrence TEXT
            )
            """
        )
        # Migrations
        try:
            cur.execute("ALTER TABLE tasks ADD COLUMN recurrence TEXT")
        except Exception:
            pass
        try:
            cur.execute("ALTER TABLE reminders ADD COLUMN recurrence TEXT")
        except Exception:
            pass
        conn.commit()


# Calendars

def list_calendars() -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT id, name, created_at FROM calendars").fetchall()
        return [
            {"id": r["id"], "name": r["name"], "createdAt": r["created_at"]}
            for r in rows
        ]


def create_calendar(cid: str, name: str) -> Dict[str, Any]:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO calendars (id, name, created_at) VALUES (?, ?, ?)",
            (cid, name, _now_iso()),
        )
        conn.commit()
    return {"id": cid, "name": name, "createdAt": _now_iso()}


def read_calendar(cid: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        r = conn.execute(
            "SELECT id, name, created_at FROM calendars WHERE id = ?",
            (cid,),
        ).fetchone()
        if not r:
            return None
        return {"id": r["id"], "name": r["name"], "createdAt": r["created_at"]}


def update_calendar(cid: str, name: Optional[str]) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        if name is not None:
            conn.execute("UPDATE calendars SET name = ? WHERE id = ?", (name, cid))
            conn.commit()
        r = conn.execute(
            "SELECT id, name, created_at FROM calendars WHERE id = ?",
            (cid,),
        ).fetchone()
        if not r:
            return None
        return {"id": r["id"], "name": r["name"], "createdAt": r["created_at"]}


def delete_calendar(cid: str) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM tasks WHERE calendar_id = ?", (cid,))
        cur = conn.execute("DELETE FROM calendars WHERE id = ?", (cid,))
        conn.commit()
        return cur.rowcount > 0


# Tasks

def _serialize_task_row(r: sqlite3.Row) -> Dict[str, Any]:
    tags_raw = r["tags"]
    try:
        tags = json.loads(tags_raw) if tags_raw else []
        if not isinstance(tags, list):
            tags = []
    except Exception:
        tags = []
    
    recurrence = None
    if "recurrence" in r.keys() and r["recurrence"]:
        try:
            recurrence = json.loads(r["recurrence"])
        except Exception:
            recurrence = None

    return {
        "id": r["id"],
        "title": r["title"],
        "calendarId": r["calendar_id"],
        "due": r["due"],
        "priority": r["priority"] or "normal",
        "tags": tags,
        "completed": bool(r["completed"] or 0),
        "createdAt": r["created_at"],
        "recurrence": recurrence,
    }


def list_tasks(calendar_id: Optional[str] = None) -> List[Dict[str, Any]]:
    with get_conn() as conn:
        if calendar_id:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE calendar_id = ?",
                (calendar_id,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM tasks").fetchall()
        return [_serialize_task_row(r) for r in rows]


def create_task(tid: str, title: str, calendar_id: str, due: Optional[str], priority: str, tags: List[str], completed: bool, recurrence: Optional[Dict] = None) -> Dict[str, Any]:
    with get_conn() as conn:
        rec_str = json.dumps(recurrence) if recurrence else None
        conn.execute(
            "INSERT INTO tasks (id, title, calendar_id, due, priority, tags, completed, created_at, recurrence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (tid, title, calendar_id, due, priority, json.dumps(tags or []), 1 if completed else 0, _now_iso(), rec_str),
        )
        conn.commit()
    return read_task(tid) or {}


def read_task(tid: str) -> Optional[Dict[str, Any]]:
    with get_conn() as conn:
        r = conn.execute("SELECT * FROM tasks WHERE id = ?", (tid,)).fetchone()
        return _serialize_task_row(r) if r else None


def update_task(tid: str, changes: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    fields = []
    values = []
    if "title" in changes:
        fields.append("title = ?")
        values.append(str(changes["title"]))
    if "calendarId" in changes:
        fields.append("calendar_id = ?")
        values.append(str(changes["calendarId"]))
    if "due" in changes:
        fields.append("due = ?")
        values.append(changes["due"])
    if "priority" in changes:
        fields.append("priority = ?")
        values.append(str(changes["priority"]))
    if "tags" in changes:
        fields.append("tags = ?")
        try:
            values.append(json.dumps(changes["tags"]))
        except Exception:
            values.append("[]")
    if "completed" in changes:
        fields.append("completed = ?")
        values.append(1 if bool(changes["completed"]) else 0)
    if "recurrence" in changes:
        fields.append("recurrence = ?")
        val = changes["recurrence"]
        values.append(json.dumps(val) if val else None)
        
    if not fields:
        return read_task(tid)
    values.append(tid)
    with get_conn() as conn:
        conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", tuple(values))
        conn.commit()
    return read_task(tid)


def delete_task(tid: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (tid,))
        conn.commit()
        return cur.rowcount > 0


# Reminders

def insert_reminder(rid: str, task_id: str, message: str, when_iso: str, when_epoch_ms: int, recurrence: Optional[Dict] = None) -> Dict[str, Any]:
    with get_conn() as conn:
        rec_str = json.dumps(recurrence) if recurrence else None
        conn.execute(
            "INSERT INTO reminders (id, task_id, message, when_iso, when_epoch_ms, created_at, recurrence) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (rid, task_id, message, when_iso, int(when_epoch_ms), _now_iso(), rec_str),
        )
        conn.commit()
    return {
        "id": rid,
        "taskId": task_id,
        "message": message,
        "whenIso": when_iso,
        "whenEpochMs": int(when_epoch_ms),
        "createdAt": _now_iso(),
        "recurrence": recurrence,
    }


def update_reminder_reschedule(rid: str, when_iso: str, when_epoch_ms: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE reminders SET when_iso = ?, when_epoch_ms = ?, fired_at = NULL WHERE id = ?",
            (when_iso, int(when_epoch_ms), rid),
        )
        conn.commit()


def list_active_reminders() -> List[Dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM reminders WHERE canceled_at IS NULL AND fired_at IS NULL"
        ).fetchall()
        
        res = []
        for r in rows:
            recurrence = None
            if "recurrence" in r.keys() and r["recurrence"]:
                try:
                    recurrence = json.loads(r["recurrence"])
                except Exception:
                    recurrence = None
            
            res.append({
                "id": r["id"],
                "taskId": r["task_id"] or "",
                "message": r["message"],
                "whenIso": r["when_iso"],
                "whenEpochMs": int(r["when_epoch_ms"]),
                "createdAt": r["created_at"],
                "recurrence": recurrence,
            })
        return res


def cancel_reminder(rid: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("UPDATE reminders SET canceled_at = ? WHERE id = ? AND fired_at IS NULL AND canceled_at IS NULL", (_now_iso(), rid))
        conn.commit()
        return cur.rowcount > 0


def mark_fired(rid: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE reminders SET fired_at = ? WHERE id = ? AND fired_at IS NULL", (_now_iso(), rid))
        conn.commit()


def ensure_default_calendar() -> str:
    with get_conn() as conn:
        r = conn.execute("SELECT id FROM calendars LIMIT 1").fetchone()
        if r:
            return str(r["id"])
    # Create default
    import uuid
    cid = str(uuid.uuid4())
    create_calendar(cid, "Default")
    return cid


# Initialize DB on import
try:
    init()
except Exception:
    pass
