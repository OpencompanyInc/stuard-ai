"""
Encrypted Memory Database for Stuard AI

Local-first storage for:
- Conversations and messages
- Conversation segments (topic tracking with summaries)
- Spaces (collaborative folders)
- Space items (notes, sources, links)
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
SpaceType = Literal['project', 'topic', 'research', 'reference', 'custom']
SpaceItemType = Literal['note', 'source', 'link', 'file', 'fact', 'snippet', 'folder']
AddedBy = Literal['user', 'ai']


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
    
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None
        return d


@dataclass
class Space:
    id: str
    name: str
    description: Optional[str]
    type: SpaceType
    icon: str = '📁'
    color: str = '#6366f1'
    embedding: Optional[List[float]] = None
    created_at: str = ''
    updated_at: str = ''
    archived: bool = False
    sync_id: Optional[str] = None
    synced_at: Optional[str] = None
    needs_sync: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None
        return d


@dataclass
class SpaceItem:
    id: str
    space_id: str
    type: SpaceItemType
    title: Optional[str]
    content: str
    metadata: Optional[Dict[str, Any]] = None
    added_by: AddedBy = 'user'
    pinned: bool = False
    embedding: Optional[List[float]] = None
    parent_id: Optional[str] = None  # For folder hierarchy
    position: int = 0  # For ordering within folder
    created_at: str = ''
    updated_at: str = ''

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['embedding'] = None
        return d


@dataclass
class SecuritySettings:
    memory_lock_enabled: bool = False
    lock_timeout_minutes: int = 5
    password_hash: Optional[str] = None
    biometric_enabled: bool = False
    sync_enabled: bool = False
    sync_salt: Optional[str] = None  # Base64 encoded
    last_sync_at: Optional[str] = None


@dataclass
class SharedSpaceInfo:
    """Tracks a locally-synced shared space."""
    id: str                          # Local space ID
    cloud_id: Optional[str] = None   # Cloud shared_spaces.id
    synced_at: Optional[str] = None
    is_shared: bool = False          # Whether this space is shared with others
    shared_with: Optional[List[str]] = None  # List of emails shared with
    share_password_hash: Optional[str] = None  # Hash of the share password
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'cloud_id': self.cloud_id,
            'synced_at': self.synced_at,
            'is_shared': self.is_shared,
            'shared_with': self.shared_with,
        }


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
    """Encrypt content string."""
    return crypto.encrypt_string(content)


def _decrypt_content(encrypted: str, crypto: CryptoManager) -> str:
    """Decrypt content string."""
    return crypto.decrypt_string(encrypted)


def _encrypt_json(data: Any, crypto: CryptoManager) -> Optional[str]:
    """Encrypt JSON-serializable data."""
    if data is None:
        return None
    return crypto.encrypt_string(json.dumps(data))


def _decrypt_json(encrypted: Optional[str], crypto: CryptoManager) -> Optional[Any]:
    """Decrypt JSON data."""
    if encrypted is None:
        return None
    return json.loads(crypto.decrypt_string(encrypted))


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
                    type TEXT DEFAULT 'chat' CHECK(type IN ('chat', 'subagent'))
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
                    embedding BLOB
                )
            """)
            
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
            
            # Spaces
            cur.execute("""
                CREATE TABLE IF NOT EXISTS spaces (
                    id TEXT PRIMARY KEY,
                    name_enc TEXT NOT NULL,
                    description_enc TEXT,
                    type TEXT NOT NULL CHECK(type IN ('project', 'topic', 'research', 'reference', 'custom')),
                    icon TEXT DEFAULT '📁',
                    color TEXT DEFAULT '#6366f1',
                    embedding BLOB,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    archived INTEGER DEFAULT 0,
                    sync_id TEXT,
                    synced_at TEXT,
                    needs_sync INTEGER DEFAULT 0
                )
            """)
            
            # Space items
            cur.execute("""
                CREATE TABLE IF NOT EXISTS space_items (
                    id TEXT PRIMARY KEY,
                    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                    type TEXT NOT NULL CHECK(type IN ('note', 'source', 'link', 'file', 'fact', 'snippet', 'folder')),
                    title_enc TEXT,
                    content_enc TEXT NOT NULL,
                    metadata_enc TEXT,
                    added_by TEXT NOT NULL CHECK(added_by IN ('user', 'ai')),
                    pinned INTEGER DEFAULT 0,
                    embedding BLOB,
                    parent_id TEXT REFERENCES space_items(id) ON DELETE SET NULL,
                    position INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # Space-conversation links
            cur.execute("""
                CREATE TABLE IF NOT EXISTS space_conversations (
                    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    relevance_score REAL DEFAULT 1.0,
                    auto_linked INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (space_id, conversation_id)
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
            
            # Shared spaces tracking
            cur.execute("""
                CREATE TABLE IF NOT EXISTS shared_space_info (
                    space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
                    cloud_id TEXT,
                    synced_at TEXT,
                    is_shared INTEGER DEFAULT 0,
                    shared_with TEXT,
                    share_password_hash TEXT
                )
            """)
            
            # Migration: Add parent_id and position columns if they don't exist
            try:
                cur.execute("ALTER TABLE space_items ADD COLUMN parent_id TEXT REFERENCES space_items(id) ON DELETE SET NULL")
            except sqlite3.OperationalError:
                pass  # Column already exists
            try:
                cur.execute("ALTER TABLE space_items ADD COLUMN position INTEGER DEFAULT 0")
            except sqlite3.OperationalError:
                pass  # Column already exists
            
            # Migration: Update CHECK constraint to include 'folder' type
            # SQLite doesn't support altering CHECK constraints, so we need to recreate the table
            try:
                # Check if the constraint already includes 'folder'
                cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='space_items'")
                table_sql = cur.fetchone()
                if table_sql and "'folder'" not in table_sql[0]:
                    logger.info("Migrating space_items table to include 'folder' type")

                    # Clean up any existing space_items_new table from previous failed migration
                    cur.execute("DROP TABLE IF EXISTS space_items_new")

                    # Disable foreign key constraints temporarily
                    cur.execute("PRAGMA foreign_keys=OFF")

                    # Recreate table with new constraint
                    cur.execute("""
                        CREATE TABLE space_items_new (
                            id TEXT PRIMARY KEY,
                            space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
                            type TEXT NOT NULL CHECK(type IN ('note', 'source', 'link', 'file', 'fact', 'snippet', 'folder')),
                            title_enc TEXT,
                            content_enc TEXT NOT NULL,
                            metadata_enc TEXT,
                            added_by TEXT NOT NULL CHECK(added_by IN ('user', 'ai')),
                            pinned INTEGER DEFAULT 0,
                            embedding BLOB,
                            parent_id TEXT REFERENCES space_items(id) ON DELETE SET NULL,
                            position INTEGER DEFAULT 0,
                            created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )
                    """)

                    # Copy data from old table (handle missing columns gracefully)
                    try:
                        cur.execute("""
                            INSERT INTO space_items_new
                            SELECT id, space_id, type, title_enc, content_enc, metadata_enc,
                                   added_by, pinned, embedding, parent_id, position, created_at, updated_at
                            FROM space_items
                        """)
                    except sqlite3.OperationalError:
                        # If parent_id/position don't exist in old table, use defaults
                        cur.execute("""
                            INSERT INTO space_items_new
                            (id, space_id, type, title_enc, content_enc, metadata_enc,
                             added_by, pinned, embedding, parent_id, position, created_at, updated_at)
                            SELECT id, space_id, type, title_enc, content_enc, metadata_enc,
                                   added_by, pinned, embedding, NULL, 0, created_at, updated_at
                            FROM space_items
                        """)

                    # Drop old table
                    cur.execute("DROP TABLE space_items")

                    # Rename new table
                    cur.execute("ALTER TABLE space_items_new RENAME TO space_items")

                    # Re-enable foreign key constraints
                    cur.execute("PRAGMA foreign_keys=ON")

                    logger.info("space_items table migration completed successfully")
            except Exception as e:
                logger.error(f"space_items migration failed: {e}")
                # Re-enable foreign keys even if migration failed
                try:
                    cur.execute("PRAGMA foreign_keys=ON")
                except:
                    pass
                raise

            # Indexes
            cur.execute("CREATE INDEX IF NOT EXISTS idx_conv_date ON conversations(created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, turn_index)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_seg_conv ON conversation_segments(conversation_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_items_space ON space_items(space_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_items_parent ON space_items(parent_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_items_position ON space_items(space_id, parent_id, position)")

            conn.commit()
    
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
        conv_type: ConversationType = 'chat'
    ) -> Conversation:
        """Create a new conversation or sub-agent."""
        cid = conversation_id or str(uuid.uuid4())
        now = _now_iso()
        
        title_enc = _encrypt_content(title, self._crypto) if title else None

        inserted = False

        with self._get_conn() as conn:
            try:
                conn.execute(
                    """INSERT INTO conversations (id, title_enc, model, created_at, updated_at, parent_id, type)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (cid, title_enc, model, now, now, parent_id, conv_type)
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
                parent_id=parent_id, type=conv_type
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
            type=conv_type or 'chat'
        )
    
    def list_conversations(
        self,
        status: Optional[ConversationStatus] = 'active',
        limit: int = 50,
        offset: int = 0,
        conv_type: Optional[ConversationType] = None
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
                type=row_type or 'chat'
            ))
        
        return result
    
    def update_conversation(
        self,
        conversation_id: str,
        title: Optional[str] = None,
        status: Optional[ConversationStatus] = None,
        embedding: Optional[List[float]] = None
    ) -> Optional[Conversation]:
        """Update conversation."""
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
        threshold: float = 0.6
    ) -> List[Tuple[ConversationSegment, float]]:
        """Search conversation segments by embedding similarity."""
        query_np = np.array(query_vector, dtype=np.float32)
        
        with self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM conversation_segments WHERE embedding IS NOT NULL"
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
                    tool_calls_enc, tool_results_enc, attachments_enc, embedding)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    mid, conversation_id, role,
                    _encrypt_content(content, self._crypto),
                    turn_index, now,
                    _encrypt_json(tool_calls, self._crypto),
                    _encrypt_json(tool_results, self._crypto),
                    _encrypt_json(attachments, self._crypto),
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
                embedding=None  # Don't load embeddings by default
            ))
        
        return result
    
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
            if since_ts is None and before_ts is None:
                rows = conn.execute(
                    "SELECT * FROM conversation_segments ORDER BY created_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM conversation_segments ORDER BY created_at DESC",
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
            rows = conn.execute(
                "SELECT * FROM conversation_segments ORDER BY created_at DESC LIMIT ?",
                (limit,),
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
                embedding=_deserialize_vector(row['embedding']),
                created_at=row['created_at'],
                updated_at=row['updated_at'],
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

        segments = self.list_recent_segments_with_embeddings(limit=segments_scan_limit)

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
    # SPACES
    # ═══════════════════════════════════════════════════════════════════════════
    
    def create_space(
        self,
        name: str,
        space_type: SpaceType,
        description: Optional[str] = None,
        icon: str = '📁',
        color: str = '#6366f1',
        embedding: Optional[List[float]] = None
    ) -> Space:
        """Create a new space."""
        sid = str(uuid.uuid4())
        now = _now_iso()
        
        with self._get_conn() as conn:
            conn.execute(
                """INSERT INTO spaces
                   (id, name_enc, description_enc, type, icon, color, embedding, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    sid,
                    _encrypt_content(name, self._crypto),
                    _encrypt_content(description, self._crypto) if description else None,
                    space_type, icon, color,
                    _serialize_vector(embedding),
                    now, now
                )
            )
            conn.commit()
        
        self._queue_sync('spaces', sid, 'upsert')
        
        return Space(
            id=sid,
            name=name,
            description=description,
            type=space_type,
            icon=icon,
            color=color,
            embedding=embedding,
            created_at=now,
            updated_at=now
        )
    
    def get_space(self, space_id: str) -> Optional[Space]:
        """Get space by ID."""
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM spaces WHERE id = ?", (space_id,)).fetchone()
        
        if not row:
            return None
        
        return Space(
            id=row['id'],
            name=_decrypt_content(row['name_enc'], self._crypto),
            description=_decrypt_content(row['description_enc'], self._crypto) if row['description_enc'] else None,
            type=row['type'],
            icon=row['icon'],
            color=row['color'],
            embedding=_deserialize_vector(row['embedding']),
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            archived=bool(row['archived']),
            sync_id=row['sync_id'],
            synced_at=row['synced_at'],
            needs_sync=bool(row['needs_sync'])
        )
    
    def list_spaces(
        self,
        space_type: Optional[SpaceType] = None,
        include_archived: bool = False,
        limit: int = 50
    ) -> List[Space]:
        """List spaces."""
        with self._get_conn() as conn:
            query = "SELECT * FROM spaces WHERE 1=1"
            params: List[Any] = []
            
            if not include_archived:
                query += " AND archived = 0"
            if space_type:
                query += " AND type = ?"
                params.append(space_type)
            
            query += " ORDER BY updated_at DESC LIMIT ?"
            params.append(limit)
            
            rows = conn.execute(query, tuple(params)).fetchall()
        
        return [
            Space(
                id=row['id'],
                name=_decrypt_content(row['name_enc'], self._crypto),
                description=_decrypt_content(row['description_enc'], self._crypto) if row['description_enc'] else None,
                type=row['type'],
                icon=row['icon'],
                color=row['color'],
                embedding=None,
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                archived=bool(row['archived'])
            )
            for row in rows
        ]
    
    def update_space(
        self,
        space_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        icon: Optional[str] = None,
        color: Optional[str] = None,
        archived: Optional[bool] = None,
        embedding: Optional[List[float]] = None
    ) -> Optional[Space]:
        """Update a space."""
        updates = ["updated_at = ?", "needs_sync = 1"]
        values: List[Any] = [_now_iso()]
        
        if name is not None:
            updates.append("name_enc = ?")
            values.append(_encrypt_content(name, self._crypto))
        if description is not None:
            updates.append("description_enc = ?")
            values.append(_encrypt_content(description, self._crypto) if description else None)
        if icon is not None:
            updates.append("icon = ?")
            values.append(icon)
        if color is not None:
            updates.append("color = ?")
            values.append(color)
        if archived is not None:
            updates.append("archived = ?")
            values.append(1 if archived else 0)
        if embedding is not None:
            updates.append("embedding = ?")
            values.append(_serialize_vector(embedding))
        
        values.append(space_id)
        
        with self._get_conn() as conn:
            conn.execute(
                f"UPDATE spaces SET {', '.join(updates)} WHERE id = ?",
                tuple(values)
            )
            conn.commit()
        
        self._queue_sync('spaces', space_id, 'upsert')
        return self.get_space(space_id)
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """Hard delete a conversation and all its messages."""
        with self._get_conn() as conn:
            cur = conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
            conn.commit()
            deleted = cur.rowcount > 0

        if deleted:
            self._queue_sync('conversations', conversation_id, 'delete')

        return deleted

    def delete_space(self, space_id: str) -> bool:
        """Delete a space and all its items."""
        with self._get_conn() as conn:
            cur = conn.execute("DELETE FROM spaces WHERE id = ?", (space_id,))
            conn.commit()
            deleted = cur.rowcount > 0
        
        if deleted:
            self._queue_sync('spaces', space_id, 'delete')
        
        return deleted
    
    # ═══════════════════════════════════════════════════════════════════════════
    # SPACE ITEMS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def add_space_item(
        self,
        space_id: str,
        item_type: SpaceItemType,
        content: str,
        title: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        added_by: AddedBy = 'user',
        pinned: bool = False,
        embedding: Optional[List[float]] = None,
        parent_id: Optional[str] = None,
        position: Optional[int] = None
    ) -> SpaceItem:
        """Add an item to a space."""
        iid = str(uuid.uuid4())
        now = _now_iso()

        with self._get_conn() as conn:
            # Auto-calculate position if not provided
            if position is None:
                row = conn.execute(
                    """SELECT COALESCE(MAX(position), -1) + 1 as next_pos
                       FROM space_items WHERE space_id = ? AND parent_id IS ?""",
                    (space_id, parent_id)
                ).fetchone()
                position = row['next_pos'] if row else 0

            conn.execute(
                """INSERT INTO space_items
                   (id, space_id, type, title_enc, content_enc, metadata_enc, added_by, pinned, embedding, parent_id, position, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    iid, space_id, item_type,
                    _encrypt_content(title, self._crypto) if title else None,
                    _encrypt_content(content, self._crypto),
                    _encrypt_json(metadata, self._crypto),
                    added_by,
                    1 if pinned else 0,
                    _serialize_vector(embedding),
                    parent_id,
                    position,
                    now, now
                )
            )

            # Update space timestamp
            conn.execute(
                "UPDATE spaces SET updated_at = ?, needs_sync = 1 WHERE id = ?",
                (now, space_id)
            )
            conn.commit()

        self._queue_sync('spaces', space_id, 'upsert')

        return SpaceItem(
            id=iid,
            space_id=space_id,
            type=item_type,
            title=title,
            content=content,
            metadata=metadata,
            added_by=added_by,
            pinned=pinned,
            embedding=embedding,
            parent_id=parent_id,
            position=position,
            created_at=now,
            updated_at=now
        )
    
    def get_space_items(
        self,
        space_id: str,
        item_type: Optional[SpaceItemType] = None,
        pinned_only: bool = False,
        parent_id: Optional[str] = None,
        include_all: bool = True,
        limit: int = 100
    ) -> List[SpaceItem]:
        """Get items in a space.

        Args:
            space_id: The space to get items from
            item_type: Filter by item type
            pinned_only: Only return pinned items
            parent_id: Filter by parent folder (None = root level, use include_all=True for all)
            include_all: If True, return all items; if False, filter by parent_id
            limit: Maximum items to return
        """
        with self._get_conn() as conn:
            query = "SELECT * FROM space_items WHERE space_id = ?"
            params: List[Any] = [space_id]

            if item_type:
                query += " AND type = ?"
                params.append(item_type)
            if pinned_only:
                query += " AND pinned = 1"
            if not include_all:
                if parent_id is None:
                    query += " AND parent_id IS NULL"
                else:
                    query += " AND parent_id = ?"
                    params.append(parent_id)

            query += " ORDER BY type = 'folder' DESC, pinned DESC, position ASC, created_at DESC LIMIT ?"
            params.append(limit)

            rows = conn.execute(query, tuple(params)).fetchall()

        return [
            SpaceItem(
                id=row['id'],
                space_id=row['space_id'],
                type=row['type'],
                title=_decrypt_content(row['title_enc'], self._crypto) if row['title_enc'] else None,
                content=_decrypt_content(row['content_enc'], self._crypto),
                metadata=_decrypt_json(row['metadata_enc'], self._crypto),
                added_by=row['added_by'],
                pinned=bool(row['pinned']),
                embedding=None,
                parent_id=row['parent_id'] if 'parent_id' in row.keys() else None,
                position=row['position'] if 'position' in row.keys() else 0,
                created_at=row['created_at'],
                updated_at=row['updated_at']
            )
            for row in rows
        ]
    
    def update_space_item(
        self,
        item_id: str,
        title: Optional[str] = None,
        content: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        pinned: Optional[bool] = None,
        parent_id: Optional[str] = None,
        position: Optional[int] = None
    ) -> Optional[SpaceItem]:
        """Update a space item."""
        updates = ["updated_at = ?"]
        values: List[Any] = [_now_iso()]

        if title is not None:
            updates.append("title_enc = ?")
            values.append(_encrypt_content(title, self._crypto) if title else None)
        if content is not None:
            updates.append("content_enc = ?")
            values.append(_encrypt_content(content, self._crypto))
        if metadata is not None:
            updates.append("metadata_enc = ?")
            values.append(_encrypt_json(metadata, self._crypto))
        if pinned is not None:
            updates.append("pinned = ?")
            values.append(1 if pinned else 0)
        if parent_id is not None:
            updates.append("parent_id = ?")
            values.append(parent_id if parent_id != '' else None)
        if position is not None:
            updates.append("position = ?")
            values.append(position)

        values.append(item_id)

        with self._get_conn() as conn:
            conn.execute(
                f"UPDATE space_items SET {', '.join(updates)} WHERE id = ?",
                tuple(values)
            )
            conn.commit()

        return self.get_space_item(item_id)

    def move_space_item(
        self,
        item_id: str,
        new_parent_id: Optional[str] = None,
        new_position: Optional[int] = None
    ) -> Optional[SpaceItem]:
        """Move a space item to a new parent folder and/or position."""
        with self._get_conn() as conn:
            # Get current item
            row = conn.execute("SELECT * FROM space_items WHERE id = ?", (item_id,)).fetchone()
            if not row:
                return None

            space_id = row['space_id']
            now = _now_iso()

            # Calculate new position if not provided
            if new_position is None:
                pos_row = conn.execute(
                    """SELECT COALESCE(MAX(position), -1) + 1 as next_pos
                       FROM space_items WHERE space_id = ? AND parent_id IS ?""",
                    (space_id, new_parent_id)
                ).fetchone()
                new_position = pos_row['next_pos'] if pos_row else 0

            conn.execute(
                "UPDATE space_items SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?",
                (new_parent_id, new_position, now, item_id)
            )

            # Update space timestamp
            conn.execute(
                "UPDATE spaces SET updated_at = ?, needs_sync = 1 WHERE id = ?",
                (now, space_id)
            )
            conn.commit()

        self._queue_sync('spaces', space_id, 'upsert')
        return self.get_space_item(item_id)

    def get_space_item(self, item_id: str) -> Optional[SpaceItem]:
        """Get space item by ID."""
        with self._get_conn() as conn:
            row = conn.execute("SELECT * FROM space_items WHERE id = ?", (item_id,)).fetchone()

        if not row:
            return None

        return SpaceItem(
            id=row['id'],
            space_id=row['space_id'],
            type=row['type'],
            title=_decrypt_content(row['title_enc'], self._crypto) if row['title_enc'] else None,
            content=_decrypt_content(row['content_enc'], self._crypto),
            metadata=_decrypt_json(row['metadata_enc'], self._crypto),
            added_by=row['added_by'],
            pinned=bool(row['pinned']),
            embedding=_deserialize_vector(row['embedding']),
            parent_id=row['parent_id'] if 'parent_id' in row.keys() else None,
            position=row['position'] if 'position' in row.keys() else 0,
            created_at=row['created_at'],
            updated_at=row['updated_at']
        )

    def get_folder_tree(self, space_id: str) -> List[Dict[str, Any]]:
        """Get the entire folder tree for a space as a nested structure."""
        all_items = self.get_space_items(space_id, include_all=True, limit=1000)

        # Build lookup tables
        items_by_id = {item.id: item for item in all_items}
        children_by_parent: Dict[Optional[str], List[SpaceItem]] = {}

        for item in all_items:
            parent = item.parent_id
            if parent not in children_by_parent:
                children_by_parent[parent] = []
            children_by_parent[parent].append(item)

        # Sort children by position
        for children in children_by_parent.values():
            children.sort(key=lambda x: (x.type != 'folder', x.position, x.created_at))

        def build_tree(parent_id: Optional[str]) -> List[Dict[str, Any]]:
            result = []
            for item in children_by_parent.get(parent_id, []):
                node = item.to_dict()
                if item.type == 'folder':
                    node['children'] = build_tree(item.id)
                result.append(node)
            return result

        return build_tree(None)

    def delete_space_item(self, item_id: str) -> bool:
        """Delete a space item."""
        with self._get_conn() as conn:
            # Get space_id before delete for sync
            row = conn.execute("SELECT space_id FROM space_items WHERE id = ?", (item_id,)).fetchone()
            space_id = row['space_id'] if row else None

            cur = conn.execute("DELETE FROM space_items WHERE id = ?", (item_id,))
            conn.commit()
            deleted = cur.rowcount > 0

        if deleted and space_id:
            self._queue_sync('spaces', space_id, 'upsert')

        return deleted
    
    # ═══════════════════════════════════════════════════════════════════════════
    # SPACE-CONVERSATION LINKS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def link_conversation_to_space(
        self,
        space_id: str,
        conversation_id: str,
        relevance_score: float = 1.0,
        auto_linked: bool = False
    ) -> None:
        """Link a conversation to a space."""
        now = _now_iso()
        
        with self._get_conn() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO space_conversations
                   (space_id, conversation_id, relevance_score, auto_linked, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (space_id, conversation_id, relevance_score, 1 if auto_linked else 0, now)
            )
            conn.commit()
    
    def get_space_conversations(self, space_id: str) -> List[Tuple[Conversation, float]]:
        """Get conversations linked to a space."""
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT c.*, sc.relevance_score FROM conversations c
                   JOIN space_conversations sc ON c.id = sc.conversation_id
                   WHERE sc.space_id = ?
                   ORDER BY sc.relevance_score DESC, c.updated_at DESC""",
                (space_id,)
            ).fetchall()
        
        results = []
        for row in rows:
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
            results.append((conv, row['relevance_score']))
        
        return results
    
    def get_conversation_spaces(self, conversation_id: str) -> List[Space]:
        """Get spaces that a conversation is linked to."""
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT s.* FROM spaces s
                   JOIN space_conversations sc ON s.id = sc.space_id
                   WHERE sc.conversation_id = ?
                   ORDER BY sc.relevance_score DESC""",
                (conversation_id,)
            ).fetchall()
        
        return [
            Space(
                id=row['id'],
                name=_decrypt_content(row['name_enc'], self._crypto),
                description=_decrypt_content(row['description_enc'], self._crypto) if row['description_enc'] else None,
                type=row['type'],
                icon=row['icon'],
                color=row['color'],
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                archived=bool(row['archived'])
            )
            for row in rows
        ]
    
    def unlink_conversation_from_space(self, space_id: str, conversation_id: str) -> bool:
        """Unlink a conversation from a space."""
        with self._get_conn() as conn:
            cur = conn.execute(
                "DELETE FROM space_conversations WHERE space_id = ? AND conversation_id = ?",
                (space_id, conversation_id)
            )
            conn.commit()
            return cur.rowcount > 0
    
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
    # SHARED SPACES
    # ═══════════════════════════════════════════════════════════════════════════
    
    def get_shared_space_info(self, space_id: str) -> Optional[SharedSpaceInfo]:
        """Get shared space info for a local space."""
        with self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM shared_space_info WHERE space_id = ?", (space_id,)
            ).fetchone()
        
        if not row:
            return None
        
        shared_with = None
        if row['shared_with']:
            try:
                shared_with = json.loads(row['shared_with'])
            except:
                shared_with = None
        
        return SharedSpaceInfo(
            id=row['space_id'],
            cloud_id=row['cloud_id'],
            synced_at=row['synced_at'],
            is_shared=bool(row['is_shared']),
            shared_with=shared_with,
            share_password_hash=row['share_password_hash']
        )
    
    def set_shared_space_info(
        self,
        space_id: str,
        cloud_id: Optional[str] = None,
        synced_at: Optional[str] = None,
        is_shared: Optional[bool] = None,
        shared_with: Optional[List[str]] = None,
        share_password_hash: Optional[str] = None
    ) -> SharedSpaceInfo:
        """Create or update shared space info."""
        existing = self.get_shared_space_info(space_id)
        
        with self._get_conn() as conn:
            if existing:
                updates = []
                values: List[Any] = []
                
                if cloud_id is not None:
                    updates.append("cloud_id = ?")
                    values.append(cloud_id)
                if synced_at is not None:
                    updates.append("synced_at = ?")
                    values.append(synced_at)
                if is_shared is not None:
                    updates.append("is_shared = ?")
                    values.append(1 if is_shared else 0)
                if shared_with is not None:
                    updates.append("shared_with = ?")
                    values.append(json.dumps(shared_with))
                if share_password_hash is not None:
                    updates.append("share_password_hash = ?")
                    values.append(share_password_hash)
                
                if updates:
                    values.append(space_id)
                    conn.execute(
                        f"UPDATE shared_space_info SET {', '.join(updates)} WHERE space_id = ?",
                        tuple(values)
                    )
                    conn.commit()
            else:
                conn.execute(
                    """INSERT INTO shared_space_info 
                       (space_id, cloud_id, synced_at, is_shared, shared_with, share_password_hash)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (
                        space_id,
                        cloud_id,
                        synced_at or _now_iso(),
                        1 if is_shared else 0,
                        json.dumps(shared_with) if shared_with else None,
                        share_password_hash
                    )
                )
                conn.commit()
        
        return self.get_shared_space_info(space_id) or SharedSpaceInfo(id=space_id)
    
    def list_synced_spaces(self) -> List[Tuple[Space, SharedSpaceInfo]]:
        """List all locally synced spaces with their share info."""
        with self._get_conn() as conn:
            rows = conn.execute(
                """SELECT s.*, si.cloud_id, si.synced_at as share_synced_at, 
                          si.is_shared, si.shared_with
                   FROM spaces s
                   JOIN shared_space_info si ON s.id = si.space_id
                   WHERE si.cloud_id IS NOT NULL
                   ORDER BY si.synced_at DESC"""
            ).fetchall()
        
        results = []
        for row in rows:
            space = Space(
                id=row['id'],
                name=_decrypt_content(row['name_enc'], self._crypto),
                description=_decrypt_content(row['description_enc'], self._crypto) if row['description_enc'] else None,
                type=row['type'],
                icon=row['icon'],
                color=row['color'],
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                archived=bool(row['archived'])
            )
            
            shared_with = None
            if row['shared_with']:
                try:
                    shared_with = json.loads(row['shared_with'])
                except:
                    pass
            
            info = SharedSpaceInfo(
                id=row['id'],
                cloud_id=row['cloud_id'],
                synced_at=row['share_synced_at'],
                is_shared=bool(row['is_shared']),
                shared_with=shared_with
            )
            results.append((space, info))
        
        return results
    
    def prepare_space_for_sync(self, space_id: str) -> Optional[Dict[str, Any]]:
        """Prepare a space and its items for cloud sync (encrypted)."""
        space = self.get_space(space_id)
        if not space:
            return None
        
        items = self.get_space_items(space_id, limit=500)
        
        # Re-encrypt with the original encrypted values for cloud storage
        with self._get_conn() as conn:
            space_row = conn.execute(
                "SELECT name_enc, description_enc FROM spaces WHERE id = ?",
                (space_id,)
            ).fetchone()
            
            items_rows = conn.execute(
                """SELECT id, type, title_enc, content_enc, metadata_enc, 
                          added_by, pinned, created_at, updated_at
                   FROM space_items WHERE space_id = ?
                   ORDER BY pinned DESC, created_at DESC""",
                (space_id,)
            ).fetchall()
        
        items_data = [
            {
                'id': row['id'],
                'type': row['type'],
                'title_enc': row['title_enc'],
                'content_enc': row['content_enc'],
                'metadata_enc': row['metadata_enc'],
                'added_by': row['added_by'],
                'pinned': bool(row['pinned']),
                'created_at': row['created_at'],
                'updated_at': row['updated_at'],
            }
            for row in items_rows
        ]
        
        import hashlib
        checksum_data = json.dumps({
            'name': space_row['name_enc'],
            'items': [i['content_enc'] for i in items_data]
        }, sort_keys=True)
        checksum = hashlib.sha256(checksum_data.encode()).hexdigest()[:32]
        
        return {
            'local_space_id': space_id,
            'name_encrypted': space_row['name_enc'],
            'description_encrypted': space_row['description_enc'],
            'type': space.type,
            'icon': space.icon,
            'color': space.color,
            'items_encrypted': json.dumps(items_data),
            'checksum': checksum,
        }
    
    def delete_shared_space_info(self, space_id: str) -> bool:
        """Delete shared space info (unsync a space)."""
        with self._get_conn() as conn:
            cur = conn.execute(
                "DELETE FROM shared_space_info WHERE space_id = ?", (space_id,)
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
            space_count = conn.execute(
                "SELECT COUNT(*) FROM spaces WHERE archived = 0"
            ).fetchone()[0]
            item_count = conn.execute("SELECT COUNT(*) FROM space_items").fetchone()[0]
            segment_count = conn.execute("SELECT COUNT(*) FROM conversation_segments").fetchone()[0]
            segment_with_embedding = conn.execute(
                "SELECT COUNT(*) FROM conversation_segments WHERE embedding IS NOT NULL"
            ).fetchone()[0]
            pending_sync = conn.execute("SELECT COUNT(*) FROM sync_queue").fetchone()[0]
            
            # Shared spaces stats
            synced_spaces = 0
            shared_spaces = 0
            try:
                synced_spaces = conn.execute(
                    "SELECT COUNT(*) FROM shared_space_info WHERE cloud_id IS NOT NULL"
                ).fetchone()[0]
                shared_spaces = conn.execute(
                    "SELECT COUNT(*) FROM shared_space_info WHERE is_shared = 1"
                ).fetchone()[0]
            except:
                pass
        
        return {
            "conversations": conv_count,
            "conversations_with_embedding": conv_with_embedding,
            "messages": msg_count,
            "spaces": space_count,
            "space_items": item_count,
            "segments": segment_count,
            "segments_with_embedding": segment_with_embedding,
            "pending_sync": pending_sync,
            "synced_spaces": synced_spaces,
            "shared_spaces": shared_spaces,
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
