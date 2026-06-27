// Stuard AI — Native File Indexer (Rust)
//
// This binary is the single source of truth for filesystem indexing + search
// on the desktop app. Electron spawns it for every operation:
//
//   stuard-file-indexer init          --db <file_index.db>
//   stuard-file-indexer add-root      --db <file_index.db> --path <dir> [--schedule daily] [--interval-hours 24]
//   stuard-file-indexer remove-root   --db <file_index.db> --root-id <id>
//   stuard-file-indexer list-roots    --db <file_index.db>
//   stuard-file-indexer update-root   --db <file_index.db> --root-id <id> [--enabled 0|1] [--schedule ...]
//   stuard-file-indexer scan          --db <file_index.db> --root-id <id> --root-path <dir> [--workers N]
//   stuard-file-indexer search        --db <file_index.db> --query <q> [--limit N] [--kind k] [--root-id id]
//   stuard-file-indexer list-folder   --db <file_index.db> --path <dir> [--recursive] [--limit N]
//   stuard-file-indexer stats         --db <file_index.db>
//
// Every command prints a single JSON object to stdout.

use chrono::Local;
use crossbeam_channel::{bounded, unbounded, Receiver, Sender};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;
use uuid::Uuid;

const BATCH_SIZE: usize = 5000;

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

#[derive(Clone)]
struct DirJob {
    path: PathBuf,
}

#[derive(Clone)]
struct EntryRow {
    id: String,
    root_id: String,
    path: String,
    filename: String,
    extension: String,
    kind: String,
    size: i64,
    mtime_ms: i64,
    content_hash: Option<String>,
    preview_kind: String,
    preview_eligible: i64,
    scan_id: i64,
    created_at: String,
}

#[derive(Default)]
struct Counters {
    total_dirs: usize,
    scanned_dirs: usize,
    total_files: usize,
    new_files: usize,
    changed_files: usize,
    unchanged_files: usize,
    skipped_files: usize,
    deleted_files: usize,
    errors: Vec<String>,
}

#[derive(Serialize)]
struct ProgressOut {
    total_dirs: usize,
    scanned_dirs: usize,
    total_files: usize,
    new_files: usize,
    changed_files: usize,
    unchanged_files: usize,
    skipped_files: usize,
    deleted_files: usize,
    moved_files: usize,
    errors: usize,
    elapsed_seconds: f64,
    files_per_second: f64,
}

#[derive(Serialize)]
struct ScanOutput {
    ok: bool,
    backend: &'static str,
    progress: ProgressOut,
}

#[derive(Serialize)]
struct RootOut {
    id: String,
    path: String,
    enabled: bool,
    schedule: String,
    interval_hours: Option<f64>,
    last_scan_at: Option<String>,
    next_scan_at: Option<String>,
    last_scan_id: i64,
    backend: String,
    watch_state: String,
    volume_serial: Option<String>,
    last_reconcile_at: Option<String>,
    exclude_globs: Option<String>,
    // Whether the user opted this folder into semantic (embedding) search. The
    // global name-search index crawls everything; only `semantic` folders are
    // shown/managed in the "Search by Meaning" panel and get embedded.
    semantic: bool,
    // Per-root semantic-index counts, filled in by do_list_roots. Lets the UI
    // show which folders are already searchable-by-meaning without a global stat.
    indexed_files: i64,
    pending_files: i64,
    created_at: String,
}

#[derive(Serialize)]
struct ListRootsOut {
    ok: bool,
    roots: Vec<RootOut>,
}

#[derive(Serialize)]
struct AddRootOut {
    ok: bool,
    root: RootOut,
}

#[derive(Serialize)]
struct OkOut {
    ok: bool,
}

#[derive(Serialize)]
struct FileResult {
    id: String,
    root_id: String,
    path: String,
    filename: String,
    display_name: String,
    extension: String,
    kind: String,
    size: i64,
    mtime_ms: i64,
    content_hash: Option<String>,
    status: String,
    summary: Option<String>,
    keywords: Option<String>,
    indexed_at: Option<String>,
    preview_kind: String,
    preview_eligible: bool,
    is_folder: bool,
    icon_path: String,
    score: f64,
    match_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_path: Option<String>,
}

#[derive(Serialize)]
struct SearchOut {
    ok: bool,
    results: Vec<FileResult>,
    count: usize,
}

#[derive(Serialize)]
struct StatsOut {
    ok: bool,
    roots: i64,
    total_files: i64,
    indexed_files: i64,
    pending_files: i64,
    folders: i64,
    files_by_kind: serde_json::Value,
}

#[derive(Serialize)]
struct PendingFileOut {
    id: String,
    path: String,
    filename: String,
    extension: String,
    kind: String,
    size: i64,
}

#[derive(Serialize)]
struct PendingOut {
    ok: bool,
    files: Vec<PendingFileOut>,
    count: usize,
}

// ─────────────────────────────────────────────────────────
// Filesystem helpers
// ─────────────────────────────────────────────────────────

fn now_iso() -> String {
    Local::now().to_rfc3339()
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\")
}

fn extension_of(filename: &str) -> String {
    Path::new(filename)
        .extension()
        .map(|ext| format!(".{}", ext.to_string_lossy().to_lowercase()))
        .unwrap_or_default()
}

fn file_kind(ext: &str) -> &'static str {
    match ext {
        ".lnk" | ".url" | ".exe" | ".msi" | ".app" | ".desktop" | ".appref-ms" | ".cmd"
        | ".bat" | ".com" => "application",
        ".pdf" | ".txt" | ".md" | ".rtf" | ".doc" | ".docx" | ".odt" | ".xls" | ".xlsx"
        | ".ods" | ".csv" | ".ppt" | ".pptx" | ".odp" => "document",
        ".jpg" | ".jpeg" | ".png" | ".gif" | ".bmp" | ".webp" | ".svg" | ".ico" | ".heic"
        | ".heif" | ".tiff" | ".tif" => "image",
        ".mp4" | ".mkv" | ".avi" | ".mov" | ".wmv" | ".flv" | ".webm" | ".m4v" => "video",
        ".mp3" | ".wav" | ".flac" | ".aac" | ".ogg" | ".wma" | ".m4a" => "audio",
        ".py" | ".js" | ".ts" | ".tsx" | ".jsx" | ".java" | ".c" | ".cpp" | ".h" | ".hpp"
        | ".cs" | ".go" | ".rs" | ".rb" | ".php" | ".swift" | ".kt" | ".scala" | ".r" | ".sql"
        | ".sh" | ".bash" | ".ps1" | ".json" | ".yaml" | ".yml" | ".toml" | ".xml" | ".html"
        | ".css" | ".scss" | ".less" => "code",
        ".dll" | ".so" | ".dylib" | ".dmg" => "binary",
        ".zip" | ".rar" | ".7z" | ".tar" | ".gz" | ".bz2" | ".xz" => "archive",
        _ => "other",
    }
}

fn preview_kind(kind: &str, ext: &str) -> &'static str {
    if kind == "image"
        && matches!(
            ext,
            ".jpg"
                | ".jpeg"
                | ".png"
                | ".gif"
                | ".bmp"
                | ".webp"
                | ".svg"
                | ".ico"
                | ".heic"
                | ".heif"
                | ".tiff"
                | ".tif"
        )
    {
        "thumbnail"
    } else {
        "icon"
    }
}

fn should_skip_path(path: &Path, name: &str) -> bool {
    let ignore: HashSet<&'static str> = [
        "node_modules",
        ".git",
        ".svn",
        ".hg",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "venv",
        ".venv",
        "env",
        ".env",
        "virtualenv",
        "target",
        "build",
        "dist",
        "out",
        "bin",
        "obj",
        ".vscode",
        ".idea",
        ".vs",
        ".cache",
        ".gradle",
        ".terraform",
        ".next",
        ".nuxt",
        ".svelte-kit",
        ".turbo",
        ".parcel-cache",
        "coverage",
        "vendor",
        "Pods",
        "bower_components",
        "tmp",
        "temp",
        "Application Data",
        "Local Settings",
        "$Recycle.Bin",
        "System Volume Information",
        "Thumbs.db",
        ".DS_Store",
        "desktop.ini",
    ]
    .into_iter()
    .collect();

    if ignore.contains(name) {
        return true;
    }

    let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    if normalized.contains("start menu") || normalized.contains("programdata/microsoft/windows") {
        return false;
    }
    if normalized.contains("/appdata/") || normalized.ends_with("/appdata") {
        return !(normalized.contains("microsoft/windows/start menu")
            || normalized.contains("microsoft/windows/recent")
            || normalized.contains("programs"));
    }
    false
}

