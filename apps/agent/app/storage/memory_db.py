"""
Encrypted Memory Database for Stuard AI

Local-first storage for:
- Conversations and messages
- Conversation segments (topic tracking with summaries)
- Projects (scoped containers for memories, journal entries, tasks, files)
- Memories (atomic notes/facts/snippets, project-scoped or global)
- Journal entries (per-project timeline)
- Security settings

All data is encrypted at rest using AES-256-GCM.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import sqlite3
import uuid
import numpy as np
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Literal
from dataclasses import dataclass, asdict, field

from .crypto import get_crypto_manager, CryptoManager, EncryptedData

# Get logger for this module
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS & TYPES
# ═══════════════════════════════════════════════════════════════════════════════

VECTOR_DIM = 3072  # text-embedding-3-large

ConversationStatus = Literal['active', 'archived', 'deleted']
MessageRole = Literal['user', 'assistant', 'system', 'tool']
AddedBy = Literal['user', 'ai']
ConversationSource = Literal['stuard', 'workflow', 'skill', 'proactive']
ConversationOwnerType = Literal['stuard', 'bot', 'agent', 'workflow', 'skill']

# Project Mode types. Successor to the retired Spaces feature — legacy
# spaces/space_items rows are backfilled into projects/memories on startup
# (see _migrate_spaces_to_projects).
ProjectStatus = Literal['active', 'paused', 'archived']
MemoryType = Literal['note', 'snippet', 'link', 'fact', 'file', 'image', 'user', 'feedback', 'project', 'reference']
MemorySource = Literal['chat', 'manual', 'tool', 'journal', 'sync', 'notion']
JournalEntryType = Literal['decision', 'finding', 'blocker', 'edit', 'chat_summary', 'task', 'milestone', 'note', 'question', 'hypothesis']
JournalEntrySource = Literal['auto-chat', 'auto-git', 'auto-fs', 'manual', 'ai-tool']


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
_DB_PATH = os.path.abspath(os.path.join(_DATA_DIR, "memory.db"))
os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

ConversationType = Literal['chat', 'subagent']


@dataclass
class Conversation:
    id: str
    title: Optional[str]
    model: Optional[str]
    created_at: str
    updated_at: str
    message_count: int = 0
    status: ConversationStatus = 'active'
    embedding: Optional[List[float]] = None
    sync_id: Optional[str] = None
    synced_at: Optional[str] = None
    needs_sync: bool = False
    parent_id: Optional[str] = None
    type: ConversationType = 'chat'
    source: ConversationSource = 'stuard'
    owner_type: Optional[ConversationOwnerType] = 'stuard'
    owner_id: Optional[str] = None
    project_id: Optional[str] = None  # Project Mode scope (nullable = unscoped)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None  # Don't include in API responses
        return d


@dataclass
class Message:
    id: str
    conversation_id: str
    role: MessageRole
    content: str
    turn_index: int
    created_at: str
    tool_calls: Optional[List[Dict]] = None
    tool_results: Optional[List[Dict]] = None
    attachments: Optional[List[Dict]] = None
    metadata: Optional[Dict[str, Any]] = None
    embedding: Optional[List[float]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None
        return d


@dataclass
class ConversationSegment:
    id: str
    conversation_id: str
    start_turn: int
    end_turn: Optional[int]
    summary: str
    topics: List[str]
    embedding: Optional[List[float]]
    created_at: str
    updated_at: str
    entity_ids: Optional[List[str]] = None  # linked knowledge-graph entity IDs

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None
        return d


@dataclass
class SecuritySettings:
    memory_lock_enabled: bool = False
    vault_lock_enabled: bool = False
    lock_timeout_minutes: int = 5
    password_hash: Optional[str] = None
    biometric_enabled: bool = False
    sync_enabled: bool = False
    sync_salt: Optional[str] = None  # Base64 encoded
    last_sync_at: Optional[str] = None


@dataclass
class Project:
    id: str
    name: str
    description: Optional[str] = None
    goals: Optional[str] = None
    instructions: Optional[str] = None
    status: ProjectStatus = 'active'
    tags: List[str] = field(default_factory=list)
    pinned_paths: List[str] = field(default_factory=list)
    digest: Optional[str] = None
    digest_updated_at: Optional[str] = None
    icon: str = '📁'
    color: str = '#6366f1'
    archived: bool = False
    settings: Optional[Dict[str, Any]] = None  # feature config, e.g. {"notion": {...}}
    embedding: Optional[List[float]] = None
    created_at: str = ''
    updated_at: str = ''

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None
        return d


@dataclass
class Memory:
    """Atomic memory entry — a project-scoped or global note/fact/snippet.

    `project_ids` is a JSON array. Empty list = global (cross-project).
    """
    id: str
    type: MemoryType
    content: str
    title: Optional[str] = None
    project_ids: List[str] = field(default_factory=list)
    metadata: Optional[Dict[str, Any]] = None
    url: Optional[str] = None
    source: MemorySource = 'manual'
    added_by: AddedBy = 'user'
    pinned: bool = False
    embedding: Optional[List[float]] = None
    created_at: str = ''
    updated_at: str = ''

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None
        return d


@dataclass
class JournalEntry:
    """Timestamped event in a project's timeline. Auto-written + manually addable."""
    id: str
    project_id: str
    ts: str
    type: JournalEntryType
    title: str
    body: Optional[str] = None
    source: JournalEntrySource = 'manual'
    source_ref: Optional[Dict[str, Any]] = None  # { conversation_id?, commit_sha?, file_paths?, task_id?, segment_id? }
    embedding: Optional[List[float]] = None
    created_at: str = ''
    updated_at: str = ''

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None
        return d


# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def _serialize_vector(vec: Optional[List[float]]) -> Optional[bytes]:
    """Serialize vector to bytes."""
    if vec is None:
        return None
    # Treat empty vectors as NULL to avoid storing empty BLOBs that cannot be searched.
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
        return np.frombuffer(data, dtype=np.float32).tolist()
    except ValueError:
        return None


def _encrypt_content(content: str, crypto: CryptoManager) -> str:
    """Encrypt content string (or tag as plaintext in plaintext mode)."""
    return crypto.encrypt_string(content)


def _decrypt_content(encrypted: str, crypto: CryptoManager) -> str:
    """Decrypt content string (or strip plaintext tag)."""
    try:
        return crypto.decrypt_string(encrypted)
    except Exception:
        # Legacy ciphertext encrypted with a key we no longer have (e.g. VM
        # restored a desktop-encrypted row before the plaintext migration).
        # Return empty rather than aborting the whole query.
        return ""


def _encrypt_json(data: Any, crypto: CryptoManager) -> Optional[str]:
    """Encrypt JSON-serializable data."""
    if data is None:
        return None
    return crypto.encrypt_string(json.dumps(data))


def _decrypt_json(encrypted: Optional[str], crypto: CryptoManager) -> Optional[Any]:
    """Decrypt JSON data."""
    if encrypted is None:
        return None
    try:
        raw = crypto.decrypt_string(encrypted)
    except Exception:
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE CLASS
# ═══════════════════════════════════════════════════════════════════════════════

