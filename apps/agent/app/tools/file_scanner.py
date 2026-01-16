"""
File Scanner Tool for Semantic File Search

Scans user-selected folders and populates the file index database.
Uses efficient fingerprinting to detect changes without re-analyzing unchanged files.

Features:
- Async scanning with progress reporting
- Smart ignore patterns (node_modules, .git, etc.)
- Two-phase change detection (stat check + content hash)
- Move detection via content hash matching
- Incremental scanning (only process changed files)
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import time
from typing import Any, Dict, List, Optional, Callable
from concurrent.futures import ThreadPoolExecutor

from ..storage import file_index_db as db

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

MAX_HASH_FILE_SIZE = 50 * 1024 * 1024  # 50MB - don't hash files larger than this
QUICK_HASH_SAMPLE_SIZE = 64 * 1024  # 64KB for quick signature
HASH_CHUNK_SIZE = 8192  # 8KB chunks for hashing


# ═══════════════════════════════════════════════════════════════════════════════
# HASHING UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def compute_quick_hash(path: str) -> Optional[str]:
    """
    Compute a quick hash from file samples (for large files).
    Uses first 64KB + middle 64KB + last 64KB + file size.
    """
    try:
        size = os.path.getsize(path)
        if size == 0:
            return hashlib.sha256(b'').hexdigest()[:16]
        
        hasher = hashlib.sha256()
        hasher.update(str(size).encode())
        
        with open(path, 'rb') as f:
            # First chunk
            hasher.update(f.read(QUICK_HASH_SAMPLE_SIZE))
            
            # Middle chunk (if file is large enough)
            if size > QUICK_HASH_SAMPLE_SIZE * 3:
                f.seek(size // 2)
                hasher.update(f.read(QUICK_HASH_SAMPLE_SIZE))
            
            # Last chunk (if file is large enough)
            if size > QUICK_HASH_SAMPLE_SIZE * 2:
                f.seek(-QUICK_HASH_SAMPLE_SIZE, 2)
                hasher.update(f.read(QUICK_HASH_SAMPLE_SIZE))
        
        return hasher.hexdigest()[:32]  # Truncate for storage efficiency
    except (IOError, OSError):
        return None


def compute_full_hash(path: str) -> Optional[str]:
    """Compute full SHA-256 hash of file contents."""
    try:
        hasher = hashlib.sha256()
        with open(path, 'rb') as f:
            while chunk := f.read(HASH_CHUNK_SIZE):
                hasher.update(chunk)
        return hasher.hexdigest()[:32]
    except (IOError, OSError):
        return None


def compute_normalized_text_hash(path: str, max_size: int = 1024 * 1024) -> Optional[str]:
    """
    Compute hash of normalized text content (for code/text files).
    Normalizes: CRLF→LF, trim trailing whitespace, collapse blank lines.
    """
    try:
        size = os.path.getsize(path)
        if size > max_size:
            return compute_quick_hash(path)  # Fall back to quick hash for large files
        
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        
        # Normalize
        lines = content.replace('\r\n', '\n').replace('\r', '\n').split('\n')
        normalized_lines = [line.rstrip() for line in lines]
        
        # Collapse multiple blank lines into one
        result_lines = []
        prev_blank = False
        for line in normalized_lines:
            is_blank = len(line) == 0
            if is_blank and prev_blank:
                continue
            result_lines.append(line)
            prev_blank = is_blank
        
        normalized = '\n'.join(result_lines)
        return hashlib.sha256(normalized.encode('utf-8')).hexdigest()[:32]
    except (IOError, OSError, UnicodeDecodeError):
        return compute_quick_hash(path)


def compute_content_hash(path: str, extension: str) -> Optional[str]:
    """
    Compute appropriate content hash based on file type.
    """
    try:
        size = os.path.getsize(path)
        
        # Skip very large files
        if size > MAX_HASH_FILE_SIZE:
            return compute_quick_hash(path)
        
        # Text/code files get normalized hash
        text_extensions = {'.txt', '.md', '.py', '.js', '.ts', '.tsx', '.jsx', '.json',
                          '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss',
                          '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs',
                          '.rb', '.php', '.swift', '.kt', '.sql', '.sh', '.bat', '.ps1'}
        
        if extension.lower() in text_extensions:
            return compute_normalized_text_hash(path)
        
        # Binary files get full hash (if small enough) or quick hash
        if size <= 5 * 1024 * 1024:  # 5MB
            return compute_full_hash(path)
        else:
            return compute_quick_hash(path)
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# SCANNER
# ═══════════════════════════════════════════════════════════════════════════════

class ScanProgress:
    """Track scan progress."""
    def __init__(self):
        self.total_dirs = 0
        self.scanned_dirs = 0
        self.total_files = 0
        self.new_files = 0
        self.changed_files = 0
        self.unchanged_files = 0
        self.skipped_files = 0
        self.deleted_files = 0
        self.moved_files = 0
        self.errors: List[str] = []
        self.start_time = time.time()
    
    def to_dict(self) -> Dict[str, Any]:
        elapsed = time.time() - self.start_time
        return {
            "total_dirs": self.total_dirs,
            "scanned_dirs": self.scanned_dirs,
            "total_files": self.total_files,
            "new_files": self.new_files,
            "changed_files": self.changed_files,
            "unchanged_files": self.unchanged_files,
            "skipped_files": self.skipped_files,
            "deleted_files": self.deleted_files,
            "moved_files": self.moved_files,
            "errors": len(self.errors),
            "elapsed_seconds": round(elapsed, 2),
            "files_per_second": round(self.total_files / elapsed, 1) if elapsed > 0 else 0,
        }


async def scan_root(
    root_id: str,
    progress_callback: Optional[Callable[[ScanProgress], None]] = None,
    compute_hashes: bool = True,
    max_files: Optional[int] = None,
) -> ScanProgress:
    """
    Scan a root folder and update the file index.
    
    Args:
        root_id: ID of the indexed root to scan
        progress_callback: Optional callback for progress updates
        compute_hashes: Whether to compute content hashes (slower but more accurate)
        max_files: Maximum files to process (for incremental/time-boxed scans)
    
    Returns:
        ScanProgress with statistics
    """
    root = db.get_root(root_id)
    if not root:
        raise ValueError(f"Root not found: {root_id}")
    
    if not os.path.isdir(root.path):
        raise ValueError(f"Root path not accessible: {root.path}")
    
    progress = ScanProgress()
    scan_id = db.increment_scan_id(root_id)
    
    # Get deleted files for move detection
    deleted_files = {f.content_hash: f for f in db.get_deleted_files_with_hash(root_id) if f.content_hash}
    
    # Get existing file metadata for fast change detection
    existing_files_map = db.get_root_file_metadata(root_id)

    # Use thread pool for I/O operations
    # "Nice" mode: Use half of available cores (min 2) to avoid slowing down user PC
    cpu_count = os.cpu_count() or 4
    max_workers = max(2, cpu_count // 2)
    
    executor = ThreadPoolExecutor(max_workers=max_workers)
    loop = asyncio.get_event_loop()
    
    files_processed = 0
    
    def scan_directory(dir_path: str) -> List[str]:
        """Scan a directory and return list of file paths."""
        files = []
        try:
            with os.scandir(dir_path) as entries:
                for entry in entries:
                    try:
                        # Skip ignored patterns
                        if entry.name in db.IGNORE_PATTERNS:
                            continue
                        
                        if entry.is_dir(follow_symlinks=False):
                            # Recurse into subdirectories
                            if not db.should_skip_path(entry.path):
                                # Add the directory itself to the index
                                try:
                                    stat = entry.stat()
                                    db.upsert_file(
                                        root_id, 
                                        entry.path, 
                                        0, # size 0 for folders
                                        int(stat.st_mtime * 1000), 
                                        scan_id, 
                                        None, # no content hash for folders
                                        kind_override='folder'
                                    )
                                    progress.total_files += 1 # Count folders as files for progress
                                except Exception:
                                    pass # Ignore errors indexing the folder itself

                                files.extend(scan_directory(entry.path))
                                progress.total_dirs += 1
                        elif entry.is_file(follow_symlinks=False):
                            files.append(entry.path)
                    except (PermissionError, OSError) as e:
                        progress.errors.append(f"Access error: {entry.path}: {e}")
        except (PermissionError, OSError) as e:
            progress.errors.append(f"Dir error: {dir_path}: {e}")
        
        progress.scanned_dirs += 1
        return files
    
    # First pass: enumerate all files
    all_files = await loop.run_in_executor(executor, scan_directory, root.path)
    progress.total_files = len(all_files)
    
    if progress_callback:
        progress_callback(progress)
    
    # Second pass: process each file
    batch_data = []
    BATCH_SIZE = 100

    def flush_batch():
        nonlocal files_processed
        if not batch_data:
            return
        
        try:
            new, changed, unchanged = db.upsert_files_batch(batch_data)
            progress.new_files += new
            progress.changed_files += changed
            progress.unchanged_files += unchanged
            
            files_processed += len(batch_data)
            batch_data.clear()
            
            if progress_callback:
                progress_callback(progress)
        except Exception as e:
            # Fallback for errors
            progress.errors.append(f"Batch error: {e}")
            batch_data.clear()

    for file_path in all_files:
        if max_files and files_processed >= max_files:
            break
        
        try:
            # Get file stats
            stat = os.stat(file_path)
            size = stat.st_size
            mtime_ms = int(stat.st_mtime * 1000)
            
            # Get extension
            _, ext = os.path.splitext(file_path)
            ext = ext.lower()
            
            # Skip metadata-only files from content analysis
            content_hash = None
            
            # Check if file is unchanged to skip hashing
            is_unchanged = False
            if file_path in existing_files_map:
                old_size, old_mtime, old_hash = existing_files_map[file_path]
                if size == old_size and mtime_ms == old_mtime:
                    is_unchanged = True
                    content_hash = old_hash
            
            if not is_unchanged and compute_hashes and ext not in db.METADATA_ONLY_EXTENSIONS:
                content_hash = await loop.run_in_executor(
                    executor, compute_content_hash, file_path, ext
                )
            
            # Check for move detection
            # If moved, process immediately (cannot batch efficiently with transfer logic)
            if not is_unchanged and content_hash and content_hash in deleted_files:
                # Flush current batch first to maintain order consistency
                flush_batch()

                # This file matches a deleted file - it's a move!
                old_file = deleted_files[content_hash]
                
                # Must upsert FIRST to create the record, otherwise transfer fails
                db.upsert_file(root_id, file_path, size, mtime_ms, scan_id, content_hash)
                
                if db.transfer_file_metadata(old_file.id, file_path):
                    progress.moved_files += 1
                    del deleted_files[content_hash]  # Don't match again
                    files_processed += 1
                    continue
            
            # Add to batch
            batch_data.append({
                'root_id': root_id,
                'path': file_path,
                'size': size,
                'mtime_ms': mtime_ms,
                'scan_id': scan_id,
                'content_hash': content_hash,
                # kind_override is None, calculated in DB
            })

            # Flush if batch full
            if len(batch_data) >= BATCH_SIZE:
                flush_batch()
                
        except (PermissionError, OSError) as e:
            progress.errors.append(f"File error: {file_path}: {e}")
            progress.skipped_files += 1
    
    # Flush remaining
    flush_batch()
    
    # Mark files not seen in this scan as deleted
    progress.deleted_files = db.mark_deleted_files(root_id, scan_id)
    
    executor.shutdown(wait=False)
    
    if progress_callback:
        progress_callback(progress)
    
    return progress


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def add_index_root(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add a folder to the index."""
    path = str(args.get("path") or "").strip()
    if not path:
        raise ValueError("missing path")
    
    path = os.path.expanduser(path)
    path = os.path.normpath(os.path.abspath(path))
    
    if not os.path.isdir(path):
        return {"ok": False, "error": f"Not a directory: {path}"}
    
    # Check if already exists
    existing = db.get_root_by_path(path)
    if existing:
        # Update schedule if provided and different
        schedule = args.get("schedule")
        interval_hours = args.get("interval_hours")
        
        updated = False
        if schedule and schedule != existing.schedule:
            existing = db.update_root(existing.id, schedule=schedule)
            updated = True
            
        if interval_hours is not None and interval_hours != existing.interval_hours:
            existing = db.update_root(existing.id, interval_hours=interval_hours)
            updated = True
            
        return {
            "ok": True, 
            "root": existing.to_dict(), 
            "message": "Root updated" if updated else "Root already indexed"
        }
    
    schedule = args.get("schedule", "daily")
    interval_hours = args.get("interval_hours")
    
    root = db.add_root(path, schedule=schedule, interval_hours=interval_hours)
    return {"ok": True, "root": root.to_dict()}