/// Parse a user-provided exclude list (comma/newline/semicolon separated) into
/// normalized, lowercased patterns. Wildcard `*` characters are stripped — each
/// pattern is matched as a case-insensitive segment name or path substring.
fn parse_excludes(raw: Option<&str>) -> Vec<String> {
    let raw = match raw {
        Some(s) if !s.trim().is_empty() => s,
        _ => return Vec::new(),
    };
    raw.split([',', '\n', ';'])
        .map(|s| s.trim().trim_matches('*').trim_matches(['\\', '/']).to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// User-defined per-root exclusions. `name` is the directory/file name and
/// `normalized` is the full path with forward slashes, both lowercased.
fn is_user_excluded(name_lower: &str, path_normalized_lower: &str, excludes: &[String]) -> bool {
    if excludes.is_empty() {
        return false;
    }
    for pat in excludes {
        if name_lower == pat
            || path_normalized_lower.contains(pat)
        {
            return true;
        }
    }
    false
}

fn common_folder_priority(name: &str) -> Option<(i32, f64)> {
    match name.trim().to_lowercase().as_str() {
        "downloads" => Some((0, 0.30)),
        "documents" | "my documents" => Some((1, 0.27)),
        "desktop" => Some((2, 0.25)),
        "projects" | "project" | "code" | "development" | "dev" | "source" | "src" | "repos"
        | "repositories" | "github" | "gitlab" | "work" | "workspace" | "workspaces" => {
            Some((3, 0.23))
        }
        "pictures" | "photos" | "images" | "camera roll" | "screenshots" => Some((4, 0.20)),
        "videos" | "movies" => Some((5, 0.18)),
        "music" | "audio" => Some((6, 0.17)),
        "onedrive" | "dropbox" | "google drive" | "icloud drive" | "icloud" => Some((7, 0.16)),
        _ => None,
    }
}

fn scan_dir_priority(name: &str) -> i32 {
    common_folder_priority(name)
        .map(|(rank, _)| rank)
        .unwrap_or(100)
}

fn filetime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|mtime| mtime.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn make_entry(
    root_id: &str,
    path: PathBuf,
    meta: fs::Metadata,
    is_dir: bool,
    scan_id: i64,
    created_at: &str,
) -> EntryRow {
    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| normalize_path(&path));
    let extension = if is_dir {
        String::new()
    } else {
        extension_of(&filename)
    };
    let kind = if is_dir {
        "folder".to_string()
    } else {
        file_kind(&extension).to_string()
    };
    let preview = preview_kind(&kind, &extension).to_string();
    EntryRow {
        id: Uuid::new_v4().to_string(),
        root_id: root_id.to_string(),
        path: normalize_path(&path),
        filename,
        extension,
        kind,
        size: if is_dir { 0 } else { meta.len() as i64 },
        mtime_ms: filetime_ms(&meta),
        content_hash: None,
        preview_kind: preview,
        preview_eligible: 1,
        scan_id,
        created_at: created_at.to_string(),
    }
}

// ─────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────

fn open_db(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // journal_mode=WAL is persistent; setting it per-connection is still cheap
    // (no-op after first writer) but `synchronous` and `foreign_keys` are
    // per-connection so they must be set every time.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Speed up repeated small queries (search, stats) by hinting to SQLite
    // that pages can live in memory. This matters a lot on a million-row DB.
    conn.pragma_update(None, "temp_store", "MEMORY")?;

    // Memory strategy: fast reads without a huge private footprint.
    //
    // The old approach was a 256MB *private* page cache per connection — and the
    // daemon runs 4 worker connections, so up to ~1GB of private RAM that the OS
    // can never reclaim while the process lives. That's what made the indexer sit
    // at ~350-420MB resident.
    //
    // Instead: keep a SMALL private cache and lean on a LARGE memory-map. With
    // mmap, SQLite reads pages straight from the file mapping, which is served by
    // the SHARED OS page cache — so hot FTS posting lists stay at memory speed,
    // the mapping is shared across all 4 workers (not duplicated), and the OS can
    // reclaim it under pressure. Net: same search latency, a fraction of the RSS.
    let cache_mb: i64 = std::env::var("STUARD_INDEXER_CACHE_MB")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(16)
        .clamp(2, 512);
    // Negative cache_size is in KiB of memory.
    conn.pragma_update(None, "cache_size", &-(cache_mb * 1024))?;

    let mmap_mb: i64 = std::env::var("STUARD_INDEXER_MMAP_MB")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(1024)
        .clamp(0, 8192);
    // mmap_size is in bytes; SQLite caps the actual mapping at the DB size.
    conn.pragma_update(None, "mmap_size", &(mmap_mb * 1024 * 1024))?;
    // Don't block forever if another connection (e.g. a concurrent scan)
    // holds a lock; surface as a clean error after 2s.
    conn.busy_timeout(std::time::Duration::from_millis(2000))?;
    Ok(conn)
}

/// Cheap: run only the minimum schema work required for read queries.
/// Avoids the COUNT(*) backfill scan that `init_schema` performs.
fn ensure_read_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS indexed_roots (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            enabled INTEGER DEFAULT 1,
            schedule TEXT DEFAULT 'daily',
            interval_hours INTEGER,
            last_scan_at TEXT,
            next_scan_at TEXT,
            last_scan_id INTEGER DEFAULT 0,
            backend TEXT DEFAULT 'generic',
            watch_state TEXT DEFAULT 'inactive',
            volume_serial TEXT,
            last_reconcile_at TEXT,
            created_at TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS indexed_roots (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            enabled INTEGER DEFAULT 1,
            schedule TEXT DEFAULT 'daily',
            interval_hours INTEGER,
            last_scan_at TEXT,
            next_scan_at TEXT,
            last_scan_id INTEGER DEFAULT 0,
            backend TEXT DEFAULT 'generic',
            watch_state TEXT DEFAULT 'inactive',
            volume_serial TEXT,
            last_reconcile_at TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS indexed_files (
            id TEXT PRIMARY KEY,
            root_id TEXT NOT NULL REFERENCES indexed_roots(id) ON DELETE CASCADE,
            path TEXT NOT NULL UNIQUE,
            filename TEXT NOT NULL,
            extension TEXT,
            kind TEXT DEFAULT 'other',
            size INTEGER NOT NULL,
            mtime_ms INTEGER NOT NULL,
            volume_serial TEXT,
            file_id TEXT,
            parent_file_id TEXT,
            win_attrs INTEGER,
            content_hash TEXT,
            preview_kind TEXT DEFAULT 'icon',
            preview_eligible INTEGER DEFAULT 1,
            status TEXT DEFAULT 'pending',
            last_seen_scan_id INTEGER DEFAULT 0,
            summary TEXT,
            keywords TEXT,
            vector BLOB,
            summary_model_version TEXT,
            embedding_model_version TEXT,
            indexed_at TEXT,
            created_at TEXT NOT NULL,
            error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_files_root ON indexed_files(root_id);
        CREATE INDEX IF NOT EXISTS idx_files_filename ON indexed_files(filename COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_files_extension ON indexed_files(extension);
        CREATE INDEX IF NOT EXISTS idx_files_kind ON indexed_files(kind);
        CREATE INDEX IF NOT EXISTS idx_files_mtime ON indexed_files(mtime_ms);
        CREATE INDEX IF NOT EXISTS idx_files_status ON indexed_files(status);

        -- Covering index for the per-root semantic counts in do_list_roots:
        --   WHERE kind IN ('image','document','code') AND path >= ? AND path < ?
        -- summed by status. With (kind, path, status) all in the index, SQLite
        -- does 3 covering range scans (one per kind) and reads status straight
        -- from the index — no per-row main-table lookups. Counting a large
        -- "searchable" folder then stays fast even on a cold page cache (the
        -- first Files-settings load after launch), instead of blowing the 5s
        -- daemon timeout and forcing a slower cold respawn that re-runs the
        -- same scan. The leading `kind` also skips the non-counted files
        -- entirely rather than scanning the whole path range.
        CREATE INDEX IF NOT EXISTS idx_files_kind_path_status ON indexed_files(kind, path, status);

        -- Full-text search over filename/path/summary/keywords. This is what makes
        -- `search` instantaneous instead of a full table scan.
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            filename,
            path,
            summary,
            keywords,
            content='indexed_files',
            content_rowid='rowid',
            tokenize='unicode61 remove_diacritics 2 tokenchars ''_-'''
        );

        CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON indexed_files BEGIN
            INSERT INTO files_fts(rowid, filename, path, summary, keywords)
            VALUES (NEW.rowid, NEW.filename, NEW.path, NEW.summary, NEW.keywords);
        END;

        CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON indexed_files BEGIN
            INSERT INTO files_fts(files_fts, rowid, filename, path, summary, keywords)
            VALUES ('delete', OLD.rowid, OLD.filename, OLD.path, OLD.summary, OLD.keywords);
        END;

        CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE ON indexed_files BEGIN
            INSERT INTO files_fts(files_fts, rowid, filename, path, summary, keywords)
            VALUES ('delete', OLD.rowid, OLD.filename, OLD.path, OLD.summary, OLD.keywords);
            INSERT INTO files_fts(rowid, filename, path, summary, keywords)
            VALUES (NEW.rowid, NEW.filename, NEW.path, NEW.summary, NEW.keywords);
        END;
        "#,
    )?;

    // Backfill FTS if it is empty but indexed_files has rows (one-time migration
    // after switching to the FTS-enabled schema).
    let file_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM indexed_files", [], |r| r.get(0))
        .unwrap_or(0);
    let fts_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM files_fts", [], |r| r.get(0))
        .unwrap_or(0);
    if file_count > 0 && fts_count == 0 {
        conn.execute(
            "INSERT INTO files_fts(rowid, filename, path, summary, keywords)
             SELECT rowid, filename, path, summary, keywords FROM indexed_files",
            [],
        )?;
    }

    Ok(())
}

fn ensure_root_columns(conn: &Connection) -> rusqlite::Result<()> {
    for (col, ddl) in [
        ("backend", "TEXT DEFAULT 'generic'"),
        ("watch_state", "TEXT DEFAULT 'inactive'"),
        ("volume_serial", "TEXT"),
        ("last_reconcile_at", "TEXT"),
        ("exclude_globs", "TEXT"),
        ("semantic", "INTEGER DEFAULT 0"),
    ] {
        let exists: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('indexed_roots') WHERE name = ?")?
            .exists([col])?;
        if !exists {
            conn.execute(
                &format!("ALTER TABLE indexed_roots ADD COLUMN {} {}", col, ddl),
                [],
            )?;
        }
    }
    Ok(())
}

fn row_to_root(row: &rusqlite::Row) -> rusqlite::Result<RootOut> {
    Ok(RootOut {
        id: row.get("id")?,
        path: row.get("path")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        schedule: row.get("schedule")?,
        // Stored as REAL for sub-hour schedules (e.g. Downloads = 0.25h), so read
        // tolerantly as f64 — reading as i64 throws "Invalid column type Real".
        interval_hours: row.get::<_, Option<f64>>("interval_hours").unwrap_or(None),
        last_scan_at: row.get("last_scan_at")?,
        next_scan_at: row.get("next_scan_at")?,
        last_scan_id: row.get("last_scan_id")?,
        backend: row
            .get::<_, Option<String>>("backend")?
            .unwrap_or_else(|| "generic".to_string()),
        watch_state: row
            .get::<_, Option<String>>("watch_state")?
            .unwrap_or_else(|| "inactive".to_string()),
        volume_serial: row.get("volume_serial")?,
        last_reconcile_at: row.get("last_reconcile_at")?,
        exclude_globs: row
            .get::<_, Option<String>>("exclude_globs")
            .unwrap_or(None),
        semantic: row.get::<_, Option<i64>>("semantic").unwrap_or(None).unwrap_or(0) != 0,
        // Counts default to 0; do_list_roots overlays the real per-root totals.
        indexed_files: 0,
        pending_files: 0,
        created_at: row.get("created_at")?,
    })
}

// ─────────────────────────────────────────────────────────
// Root CRUD
// ─────────────────────────────────────────────────────────

fn cmd_init(db_path: &str) -> Result<OkOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    init_schema(&conn)?;
    ensure_root_columns(&conn)?;
    Ok(OkOut { ok: true })
}

fn cmd_add_root(
    db_path: &str,
    path: &str,
    schedule: &str,
    interval_hours: Option<f64>,
) -> Result<AddRootOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    init_schema(&conn)?;
    ensure_root_columns(&conn)?;

    let resolved = fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    let mut path_str = normalize_path(&resolved);
    // Strip Windows extended-path prefix (\\?\) so paths match what the rest of the app expects
    if let Some(rest) = path_str.strip_prefix("\\\\?\\") {
        path_str = rest.to_string();
    }
    let path_str = path_str.trim_end_matches(['\\', '/']).to_string();

    // Return existing row if already present
    if let Ok(root) = conn.query_row(
        "SELECT * FROM indexed_roots WHERE path = ?",
        params![path_str],
        row_to_root,
    ) {
        return Ok(AddRootOut { ok: true, root });
    }

    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    conn.execute(
        "INSERT INTO indexed_roots
           (id, path, enabled, schedule, interval_hours, last_scan_id, backend, watch_state, created_at)
         VALUES (?, ?, 1, ?, ?, 0, 'generic', 'inactive', ?)",
        params![id, path_str, schedule, interval_hours, now],
    )?;

    let root = conn.query_row(
        "SELECT * FROM indexed_roots WHERE id = ?",
        params![id],
        row_to_root,
    )?;
    Ok(AddRootOut { ok: true, root })
}

fn cmd_remove_root(db_path: &str, root_id: &str) -> Result<OkOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    init_schema(&conn)?;
    conn.execute(
        "DELETE FROM indexed_files WHERE root_id = ?",
        params![root_id],
    )?;
    conn.execute("DELETE FROM indexed_roots WHERE id = ?", params![root_id])?;
    Ok(OkOut { ok: true })
}

fn cmd_list_roots(db_path: &str) -> Result<ListRootsOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    ensure_read_schema(&conn)?;
    ensure_root_columns(&conn)?;
    do_list_roots(&conn)
}

fn do_list_roots(conn: &Connection) -> Result<ListRootsOut, Box<dyn std::error::Error>> {
    let mut stmt = conn.prepare("SELECT * FROM indexed_roots ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], row_to_root)?;
    let mut roots = Vec::new();
    for r in rows {
        roots.push(r?);
    }

    // Overlay per-root semantic-index counts scoped by PATH (not root_id), so a
    // folder's count reflects everything physically inside it even when a nested
    // parent/child root owns the rows. Each query is an indexed range scan over
    // the UNIQUE path column. Tolerant of failure — counts stay 0 on error.
    //
    // IMPORTANT: only do this for SEMANTIC roots. Those are the handful of
    // folders the user opted into "Search by Meaning", and the only roots whose
    // counts the UI ever renders. The non-semantic roots are the broad
    // name-search index (whole home dir, AppData, Program Files, …) holding
    // millions of rows each — counting them here scanned the entire index per
    // root and blew the 5s daemon timeout, forcing a slow cold-spawn fallback.
    if roots.iter().any(|r| r.semantic) {
        if let Ok(mut cnt_stmt) = conn.prepare(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status IN ('pending','stale') THEN 1 ELSE 0 END), 0)
             FROM indexed_files
             WHERE kind IN ('image','document','code') AND path >= ? AND path < ?",
        ) {
            for root in roots.iter_mut() {
                if !root.semantic {
                    continue;
                }
                let (lo, hi) = path_prefix_range(&root.path);
                if let Ok((idx, pend)) = cnt_stmt.query_row(params![lo, hi], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
                }) {
                    root.indexed_files = idx;
                    root.pending_files = pend;
                }
            }
        }
    }

    Ok(ListRootsOut { ok: true, roots })
}

