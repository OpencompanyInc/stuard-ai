"""
Knowledge Pack RAG Store

Sandboxed, attachable RAG namespaces. Each *pack* is an isolated collection of
source-derived text chunks + embedding vectors. Any agent / live session /
workflow connects to a pack by id and queries it through a scoped query tool —
retrieval never leaks across packs or into the personal knowledge graph
(`knowledge_db.py`).

Storage is device-local SQLite (mirrored to the VM via the agent-data sync),
deliberately NOT Supabase: pack contents are personal user documents.

Embedding is done cloud-side (same gemini-embedding model as the knowledge
graph) and the precomputed vectors are shipped down via the bridge — this module
only stores vectors and runs cosine similarity, exactly like
`knowledge_db.search_facts_by_vector`. Query and chunk vectors therefore must
come from the same embedder; this module is dimension-agnostic and stores
whatever length it is given.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

import numpy as np

# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════

PackScope = Literal["ephemeral", "saved"]


@dataclass
class Pack:
    id: str
    title: str
    persona: str
    scope: PackScope
    chunk_count: int
    created_at: str
    updated_at: str
    project_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _get_user_data_dir() -> str:
    """Get platform-appropriate user data directory (matches knowledge_db)."""
    override = os.getenv("AGENT_DATA_DIR")
    if override:
        return override

    if sys.platform == "win32":
        base = os.getenv("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.getenv("XDG_DATA_HOME") or os.path.join(
            os.path.expanduser("~"), ".local", "share"
        )

    return os.path.join(base, "StuardAI", "agent")


_DATA_DIR = _get_user_data_dir()
_DB_PATH = os.path.abspath(os.path.join(_DATA_DIR, "rag_packs.db"))
os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# DB HELPERS
# ═══════════════════════════════════════════════════════════════════════════════


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    # Enforce ON DELETE CASCADE for chunks when a pack is deleted.
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _serialize_vector(vec: Optional[List[float]]) -> Optional[bytes]:
    if vec is None:
        return None
    try:
        if isinstance(vec, list) and len(vec) == 0:
            return None
    except Exception:
        pass
    return np.array(vec, dtype=np.float32).tobytes()


def _deserialize_vector(data: Optional[bytes]) -> Optional[List[float]]:
    if data is None:
        return None
    try:
        if isinstance(data, (bytes, bytearray)) and len(data) == 0:
            return None
    except Exception:
        pass
    vec = np.frombuffer(data, dtype=np.float32).tolist()
    if not vec:
        return None
    return vec


def init() -> None:
    """Initialize the RAG pack store schema."""
    with get_conn() as conn:
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS rag_packs (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                persona TEXT DEFAULT '',
                scope TEXT NOT NULL DEFAULT 'saved' CHECK(scope IN ('ephemeral', 'saved')),
                project_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        try:
            cur.execute("ALTER TABLE rag_packs ADD COLUMN project_id TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists

        cur.execute("""
            CREATE TABLE IF NOT EXISTS rag_chunks (
                id TEXT PRIMARY KEY,
                pack_id TEXT NOT NULL REFERENCES rag_packs(id) ON DELETE CASCADE,
                source_ref TEXT DEFAULT '',
                ordinal INTEGER DEFAULT 0,
                text TEXT NOT NULL,
                vector BLOB,
                created_at TEXT NOT NULL
            )
        """)

        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_rag_chunks_pack ON rag_chunks(pack_id)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_rag_chunks_pack_ord ON rag_chunks(pack_id, ordinal)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_rag_chunks_source ON rag_chunks(pack_id, source_ref)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_rag_packs_scope ON rag_packs(scope)"
        )
        cur.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_packs_project ON rag_packs(project_id) WHERE project_id IS NOT NULL"
        )

        conn.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# PACK OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════


def _chunk_count(conn: sqlite3.Connection, pack_id: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM rag_chunks WHERE pack_id = ?", (pack_id,)
    ).fetchone()
    return int(row["n"]) if row else 0


def _row_to_pack(conn: sqlite3.Connection, row) -> Pack:
    return Pack(
        id=row["id"],
        title=row["title"],
        persona=row["persona"] or "",
        scope=row["scope"],
        chunk_count=_chunk_count(conn, row["id"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        project_id=row["project_id"] if "project_id" in row.keys() else None,
    )


def create_pack(
    title: str,
    persona: str = "",
    scope: PackScope = "saved",
    project_id: Optional[str] = None,
) -> Pack:
    """Create a new (empty) knowledge pack.

    `project_id` is used for Stuard Project document context. It is kept in the
    RAG database instead of project settings so the project UI never exposes pack
    implementation details.
    """
    pid = str(uuid.uuid4())
    now = _now_iso()
    scope = scope if scope in ("ephemeral", "saved") else "saved"
    project_id = str(project_id or "").strip() or None
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO rag_packs (id, title, persona, scope, project_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                pid,
                str(title or "Untitled pack").strip(),
                str(persona or "").strip(),
                scope,
                project_id,
                now,
                now,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM rag_packs WHERE id = ?", (pid,)).fetchone()
        return _row_to_pack(conn, row)


def get_pack(pack_id: str) -> Optional[Pack]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM rag_packs WHERE id = ?", (pack_id,)
        ).fetchone()
        if not row:
            return None
        return _row_to_pack(conn, row)


def get_project_pack(project_id: str) -> Optional[Pack]:
    pid = str(project_id or "").strip()
    if not pid:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM rag_packs WHERE project_id = ?", (pid,)
        ).fetchone()
        if not row:
            return None
        return _row_to_pack(conn, row)


def get_or_create_project_pack(
    project_id: str, title: str = "Project documents"
) -> Pack:
    pid = str(project_id or "").strip()
    if not pid:
        raise ValueError("project_id is required")
    existing = get_project_pack(pid)
    if existing:
        return existing
    return create_pack(
        title=str(title or "Project documents").strip(),
        persona="Project document context",
        scope="saved",
        project_id=pid,
    )


def list_packs(limit: int = 100, include_project_packs: bool = False) -> List[Pack]:
    with get_conn() as conn:
        if include_project_packs:
            rows = conn.execute(
                "SELECT * FROM rag_packs ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM rag_packs WHERE project_id IS NULL ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_pack(conn, r) for r in rows]


def touch_pack(pack_id: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE rag_packs SET updated_at = ? WHERE id = ?", (_now_iso(), pack_id)
        )
        conn.commit()


def delete_pack(pack_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM rag_packs WHERE id = ?", (pack_id,))
        conn.commit()
        return cur.rowcount > 0


def delete_project_pack(project_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM rag_packs WHERE project_id = ?",
            (str(project_id or "").strip(),),
        )
        conn.commit()
        return cur.rowcount > 0


# ═══════════════════════════════════════════════════════════════════════════════
# CHUNK OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════


def delete_chunks_for_source(pack_id: str, source_ref: str) -> int:
    """Delete all chunks for a single source within a pack."""
    ref = str(source_ref or "").strip()
    if not pack_id or not ref:
        return 0
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM rag_chunks WHERE pack_id = ? AND source_ref = ?",
            (pack_id, ref),
        )
        deleted = cur.rowcount
        if deleted:
            conn.execute(
                "UPDATE rag_packs SET updated_at = ? WHERE id = ?",
                (_now_iso(), pack_id),
            )
        conn.commit()
        return deleted


def delete_chunks_for_sources(pack_id: str, source_refs: List[str]) -> int:
    total = 0
    for ref in source_refs or []:
        total += delete_chunks_for_source(pack_id, ref)
    return total


def add_chunks(pack_id: str, chunks: List[Dict[str, Any]]) -> int:
    """Insert pre-embedded chunks into a pack.

    Each chunk: { text: str, vector: list[float] | None, source_ref?: str, ordinal?: int }.
    Returns the number of chunks inserted. Chunks with empty text are skipped.
    """
    if not chunks:
        return 0

    now = _now_iso()
    inserted = 0
    with get_conn() as conn:
        # Continue ordinals from the current max so repeated add_chunks calls
        # keep a stable, monotonic order within the pack.
        row = conn.execute(
            "SELECT COALESCE(MAX(ordinal), -1) AS m FROM rag_chunks WHERE pack_id = ?",
            (pack_id,),
        ).fetchone()
        next_ord = (int(row["m"]) + 1) if row else 0

        for ch in chunks:
            text = str((ch or {}).get("text") or "").strip()
            if not text:
                continue
            vector = ch.get("vector")
            source_ref = str(ch.get("source_ref") or "").strip()
            ordinal = ch.get("ordinal")
            ordinal = int(ordinal) if isinstance(ordinal, (int, float)) else next_ord
            next_ord = max(next_ord, ordinal) + 1

            conn.execute(
                """INSERT INTO rag_chunks (id, pack_id, source_ref, ordinal, text, vector, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()),
                    pack_id,
                    source_ref,
                    ordinal,
                    text,
                    _serialize_vector(vector if isinstance(vector, list) else None),
                    now,
                ),
            )
            inserted += 1

        if inserted:
            conn.execute(
                "UPDATE rag_packs SET updated_at = ? WHERE id = ?", (now, pack_id)
            )
        conn.commit()

    return inserted


