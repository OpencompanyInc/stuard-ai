"""
Entity-Fact Knowledge Graph Database

A semi-structured knowledge graph that replaces "bag of vectors" with:
- Entities: High-level anchors (projects, people, companies, tools)
- Facts: Atomic memory units linked to entities

Fact Taxonomy:
- personal.core: Overwrite (name, birthday, os, gpu, timezone, etc.)
- personal.bio: Append (preferences, habits, relationships)
- instruction.system: High-priority directives
- project.detail: Project-linked facts
- procedural.snippet: Commands, paths, credentials (dedupe by key)
- event.history: Time-series logs
"""

from __future__ import annotations

import json
import os
import sys
import sqlite3
import uuid
import numpy as np
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Literal
from dataclasses import dataclass, asdict

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS & TYPES
# ═══════════════════════════════════════════════════════════════════════════════

VECTOR_DIM = 3072  # text-embedding-3-large

EntityType = Literal['project', 'person', 'company', 'tool', 'topic']
FactCategory = Literal['personal', 'instruction', 'project', 'procedural', 'event']
FactSubtype = Literal['core', 'bio', 'system', 'detail', 'snippet', 'history']

# Core profile keys (overwrite behavior)
CORE_PROFILE_KEYS = frozenset([
    'name', 'nickname', 'birthday', 'country', 'timezone', 'occupation',
    'email', 'language', 'os', 'gpu', 'cpu', 'ram', 'shell', 'editor',
    'preferred_language', 'work_hours', 'communication_style'
])

# Procedural keys (dedupe by key)
PROCEDURAL_KEYS = frozenset(['command', 'path', 'credential', 'api_key', 'endpoint'])