fn cmd_update_root(
    db_path: &str,
    root_id: &str,
    enabled: Option<bool>,
    schedule: Option<&str>,
    interval_hours: Option<f64>,
    exclude_globs: Option<&str>,
    semantic: Option<bool>,
) -> Result<OkOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    init_schema(&conn)?;
    ensure_root_columns(&conn)?;
    let mut sets: Vec<&'static str> = Vec::new();
    let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(e) = enabled {
        sets.push("enabled = ?");
        vals.push(Box::new(if e { 1i64 } else { 0i64 }));
    }
    if let Some(s) = semantic {
        sets.push("semantic = ?");
        vals.push(Box::new(if s { 1i64 } else { 0i64 }));
    }
    if let Some(s) = schedule {
        sets.push("schedule = ?");
        vals.push(Box::new(s.to_string()));
    }
    if let Some(h) = interval_hours {
        sets.push("interval_hours = ?");
        vals.push(Box::new(h));
    }
    if let Some(g) = exclude_globs {
        sets.push("exclude_globs = ?");
        vals.push(Box::new(g.to_string()));
    }
    if sets.is_empty() {
        return Ok(OkOut { ok: true });
    }
    let sql = format!("UPDATE indexed_roots SET {} WHERE id = ?", sets.join(", "));
    vals.push(Box::new(root_id.to_string()));
    let params_refs: Vec<&dyn rusqlite::ToSql> = vals.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())?;
    Ok(OkOut { ok: true })
}

// ─────────────────────────────────────────────────────────
// Scan
// ─────────────────────────────────────────────────────────

fn increment_scan(conn: &Connection, root_id: &str, now: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "UPDATE indexed_roots SET last_scan_id = last_scan_id + 1, last_scan_at = ?, backend = 'rust', last_reconcile_at = ? WHERE id = ?",
        params![now, now, root_id],
    )?;
    conn.query_row(
        "SELECT last_scan_id FROM indexed_roots WHERE id = ?",
        params![root_id],
        |row| row.get(0),
    )
}

fn existing_rows(
    conn: &Connection,
    paths: &[EntryRow],
) -> rusqlite::Result<HashMap<String, (i64, i64, String, String)>> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = (0..paths.len()).map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT path, size, mtime_ms, status, kind FROM indexed_files WHERE path IN ({})",
        placeholders
    );
    let params_vec = paths
        .iter()
        .map(|row| row.path.as_str())
        .collect::<Vec<_>>();
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(params_vec))?;
    let mut out = HashMap::with_capacity(paths.len());
    while let Some(row) = rows.next()? {
        out.insert(
            row.get(0)?,
            (row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?),
        );
    }
    Ok(out)
}

fn flush_batch(
    conn: &mut Connection,
    batch: &mut Vec<EntryRow>,
    counters: &Arc<Mutex<Counters>>,
) -> rusqlite::Result<()> {
    if batch.is_empty() {
        return Ok(());
    }

    let existing = existing_rows(conn, batch)?;
    {
        let mut c = counters.lock().unwrap();
        for row in batch.iter() {
            match existing.get(&row.path) {
                None => c.new_files += 1,
                Some((size, mtime_ms, status, kind)) => {
                    if status == "deleted"
                        || kind != &row.kind
                        || *size != row.size
                        || *mtime_ms != row.mtime_ms
                    {
                        c.changed_files += 1;
                    } else {
                        c.unchanged_files += 1;
                    }
                }
            }
        }
    }

    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO indexed_files
             (id, root_id, path, filename, extension, kind, size, mtime_ms,
              content_hash, preview_kind, preview_eligible, status, last_seen_scan_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
             ON CONFLICT(path) DO UPDATE SET
              root_id = excluded.root_id,
              filename = excluded.filename,
              extension = excluded.extension,
              kind = excluded.kind,
              size = excluded.size,
              mtime_ms = excluded.mtime_ms,
              preview_kind = excluded.preview_kind,
              preview_eligible = excluded.preview_eligible,
              status = CASE
                  WHEN indexed_files.status = 'deleted' THEN
                      CASE WHEN indexed_files.summary IS NOT NULL OR indexed_files.vector IS NOT NULL
                           THEN 'indexed' ELSE 'pending' END
                  WHEN indexed_files.kind != excluded.kind THEN 'stale'
                  WHEN indexed_files.size != excluded.size OR indexed_files.mtime_ms != excluded.mtime_ms THEN 'stale'
                  ELSE indexed_files.status
              END,
              last_seen_scan_id = excluded.last_seen_scan_id",
        )?;
        for row in batch.iter() {
            stmt.execute(params![
                row.id,
                row.root_id,
                row.path,
                row.filename,
                row.extension,
                row.kind,
                row.size,
                row.mtime_ms,
                row.content_hash,
                row.preview_kind,
                row.preview_eligible,
                row.scan_id,
                row.created_at,
            ])?;
        }
    }
    tx.commit()?;
    batch.clear();
    Ok(())
}

fn worker(
    dirs_rx: Receiver<DirJob>,
    dirs_tx: Sender<DirJob>,
    entries_tx: Sender<EntryRow>,
    counters: Arc<Mutex<Counters>>,
    pending_dirs: Arc<AtomicUsize>,
    done: Arc<AtomicBool>,
    root_id: String,
    scan_id: i64,
    created_at: String,
    excludes: Arc<Vec<String>>,
) {
    while !done.load(Ordering::Relaxed) {
        let job = match dirs_rx.recv_timeout(std::time::Duration::from_millis(50)) {
            Ok(job) => job,
            Err(_) => {
                if pending_dirs.load(Ordering::Acquire) == 0 {
                    done.store(true, Ordering::Release);
                    break;
                }
                continue;
            }
        };

        {
            let mut c = counters.lock().unwrap();
            c.scanned_dirs += 1;
        }

        match fs::read_dir(&job.path) {
            Ok(read_dir) => {
                let mut child_dirs: Vec<(PathBuf, String, i32)> = Vec::new();
                for child in read_dir.flatten() {
                    let path = child.path();
                    let name = child.file_name().to_string_lossy().to_string();
                    if should_skip_path(&path, &name) {
                        continue;
                    }
                    if !excludes.is_empty() {
                        let name_lower = name.to_lowercase();
                        let path_lower = path.to_string_lossy().replace('\\', "/").to_lowercase();
                        if is_user_excluded(&name_lower, &path_lower, &excludes) {
                            counters.lock().unwrap().skipped_files += 1;
                            continue;
                        }
                    }
                    let meta = match fs::symlink_metadata(&path) {
                        Ok(meta) => meta,
                        Err(err) => {
                            counters.lock().unwrap().errors.push(format!(
                                "metadata {}: {}",
                                normalize_path(&path),
                                err
                            ));
                            continue;
                        }
                    };
                    if meta.file_type().is_symlink() {
                        counters.lock().unwrap().skipped_files += 1;
                        continue;
                    }
                    let is_dir = meta.is_dir();
                    if is_dir {
                        pending_dirs.fetch_add(1, Ordering::AcqRel);
                        child_dirs.push((path.clone(), name.clone(), scan_dir_priority(&name)));
                        counters.lock().unwrap().total_dirs += 1;
                    }
                    let row = make_entry(&root_id, path, meta, is_dir, scan_id, &created_at);
                    if entries_tx.send(row).is_err() {
                        break;
                    }
                }
                child_dirs.sort_by(|a, b| a.2.cmp(&b.2).then_with(|| a.1.cmp(&b.1)));
                for (path, _, _) in child_dirs {
                    let _ = dirs_tx.send(DirJob { path });
                }
            }
            Err(err) => {
                counters.lock().unwrap().errors.push(format!(
                    "dir {}: {}",
                    normalize_path(&job.path),
                    err
                ));
            }
        }

        if pending_dirs.fetch_sub(1, Ordering::AcqRel) == 1 {
            done.store(true, Ordering::Release);
        }
    }
}

fn cmd_scan(
    db_path: &str,
    root_id: &str,
    root_path: PathBuf,
    workers: usize,
) -> Result<ScanOutput, Box<dyn std::error::Error>> {
    let start = Instant::now();
    let now = now_iso();
    let mut conn = open_db(db_path)?;
    init_schema(&conn)?;
    ensure_root_columns(&conn)?;

    // If caller didn't tell us which path to scan, look it up from the root_id.
    let root_path = if root_path.as_os_str().is_empty() {
        let p: String = conn.query_row(
            "SELECT path FROM indexed_roots WHERE id = ?",
            params![root_id],
            |r| r.get(0),
        )?;
        PathBuf::from(p)
    } else {
        root_path
    };

    if !root_path.is_dir() {
        return Err(format!("Root path not accessible: {}", root_path.display()).into());
    }

    // Per-root user exclusions (in addition to the built-in ignore set).
    let exclude_raw: Option<String> = conn
        .query_row(
            "SELECT exclude_globs FROM indexed_roots WHERE id = ?",
            params![root_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .unwrap_or(None);
    let excludes = Arc::new(parse_excludes(exclude_raw.as_deref()));

    let scan_id = increment_scan(&conn, root_id, &now)?;

    let (dirs_tx, dirs_rx) = unbounded::<DirJob>();
    let (entries_tx, entries_rx) = bounded::<EntryRow>(BATCH_SIZE * 8);
    let counters = Arc::new(Mutex::new(Counters::default()));
    let pending_dirs = Arc::new(AtomicUsize::new(1));
    let done = Arc::new(AtomicBool::new(false));

    dirs_tx.send(DirJob { path: root_path })?;
    let mut handles = Vec::with_capacity(workers);
    for _ in 0..workers {
        let handle = thread::spawn({
            let dirs_rx = dirs_rx.clone();
            let dirs_tx = dirs_tx.clone();
            let entries_tx = entries_tx.clone();
            let counters = counters.clone();
            let pending_dirs = pending_dirs.clone();
            let done = done.clone();
            let root_id = root_id.to_string();
            let created_at = now.clone();
            let excludes = excludes.clone();
            move || {
                worker(
                    dirs_rx,
                    dirs_tx,
                    entries_tx,
                    counters,
                    pending_dirs,
                    done,
                    root_id,
                    scan_id,
                    created_at,
                    excludes,
                )
            }
        });
        handles.push(handle);
    }
    drop(entries_tx);

    let mut batch = Vec::with_capacity(BATCH_SIZE);
    while !done.load(Ordering::Acquire) || !entries_rx.is_empty() {
        if let Ok(row) = entries_rx.recv_timeout(std::time::Duration::from_millis(50)) {
            batch.push(row);
            counters.lock().unwrap().total_files += 1;
            if batch.len() >= BATCH_SIZE {
                flush_batch(&mut conn, &mut batch, &counters)?;
            }
        }
    }
    while let Ok(row) = entries_rx.try_recv() {
        batch.push(row);
        counters.lock().unwrap().total_files += 1;
        if batch.len() >= BATCH_SIZE {
            flush_batch(&mut conn, &mut batch, &counters)?;
        }
    }
    flush_batch(&mut conn, &mut batch, &counters)?;

    for handle in handles {
        let _ = handle.join();
    }

    let deleted = conn.execute(
        "UPDATE indexed_files SET status = 'deleted' WHERE root_id = ? AND last_seen_scan_id < ? AND status != 'deleted'",
        params![root_id, scan_id],
    )?;
    counters.lock().unwrap().deleted_files = deleted;

    let c = counters.lock().unwrap();
    let elapsed = start.elapsed().as_secs_f64();
    Ok(ScanOutput {
        ok: true,
        backend: "rust",
        progress: ProgressOut {
            total_dirs: c.total_dirs,
            scanned_dirs: c.scanned_dirs,
            total_files: c.total_files,
            new_files: c.new_files,
            changed_files: c.changed_files,
            unchanged_files: c.unchanged_files,
            skipped_files: c.skipped_files,
            deleted_files: c.deleted_files,
            moved_files: 0,
            errors: c.errors.len(),
            elapsed_seconds: (elapsed * 100.0).round() / 100.0,
            files_per_second: if elapsed > 0.0 {
                (c.total_files as f64 / elapsed * 10.0).round() / 10.0
            } else {
                0.0
            },
        },
    })
}

// ─────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────

fn display_name_for(filename: &str) -> String {
    let base = Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string());
    let mut out = base;
    for suffix in [" - Shortcut", " (2)", " - Copy"] {
        if out.ends_with(suffix) {
            out.truncate(out.len() - suffix.len());
        }
    }
    out.trim().to_string()
}

fn resolve_lnk_target(lnk_path: &str) -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    let data = fs::read(lnk_path).ok()?;
    if data.len() < 76 || &data[0..4] != b"\x4c\x00\x00\x00" {
        return None;
    }
    let flags = u32::from_le_bytes(data[20..24].try_into().ok()?);
    let has_link_target = flags & 0x01 != 0;
    let has_link_info = flags & 0x02 != 0;
    let mut offset = 76usize;
    if has_link_target {
        if offset + 2 > data.len() {
            return None;
        }
        let id_list_size = u16::from_le_bytes(data[offset..offset + 2].try_into().ok()?);
        offset += 2 + id_list_size as usize;
    }
    if has_link_info && offset + 4 <= data.len() {
        let link_info_size = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?) as usize;
        let end = offset + link_info_size.min(data.len() - offset);
        let link_info = &data[offset..end];
        if link_info.len() >= 28 {
            let local_base_offset = u32::from_le_bytes(link_info[16..20].try_into().ok()?) as usize;
            if local_base_offset > 0 && local_base_offset < link_info.len() {
                let tail = &link_info[local_base_offset..];
                let end_pos = tail.iter().position(|b| *b == 0).unwrap_or(tail.len());
                let target = String::from_utf8_lossy(&tail[..end_pos]).trim().to_string();
                let lower = target.to_lowercase();
                if !target.is_empty()
                    && (lower.ends_with(".exe")
                        || lower.ends_with(".cmd")
                        || lower.ends_with(".bat")
                        || lower.ends_with(".com")
                        || lower.ends_with(".msc"))
                {
                    return Some(target);
                }
            }
        }
    }
    None
}