async def remove_index_root(args: Dict[str, Any]) -> Dict[str, Any]:
    """Remove a folder from the index."""
    root_id = args.get("root_id") or args.get("id")
    path = args.get("path")
    
    if path:
        root = db.get_root_by_path(path)
        if root:
            root_id = root.id
    
    if not root_id:
        raise ValueError("missing root_id or path")
    
    deleted = db.delete_root(root_id)
    return {"ok": deleted}


async def list_index_roots(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all indexed roots."""
    enabled_only = bool(args.get("enabled_only", False))
    roots = db.list_roots(enabled_only=enabled_only)
    return {"ok": True, "roots": [r.to_dict() for r in roots]}


async def scan_index_root(args: Dict[str, Any]) -> Dict[str, Any]:
    """Scan an indexed root folder."""
    root_id = args.get("root_id") or args.get("id")
    path = args.get("path")
    
    if path:
        root = db.get_root_by_path(path)
        if not root:
            return {"ok": False, "error": f"Root not found for path: {path}"}
        root_id = root.id
    
    if not root_id:
        raise ValueError("missing root_id or path")
    
    compute_hashes = args.get("compute_hashes", True)
    max_files = args.get("max_files")
    
    progress = await scan_root(
        root_id,
        compute_hashes=compute_hashes,
        max_files=max_files
    )
    
    return {"ok": True, "progress": progress.to_dict()}


async def get_pending_files(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get files pending indexing."""
    limit = int(args.get("limit", 100))
    files = db.get_pending_files(limit=limit)
    return {
        "ok": True,
        "files": [f.to_dict() for f in files],
        "count": len(files)
    }


async def get_index_stats(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get file index statistics."""
    stats = db.get_stats()
    return {"ok": True, **stats}


async def update_file_index_data(args: Dict[str, Any]) -> Dict[str, Any]:
    """Update a file with summary, keywords, and vector embedding."""
    file_id = args.get("file_id") or args.get("id")
    if not file_id:
        raise ValueError("missing file_id")
    
    summary = args.get("summary", "")
    keywords = args.get("keywords", "")
    vector = args.get("vector")
    summary_model = args.get("summary_model", "gemini-3-flash")
    embedding_model = args.get("embedding_model", "text-embedding-3-large")
    
    if not vector:
        raise ValueError("missing vector")
    
    success = db.update_file_index(
        file_id, summary, keywords, vector, summary_model, embedding_model
    )
    
    return {"ok": success}


async def mark_file_error(args: Dict[str, Any]) -> Dict[str, Any]:
    """Mark a file as errored."""
    file_id = args.get("file_id") or args.get("id")
    error_message = args.get("error_message", "Unknown error")
    
    if not file_id:
        raise ValueError("missing file_id")
    
    success = db.update_file_error(file_id, error_message)
    return {"ok": success}


async def purge_deleted(args: Dict[str, Any]) -> Dict[str, Any]:
    """Purge deleted file records."""
    root_id = args.get("root_id")
    count = db.purge_deleted_files(root_id)
    return {"ok": True, "purged": count}