def _get_user_data_dir() -> str:
    """Get platform-appropriate user data directory."""
    if os.getenv("AGENT_DATA_DIR"):
        return os.getenv("AGENT_DATA_DIR")
    
    if sys.platform == "win32":
        base = os.getenv("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.getenv("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    
    return os.path.join(base, "StuardAI", "agent")


_DATA_DIR = _get_user_data_dir()
_DB_PATH = os.path.abspath(os.path.join(_DATA_DIR, "knowledge.db"))
os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class Entity:
    id: str
    name: str
    type: EntityType
    summary: str
    vector: Optional[List[float]]
    last_accessed: str
    created_at: str
    
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['vector'] = None  # Don't serialize vector in API responses
        return d


@dataclass
class Fact:
    id: str
    entity_id: Optional[str]
    category: FactCategory
    subtype: FactSubtype
    attribute_key: Optional[str]
    text: str
    vector: Optional[List[float]]
    created_at: str
    validity: bool = True
    source: str = 'ai_extracted'  # 'ai_extracted' | 'user_manual'
    confidence: float = 1.0  # 0.0-1.0 certainty score
    source_conversation_id: Optional[str] = None  # conversation that produced this fact
    last_confirmed_at: Optional[str] = None  # when last confirmed by user/corroboration
    supersedes_id: Optional[str] = None  # previous fact this replaces (temporal chain)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['vector'] = None
        return d


@dataclass
class PendingMemory:
    """A memory that needs user confirmation before being stored permanently."""
    id: str
    original_text: str  # The raw text from conversation
    proposed_action: str  # What action would be taken (UPDATE_PROFILE, ADD_BIO, etc.)
    proposed_key: Optional[str]  # For UPDATE_PROFILE, the key to update
    proposed_value: str  # The value to store
    confidence_reason: str  # Why the AI is uncertain
    entity_name: Optional[str]  # Related entity if any
    created_at: str
    status: str = 'pending'  # 'pending' | 'confirmed' | 'rejected'
    expires_at: Optional[str] = None  # B4: TTL; NULL for legacy rows pre-migration

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _serialize_vector(vec: Optional[List[float]]) -> Optional[bytes]:
    """Serialize vector to bytes for SQLite storage."""
    if vec is None:
        return None
    try:
        if isinstance(vec, list) and len(vec) == 0:
            return None
    except Exception:
        pass
    return np.array(vec, dtype=np.float32).tobytes()


def _deserialize_vector(data: Optional[bytes]) -> Optional[List[float]]:
    """Deserialize vector from bytes."""
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
    """Initialize the knowledge graph database schema."""
    with get_conn() as conn:
        cur = conn.cursor()
        
        # Entities table - the anchors
        cur.execute("""
            CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('project', 'person', 'company', 'tool', 'topic')),
                summary TEXT DEFAULT '',
                vector BLOB,
                last_accessed TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        
        # Facts table - the atomic units
        cur.execute("""
            CREATE TABLE IF NOT EXISTS facts (
                id TEXT PRIMARY KEY,
                entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
                category TEXT NOT NULL CHECK(category IN ('personal', 'instruction', 'project', 'procedural', 'event')),
                subtype TEXT NOT NULL CHECK(subtype IN ('core', 'bio', 'system', 'detail', 'snippet', 'history')),
                attribute_key TEXT,
                text TEXT NOT NULL,
                vector BLOB,
                created_at TEXT NOT NULL,
                validity INTEGER DEFAULT 1,
                source TEXT DEFAULT 'ai_extracted'
            )
        """)
        
        # Pending memories table - for uncertain memories awaiting confirmation
        cur.execute("""
            CREATE TABLE IF NOT EXISTS pending_memories (
                id TEXT PRIMARY KEY,
                original_text TEXT NOT NULL,
                proposed_action TEXT NOT NULL,
                proposed_key TEXT,
                proposed_value TEXT NOT NULL,
                confidence_reason TEXT NOT NULL,
                entity_name TEXT,
                created_at TEXT NOT NULL,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected'))
            )
        """)

        # Migrations: add new columns to facts table if missing
        for col_sql in [
            "ALTER TABLE facts ADD COLUMN confidence REAL DEFAULT 1.0",
            "ALTER TABLE facts ADD COLUMN source_conversation_id TEXT",
            "ALTER TABLE facts ADD COLUMN last_confirmed_at TEXT",
            "ALTER TABLE facts ADD COLUMN supersedes_id TEXT",
        ]:
            try:
                cur.execute(col_sql)
            except sqlite3.OperationalError:
                pass  # Column already exists

        # B4: TTL for pending memories. Default 14 days from `created_at` —
        # `pending_memory_expire` deletes any pending row past expiry. Stored
        # as ISO text for sortability and consistency with `created_at`.
        try:
            cur.execute("ALTER TABLE pending_memories ADD COLUMN expires_at TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Indexes for efficient retrieval
        cur.execute("CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_facts_subtype ON facts(category, subtype)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_facts_key ON facts(category, subtype, attribute_key)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_memories(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_facts_source_conv ON facts(source_conversation_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_facts_confidence ON facts(confidence)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_memories(expires_at)")

        conn.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# ENTITY OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def create_entity(
    name: str,
    entity_type: EntityType,
    summary: str = '',
    vector: Optional[List[float]] = None
) -> Entity:
    """Create a new entity anchor."""
    name = str(name or '').strip()
    # Idempotent behavior: if entity already exists (case-insensitive), return it and optionally enrich.
    existing = find_entity_by_name(name, entity_type=None)
    if existing:
        desired_type: Optional[EntityType] = None
        if entity_type and existing.type == 'topic' and entity_type != 'topic':
            desired_type = entity_type

        desired_summary: Optional[str] = None
        if summary and not (existing.summary or '').strip():
            desired_summary = summary

        desired_vector: Optional[List[float]] = None
        if vector and not existing.vector:
            desired_vector = vector

        updated = update_entity(
            entity_id=existing.id,
            summary=desired_summary,
            vector=desired_vector,
            entity_type=desired_type,
        )
        return updated or existing

    eid = str(uuid.uuid4())
    now = _now_iso()
    
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO entities (id, name, type, summary, vector, last_accessed, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (eid, name, entity_type, summary, _serialize_vector(vector), now, now)
        )
        conn.commit()
    
    return Entity(
        id=eid, name=name, type=entity_type, summary=summary,
        vector=vector, last_accessed=now, created_at=now
    )


def get_entity(entity_id: str) -> Optional[Entity]:
    """Get entity by ID."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM entities WHERE id = ?", (entity_id,)
        ).fetchone()
        if not row:
            return None
        return Entity(
            id=row['id'], name=row['name'], type=row['type'],
            summary=row['summary'], vector=_deserialize_vector(row['vector']),
            last_accessed=row['last_accessed'], created_at=row['created_at']
        )


def find_entity_by_name(name: str, entity_type: Optional[EntityType] = None) -> Optional[Entity]:
    """Find entity by exact name match."""
    with get_conn() as conn:
        if entity_type:
            row = conn.execute(
                "SELECT * FROM entities WHERE LOWER(name) = LOWER(?) AND type = ?",
                (name, entity_type)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM entities WHERE LOWER(name) = LOWER(?)", (name,)
            ).fetchone()
        if not row:
            return None
        return Entity(
            id=row['id'], name=row['name'], type=row['type'],
            summary=row['summary'], vector=_deserialize_vector(row['vector']),
            last_accessed=row['last_accessed'], created_at=row['created_at']
        )


def search_entities_by_vector(
    query_vector: List[float],
    limit: int = 5,
    entity_type: Optional[EntityType] = None,
    threshold: float = 0.7
) -> List[Tuple[Entity, float]]:
    """Search entities by vector similarity."""
    query_np = np.array(query_vector, dtype=np.float32)
    
    with get_conn() as conn:
        if entity_type:
            rows = conn.execute(
                "SELECT * FROM entities WHERE type = ? AND vector IS NOT NULL AND length(vector) > 0",
                (entity_type,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM entities WHERE vector IS NOT NULL AND length(vector) > 0"
            ).fetchall()
    
    results = []
    for row in rows:
        vec = _deserialize_vector(row['vector'])
        if vec:
            vec_np = np.array(vec, dtype=np.float32)
            # Cosine similarity
            dot = np.dot(query_np, vec_np)
            norm = np.linalg.norm(query_np) * np.linalg.norm(vec_np)
            score = float(dot / norm) if norm > 0 else 0.0
            
            if score >= threshold:
                entity = Entity(
                    id=row['id'], name=row['name'], type=row['type'],
                    summary=row['summary'], vector=vec,
                    last_accessed=row['last_accessed'], created_at=row['created_at']
                )
                results.append((entity, score))
    
    results.sort(key=lambda x: x[1], reverse=True)
    return results[:limit]


def update_entity(
    entity_id: str,
    name: Optional[str] = None,
    summary: Optional[str] = None,
    vector: Optional[List[float]] = None,
    entity_type: Optional[EntityType] = None
) -> Optional[Entity]:
    """Update entity fields."""
    updates = []
    values = []
    
    if name is not None:
        updates.append("name = ?")
        values.append(name)
    if summary is not None:
        updates.append("summary = ?")
        values.append(summary)
    if vector is not None:
        updates.append("vector = ?")
        values.append(_serialize_vector(vector))
    if entity_type is not None:
        updates.append("type = ?")
        values.append(entity_type)
    
    updates.append("last_accessed = ?")
    values.append(_now_iso())
    values.append(entity_id)
    
    if updates:
        with get_conn() as conn:
            conn.execute(
                f"UPDATE entities SET {', '.join(updates)} WHERE id = ?",
                tuple(values)
            )
            conn.commit()
    
    return get_entity(entity_id)


def list_entities(
    entity_type: Optional[EntityType] = None,
    limit: int = 100
) -> List[Entity]:
    """List all entities, optionally filtered by type."""
    with get_conn() as conn:
        if entity_type:
            rows = conn.execute(
                "SELECT * FROM entities WHERE type = ? ORDER BY last_accessed DESC LIMIT ?",
                (entity_type, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM entities ORDER BY last_accessed DESC LIMIT ?",
                (limit,)
            ).fetchall()
    
    return [
        Entity(
            id=r['id'], name=r['name'], type=r['type'],
            summary=r['summary'], vector=_deserialize_vector(r['vector']),
            last_accessed=r['last_accessed'], created_at=r['created_at']
        )
        for r in rows
    ]


def delete_entity(entity_id: str) -> bool:
    """Delete an entity and all linked facts."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM entities WHERE id = ?", (entity_id,))
        conn.commit()
        return cur.rowcount > 0


# ═══════════════════════════════════════════════════════════════════════════════
# FACT OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def create_fact(
    category: FactCategory,
    subtype: FactSubtype,
    text: str,
    entity_id: Optional[str] = None,
    attribute_key: Optional[str] = None,
    vector: Optional[List[float]] = None,
    source: str = 'ai_extracted',
    confidence: float = 1.0,
    source_conversation_id: Optional[str] = None,
    supersedes_id: Optional[str] = None,
) -> Fact:
    """Create a new fact."""
    fid = str(uuid.uuid4())
    now = _now_iso()
    confidence = max(0.0, min(1.0, float(confidence)))

    with get_conn() as conn:
        conn.execute(
            """INSERT INTO facts (id, entity_id, category, subtype, attribute_key, text, vector, created_at, validity, source, confidence, source_conversation_id, supersedes_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)""",
            (fid, entity_id, category, subtype, attribute_key, text, _serialize_vector(vector), now, source, confidence, source_conversation_id, supersedes_id)
        )
        conn.commit()

    return Fact(
        id=fid, entity_id=entity_id, category=category, subtype=subtype,
        attribute_key=attribute_key, text=text, vector=vector,
        created_at=now, validity=True, source=source,
        confidence=confidence, source_conversation_id=source_conversation_id,
        supersedes_id=supersedes_id,
    )


def _row_to_fact(row) -> Fact:
    """Convert a SQLite Row to a Fact dataclass, safely handling new columns."""
    keys = row.keys() if hasattr(row, 'keys') else []
    return Fact(
        id=row['id'], entity_id=row['entity_id'], category=row['category'],
        subtype=row['subtype'], attribute_key=row['attribute_key'],
        text=row['text'], vector=_deserialize_vector(row['vector']),
        created_at=row['created_at'], validity=bool(row['validity']),
        source=row['source'] or 'ai_extracted',
        confidence=float(row['confidence']) if 'confidence' in keys and row['confidence'] is not None else 1.0,
        source_conversation_id=row['source_conversation_id'] if 'source_conversation_id' in keys else None,
        last_confirmed_at=row['last_confirmed_at'] if 'last_confirmed_at' in keys else None,
        supersedes_id=row['supersedes_id'] if 'supersedes_id' in keys else None,
    )


def get_fact(fact_id: str) -> Optional[Fact]:
    """Get fact by ID."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM facts WHERE id = ?", (fact_id,)).fetchone()
        if not row:
            return None
        return _row_to_fact(row)


def upsert_core_fact(
    attribute_key: str,
    text: str,
    vector: Optional[List[float]] = None,
    source: str = 'ai_extracted',
    confidence: float = 1.0,
    source_conversation_id: Optional[str] = None,
) -> Fact:
    """Upsert a core profile fact (overwrite-by-supersession).

    B3: instead of mutating the existing row (which destroyed history), this
    inserts a new fact row and marks the prior fact's `validity = 0` with a
    `supersedes_id` chain. Active retrieval filters by `validity = 1` so the
    user-visible behavior is identical, but we can now answer "what was the
    user's OS before they switched?" and let B2 dedup/consolidation walk the
    chain.
    """
    with get_conn() as conn:
        # Look up the *active* (validity=1) fact matching this key. There
        # should be at most one — older entries have already been superseded.
        row = conn.execute(
            """SELECT id FROM facts
               WHERE category = 'personal' AND subtype = 'core'
                 AND attribute_key = ? AND validity = 1""",
            (attribute_key,)
        ).fetchone()

        confidence = max(0.0, min(1.0, float(confidence)))

        if not row:
            # First fact for this key — no supersession needed.
            return create_fact(
                category='personal', subtype='core', text=text,
                attribute_key=attribute_key, vector=vector, source=source,
                confidence=confidence, source_conversation_id=source_conversation_id,
            )

        old_id = row['id']
        # Mark the old row invalid so it stops showing up in active retrieval,
        # but keep it around so the supersession chain is traversable.
        conn.execute("UPDATE facts SET validity = 0 WHERE id = ?", (old_id,))
        conn.commit()

    # Create the new fact pointing back at the one it replaces.
    return create_fact(
        category='personal', subtype='core', text=text,
        attribute_key=attribute_key, vector=vector, source=source,
        confidence=confidence, source_conversation_id=source_conversation_id,
        supersedes_id=old_id,
    )


def upsert_procedural_fact(
    attribute_key: str,
    text: str,
    entity_id: Optional[str] = None,
    vector: Optional[List[float]] = None
) -> Fact:
    """Upsert a procedural fact (dedupe by key)."""
    with get_conn() as conn:
        # Check if exists for this entity
        if entity_id:
            row = conn.execute(
                """SELECT id FROM facts 
                   WHERE category = 'procedural' AND subtype = 'snippet' 
                   AND attribute_key = ? AND entity_id = ?""",
                (attribute_key, entity_id)
            ).fetchone()
        else:
            row = conn.execute(
                """SELECT id FROM facts 
                   WHERE category = 'procedural' AND subtype = 'snippet' 
                   AND attribute_key = ? AND entity_id IS NULL""",
                (attribute_key,)
            ).fetchone()
        
        now = _now_iso()
        
        if row:
            conn.execute(
                """UPDATE facts SET text = ?, vector = ?, created_at = ?, validity = 1
                   WHERE id = ?""",
                (text, _serialize_vector(vector), now, row['id'])
            )
            conn.commit()
            return get_fact(row['id'])  # type: ignore
        else:
            return create_fact(
                category='procedural', subtype='snippet', text=text,
                entity_id=entity_id, attribute_key=attribute_key, vector=vector
            )


def append_fact(
    category: FactCategory,
    subtype: FactSubtype,
    text: str,
    entity_id: Optional[str] = None,
    vector: Optional[List[float]] = None,
    source: str = 'ai_extracted',
    confidence: float = 1.0,
    source_conversation_id: Optional[str] = None,
) -> Fact:
    """Append a new fact (no deduplication)."""
    return create_fact(
        category=category, subtype=subtype, text=text,
        entity_id=entity_id, vector=vector, source=source,
        confidence=confidence, source_conversation_id=source_conversation_id,
    )


def invalidate_fact(fact_id: str) -> bool:
    """Mark a fact as invalid/deprecated."""
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE facts SET validity = 0 WHERE id = ?", (fact_id,)
        )
        conn.commit()
        return cur.rowcount > 0


def delete_fact(fact_id: str) -> bool:
    """Permanently delete a fact."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
        conn.commit()
        return cur.rowcount > 0


# ═══════════════════════════════════════════════════════════════════════════════
# RETRIEVAL - LENS QUERIES
# ═══════════════════════════════════════════════════════════════════════════════

def get_identity_lens() -> List[Fact]:
    """Layer 1: Get all core profile facts (fixed injection)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM facts 
               WHERE category = 'personal' AND subtype = 'core' AND validity = 1
               ORDER BY attribute_key"""
        ).fetchall()
    
    return [_row_to_fact(r) for r in rows]


def get_directive_lens() -> List[Fact]:
    """Layer 2: Get all system instructions (fixed injection)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM facts 
               WHERE category = 'instruction' AND validity = 1
               ORDER BY created_at DESC"""
        ).fetchall()
    
    return [_row_to_fact(r) for r in rows]


def get_entity_context(entity_id: str, limit: int = 15) -> Tuple[Optional[Entity], List[Fact]]:
    """Layer 3: Get entity and its linked facts."""
    entity = get_entity(entity_id)
    if not entity:
        return None, []
    
    # Update last_accessed
    with get_conn() as conn:
        conn.execute(
            "UPDATE entities SET last_accessed = ? WHERE id = ?",
            (_now_iso(), entity_id)
        )
        conn.commit()
    
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM facts 
               WHERE entity_id = ? AND validity = 1
               ORDER BY created_at DESC LIMIT ?""",
            (entity_id, limit)
        ).fetchall()
    
    facts = [_row_to_fact(r) for r in rows]

    return entity, facts