fn build_file_result(
    row: &rusqlite::Row,
    score: f64,
    match_type: &str,
) -> rusqlite::Result<FileResult> {
    let filename: String = row.get("filename")?;
    let extension: String = row
        .get::<_, Option<String>>("extension")?
        .unwrap_or_default();
    let kind: String = row
        .get::<_, Option<String>>("kind")?
        .unwrap_or_else(|| "other".to_string());
    let path: String = row.get("path")?;

    let ext_lower = extension.to_lowercase();
    let is_app_ext = matches!(ext_lower.as_str(), ".lnk" | ".url" | ".appref-ms");
    let effective_kind = if is_app_ext {
        "application".to_string()
    } else {
        kind.clone()
    };

    // target_path resolution does a synchronous `fs::read` of the .lnk file.
    // Doing it here multiplies disk reads by `fetch_limit` (300+) on every
    // search; we defer it to a post-truncation pass so we only resolve the
    // few .lnk shortcuts that survive ranking.
    let target_path: Option<String> = None;

    Ok(FileResult {
        id: row.get("id")?,
        root_id: row.get("root_id")?,
        path: path.clone(),
        display_name: display_name_for(&filename),
        filename,
        extension,
        is_folder: effective_kind == "folder",
        kind: effective_kind,
        size: row.get::<_, i64>("size")?,
        mtime_ms: row.get::<_, i64>("mtime_ms")?,
        content_hash: row.get("content_hash")?,
        status: row
            .get::<_, Option<String>>("status")?
            .unwrap_or_else(|| "pending".to_string()),
        summary: row.get("summary")?,
        keywords: row.get("keywords")?,
        indexed_at: row.get("indexed_at")?,
        preview_kind: row
            .get::<_, Option<String>>("preview_kind")?
            .unwrap_or_else(|| "icon".to_string()),
        preview_eligible: row.get::<_, Option<i64>>("preview_eligible")?.unwrap_or(1) != 0,
        icon_path: path,
        score: (score * 10000.0).round() / 10000.0,
        match_type: match_type.to_string(),
        target_path,
    })
}

fn normalize_search_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|c| match c {
            '/' | '\\' | '_' | '-' | '.' => ' ',
            c if c.is_ascii_alphanumeric() || c.is_whitespace() => c,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn score_filename(filename: &str, query_norm: &str) -> f64 {
    if query_norm.is_empty() {
        return 0.0;
    }
    let base = Path::new(filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.to_string());
    let normalized = normalize_search_text(&base);

    if normalized == query_norm {
        return 2.0;
    }
    if normalized.starts_with(query_norm) {
        return 1.6;
    }
    for token in normalized.split(' ') {
        if token == query_norm {
            return 1.55;
        }
        if token.starts_with(query_norm) {
            return 1.35;
        }
    }
    if normalized.contains(query_norm) {
        return 1.1;
    }
    0.5
}

fn path_segments(path: &str) -> Vec<String> {
    path.replace('/', "\\")
        .split('\\')
        .filter_map(|segment| {
            let trimmed = segment.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_lowercase())
            }
        })
        .collect()
}

fn location_score(path: &str) -> f64 {
    let segments = path_segments(path);
    if segments.is_empty() {
        return 0.0;
    }

    let mut best = 0.0f64;
    for (idx, segment) in segments.iter().enumerate() {
        if let Some((_, base)) = common_folder_priority(segment) {
            let depth_after = segments.len().saturating_sub(idx + 1) as f64;
            let near_profile_bonus = if idx <= 3 { 0.04 } else { 0.0 };
            let depth_decay = (depth_after * 0.025).min(0.16);
            best = best.max(base + near_profile_bonus - depth_decay);
        }
    }

    let normalized = segments.join("\\");
    let random_penalty = if normalized.contains("\\appdata\\")
        || normalized.contains("\\temp\\")
        || normalized.contains("\\tmp\\")
        || normalized.contains("\\cache\\")
        || normalized.contains("\\logs\\")
        || normalized.contains("\\packages\\")
    {
        0.18
    } else {
        0.0
    };
    let depth_penalty = ((segments.len().saturating_sub(6)) as f64 * 0.018).min(0.22);

    best - random_penalty - depth_penalty
}

fn score_search_result(filename: &str, path: &str, kind: &str, query_norm: &str) -> f64 {
    let mut score = score_filename(filename, query_norm) + location_score(path);
    if kind == "folder" {
        score += 0.03;
    }
    score.max(0.0)
}

/// Escape a token for use inside an FTS5 phrase ("...") and strip chars that
/// would break the parser.
fn sanitize_fts_token(tok: &str) -> String {
    tok.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .replace('"', "")
}

/// Common English stopwords that hurt FTS5 performance when ANDed into a query
/// — they match millions of rows but add no selectivity. The launcher search
/// box accepts free-form text (sometimes the user dictates a whole sentence),
/// so we filter aggressively rather than blindly intersecting posting lists.
fn is_fts_stopword(tok: &str) -> bool {
    matches!(
        tok,
        "the" | "a" | "an" | "and" | "or" | "but" | "of" | "in" | "on" | "at"
            | "to" | "for" | "with" | "by" | "from" | "as" | "is" | "are" | "was"
            | "were" | "be" | "been" | "being" | "am" | "i" | "you" | "he" | "she"
            | "it" | "we" | "they" | "this" | "that" | "these" | "those" | "my"
            | "your" | "his" | "her" | "its" | "our" | "their" | "me" | "us" | "them"
            | "do" | "does" | "did" | "have" | "has" | "had" | "can" | "could" | "will"
            | "would" | "should" | "may" | "might" | "must" | "shall" | "if" | "then"
            | "so" | "than" | "too" | "very" | "just" | "also" | "any" | "all" | "some"
            | "no" | "not" | "only" | "own" | "same" | "such" | "more" | "most" | "other"
            | "into" | "out" | "over" | "under" | "again" | "further" | "once"
            | "make" | "made" | "get" | "got"
    )
}

fn build_fts_match(tokens: &[String]) -> Option<String> {
    // Sanitize + deduplicate + drop stopwords/too-short tokens.
    let mut seen: HashSet<String> = HashSet::new();
    let mut clean: Vec<String> = Vec::new();
    for tok in tokens {
        let sanitized = sanitize_fts_token(tok);
        if sanitized.len() < 2 {
            continue;
        }
        if is_fts_stopword(&sanitized) {
            continue;
        }
        if !seen.insert(sanitized.clone()) {
            continue;
        }
        clean.push(sanitized);
    }

    // Fallback: if filtering ate every token (e.g. user typed only "of" or
    // "to"), keep the longest original token so search still finds *something*.
    if clean.is_empty() {
        if let Some(best) = tokens
            .iter()
            .map(|t| sanitize_fts_token(t))
            .filter(|t| !t.is_empty())
            .max_by_key(|t| t.len())
        {
            clean.push(best);
        }
    }

    if clean.is_empty() {
        return None;
    }

    // Cap how many tokens we AND together. FTS5 with N AND'd prefix matches
    // has to intersect N posting lists; on a multi-million row index that
    // turns a 200-char dictated query into a multi-second daemon stall (and
    // every keystroke after queues behind it). 6 tokens is plenty to narrow
    // a launcher search, and we prefer the longest (most-selective) ones.
    const MAX_FTS_TOKENS: usize = 6;
    if clean.len() > MAX_FTS_TOKENS {
        clean.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        clean.truncate(MAX_FTS_TOKENS);
    }

    let parts: Vec<String> = clean
        .into_iter()
        // Prefix match so typing "random_cha" finds "random_chaos"
        .map(|t| format!("\"{}\"*", t))
        .collect();
    Some(parts.join(" AND "))
}

fn location_order_sql() -> &'static str {
    "CASE
       WHEN LOWER(path) LIKE '%\\downloads\\%' THEN 0
       WHEN LOWER(path) LIKE '%\\documents\\%' OR LOWER(path) LIKE '%\\my documents\\%' THEN 1
       WHEN LOWER(path) LIKE '%\\desktop\\%' THEN 2
       WHEN LOWER(path) LIKE '%\\projects\\%' OR LOWER(path) LIKE '%\\code\\%' OR LOWER(path) LIKE '%\\development\\%' OR LOWER(path) LIKE '%\\dev\\%' OR LOWER(path) LIKE '%\\source\\%' OR LOWER(path) LIKE '%\\repos\\%' OR LOWER(path) LIKE '%\\github\\%' OR LOWER(path) LIKE '%\\work\\%' THEN 3
       WHEN LOWER(path) LIKE '%\\pictures\\%' OR LOWER(path) LIKE '%\\photos\\%' OR LOWER(path) LIKE '%\\images\\%' THEN 4
       WHEN LOWER(path) LIKE '%\\videos\\%' OR LOWER(path) LIKE '%\\movies\\%' THEN 5
       WHEN LOWER(path) LIKE '%\\music\\%' OR LOWER(path) LIKE '%\\audio\\%' THEN 6
       WHEN LOWER(path) LIKE '%\\onedrive\\%' OR LOWER(path) LIKE '%\\dropbox\\%' OR LOWER(path) LIKE '%\\google drive\\%' OR LOWER(path) LIKE '%\\icloud\\%' THEN 7
       ELSE 20
     END"
}

#[allow(dead_code)]
fn cmd_search(
    db_path: &str,
    query: &str,
    limit: usize,
    kind: Option<&str>,
    root_id: Option<&str>,
) -> Result<SearchOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    ensure_read_schema(&conn)?;
    do_search(&conn, query, limit, kind, root_id, false)
}

