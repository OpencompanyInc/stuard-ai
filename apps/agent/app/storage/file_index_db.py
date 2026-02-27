"""
File Index Database for Semantic File Search

A local SQLite database that tracks:
- Indexed roots (user-selected folders)
- Indexed files (with fingerprints, summaries, embeddings)
- Folder summaries (hierarchical Merkle-style)

Architecture:
- Tier 1 (Instant): Metadata + filename indexed to FTS5
- Tier 3 (Deep): Cloud summarization + text-embedding-3-large vectors

Change detection:
- Fast: size + mtime check
- Robust: content fingerprint (hash) for files where stat changed
- Move detection: match deleted files by fingerprint
"""

from __future__ import annotations

import hashlib
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

FileKind = Literal['document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'folder', 'application', 'other']
FileStatus = Literal['pending', 'indexed', 'stale', 'error', 'deleted']
ScanSchedule = Literal['off', 'hourly', 'daily', 'weekly', 'custom']

# Extension mappings
EXT_TO_KIND: Dict[str, FileKind] = {
    # Applications / Shortcuts
    '.lnk': 'application', '.url': 'application',
    '.exe': 'application', '.msi': 'application', '.app': 'application',
    '.desktop': 'application', '.appref-ms': 'application',
    '.cmd': 'application', '.bat': 'application', '.com': 'application',
    # Documents
    '.pdf': 'document', '.txt': 'document', '.md': 'document', '.rtf': 'document',
    '.doc': 'document', '.docx': 'document', '.odt': 'document',
    '.xls': 'document', '.xlsx': 'document', '.ods': 'document', '.csv': 'document',
    '.ppt': 'document', '.pptx': 'document', '.odp': 'document',
    # Images
    '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
    '.bmp': 'image', '.webp': 'image', '.svg': 'image', '.ico': 'image',
    '.heic': 'image', '.heif': 'image', '.tiff': 'image', '.tif': 'image',
    # Video
    '.mp4': 'video', '.mkv': 'video', '.avi': 'video', '.mov': 'video',
    '.wmv': 'video', '.flv': 'video', '.webm': 'video', '.m4v': 'video',
    # Audio
    '.mp3': 'audio', '.wav': 'audio', '.flac': 'audio', '.aac': 'audio',
    '.ogg': 'audio', '.wma': 'audio', '.m4a': 'audio',
    # Code
    '.py': 'code', '.js': 'code', '.ts': 'code', '.tsx': 'code', '.jsx': 'code',
    '.java': 'code', '.c': 'code', '.cpp': 'code', '.h': 'code', '.hpp': 'code',
    '.cs': 'code', '.go': 'code', '.rs': 'code', '.rb': 'code', '.php': 'code',
    '.swift': 'code', '.kt': 'code', '.scala': 'code', '.r': 'code',
    '.sql': 'code', '.sh': 'code', '.bash': 'code', '.ps1': 'code', '.bat': 'code',
    '.json': 'code', '.yaml': 'code', '.yml': 'code', '.toml': 'code', '.xml': 'code',
    '.html': 'code', '.css': 'code', '.scss': 'code', '.less': 'code',
    # Binary/Executables
    '.dll': 'binary', '.so': 'binary', '.dylib': 'binary',
    '.dmg': 'binary',
    # Archives
    '.zip': 'archive', '.rar': 'archive', '.7z': 'archive', '.tar': 'archive',
    '.gz': 'archive', '.bz2': 'archive', '.xz': 'archive',
}

# Smart ignore patterns (folders/files to skip)
IGNORE_PATTERNS = frozenset([
    'node_modules', '.git', '.svn', '.hg', '__pycache__', '.pytest_cache',
    'venv', '.venv', 'env', '.env', 'virtualenv',
    'target', 'build', 'dist', 'out', 'bin', 'obj',
    '.vscode', '.idea', '.vs',
    'Application Data', 'Local Settings',
    '$Recycle.Bin', 'System Volume Information',
    'Thumbs.db', '.DS_Store', 'desktop.ini',
])

# Paths inside AppData that we ALLOW (everything else in AppData is skipped)
APPDATA_ALLOW_PATTERNS = [
    'microsoft/windows/start menu',
    'microsoft/windows/recent',
    'programs',
]

# Paths that should NEVER be skipped regardless of ignore patterns
# (these are primary sources for installed application discovery)
NEVER_SKIP_PATTERNS = [
    'start menu',
    'programdata/microsoft/windows',
]

# Large file extensions to skip content analysis (metadata only)
METADATA_ONLY_EXTENSIONS = frozenset([
    '.iso', '.vmdk', '.vdi', '.vhd', '.dmp', '.bak',
    '.exe', '.dll', '.so', '.dylib', '.msi', '.dmg',
    '.lnk', '.url',
])


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
_DB_PATH = os.path.abspath(os.path.join(_DATA_DIR, "file_index.db"))
os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class IndexedRoot:
    id: str
    path: str
    enabled: bool
    schedule: ScanSchedule
    interval_hours: Optional[int]
    last_scan_at: Optional[str]
    next_scan_at: Optional[str]
    last_scan_id: int
    created_at: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class IndexedFile:
    id: str
    root_id: str
    path: str
    filename: str
    extension: str
    kind: FileKind
    size: int
    mtime_ms: int
    content_hash: Optional[str]
    status: FileStatus
    last_seen_scan_id: int
    summary: Optional[str]
    keywords: Optional[str]
    vector: Optional[List[float]]
    summary_model_version: Optional[str]
    embedding_model_version: Optional[str]
    indexed_at: Optional[str]
    created_at: str
    error_message: Optional[str]
    
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['vector'] = None  # Don't serialize vector in API responses
        return d


@dataclass
class FolderSummary:
    id: str
    root_id: str
    path: str
    folder_hash: str  # Merkle-style hash of children
    file_count: int
    subfolder_count: int
    summary: Optional[str]
    keywords: Optional[str]
    vector: Optional[List[float]]
    last_updated_at: str
    
    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d['vector'] = None
        return d


# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")  # Better concurrent performance
    return conn


def _serialize_vector(vec: Optional[List[float]]) -> Optional[bytes]:
    if vec is None:
        return None
    return np.array(vec, dtype=np.float32).tobytes()


def _deserialize_vector(data: Optional[bytes]) -> Optional[List[float]]:
    if data is None:
        return None
    return np.frombuffer(data, dtype=np.float32).tolist()


def init() -> None:
    """Initialize the file index database schema."""
    with get_conn() as conn:
        cur = conn.cursor()
        
        # Indexed roots table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS indexed_roots (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                enabled INTEGER DEFAULT 1,
                schedule TEXT DEFAULT 'daily' CHECK(schedule IN ('off', 'hourly', 'daily', 'weekly', 'custom')),
                interval_hours INTEGER,
                last_scan_at TEXT,
                next_scan_at TEXT,
                last_scan_id INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """)
        
        # Indexed files table with FTS5 for fast text search
        cur.execute("""
            CREATE TABLE IF NOT EXISTS indexed_files (
                id TEXT PRIMARY KEY,
                root_id TEXT NOT NULL REFERENCES indexed_roots(id) ON DELETE CASCADE,
                path TEXT NOT NULL UNIQUE,
                filename TEXT NOT NULL,
                extension TEXT,
                kind TEXT DEFAULT 'other' CHECK(kind IN ('document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'folder', 'application', 'other')),
                size INTEGER NOT NULL,
                mtime_ms INTEGER NOT NULL,
                content_hash TEXT,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'indexed', 'stale', 'error', 'deleted')),
                last_seen_scan_id INTEGER DEFAULT 0,
                summary TEXT,
                keywords TEXT,
                vector BLOB,
                summary_model_version TEXT,
                embedding_model_version TEXT,
                indexed_at TEXT,
                created_at TEXT NOT NULL,
                error_message TEXT
            )
        """)
        
        # Check if migration is needed (if 'application' is missing from constraints)
        try:
            schema = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='indexed_files'").fetchone()[0]
            if "'application'" not in schema:
                # Migration needed
                print("Migrating database schema to include 'application' kind...")
                
                # 1. Rename old table
                conn.execute("ALTER TABLE indexed_files RENAME TO indexed_files_old")
                
                # 2. Create new table
                conn.execute("""
                    CREATE TABLE indexed_files (
                        id TEXT PRIMARY KEY,
                        root_id TEXT NOT NULL REFERENCES indexed_roots(id) ON DELETE CASCADE,
                        path TEXT NOT NULL UNIQUE,
                        filename TEXT NOT NULL,
                        extension TEXT,
                        kind TEXT DEFAULT 'other' CHECK(kind IN ('document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'folder', 'application', 'other')),
                        size INTEGER NOT NULL,
                        mtime_ms INTEGER NOT NULL,
                        content_hash TEXT,
                        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'indexed', 'stale', 'error', 'deleted')),
                        last_seen_scan_id INTEGER DEFAULT 0,
                        summary TEXT,
                        keywords TEXT,
                        vector BLOB,
                        summary_model_version TEXT,
                        embedding_model_version TEXT,
                        indexed_at TEXT,
                        created_at TEXT NOT NULL,
                        error_message TEXT
                    )
                """)
                
                # 3. Copy data
                conn.execute("INSERT INTO indexed_files SELECT * FROM indexed_files_old")
                
                # 4. Drop old table
                conn.execute("DROP TABLE indexed_files_old")
                
                # 5. Recreate/ensure triggers exist (handled by code below)
                rebuild_fts = True
        except Exception as e:
            print(f"Migration check failed: {e}")

        rebuild_fts = False
        try:
            cols = [r[1] for r in cur.execute("PRAGMA table_info(files_fts)").fetchall()]
            if not cols or 'file_id' in cols:
                rebuild_fts = True
        except Exception:
            rebuild_fts = True

        cur.execute("DROP TRIGGER IF EXISTS files_fts_insert")
        cur.execute("DROP TRIGGER IF EXISTS files_fts_delete")
        cur.execute("DROP TRIGGER IF EXISTS files_fts_update")

        if rebuild_fts:
            cur.execute("DROP TABLE IF EXISTS files_fts")

        cur.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
                filename,
                path,
                summary,
                keywords,
                content='indexed_files',
                content_rowid='rowid'
            )
        """)

        cur.execute("""
            CREATE TRIGGER files_fts_insert AFTER INSERT ON indexed_files BEGIN
                INSERT INTO files_fts(rowid, filename, path, summary, keywords)
                VALUES (NEW.rowid, NEW.filename, NEW.path, NEW.summary, NEW.keywords);
            END
        """)

        cur.execute("""
            CREATE TRIGGER files_fts_delete AFTER DELETE ON indexed_files BEGIN
                INSERT INTO files_fts(files_fts, rowid, filename, path, summary, keywords)
                VALUES ('delete', OLD.rowid, OLD.filename, OLD.path, OLD.summary, OLD.keywords);
            END
        """)

        cur.execute("""
            CREATE TRIGGER files_fts_update AFTER UPDATE ON indexed_files BEGIN
                INSERT INTO files_fts(files_fts, rowid, filename, path, summary, keywords)
                VALUES ('delete', OLD.rowid, OLD.filename, OLD.path, OLD.summary, OLD.keywords);
                INSERT INTO files_fts(rowid, filename, path, summary, keywords)
                VALUES (NEW.rowid, NEW.filename, NEW.path, NEW.summary, NEW.keywords);
            END
        """)

        if rebuild_fts:
            cur.execute("INSERT INTO files_fts(files_fts) VALUES('rebuild')")
        
        # Folder summaries table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS folder_summaries (
                id TEXT PRIMARY KEY,
                root_id TEXT NOT NULL REFERENCES indexed_roots(id) ON DELETE CASCADE,
                path TEXT NOT NULL UNIQUE,
                folder_hash TEXT,
                file_count INTEGER DEFAULT 0,
                subfolder_count INTEGER DEFAULT 0,
                summary TEXT,
                keywords TEXT,
                vector BLOB,
                last_updated_at TEXT NOT NULL
            )
        """)
        
        # Indexes for efficient queries
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_root ON indexed_files(root_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_status ON indexed_files(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_kind ON indexed_files(kind)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_ext ON indexed_files(extension)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_hash ON indexed_files(content_hash)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_scan ON indexed_files(last_seen_scan_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_folders_root ON folder_summaries(root_id)")
        
        conn.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# ROOT OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def add_root(path: str, schedule: ScanSchedule = 'daily', interval_hours: Optional[int] = None) -> IndexedRoot:
    """Add a new indexed root folder."""
    rid = str(uuid.uuid4())
    now = _now_iso()
    path = os.path.normpath(os.path.abspath(path))
    
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO indexed_roots (id, path, enabled, schedule, interval_hours, last_scan_id, created_at)
               VALUES (?, ?, 1, ?, ?, 0, ?)""",
            (rid, path, schedule, interval_hours, now)
        )
        conn.commit()
    
    return IndexedRoot(
        id=rid, path=path, enabled=True, schedule=schedule,
        interval_hours=interval_hours, last_scan_at=None, next_scan_at=None,
        last_scan_id=0, created_at=now
    )