def query_pack(
    pack_id: str,
    query_vector: List[float],
    limit: int = 6,
    threshold: float = 0.0,
) -> List[Dict[str, Any]]:
    """Cosine-similarity search of a single pack's chunks.

    Returns [{ text, source_ref, ordinal, score }] sorted by descending score.
    Scoped strictly to `pack_id` — this is the retrieval-isolation boundary.
    """
    if not isinstance(query_vector, list) or len(query_vector) == 0:
        return []

    query_np = np.array(query_vector, dtype=np.float32)
    q_norm = float(np.linalg.norm(query_np))
    if q_norm == 0:
        return []

    with get_conn() as conn:
        rows = conn.execute(
            """SELECT source_ref, ordinal, text, vector FROM rag_chunks
               WHERE pack_id = ? AND vector IS NOT NULL AND length(vector) > 0""",
            (pack_id,),
        ).fetchall()

    results: List[Dict[str, Any]] = []
    for row in rows:
        vec = _deserialize_vector(row["vector"])
        if not vec:
            continue
        vec_np = np.array(vec, dtype=np.float32)
        denom = q_norm * float(np.linalg.norm(vec_np))
        score = float(np.dot(query_np, vec_np) / denom) if denom > 0 else 0.0
        if score >= threshold:
            results.append(
                {
                    "text": row["text"],
                    "source_ref": row["source_ref"] or "",
                    "ordinal": row["ordinal"],
                    "score": score,
                }
            )

    results.sort(key=lambda x: x["score"], reverse=True)

    # Touch last-access so saved packs surface by recency in list_packs.
    try:
        touch_pack(pack_id)
    except Exception:
        pass

    return results[:limit]