/// Daemon-friendly variant of `cmd_search` that reuses an already-open
/// connection. The daemon holds one `Connection` for the lifetime of the
/// process so the SQLite page cache stays warm across requests.
fn do_search(
    conn: &Connection,
    query: &str,
    limit: usize,
    kind: Option<&str>,
    root_id: Option<&str>,
    semantic_only: bool,
) -> Result<SearchOut, Box<dyn std::error::Error>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(SearchOut {
            ok: true,
            results: Vec::new(),
            count: 0,
        });
    }

    let q_norm = normalize_search_text(query);
    let tokens: Vec<String> = q_norm.split_whitespace().map(|s| s.to_string()).collect();
    // Bigger fetch window — we trade ~2x bytes pulled from SQLite for getting
    // a wider candidate pool that the Rust scorer can rank. The previous
    // `limit * 10` was tuned around ORDER BY bm25 narrowing the result; now
    // that we drop bm25 we want more candidates so common terms still find
    // the most-relevant hit.
    let fetch_limit = (limit * 20).max(300).min(2000);

    let mut collected: Vec<FileResult> = Vec::new();
    let fts_match_expr = build_fts_match(&tokens);
    let fts_was_attempted = fts_match_expr.is_some();

    // 1) Fast path: FTS5 MATCH with prefix tokens. O(log N) instead of O(N).
    if let Some(match_expr) = fts_match_expr {
        let mut sql = String::from(
            "SELECT f.* FROM indexed_files f
             JOIN files_fts fts ON fts.rowid = f.rowid
             WHERE files_fts MATCH ? AND f.status != 'deleted'",
        );
        let mut params_vec: Vec<String> = vec![match_expr];
        if let Some(k) = kind {
            sql.push_str(" AND f.kind = ?");
            params_vec.push(k.to_string());
        }
        let (scope_sql, scope_params) = folder_scope_sql(conn, root_id, semantic_only)?;
        sql.push_str(&scope_sql);
        params_vec.extend(scope_params);
        // No ORDER BY: FTS5's bm25() forces SQLite to score every matching
        // posting before LIMIT can short-circuit, so a common term like
        // "taxes" (thousands of matches) took 1.5–2s. Without ORDER BY,
        // SQLite returns the first N matches and stops. Our Rust-side
        // `score_search_result` (filename closeness + location priority)
        // already does the relevance ranking that mattered for the UI.
        sql.push_str(&format!(" LIMIT {}", fetch_limit));

        match conn.prepare(&sql) {
            Ok(mut stmt) => {
                let rows = stmt.query_map(
                    rusqlite::params_from_iter(params_vec.iter().map(|s| s.as_str())),
                    |row| {
                        let filename: String = row.get("filename")?;
                        let path: String = row.get("path")?;
                        let kind: String = row
                            .get::<_, Option<String>>("kind")?
                            .unwrap_or_else(|| "other".to_string());
                        let score = score_search_result(&filename, &path, &kind, &q_norm);
                        build_file_result(row, score, "fts")
                    },
                );
                if let Ok(rows) = rows {
                    for r in rows.flatten() {
                        collected.push(r);
                    }
                }
            }
            Err(_) => {
                // FTS not available — fall through to LIKE search below.
            }
        }
    }

    // 2) Fallback LIKE search ONLY when FTS couldn't build a valid query
    // (every token was too short / a stopword). If FTS actually ran and
    // returned zero matches, we trust that — the LIKE path does a full
    // table scan with instr() across millions of rows, which on this
    // user's 1.3GB index was a 1.7s stall for terms like "taxes" that
    // had no FTS hits (it would then find substring matches like
    // "syntaxes" in plugin paths, both expensive and confusing).
    if collected.is_empty() && !tokens.is_empty() && !fts_was_attempted {
        let mut where_parts: Vec<String> = vec!["status != 'deleted'".to_string()];
        let mut params_vec: Vec<String> = Vec::new();
        for tok in &tokens {
            where_parts
                .push("(instr(LOWER(filename), ?) > 0 OR instr(LOWER(path), ?) > 0)".to_string());
            let pat = tok.to_lowercase();
            params_vec.push(pat.clone());
            params_vec.push(pat);
        }
        if let Some(k) = kind {
            where_parts.push("kind = ?".to_string());
            params_vec.push(k.to_string());
        }
        let (scope_sql, scope_params) = folder_scope_sql(conn, root_id, semantic_only)?;
        if !scope_sql.is_empty() {
            where_parts.push(scope_sql.trim_start_matches(" AND ").to_string());
            params_vec.extend(scope_params);
        }
        let sql = format!(
            "SELECT * FROM indexed_files WHERE {} ORDER BY {}, mtime_ms DESC LIMIT {}",
            where_parts.join(" AND "),
            location_order_sql(),
            fetch_limit
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(params_vec.iter().map(|s| s.as_str())),
            |row| {
                let filename: String = row.get("filename")?;
                let path: String = row.get("path")?;
                let kind: String = row
                    .get::<_, Option<String>>("kind")?
                    .unwrap_or_else(|| "other".to_string());
                let score = score_search_result(&filename, &path, &kind, &q_norm);
                build_file_result(row, score, "like")
            },
        )?;
        for r in rows {
            collected.push(r?);
        }
    }

    collected.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.mtime_ms.cmp(&a.mtime_ms))
            .then_with(|| a.path.cmp(&b.path))
    });
    collected.truncate(limit);

    // Hydrate .lnk target paths for the final few results only — see comment
    // in build_file_result. This is the only spot where we touch the disk
    // per row, so containing it to ≤ `limit` rows (default 12) is critical.
    for result in collected.iter_mut() {
        if result.extension.eq_ignore_ascii_case(".lnk") {
            result.target_path = resolve_lnk_target(&result.path);
        }
    }

    let count = collected.len();
    Ok(SearchOut {
        ok: true,
        results: collected,
        count,
    })
}

// ─────────────────────────────────────────────────────────
// Folder listing
// ─────────────────────────────────────────────────────────

fn cmd_list_folder(
    db_path: &str,
    path: &str,
    recursive: bool,
    limit: usize,
) -> Result<SearchOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    ensure_read_schema(&conn)?;
    do_list_folder(&conn, path, recursive, limit)
}

fn do_list_folder(
    conn: &Connection,
    path: &str,
    recursive: bool,
    limit: usize,
) -> Result<SearchOut, Box<dyn std::error::Error>> {
    let normalized = path.trim_end_matches(['\\', '/']).replace('/', "\\");
    let prefix_any = format!("{}\\%", normalized);

    let mut results: Vec<FileResult> = Vec::new();
    if recursive {
        let sql = format!(
            "SELECT * FROM indexed_files WHERE path LIKE ? AND status != 'deleted' ORDER BY path LIMIT {}",
            limit
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![prefix_any], |row| {
            build_file_result(row, 1.0, "folder")
        })?;
        for r in rows {
            results.push(r?);
        }
    } else {
        // direct children only: match prefix but exclude rows with an extra backslash after it
        let deeper = format!("{}\\%\\%", normalized);
        let sql = format!(
            "SELECT * FROM indexed_files WHERE path LIKE ? AND path NOT LIKE ? AND status != 'deleted' ORDER BY filename LIMIT {}",
            limit
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![prefix_any, deeper], |row| {
            build_file_result(row, 1.0, "folder")
        })?;
        for r in rows {
            results.push(r?);
        }
    }

    let count = results.len();
    Ok(SearchOut {
        ok: true,
        results,
        count,
    })
}

// ─────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────

fn cmd_stats(db_path: &str) -> Result<StatsOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    ensure_read_schema(&conn)?;
    do_stats(&conn)
}

fn do_stats(conn: &Connection) -> Result<StatsOut, Box<dyn std::error::Error>> {
    let roots: i64 = conn.query_row("SELECT COUNT(*) FROM indexed_roots", [], |r| r.get(0))?;
    let total_files: i64 = conn.query_row(
        "SELECT COUNT(*) FROM indexed_files WHERE status != 'deleted'",
        [],
        |r| r.get(0),
    )?;
    let indexed_files: i64 = conn.query_row(
        "SELECT COUNT(*) FROM indexed_files WHERE status = 'indexed'",
        [],
        |r| r.get(0),
    )?;
    let pending_files: i64 = conn.query_row(
        "SELECT COUNT(*) FROM indexed_files WHERE status IN ('pending','stale')",
        [],
        |r| r.get(0),
    )?;
    let folders: i64 = conn.query_row(
        "SELECT COUNT(*) FROM indexed_files WHERE kind = 'folder' AND status != 'deleted'",
        [],
        |r| r.get(0),
    )?;

    let mut stmt = conn.prepare(
        "SELECT kind, COUNT(*) FROM indexed_files WHERE status != 'deleted' GROUP BY kind",
    )?;
    let mut by_kind = serde_json::Map::new();
    let rows = stmt.query_map([], |row| {
        let k: String = row.get(0)?;
        let v: i64 = row.get(1)?;
        Ok((k, v))
    })?;
    for r in rows {
        let (k, v) = r?;
        by_kind.insert(k, serde_json::Value::Number(v.into()));
    }

    Ok(StatsOut {
        ok: true,
        roots,
        total_files,
        indexed_files,
        pending_files,
        folders,
        files_by_kind: serde_json::Value::Object(by_kind),
    })
}

// ─────────────────────────────────────────────────────────
// Semantic embeddings (vector storage + search)
// ─────────────────────────────────────────────────────────

/// Pack an embedding vector as raw little-endian f32 bytes for the `vector` BLOB.
fn pack_vector(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

/// Inverse of `pack_vector`.
fn unpack_vector(bytes: &[u8]) -> Vec<f32> {
    let n = bytes.len() / 4;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let b = [
            bytes[i * 4],
            bytes[i * 4 + 1],
            bytes[i * 4 + 2],
            bytes[i * 4 + 3],
        ];
        out.push(f32::from_le_bytes(b));
    }
    out
}

/// Cosine similarity in [-1, 1]; 0 when either vector is empty/zero or the
/// dimensions don't match (e.g. an embedding written by a different model).
fn cosine(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0f64;
    let mut na = 0f64;
    let mut nb = 0f64;
    for i in 0..a.len() {
        let x = a[i] as f64;
        let y = b[i] as f64;
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/// Minimum cosine similarity for vector-only semantic hits. Matches below this
/// are dropped so hybrid/semantic search does not surface unrelated files.
///
/// Default 0.385, NOT 0.4: cross-modal similarity (a TEXT query against an IMAGE
/// embedding) runs systematically lower than text→text, so genuinely-correct
/// image matches land around 0.30–0.42 (e.g. a white-shirt photo scored 0.34 for
/// the query "white shirt"). A 0.4 floor silently dropped those correct hits.
/// The clearly-irrelevant floor sits ~0.24, so 0.385 keeps good separation.
/// Override via STUARD_INDEXER_SEMANTIC_MIN to tune without a rebuild.
fn semantic_similarity_min() -> f64 {
    std::env::var("STUARD_INDEXER_SEMANTIC_MIN")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| (0.0..=1.0).contains(v))
        .unwrap_or(0.385)
}

/// Brute-force vector search over the embedded subset. Cheap in practice
/// because embedding is opt-in + credit-capped, so only a bounded number of
/// rows carry a vector. `MAX_SCAN` is a hard ceiling so a pathological index
/// can't stall a query.
fn vector_collect(
    conn: &Connection,
    query_vec: &[f32],
    fetch_limit: usize,
    kind: Option<&str>,
    root_id: Option<&str>,
    semantic_only: bool,
) -> Result<Vec<FileResult>, Box<dyn std::error::Error>> {
    const MAX_SCAN: usize = 100_000;
    let mut sql =
        String::from("SELECT * FROM indexed_files WHERE vector IS NOT NULL AND status = 'indexed'");
    let mut params_vec: Vec<String> = Vec::new();
    if let Some(k) = kind {
        sql.push_str(" AND kind = ?");
        params_vec.push(k.to_string());
    }
    let (scope_sql, scope_params) = folder_scope_sql(conn, root_id, semantic_only)?;
    sql.push_str(&scope_sql);
    params_vec.extend(scope_params);
    sql.push_str(&format!(" LIMIT {}", MAX_SCAN));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(params_vec.iter().map(|s| s.as_str())),
        |row| {
            let blob: Vec<u8> = row.get("vector")?;
            let stored = unpack_vector(&blob);
            let cos = cosine(query_vec, &stored).max(0.0);
            build_file_result(row, cos, "vector")
        },
    )?;
    let min_score = semantic_similarity_min();
    let mut out: Vec<FileResult> = Vec::new();
    for r in rows.flatten() {
        if r.score >= min_score {
            out.push(r);
        }
    }
    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(fetch_limit);
    Ok(out)
}

/// Merge keyword (FTS) and vector candidates into one ranked list. FTS scores
/// (filename/location closeness) and cosine are each clamped to [0,1], blended,
/// and given a small bonus when a file matched both signals.
fn merge_hybrid(fts: Vec<FileResult>, vector: Vec<FileResult>) -> Vec<FileResult> {
    use std::collections::HashMap;
    const W_FTS: f64 = 0.45;
    const W_VEC: f64 = 0.55;
    const OVERLAP_BONUS: f64 = 0.05;

    let mut map: HashMap<String, FileResult> = HashMap::new();
    for mut r in fts {
        r.score = W_FTS * r.score.clamp(0.0, 1.0);
        r.match_type = "hybrid".to_string();
        map.insert(r.id.clone(), r);
    }
    for mut r in vector {
        let cos = r.score.clamp(0.0, 1.0);
        if let Some(existing) = map.get_mut(&r.id) {
            existing.score += W_VEC * cos + OVERLAP_BONUS;
        } else {
            r.score = W_VEC * cos;
            r.match_type = "hybrid".to_string();
            map.insert(r.id.clone(), r);
        }
    }
    map.into_values().collect()
}

fn finalize_results(results: &mut Vec<FileResult>, limit: usize) {
    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.mtime_ms.cmp(&a.mtime_ms))
            .then_with(|| a.path.cmp(&b.path))
    });
    results.truncate(limit);
    for result in results.iter_mut() {
        if result.target_path.is_none() && result.extension.eq_ignore_ascii_case(".lnk") {
            result.target_path = resolve_lnk_target(&result.path);
        }
    }
}