def get_root(root_id: str) -> Optional[IndexedRoot]:
    """Get a root by ID."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM indexed_roots WHERE id = ?", (root_id,)).fetchone()
        if not row:
            return None
        return IndexedRoot(
            id=row['id'], path=row['path'], enabled=bool(row['enabled']),
            schedule=row['schedule'], interval_hours=row['interval_hours'],
            last_scan_at=row['last_scan_at'], next_scan_at=row['next_scan_at'],
            last_scan_id=row['last_scan_id'], created_at=row['created_at']
        )


def get_root_by_path(path: str) -> Optional[IndexedRoot]:
    """Get a root by path."""
    path = os.path.normpath(os.path.abspath(path))
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM indexed_roots WHERE path = ?", (path,)).fetchone()
        if not row:
            return None
        return IndexedRoot(
            id=row['id'], path=row['path'], enabled=bool(row['enabled']),
            schedule=row['schedule'], interval_hours=row['interval_hours'],
            last_scan_at=row['last_scan_at'], next_scan_at=row['next_scan_at'],
            last_scan_id=row['last_scan_id'], created_at=row['created_at']
        )


def list_roots(enabled_only: bool = False) -> List[IndexedRoot]:
    """List all indexed roots."""
    with get_conn() as conn:
        if enabled_only:
            rows = conn.execute("SELECT * FROM indexed_roots WHERE enabled = 1 ORDER BY path").fetchall()
        else:
            rows = conn.execute("SELECT * FROM indexed_roots ORDER BY path").fetchall()
    
    return [
        IndexedRoot(
            id=r['id'], path=r['path'], enabled=bool(r['enabled']),
            schedule=r['schedule'], interval_hours=r['interval_hours'],
            last_scan_at=r['last_scan_at'], next_scan_at=r['next_scan_at'],
            last_scan_id=r['last_scan_id'], created_at=r['created_at']
        )
        for r in rows
    ]


def update_root(root_id: str, enabled: Optional[bool] = None, schedule: Optional[ScanSchedule] = None,
                interval_hours: Optional[int] = None) -> Optional[IndexedRoot]:
    """Update root settings."""
    updates = []
    values = []
    
    if enabled is not None:
        updates.append("enabled = ?")
        values.append(1 if enabled else 0)
    if schedule is not None:
        updates.append("schedule = ?")
        values.append(schedule)
    if interval_hours is not None:
        updates.append("interval_hours = ?")
        values.append(interval_hours)
    
    if not updates:
        return get_root(root_id)
    
    values.append(root_id)
    
    with get_conn() as conn:
        conn.execute(f"UPDATE indexed_roots SET {', '.join(updates)} WHERE id = ?", tuple(values))
        conn.commit()
    
    return get_root(root_id)


def delete_root(root_id: str) -> bool:
    """Delete a root and all its indexed files."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM indexed_roots WHERE id = ?", (root_id,))
        conn.commit()
        return cur.rowcount > 0