def get_bio_facts(limit: int = 20) -> List[Fact]:
    """Get personal bio facts (preferences, habits, relationships)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM facts 
               WHERE category = 'personal' AND subtype = 'bio' AND validity = 1
               ORDER BY created_at DESC LIMIT ?""",
            (limit,)
        ).fetchall()
    
    return [_row_to_fact(r) for r in rows]


def search_facts_by_vector(
    query_vector: List[float],
    limit: int = 10,
    category: Optional[FactCategory] = None,
    entity_id: Optional[str] = None,
    threshold: float = 0.65,
    include_vectors: bool = False,
) -> List[Tuple[Fact, float]]:
    """Layer 4: Global vector search across facts.

    If include_vectors is True, the returned Fact objects will retain their
    embedding vectors (useful for MMR reranking on the caller side).
    """
    query_np = np.array(query_vector, dtype=np.float32)

    with get_conn() as conn:
        conditions = ["validity = 1", "vector IS NOT NULL", "length(vector) > 0"]
        params: List[Any] = []

        if category:
            conditions.append("category = ?")
            params.append(category)
        if entity_id:
            conditions.append("entity_id = ?")
            params.append(entity_id)

        where = " AND ".join(conditions)
        rows = conn.execute(f"SELECT * FROM facts WHERE {where}", tuple(params)).fetchall()

    results = []
    for row in rows:
        vec = _deserialize_vector(row['vector'])
        if vec:
            vec_np = np.array(vec, dtype=np.float32)
            dot = np.dot(query_np, vec_np)
            norm = np.linalg.norm(query_np) * np.linalg.norm(vec_np)
            score = float(dot / norm) if norm > 0 else 0.0

            if score >= threshold:
                fact = _row_to_fact(row)
                # Keep or strip vectors based on caller need
                if include_vectors:
                    fact.vector = vec
                results.append((fact, score))

    results.sort(key=lambda x: x[1], reverse=True)
    return results[:limit]