class MemoryDB:
    """
    Encrypted memory database manager.
    
    All sensitive content (messages, notes, etc.) is encrypted before storage.
    Embeddings and metadata remain unencrypted for search functionality.
    """
    
    def __init__(self, db_path: Optional[str] = None, user_password: Optional[str] = None):
        self._db_path = db_path or _DB_PATH
        self._crypto = get_crypto_manager(user_password)
        self._init_schema()
    
    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _conversation_scope_clause(
        self,
        alias: str = "c",
        owner_type: Optional[str] = "stuard",
        owner_id: Optional[str] = None,
    ) -> Tuple[str, List[Any]]:
        """Return SQL that keeps segment recall inside one agent/bot memory scope."""
        if owner_type == "any":
            return "", []

        prefix = f"{alias}." if alias else ""
        owner = str(owner_type or "stuard").strip()
        scoped_id = str(owner_id).strip() if owner_id is not None and str(owner_id).strip() else None

        if owner == "stuard":
            clauses = [
                f"({prefix}type = 'chat' OR {prefix}type IS NULL)",
                f"({prefix}owner_type = ? OR ({prefix}owner_type IS NULL AND ({prefix}source = ? OR {prefix}source IS NULL)))",
            ]
            params: List[Any] = ["stuard", "stuard"]
            if scoped_id:
                clauses.append(f"{prefix}owner_id = ?")
                params.append(scoped_id)
            return " AND ".join(clauses), params

        clauses = [f"{prefix}owner_type = ?"]
        params = [owner]
        if scoped_id:
            clauses.append(f"COALESCE({prefix}owner_id, '') = ?")
            params.append(scoped_id)
        return " AND ".join(clauses), params
    
    def _init_schema(self) -> None:
        """Initialize database schema."""
        with self._get_conn() as conn:
            cur = conn.cursor()
            
            # Security settings
            cur.execute("""
                CREATE TABLE IF NOT EXISTS security_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            
            # Conversations
            cur.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title_enc TEXT,
                    model TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    message_count INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
                    embedding BLOB,
                    sync_id TEXT,
                    synced_at TEXT,
                    needs_sync INTEGER DEFAULT 0,
                    parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
                    type TEXT DEFAULT 'chat' CHECK(type IN ('chat', 'subagent')),
                    source TEXT DEFAULT 'stuard' CHECK(source IN ('stuard', 'workflow', 'skill', 'proactive')),
                    owner_type TEXT,
                    owner_id TEXT
                )
            """)
            
            # Migrations: add parent_id and type columns if missing
            try:
                cur.execute("ALTER TABLE conversations ADD COLUMN parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cur.execute("ALTER TABLE conversations ADD COLUMN type TEXT DEFAULT 'chat' CHECK(type IN ('chat', 'subagent'))")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cur.execute("ALTER TABLE conversations ADD COLUMN source TEXT DEFAULT 'stuard'")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cur.execute("UPDATE conversations SET source = 'stuard' WHERE source IS NULL OR TRIM(source) = ''")
            except sqlite3.OperationalError:
                pass
            try:
                cur.execute("ALTER TABLE conversations ADD COLUMN owner_type TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cur.execute("ALTER TABLE conversations ADD COLUMN owner_id TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists

            # B1: track the highest turn index already fed through knowledge
            # extraction so subsequent turns only re-extract incremental content.
            # 0 = never extracted (default for existing rows).
            try:
                cur.execute("ALTER TABLE conversations ADD COLUMN last_extracted_turn_index INTEGER DEFAULT 0")
            except sqlite3.OperationalError:
                pass

            # Messages
            cur.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
                    content_enc TEXT NOT NULL,
                    turn_index INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    tool_calls_enc TEXT,
                    tool_results_enc TEXT,
                    attachments_enc TEXT,
                    metadata_enc TEXT,
                    embedding BLOB
                )
            """)
            
            # Add metadata column to messages table if missing
            try:
                cur.execute("ALTER TABLE messages ADD COLUMN metadata_enc TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            # Conversation segments
            cur.execute("""
                CREATE TABLE IF NOT EXISTS conversation_segments (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    start_turn INTEGER NOT NULL,
                    end_turn INTEGER,
                    summary_enc TEXT NOT NULL,
                    topics_enc TEXT NOT NULL,
                    embedding BLOB,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # Migrations: add entity_ids_enc column to segments if missing
            try:
                cur.execute("ALTER TABLE conversation_segments ADD COLUMN entity_ids_enc TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists

            # Collection summaries — pre-computed topic drawer summaries
            cur.execute("""
                CREATE TABLE IF NOT EXISTS collection_summaries (
                    topic TEXT PRIMARY KEY,
                    summary TEXT NOT NULL,
                    segment_count INTEGER,
                    date_range_start TEXT,
                    date_range_end TEXT,
                    entity_ids TEXT,
                    embedding BLOB,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # Sync queue
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sync_queue (
                    id TEXT PRIMARY KEY,
                    table_name TEXT NOT NULL,
                    record_id TEXT NOT NULL,
                    action TEXT NOT NULL CHECK(action IN ('upsert', 'delete')),
                    created_at TEXT NOT NULL,
                    attempts INTEGER DEFAULT 0,
                    last_attempt TEXT,
                    last_error TEXT
                )
            """)
            
            # ─── Project Mode ───────────────────────────────────────────────────
            # Projects — top-level scope for memories, journal entries, tasks,
            # and pinned files. (Successor to the retired Spaces feature.)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name_enc TEXT NOT NULL,
                    description_enc TEXT,
                    goals_enc TEXT,
                    instructions_enc TEXT,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
                    tags_json TEXT,
                    pinned_paths_json TEXT,
                    digest_enc TEXT,
                    digest_updated_at TEXT,
                    icon TEXT DEFAULT '📁',
                    color TEXT DEFAULT '#6366f1',
                    archived INTEGER DEFAULT 0,
                    settings_json TEXT,
                    embedding BLOB,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            try:
                cur.execute("ALTER TABLE projects ADD COLUMN instructions_enc TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cur.execute("ALTER TABLE projects ADD COLUMN settings_json TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists

            # Memories — atomic facts/notes/snippets/etc with embeddings.
            # `project_ids_json` is a JSON array; empty array = global (cross-project).
            cur.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL CHECK(type IN ('note','snippet','link','fact','file','image','user','feedback','project','reference')),
                    title_enc TEXT,
                    content_enc TEXT NOT NULL,
                    metadata_enc TEXT,
                    url_enc TEXT,
                    project_ids_json TEXT NOT NULL DEFAULT '[]',
                    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('chat','manual','tool','journal','sync','notion')),
                    added_by TEXT NOT NULL DEFAULT 'user' CHECK(added_by IN ('user','ai')),
                    pinned INTEGER DEFAULT 0,
                    embedding BLOB,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # Migration: older memories tables are missing the 'image' type and
            # 'sync'/'notion' sources in their CHECK constraints. SQLite can't
            # alter CHECKs, so recreate the table once when the constraint is stale.
            self._recreate_table_if_check_stale(
                cur,
                table="memories",
                missing_markers=("'image'", "'sync'", "'notion'"),
                create_sql="""
                    CREATE TABLE memories_new (
                        id TEXT PRIMARY KEY,
                        type TEXT NOT NULL CHECK(type IN ('note','snippet','link','fact','file','image','user','feedback','project','reference')),
                        title_enc TEXT,
                        content_enc TEXT NOT NULL,
                        metadata_enc TEXT,
                        url_enc TEXT,
                        project_ids_json TEXT NOT NULL DEFAULT '[]',
                        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('chat','manual','tool','journal','sync','notion')),
                        added_by TEXT NOT NULL DEFAULT 'user' CHECK(added_by IN ('user','ai')),
                        pinned INTEGER DEFAULT 0,
                        embedding BLOB,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """,
                copy_sql="""
                    INSERT INTO memories_new
                    SELECT id, type, title_enc, content_enc, metadata_enc, url_enc,
                           project_ids_json, source, added_by, pinned, embedding,
                           created_at, updated_at
                    FROM memories
                """,
            )

            # Journal entries — timestamped project events. Auto + manual.
            # `updated_at` exists so live auto-journal session entries can be
            # extended in place as a chat topic continues.
            cur.execute("""
                CREATE TABLE IF NOT EXISTS journal_entries (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    ts TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('decision','finding','blocker','edit','chat_summary','task','milestone','note','question','hypothesis')),
                    title_enc TEXT NOT NULL,
                    body_enc TEXT,
                    source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('auto-chat','auto-git','auto-fs','manual','ai-tool')),
                    source_ref_enc TEXT,
                    embedding BLOB,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                )
            """)

            # Migration: older journal tables are missing question/hypothesis in
            # the type CHECK (inserts of those types failed) and updated_at.
            try:
                cur.execute("ALTER TABLE journal_entries ADD COLUMN updated_at TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists
            self._recreate_table_if_check_stale(
                cur,
                table="journal_entries",
                missing_markers=("'question'",),
                create_sql="""
                    CREATE TABLE journal_entries_new (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                        ts TEXT NOT NULL,
                        type TEXT NOT NULL CHECK(type IN ('decision','finding','blocker','edit','chat_summary','task','milestone','note','question','hypothesis')),
                        title_enc TEXT NOT NULL,
                        body_enc TEXT,
                        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('auto-chat','auto-git','auto-fs','manual','ai-tool')),
                        source_ref_enc TEXT,
                        embedding BLOB,
                        created_at TEXT NOT NULL,
                        updated_at TEXT
                    )
                """,
                copy_sql="""
                    INSERT INTO journal_entries_new
                    SELECT id, project_id, ts, type, title_enc, body_enc, source,
                           source_ref_enc, embedding, created_at, updated_at
                    FROM journal_entries
                """,
            )

            # Conversations get a project_id link (nullable = unscoped chat).
            try:
                cur.execute("ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            # One-time backfill: Spaces → Projects, then drop the legacy tables.
            self._migrate_spaces_to_projects(cur)

            # Indexes
            cur.execute("CREATE INDEX IF NOT EXISTS idx_conv_date ON conversations(created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(owner_type, owner_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, turn_index)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_seg_conv ON conversation_segments(conversation_id)")

            # Project Mode indexes
            cur.execute("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, archived)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(pinned, updated_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_journal_project_ts ON journal_entries(project_id, ts DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_journal_type ON journal_entries(project_id, type)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id)")

            conn.commit()

    # ═══════════════════════════════════════════════════════════════════════════
    # SCHEMA MIGRATION HELPERS
    # ═══════════════════════════════════════════════════════════════════════════

    def _recreate_table_if_check_stale(
        self,
        cur: sqlite3.Cursor,
        table: str,
        missing_markers: Tuple[str, ...],
        create_sql: str,
        copy_sql: str,
    ) -> None:
        """Recreate `table` with an updated schema when its stored CREATE TABLE
        SQL is missing any of `missing_markers` (SQLite cannot alter CHECK
        constraints in place). `create_sql` must create `<table>_new`; `copy_sql`
        must copy rows into it."""
        try:
            row = cur.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if not row or not row[0]:
                return
            if all(marker in row[0] for marker in missing_markers):
                return
            logger.info(f"Recreating {table} with updated CHECK constraints")
            cur.execute("PRAGMA foreign_keys=OFF")
            cur.execute(f"DROP TABLE IF EXISTS {table}_new")
            cur.execute(create_sql)
            cur.execute(copy_sql)
            cur.execute(f"DROP TABLE {table}")
            cur.execute(f"ALTER TABLE {table}_new RENAME TO {table}")
            cur.execute("PRAGMA foreign_keys=ON")
            logger.info(f"{table} migration completed successfully")
        except Exception as e:
            logger.error(f"{table} migration failed: {e}")
            try:
                cur.execute("PRAGMA foreign_keys=ON")
            except Exception:
                pass
            raise

    def _migrate_spaces_to_projects(self, cur: sqlite3.Cursor) -> None:
        """One-time backfill from the retired Spaces feature (2026-06).

        Spaces become projects (same id, so conversation links carry over),
        non-folder space items become project-scoped memories, and
        space_conversations become conversations.project_id stamps. Both table
        families share the same CryptoManager, so encrypted columns copy as-is.
        On success the legacy tables are dropped; on failure they are left in
        place and the migration retries on next startup.
        """
        has_spaces = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='spaces'"
        ).fetchone()
        if not has_spaces:
            return
        try:
            space_count = cur.execute("SELECT COUNT(*) FROM spaces").fetchone()[0]

            # Spaces → projects. The old space `type` is preserved as a tag.
            # String concat (not json_array) so we don't depend on the json1
            # extension; type values are a fixed safe set, ids are UUIDs.
            cur.execute("""
                INSERT OR IGNORE INTO projects
                    (id, name_enc, description_enc, goals_enc, instructions_enc, status,
                     tags_json, pinned_paths_json, digest_enc, digest_updated_at,
                     icon, color, archived, settings_json, embedding, created_at, updated_at)
                SELECT id, name_enc, description_enc, NULL, NULL,
                       CASE WHEN COALESCE(archived, 0) = 1 THEN 'archived' ELSE 'active' END,
                       '["' || type || '"]', '[]', NULL, NULL,
                       COALESCE(icon, '📁'), COALESCE(color, '#6366f1'),
                       COALESCE(archived, 0), NULL, embedding, created_at, updated_at
                FROM spaces
            """)

            # Space items → memories (skip structural folders). 'source' items
            # map to the 'reference' memory type; everything else maps 1:1.
            has_items = cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='space_items'"
            ).fetchone()
            if has_items:
                cur.execute("""
                    INSERT OR IGNORE INTO memories
                        (id, type, title_enc, content_enc, metadata_enc, url_enc,
                         project_ids_json, source, added_by, pinned, embedding,
                         created_at, updated_at)
                    SELECT id,
                           CASE type WHEN 'source' THEN 'reference' ELSE type END,
                           title_enc, content_enc, metadata_enc, NULL,
                           '["' || space_id || '"]', 'manual',
                           COALESCE(added_by, 'user'), COALESCE(pinned, 0), embedding,
                           created_at, updated_at
                    FROM space_items
                    WHERE type != 'folder'
                """)

            # Linked conversations keep their scope as a project stamp (best
            # match wins when a conversation was linked to several spaces).
            has_links = cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='space_conversations'"
            ).fetchone()
            if has_links:
                cur.execute("""
                    UPDATE conversations
                    SET project_id = (
                        SELECT sc.space_id FROM space_conversations sc
                        WHERE sc.conversation_id = conversations.id
                        ORDER BY sc.relevance_score DESC LIMIT 1
                    )
                    WHERE project_id IS NULL
                      AND id IN (SELECT conversation_id FROM space_conversations)
                """)

            cur.execute("DELETE FROM sync_queue WHERE table_name IN ('spaces', 'space_items')")
            logger.info(f"Spaces→Projects backfill: migrated {space_count} spaces")
        except Exception:
            logger.exception("Spaces→Projects backfill failed; leaving legacy tables in place")
            return

        for table in ("shared_space_info", "space_conversations", "space_items", "spaces"):
            cur.execute(f"DROP TABLE IF EXISTS {table}")

    # ═══════════════════════════════════════════════════════════════════════════
    # SECURITY SETTINGS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def get_security_settings(self) -> SecuritySettings:
        """Get security settings."""
        with self._get_conn() as conn:
            rows = conn.execute("SELECT key, value FROM security_settings").fetchall()
        
        settings = SecuritySettings()
        for row in rows:
            key, value = row['key'], row['value']
            if key == 'memory_lock_enabled':
                settings.memory_lock_enabled = value == '1'
            elif key == 'vault_lock_enabled':
                settings.vault_lock_enabled = value == '1'
            elif key == 'lock_timeout_minutes':
                settings.lock_timeout_minutes = int(value)
            elif key == 'password_hash':
                settings.password_hash = value
            elif key == 'biometric_enabled':
                settings.biometric_enabled = value == '1'
            elif key == 'sync_enabled':
                settings.sync_enabled = value == '1'
            elif key == 'sync_salt':
                settings.sync_salt = value
            elif key == 'last_sync_at':
                settings.last_sync_at = value
        
        return settings
    
    def update_security_settings(self, **kwargs) -> None:
        """Update security settings."""
        with self._get_conn() as conn:
            for key, value in kwargs.items():
                if value is None:
                    conn.execute("DELETE FROM security_settings WHERE key = ?", (key,))
                else:
                    if isinstance(value, bool):
                        value = '1' if value else '0'
                    conn.execute(
                        "INSERT OR REPLACE INTO security_settings (key, value) VALUES (?, ?)",
                        (key, str(value))
                    )
            conn.commit()
    
    # ═══════════════════════════════════════════════════════════════════════════
    # CONVERSATIONS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def create_conversation(
        self,
        title: Optional[str] = None,
        model: Optional[str] = None,
        conversation_id: Optional[str] = None,
        parent_id: Optional[str] = None,
        conv_type: ConversationType = 'chat',
        source: ConversationSource = 'stuard',
        owner_type: Optional[ConversationOwnerType] = None,
        owner_id: Optional[str] = None
    ) -> Conversation:
        """Create a new conversation or sub-agent."""
        cid = conversation_id or str(uuid.uuid4())
        now = _now_iso()
        resolved_owner_type = owner_type
        if not resolved_owner_type:
            if source in ('workflow', 'skill'):
                resolved_owner_type = source
            elif source == 'proactive':
                resolved_owner_type = 'bot'
            else:
                resolved_owner_type = 'stuard'
        resolved_owner_id = owner_id
        if resolved_owner_type == 'bot' and not resolved_owner_id:
            resolved_owner_id = 'default'
        
        title_enc = _encrypt_content(title, self._crypto) if title else None

        inserted = False

        with self._get_conn() as conn:
            try:
                conn.execute(
                    """INSERT INTO conversations
                       (id, title_enc, model, created_at, updated_at, parent_id, type, source, owner_type, owner_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (cid, title_enc, model, now, now, parent_id, conv_type, source, resolved_owner_type, resolved_owner_id)
                )
                conn.commit()
                inserted = True
            except sqlite3.IntegrityError:
                inserted = False

        if inserted:
            # Don't sync sub-agents to cloud
            if conv_type == 'chat':
                self._queue_sync('conversations', cid, 'upsert')
            return Conversation(
                id=cid, title=title, model=model,
                created_at=now, updated_at=now,
                parent_id=parent_id, type=conv_type, source=source,
                owner_type=resolved_owner_type, owner_id=resolved_owner_id
            )

        existing = self.get_conversation(cid)
        if existing:
            return existing

        raise RuntimeError(f"failed to create or load conversation: {cid}")
    
    def get_conversation(self, conversation_id: str) -> Optional[Conversation]:
        """Get conversation by ID."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
        
        if not row:
            return None
        
        title = _decrypt_content(row['title_enc'], self._crypto) if row['title_enc'] else None
        
        # Handle old rows without parent_id/type columns
        parent_id = row['parent_id'] if 'parent_id' in row.keys() else None
        conv_type = row['type'] if 'type' in row.keys() else 'chat'
        source = row['source'] if 'source' in row.keys() else 'stuard'
        owner_type = row['owner_type'] if 'owner_type' in row.keys() else None
        owner_id = row['owner_id'] if 'owner_id' in row.keys() else None
        project_id = row['project_id'] if 'project_id' in row.keys() else None

        return Conversation(
            id=row['id'],
            title=title,
            model=row['model'],
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            message_count=row['message_count'],
            status=row['status'],
            embedding=_deserialize_vector(row['embedding']),
            sync_id=row['sync_id'],
            synced_at=row['synced_at'],
            needs_sync=bool(row['needs_sync']),
            parent_id=parent_id,
            type=conv_type or 'chat',
            source=source or 'stuard',
            owner_type=owner_type,
            owner_id=owner_id,
            project_id=project_id
        )
    
    def list_conversations(
        self,
        status: Optional[ConversationStatus] = 'active',
        limit: int = 50,
        offset: int = 0,
        conv_type: Optional[ConversationType] = None,
        source: Optional[ConversationSource] = None,
        owner_type: Optional[str] = None,
        owner_id: Optional[str] = None
    ) -> List[Conversation]:
        """List conversations. By default excludes sub-agents unless conv_type specified."""
        with self._get_conn() as conn:
            conditions = []
            params: List[Any] = []
            
            if status:
                conditions.append("status = ?")
                params.append(status)
            
            # By default only return chat conversations (exclude sub-agents)
            if conv_type:
                conditions.append("type = ?")
                params.append(conv_type)
            else:
                conditions.append("(type = 'chat' OR type IS NULL)")
            
            if source:
                conditions.append("source = ?")
                params.append(source)

            if owner_type:
                conditions.append("owner_type = ?")
                params.append(owner_type)
                if owner_id:
                    conditions.append("owner_id = ?")
                    params.append(owner_id)
            
            where_clause = " AND ".join(conditions) if conditions else "1=1"
            params.extend([limit, offset])
            
            rows = conn.execute(
                f"""SELECT * FROM conversations WHERE {where_clause}
                   ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
                tuple(params)
            ).fetchall()
        
        result = []
        for row in rows:
            title = _decrypt_content(row['title_enc'], self._crypto) if row['title_enc'] else None
            parent_id = row['parent_id'] if 'parent_id' in row.keys() else None
            row_type = row['type'] if 'type' in row.keys() else 'chat'
            row_source = row['source'] if 'source' in row.keys() else 'stuard'
            row_owner_type = row['owner_type'] if 'owner_type' in row.keys() else None
            row_owner_id = row['owner_id'] if 'owner_id' in row.keys() else None
            row_project_id = row['project_id'] if 'project_id' in row.keys() else None
            result.append(Conversation(
                id=row['id'],
                title=title,
                model=row['model'],
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                message_count=row['message_count'],
                status=row['status'],
                embedding=None,  # Don't load embeddings for list
                sync_id=row['sync_id'],
                synced_at=row['synced_at'],
                needs_sync=bool(row['needs_sync']),
                parent_id=parent_id,
                type=row_type or 'chat',
                source=row_source or 'stuard',
                owner_type=row_owner_type,
                owner_id=row_owner_id,
                project_id=row_project_id
            ))
        
        return result
    
    def update_conversation(
        self,
        conversation_id: str,
        title: Optional[str] = None,
        status: Optional[ConversationStatus] = None,
        embedding: Optional[List[float]] = None,
        source: Optional[ConversationSource] = None,
        owner_type: Optional[ConversationOwnerType] = None,
        owner_id: Optional[str] = None
    ) -> Optional[Conversation]:
        """Update conversation.

        Upserts: if the conversation row doesn't exist yet, create a shell first.
        For a brand-new chat the generated title is PATCHed almost immediately and
        can race ahead of the conversation insert — without this, that early update
        matches 0 rows, returns not_found (HTTP 400), and the title (which lives only
        in this local DB, not Supabase) is silently lost. Mirrors create_conversation's
        idempotent style.
        """
        if self.get_conversation(conversation_id) is None:
            self.create_conversation(
                conversation_id=conversation_id,
                title=title,
                source=source or 'stuard',
                owner_type=owner_type,
                owner_id=owner_id,
            )

        updates = ["updated_at = ?"]
        values: List[Any] = [_now_iso()]

        if title is not None:
            updates.append("title_enc = ?")
            values.append(_encrypt_content(title, self._crypto))
        if status is not None:
            updates.append("status = ?")
            values.append(status)
        if embedding is not None:
            updates.append("embedding = ?")
            values.append(_serialize_vector(embedding))
        if source is not None:
            updates.append("source = ?")
            values.append(source)
        if owner_type is not None:
            updates.append("owner_type = ?")
            values.append(owner_type)
        if owner_id is not None:
            updates.append("owner_id = ?")
            values.append(owner_id if owner_id != '' else None)
        
        updates.append("needs_sync = 1")
        values.append(conversation_id)
        
        with self._get_conn() as conn:
            conn.execute(
                f"UPDATE conversations SET {', '.join(updates)} WHERE id = ?",
                tuple(values)
            )
            conn.commit()
        
        self._queue_sync('conversations', conversation_id, 'upsert')
        return self.get_conversation(conversation_id)

    def delete_conversation(self, conversation_id: str) -> bool:
        """Hard delete a conversation and all its messages."""
        with self._get_conn() as conn:
            cur = conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
            conn.commit()
            deleted = cur.rowcount > 0

        if deleted:
            self._queue_sync('conversations', conversation_id, 'delete')

        return deleted

    def get_extraction_offset(self, conversation_id: str) -> int:
        """B1: highest turn index already fed through knowledge extraction.

        Returns 0 when the conversation has never been extracted (or doesn't
        exist) so callers can treat it as "start from the beginning".
        """
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT last_extracted_turn_index FROM conversations WHERE id = ?",
                (conversation_id,)
            ).fetchone()
        if not row:
            return 0
        value = row['last_extracted_turn_index']
        try:
            return max(0, int(value or 0))
        except (TypeError, ValueError):
            return 0

    def set_extraction_offset(self, conversation_id: str, turn_index: int) -> bool:
        """B1: advance the per-conversation extraction watermark. Never moves
        backwards — passing a lower value is a no-op."""
        idx = max(0, int(turn_index or 0))
        with self._get_conn() as conn:
            cur = conn.execute(
                """UPDATE conversations
                   SET last_extracted_turn_index = ?
                   WHERE id = ? AND COALESCE(last_extracted_turn_index, 0) < ?""",
                (idx, conversation_id, idx)
            )
            conn.commit()
            return cur.rowcount > 0

    def search_conversations(
        self,
        query_vector: List[float],
        limit: int = 10,
        status: Optional[ConversationStatus] = 'active',
        threshold: float = 0.6
    ) -> List[Tuple[Conversation, float]]:
        """Search conversations by embedding similarity."""
        query_np = np.array(query_vector, dtype=np.float32)
        
        with self._get_conn() as conn:
            if status:
                rows = conn.execute(
                    "SELECT * FROM conversations WHERE status = ? AND embedding IS NOT NULL",
                    (status,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM conversations WHERE embedding IS NOT NULL"
                ).fetchall()
        
        results = []
        for row in rows:
            vec = _deserialize_vector(row['embedding'])
            if vec:
                if len(vec) != len(query_vector):
                    continue
                vec_np = np.array(vec, dtype=np.float32)
                dot = np.dot(query_np, vec_np)
                norm = np.linalg.norm(query_np) * np.linalg.norm(vec_np)
                score = float(dot / norm) if norm > 0 else 0.0
                
                if score >= threshold:
                    title = _decrypt_content(row['title_enc'], self._crypto) if row['title_enc'] else None
                    conv = Conversation(
                        id=row['id'],
                        title=title,
                        model=row['model'],
                        created_at=row['created_at'],
                        updated_at=row['updated_at'],
                        message_count=row['message_count'],
                        status=row['status']
                    )
                    results.append((conv, score))
        
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:limit]
    
    def search_segments(
        self,
        query_vector: List[float],
        limit: int = 10,
        threshold: float = 0.6,
        project_id: Optional[str] = None,
        owner_type: Optional[str] = "stuard",
        owner_id: Optional[str] = None,
    ) -> List[Tuple[ConversationSegment, float]]:
        """Search conversation segments by embedding similarity.

        When `project_id` is provided, results are constrained to segments whose
        conversation is stamped with that project_id (project-scoped search).
        """
        query_np = np.array(query_vector, dtype=np.float32)

        with self._get_conn() as conn:
            scope_clause, scope_params = self._conversation_scope_clause("c", owner_type, owner_id)
            where = ["cs.embedding IS NOT NULL"]
            params: List[Any] = []
            if project_id:
                where.append("c.project_id = ?")
                params.append(project_id)
            if scope_clause:
                where.append(scope_clause)
                params.extend(scope_params)
            where_sql = " AND ".join(where)
            rows = conn.execute(
                f"""SELECT cs.* FROM conversation_segments cs
                   JOIN conversations c ON cs.conversation_id = c.id
                   WHERE {where_sql}""",
                tuple(params),
            ).fetchall()
        
        results = []
        for row in rows:
            vec = _deserialize_vector(row['embedding'])
            if vec:
                if len(vec) != len(query_vector):
                    continue
                vec_np = np.array(vec, dtype=np.float32)
                dot = np.dot(query_np, vec_np)
                norm = np.linalg.norm(query_np) * np.linalg.norm(vec_np)
                score = float(dot / norm) if norm > 0 else 0.0
                
                if score >= threshold:
                    seg = ConversationSegment(
                        id=row['id'],
                        conversation_id=row['conversation_id'],
                        start_turn=row['start_turn'],
                        end_turn=row['end_turn'],
                        summary=_decrypt_content(row['summary_enc'], self._crypto),
                        topics=_decrypt_json(row['topics_enc'], self._crypto),
                        embedding=None,
                        created_at=row['created_at'],
                        updated_at=row['updated_at']
                    )
                    results.append((seg, score))
        
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:limit]
    
    # ═══════════════════════════════════════════════════════════════════════════
    # MESSAGES
    # ═══════════════════════════════════════════════════════════════════════════
    
    def add_message(
        self,
        conversation_id: str,
        role: MessageRole,
        content: str,
        tool_calls: Optional[List[Dict]] = None,
        tool_results: Optional[List[Dict]] = None,
        attachments: Optional[List[Dict]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None
    ) -> Message:
        """Add a message to a conversation."""
        mid = str(uuid.uuid4())
        now = _now_iso()
        
        # Get next turn index
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(turn_index), -1) + 1 as next_turn FROM messages WHERE conversation_id = ?",
                (conversation_id,)
            ).fetchone()
            turn_index = row['next_turn']
            
            conn.execute(
                """INSERT INTO messages 
                   (id, conversation_id, role, content_enc, turn_index, created_at, 
                    tool_calls_enc, tool_results_enc, attachments_enc, metadata_enc, embedding)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    mid, conversation_id, role,
                    _encrypt_content(content, self._crypto),
                    turn_index, now,
                    _encrypt_json(tool_calls, self._crypto),
                    _encrypt_json(tool_results, self._crypto),
                    _encrypt_json(attachments, self._crypto),
                    _encrypt_json(metadata, self._crypto),
                    _serialize_vector(embedding)
                )
            )
            
            # Update conversation
            conn.execute(
                """UPDATE conversations 
                   SET message_count = message_count + 1, updated_at = ?, needs_sync = 1
                   WHERE id = ?""",
                (now, conversation_id)
            )
            conn.commit()
        
        self._queue_sync('conversations', conversation_id, 'upsert')
        
        return Message(
            id=mid,
            conversation_id=conversation_id,
            role=role,
            content=content,
            turn_index=turn_index,
            created_at=now,
            tool_calls=tool_calls,
            tool_results=tool_results,
            attachments=attachments,
            metadata=metadata,
            embedding=embedding
        )
    
    def get_messages(
        self,
        conversation_id: str,
        start_turn: Optional[int] = None,
        end_turn: Optional[int] = None,
        limit: Optional[int] = None
    ) -> List[Message]:
        """Get messages from a conversation."""
        with self._get_conn() as conn:
            query = "SELECT * FROM messages WHERE conversation_id = ?"
            params: List[Any] = [conversation_id]
            
            if start_turn is not None:
                query += " AND turn_index >= ?"
                params.append(start_turn)
            if end_turn is not None:
                query += " AND turn_index <= ?"
                params.append(end_turn)
            
            query += " ORDER BY turn_index ASC"
            
            if limit:
                query += " LIMIT ?"
                params.append(limit)
            
            rows = conn.execute(query, tuple(params)).fetchall()
        
        result = []
        for row in rows:
            result.append(Message(
                id=row['id'],
                conversation_id=row['conversation_id'],
                role=row['role'],
                content=_decrypt_content(row['content_enc'], self._crypto),
                turn_index=row['turn_index'],
                created_at=row['created_at'],
                tool_calls=_decrypt_json(row['tool_calls_enc'], self._crypto),
                tool_results=_decrypt_json(row['tool_results_enc'], self._crypto),
                attachments=_decrypt_json(row['attachments_enc'], self._crypto),
                metadata=_decrypt_json(row['metadata_enc'], self._crypto) if 'metadata_enc' in row.keys() else None,
                embedding=None  # Don't load embeddings by default
            ))
        
        return result

    def get_first_user_message_text(self, conversation_id: str) -> Optional[str]:
        """Return the plaintext of the earliest user message, if any."""
        with self._get_conn() as conn:
            row = conn.execute(
                """
                SELECT content_enc FROM messages
                WHERE conversation_id = ? AND role = 'user'
                ORDER BY turn_index ASC, created_at ASC
                LIMIT 1
                """,
                (conversation_id,),
            ).fetchone()
        if not row or not row['content_enc']:
            return None
        return _decrypt_content(row['content_enc'], self._crypto)
    
    # ═══════════════════════════════════════════════════════════════════════════
    # CONVERSATION SEGMENTS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def create_segment(
        self,
        conversation_id: str,
        start_turn: int,
        summary: str,
        topics: List[str],
        embedding: Optional[List[float]] = None,
        end_turn: Optional[int] = None
    ) -> ConversationSegment:
        """Create a conversation segment."""
        sid = str(uuid.uuid4())
        now = _now_iso()
        
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO conversation_segments
                   (id, conversation_id, start_turn, end_turn, summary_enc, topics_enc, embedding, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    sid, conversation_id, start_turn, end_turn,
                    _encrypt_content(summary, self._crypto),
                    _encrypt_json(topics, self._crypto),
                    _serialize_vector(embedding),
                    now, now
                )
            )
            conn.commit()
        
        return ConversationSegment(
            id=sid,
            conversation_id=conversation_id,
            start_turn=start_turn,
            end_turn=end_turn,
            summary=summary,
            topics=topics,
            embedding=embedding,
            created_at=now,
            updated_at=now
        )
    
    def update_segment(
        self,
        segment_id: str,
        summary: Optional[str] = None,
        topics: Optional[List[str]] = None,
        end_turn: Optional[int] = None,
        embedding: Optional[List[float]] = None
    ) -> Optional[ConversationSegment]:
        """Update a segment."""
        updates = ["updated_at = ?"]
        values: List[Any] = [_now_iso()]
        
        if summary is not None:
            updates.append("summary_enc = ?")
            values.append(_encrypt_content(summary, self._crypto))
        if topics is not None:
            updates.append("topics_enc = ?")
            values.append(_encrypt_json(topics, self._crypto))
        if end_turn is not None:
            updates.append("end_turn = ?")
            values.append(end_turn)
        if embedding is not None:
            updates.append("embedding = ?")
            values.append(_serialize_vector(embedding))
        
        values.append(segment_id)
        
        with self._get_conn() as conn:
            conn.execute(
                f"UPDATE conversation_segments SET {', '.join(updates)} WHERE id = ?",
                tuple(values)
            )
            conn.commit()
        
        return self.get_segment(segment_id)
    
    def get_segment(self, segment_id: str) -> Optional[ConversationSegment]:
        """Get segment by ID."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM conversation_segments WHERE id = ?", (segment_id,)
            ).fetchone()
        
        if not row:
            return None
        
        return ConversationSegment(
            id=row['id'],
            conversation_id=row['conversation_id'],
            start_turn=row['start_turn'],
            end_turn=row['end_turn'],
            summary=_decrypt_content(row['summary_enc'], self._crypto),
            topics=_decrypt_json(row['topics_enc'], self._crypto),
            embedding=_deserialize_vector(row['embedding']),
            created_at=row['created_at'],
            updated_at=row['updated_at']
        )
    
    def get_conversation_segments(self, conversation_id: str) -> List[ConversationSegment]:
        """Get all segments for a conversation."""
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM conversation_segments WHERE conversation_id = ? ORDER BY start_turn",
                (conversation_id,)
            ).fetchall()
        
        return [
            ConversationSegment(
                id=row['id'],
                conversation_id=row['conversation_id'],
                start_turn=row['start_turn'],
                end_turn=row['end_turn'],
                summary=_decrypt_content(row['summary_enc'], self._crypto),
                topics=_decrypt_json(row['topics_enc'], self._crypto),
                embedding=_deserialize_vector(row['embedding']),
                created_at=row['created_at'],
                updated_at=row['updated_at']
            )
            for row in rows
        ]

    def list_recent_segments(
        self,
        limit: int = 10,
        since: Optional[str] = None,
        before: Optional[str] = None,
        owner_type: Optional[str] = "stuard",
        owner_id: Optional[str] = None,
    ) -> List[ConversationSegment]:
        limit = max(1, min(int(limit), 200))

        def _parse_iso_ts(v: Optional[str]) -> Optional[float]:
            if not v:
                return None
            try:
                s = str(v).strip()
                if not s:
                    return None
                if s.endswith('Z'):
                    s = s[:-1] + '+00:00'
                return datetime.fromisoformat(s).timestamp()
            except Exception:
                return None

        since_ts = _parse_iso_ts(since)
        before_ts = _parse_iso_ts(before)

        with self._get_conn() as conn:
            scope_clause, scope_params = self._conversation_scope_clause("c", owner_type, owner_id)
            where_sql = f"WHERE {scope_clause}" if scope_clause else ""
            if since_ts is None and before_ts is None:
                rows = conn.execute(
                    f"""SELECT cs.* FROM conversation_segments cs
                       JOIN conversations c ON cs.conversation_id = c.id
                       {where_sql}
                       ORDER BY cs.created_at DESC LIMIT ?""",
                    tuple(scope_params + [limit]),
                ).fetchall()
            else:
                rows = conn.execute(
                    f"""SELECT cs.* FROM conversation_segments cs
                       JOIN conversations c ON cs.conversation_id = c.id
                       {where_sql}
                       ORDER BY cs.created_at DESC""",
                    tuple(scope_params),
                ).fetchall()

        filtered: List[Tuple[float, ConversationSegment]] = []
        for row in rows:
            created_ts = _parse_iso_ts(row['created_at'])
            if created_ts is not None:
                if since_ts is not None and created_ts < since_ts:
                    continue
                if before_ts is not None and created_ts > before_ts:
                    continue
            seg = ConversationSegment(
                id=row['id'],
                conversation_id=row['conversation_id'],
                start_turn=row['start_turn'],
                end_turn=row['end_turn'],
                summary=_decrypt_content(row['summary_enc'], self._crypto),
                topics=_decrypt_json(row['topics_enc'], self._crypto),
                embedding=None,
                created_at=row['created_at'],
                updated_at=row['updated_at'],
            )
            filtered.append((created_ts if created_ts is not None else float('-inf'), seg))

        if since_ts is not None or before_ts is not None:
            filtered.sort(key=lambda x: x[0], reverse=True)

        return [seg for _, seg in filtered[:limit]]

    def list_recent_segments_with_embeddings(
        self,
        limit: int = 500,
        since: Optional[str] = None,
        before: Optional[str] = None,
        owner_type: Optional[str] = "stuard",
        owner_id: Optional[str] = None,
    ) -> List[ConversationSegment]:
        limit = max(1, min(int(limit), 5000))

        def _parse_iso_ts(v: Optional[str]) -> Optional[float]:
            if not v:
                return None
            try:
                s = str(v).strip()
                if not s:
                    return None
                if s.endswith('Z'):
                    s = s[:-1] + '+00:00'
                return datetime.fromisoformat(s).timestamp()
            except Exception:
                return None

        since_ts = _parse_iso_ts(since)
        before_ts = _parse_iso_ts(before)

        with self._get_conn() as conn:
            scope_clause, scope_params = self._conversation_scope_clause("c", owner_type, owner_id)
            where_sql = f"WHERE {scope_clause}" if scope_clause else ""
            rows = conn.execute(
                f"""SELECT cs.* FROM conversation_segments cs
                   JOIN conversations c ON cs.conversation_id = c.id
                   {where_sql}
                   ORDER BY cs.created_at DESC LIMIT ?""",
                tuple(scope_params + [limit]),
            ).fetchall()

        filtered: List[Tuple[float, ConversationSegment]] = []
        for row in rows:
            created_ts = _parse_iso_ts(row['created_at'])
            if created_ts is not None:
                if since_ts is not None and created_ts < since_ts:
                    continue
                if before_ts is not None and created_ts > before_ts:
                    continue
            # Parse entity_ids from JSON column if present
            _eid_raw = row['entity_ids_enc'] if 'entity_ids_enc' in (row.keys() if hasattr(row, 'keys') else []) else None
            _entity_ids = None
            if _eid_raw:
                try:
                    _entity_ids = json.loads(_eid_raw) if isinstance(_eid_raw, str) else None
                except Exception:
                    _entity_ids = None

            seg = ConversationSegment(
                id=row['id'],
                conversation_id=row['conversation_id'],
                start_turn=row['start_turn'],
                end_turn=row['end_turn'],
                summary=_decrypt_content(row['summary_enc'], self._crypto),
                topics=_decrypt_json(row['topics_enc'], self._crypto),
                embedding=_deserialize_vector(row['embedding']),
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                entity_ids=_entity_ids,
            )
            filtered.append((created_ts if created_ts is not None else float('-inf'), seg))

        filtered.sort(key=lambda x: x[0], reverse=True)
        return [seg for _, seg in filtered[:limit]]

    def build_topic_drawers(
        self,
        query: Optional[str] = None,
        limit_topics: int = 50,
        limit_segments_per_topic: int = 200,
        cluster_threshold: float = 0.82,
        max_clusters_per_topic: int = 12,
        segments_scan_limit: int = 2000,
        owner_type: Optional[str] = "stuard",
        owner_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        q = str(query or '').strip().lower()
        limit_topics = max(1, min(int(limit_topics), 200))
        limit_segments_per_topic = max(1, min(int(limit_segments_per_topic), 1000))
        max_clusters_per_topic = max(1, min(int(max_clusters_per_topic), 50))
        segments_scan_limit = max(50, min(int(segments_scan_limit), 10000))
        try:
            cluster_threshold = float(cluster_threshold)
        except Exception:
            cluster_threshold = 0.82
        cluster_threshold = max(0.0, min(cluster_threshold, 0.999))

        segments = self.list_recent_segments_with_embeddings(
            limit=segments_scan_limit,
            owner_type=owner_type,
            owner_id=owner_id,
        )

        def _cosine(a: List[float], b: List[float]) -> float:
            try:
                av = np.array(a, dtype=np.float32)
                bv = np.array(b, dtype=np.float32)
                denom = float(np.linalg.norm(av) * np.linalg.norm(bv))
                if denom <= 0:
                    return 0.0
                return float(np.dot(av, bv) / denom)
            except Exception:
                return 0.0

        def _make_cluster_title(text: str) -> str:
            s = str(text or '').strip()
            if not s:
                return 'Untitled'
            s = re.sub(r'\s+', ' ', s)
            return s[:80]

        def _cluster_segments(segs: List[ConversationSegment]) -> List[Dict[str, Any]]:
            clusters: List[Dict[str, Any]] = []
            unclustered: List[ConversationSegment] = []

            for seg in segs:
                if not seg.embedding or not isinstance(seg.embedding, list) or len(seg.embedding) == 0:
                    unclustered.append(seg)
                    continue

                best_idx = -1
                best_score = -1.0
                for i, c in enumerate(clusters):
                    centroid = c.get('centroid')
                    if not centroid:
                        continue
                    score = _cosine(seg.embedding, centroid)
                    if score > best_score:
                        best_score = score
                        best_idx = i

                if best_idx >= 0 and best_score >= cluster_threshold:
                    c = clusters[best_idx]
                    c['items'].append(seg)
                    n = float(c.get('count', 1))
                    try:
                        centroid_np = np.array(c['centroid'], dtype=np.float32)
                        seg_np = np.array(seg.embedding, dtype=np.float32)
                        new_centroid = (centroid_np * n + seg_np) / (n + 1.0)
                        c['centroid'] = new_centroid.tolist()
                    except Exception:
                        pass
                    c['count'] = int(c.get('count', 1)) + 1
                else:
                    if len(clusters) >= max_clusters_per_topic:
                        unclustered.append(seg)
                        continue
                    clusters.append({
                        'cluster_id': str(uuid.uuid4()),
                        'title': _make_cluster_title(seg.summary),
                        'centroid': seg.embedding,
                        'count': 1,
                        'items': [seg],
                    })

            out: List[Dict[str, Any]] = []
            for c in clusters:
                items = c.get('items') or []
                out.append({
                    'id': c.get('cluster_id'),
                    'title': c.get('title') or 'Cluster',
                    'count': int(c.get('count') or len(items)),
                    'segments': [
                        {
                            'id': s.id,
                            'conversation_id': s.conversation_id,
                            'start_turn': s.start_turn,
                            'end_turn': s.end_turn,
                            'summary': s.summary,
                            'topics': s.topics,
                            'created_at': s.created_at,
                            'updated_at': s.updated_at,
                        }
                        for s in items
                    ],
                })

            if unclustered:
                out.append({
                    'id': 'unclustered',
                    'title': 'Unsorted',
                    'count': len(unclustered),
                    'segments': [
                        {
                            'id': s.id,
                            'conversation_id': s.conversation_id,
                            'start_turn': s.start_turn,
                            'end_turn': s.end_turn,
                            'summary': s.summary,
                            'topics': s.topics,
                            'created_at': s.created_at,
                            'updated_at': s.updated_at,
                        }
                        for s in unclustered
                    ],
                })

            return out

        topic_map: Dict[str, List[ConversationSegment]] = {}
        topic_latest_ts: Dict[str, float] = {}

        for seg in segments:
            summary_l = str(seg.summary or '').lower()
            seg_topics = seg.topics if isinstance(seg.topics, list) else []
            try:
                ts = datetime.fromisoformat(str(seg.created_at).replace('Z', '+00:00')).timestamp()
            except Exception:
                ts = 0.0

            for topic in seg_topics:
                t = str(topic or '').strip()
                if not t:
                    continue

                if q:
                    if q not in t.lower() and q not in summary_l:
                        continue

                topic_map.setdefault(t, []).append(seg)
                topic_latest_ts[t] = max(topic_latest_ts.get(t, 0.0), ts)

        ordered_topics = sorted(topic_map.keys(), key=lambda t: topic_latest_ts.get(t, 0.0), reverse=True)
        ordered_topics = ordered_topics[:limit_topics]

        drawers: List[Dict[str, Any]] = []
        for topic in ordered_topics:
            segs = topic_map.get(topic, [])
            segs_sorted = sorted(segs, key=lambda s: str(s.created_at or ''), reverse=True)
            segs_sorted = segs_sorted[:limit_segments_per_topic]
            clusters = _cluster_segments(segs_sorted)

            drawers.append({
                'topic': topic,
                'count': len(segs_sorted),
                'clusters': clusters,
                'latest_at': segs_sorted[0].created_at if segs_sorted else None,
            })

        return drawers

    # ═══════════════════════════════════════════════════════════════════════════
    # COLLECTION SUMMARIES
    # ═══════════════════════════════════════════════════════════════════════════

    def upsert_collection_summary(
        self,
        topic: str,
        summary: str,
        segment_count: int = 0,
        date_range_start: Optional[str] = None,
        date_range_end: Optional[str] = None,
        entity_ids: Optional[List[str]] = None,
        embedding: Optional[List[float]] = None,
    ) -> Dict[str, Any]:
        """Insert or update a pre-computed collection summary for a topic."""
        now = datetime.now().astimezone().isoformat()
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO collection_summaries
                   (topic, summary, segment_count, date_range_start, date_range_end,
                    entity_ids, embedding, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(topic) DO UPDATE SET
                    summary = excluded.summary,
                    segment_count = excluded.segment_count,
                    date_range_start = excluded.date_range_start,
                    date_range_end = excluded.date_range_end,
                    entity_ids = excluded.entity_ids,
                    embedding = excluded.embedding,
                    updated_at = excluded.updated_at""",
                (
                    topic, summary, segment_count, date_range_start, date_range_end,
                    json.dumps(entity_ids) if entity_ids else None,
                    _serialize_vector(embedding),
                    now, now,
                ),
            )
            conn.commit()
        return {"topic": topic, "summary": summary, "segment_count": segment_count}

    def get_collection_summary(self, topic: str) -> Optional[Dict[str, Any]]:
        """Get a pre-computed collection summary by topic name."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM collection_summaries WHERE topic = ?", (topic,)
            ).fetchone()
        if not row:
            return None
        return {
            "topic": row["topic"],
            "summary": row["summary"],
            "segment_count": row["segment_count"],
            "date_range_start": row["date_range_start"],
            "date_range_end": row["date_range_end"],
            "entity_ids": json.loads(row["entity_ids"]) if row["entity_ids"] else [],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def search_collection_summaries_by_vector(
        self,
        query_vector: List[float],
        limit: int = 5,
        threshold: float = 0.6,
    ) -> List[Dict[str, Any]]:
        """Search collection summaries by embedding similarity."""
        query_np = np.array(query_vector, dtype=np.float32)
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM collection_summaries WHERE embedding IS NOT NULL"
            ).fetchall()

        results: List[Tuple[float, Dict[str, Any]]] = []
        for row in rows:
            vec = _deserialize_vector(row["embedding"])
            if not vec:
                continue
            vec_np = np.array(vec, dtype=np.float32)
            norm = float(np.linalg.norm(query_np) * np.linalg.norm(vec_np))
            score = float(np.dot(query_np, vec_np) / norm) if norm > 0 else 0.0
            if score >= threshold:
                results.append((score, {
                    "topic": row["topic"],
                    "summary": row["summary"],
                    "segment_count": row["segment_count"],
                    "date_range_start": row["date_range_start"],
                    "date_range_end": row["date_range_end"],
                    "score": round(score, 4),
                }))

        results.sort(key=lambda x: x[0], reverse=True)
        return [r for _, r in results[:limit]]

    def list_collection_summaries(self, limit: int = 100) -> List[Dict[str, Any]]:
        """List all collection summaries ordered by recency."""
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM collection_summaries ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "topic": row["topic"],
                "summary": row["summary"],
                "segment_count": row["segment_count"],
                "date_range_start": row["date_range_start"],
                "date_range_end": row["date_range_end"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]

    # ═══════════════════════════════════════════════════════════════════════════
    # SYNC QUEUE
    # ═══════════════════════════════════════════════════════════════════════════
    
    def _queue_sync(self, table_name: str, record_id: str, action: str) -> None:
        """Add item to sync queue."""
        settings = self.get_security_settings()
        if not settings.sync_enabled:
            return
        
        qid = str(uuid.uuid4())
        now = _now_iso()
        
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO sync_queue (id, table_name, record_id, action, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (qid, table_name, record_id, action, now)
            )
            conn.commit()
    
    def get_pending_sync(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get pending sync items."""
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT * FROM sync_queue 
                   WHERE attempts < 3
                   ORDER BY created_at ASC LIMIT ?""",
                (limit,)
            ).fetchall()
        
        return [dict(row) for row in rows]
    
    def mark_synced(self, queue_id: str) -> None:
        """Remove item from sync queue after successful sync."""
        with self._get_conn() as conn:
            conn.execute("DELETE FROM sync_queue WHERE id = ?", (queue_id,))
            conn.commit()
    
    def mark_sync_failed(self, queue_id: str, error: str) -> None:
        """Mark sync attempt as failed."""
        now = _now_iso()
        with self._get_conn() as conn:
            conn.execute(
                """UPDATE sync_queue 
                   SET attempts = attempts + 1, last_attempt = ?, last_error = ?
                   WHERE id = ?""",
                (now, error, queue_id)
            )
            conn.commit()
    
    # ═══════════════════════════════════════════════════════════════════════════
    # PROJECTS (Project Mode)
    # ═══════════════════════════════════════════════════════════════════════════

    def _row_to_project(self, row: sqlite3.Row) -> Project:
        return Project(
            id=row["id"],
            name=_decrypt_content(row["name_enc"], self._crypto),
            description=_decrypt_content(row["description_enc"], self._crypto) if row["description_enc"] else None,
            goals=_decrypt_content(row["goals_enc"], self._crypto) if row["goals_enc"] else None,
            instructions=_decrypt_content(row["instructions_enc"], self._crypto) if row["instructions_enc"] else None,
            status=row["status"],
            tags=json.loads(row["tags_json"]) if row["tags_json"] else [],
            pinned_paths=json.loads(row["pinned_paths_json"]) if row["pinned_paths_json"] else [],
            digest=_decrypt_content(row["digest_enc"], self._crypto) if row["digest_enc"] else None,
            digest_updated_at=row["digest_updated_at"],
            icon=row["icon"] or "📁",
            color=row["color"] or "#6366f1",
            archived=bool(row["archived"]),
            settings=json.loads(row["settings_json"]) if row["settings_json"] else None,
            embedding=_deserialize_vector(row["embedding"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create_project(
        self,
        name: str,
        description: Optional[str] = None,
        goals: Optional[str] = None,
        instructions: Optional[str] = None,
        status: ProjectStatus = "active",
        tags: Optional[List[str]] = None,
        pinned_paths: Optional[List[str]] = None,
        icon: str = "📁",
        color: str = "#6366f1",
        settings: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None,
        project_id: Optional[str] = None,
    ) -> Project:
        pid = project_id or str(uuid.uuid4())
        now = _now_iso()
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO projects
                   (id, name_enc, description_enc, goals_enc, instructions_enc, status, tags_json,
                    pinned_paths_json, digest_enc, digest_updated_at, icon, color,
                    archived, settings_json, embedding, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 0, ?, ?, ?, ?)""",
                (
                    pid,
                    _encrypt_content(name, self._crypto),
                    _encrypt_content(description, self._crypto) if description else None,
                    _encrypt_content(goals, self._crypto) if goals else None,
                    _encrypt_content(instructions, self._crypto) if instructions else None,
                    status,
                    json.dumps(tags or []),
                    json.dumps(pinned_paths or []),
                    icon,
                    color,
                    json.dumps(settings) if settings else None,
                    _serialize_vector(embedding),
                    now, now,
                ),
            )
            conn.commit()
        return Project(
            id=pid, name=name, description=description, goals=goals, instructions=instructions, status=status,
            tags=tags or [], pinned_paths=pinned_paths or [], icon=icon, color=color, settings=settings,
            embedding=embedding, created_at=now, updated_at=now,
        )

    def get_project(self, project_id: str) -> Optional[Project]:
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return self._row_to_project(row) if row else None

    def list_projects(
        self,
        status: Optional[ProjectStatus] = None,
        include_archived: bool = False,
        limit: int = 100,
    ) -> List[Project]:
        with self._get_conn() as conn:
            query = "SELECT * FROM projects WHERE 1=1"
            params: List[Any] = []
            if not include_archived:
                query += " AND archived = 0"
            if status:
                query += " AND status = ?"
                params.append(status)
            query += " ORDER BY updated_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(query, tuple(params)).fetchall()
        return [self._row_to_project(r) for r in rows]

    def update_project(
        self,
        project_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        goals: Optional[str] = None,
        instructions: Optional[str] = None,
        status: Optional[ProjectStatus] = None,
        tags: Optional[List[str]] = None,
        pinned_paths: Optional[List[str]] = None,
        digest: Optional[str] = None,
        icon: Optional[str] = None,
        color: Optional[str] = None,
        archived: Optional[bool] = None,
        settings: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None,
    ) -> Optional[Project]:
        updates = ["updated_at = ?"]
        values: List[Any] = [_now_iso()]
        if name is not None:
            updates.append("name_enc = ?")
            values.append(_encrypt_content(name, self._crypto))
        if description is not None:
            updates.append("description_enc = ?")
            values.append(_encrypt_content(description, self._crypto) if description else None)
        if goals is not None:
            updates.append("goals_enc = ?")
            values.append(_encrypt_content(goals, self._crypto) if goals else None)
        if instructions is not None:
            updates.append("instructions_enc = ?")
            values.append(_encrypt_content(instructions, self._crypto) if instructions else None)
        if status is not None:
            updates.append("status = ?")
            values.append(status)
        if tags is not None:
            updates.append("tags_json = ?")
            values.append(json.dumps(tags))
        if pinned_paths is not None:
            updates.append("pinned_paths_json = ?")
            values.append(json.dumps(pinned_paths))
        if digest is not None:
            updates.append("digest_enc = ?")
            updates.append("digest_updated_at = ?")
            values.append(_encrypt_content(digest, self._crypto) if digest else None)
            values.append(_now_iso())
        if icon is not None:
            updates.append("icon = ?")
            values.append(icon)
        if color is not None:
            updates.append("color = ?")
            values.append(color)
        if archived is not None:
            updates.append("archived = ?")
            values.append(1 if archived else 0)
        if settings is not None:
            updates.append("settings_json = ?")
            values.append(json.dumps(settings) if settings else None)
        if embedding is not None:
            updates.append("embedding = ?")
            values.append(_serialize_vector(embedding))
        values.append(project_id)
        with self._get_conn() as conn:
            conn.execute(f"UPDATE projects SET {', '.join(updates)} WHERE id = ?", tuple(values))
            conn.commit()
        return self.get_project(project_id)

    def delete_project(self, project_id: str) -> bool:
        with self._get_conn() as conn:
            cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            conn.commit()
            return cur.rowcount > 0

    # ═══════════════════════════════════════════════════════════════════════════
    # MEMORIES (atomic facts/notes/snippets with embeddings, project-tagged)
    # ═══════════════════════════════════════════════════════════════════════════

    def _row_to_memory(self, row: sqlite3.Row) -> Memory:
        return Memory(
            id=row["id"],
            type=row["type"],
            title=_decrypt_content(row["title_enc"], self._crypto) if row["title_enc"] else None,
            content=_decrypt_content(row["content_enc"], self._crypto),
            metadata=_decrypt_json(row["metadata_enc"], self._crypto),
            url=_decrypt_content(row["url_enc"], self._crypto) if row["url_enc"] else None,
            project_ids=json.loads(row["project_ids_json"]) if row["project_ids_json"] else [],
            source=row["source"],
            added_by=row["added_by"],
            pinned=bool(row["pinned"]),
            embedding=_deserialize_vector(row["embedding"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create_memory(
        self,
        type: MemoryType,
        content: str,
        title: Optional[str] = None,
        project_ids: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        url: Optional[str] = None,
        source: MemorySource = "manual",
        added_by: AddedBy = "user",
        pinned: bool = False,
        embedding: Optional[List[float]] = None,
        memory_id: Optional[str] = None,
    ) -> Memory:
        mid = memory_id or str(uuid.uuid4())
        now = _now_iso()
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO memories
                   (id, type, title_enc, content_enc, metadata_enc, url_enc,
                    project_ids_json, source, added_by, pinned, embedding,
                    created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    mid, type,
                    _encrypt_content(title, self._crypto) if title else None,
                    _encrypt_content(content, self._crypto),
                    _encrypt_json(metadata, self._crypto),
                    _encrypt_content(url, self._crypto) if url else None,
                    json.dumps(project_ids or []),
                    source, added_by, 1 if pinned else 0,
                    _serialize_vector(embedding),
                    now, now,
                ),
            )
            conn.commit()
        return Memory(
            id=mid, type=type, content=content, title=title,
            project_ids=project_ids or [], metadata=metadata, url=url,
            source=source, added_by=added_by, pinned=pinned, embedding=embedding,
            created_at=now, updated_at=now,
        )

    def get_memory(self, memory_id: str) -> Optional[Memory]:
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        return self._row_to_memory(row) if row else None

    def list_memories(
        self,
        project_id: Optional[str] = None,
        type: Optional[MemoryType] = None,
        pinned_only: bool = False,
        limit: int = 100,
    ) -> List[Memory]:
        """List memories. `project_id` filters to memories tagged with that project
        (uses JSON LIKE — fine at desktop scale). Pass None to include all."""
        with self._get_conn() as conn:
            query = "SELECT * FROM memories WHERE 1=1"
            params: List[Any] = []
            if project_id:
                query += " AND project_ids_json LIKE ?"
                params.append(f'%"{project_id}"%')
            if type:
                query += " AND type = ?"
                params.append(type)
            if pinned_only:
                query += " AND pinned = 1"
            query += " ORDER BY updated_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(query, tuple(params)).fetchall()
        return [self._row_to_memory(r) for r in rows]

    def search_memories(
        self,
        query_embedding: List[float],
        project_id: Optional[str] = None,
        limit: int = 10,
    ) -> List[Tuple[Memory, float]]:
        """Cosine-similarity search over memory embeddings. Returns (memory, score)."""
        if not query_embedding:
            return []
        q_vec = np.array(query_embedding, dtype=np.float32)
        q_norm = float(np.linalg.norm(q_vec))
        if q_norm == 0:
            return []

        with self._get_conn() as conn:
            sql = "SELECT * FROM memories WHERE embedding IS NOT NULL"
            params: List[Any] = []
            if project_id:
                sql += " AND project_ids_json LIKE ?"
                params.append(f'%"{project_id}"%')
            rows = conn.execute(sql, tuple(params)).fetchall()

        scored: List[Tuple[Memory, float]] = []
        for row in rows:
            vec = _deserialize_vector(row["embedding"])
            if not vec:
                continue
            v = np.array(vec, dtype=np.float32)
            v_norm = float(np.linalg.norm(v))
            if v_norm == 0:
                continue
            score = float(np.dot(q_vec, v) / (q_norm * v_norm))
            scored.append((self._row_to_memory(row), score))
        scored.sort(key=lambda t: t[1], reverse=True)
        return scored[:limit]

    def delete_memory(self, memory_id: str) -> bool:
        with self._get_conn() as conn:
            cur = conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
            conn.commit()
            return cur.rowcount > 0

    # ═══════════════════════════════════════════════════════════════════════════
    # JOURNAL ENTRIES (project timeline)
    # ═══════════════════════════════════════════════════════════════════════════

    def _row_to_journal_entry(self, row: sqlite3.Row) -> JournalEntry:
        return JournalEntry(
            id=row["id"],
            project_id=row["project_id"],
            ts=row["ts"],
            type=row["type"],
            title=_decrypt_content(row["title_enc"], self._crypto),
            body=_decrypt_content(row["body_enc"], self._crypto) if row["body_enc"] else None,
            source=row["source"],
            source_ref=_decrypt_json(row["source_ref_enc"], self._crypto),
            embedding=_deserialize_vector(row["embedding"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"] or row["created_at"],
        )

    def create_journal_entry(
        self,
        project_id: str,
        type: JournalEntryType,
        title: str,
        body: Optional[str] = None,
        source: JournalEntrySource = "manual",
        source_ref: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None,
        ts: Optional[str] = None,
        entry_id: Optional[str] = None,
    ) -> JournalEntry:
        # Caller-supplied ids let the auto-journal upsert deterministically
        # (one live entry per conversation segment, id derived from segment id).
        jid = entry_id or str(uuid.uuid4())
        now = _now_iso()
        ts = ts or now
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO journal_entries
                   (id, project_id, ts, type, title_enc, body_enc, source, source_ref_enc, embedding, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    jid, project_id, ts, type,
                    _encrypt_content(title, self._crypto),
                    _encrypt_content(body, self._crypto) if body else None,
                    source,
                    _encrypt_json(source_ref, self._crypto),
                    _serialize_vector(embedding),
                    now, now,
                ),
            )
            # Bump project updated_at so it surfaces in recently-active lists.
            conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
            conn.commit()
        return JournalEntry(
            id=jid, project_id=project_id, ts=ts, type=type, title=title, body=body,
            source=source, source_ref=source_ref, embedding=embedding,
            created_at=now, updated_at=now,
        )

    def get_journal_entry(self, entry_id: str) -> Optional[JournalEntry]:
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM journal_entries WHERE id = ?", (entry_id,)
            ).fetchone()
        return self._row_to_journal_entry(row) if row else None

    def update_journal_entry(
        self,
        entry_id: str,
        title: Optional[str] = None,
        body: Optional[str] = None,
        type: Optional[JournalEntryType] = None,
        source_ref: Optional[Dict[str, Any]] = None,
        embedding: Optional[List[float]] = None,
        ts: Optional[str] = None,
    ) -> Optional[JournalEntry]:
        """Update an existing journal entry in place. Used by the auto-journal
        engine to extend a live session entry as a chat topic continues."""
        now = _now_iso()
        updates = ["updated_at = ?"]
        values: List[Any] = [now]
        if title is not None:
            updates.append("title_enc = ?")
            values.append(_encrypt_content(title, self._crypto))
        if body is not None:
            updates.append("body_enc = ?")
            values.append(_encrypt_content(body, self._crypto) if body else None)
        if type is not None:
            updates.append("type = ?")
            values.append(type)
        if source_ref is not None:
            updates.append("source_ref_enc = ?")
            values.append(_encrypt_json(source_ref, self._crypto))
        if embedding is not None:
            updates.append("embedding = ?")
            values.append(_serialize_vector(embedding))
        if ts is not None:
            updates.append("ts = ?")
            values.append(ts)
        values.append(entry_id)
        with self._get_conn() as conn:
            cur = conn.execute(
                f"UPDATE journal_entries SET {', '.join(updates)} WHERE id = ?",
                tuple(values),
            )
            if cur.rowcount > 0:
                conn.execute(
                    "UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM journal_entries WHERE id = ?)",
                    (now, entry_id),
                )
            conn.commit()
        return self.get_journal_entry(entry_id)

    def list_journal_entries(
        self,
        project_id: str,
        type: Optional[JournalEntryType] = None,
        limit: int = 50,
    ) -> List[JournalEntry]:
        with self._get_conn() as conn:
            query = "SELECT * FROM journal_entries WHERE project_id = ?"
            params: List[Any] = [project_id]
            if type:
                query += " AND type = ?"
                params.append(type)
            query += " ORDER BY ts DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(query, tuple(params)).fetchall()
        return [self._row_to_journal_entry(r) for r in rows]

    def delete_journal_entry(self, entry_id: str) -> bool:
        with self._get_conn() as conn:
            cur = conn.execute("DELETE FROM journal_entries WHERE id = ?", (entry_id,))
            conn.commit()
            return cur.rowcount > 0

    # ═══════════════════════════════════════════════════════════════════════════
    # CONVERSATIONS x PROJECTS
    # ═══════════════════════════════════════════════════════════════════════════

    def set_conversation_project(self, conversation_id: str, project_id: Optional[str]) -> bool:
        """Stamp a conversation with a project (or clear it). Returns True if updated."""
        with self._get_conn() as conn:
            cur = conn.execute(
                "UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?",
                (project_id, _now_iso(), conversation_id),
            )
            conn.commit()
            return cur.rowcount > 0

    # ═══════════════════════════════════════════════════════════════════════════
    # STATS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def get_stats(self) -> Dict[str, Any]:
        """Get database statistics."""
        with self._get_conn() as conn:
            conv_count = conn.execute(
                "SELECT COUNT(*) FROM conversations WHERE status = 'active'"
            ).fetchone()[0]
            conv_with_embedding = conn.execute(
                "SELECT COUNT(*) FROM conversations WHERE embedding IS NOT NULL"
            ).fetchone()[0]
            msg_count = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
            project_count = conn.execute(
                "SELECT COUNT(*) FROM projects WHERE archived = 0 AND status != 'archived'"
            ).fetchone()[0]
            memory_count = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
            journal_count = conn.execute("SELECT COUNT(*) FROM journal_entries").fetchone()[0]
            segment_count = conn.execute("SELECT COUNT(*) FROM conversation_segments").fetchone()[0]
            segment_with_embedding = conn.execute(
                "SELECT COUNT(*) FROM conversation_segments WHERE embedding IS NOT NULL"
            ).fetchone()[0]
            pending_sync = conn.execute("SELECT COUNT(*) FROM sync_queue").fetchone()[0]

        return {
            "conversations": conv_count,
            "conversations_with_embedding": conv_with_embedding,
            "messages": msg_count,
            "projects": project_count,
            "memories": memory_count,
            "journal_entries": journal_count,
            "segments": segment_count,
            "segments_with_embedding": segment_with_embedding,
            "pending_sync": pending_sync,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# MODULE-LEVEL SINGLETON
# ═══════════════════════════════════════════════════════════════════════════════

_memory_db: Optional[MemoryDB] = None


def get_memory_db(user_password: Optional[str] = None) -> MemoryDB:
    """Get or create the memory database singleton."""
    global _memory_db
    
    if _memory_db is None:
        _memory_db = MemoryDB(user_password=user_password)
    
    return _memory_db


def init_memory_db(user_password: Optional[str] = None) -> MemoryDB:
    """Initialize the memory database."""
    global _memory_db
    _memory_db = MemoryDB(user_password=user_password)
    print(f"[memory_db] Initialized at {_DB_PATH}")
    return _memory_db