def increment_scan_id(root_id: str) -> int:
    """Increment and return the scan ID for a root."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE indexed_roots SET last_scan_id = last_scan_id + 1, last_scan_at = ? WHERE id = ?",
            (_now_iso(), root_id)
        )
        row = conn.execute("SELECT last_scan_id FROM indexed_roots WHERE id = ?", (root_id,)).fetchone()
        conn.commit()
        return row['last_scan_id'] if row else 0


# ═══════════════════════════════════════════════════════════════════════════════
# FILE OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def get_file_kind(extension: str) -> FileKind:
    """Determine file kind from extension."""
    ext = extension.lower() if extension else ''
    return EXT_TO_KIND.get(ext, 'other')


def should_skip_path(path: str) -> bool:
    """Check if a path should be skipped based on ignore patterns."""
    normalized = path.replace('\\', '/').lower()
    parts = path.replace('\\', '/').split('/')
    
    # NEVER skip paths that are critical for app discovery (Start Menu, ProgramData, etc.)
    if sys.platform == 'win32':
        for allow in NEVER_SKIP_PATTERNS:
            if allow in normalized:
                return False
    
    # Check if this path is inside an AppData-allowed location
    is_appdata_allowed = False
    if sys.platform == 'win32' and 'appdata' in normalized:
        for allow in APPDATA_ALLOW_PATTERNS:
            if allow in normalized:
                is_appdata_allowed = True
                break
    
    for part in parts:
        if part in IGNORE_PATTERNS:
            return True
        # AppData is only skipped if NOT in an allowed sub-path
        if part.lower() == 'appdata' and not is_appdata_allowed:
            return True
    return False


def upsert_file(root_id: str, path: str, size: int, mtime_ms: int, scan_id: int,
                content_hash: Optional[str] = None, kind_override: Optional[FileKind] = None) -> Tuple[IndexedFile, bool]:
    """
    Insert or update a file record. Returns (file, is_new_or_changed).
    
    - If file doesn't exist: create as 'pending'
    - If exists and unchanged (same size/mtime or same hash): just update last_seen_scan_id
    - If exists and changed: mark as 'stale' for re-indexing
    """
    path = os.path.normpath(os.path.abspath(path))
    filename = os.path.basename(path)
    extension = os.path.splitext(filename)[1].lower() if '.' in filename else ''
    kind = kind_override if kind_override else get_file_kind(extension)
    now = _now_iso()
    
    with get_conn() as conn:
        existing = conn.execute("SELECT * FROM indexed_files WHERE path = ?", (path,)).fetchone()
        
        if existing:
            # Check if content changed
            changed = False
            if existing['size'] != size or existing['mtime_ms'] != mtime_ms:
                # Stats changed - check hash if provided
                if content_hash and existing['content_hash'] == content_hash:
                    changed = False  # Content same despite stat change
                else:
                    changed = True
            
            if changed:
                # Mark as stale for re-indexing
                conn.execute(
                    """UPDATE indexed_files SET 
                       size = ?, mtime_ms = ?, content_hash = ?, status = 'stale', 
                       last_seen_scan_id = ? WHERE id = ?""",
                    (size, mtime_ms, content_hash, scan_id, existing['id'])
                )
            else:
                # Just update last seen
                conn.execute(
                    "UPDATE indexed_files SET last_seen_scan_id = ? WHERE id = ?",
                    (scan_id, existing['id'])
                )
            
            conn.commit()
            
            return IndexedFile(
                id=existing['id'], root_id=root_id, path=path, filename=filename,
                extension=extension, kind=kind, size=size, mtime_ms=mtime_ms,
                content_hash=content_hash or existing['content_hash'],
                status='stale' if changed else existing['status'],
                last_seen_scan_id=scan_id, summary=existing['summary'],
                keywords=existing['keywords'], vector=_deserialize_vector(existing['vector']),
                summary_model_version=existing['summary_model_version'],
                embedding_model_version=existing['embedding_model_version'],
                indexed_at=existing['indexed_at'], created_at=existing['created_at'],
                error_message=existing['error_message']
            ), changed
        else:
            # New file
            fid = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO indexed_files 
                   (id, root_id, path, filename, extension, kind, size, mtime_ms, 
                    content_hash, status, last_seen_scan_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
                (fid, root_id, path, filename, extension, kind, size, mtime_ms,
                 content_hash, scan_id, now)
            )
            conn.commit()
            
            return IndexedFile(
                id=fid, root_id=root_id, path=path, filename=filename,
                extension=extension, kind=kind, size=size, mtime_ms=mtime_ms,
                content_hash=content_hash, status='pending', last_seen_scan_id=scan_id,
                summary=None, keywords=None, vector=None,
                summary_model_version=None, embedding_model_version=None,
                indexed_at=None, created_at=now, error_message=None
            ), True


def upsert_files_batch(files_data: List[Dict[str, Any]]) -> Tuple[int, int, int]:
    """
    Batch upsert files in a single transaction.
    Returns (new_count, changed_count, unchanged_count).
    """
    new_count = 0
    changed_count = 0
    unchanged_count = 0
    now = _now_iso()
    
    with get_conn() as conn:
        for data in files_data:
            path = os.path.normpath(os.path.abspath(data['path']))
            filename = os.path.basename(path)
            extension = os.path.splitext(filename)[1].lower() if '.' in filename else ''
            kind = data.get('kind_override') or get_file_kind(extension)
            
            size = data['size']
            mtime_ms = data['mtime_ms']
            scan_id = data['scan_id']
            content_hash = data.get('content_hash')
            root_id = data['root_id']
            
            existing = conn.execute("SELECT id, size, mtime_ms, content_hash, status, kind FROM indexed_files WHERE path = ?", (path,)).fetchone()
            
            if existing:
                # Check if content changed
                changed = False
                kind_mismatch = existing['kind'] != kind
                
                if existing['size'] != size or existing['mtime_ms'] != mtime_ms:
                    # Stats changed - check hash if provided
                    if content_hash and existing['content_hash'] == content_hash:
                        changed = False
                    else:
                        changed = True
                
                if changed or kind_mismatch:
                    # If kind changed, we must update it. If content changed, we update that too.
                    conn.execute(
                        """UPDATE indexed_files SET 
                           size = ?, mtime_ms = ?, content_hash = ?, status = 'stale', 
                           kind = ?, last_seen_scan_id = ? WHERE id = ?""",
                        (size, mtime_ms, content_hash, kind, scan_id, existing['id'])
                    )
                    changed_count += 1
                else:
                    conn.execute(
                        "UPDATE indexed_files SET last_seen_scan_id = ? WHERE id = ?",
                        (scan_id, existing['id'])
                    )
                    unchanged_count += 1
            else:
                # New file
                fid = str(uuid.uuid4())
                conn.execute(
                    """INSERT INTO indexed_files 
                       (id, root_id, path, filename, extension, kind, size, mtime_ms, 
                        content_hash, status, last_seen_scan_id, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
                    (fid, root_id, path, filename, extension, kind, size, mtime_ms,
                     content_hash, scan_id, now)
                )
                new_count += 1
        
        conn.commit()
        
    return new_count, changed_count, unchanged_count