def get_procedural_facts(entity_id: Optional[str] = None, limit: int = 20) -> List[Fact]:
    """Get procedural snippets (commands, paths, credentials)."""
    with get_conn() as conn:
        if entity_id:
            rows = conn.execute(
                """SELECT * FROM facts 
                   WHERE category = 'procedural' AND validity = 1 AND entity_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (entity_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM facts 
                   WHERE category = 'procedural' AND validity = 1
                   ORDER BY created_at DESC LIMIT ?""",
                (limit,)
            ).fetchall()
    
    return [_row_to_fact(r) for r in rows]


def get_event_history(limit: int = 50) -> List[Fact]:
    """Get recent event history (time-series logs)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM facts 
               WHERE category = 'event' AND validity = 1
               ORDER BY created_at DESC LIMIT ?""",
            (limit,)
        ).fetchall()
    
    return [_row_to_fact(r) for r in rows]


def get_project_detail_facts(limit: int = 20) -> List[Fact]:
    """Recent project-linked facts."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM facts
               WHERE category = 'project' AND validity = 1
               ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()

    return [_row_to_fact(r) for r in rows]


def get_diverse_context_facts(limit: int = 12) -> List[Dict[str, str]]:
    """Round-robin sample across memory types — avoids only surfacing the newest bio rows."""
    buckets: List[Tuple[str, List[Fact]]] = [
        ("bio", get_bio_facts(limit=8)),
        ("project", get_project_detail_facts(limit=8)),
        ("procedural", get_procedural_facts(limit=8)),
        ("event", get_event_history(limit=8)),
    ]

    seen: set[str] = set()
    out: List[Dict[str, str]] = []
    idx = 0
    exhausted = 0

    while len(out) < limit and exhausted < len(buckets):
        exhausted = 0
        for kind, facts in buckets:
            if idx >= len(facts):
                exhausted += 1
                continue
            text = str(facts[idx].text or "").strip()
            if text:
                dedupe = text.lower()
                if dedupe not in seen:
                    seen.add(dedupe)
                    out.append({"type": kind, "text": text})
                    if len(out) >= limit:
                        break
        idx += 1

    return out


# ═══════════════════════════════════════════════════════════════════════════════
# CONTEXT BUILDER
# ═══════════════════════════════════════════════════════════════════════════════

def build_context_block(
    query_vector: Optional[List[float]] = None,
    detected_entity_name: Optional[str] = None,
    include_identity: bool = True,
    include_directives: bool = True,
    include_bio: bool = False,
    max_global_facts: int = 10
) -> str:
    """
    Build a complete context block for injection into LLM context.
    Returns formatted text with all relevant lenses.
    """
    sections = []
    
    # Layer 1: Identity Lens (always include by default)
    if include_identity:
        identity_facts = get_identity_lens()
        if identity_facts:
            lines = ["[USER IDENTITY]"]
            for f in identity_facts:
                key = f.attribute_key or 'info'
                lines.append(f"{key.replace('_', ' ').title()}: {f.text}")
            sections.append("\n".join(lines))
    
    # Layer 2: Directive Lens (always include by default)
    if include_directives:
        directives = get_directive_lens()
        if directives:
            lines = ["[SYSTEM INSTRUCTIONS]"]
            for f in directives:
                lines.append(f"- {f.text}")
            sections.append("\n".join(lines))
    
    # Layer 3: Active Focus Lens (entity-specific)
    if detected_entity_name:
        entity = find_entity_by_name(detected_entity_name)
        if entity:
            entity_obj, entity_facts = get_entity_context(entity.id)
            if entity_obj:
                lines = [f"[CURRENT CONTEXT: {entity_obj.name}]"]
                if entity_obj.summary:
                    lines.append(f"Summary: {entity_obj.summary}")
                for f in entity_facts:
                    lines.append(f"- {f.text}")
                sections.append("\n".join(lines))
    
    # Include bio facts if requested
    if include_bio:
        bio_facts = get_bio_facts(limit=10)
        if bio_facts:
            lines = ["[ABOUT USER]"]
            for f in bio_facts:
                lines.append(f"- {f.text}")
            sections.append("\n".join(lines))
    
    # Layer 4: Global Vector Search (if query vector provided)
    if query_vector and max_global_facts > 0:
        global_results = search_facts_by_vector(query_vector, limit=max_global_facts)
        # Filter out facts already included via entity context
        if global_results:
            lines = ["[RELEVANT MEMORIES]"]
            for fact, score in global_results:
                lines.append(f"- {fact.text}")
            if len(lines) > 1:  # Only add if we have facts
                sections.append("\n".join(lines))
    
    return "\n\n".join(sections) if sections else ""


# ═══════════════════════════════════════════════════════════════════════════════
# PENDING MEMORIES OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

PENDING_MEMORY_TTL_DAYS = 14
PENDING_MEMORY_MAX = 20


def create_pending_memory(
    original_text: str,
    proposed_action: str,
    proposed_value: str,
    confidence_reason: str,
    proposed_key: Optional[str] = None,
    entity_name: Optional[str] = None
) -> PendingMemory:
    """Create a new pending memory that needs user confirmation."""
    from datetime import timedelta
    pid = str(uuid.uuid4())
    now_dt = datetime.now().astimezone()
    now = now_dt.isoformat()
    expires_at = (now_dt + timedelta(days=PENDING_MEMORY_TTL_DAYS)).isoformat()

    with get_conn() as conn:
        conn.execute(
            """INSERT INTO pending_memories
               (id, original_text, proposed_action, proposed_key, proposed_value,
                confidence_reason, entity_name, created_at, status, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (pid, original_text, proposed_action, proposed_key, proposed_value,
             confidence_reason, entity_name, now, expires_at)
        )
        conn.commit()

    return PendingMemory(
        id=pid, original_text=original_text, proposed_action=proposed_action,
        proposed_key=proposed_key, proposed_value=proposed_value,
        confidence_reason=confidence_reason, entity_name=entity_name,
        created_at=now, status='pending', expires_at=expires_at,
    )


