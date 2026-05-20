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
    interval_hours: Option<i64>,
    last_scan_at: Option<String>,
    next_scan_at: Option<String>,
    last_scan_id: i64,
    backend: String,
    watch_state: String,
    volume_serial: Option<String>,
    last_reconcile_at: Option<String>,
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
    conn.pragma_update(None, "cache_size", &-64_000i64)?; // ~64MB page cache
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
        interval_hours: row.get("interval_hours")?,
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
    interval_hours: Option<i64>,
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

    let mut stmt = conn.prepare("SELECT * FROM indexed_roots ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], row_to_root)?;
    let mut roots = Vec::new();
    for r in rows {
        roots.push(r?);
    }
    Ok(ListRootsOut { ok: true, roots })
}

fn cmd_update_root(
    db_path: &str,
    root_id: &str,
    enabled: Option<bool>,
    schedule: Option<&str>,
    interval_hours: Option<i64>,
) -> Result<OkOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    init_schema(&conn)?;
    let mut sets: Vec<&'static str> = Vec::new();
    let mut vals: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(e) = enabled {
        sets.push("enabled = ?");
        vals.push(Box::new(if e { 1i64 } else { 0i64 }));
    }
    if let Some(s) = schedule {
        sets.push("schedule = ?");
        vals.push(Box::new(s.to_string()));
    }
    if let Some(h) = interval_hours {
        sets.push("interval_hours = ?");
        vals.push(Box::new(h));
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

    let target_path = if ext_lower == ".lnk" {
        resolve_lnk_target(&path)
    } else {
        None
    };

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

fn build_fts_match(tokens: &[String]) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for tok in tokens {
        let clean = sanitize_fts_token(tok);
        if clean.is_empty() {
            continue;
        }
        // Prefix match so typing "random_cha" finds "random_chaos"
        parts.push(format!("\"{}\"*", clean));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" AND "))
    }
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

fn cmd_search(
    db_path: &str,
    query: &str,
    limit: usize,
    kind: Option<&str>,
    root_id: Option<&str>,
) -> Result<SearchOut, Box<dyn std::error::Error>> {
    let conn = open_db(db_path)?;
    ensure_read_schema(&conn)?;

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
    let fetch_limit = (limit * 10).max(120).min(2000);

    let mut collected: Vec<FileResult> = Vec::new();

    // 1) Fast path: FTS5 MATCH with prefix tokens. O(log N) instead of O(N).
    if let Some(match_expr) = build_fts_match(&tokens) {
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
        if let Some(rid) = root_id {
            sql.push_str(" AND f.root_id = ?");
            params_vec.push(rid.to_string());
        }
        sql.push_str(&format!(" ORDER BY bm25(files_fts) LIMIT {}", fetch_limit));

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

    // 2) Fallback LIKE search when FTS returns nothing (single-char tokens etc.).
    if collected.is_empty() && !tokens.is_empty() {
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
        if let Some(rid) = root_id {
            where_parts.push("root_id = ?".to_string());
            params_vec.push(rid.to_string());
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
// Daemon mode — persistent process, reads JSON requests from stdin.
//
// Protocol: one JSON request per line on stdin, one JSON response per line
// on stdout. Electron can keep one child running and reuse it for every
// search, avoiding the ~800ms Windows cold-spawn penalty.
//
// Request:  { "id": "<any>", "cmd": "search", "args": { "query": "…", "limit": 12 } }
// Response: { "id": "<same>", "ok": true, "results": […] }  OR  { "id": …, "ok": false, "error": "…" }
// ─────────────────────────────────────────────────────────

fn cmd_daemon(db_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{BufRead, BufReader, Write};

    // Make sure the schema exists before the first request so queries are fast.
    {
        let conn = open_db(db_path)?;
        ensure_read_schema(&conn)?;
    }

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut out = stdout.lock();

    // Ready signal so callers know the process is warm.
    writeln!(out, "{}", serde_json::json!({ "ok": true, "ready": true }))?;
    out.flush()?;

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
            Err(err) => {
                writeln!(
                    out,
                    "{}",
                    serde_json::json!({ "ok": false, "error": format!("bad_json: {}", err) })
                )?;
                out.flush()?;
                continue;
            }
        };

        let id = req.get("id").cloned().unwrap_or(serde_json::Value::Null);
        let cmd = req.get("cmd").and_then(|v| v.as_str()).unwrap_or("");
        let args = req.get("args").cloned().unwrap_or(serde_json::json!({}));

        let response = dispatch_daemon_cmd(db_path, cmd, &args);

        let envelope = match response {
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
        };

        writeln!(out, "{}", serde_json::to_string(&envelope).unwrap())?;
        out.flush()?;
    }

    Ok(())
}

fn dispatch_daemon_cmd(
    db_path: &str,
    cmd: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let as_str = |key: &str| {
        args.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    let as_i64 = |key: &str| args.get(key).and_then(|v| v.as_i64());

    match cmd {
        "search" => {
            let query = as_str("query").unwrap_or_default();
            let limit = as_i64("limit").unwrap_or(50) as usize;
            let kind = as_str("kind");
            let root_id = as_str("root_id").or_else(|| as_str("root-id"));
            let out = cmd_search(
                db_path,
                &query,
                limit.clamp(1, 500),
                kind.as_deref(),
                root_id.as_deref(),
            )?;
            Ok(serde_json::to_value(out)?)
        }
        "stats" => Ok(serde_json::to_value(cmd_stats(db_path)?)?),
        "list-roots" | "list_roots" => Ok(serde_json::to_value(cmd_list_roots(db_path)?)?),
        "list-folder" | "list_folder" => {
            let folder = as_str("path").unwrap_or_default();
            let limit = as_i64("limit").unwrap_or(200) as usize;
            let recursive = args
                .get("recursive")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Ok(serde_json::to_value(cmd_list_folder(
                db_path,
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
            let interval = get("interval-hours").and_then(|s| s.parse::<i64>().ok());
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
            let interval = get("interval-hours").and_then(|s| s.parse::<i64>().ok());
            cmd_update_root(&db_path, &id, enabled, schedule.as_deref(), interval)
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
            let query = get("query").unwrap_or_else(|| print_err("missing --query"));
            let limit = get("limit")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(50)
                .clamp(1, 500);
            let kind = get("kind");
            let root_id = get("root-id");
            cmd_search(&db_path, &query, limit, kind.as_deref(), root_id.as_deref())
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