def get_root_file_metadata(root_id: str) -> Dict[str, Tuple[int, int, Optional[str]]]:
    """
    Get a map of path -> (size, mtime_ms, content_hash) for all files in a root.
    Used for fast change detection during scanning.
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT path, size, mtime_ms, content_hash FROM indexed_files WHERE root_id = ? AND status != 'deleted'",
            (root_id,)
        ).fetchall()
        return {r['path']: (r['size'], r['mtime_ms'], r['content_hash']) for r in rows}


def get_file(file_id: str) -> Optional[IndexedFile]:
    """Get a file by ID."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM indexed_files WHERE id = ?", (file_id,)).fetchone()
        if not row:
            return None
        return _row_to_file(row)


def get_file_by_path(path: str) -> Optional[IndexedFile]:
    """Get a file by path."""
    path = os.path.normpath(os.path.abspath(path))
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM indexed_files WHERE path = ?", (path,)).fetchone()
        if not row:
            return None
        return _row_to_file(row)


def _row_to_file(row: sqlite3.Row) -> IndexedFile:
    return IndexedFile(
        id=row['id'], root_id=row['root_id'], path=row['path'],
        filename=row['filename'], extension=row['extension'], kind=row['kind'],
        size=row['size'], mtime_ms=row['mtime_ms'], content_hash=row['content_hash'],
        status=row['status'], last_seen_scan_id=row['last_seen_scan_id'],
        summary=row['summary'], keywords=row['keywords'],
        vector=_deserialize_vector(row['vector']),
        summary_model_version=row['summary_model_version'],
        embedding_model_version=row['embedding_model_version'],
        indexed_at=row['indexed_at'], created_at=row['created_at'],
        error_message=row['error_message']
    )