def _row_to_pending(r) -> PendingMemory:
    keys = r.keys() if hasattr(r, 'keys') else []
    return PendingMemory(
        id=r['id'], original_text=r['original_text'],
        proposed_action=r['proposed_action'], proposed_key=r['proposed_key'],
        proposed_value=r['proposed_value'], confidence_reason=r['confidence_reason'],
        entity_name=r['entity_name'], created_at=r['created_at'], status=r['status'],
        expires_at=(r['expires_at'] if 'expires_at' in keys else None),
    )


def get_pending_memories(limit: int = 20) -> List[PendingMemory]:
    """Get all pending memories awaiting confirmation."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM pending_memories
               WHERE status = 'pending'
               ORDER BY created_at DESC LIMIT ?""",
            (limit,)
        ).fetchall()

    return [_row_to_pending(r) for r in rows]


def get_pending_memory(pending_id: str) -> Optional[PendingMemory]:
    """Get a specific pending memory by ID."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM pending_memories WHERE id = ?", (pending_id,)
        ).fetchone()
        if not row:
            return None
        return _row_to_pending(row)


def confirm_pending_memory(pending_id: str) -> bool:
    """Mark a pending memory as confirmed (will be stored to main memory)."""
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE pending_memories SET status = 'confirmed' WHERE id = ? AND status = 'pending'",
            (pending_id,)
        )
        conn.commit()
        return cur.rowcount > 0


def reject_pending_memory(pending_id: str) -> bool:
    """Mark a pending memory as rejected (will not be stored)."""
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE pending_memories SET status = 'rejected' WHERE id = ? AND status = 'pending'",
            (pending_id,)
        )
        conn.commit()
        return cur.rowcount > 0


def delete_pending_memory(pending_id: str) -> bool:
    """Permanently delete a pending memory."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM pending_memories WHERE id = ?", (pending_id,))
        conn.commit()
        return cur.rowcount > 0


