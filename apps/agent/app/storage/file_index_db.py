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
BULK_LOOKUP_CHUNK_SIZE = 500

FileKind = Literal['document', 'image', 'video', 'audio', 'code', 'binary', 'archive', 'folder', 'application', 'other']
FileStatus = Literal['pending', 'indexed', 'stale', 'error', 'deleted']
ScanSchedule = Literal['off', 'hourly', 'daily', 'weekly', 'custom']
PreviewKind = Literal['icon', 'thumbnail']
RootBackend = Literal['generic', 'win32']
WatchState = Literal['inactive', 'active', 'error']

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

THUMBNAIL_EXTENSIONS = frozenset([
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico',
    '.heic', '.heif', '.tiff', '.tif',
])

_UNSET = object()


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
    backend: RootBackend
    watch_state: WatchState
    volume_serial: Optional[str]
    last_reconcile_at: Optional[str]
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
    volume_serial: Optional[str]
    file_id: Optional[str]
    parent_file_id: Optional[str]
    win_attrs: Optional[int]
    content_hash: Optional[str]
    preview_kind: PreviewKind
    preview_eligible: bool
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
        d['preview_eligible'] = bool(d['preview_eligible'])
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


def _normalize_volume_serial(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized or None
    try:
        return f"{int(value):016x}"
    except (TypeError, ValueError):
        return str(value).strip().lower() or None


def _get_preview_fields(extension: str, kind: FileKind) -> Tuple[PreviewKind, bool]:
    ext = (extension or '').lower()
    if kind == 'image' and ext in THUMBNAIL_EXTENSIONS:
        return 'thumbnail', True
    return 'icon', True


def _row_to_root(row: sqlite3.Row) -> IndexedRoot:
    return IndexedRoot(
        id=row['id'],
        path=row['path'],
        enabled=bool(row['enabled']),
        schedule=row['schedule'],
        interval_hours=row['interval_hours'],
        last_scan_at=row['last_scan_at'],
        next_scan_at=row['next_scan_at'],
        last_scan_id=row['last_scan_id'],
        backend=row['backend'] or 'generic',
        watch_state=row['watch_state'] or 'inactive',
        volume_serial=_normalize_volume_serial(row['volume_serial']),
        last_reconcile_at=row['last_reconcile_at'],
        created_at=row['created_at'],
    )


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def init() -> None:
    """Initialize the file index database schema."""
    with get_conn() as conn:
        cur = conn.cursor()
        rebuild_fts = False
        
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
                backend TEXT DEFAULT 'generic',
                watch_state TEXT DEFAULT 'inactive',
                volume_serial TEXT,
                last_reconcile_at TEXT,
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
                volume_serial TEXT,
                file_id TEXT,
                parent_file_id TEXT,
                win_attrs INTEGER,
                content_hash TEXT,
                preview_kind TEXT DEFAULT 'icon',
                preview_eligible INTEGER DEFAULT 1,
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

        try:
            schema_row = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='indexed_files'"
            ).fetchone()
            schema = schema_row[0] if schema_row else ""
            if schema and "'application'" not in schema:
                print("Migrating database schema to include 'application' kind...")
                conn.execute("ALTER TABLE indexed_files RENAME TO indexed_files_old")
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
                        volume_serial TEXT,
                        file_id TEXT,
                        parent_file_id TEXT,
                        win_attrs INTEGER,
                        content_hash TEXT,
                        preview_kind TEXT DEFAULT 'icon',
                        preview_eligible INTEGER DEFAULT 1,
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
                old_cols = [r[1] for r in conn.execute("PRAGMA table_info(indexed_files_old)").fetchall()]
                new_cols = [r[1] for r in conn.execute("PRAGMA table_info(indexed_files)").fetchall()]
                copy_cols = [c for c in new_cols if c in old_cols]
                if copy_cols:
                    cols_sql = ", ".join(copy_cols)
                    conn.execute(
                        f"INSERT INTO indexed_files ({cols_sql}) SELECT {cols_sql} FROM indexed_files_old"
                    )
                conn.execute("DROP TABLE indexed_files_old")
                rebuild_fts = True
        except Exception as e:
            print(f"Migration check failed: {e}")

        _ensure_column(conn, "indexed_roots", "backend", "TEXT DEFAULT 'generic'")
        _ensure_column(conn, "indexed_roots", "watch_state", "TEXT DEFAULT 'inactive'")
        _ensure_column(conn, "indexed_roots", "volume_serial", "TEXT")
        _ensure_column(conn, "indexed_roots", "last_reconcile_at", "TEXT")

        _ensure_column(conn, "indexed_files", "volume_serial", "TEXT")
        _ensure_column(conn, "indexed_files", "file_id", "TEXT")
        _ensure_column(conn, "indexed_files", "parent_file_id", "TEXT")
        _ensure_column(conn, "indexed_files", "win_attrs", "INTEGER")
        _ensure_column(conn, "indexed_files", "preview_kind", "TEXT DEFAULT 'icon'")
        _ensure_column(conn, "indexed_files", "preview_eligible", "INTEGER DEFAULT 1")

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
            CREATE TRIGGER files_fts_update AFTER UPDATE ON indexed_files
            WHEN OLD.filename IS NOT NEW.filename
              OR OLD.path IS NOT NEW.path
              OR OLD.summary IS NOT NEW.summary
              OR OLD.keywords IS NOT NEW.keywords
            BEGIN
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
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_identity ON indexed_files(root_id, volume_serial, file_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_parent_identity ON indexed_files(root_id, volume_serial, parent_file_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_root_status ON indexed_files(root_id, status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_root_kind_status ON indexed_files(root_id, kind, status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_root_mtime ON indexed_files(root_id, mtime_ms DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_files_filename_nocase ON indexed_files(filename COLLATE NOCASE)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_roots_backend ON indexed_roots(backend)")
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
    backend: RootBackend = 'win32' if sys.platform == 'win32' else 'generic'
    
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO indexed_roots
               (id, path, enabled, schedule, interval_hours, last_scan_id, backend, watch_state, created_at)
               VALUES (?, ?, 1, ?, ?, 0, ?, 'inactive', ?)""",
            (rid, path, schedule, interval_hours, backend, now)
        )
        conn.commit()
    
    return IndexedRoot(
        id=rid,
        path=path,
        enabled=True,
        schedule=schedule,
        interval_hours=interval_hours,
        last_scan_at=None,
        next_scan_at=None,
        last_scan_id=0,
        backend=backend,
        watch_state='inactive',
        volume_serial=None,
        last_reconcile_at=None,
        created_at=now,
    )


def get_root(root_id: str) -> Optional[IndexedRoot]:
    """Get a root by ID."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM indexed_roots WHERE id = ?", (root_id,)).fetchone()
    return _row_to_root(row) if row else None


def get_root_by_path(path: str) -> Optional[IndexedRoot]:
    """Get a root by path."""
    path = os.path.normpath(os.path.abspath(path))
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM indexed_roots WHERE path = ?", (path,)).fetchone()
    return _row_to_root(row) if row else None


def list_roots(enabled_only: bool = False) -> List[IndexedRoot]:
    """List all indexed roots."""
    with get_conn() as conn:
        if enabled_only:
            rows = conn.execute("SELECT * FROM indexed_roots WHERE enabled = 1 ORDER BY path").fetchall()
        else:
            rows = conn.execute("SELECT * FROM indexed_roots ORDER BY path").fetchall()
    
    return [_row_to_root(r) for r in rows]


def update_root(root_id: str, enabled: Optional[bool] = None, schedule: Optional[ScanSchedule] = None,
                interval_hours: Optional[int] = None, backend: Optional[RootBackend] = None,
                watch_state: Optional[WatchState] = None, volume_serial: Any = _UNSET,
                last_reconcile_at: Any = _UNSET, next_scan_at: Any = _UNSET) -> Optional[IndexedRoot]:
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
    if backend is not None:
        updates.append("backend = ?")
        values.append(backend)
    if watch_state is not None:
        updates.append("watch_state = ?")
        values.append(watch_state)
    if volume_serial is not _UNSET:
        updates.append("volume_serial = ?")
        values.append(_normalize_volume_serial(volume_serial))
    if last_reconcile_at is not _UNSET:
        updates.append("last_reconcile_at = ?")
        values.append(last_reconcile_at)
    if next_scan_at is not _UNSET:
        updates.append("next_scan_at = ?")
        values.append(next_scan_at)
    
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


def increment_scan_id(root_id: str, backend: Optional[RootBackend] = None,
                      volume_serial: Optional[str] = None, last_reconcile_at: Any = _UNSET) -> int:
    """Increment and return the scan ID for a root."""
    now = _now_iso()
    updates = ["last_scan_id = last_scan_id + 1", "last_scan_at = ?"]
    values: List[Any] = [now]
    if backend is not None:
        updates.append("backend = ?")
        values.append(backend)
    if volume_serial is not None:
        updates.append("volume_serial = ?")
        values.append(_normalize_volume_serial(volume_serial))
    if last_reconcile_at is not _UNSET:
        updates.append("last_reconcile_at = ?")
        values.append(last_reconcile_at if last_reconcile_at is not None else now)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE indexed_roots SET {', '.join(updates)} WHERE id = ?",
            (*values, root_id)
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


def _build_indexed_file(
    *,
    id: str,
    root_id: str,
    path: str,
    filename: str,
    extension: str,
    kind: FileKind,
    size: int,
    mtime_ms: int,
    volume_serial: Optional[str],
    file_id: Optional[str],
    parent_file_id: Optional[str],
    win_attrs: Optional[int],
    content_hash: Optional[str],
    preview_kind: PreviewKind,
    preview_eligible: bool,
    status: FileStatus,
    last_seen_scan_id: int,
    summary: Optional[str],
    keywords: Optional[str],
    vector: Optional[List[float]],
    summary_model_version: Optional[str],
    embedding_model_version: Optional[str],
    indexed_at: Optional[str],
    created_at: str,
    error_message: Optional[str],
) -> IndexedFile:
    return IndexedFile(
        id=id,
        root_id=root_id,
        path=path,
        filename=filename,
        extension=extension,
        kind=kind,
        size=size,
        mtime_ms=mtime_ms,
        volume_serial=_normalize_volume_serial(volume_serial),
        file_id=file_id,
        parent_file_id=parent_file_id,
        win_attrs=win_attrs,
        content_hash=content_hash,
        preview_kind=preview_kind,
        preview_eligible=bool(preview_eligible),
        status=status,
        last_seen_scan_id=last_seen_scan_id,
        summary=summary,
        keywords=keywords,
        vector=vector,
        summary_model_version=summary_model_version,
        embedding_model_version=embedding_model_version,
        indexed_at=indexed_at,
        created_at=created_at,
        error_message=error_message,
    )


def _upsert_file_row(
    conn: sqlite3.Connection,
    root_id: str,
    path: str,
    size: int,
    mtime_ms: int,
    scan_id: int,
    content_hash: Optional[str] = None,
    kind_override: Optional[FileKind] = None,
    volume_serial: Optional[str] = None,
    file_id: Optional[str] = None,
    parent_file_id: Optional[str] = None,
    win_attrs: Optional[int] = None,
    preview_kind: Optional[PreviewKind] = None,
    preview_eligible: Optional[bool] = None,
) -> Tuple[IndexedFile, str]:
    path = os.path.normpath(os.path.abspath(path))
    filename = os.path.basename(path)
    extension = os.path.splitext(filename)[1].lower() if '.' in filename else ''
    kind = kind_override if kind_override else get_file_kind(extension)
    resolved_preview_kind, resolved_preview_eligible = _get_preview_fields(extension, kind)
    preview_kind = preview_kind or resolved_preview_kind
    if preview_eligible is None:
        preview_eligible = resolved_preview_eligible
    volume_serial = _normalize_volume_serial(volume_serial)
    now = _now_iso()

    existing = conn.execute("SELECT * FROM indexed_files WHERE path = ?", (path,)).fetchone()
    matched_by_identity = False
    if not existing and volume_serial and file_id:
        existing = conn.execute(
            """SELECT * FROM indexed_files
               WHERE root_id = ? AND volume_serial = ? AND file_id = ?
               ORDER BY CASE WHEN status = 'deleted' THEN 1 ELSE 0 END, created_at
               LIMIT 1""",
            (root_id, volume_serial, file_id),
        ).fetchone()
        matched_by_identity = existing is not None

    if existing:
        # Preserve existing identity columns when caller didn't supply new ones.
        # Why: the Windows fast-path scanner now skips per-file CreateFileW for speed,
        # so file_id/volume_serial/parent_file_id/win_attrs come in as None for files.
        # Clobbering with None would lose previously-collected identity data.
        existing_volume_norm = _normalize_volume_serial(existing['volume_serial'])
        effective_volume_serial = volume_serial if volume_serial else existing_volume_norm
        effective_file_id = file_id if file_id is not None else existing['file_id']
        effective_parent_file_id = parent_file_id if parent_file_id is not None else existing['parent_file_id']
        effective_win_attrs = win_attrs if win_attrs is not None else existing['win_attrs']

        identity_changed = (
            bool(file_id)
            and bool(existing['file_id'])
            and (
                existing['file_id'] != file_id
                or existing_volume_norm != volume_serial
            )
        )
        changed = identity_changed
        kind_mismatch = existing['kind'] != kind

        if existing['size'] != size or existing['mtime_ms'] != mtime_ms:
            if content_hash and existing['content_hash'] == content_hash:
                changed = changed or False
            else:
                changed = True

        next_status: FileStatus
        if changed or kind_mismatch:
            next_status = 'stale'
        elif existing['status'] == 'deleted':
            next_status = 'indexed' if existing['summary'] or existing['vector'] else 'pending'
        else:
            next_status = existing['status']

        conn.execute(
            """UPDATE indexed_files SET
               root_id = ?, path = ?, filename = ?, extension = ?, kind = ?, size = ?, mtime_ms = ?,
               volume_serial = ?, file_id = ?, parent_file_id = ?, win_attrs = ?, content_hash = ?,
               preview_kind = ?, preview_eligible = ?, status = ?, last_seen_scan_id = ?
               WHERE id = ?""",
            (
                root_id,
                path,
                filename,
                extension,
                kind,
                size,
                mtime_ms,
                effective_volume_serial,
                effective_file_id,
                effective_parent_file_id,
                effective_win_attrs,
                content_hash or existing['content_hash'],
                preview_kind,
                1 if preview_eligible else 0,
                next_status,
                scan_id,
                existing['id'],
            ),
        )

        outcome = 'changed' if (changed or kind_mismatch or matched_by_identity or existing['status'] == 'deleted') else 'unchanged'
        return _build_indexed_file(
            id=existing['id'],
            root_id=root_id,
            path=path,
            filename=filename,
            extension=extension,
            kind=kind,
            size=size,
            mtime_ms=mtime_ms,
            volume_serial=effective_volume_serial,
            file_id=effective_file_id,
            parent_file_id=effective_parent_file_id,
            win_attrs=effective_win_attrs,
            content_hash=content_hash or existing['content_hash'],
            preview_kind=preview_kind,
            preview_eligible=preview_eligible,
            status=next_status,
            last_seen_scan_id=scan_id,
            summary=existing['summary'],
            keywords=existing['keywords'],
            vector=_deserialize_vector(existing['vector']),
            summary_model_version=existing['summary_model_version'],
            embedding_model_version=existing['embedding_model_version'],
            indexed_at=existing['indexed_at'],
            created_at=existing['created_at'],
            error_message=existing['error_message'],
        ), outcome

    fid = str(uuid.uuid4())
    conn.execute(
        """INSERT INTO indexed_files
           (id, root_id, path, filename, extension, kind, size, mtime_ms,
            volume_serial, file_id, parent_file_id, win_attrs, content_hash,
            preview_kind, preview_eligible, status, last_seen_scan_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
        (
            fid,
            root_id,
            path,
            filename,
            extension,
            kind,
            size,
            mtime_ms,
            volume_serial,
            file_id,
            parent_file_id,
            win_attrs,
            content_hash,
            preview_kind,
            1 if preview_eligible else 0,
            scan_id,
            now,
        ),
    )
    return _build_indexed_file(
        id=fid,
        root_id=root_id,
        path=path,
        filename=filename,
        extension=extension,
        kind=kind,
        size=size,
        mtime_ms=mtime_ms,
        volume_serial=volume_serial,
        file_id=file_id,
        parent_file_id=parent_file_id,
        win_attrs=win_attrs,
        content_hash=content_hash,
        preview_kind=preview_kind,
        preview_eligible=preview_eligible,
        status='pending',
        last_seen_scan_id=scan_id,
        summary=None,
        keywords=None,
        vector=None,
        summary_model_version=None,
        embedding_model_version=None,
        indexed_at=None,
        created_at=now,
        error_message=None,
    ), 'new'


def upsert_file(root_id: str, path: str, size: int, mtime_ms: int, scan_id: int,
                content_hash: Optional[str] = None, kind_override: Optional[FileKind] = None,
                volume_serial: Optional[str] = None, file_id: Optional[str] = None,
                parent_file_id: Optional[str] = None, win_attrs: Optional[int] = None,
                preview_kind: Optional[PreviewKind] = None,
                preview_eligible: Optional[bool] = None) -> Tuple[IndexedFile, bool]:
    """
    Insert or update a file record. Returns (file, is_new_or_changed).
    
    - If file doesn't exist: create as 'pending'
    - If exists and unchanged (same size/mtime or same hash): just update last_seen_scan_id
    - If exists and changed: mark as 'stale' for re-indexing
    """
    with get_conn() as conn:
        record, outcome = _upsert_file_row(
            conn,
            root_id=root_id,
            path=path,
            size=size,
            mtime_ms=mtime_ms,
            scan_id=scan_id,
            content_hash=content_hash,
            kind_override=kind_override,
            volume_serial=volume_serial,
            file_id=file_id,
            parent_file_id=parent_file_id,
            win_attrs=win_attrs,
            preview_kind=preview_kind,
            preview_eligible=preview_eligible,
        )
        conn.commit()
        return record, outcome != 'unchanged'


def upsert_files_batch(files_data: List[Dict[str, Any]]) -> Tuple[int, int, int]:
    """
    Batch upsert files in a single transaction.
    Returns (new_count, changed_count, unchanged_count).
    """
    if not files_data:
        return 0, 0, 0

    now = _now_iso()
    prepared: List[Dict[str, Any]] = []
    paths: List[str] = []

    for data in files_data:
        normalized_path = os.path.normpath(os.path.abspath(data['path']))
        filename = os.path.basename(normalized_path)
        extension = os.path.splitext(filename)[1].lower() if '.' in filename else ''
        kind = data.get('kind_override') or get_file_kind(extension)
        preview_kind, preview_eligible = _get_preview_fields(extension, kind)
        if data.get('preview_kind'):
            preview_kind = data['preview_kind']
        if data.get('preview_eligible') is not None:
            preview_eligible = bool(data['preview_eligible'])

        prepared.append({
            'id': str(uuid.uuid4()),
            'root_id': data['root_id'],
            'path': normalized_path,
            'filename': filename,
            'extension': extension,
            'kind': kind,
            'size': data['size'],
            'mtime_ms': data['mtime_ms'],
            'volume_serial': _normalize_volume_serial(data.get('volume_serial')),
            'file_id': data.get('file_id'),
            'parent_file_id': data.get('parent_file_id'),
            'win_attrs': data.get('win_attrs'),
            'content_hash': data.get('content_hash'),
            'preview_kind': preview_kind,
            'preview_eligible': 1 if preview_eligible else 0,
            'scan_id': data['scan_id'],
            'created_at': now,
        })
        paths.append(normalized_path)

    with get_conn() as conn:
        existing_by_path: Dict[str, sqlite3.Row] = {}
        for i in range(0, len(paths), BULK_LOOKUP_CHUNK_SIZE):
            chunk = paths[i:i + BULK_LOOKUP_CHUNK_SIZE]
            placeholders = ",".join(["?"] * len(chunk))
            rows = conn.execute(
                f"""SELECT path, size, mtime_ms, content_hash, status, kind
                    FROM indexed_files
                    WHERE path IN ({placeholders})""",
                tuple(chunk),
            ).fetchall()
            existing_by_path.update({r['path']: r for r in rows})

        new_count = 0
        changed_count = 0
        unchanged_count = 0
        for item in prepared:
            existing = existing_by_path.get(item['path'])
            if not existing:
                new_count += 1
                continue

            kind_changed = existing['kind'] != item['kind']
            stat_changed = existing['size'] != item['size'] or existing['mtime_ms'] != item['mtime_ms']
            hash_matches = bool(item['content_hash']) and existing['content_hash'] == item['content_hash']
            if existing['status'] == 'deleted' or kind_changed or (stat_changed and not hash_matches):
                changed_count += 1
            else:
                unchanged_count += 1

        rows_to_upsert = [
            (
                item['id'],
                item['root_id'],
                item['path'],
                item['filename'],
                item['extension'],
                item['kind'],
                item['size'],
                item['mtime_ms'],
                item['volume_serial'],
                item['file_id'],
                item['parent_file_id'],
                item['win_attrs'],
                item['content_hash'],
                item['preview_kind'],
                item['preview_eligible'],
                item['scan_id'],
                item['created_at'],
            )
            for item in prepared
        ]

        conn.executemany(
            """INSERT INTO indexed_files
               (id, root_id, path, filename, extension, kind, size, mtime_ms,
                volume_serial, file_id, parent_file_id, win_attrs, content_hash,
                preview_kind, preview_eligible, status, last_seen_scan_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
               ON CONFLICT(path) DO UPDATE SET
                root_id = excluded.root_id,
                filename = excluded.filename,
                extension = excluded.extension,
                kind = excluded.kind,
                size = excluded.size,
                mtime_ms = excluded.mtime_ms,
                volume_serial = COALESCE(excluded.volume_serial, indexed_files.volume_serial),
                file_id = COALESCE(excluded.file_id, indexed_files.file_id),
                parent_file_id = COALESCE(excluded.parent_file_id, indexed_files.parent_file_id),
                win_attrs = COALESCE(excluded.win_attrs, indexed_files.win_attrs),
                content_hash = COALESCE(excluded.content_hash, indexed_files.content_hash),
                preview_kind = excluded.preview_kind,
                preview_eligible = excluded.preview_eligible,
                status = CASE
                    WHEN indexed_files.status = 'deleted' THEN
                        CASE WHEN indexed_files.summary IS NOT NULL OR indexed_files.vector IS NOT NULL
                             THEN 'indexed' ELSE 'pending' END
                    WHEN indexed_files.kind != excluded.kind THEN 'stale'
                    WHEN indexed_files.size != excluded.size OR indexed_files.mtime_ms != excluded.mtime_ms THEN
                        CASE WHEN excluded.content_hash IS NOT NULL AND indexed_files.content_hash = excluded.content_hash
                             THEN indexed_files.status ELSE 'stale' END
                    ELSE indexed_files.status
                END,
                last_seen_scan_id = excluded.last_seen_scan_id""",
            rows_to_upsert,
        )
        conn.commit()

    return new_count, changed_count, unchanged_count


def get_root_file_metadata(root_id: str) -> Dict[str, Dict[str, Any]]:
    """
    Get a map of path -> metadata for all files in a root.
    Used for fast change detection during scanning.
    """
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT path, size, mtime_ms, content_hash, status, kind,
                      volume_serial, file_id, parent_file_id, win_attrs,
                      preview_kind, preview_eligible
               FROM indexed_files
               WHERE root_id = ? AND status != 'deleted'""",
            (root_id,)
        ).fetchall()
        return {
            r['path']: {
                'size': r['size'],
                'mtime_ms': r['mtime_ms'],
                'content_hash': r['content_hash'],
                'status': r['status'],
                'kind': r['kind'],
                'volume_serial': _normalize_volume_serial(r['volume_serial']),
                'file_id': r['file_id'],
                'parent_file_id': r['parent_file_id'],
                'win_attrs': r['win_attrs'],
                'preview_kind': r['preview_kind'] or 'icon',
                'preview_eligible': bool(r['preview_eligible']),
            }
            for r in rows
        }


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
    preview_kind = row['preview_kind'] or _get_preview_fields(row['extension'], row['kind'])[0]
    preview_eligible = bool(row['preview_eligible']) if 'preview_eligible' in row.keys() else _get_preview_fields(row['extension'], row['kind'])[1]
    return _build_indexed_file(
        id=row['id'],
        root_id=row['root_id'],
        path=row['path'],
        filename=row['filename'],
        extension=row['extension'],
        kind=row['kind'],
        size=row['size'],
        mtime_ms=row['mtime_ms'],
        volume_serial=row['volume_serial'] if 'volume_serial' in row.keys() else None,
        file_id=row['file_id'] if 'file_id' in row.keys() else None,
        parent_file_id=row['parent_file_id'] if 'parent_file_id' in row.keys() else None,
        win_attrs=row['win_attrs'] if 'win_attrs' in row.keys() else None,
        content_hash=row['content_hash'],
        preview_kind=preview_kind,
        preview_eligible=preview_eligible,
        status=row['status'],
        last_seen_scan_id=row['last_seen_scan_id'],
        summary=row['summary'],
        keywords=row['keywords'],
        vector=_deserialize_vector(row['vector']),
        summary_model_version=row['summary_model_version'],
        embedding_model_version=row['embedding_model_version'],
        indexed_at=row['indexed_at'],
        created_at=row['created_at'],
        error_message=row['error_message'],
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


def mark_path_deleted(root_id: str, path: str) -> int:
    """Mark a file or folder subtree as deleted."""
    path = os.path.normpath(os.path.abspath(path))
    prefix = path + os.sep + '%'
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE indexed_files
               SET status = 'deleted'
               WHERE root_id = ? AND status != 'deleted' AND (path = ? OR path LIKE ?)""",
            (root_id, path, prefix),
        )
        conn.commit()
        return cur.rowcount


def set_root_watch_state(root_id: str, watch_state: WatchState) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE indexed_roots SET watch_state = ? WHERE id = ?", (watch_state, root_id))
        conn.commit()


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

def _normalize_path_scopes(path_scopes: Optional[List[str]]) -> List[str]:
    scopes: List[str] = []
    for raw in path_scopes or []:
        path = str(raw or "").strip()
        if not path:
            continue
        try:
            scopes.append(os.path.normcase(os.path.normpath(os.path.abspath(os.path.expanduser(path)))))
        except Exception:
            continue
    return list(dict.fromkeys(scopes))


def _append_path_scope_filter(sql: str, params: List[Any], path_scopes: Optional[List[str]], alias: str = "f") -> str:
    scopes = _normalize_path_scopes(path_scopes)
    if not scopes:
        return sql

    clauses: List[str] = []
    for scope in scopes:
        child_prefix = scope.rstrip("\\/") + os.sep + "%"
        clauses.append(f"(LOWER({alias}.path) = LOWER(?) OR LOWER({alias}.path) LIKE LOWER(?))")
        params.extend([scope, child_prefix])
    return sql + " AND (" + " OR ".join(clauses) + ")"


def search_fts(query: str, limit: int = 50, kind: Optional[FileKind] = None,
               root_id: Optional[str] = None, path_scopes: Optional[List[str]] = None) -> List[IndexedFile]:
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
    base_sql = _append_path_scope_filter(base_sql, params, path_scopes, alias="f")

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
    
    # If FTS returned few results, supplement with filename LIKE search.
    # Keep this filename-focused so large home-directory indexes do not fall
    # back to broad wildcard scans over every absolute path.
    if len(results) < limit and original_query and len(original_query) >= 2:
        existing_ids = {r.id for r in results}
        like_sql = """
            SELECT * FROM indexed_files
            WHERE status != 'deleted' AND filename LIKE ?
        """
        like_params: List[Any] = [f'%{original_query}%']
        if kind:
            like_sql += " AND kind = ?"
            like_params.append(kind)
        if root_id:
            like_sql += " AND root_id = ?"
            like_params.append(root_id)
        like_sql = _append_path_scope_filter(like_sql, like_params, path_scopes, alias="indexed_files")
        if ("\\" in original_query or "/" in original_query) and len(original_query) >= 4:
            like_sql = """
                SELECT * FROM indexed_files
                WHERE status != 'deleted' AND (filename LIKE ? OR path LIKE ?)
            """
            like_params = [f'%{original_query}%', f'%{original_query}%']
            if kind:
                like_sql += " AND kind = ?"
                like_params.append(kind)
            if root_id:
                like_sql += " AND root_id = ?"
                like_params.append(root_id)
            like_sql = _append_path_scope_filter(like_sql, like_params, path_scopes, alias="indexed_files")
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


def search_vector(query_vector: List[float], limit: int = 20, threshold: float = 0.4,
                  kind: Optional[FileKind] = None, root_id: Optional[str] = None,
                  path_scopes: Optional[List[str]] = None) -> List[Tuple[IndexedFile, float]]:
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
        scopes = _normalize_path_scopes(path_scopes)
        if scopes:
            scope_clauses: List[str] = []
            for scope in scopes:
                child_prefix = scope.rstrip("\\/") + os.sep + "%"
                scope_clauses.append("(LOWER(path) = LOWER(?) OR LOWER(path) LIKE LOWER(?))")
                params.extend([scope, child_prefix])
            conditions.append("(" + " OR ".join(scope_clauses) + ")")
        
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
                  root_id: Optional[str] = None,
                  path_scopes: Optional[List[str]] = None) -> List[Tuple[IndexedFile, float, str]]:
    """
    Hybrid search combining FTS and vector search.
    Returns (file, score, match_type) tuples.
    """
    results_map: Dict[str, Tuple[IndexedFile, float, str]] = {}
    
    # FTS search
    fts_results = search_fts(query, limit=limit * 2, kind=kind, root_id=root_id, path_scopes=path_scopes)
    for i, f in enumerate(fts_results):
        # FTS rank as score (higher is better, normalize roughly)
        score = 1.0 - (i / len(fts_results)) if fts_results else 0.5
        results_map[f.id] = (f, score, 'fts')
    
    # Vector search if vector provided
    if query_vector:
        vec_results = search_vector(query_vector, limit=limit * 2, kind=kind, root_id=root_id, path_scopes=path_scopes)
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