def mark_deleted_files(root_id: str, scan_id: int) -> int:
    """Mark files not seen in this scan as deleted. Returns count."""
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE indexed_files SET status = 'deleted' 
               WHERE root_id = ? AND last_seen_scan_id < ? AND status != 'deleted'""",
            (root_id, scan_id)
        )
        conn.commit()
        return cur.rowcount


def get_pending_files(limit: int = 100) -> List[IndexedFile]:
    """Get files pending indexing (status = pending or stale)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM indexed_files 
               WHERE status IN ('pending', 'stale') 
               ORDER BY created_at LIMIT ?""",
            (limit,)
        ).fetchall()
    return [_row_to_file(r) for r in rows]


def update_file_index(file_id: str, summary: str, keywords: str, vector: List[float],
                      summary_model: str, embedding_model: str) -> bool:
    """Update a file with its summary, keywords, and vector embedding."""
    now = _now_iso()
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE indexed_files SET 
               summary = ?, keywords = ?, vector = ?, 
               summary_model_version = ?, embedding_model_version = ?,
               status = 'indexed', indexed_at = ?, error_message = NULL
               WHERE id = ?""",
            (summary, keywords, _serialize_vector(vector), summary_model, embedding_model, now, file_id)
        )
        conn.commit()
        return cur.rowcount > 0