/// Vector-aware search. Falls back to the FTS path (`do_search`) when no query
/// vector is supplied or `mode` is `quick`, preserving existing behaviour.
fn do_search_ext(
    conn: &Connection,
    query: &str,
    limit: usize,
    kind: Option<&str>,
    root_id: Option<&str>,
    vector: Option<&[f32]>,
    mode: &str,
) -> Result<SearchOut, Box<dyn std::error::Error>> {
    let has_vector = vector.map(|v| !v.is_empty()).unwrap_or(false);
    let effective_mode = if has_vector { mode } else { "quick" };
    // Meaning search spans every user-opted semantic folder unless a specific
    // root was requested. Without this, a parent auto-index root (Desktop,
    // OneDrive, …) drowns out earlier embedded folders by mtime/recency.
    let semantic_only =
        root_id.is_none() && (effective_mode == "semantic" || effective_mode == "hybrid");

    match effective_mode {
        "semantic" => {
            let v = vector.unwrap();
            let mut results =
                vector_collect(conn, v, limit.max(1), kind, root_id, semantic_only)?;
            finalize_results(&mut results, limit);
            let count = results.len();
            Ok(SearchOut {
                ok: true,
                results,
                count,
            })
        }
        "hybrid" => {
            let v = vector.unwrap();
            // Wider candidate windows so neither signal is starved pre-merge.
            let fts = do_search(
                conn,
                query,
                (limit * 4).clamp(limit, 200),
                kind,
                root_id,
                semantic_only,
            )?;
            let vec_results = vector_collect(
                conn,
                v,
                (limit * 4).clamp(limit, 400),
                kind,
                root_id,
                semantic_only,
            )?;
            let mut merged = merge_hybrid(fts.results, vec_results);
            finalize_results(&mut merged, limit);
            let count = merged.len();
            Ok(SearchOut {
                ok: true,
                results: merged,
                count,
            })
        }
        _ => do_search(conn, query, limit, kind, root_id, false),
    }
}

/// SQL fragment + params that restrict rows to one folder (by path prefix, not
/// the unreliable root_id column) or to the union of all semantic opt-in roots.
fn folder_scope_sql(
    conn: &Connection,
    root_id: Option<&str>,
    semantic_only: bool,
) -> Result<(String, Vec<String>), Box<dyn std::error::Error>> {
    if let Some(rid) = root_id {
        if let Some(folder) = root_path(conn, rid) {
            let (lo, hi) = path_prefix_range(&folder);
            return Ok((" AND path >= ? AND path < ?".to_string(), vec![lo, hi]));
        }
        return Ok((" AND root_id = ?".to_string(), vec![rid.to_string()]));
    }
    if !semantic_only {
        return Ok((String::new(), Vec::new()));
    }
    let mut stmt =
        conn.prepare("SELECT path FROM indexed_roots WHERE semantic = 1 AND enabled != 0")?;
    let folders: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    if folders.is_empty() {
        return Ok((" AND 0".to_string(), Vec::new()));
    }
    let mut clause = String::from(" AND (");
    let mut params = Vec::new();
    for (i, folder) in folders.iter().enumerate() {
        if i > 0 {
            clause.push_str(" OR ");
        }
        let (lo, hi) = path_prefix_range(folder);
        clause.push_str("(path >= ? AND path < ?)");
        params.push(lo);
        params.push(hi);
    }
    clause.push(')');
    Ok((clause, params))
}

/// Build an indexed half-open range [lo, hi) that matches every path inside a
/// folder. Used so "this folder" means everything physically under it,
/// regardless of which indexed_root currently owns the row (nested roots steal
/// each other's `root_id` on rescan). `path` is UNIQUE → this is an index range
/// scan, not a LIKE table scan.
fn path_prefix_range(folder: &str) -> (String, String) {
    let norm = folder.replace('/', "\\");
    let base = norm.trim_end_matches('\\');
    let lo = format!("{}\\", base); // children start with "<folder>\"
    // Upper bound: bump the trailing separator (0x5C '\') to 0x5D (']') so the
    // range covers every "<folder>\..." path but nothing else.
    let mut hi = lo.clone();
    hi.pop();
    hi.push(']');
    (lo, hi)
}

/// Look up a root's folder path by id.
fn root_path(conn: &Connection, root_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT path FROM indexed_roots WHERE id = ?",
        params![root_id],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

/// Files that have been crawled but not yet embedded, scoped by folder PATH (not
/// root_id) so nested folders see their files even when a parent root owns them.
fn do_get_pending(
    conn: &Connection,
    root_id: Option<&str>,
    limit: usize,
) -> Result<PendingOut, Box<dyn std::error::Error>> {
    // Only content-bearing kinds are semantically embeddable. Videos/audio/
    // binaries would be "name only" embeds (just the filename as text) which add
    // no semantic value and, worse, outrank real image/text embeds for text
    // queries (same-modal text↔text cosine > cross-modal text↔image). They stay
    // findable by filename via FTS.
    let mut sql = String::from(
        "SELECT id, path, filename, extension, kind, size FROM indexed_files
         WHERE status IN ('pending','stale') AND kind IN ('image','document','code')",
    );
    let mut params_vec: Vec<String> = Vec::new();
    if let Some(rid) = root_id {
        if let Some(folder) = root_path(conn, rid) {
            let (lo, hi) = path_prefix_range(&folder);
            sql.push_str(" AND path >= ? AND path < ?");
            params_vec.push(lo);
            params_vec.push(hi);
        } else {
            // Unknown root → fall back to exact root_id so we never return the
            // whole index by accident.
            sql.push_str(" AND root_id = ?");
            params_vec.push(rid.to_string());
        }
    }
    // Smallest files first so a credit-capped job can include as many as possible.
    sql.push_str(&format!(" ORDER BY size ASC LIMIT {}", limit));

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(params_vec.iter().map(|s| s.as_str())),
        |row| {
            Ok(PendingFileOut {
                id: row.get("id")?,
                path: row.get("path")?,
                filename: row.get("filename")?,
                extension: row.get::<_, Option<String>>("extension")?.unwrap_or_default(),
                kind: row
                    .get::<_, Option<String>>("kind")?
                    .unwrap_or_else(|| "other".to_string()),
                size: row.get("size")?,
            })
        },
    )?;
    let mut files = Vec::new();
    for r in rows {
        files.push(r?);
    }
    let count = files.len();
    Ok(PendingOut {
        ok: true,
        files,
        count,
    })
}

/// Write an embedding (+ summary/keywords) back to a file row and mark it indexed.
fn do_update_embedding(
    conn: &Connection,
    file_id: &str,
    vector: &[f32],
    summary: Option<&str>,
    keywords: Option<&str>,
    model: &str,
) -> Result<OkOut, Box<dyn std::error::Error>> {
    let blob = pack_vector(vector);
    let now = now_iso();
    conn.execute(
        "UPDATE indexed_files
            SET vector = ?, summary = ?, keywords = ?, embedding_model_version = ?,
                status = 'indexed', indexed_at = ?, error_message = NULL
          WHERE id = ?",
        params![blob, summary, keywords, model, now, file_id],
    )?;
    Ok(OkOut { ok: true })
}

/// Mark a file as errored so it stops appearing in the pending queue.
fn do_mark_error(
    conn: &Connection,
    file_id: &str,
    message: &str,
) -> Result<OkOut, Box<dyn std::error::Error>> {
    conn.execute(
        "UPDATE indexed_files SET status = 'error', error_message = ? WHERE id = ?",
        params![message, file_id],
    )?;
    Ok(OkOut { ok: true })
}

#[derive(Serialize)]
struct ClearEmbeddingsOut {
    ok: bool,
    cleared: i64,
    had_vectors: i64,
}

/// Wipe semantic state so a folder (or the whole index) starts from scratch:
/// drop vectors/summary/keywords and flip already-embedded rows back to
/// `pending` so they can be re-embedded. Keeps the crawl (name search) intact.
/// Scoped by folder PATH (not root_id, which nested roots steal) and optionally
/// restricted to specific kinds (e.g. purge only name-only video/audio vectors).
fn do_clear_embeddings(
    conn: &Connection,
    root_id: Option<&str>,
    kinds: &[String],
) -> Result<ClearEmbeddingsOut, Box<dyn std::error::Error>> {
    let mut where_parts: Vec<String> = vec!["status != 'deleted'".to_string()];
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(rid) = root_id {
        if let Some(folder) = root_path(conn, rid) {
            let (lo, hi) = path_prefix_range(&folder);
            where_parts.push("path >= ? AND path < ?".to_string());
            params_vec.push(Box::new(lo));
            params_vec.push(Box::new(hi));
        } else {
            where_parts.push("root_id = ?".to_string());
            params_vec.push(Box::new(rid.to_string()));
        }
    }
    if !kinds.is_empty() {
        let placeholders = kinds.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        where_parts.push(format!("kind IN ({})", placeholders));
        for k in kinds {
            params_vec.push(Box::new(k.clone()));
        }
    }
    let where_sql = where_parts.join(" AND ");
    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

    let had_vectors: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM indexed_files WHERE vector IS NOT NULL AND {}", where_sql),
        params_refs.as_slice(),
        |r| r.get(0),
    )?;

    let cleared = conn.execute(
        &format!(
            "UPDATE indexed_files
                SET vector = NULL, summary = NULL, keywords = NULL,
                    embedding_model_version = NULL, summary_model_version = NULL,
                    indexed_at = NULL, error_message = NULL,
                    status = CASE WHEN status IN ('indexed','error') THEN 'pending' ELSE status END
              WHERE {}",
            where_sql
        ),
        params_refs.as_slice(),
    )? as i64;

    Ok(ClearEmbeddingsOut {
        ok: true,
        cleared,
        had_vectors,
    })
}

// One-shot CLI wrappers (the desktop bridge drives these through the daemon,
// but the standalone subcommands are handy for testing/debugging).

fn cmd_search_ext(
    db_path: &str,
    query: &str,
    limit: usize,
    kind: Option<&str>,
    root_id: Option<&str>,
    vector: Option<&[f32]>,
    mode: &str,
) -> Result<SearchOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    ensure_read_schema(&conn)?;
    do_search_ext(&conn, query, limit, kind, root_id, vector, mode)
}

fn cmd_get_pending(
    db_path: &str,
    root_id: Option<&str>,
    limit: usize,
) -> Result<PendingOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    ensure_read_schema(&conn)?;
    do_get_pending(&conn, root_id, limit)
}

fn cmd_update_embedding(
    db_path: &str,
    file_id: &str,
    vector: &[f32],
    summary: Option<&str>,
    keywords: Option<&str>,
    model: &str,
) -> Result<OkOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    do_update_embedding(&conn, file_id, vector, summary, keywords, model)
}

fn cmd_mark_error(
    db_path: &str,
    file_id: &str,
    message: &str,
) -> Result<OkOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    do_mark_error(&conn, file_id, message)
}

fn cmd_clear_embeddings(
    db_path: &str,
    root_id: Option<&str>,
    kinds: &[String],
) -> Result<ClearEmbeddingsOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    do_clear_embeddings(&conn, root_id, kinds)
}

/// Parse a vector from either a `--vector` JSON-array flag or a `--vector-file`
/// path. Used only by the one-shot CLI subcommands.
fn parse_vector_flag(inline: Option<String>, file: Option<String>) -> Option<Vec<f32>> {
    let raw = match (inline, file) {
        (_, Some(f)) => fs::read_to_string(f).ok()?,
        (Some(s), None) => s,
        (None, None) => return None,
    };
    let val: serde_json::Value = serde_json::from_str(&raw).ok()?;
    val.as_array().map(|a| {
        a.iter()
            .filter_map(|x| x.as_f64().map(|f| f as f32))
            .collect()
    })
}

// ─────────────────────────────────────────────────────────
// Daemon mode — persistent process, reads JSON requests from stdin.
//
// Protocol: one JSON request per line on stdin, one JSON response per line
// on stdout. Electron can keep one child running and reuse it for every
// search, avoiding the ~800ms Windows cold-spawn penalty.
//
// Request:  { "id": "<any>", "cmd": "search", "args": { "query": "…", "limit": 12 } }
// Response: { "id": "<same>", "ok": true, "results": […] }  OR  { "id": …, "ok": false, "error": "…" }
// ─────────────────────────────────────────────────────────

struct DaemonJob {
    id: serde_json::Value,
    cmd: String,
    args: serde_json::Value,
}