def clear_old_pending_memories(days: int = 7) -> int:
    """Clear pending memories older than specified days."""
    from datetime import timedelta
    cutoff = (datetime.now().astimezone() - timedelta(days=days)).isoformat()

    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM pending_memories WHERE created_at < ? AND status = 'pending'",
            (cutoff,)
        )
        conn.commit()
        return cur.rowcount


def supersede_fact(old_id: str, new_id: str) -> bool:
    """B2/B3 primitive: mark `old_id` as superseded by `new_id`.

    Sets the old fact's validity=0 and the new fact's supersedes_id=old_id.
    No-op (returns False) if either fact doesn't exist.
    """
    with get_conn() as conn:
        old_row = conn.execute("SELECT id FROM facts WHERE id = ?", (old_id,)).fetchone()
        new_row = conn.execute("SELECT id FROM facts WHERE id = ?", (new_id,)).fetchone()
        if not old_row or not new_row:
            return False
        conn.execute("UPDATE facts SET validity = 0 WHERE id = ?", (old_id,))
        conn.execute("UPDATE facts SET supersedes_id = ? WHERE id = ?", (old_id, new_id))
        conn.commit()
        return True


def consolidate_facts(
    category: FactCategory,
    subtype: FactSubtype,
    days_back: int = 30,
    threshold: float = 0.92,
) -> Dict[str, int]:
    """B2 stage 1: pairwise vector dedup for facts in the given (category, subtype).

    Considers only `validity=1` rows from the last `days_back` days. For each
    pair with cosine similarity >= threshold, marks the OLDER fact superseded
    by the NEWER one (newer = larger `created_at`). Returns count of pairs
    consolidated. Pure SQL + numpy — no LLM call.

    Skips rows without vectors. Skips pairs where one already supersedes the
    other to avoid touching already-resolved chains.
    """
    from datetime import timedelta
    cutoff = (datetime.now().astimezone() - timedelta(days=days_back)).isoformat()

    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, vector, created_at, supersedes_id FROM facts
               WHERE category = ? AND subtype = ? AND validity = 1
                 AND vector IS NOT NULL AND length(vector) > 0
                 AND created_at >= ?
               ORDER BY created_at DESC""",
            (category, subtype, cutoff)
        ).fetchall()

    if len(rows) < 2:
        return {"consolidated": 0, "scanned": len(rows)}

    # Pre-deserialize all vectors as numpy arrays for fast pairwise cosine.
    items = []
    for r in rows:
        vec = _deserialize_vector(r['vector'])
        if not vec:
            continue
        arr = np.array(vec, dtype=np.float32)
        norm = float(np.linalg.norm(arr))
        if norm == 0:
            continue
        items.append({
            "id": r['id'],
            "created_at": r['created_at'],
            "supersedes_id": r['supersedes_id'],
            "arr": arr,
            "norm": norm,
        })

    # Track which ids are already invalidated this pass so we don't supersede
    # twice in the same run.
    invalidated: set[str] = set()
    pairs_to_supersede: List[Tuple[str, str]] = []  # (old_id, new_id)

    for i in range(len(items)):
        if items[i]['id'] in invalidated:
            continue
        for j in range(i + 1, len(items)):
            if items[j]['id'] in invalidated:
                continue
            a, b = items[i], items[j]
            dot = float(np.dot(a['arr'], b['arr']))
            cos = dot / (a['norm'] * b['norm'])
            if cos < threshold:
                continue
            # Newer wins. Items are sorted DESC, so i (smaller index) is newer.
            new_fact, old_fact = a, b
            pairs_to_supersede.append((old_fact['id'], new_fact['id']))
            invalidated.add(old_fact['id'])

    for old_id, new_id in pairs_to_supersede:
        supersede_fact(old_id, new_id)

    return {"consolidated": len(pairs_to_supersede), "scanned": len(items)}


def expire_and_cap_pending_memories(max_active: int = PENDING_MEMORY_MAX) -> Dict[str, int]:
    """B4: TTL + cap hygiene for pending memories.

    1. Delete rows where `expires_at < now` (status='pending'). Rows created
       before the `expires_at` migration use `created_at + TTL` as the implicit
       expiry.
    2. If more than `max_active` rows remain in 'pending' status, drop oldest
       first until cap is met.

    Returns counts of expired/dropped for logging.
    """
    from datetime import timedelta
    now_dt = datetime.now().astimezone()
    now_iso = now_dt.isoformat()
    legacy_cutoff = (now_dt - timedelta(days=PENDING_MEMORY_TTL_DAYS)).isoformat()

    expired = 0
    dropped = 0
    with get_conn() as conn:
        # Expire by TTL (covers both explicit expires_at and legacy NULL rows)
        cur = conn.execute(
            """DELETE FROM pending_memories
               WHERE status = 'pending'
                 AND (
                   (expires_at IS NOT NULL AND expires_at < ?)
                   OR (expires_at IS NULL AND created_at < ?)
                 )""",
            (now_iso, legacy_cutoff)
        )
        expired = cur.rowcount

        # Cap: keep only the newest `max_active`, drop the rest.
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM pending_memories WHERE status = 'pending'"
        ).fetchone()
        active_count = row['n'] if row else 0
        if active_count > max_active:
            cur = conn.execute(
                """DELETE FROM pending_memories WHERE id IN (
                       SELECT id FROM pending_memories
                       WHERE status = 'pending'
                       ORDER BY created_at ASC
                       LIMIT ?
                   )""",
                (active_count - max_active,)
            )
            dropped = cur.rowcount

        conn.commit()

    return {"expired": expired, "dropped": dropped}


# ═══════════════════════════════════════════════════════════════════════════════
# STATS & UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def get_stats() -> Dict[str, Any]:
    """Get database statistics."""
    with get_conn() as conn:
        entity_count = conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
        fact_count = conn.execute("SELECT COUNT(*) FROM facts WHERE validity = 1").fetchone()[0]
        pending_count = conn.execute("SELECT COUNT(*) FROM pending_memories WHERE status = 'pending'").fetchone()[0]

        # Count by category
        category_counts = {}
        for row in conn.execute(
            "SELECT category, COUNT(*) as cnt FROM facts WHERE validity = 1 GROUP BY category"
        ).fetchall():
            category_counts[row['category']] = row['cnt']

        # Count by entity type
        entity_type_counts = {}
        for row in conn.execute(
            "SELECT type, COUNT(*) as cnt FROM entities GROUP BY type"
        ).fetchall():
            entity_type_counts[row['type']] = row['cnt']

    return {
        "entities": entity_count,
        "facts": fact_count,
        "pending_memories": pending_count,
        "facts_by_category": category_counts,
        "entities_by_type": entity_type_counts,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CROSS-REFERENCING
# ═══════════════════════════════════════════════════════════════════════════════

def get_facts_for_conversation(conversation_id: str, limit: int = 50) -> List[Fact]:
    """Return all facts that were extracted from a given conversation."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM facts
               WHERE source_conversation_id = ? AND validity = 1
               ORDER BY created_at DESC LIMIT ?""",
            (conversation_id, limit)
        ).fetchall()
    return [_row_to_fact(r) for r in rows]


def get_conversations_for_entity(entity_id: str) -> List[str]:
    """Return unique conversation IDs that produced facts for a given entity."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT DISTINCT source_conversation_id FROM facts
               WHERE entity_id = ? AND source_conversation_id IS NOT NULL AND validity = 1""",
            (entity_id,)
        ).fetchall()
    return [r['source_conversation_id'] for r in rows]


# ═══════════════════════════════════════════════════════════════════════════════
# FACT DEDUPLICATION
# ═══════════════════════════════════════════════════════════════════════════════

def deduplicate_facts(similarity_threshold: float = 0.92) -> int:
    """Find and invalidate near-duplicate facts within the same entity/category.

    Returns the number of facts invalidated.
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM facts WHERE validity = 1 AND vector IS NOT NULL AND length(vector) > 0"
        ).fetchall()

    # Group by (entity_id, category)
    groups: Dict[Tuple[Optional[str], str], List] = {}
    for row in rows:
        key = (row['entity_id'], row['category'])
        groups.setdefault(key, []).append(row)

    invalidated = 0
    ids_to_invalidate: List[str] = []

    for _key, group_rows in groups.items():
        if len(group_rows) < 2:
            continue
        vecs = []
        for r in group_rows:
            v = _deserialize_vector(r['vector'])
            vecs.append(np.array(v, dtype=np.float32) if v else None)

        seen_invalid: set = set()
        for i in range(len(group_rows)):
            if vecs[i] is None or group_rows[i]['id'] in seen_invalid:
                continue
            for j in range(i + 1, len(group_rows)):
                if vecs[j] is None or group_rows[j]['id'] in seen_invalid:
                    continue
                dot = float(np.dot(vecs[i], vecs[j]))
                norm = float(np.linalg.norm(vecs[i]) * np.linalg.norm(vecs[j]))
                sim = dot / norm if norm > 0 else 0.0
                if sim >= similarity_threshold:
                    # Keep the newer one (by created_at), invalidate the older
                    older = group_rows[i] if group_rows[i]['created_at'] <= group_rows[j]['created_at'] else group_rows[j]
                    ids_to_invalidate.append(older['id'])
                    seen_invalid.add(older['id'])
                    invalidated += 1

    if ids_to_invalidate:
        with get_conn() as conn:
            for fid in ids_to_invalidate:
                conn.execute("UPDATE facts SET validity = 0 WHERE id = ?", (fid,))
            conn.commit()

    return invalidated


# Initialize on import
try:
    init()
except Exception as e:
    print(f"[knowledge_db] Init error: {e}")