def update_file_error(file_id: str, error_message: str) -> bool:
    """Mark a file as errored."""
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE indexed_files SET status = 'error', error_message = ? WHERE id = ?",
            (error_message, file_id)
        )
        conn.commit()
        return cur.rowcount > 0


def find_by_hash(content_hash: str, exclude_id: Optional[str] = None) -> Optional[IndexedFile]:
    """Find a file by content hash (for move detection)."""
    with get_conn() as conn:
        if exclude_id:
            row = conn.execute(
                "SELECT * FROM indexed_files WHERE content_hash = ? AND id != ? AND status != 'deleted' LIMIT 1",
                (content_hash, exclude_id)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM indexed_files WHERE content_hash = ? AND status != 'deleted' LIMIT 1",
                (content_hash,)
            ).fetchone()
        if not row:
            return None
        return _row_to_file(row)


def get_deleted_files_with_hash(root_id: str) -> List[IndexedFile]:
    """Get recently deleted files that have content hashes (for move detection)."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM indexed_files 
               WHERE root_id = ? AND status = 'deleted' AND content_hash IS NOT NULL""",
            (root_id,)
        ).fetchall()
    return [_row_to_file(r) for r in rows]


def transfer_file_metadata(from_id: str, to_path: str) -> bool:
    """Transfer summary/vector from one file to another (move detection)."""
    with get_conn() as conn:
        old = conn.execute("SELECT * FROM indexed_files WHERE id = ?", (from_id,)).fetchone()
        if not old:
            return False
        
        to_path = os.path.normpath(os.path.abspath(to_path))
        cur = conn.execute(
            """UPDATE indexed_files SET 
               summary = ?, keywords = ?, vector = ?,
               summary_model_version = ?, embedding_model_version = ?,
               status = 'indexed', indexed_at = ?
               WHERE path = ?""",
            (old['summary'], old['keywords'], old['vector'],
             old['summary_model_version'], old['embedding_model_version'],
             old['indexed_at'], to_path)
        )
        conn.commit()
        return cur.rowcount > 0


def purge_deleted_files(root_id: Optional[str] = None) -> int:
    """Permanently delete files marked as deleted. Returns count."""
    with get_conn() as conn:
        if root_id:
            cur = conn.execute(
                "DELETE FROM indexed_files WHERE root_id = ? AND status = 'deleted'",
                (root_id,)
            )
        else:
            cur = conn.execute("DELETE FROM indexed_files WHERE status = 'deleted'")
        conn.commit()
        return cur.rowcount