fn build_envelope(
    id: serde_json::Value,
    response: Result<serde_json::Value, Box<dyn std::error::Error>>,
) -> serde_json::Value {
    match response {
        Ok(value) => {
            let mut obj = match value {
                serde_json::Value::Object(m) => m,
                other => {
                    let mut m = serde_json::Map::new();
                    m.insert("value".to_string(), other);
                    m
                }
            };
            obj.insert("id".to_string(), id);
            serde_json::Value::Object(obj)
        }
        Err(err) => serde_json::json!({ "id": id, "ok": false, "error": err.to_string() }),
    }
}

fn cmd_daemon(db_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{BufRead, BufReader, Write};

    // Multi-threaded daemon: a small pool of workers, each holding its own
    // SQLite connection, handles requests in parallel. Single-threaded mode
    // queued every keystroke behind a slow query — when the user dictated a
    // long phrase the agent forwarded it as a `file_search` tool call, and
    // every later request stalled until the first one finished. With WAL
    // mode + per-worker connections, SQLite reads are genuinely concurrent.
    let workers: usize = std::env::var("STUARD_INDEXER_DAEMON_WORKERS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(4)
        .clamp(1, 16);

    // Validate the DB once before spawning workers so an init/permission
    // problem surfaces as a clean error instead of N silent worker deaths.
    {
        let conn = open_db(db_path)?;
        ensure_read_schema(&conn)?;
        ensure_root_columns(&conn)?;
    }

    let (job_tx, job_rx) = unbounded::<DaemonJob>();
    let (writer_tx, writer_rx) = unbounded::<String>();

    // Writer thread owns stdout — every response, including the initial
    // ready signal, goes through here so we never interleave bytes from
    // multiple workers mid-line.
    let writer = thread::spawn(move || {
        let stdout = std::io::stdout();
        let mut out = stdout.lock();
        while let Ok(line) = writer_rx.recv() {
            if writeln!(out, "{}", line).is_err() {
                break;
            }
            if out.flush().is_err() {
                break;
            }
        }
    });

    // Initial ready signal — kept inside its own scope so the cloned sender
    // drops before we send any real responses (not strictly required, but
    // makes shutdown semantics obvious).
    {
        let tx = writer_tx.clone();
        let _ = tx.send(
            serde_json::json!({ "ok": true, "ready": true })
                .to_string(),
        );
    }

    let mut worker_handles = Vec::with_capacity(workers);
    for worker_idx in 0..workers {
        let job_rx = job_rx.clone();
        let writer_tx = writer_tx.clone();
        let db_path = db_path.to_string();
        let handle = thread::spawn(move || {
            let conn = match open_db(&db_path) {
                Ok(c) => c,
                Err(err) => {
                    eprintln!(
                        "[daemon worker {}] open_db failed: {}",
                        worker_idx, err
                    );
                    return;
                }
            };
            // Schema is ensured by the validation block above; per-worker
            // setup is just the pragmas in open_db.
            while let Ok(job) = job_rx.recv() {
                let response = dispatch_daemon_cmd(&conn, &job.cmd, &job.args);
                let envelope = build_envelope(job.id, response);
                if let Ok(serialized) = serde_json::to_string(&envelope) {
                    if writer_tx.send(serialized).is_err() {
                        break;
                    }
                }
            }
        });
        worker_handles.push(handle);
    }
    // Drop the originals so the writer thread can shut down cleanly once all
    // workers exit (each worker holds its own clone).
    drop(job_rx);
    drop(writer_tx);

    let stdin = std::io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader.read_line(&mut line)?;
        if bytes == 0 {
            break; // EOF — parent closed stdin
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => {
                // Bad JSON has no id we can correlate to — just ignore so
                // a single broken line can't kill the daemon. Original
                // implementation emitted an id-less error which the TS side
                // discarded anyway.
                continue;
            }
        };

        let id = req.get("id").cloned().unwrap_or(serde_json::Value::Null);
        let cmd = req
            .get("cmd")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let args = req.get("args").cloned().unwrap_or(serde_json::json!({}));

        if job_tx.send(DaemonJob { id, cmd, args }).is_err() {
            break;
        }
    }

    // Shutdown: drop sender to let workers drain and exit.
    drop(job_tx);
    for h in worker_handles {
        let _ = h.join();
    }
    let _ = writer.join();
    Ok(())
}

fn dispatch_daemon_cmd(
    conn: &Connection,
    cmd: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let as_str = |key: &str| {
        args.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    let as_i64 = |key: &str| args.get(key).and_then(|v| v.as_i64());
    let as_vec = |key: &str| -> Option<Vec<f32>> {
        args.get(key).and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_f64().map(|f| f as f32))
                .collect()
        })
    };

    match cmd {
        "search" => {
            let query = as_str("query").unwrap_or_default();
            let limit = as_i64("limit").unwrap_or(50) as usize;
            let kind = as_str("kind");
            let root_id = as_str("root_id").or_else(|| as_str("root-id"));
            let vector = as_vec("vector");
            let has_vector = vector.as_ref().map(|v| !v.is_empty()).unwrap_or(false);
            let mode = as_str("mode")
                .unwrap_or_else(|| if has_vector { "hybrid".into() } else { "quick".into() });
            let out = do_search_ext(
                conn,
                &query,
                limit.clamp(1, 500),
                kind.as_deref(),
                root_id.as_deref(),
                vector.as_deref(),
                &mode,
            )?;
            Ok(serde_json::to_value(out)?)
        }
        "get-pending" | "get_pending" => {
            let root_id = as_str("root_id").or_else(|| as_str("root-id"));
            let limit = as_i64("limit").unwrap_or(500) as usize;
            Ok(serde_json::to_value(do_get_pending(
                conn,
                root_id.as_deref(),
                limit.clamp(1, 5000),
            )?)?)
        }
        "update-embedding" | "update_embedding" => {
            let file_id = as_str("file_id")
                .or_else(|| as_str("file-id"))
                .ok_or_else(|| "missing file_id".to_string())?;
            let vector = as_vec("vector").ok_or_else(|| "missing vector".to_string())?;
            if vector.is_empty() {
                return Err("empty vector".into());
            }
            let summary = as_str("summary");
            let keywords = as_str("keywords");
            let model = as_str("embedding_model")
                .or_else(|| as_str("embedding-model"))
                .unwrap_or_else(|| "gemini-embedding-2-preview".to_string());
            Ok(serde_json::to_value(do_update_embedding(
                conn,
                &file_id,
                &vector,
                summary.as_deref(),
                keywords.as_deref(),
                &model,
            )?)?)
        }
        "mark-error" | "mark_error" => {
            let file_id = as_str("file_id")
                .or_else(|| as_str("file-id"))
                .ok_or_else(|| "missing file_id".to_string())?;
            let message = as_str("error_message")
                .or_else(|| as_str("error-message"))
                .unwrap_or_default();
            Ok(serde_json::to_value(do_mark_error(conn, &file_id, &message)?)?)
        }
        "clear-embeddings" | "clear_embeddings" => {
            let root_id = as_str("root_id").or_else(|| as_str("root-id"));
            let kinds: Vec<String> = as_str("kinds")
                .map(|s| s.split(',').map(|k| k.trim().to_string()).filter(|k| !k.is_empty()).collect())
                .unwrap_or_default();
            Ok(serde_json::to_value(do_clear_embeddings(conn, root_id.as_deref(), &kinds)?)?)
        }
        "stats" => Ok(serde_json::to_value(do_stats(conn)?)?),
        "list-roots" | "list_roots" => Ok(serde_json::to_value(do_list_roots(conn)?)?),
        "list-folder" | "list_folder" => {
            let folder = as_str("path").unwrap_or_default();
            let limit = as_i64("limit").unwrap_or(200) as usize;
            let recursive = args
                .get("recursive")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Ok(serde_json::to_value(do_list_folder(
                conn,
                &folder,
                recursive,
                limit.clamp(1, 2000),
            )?)?)
        }
        "ping" => Ok(serde_json::json!({ "ok": true, "pong": true })),
        other => Err(format!("unknown_daemon_cmd: {}", other).into()),
    }
}