def pack_stats(pack_id: str) -> Dict[str, Any]:
    with get_conn() as conn:
        pack_row = conn.execute(
            "SELECT * FROM rag_packs WHERE id = ?", (pack_id,)
        ).fetchone()
        if not pack_row:
            return {"exists": False}
        n = _chunk_count(conn, pack_id)
        embedded = conn.execute(
            "SELECT COUNT(*) AS n FROM rag_chunks WHERE pack_id = ? AND vector IS NOT NULL AND length(vector) > 0",
            (pack_id,),
        ).fetchone()
        source_rows = conn.execute(
            """SELECT source_ref, COUNT(*) AS chunks
               FROM rag_chunks
               WHERE pack_id = ? AND COALESCE(source_ref, '') <> ''
               GROUP BY source_ref
               ORDER BY source_ref ASC""",
            (pack_id,),
        ).fetchall()
        source_refs = [str(r["source_ref"] or "") for r in source_rows]
        return {
            "exists": True,
            "id": pack_id,
            "title": pack_row["title"],
            "scope": pack_row["scope"],
            "project_id": pack_row["project_id"]
            if "project_id" in pack_row.keys()
            else None,
            "chunks": n,
            "embedded_chunks": int(embedded["n"]) if embedded else 0,
            "sources": len(source_refs),
            "source_refs": source_refs,
            "source_stats": [
                {
                    "source_ref": str(r["source_ref"] or ""),
                    "chunks": int(r["chunks"] or 0),
                }
                for r in source_rows
            ],
        }


# Initialize on import (matches knowledge_db convention).
try:
    init()
except Exception as e:  # pragma: no cover
    print(f"[rag_db] Init error: {e}")