# ═══════════════════════════════════════════════════════════════════════════════
# SEARCH OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def search_fts(query: str, limit: int = 50, kind: Optional[FileKind] = None,
               root_id: Optional[str] = None) -> List[IndexedFile]:
    """Full-text search on filename, path, summary, keywords."""
    
    # Pre-process query for better partial matching (prefix search)
    # If user didn't use quotes, we assume they want prefix matching on all terms
    original_query = query.strip()
    if '"' not in query:
        terms = query.strip().split()
        if terms:
            # "foo bar" -> "foo* AND bar*"
            # This allows "dow" to match "Downloads", "pro" to match "Projects"
            query = " AND ".join([f"{t}*" if not t.endswith('*') else t for t in terms])

    # Build the query
    base_sql = """
        SELECT f.* FROM indexed_files f
        JOIN files_fts ON f.rowid = files_fts.rowid
        WHERE files_fts MATCH ? AND f.status != 'deleted'
    """
    params: List[Any] = [query]

    if kind:
        base_sql += " AND f.kind = ?"
        params.append(kind)
    if root_id:
        base_sql += " AND f.root_id = ?"
        params.append(root_id)

    # NOTE: bm25() must reference the *real* FTS table name, not an alias.
    base_sql += " ORDER BY bm25(files_fts) LIMIT ?"
    params.append(limit)

    rows = []
    try:
        with get_conn() as conn:
            rows = conn.execute(base_sql, tuple(params)).fetchall()
    except sqlite3.OperationalError as e:
        msg = str(e)
        if ('no such table: files_fts' in msg) or (('no such column' in msg) and ('file_id' in msg)):
            try:
                init()
            except Exception:
                pass
            with get_conn() as conn:
                rows = conn.execute(base_sql, tuple(params)).fetchall()
        elif 'no such function: bm25' in msg:
            fallback_sql = base_sql.replace(" ORDER BY bm25(files_fts) LIMIT ?", " LIMIT ?")
            with get_conn() as conn:
                rows = conn.execute(fallback_sql, tuple(params)).fetchall()
        elif 'syntax error' in msg:
            # Fallback: quote the query to treat it as a literal phrase
            # This handles cases like filenames with dots "image.png" which confuse FTS parser
            params[0] = f'"{params[0]}"'
            with get_conn() as conn:
                rows = conn.execute(base_sql, tuple(params)).fetchall()
        else:
            raise

    results = [_row_to_file(r) for r in rows]
    
    # If FTS returned few results, supplement with LIKE search on filename
    # This catches cases where FTS tokenization misses partial app names
    if len(results) < limit and original_query and len(original_query) >= 2:
        existing_ids = {r.id for r in results}
        like_sql = """
            SELECT * FROM indexed_files
            WHERE status != 'deleted' AND (filename LIKE ? OR path LIKE ?)
        """
        like_params: List[Any] = [f'%{original_query}%', f'%{original_query}%']
        if kind:
            like_sql += " AND kind = ?"
            like_params.append(kind)
        if root_id:
            like_sql += " AND root_id = ?"
            like_params.append(root_id)
        like_sql += " ORDER BY CASE WHEN kind = 'application' THEN 0 WHEN extension IN ('.lnk','.url','.appref-ms','.exe') THEN 0 ELSE 1 END, filename LIMIT ?"
        like_params.append(limit - len(results))
        
        try:
            with get_conn() as conn:
                like_rows = conn.execute(like_sql, tuple(like_params)).fetchall()
            for r in like_rows:
                f = _row_to_file(r)
                if f.id not in existing_ids:
                    results.append(f)
                    existing_ids.add(f.id)
        except Exception:
            pass  # LIKE fallback is best-effort
    
    return results


def search_vector(query_vector: List[float], limit: int = 20, threshold: float = 0.65,
                  kind: Optional[FileKind] = None, root_id: Optional[str] = None) -> List[Tuple[IndexedFile, float]]:
    """Vector similarity search using cosine similarity."""
    query_np = np.array(query_vector, dtype=np.float32)
    
    with get_conn() as conn:
        conditions = ["status = 'indexed'", "vector IS NOT NULL"]
        params: List[Any] = []
        
        if kind:
            conditions.append("kind = ?")
            params.append(kind)
        if root_id:
            conditions.append("root_id = ?")
            params.append(root_id)
        
        where = " AND ".join(conditions)
        rows = conn.execute(f"SELECT * FROM indexed_files WHERE {where}", tuple(params)).fetchall()
    
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
                results.append((_row_to_file(row), score))
    
    results.sort(key=lambda x: x[1], reverse=True)
    return results[:limit]


