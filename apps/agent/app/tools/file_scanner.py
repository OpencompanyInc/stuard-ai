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
import atexit
import ctypes
import hashlib
import os
import sys
import threading
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
WATCHER_DEBOUNCE_SECONDS = 1.0
WATCHER_BUFFER_SIZE = 64 * 1024


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


# =============================================================================
# WINDOWS FAST PATH
# =============================================================================

WINDOWS_FAST_PATH_AVAILABLE = False

if sys.platform == "win32":
    from ctypes import wintypes

    WINDOWS_FAST_PATH_AVAILABLE = True

    INVALID_HANDLE_VALUE = wintypes.HANDLE(-1).value
    ERROR_NO_MORE_FILES = 18

    FILE_ATTRIBUTE_DIRECTORY = 0x00000010
    FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400

    FILE_LIST_DIRECTORY = 0x0001
    FILE_SHARE_READ = 0x00000001
    FILE_SHARE_WRITE = 0x00000002
    FILE_SHARE_DELETE = 0x00000004
    OPEN_EXISTING = 3
    FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
    FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000

    FindExInfoBasic = 1
    FindExSearchNameMatch = 0
    FIND_FIRST_EX_LARGE_FETCH = 0x00000002
    FileIdInfo = 18

    FILE_NOTIFY_CHANGE_FILE_NAME = 0x00000001
    FILE_NOTIFY_CHANGE_DIR_NAME = 0x00000002
    FILE_NOTIFY_CHANGE_ATTRIBUTES = 0x00000004
    FILE_NOTIFY_CHANGE_SIZE = 0x00000008
    FILE_NOTIFY_CHANGE_LAST_WRITE = 0x00000010
    FILE_NOTIFY_CHANGE_CREATION = 0x00000040

    FILE_ACTION_ADDED = 0x00000001
    FILE_ACTION_REMOVED = 0x00000002
    FILE_ACTION_MODIFIED = 0x00000003
    FILE_ACTION_RENAMED_OLD_NAME = 0x00000004
    FILE_ACTION_RENAMED_NEW_NAME = 0x00000005

    class FILE_ID_128(ctypes.Structure):
        _fields_ = [("Identifier", ctypes.c_byte * 16)]


    class FILE_ID_INFO(ctypes.Structure):
        _fields_ = [
            ("VolumeSerialNumber", ctypes.c_ulonglong),
            ("FileId", FILE_ID_128),
        ]


    class WIN32_FIND_DATAW(ctypes.Structure):
        _fields_ = [
            ("dwFileAttributes", wintypes.DWORD),
            ("ftCreationTime", wintypes.FILETIME),
            ("ftLastAccessTime", wintypes.FILETIME),
            ("ftLastWriteTime", wintypes.FILETIME),
            ("nFileSizeHigh", wintypes.DWORD),
            ("nFileSizeLow", wintypes.DWORD),
            ("dwReserved0", wintypes.DWORD),
            ("dwReserved1", wintypes.DWORD),
            ("cFileName", wintypes.WCHAR * 260),
            ("cAlternateFileName", wintypes.WCHAR * 14),
            ("dwFileType", wintypes.DWORD),
            ("dwCreatorType", wintypes.DWORD),
            ("wFinderFlags", wintypes.WORD),
        ]


    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    _FindFirstFileExW = _kernel32.FindFirstFileExW
    _FindFirstFileExW.argtypes = [
        wintypes.LPCWSTR,
        ctypes.c_int,
        ctypes.POINTER(WIN32_FIND_DATAW),
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    _FindFirstFileExW.restype = wintypes.HANDLE

    _FindNextFileW = _kernel32.FindNextFileW
    _FindNextFileW.argtypes = [wintypes.HANDLE, ctypes.POINTER(WIN32_FIND_DATAW)]
    _FindNextFileW.restype = wintypes.BOOL

    _FindClose = _kernel32.FindClose
    _FindClose.argtypes = [wintypes.HANDLE]
    _FindClose.restype = wintypes.BOOL

    _CreateFileW = _kernel32.CreateFileW
    _CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    _CreateFileW.restype = wintypes.HANDLE

    _CloseHandle = _kernel32.CloseHandle
    _CloseHandle.argtypes = [wintypes.HANDLE]
    _CloseHandle.restype = wintypes.BOOL

    _GetFileInformationByHandleEx = _kernel32.GetFileInformationByHandleEx
    _GetFileInformationByHandleEx.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    _GetFileInformationByHandleEx.restype = wintypes.BOOL

    _ReadDirectoryChangesW = _kernel32.ReadDirectoryChangesW
    _ReadDirectoryChangesW.argtypes = [
        wintypes.HANDLE,
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.BOOL,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    _ReadDirectoryChangesW.restype = wintypes.BOOL

    def _filetime_to_unix_ms(filetime: wintypes.FILETIME) -> int:
        ticks = (int(filetime.dwHighDateTime) << 32) | int(filetime.dwLowDateTime)
        if ticks <= 0:
            return 0
        return max(0, int((ticks - 116444736000000000) / 10000))


    def _handle_valid(handle: wintypes.HANDLE) -> bool:
        return bool(handle) and int(handle) != int(INVALID_HANDLE_VALUE)


    def _open_identity_handle(path: str, is_dir: bool) -> Optional[wintypes.HANDLE]:
        flags = FILE_FLAG_OPEN_REPARSE_POINT
        if is_dir:
            flags |= FILE_FLAG_BACKUP_SEMANTICS
        handle = _CreateFileW(
            path,
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            flags,
            None,
        )
        return handle if _handle_valid(handle) else None


    def _get_windows_identity(path: str, is_dir: bool) -> Tuple[Optional[str], Optional[str]]:
        handle = _open_identity_handle(path, is_dir=is_dir)
        if handle is None:
            return None, None
        try:
            info = FILE_ID_INFO()
            ok = _GetFileInformationByHandleEx(
                handle,
                FileIdInfo,
                ctypes.byref(info),
                ctypes.sizeof(info),
            )
            if not ok:
                return None, None
            volume_serial = f"{int(info.VolumeSerialNumber):016x}"
            file_id = bytes(bytearray(info.FileId.Identifier)).hex()
            return volume_serial, file_id
        finally:
            _CloseHandle(handle)


    def _iter_windows_dir(dir_path: str) -> List[WIN32_FIND_DATAW]:
        search_path = os.path.join(dir_path, "*")
        find_data = WIN32_FIND_DATAW()
        handle = _FindFirstFileExW(
            search_path,
            FindExInfoBasic,
            ctypes.byref(find_data),
            FindExSearchNameMatch,
            None,
            FIND_FIRST_EX_LARGE_FETCH,
        )
        if not _handle_valid(handle):
            return []

        entries: List[WIN32_FIND_DATAW] = []
        try:
            while True:
                name = find_data.cFileName
                if name not in (".", ".."):
                    copy = WIN32_FIND_DATAW()
                    ctypes.pointer(copy)[0] = find_data
                    entries.append(copy)
                if not _FindNextFileW(handle, ctypes.byref(find_data)):
                    if ctypes.get_last_error() == ERROR_NO_MORE_FILES:
                        break
                    break
        finally:
            _FindClose(handle)
        return entries


    def _parse_directory_notifications(raw: bytes) -> List[Tuple[int, str]]:
        events: List[Tuple[int, str]] = []
        offset = 0
        raw_len = len(raw)
        while offset + 12 <= raw_len:
            next_offset = int.from_bytes(raw[offset:offset + 4], "little")
            action = int.from_bytes(raw[offset + 4:offset + 8], "little")
            name_len = int.from_bytes(raw[offset + 8:offset + 12], "little")
            name_bytes = raw[offset + 12:offset + 12 + name_len]
            try:
                name = name_bytes.decode("utf-16-le", errors="ignore")
            except Exception:
                name = ""
            if name:
                events.append((action, name))
            if next_offset == 0:
                break
            offset += next_offset
        return events


    def _open_watch_handle(path: str) -> Optional[wintypes.HANDLE]:
        handle = _CreateFileW(
            path,
            FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
        return handle if _handle_valid(handle) else None


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


def _existing_file_is_unchanged(
    existing_meta: Optional[Dict[str, Any]],
    size: int,
    mtime_ms: int,
    volume_serial: Optional[str] = None,
    file_id: Optional[str] = None,
) -> bool:
    if not existing_meta:
        return False
    if existing_meta.get("size") != size or existing_meta.get("mtime_ms") != mtime_ms:
        return False
    existing_volume = existing_meta.get("volume_serial")
    existing_file_id = existing_meta.get("file_id")
    if volume_serial and existing_volume and volume_serial != existing_volume:
        return False
    if file_id and existing_file_id and file_id != existing_file_id:
        return False
    return True


def _flush_batch(
    batch_data: List[Dict[str, Any]],
    progress: ScanProgress,
    progress_callback: Optional[Callable[[ScanProgress], None]] = None,
) -> None:
    if not batch_data:
        return
    try:
        new_count, changed_count, unchanged_count = db.upsert_files_batch(batch_data)
        progress.new_files += new_count
        progress.changed_files += changed_count
        progress.unchanged_files += unchanged_count
        batch_data.clear()
        if progress_callback:
            progress_callback(progress)
    except Exception as exc:
        progress.errors.append(f"Batch error: {exc}")
        batch_data.clear()


async def _scan_root_generic(
    root_id: str,
    progress_callback: Optional[Callable[[ScanProgress], None]] = None,
    compute_hashes: bool = True,
    max_files: Optional[int] = None,
) -> ScanProgress:
    root = db.get_root(root_id)
    if not root:
        raise ValueError(f"Root not found: {root_id}")
    if not os.path.isdir(root.path):
        raise ValueError(f"Root path not accessible: {root.path}")

    progress = ScanProgress()
    scan_id = db.increment_scan_id(root_id, backend="generic", last_reconcile_at=db._now_iso())
    deleted_files = {f.content_hash: f for f in db.get_deleted_files_with_hash(root_id) if f.content_hash}
    existing_files_map = db.get_root_file_metadata(root_id)

    cpu_count = os.cpu_count() or 4
    max_workers = max(2, cpu_count // 2)
    executor = ThreadPoolExecutor(max_workers=max_workers)
    loop = asyncio.get_event_loop()

    files_processed = 0

    def scan_directory(dir_path: str) -> List[str]:
        files: List[str] = []
        try:
            with os.scandir(dir_path) as entries:
                for entry in entries:
                    try:
                        if entry.name in db.IGNORE_PATTERNS and db.should_skip_path(entry.path):
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            if not db.should_skip_path(entry.path):
                                try:
                                    stat = entry.stat()
                                    db.upsert_file(
                                        root_id,
                                        entry.path,
                                        0,
                                        int(stat.st_mtime * 1000),
                                        scan_id,
                                        None,
                                        kind_override="folder",
                                    )
                                    progress.total_files += 1
                                except Exception:
                                    pass
                                files.extend(scan_directory(entry.path))
                                progress.total_dirs += 1
                        elif entry.is_file(follow_symlinks=False):
                            files.append(entry.path)
                    except (PermissionError, OSError) as exc:
                        progress.errors.append(f"Access error: {entry.path}: {exc}")
        except (PermissionError, OSError) as exc:
            progress.errors.append(f"Dir error: {dir_path}: {exc}")
        progress.scanned_dirs += 1
        return files

    all_files = await loop.run_in_executor(executor, scan_directory, root.path)
    progress.total_files = len(all_files)
    if progress_callback:
        progress_callback(progress)

    batch_data: List[Dict[str, Any]] = []
    batch_size = 100

    for file_path in all_files:
        if max_files and files_processed >= max_files:
            break
        try:
            stat = os.stat(file_path)
            size = stat.st_size
            mtime_ms = int(stat.st_mtime * 1000)
            _, ext = os.path.splitext(file_path)
            ext = ext.lower()

            content_hash = None
            existing_meta = existing_files_map.get(file_path)
            is_unchanged = _existing_file_is_unchanged(existing_meta, size, mtime_ms)
            if is_unchanged and existing_meta:
                content_hash = existing_meta.get("content_hash")
            elif compute_hashes and ext not in db.METADATA_ONLY_EXTENSIONS:
                content_hash = await loop.run_in_executor(executor, compute_content_hash, file_path, ext)

            if not is_unchanged and content_hash and content_hash in deleted_files:
                _flush_batch(batch_data, progress, progress_callback)
                old_file = deleted_files[content_hash]
                db.upsert_file(root_id, file_path, size, mtime_ms, scan_id, content_hash)
                if db.transfer_file_metadata(old_file.id, file_path):
                    progress.moved_files += 1
                    del deleted_files[content_hash]
                    files_processed += 1
                    continue

            batch_data.append({
                "root_id": root_id,
                "path": file_path,
                "size": size,
                "mtime_ms": mtime_ms,
                "scan_id": scan_id,
                "content_hash": content_hash,
            })
            files_processed += 1
            if len(batch_data) >= batch_size:
                _flush_batch(batch_data, progress, progress_callback)
        except (PermissionError, OSError) as exc:
            progress.errors.append(f"File error: {file_path}: {exc}")
            progress.skipped_files += 1

    _flush_batch(batch_data, progress, progress_callback)
    progress.deleted_files = db.mark_deleted_files(root_id, scan_id)
    executor.shutdown(wait=False)
    if progress_callback:
        progress_callback(progress)
    db.update_root(root_id, watch_state="inactive")
    return progress


def _enumerate_windows_tree(
    root_path: str,
    progress: ScanProgress,
) -> Tuple[List[Dict[str, Any]], Optional[str], Optional[str]]:
    if not WINDOWS_FAST_PATH_AVAILABLE:
        raise RuntimeError("Windows fast path unavailable")

    root_volume_serial, root_file_id = _get_windows_identity(root_path, is_dir=True)
    if not root_file_id:
        raise RuntimeError(f"Failed to get file identity for {root_path}")

    entries: List[Dict[str, Any]] = []
    stack: List[Tuple[str, Optional[str], Optional[str]]] = [(root_path, root_file_id, root_volume_serial)]

    while stack:
        dir_path, parent_file_id, parent_volume_serial = stack.pop()
        progress.scanned_dirs += 1
        try:
            for find_data in _iter_windows_dir(dir_path):
                name = find_data.cFileName
                full_path = os.path.join(dir_path, name)
                attrs = int(find_data.dwFileAttributes)
                is_dir = bool(attrs & FILE_ATTRIBUTE_DIRECTORY)
                is_reparse = bool(attrs & FILE_ATTRIBUTE_REPARSE_POINT)

                if name in db.IGNORE_PATTERNS and db.should_skip_path(full_path):
                    continue
                if is_reparse:
                    progress.skipped_files += 1
                    continue
                if is_dir and db.should_skip_path(full_path):
                    continue

                mtime_ms = _filetime_to_unix_ms(find_data.ftLastWriteTime)
                size = 0 if is_dir else ((int(find_data.nFileSizeHigh) << 32) | int(find_data.nFileSizeLow))

                # Only open a CreateFileW handle for directories (needed for parent_file_id
                # tracking on the recursion stack). Files use size+mtime for change detection
                # and content hash for move detection — skipping the per-file handle open
                # eliminates the dominant Windows-scan I/O cost (3-5x speedup on large trees).
                if is_dir:
                    volume_serial, file_id = _get_windows_identity(full_path, is_dir=True)
                    if not file_id:
                        progress.skipped_files += 1
                        continue
                    effective_volume = volume_serial or parent_volume_serial
                    stack.append((full_path, file_id, effective_volume))
                    progress.total_dirs += 1
                else:
                    file_id = None
                    effective_volume = parent_volume_serial

                entries.append({
                    "path": full_path,
                    "size": 0 if is_dir else size,
                    "mtime_ms": mtime_ms,
                    "volume_serial": effective_volume,
                    "file_id": file_id,
                    "parent_file_id": parent_file_id,
                    "win_attrs": attrs,
                    "kind_override": "folder" if is_dir else None,
                    "is_dir": is_dir,
                })
                progress.total_files += 1
        except Exception as exc:
            progress.errors.append(f"Dir error: {dir_path}: {exc}")

    return entries, root_volume_serial, root_file_id


async def _scan_root_windows(
    root_id: str,
    progress_callback: Optional[Callable[[ScanProgress], None]] = None,
    compute_hashes: bool = True,
    max_files: Optional[int] = None,
) -> ScanProgress:
    root = db.get_root(root_id)
    if not root:
        raise ValueError(f"Root not found: {root_id}")
    if not os.path.isdir(root.path):
        raise ValueError(f"Root path not accessible: {root.path}")

    progress = ScanProgress()
    loop = asyncio.get_event_loop()
    entries, root_volume_serial, _ = await loop.run_in_executor(None, _enumerate_windows_tree, root.path, progress)
    scan_id = db.increment_scan_id(
        root_id,
        backend="win32",
        volume_serial=root_volume_serial,
        last_reconcile_at=db._now_iso(),
    )

    deleted_files = {f.content_hash: f for f in db.get_deleted_files_with_hash(root_id) if f.content_hash}
    existing_files_map = db.get_root_file_metadata(root_id)

    cpu_count = os.cpu_count() or 4
    max_workers = max(2, cpu_count // 2)
    executor = ThreadPoolExecutor(max_workers=max_workers)

    if progress_callback:
        progress_callback(progress)

    batch_data: List[Dict[str, Any]] = []
    batch_size = 100
    processed = 0

    for entry in entries:
        if max_files and processed >= max_files:
            break

        path = entry["path"]
        size = entry["size"]
        mtime_ms = entry["mtime_ms"]
        volume_serial = entry.get("volume_serial")
        file_id = entry.get("file_id")
        parent_file_id = entry.get("parent_file_id")
        win_attrs = entry.get("win_attrs")
        is_dir = bool(entry.get("is_dir"))
        kind_override = entry.get("kind_override")
        _, ext = os.path.splitext(path)
        ext = ext.lower()

        content_hash = None
        existing_meta = existing_files_map.get(path)
        is_unchanged = _existing_file_is_unchanged(existing_meta, size, mtime_ms, volume_serial, file_id)
        if is_unchanged and existing_meta:
            content_hash = existing_meta.get("content_hash")
        elif not is_dir and compute_hashes and ext not in db.METADATA_ONLY_EXTENSIONS:
            content_hash = await loop.run_in_executor(executor, compute_content_hash, path, ext)

        if not is_dir and not is_unchanged and content_hash and content_hash in deleted_files:
            _flush_batch(batch_data, progress, progress_callback)
            old_file = deleted_files[content_hash]
            db.upsert_file(
                root_id,
                path,
                size,
                mtime_ms,
                scan_id,
                content_hash,
                volume_serial=volume_serial,
                file_id=file_id,
                parent_file_id=parent_file_id,
                win_attrs=win_attrs,
            )
            if db.transfer_file_metadata(old_file.id, path):
                progress.moved_files += 1
                del deleted_files[content_hash]
                processed += 1
                continue

        batch_data.append({
            "root_id": root_id,
            "path": path,
            "size": size,
            "mtime_ms": mtime_ms,
            "scan_id": scan_id,
            "content_hash": content_hash,
            "kind_override": kind_override,
            "volume_serial": volume_serial,
            "file_id": file_id,
            "parent_file_id": parent_file_id,
            "win_attrs": win_attrs,
        })
        processed += 1
        if len(batch_data) >= batch_size:
            _flush_batch(batch_data, progress, progress_callback)

    _flush_batch(batch_data, progress, progress_callback)
    progress.deleted_files = db.mark_deleted_files(root_id, scan_id)
    executor.shutdown(wait=False)
    if progress_callback:
        progress_callback(progress)
    _ensure_windows_root_watcher(root_id, root.path)
    return progress


async def scan_root(
    root_id: str,
    progress_callback: Optional[Callable[[ScanProgress], None]] = None,
    compute_hashes: bool = True,
    max_files: Optional[int] = None,
) -> ScanProgress:
    """
    Scan a root folder and update the file index.
    """
    if sys.platform == "win32" and WINDOWS_FAST_PATH_AVAILABLE:
        try:
            return await _scan_root_windows(
                root_id,
                progress_callback=progress_callback,
                compute_hashes=compute_hashes,
                max_files=max_files,
            )
        except Exception as exc:
            root = db.get_root(root_id)
            if root:
                db.update_root(root_id, backend="generic", watch_state="error", volume_serial=root.volume_serial)
            progress = await _scan_root_generic(
                root_id,
                progress_callback=progress_callback,
                compute_hashes=compute_hashes,
                max_files=max_files,
            )
            progress.errors.append(f"Windows fast path fallback: {exc}")
            return progress

    return await _scan_root_generic(
        root_id,
        progress_callback=progress_callback,
        compute_hashes=compute_hashes,
        max_files=max_files,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

def _sync_windows_file_event(root_id: str, abs_path: str) -> None:
    root = db.get_root(root_id)
    if not root or not os.path.isfile(abs_path):
        return

    stat = os.stat(abs_path)
    size = stat.st_size
    mtime_ms = int(stat.st_mtime * 1000)
    _, ext = os.path.splitext(abs_path)
    ext = ext.lower()

    volume_serial, file_id = _get_windows_identity(abs_path, is_dir=False)
    parent_path = os.path.dirname(abs_path)
    _, parent_file_id = _get_windows_identity(parent_path, is_dir=True)

    existing_meta = db.get_root_file_metadata(root_id).get(abs_path)
    content_hash = existing_meta.get("content_hash") if _existing_file_is_unchanged(existing_meta, size, mtime_ms, volume_serial, file_id) and existing_meta else None
    if content_hash is None and ext not in db.METADATA_ONLY_EXTENSIONS:
        content_hash = compute_content_hash(abs_path, ext)

    scan_id = max((db.get_root(root_id) or root).last_scan_id, 1)
    win_attrs = getattr(stat, "st_file_attributes", None)
    db.upsert_file(
        root_id,
        abs_path,
        size,
        mtime_ms,
        scan_id,
        content_hash,
        volume_serial=volume_serial,
        file_id=file_id,
        parent_file_id=parent_file_id,
        win_attrs=win_attrs,
    )


class _WindowsRootWatcher:
    def __init__(self, root_id: str, root_path: str):
        self.root_id = root_id
        self.root_path = root_path
        self.stop_event = threading.Event()
        self.thread = threading.Thread(
            target=self._run,
            name=f"file-index-watch-{root_id[:8]}",
            daemon=True,
        )
        self.handle: Optional[Any] = None
        self._rescan_lock = threading.Lock()
        self._timer_lock = threading.Lock()
        self._rescan_timer: Optional[threading.Timer] = None

    def start(self) -> None:
        db.set_root_watch_state(self.root_id, "active")
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        with self._timer_lock:
            if self._rescan_timer:
                self._rescan_timer.cancel()
                self._rescan_timer = None
        if self.handle is not None and WINDOWS_FAST_PATH_AVAILABLE:
            try:
                _CloseHandle(self.handle)
            except Exception:
                pass
        if self.thread.is_alive():
            self.thread.join(timeout=1.0)

    def _schedule_reconcile(self) -> None:
        with self._timer_lock:
            if self._rescan_timer:
                self._rescan_timer.cancel()
            timer = threading.Timer(WATCHER_DEBOUNCE_SECONDS, self._run_reconcile_scan)
            timer.daemon = True
            self._rescan_timer = timer
            timer.start()

    def _run_reconcile_scan(self) -> None:
        with self._rescan_lock:
            try:
                asyncio.run(scan_root(self.root_id, compute_hashes=False))
            except Exception:
                db.set_root_watch_state(self.root_id, "error")

    def _apply_events(self, events: List[Tuple[int, str]]) -> None:
        root_prefix = os.path.normpath(os.path.abspath(self.root_path))
        for action, relative_path in events:
            abs_path = os.path.normpath(os.path.abspath(os.path.join(self.root_path, relative_path)))
            if not abs_path.startswith(root_prefix):
                continue

            if action in (FILE_ACTION_REMOVED, FILE_ACTION_RENAMED_OLD_NAME):
                db.mark_path_deleted(self.root_id, abs_path)
                continue

            if not os.path.exists(abs_path):
                db.mark_path_deleted(self.root_id, abs_path)
                continue

            if os.path.isdir(abs_path):
                self._schedule_reconcile()
                continue

            try:
                _sync_windows_file_event(self.root_id, abs_path)
            except Exception:
                self._schedule_reconcile()

    def _run(self) -> None:
        if not WINDOWS_FAST_PATH_AVAILABLE:
            db.set_root_watch_state(self.root_id, "error")
            return

        handle = _open_watch_handle(self.root_path)
        if handle is None:
            db.set_root_watch_state(self.root_id, "error")
            return

        self.handle = handle
        notify_filter = (
            FILE_NOTIFY_CHANGE_FILE_NAME
            | FILE_NOTIFY_CHANGE_DIR_NAME
            | FILE_NOTIFY_CHANGE_ATTRIBUTES
            | FILE_NOTIFY_CHANGE_SIZE
            | FILE_NOTIFY_CHANGE_LAST_WRITE
            | FILE_NOTIFY_CHANGE_CREATION
        )

        try:
            while not self.stop_event.is_set():
                buffer = ctypes.create_string_buffer(WATCHER_BUFFER_SIZE)
                bytes_returned = wintypes.DWORD(0)
                ok = _ReadDirectoryChangesW(
                    handle,
                    buffer,
                    WATCHER_BUFFER_SIZE,
                    True,
                    notify_filter,
                    ctypes.byref(bytes_returned),
                    None,
                    None,
                )
                if not ok:
                    if not self.stop_event.is_set():
                        db.set_root_watch_state(self.root_id, "error")
                    break
                if bytes_returned.value <= 0:
                    continue
                events = _parse_directory_notifications(buffer.raw[:bytes_returned.value])
                if not events:
                    self._schedule_reconcile()
                    continue
                self._apply_events(events)
        finally:
            if self.handle is not None:
                try:
                    _CloseHandle(self.handle)
                except Exception:
                    pass
                self.handle = None
            if not self.stop_event.is_set():
                db.set_root_watch_state(self.root_id, "error")


_WINDOWS_WATCHERS: Dict[str, _WindowsRootWatcher] = {}
_WINDOWS_WATCHERS_LOCK = threading.Lock()


def _ensure_windows_root_watcher(root_id: str, root_path: str) -> None:
    if not WINDOWS_FAST_PATH_AVAILABLE:
        return
    with _WINDOWS_WATCHERS_LOCK:
        existing = _WINDOWS_WATCHERS.get(root_id)
        if existing and existing.root_path == root_path and existing.thread.is_alive():
            return
        if existing:
            existing.stop()
        watcher = _WindowsRootWatcher(root_id, root_path)
        _WINDOWS_WATCHERS[root_id] = watcher
        watcher.start()


def _stop_windows_root_watcher(root_id: str) -> None:
    with _WINDOWS_WATCHERS_LOCK:
        watcher = _WINDOWS_WATCHERS.pop(root_id, None)
    if watcher:
        watcher.stop()


def _stop_all_windows_watchers() -> None:
    with _WINDOWS_WATCHERS_LOCK:
        watchers = list(_WINDOWS_WATCHERS.values())
        _WINDOWS_WATCHERS.clear()
    for watcher in watchers:
        watcher.stop()


atexit.register(_stop_all_windows_watchers)


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
    
    _stop_windows_root_watcher(root_id)
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