// ─────────────────────────────────────────────────────────
// CLI dispatch
// ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_prioritizes_common_user_folders() {
        assert!(scan_dir_priority("Downloads") < scan_dir_priority("RandomFolder"));
        assert!(scan_dir_priority("Documents") < scan_dir_priority("RandomFolder"));
        assert!(scan_dir_priority("Projects") < scan_dir_priority("RandomFolder"));
    }

    #[test]
    fn search_score_prefers_common_folders_for_similar_matches() {
        let query = normalize_search_text("budget");
        let downloads_score = score_search_result(
            "budget.xlsx",
            "C:\\Users\\solar\\Downloads\\budget.xlsx",
            "document",
            &query,
        );
        let random_score = score_search_result(
            "budget.xlsx",
            "C:\\Users\\solar\\RandomStuff\\deep\\archive\\budget.xlsx",
            "document",
            &query,
        );
        assert!(downloads_score > random_score);
    }

    #[test]
    fn exact_filename_match_still_beats_common_folder_prefix_match() {
        let query = normalize_search_text("budget");
        let exact_random_score = score_search_result(
            "budget.xlsx",
            "C:\\Users\\solar\\RandomStuff\\budget.xlsx",
            "document",
            &query,
        );
        let prefix_downloads_score = score_search_result(
            "budget draft.xlsx",
            "C:\\Users\\solar\\Downloads\\budget draft.xlsx",
            "document",
            &query,
        );
        assert!(exact_random_score > prefix_downloads_score);
    }

    #[test]
    fn build_fts_match_caps_token_count_and_drops_stopwords() {
        // Simulates the launcher receiving a long dictated phrase. Without
        // capping/filtering, FTS5 would AND ~20 posting lists together and
        // chew on it for seconds.
        let phrase = normalize_search_text(
            "fix the file search and make it faster some icons dont show even some applications",
        );
        let tokens: Vec<String> = phrase.split_whitespace().map(String::from).collect();
        let expr = build_fts_match(&tokens).expect("non-empty");
        let and_count = expr.matches(" AND ").count();
        assert!(and_count <= 5, "expected <=5 AND clauses, got: {} ({})", and_count, expr);
        assert!(!expr.to_lowercase().contains("\"the\""), "stopword leaked: {}", expr);
        assert!(!expr.to_lowercase().contains("\"and\""), "stopword leaked: {}", expr);
    }

    #[test]
    fn build_fts_match_keeps_something_when_only_stopwords() {
        // Pathological input — if every token is filtered, we still want a
        // search rather than silently returning no results.
        let phrase = normalize_search_text("of to the and");
        let tokens: Vec<String> = phrase.split_whitespace().map(String::from).collect();
        let expr = build_fts_match(&tokens).expect("non-empty fallback");
        assert!(!expr.is_empty());
    }

    #[test]
    fn pack_unpack_vector_roundtrip() {
        let v = vec![0.5f32, -1.0, 2.25, 0.0, 7.5];
        let packed = pack_vector(&v);
        assert_eq!(packed.len(), v.len() * 4);
        assert_eq!(unpack_vector(&packed), v);
    }

    #[test]
    fn cosine_orders_by_similarity() {
        let q = vec![1.0f32, 0.0, 0.0];
        let near = vec![0.9f32, 0.1, 0.0];
        let far = vec![0.0f32, 1.0, 0.0];
        assert!(cosine(&q, &near) > cosine(&q, &far));
        assert_eq!(cosine(&q, &[]), 0.0); // dimension mismatch → 0
    }

    #[test]
    fn parse_excludes_handles_separators_and_wildcards() {
        let ex = parse_excludes(Some("node_modules, *.cache\n;  Vendor  "));
        assert!(ex.contains(&"node_modules".to_string()));
        assert!(ex.contains(&".cache".to_string()));
        assert!(ex.contains(&"vendor".to_string()));
        assert!(parse_excludes(None).is_empty());
    }

    #[test]
    fn embedding_writeback_then_semantic_search() {
        let dir = std::env::temp_dir().join(format!("sfi-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("idx.db").to_string_lossy().to_string();
        let conn = open_db(&db_path).unwrap();
        init_schema(&conn).unwrap();
        ensure_root_columns(&conn).unwrap();

        // Paths use backslashes like production (normalize_path). The Camera
        // Roll bug came from a nested file owned by a *different* root_id, so
        // f2 is deliberately assigned to a parent root id while living under r1's
        // path — get-pending must still find it (path-scoped, not root_id-scoped).
        conn.execute(
            "INSERT INTO indexed_roots (id, path, enabled, schedule, last_scan_id, created_at, semantic)
             VALUES ('r1','C:\\x',1,'daily',0,?,1)",
            params![now_iso()],
        )
        .unwrap();
        // Broader parent root that the nested file is (wrongly) assigned to.
        conn.execute(
            "INSERT INTO indexed_roots (id, path, enabled, schedule, last_scan_id, created_at)
             VALUES ('parent-root','C:\\',1,'daily',0,?)",
            params![now_iso()],
        )
        .unwrap();
        for (id, p, name, owner) in [
            ("f1", "C:\\x\\a.txt", "a.txt", "r1"),
            ("f2", "C:\\x\\sub\\b.txt", "b.txt", "parent-root"),
        ] {
            conn.execute(
                "INSERT INTO indexed_files
                   (id, root_id, path, filename, extension, kind, size, mtime_ms, status, last_seen_scan_id, created_at)
                 VALUES (?,?,?,?,?,?,?,?, 'pending', 0, ?)",
                params![id, owner, p, name, ".txt", "document", 10i64, 0i64, now_iso()],
            )
            .unwrap();
        }

        // Both files under r1's path are pending — including f2 owned by another root.
        assert_eq!(do_get_pending(&conn, Some("r1"), 100).unwrap().count, 2);

        do_update_embedding(&conn, "f1", &[1.0, 0.0, 0.0], Some("alpha"), Some("a"), "test").unwrap();
        do_update_embedding(&conn, "f2", &[0.0, 1.0, 0.0], Some("beta"), Some("b"), "test").unwrap();

        // After embedding, nothing is pending.
        assert_eq!(do_get_pending(&conn, Some("r1"), 100).unwrap().count, 0);

        // Query vector closest to f1 must rank f1 first.
        let out = do_search_ext(&conn, "", 5, None, None, Some(&[0.95, 0.05, 0.0]), "semantic").unwrap();
        assert!(out.results.len() >= 2);
        assert_eq!(out.results[0].id, "f1");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn semantic_search_includes_every_opted_in_root() {
        let dir = std::env::temp_dir().join(format!("sfi-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("idx.db").to_string_lossy().to_string();
        let conn = open_db(&db_path).unwrap();
        init_schema(&conn).unwrap();
        ensure_root_columns(&conn).unwrap();
        let now = now_iso();
        for (id, path) in [("rA", "C:\\folderA"), ("rB", "C:\\folderB")] {
            conn.execute(
                "INSERT INTO indexed_roots (id, path, enabled, schedule, last_scan_id, created_at, semantic)
                 VALUES (?,?,1,'daily',0,?,1)",
                params![id, path, now],
            )
            .unwrap();
        }
        for (id, p, name, owner) in [
            ("fa", "C:\\folderA\\old.jpg", "old.jpg", "rA"),
            ("fb", "C:\\folderB\\new.jpg", "new.jpg", "rB"),
        ] {
            conn.execute(
                "INSERT INTO indexed_files
                   (id, root_id, path, filename, extension, kind, size, mtime_ms, status, last_seen_scan_id, created_at, vector)
                 VALUES (?,?,?,?,?,?,?,?,'indexed',0,?,?)",
                params![
                    id,
                    owner,
                    p,
                    name,
                    ".jpg",
                    "image",
                    10i64,
                    if id == "fa" { 1i64 } else { 999i64 },
                    now,
                    pack_vector(&[if id == "fa" { 1.0f32 } else { 0.8 }, 0.0, 0.0]),
                ],
            )
            .unwrap();
        }

        let out = do_search_ext(
            &conn,
            "photo",
            10,
            None,
            None,
            Some(&[1.0, 0.0, 0.0]),
            "semantic",
        )
        .unwrap();
        let ids: Vec<String> = out.results.iter().map(|r| r.id.clone()).collect();
        assert!(ids.contains(&"fa".to_string()), "older folder missing: {:?}", ids);
        assert!(ids.contains(&"fb".to_string()), "newer folder missing: {:?}", ids);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn semantic_search_drops_vector_hits_below_similarity_cutoff() {
        let dir = std::env::temp_dir().join(format!("sfi-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("idx.db").to_string_lossy().to_string();
        let conn = open_db(&db_path).unwrap();
        init_schema(&conn).unwrap();
        ensure_root_columns(&conn).unwrap();
        let now = now_iso();
        conn.execute(
            "INSERT INTO indexed_roots (id, path, enabled, schedule, last_scan_id, created_at, semantic)
             VALUES ('r1','C:\\docs',1,'daily',0,?,1)",
            params![now],
        )
        .unwrap();
        for (id, vec) in [
            ("strong", [0.95f32, 0.05, 0.0]),
            ("weak", [0.39f32, 0.92, 0.0]),
        ] {
            conn.execute(
                "INSERT INTO indexed_files
                   (id, root_id, path, filename, extension, kind, size, mtime_ms, status, last_seen_scan_id, created_at, vector)
                 VALUES (?,?,?,?,?,?,?,?,'indexed',0,?,?)",
                params![
                    id,
                    "r1",
                    format!("C:\\docs\\{id}.txt"),
                    format!("{id}.txt"),
                    ".txt",
                    "document",
                    10i64,
                    0i64,
                    now,
                    pack_vector(&vec),
                ],
            )
            .unwrap();
        }

        let out = do_search_ext(
            &conn,
            "",
            10,
            None,
            None,
            Some(&[1.0, 0.0, 0.0]),
            "semantic",
        )
        .unwrap();
        let ids: Vec<String> = out.results.iter().map(|r| r.id.clone()).collect();
        assert!(ids.contains(&"strong".to_string()), "strong match missing: {:?}", ids);
        assert!(
            !ids.contains(&"weak".to_string()),
            "weak match should be filtered: {:?}",
            ids
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

struct ArgMap {
    flags: HashMap<String, String>,
    switches: HashSet<String>,
}

fn parse_args(args: &[String]) -> ArgMap {
    let mut flags = HashMap::new();
    let mut switches = HashSet::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if let Some(key) = a.strip_prefix("--") {
            if let Some(next) = args.get(i + 1) {
                if !next.starts_with("--") {
                    flags.insert(key.to_string(), next.clone());
                    i += 2;
                    continue;
                }
            }
            switches.insert(key.to_string());
        }
        i += 1;
    }
    ArgMap { flags, switches }
}

fn print_json<T: Serialize>(value: &T) {
    println!("{}", serde_json::to_string(value).unwrap());
}

fn print_err(msg: &str) -> ! {
    let err = serde_json::json!({ "ok": false, "error": msg });
    eprintln!("{}", err);
    std::process::exit(1);
}

fn main() {
    let mut args: Vec<String> = env::args().skip(1).collect();

    // Back-compat: if the first arg isn't a subcommand, assume legacy `scan` invocation
    // (old CLI: --db ... --root-id ... --root-path ... --workers ...).
    let subcommand = if args.first().map(|s| s.starts_with("--")).unwrap_or(true) {
        "scan".to_string()
    } else {
        args.remove(0)
    };

    let parsed = parse_args(&args);
    let get = |k: &str| parsed.flags.get(k).cloned();
    let db_path = match get("db") {
        Some(v) => v,
        None => print_err("missing --db"),
    };

    let result = match subcommand.as_str() {
        "init" => cmd_init(&db_path).map(|v| serde_json::to_value(v).unwrap()),
        "add-root" => {
            let path = get("path").unwrap_or_else(|| print_err("missing --path"));
            let schedule = get("schedule").unwrap_or_else(|| "daily".to_string());
            let interval = get("interval-hours").and_then(|s| s.parse::<f64>().ok());
            cmd_add_root(&db_path, &path, &schedule, interval)
                .map(|v| serde_json::to_value(v).unwrap())
        }
        "remove-root" => {
            let id = get("root-id").unwrap_or_else(|| print_err("missing --root-id"));
            cmd_remove_root(&db_path, &id).map(|v| serde_json::to_value(v).unwrap())
        }
        "list-roots" => cmd_list_roots(&db_path).map(|v| serde_json::to_value(v).unwrap()),
        "update-root" => {
            let id = get("root-id").unwrap_or_else(|| print_err("missing --root-id"));
            let enabled = get("enabled").map(|s| s == "1" || s.eq_ignore_ascii_case("true"));
            let schedule = get("schedule");
            let interval = get("interval-hours").and_then(|s| s.parse::<f64>().ok());
            let exclude = get("exclude-globs");
            let semantic = get("semantic").map(|s| s == "1" || s.eq_ignore_ascii_case("true"));
            cmd_update_root(
                &db_path,
                &id,
                enabled,
                schedule.as_deref(),
                interval,
                exclude.as_deref(),
                semantic,
            )
            .map(|v| serde_json::to_value(v).unwrap())
        }
        "scan" => {
            let id = get("root-id").unwrap_or_else(|| print_err("missing --root-id"));
            let root_path = get("root-path").map(PathBuf::from).unwrap_or_default();
            let workers = get("workers")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or_else(|| num_cpus::get().saturating_mul(2).clamp(4, 24))
                .clamp(1, 64);
            cmd_scan(&db_path, &id, root_path, workers).map(|v| serde_json::to_value(v).unwrap())
        }
        "search" => {
            let query = get("query").unwrap_or_default();
            let limit = get("limit")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(50)
                .clamp(1, 500);
            let kind = get("kind");
            let root_id = get("root-id");
            let vector = parse_vector_flag(get("vector"), get("vector-file"));
            let has_vector = vector.as_ref().map(|v| !v.is_empty()).unwrap_or(false);
            let mode = get("mode")
                .unwrap_or_else(|| if has_vector { "hybrid".into() } else { "quick".into() });
            cmd_search_ext(
                &db_path,
                &query,
                limit,
                kind.as_deref(),
                root_id.as_deref(),
                vector.as_deref(),
                &mode,
            )
            .map(|v| serde_json::to_value(v).unwrap())
        }
        "get-pending" => {
            let root_id = get("root-id");
            let limit = get("limit")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(500)
                .clamp(1, 5000);
            cmd_get_pending(&db_path, root_id.as_deref(), limit)
                .map(|v| serde_json::to_value(v).unwrap())
        }
        "update-embedding" => {
            let file_id = get("file-id").unwrap_or_else(|| print_err("missing --file-id"));
            let vector = parse_vector_flag(get("vector"), get("vector-file"))
                .unwrap_or_else(|| print_err("missing --vector or --vector-file"));
            let summary = get("summary");
            let keywords = get("keywords");
            let model = get("embedding-model").unwrap_or_else(|| "gemini-embedding-2-preview".into());
            cmd_update_embedding(
                &db_path,
                &file_id,
                &vector,
                summary.as_deref(),
                keywords.as_deref(),
                &model,
            )
            .map(|v| serde_json::to_value(v).unwrap())
        }
        "mark-error" => {
            let file_id = get("file-id").unwrap_or_else(|| print_err("missing --file-id"));
            let message = get("error-message").unwrap_or_default();
            cmd_mark_error(&db_path, &file_id, &message)
                .map(|v| serde_json::to_value(v).unwrap())
        }
        "clear-embeddings" => {
            let root_id = get("root-id");
            let kinds: Vec<String> = get("kinds")
                .map(|s| s.split(',').map(|k| k.trim().to_string()).filter(|k| !k.is_empty()).collect())
                .unwrap_or_default();
            cmd_clear_embeddings(&db_path, root_id.as_deref(), &kinds)
                .map(|v| serde_json::to_value(v).unwrap())
        }
        "list-folder" => {
            let path = get("path").unwrap_or_else(|| print_err("missing --path"));
            let limit = get("limit")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(200)
                .clamp(1, 2000);
            let recursive = parsed.switches.contains("recursive");
            cmd_list_folder(&db_path, &path, recursive, limit)
                .map(|v| serde_json::to_value(v).unwrap())
        }
        "stats" => cmd_stats(&db_path).map(|v| serde_json::to_value(v).unwrap()),
        "daemon" => {
            // Daemon has its own stdio protocol; never returns a single envelope.
            match cmd_daemon(&db_path) {
                Ok(()) => std::process::exit(0),
                Err(err) => {
                    eprintln!("daemon: {}", err);
                    std::process::exit(1);
                }
            }
        }
        other => {
            print_err(&format!("unknown subcommand: {}", other));
        }
    };

    match result {
        Ok(value) => println!("{}", serde_json::to_string(&value).unwrap()),
        Err(err) => {
            let payload = serde_json::json!({ "ok": false, "error": err.to_string() });
            println!("{}", serde_json::to_string(&payload).unwrap());
            std::process::exit(1);
        }
    }

    // silence unused
    let _ = print_json::<OkOut>;
}