def hybrid_search(query: str, query_vector: Optional[List[float]] = None,
                  limit: int = 20, kind: Optional[FileKind] = None,
                  root_id: Optional[str] = None) -> List[Tuple[IndexedFile, float, str]]:
    """
    Hybrid search combining FTS and vector search.
    Returns (file, score, match_type) tuples.
    """
    results_map: Dict[str, Tuple[IndexedFile, float, str]] = {}
    
    # FTS search
    fts_results = search_fts(query, limit=limit * 2, kind=kind, root_id=root_id)
    for i, f in enumerate(fts_results):
        # FTS rank as score (higher is better, normalize roughly)
        score = 1.0 - (i / len(fts_results)) if fts_results else 0.5
        results_map[f.id] = (f, score, 'fts')
    
    # Vector search if vector provided
    if query_vector:
        vec_results = search_vector(query_vector, limit=limit * 2, kind=kind, root_id=root_id)
        for f, score in vec_results:
            if f.id in results_map:
                # Boost if found in both
                existing = results_map[f.id]
                combined_score = (existing[1] + score) / 2 + 0.2  # Boost for appearing in both
                results_map[f.id] = (f, min(combined_score, 1.0), 'hybrid')
            else:
                results_map[f.id] = (f, score, 'vector')
    
    # Sort by score and return top results
    sorted_results = sorted(results_map.values(), key=lambda x: x[1], reverse=True)
    return sorted_results[:limit]


# ═══════════════════════════════════════════════════════════════════════════════
# FOLDER SUMMARY OPERATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def upsert_folder_summary(root_id: str, path: str, folder_hash: str,
                          file_count: int, subfolder_count: int,
                          summary: Optional[str] = None, keywords: Optional[str] = None,
                          vector: Optional[List[float]] = None) -> FolderSummary:
    """Insert or update a folder summary."""
    path = os.path.normpath(os.path.abspath(path))
    now = _now_iso()
    
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM folder_summaries WHERE path = ?", (path,)).fetchone()
        
        if existing:
            conn.execute(
                """UPDATE folder_summaries SET 
                   folder_hash = ?, file_count = ?, subfolder_count = ?,
                   summary = ?, keywords = ?, vector = ?, last_updated_at = ?
                   WHERE id = ?""",
                (folder_hash, file_count, subfolder_count, summary, keywords,
                 _serialize_vector(vector), now, existing['id'])
            )
            fid = existing['id']
        else:
            fid = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO folder_summaries 
                   (id, root_id, path, folder_hash, file_count, subfolder_count,
                    summary, keywords, vector, last_updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (fid, root_id, path, folder_hash, file_count, subfolder_count,
                 summary, keywords, _serialize_vector(vector), now)
            )
        conn.commit()
    
    return FolderSummary(
        id=fid, root_id=root_id, path=path, folder_hash=folder_hash,
        file_count=file_count, subfolder_count=subfolder_count,
        summary=summary, keywords=keywords, vector=vector, last_updated_at=now
    )


def get_folder_summary(path: str) -> Optional[FolderSummary]:
    """Get folder summary by path."""
    path = os.path.normpath(os.path.abspath(path))
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM folder_summaries WHERE path = ?", (path,)).fetchone()
        if not row:
            return None
        return FolderSummary(
            id=row['id'], root_id=row['root_id'], path=row['path'],
            folder_hash=row['folder_hash'], file_count=row['file_count'],
            subfolder_count=row['subfolder_count'], summary=row['summary'],
            keywords=row['keywords'], vector=_deserialize_vector(row['vector']),
            last_updated_at=row['last_updated_at']
        )


# ═══════════════════════════════════════════════════════════════════════════════
# STATS
# ═══════════════════════════════════════════════════════════════════════════════

def get_stats() -> Dict[str, Any]:
    """Get database statistics."""
    with get_conn() as conn:
        root_count = conn.execute("SELECT COUNT(*) FROM indexed_roots WHERE enabled = 1").fetchone()[0]
        file_count = conn.execute("SELECT COUNT(*) FROM indexed_files WHERE status != 'deleted'").fetchone()[0]
        indexed_count = conn.execute("SELECT COUNT(*) FROM indexed_files WHERE status = 'indexed'").fetchone()[0]
        pending_count = conn.execute("SELECT COUNT(*) FROM indexed_files WHERE status IN ('pending', 'stale')").fetchone()[0]
        folder_count = conn.execute("SELECT COUNT(*) FROM folder_summaries").fetchone()[0]
        
        # Count by kind
        kind_counts = {}
        for row in conn.execute(
            "SELECT kind, COUNT(*) as cnt FROM indexed_files WHERE status != 'deleted' GROUP BY kind"
        ).fetchall():
            kind_counts[row['kind']] = row['cnt']
    
    return {
        "roots": root_count,
        "total_files": file_count,
        "indexed_files": indexed_count,
        "pending_files": pending_count,
        "folders": folder_count,
        "files_by_kind": kind_counts,
    }


# Initialize on import
try:
    init()
except Exception as e:
    print(f"[file_index_db] Init error: {e}")
    init()
except Exception as e:
    print(f"[file_index_db] Init error: {e}")
