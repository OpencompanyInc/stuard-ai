from __future__ import annotations

import base64
import fnmatch
import glob
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import uuid
from typing import Any, Dict, Optional

from .folder_limiter import FolderLimiter, current_session_id

WORKFLOW_TOOL_CALL_FLAG = "__workflowToolCall"


def _should_bypass_folder_permissions(args: Optional[Dict[str, Any]] = None) -> bool:
    if not isinstance(args, dict):
        return False
    return bool(args.get(WORKFLOW_TOOL_CALL_FLAG))


def _resolve_session(args: Optional[Dict[str, Any]] = None) -> str:
    """Get the session ID from args or the context var."""
    if isinstance(args, dict):
        sid = args.get("session_id") or args.get("sessionId")
        if sid:
            return str(sid)
    return current_session_id.get("default")


def _check_folder_read(path: str, args: Optional[Dict[str, Any]] = None) -> None:
    """Raise ValueError if the folder limiter denies read access to *path*."""
    if _should_bypass_folder_permissions(args):
        return
    limiter = FolderLimiter.get(_resolve_session(args))
    if not limiter.check_read(path):
        raise ValueError(limiter.describe_denial(path, "read"))


def _check_folder_write(path: str, args: Optional[Dict[str, Any]] = None) -> None:
    """Raise ValueError if the folder limiter denies write access to *path*."""
    if _should_bypass_folder_permissions(args):
        return
    limiter = FolderLimiter.get(_resolve_session(args))
    if not limiter.check_write(path):
        raise ValueError(limiter.describe_denial(path, "write"))


def _is_safe_path(path: str) -> bool:
    """
    Check if a path is safe to access (not a system directory).
    """
    p = os.path.abspath(os.path.expanduser(path))
    
    # Block common system directories
    unsafe_prefixes = []
    if sys.platform.startswith("win"):
        unsafe_prefixes = [
            os.path.expandvars("%WINDIR%"), 
            os.path.expandvars("%PROGRAMFILES%"),
            os.path.expandvars("%PROGRAMFILES(X86)%")
        ]
    else:
        unsafe_prefixes = ["/etc", "/var", "/usr", "/boot", "/proc", "/sys", "/dev"]
        
    for prefix in unsafe_prefixes:
        if prefix and p.startswith(prefix):
            return False
            
    return True

MAX_READ_FILE_BINARY_BYTES = int(os.getenv("READ_FILE_BINARY_MAX_BYTES", "524288000"))  # 500MB default
MAX_READ_FILE_LINES = int(os.getenv("READ_FILE_MAX_LINES", "500"))
MAX_AGENTIC_FILE_LINES = 650  # Stricter limit for agentic file tools
MAX_GLOB_RESULTS = int(os.getenv("GLOB_MAX_RESULTS", "20000"))
MAX_GREP_RESULTS = int(os.getenv("GREP_MAX_RESULTS", "2000"))
MAX_GREP_FILE_BYTES = int(os.getenv("GREP_MAX_FILE_BYTES", "5242880"))  # 5MB
CHECKPOINT_DIR = os.environ.get(
    "STUARD_CHECKPOINT_DIR",
    os.path.join(os.environ.get("TMPDIR", "/tmp"), "stuard-checkpoints")
    if os.environ.get("STUARD_AGENT_MODE") == "vm"
    else os.path.expanduser("~/.stuard/checkpoints"),
)

class CheckpointManager:
    _active_id: str | None = None
    
    @classmethod
    def set_active(cls, id: str):
        cls._active_id = id
        
    @classmethod
    def get_active(cls) -> str | None:
        return cls._active_id
        
    @classmethod
    def list_checkpoints(cls) -> list[Dict[str, Any]]:
        if not os.path.exists(CHECKPOINT_DIR):
            return []
        res = []
        for name in os.listdir(CHECKPOINT_DIR):
            mp = os.path.join(CHECKPOINT_DIR, name, "manifest.json")
            if os.path.exists(mp):
                try:
                    with open(mp, "r") as f:
                        res.append(json.load(f))
                except:
                    pass
        # Sort by timestamp desc
        res.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return res

    @classmethod
    def create(cls, name: str = "checkpoint") -> str:
        ts = int(time.time())
        id = f"{ts}_{uuid.uuid4().hex[:8]}_{name}"
        path = os.path.join(CHECKPOINT_DIR, id)
        os.makedirs(path, exist_ok=True)
        manifest = {
            "id": id,
            "timestamp": ts,
            "name": name,
            "files": {} # path -> {action: 'create'|'modify'|'delete', backup: str}
        }
        with open(os.path.join(path, "manifest.json"), "w") as f:
            json.dump(manifest, f)
        
        cls._active_id = id
        return id

    @classmethod
    def cleanup_old(cls, max_age_hours: int = 24, max_count: int = 10):
        """Remove old checkpoints to save disk space."""
        if not os.path.exists(CHECKPOINT_DIR):
            return
        
        now = time.time()
        max_age_secs = max_age_hours * 3600
        checkpoints = cls.list_checkpoints()
        
        for i, cp in enumerate(checkpoints):
            cp_id = cp.get("id", "")
            cp_ts = cp.get("timestamp", 0)
            age = now - cp_ts
            
            # Keep the latest few regardless of age
            if i < 3:
                continue
            
            # Remove if too old or too many
            if age > max_age_secs or i >= max_count:
                try:
                    cp_path = os.path.join(CHECKPOINT_DIR, cp_id)
                    if os.path.exists(cp_path):
                        shutil.rmtree(cp_path)
                except:
                    pass

    @classmethod
    def ensure_active(cls) -> str:
        """Auto-create a checkpoint if none is active. Returns the active checkpoint ID."""
        # Periodic cleanup
        cls.cleanup_old()
        
        if cls._active_id:
            # Verify it still exists
            cp_path = os.path.join(CHECKPOINT_DIR, cls._active_id)
            if os.path.exists(cp_path):
                return cls._active_id
        # Create a new auto-checkpoint
        return cls.create("auto")

    @classmethod
    def record_change(cls, file_path: str, operation: str = "modify"):
        # Auto-create checkpoint if none exists
        cls.ensure_active()
        
        # operation: 'modify' (includes delete), 'create' (new file)
        if not cls._active_id:
            return
            
        cp_path = os.path.join(CHECKPOINT_DIR, cls._active_id)
        if not os.path.exists(cp_path):
            return
            
        manifest_path = os.path.join(cp_path, "manifest.json")
        try:
            with open(manifest_path, "r") as f:
                manifest = json.load(f)
        except:
            return

        file_path = os.path.abspath(file_path)
        
        # If already tracked, ignore (we only care about the state *at* checkpoint start)
        if file_path in manifest["files"]:
            return
            
        entry = {"action": operation, "path": file_path}
        
        if os.path.exists(file_path) and operation != "create":
            # Back up original content
            # Use base64 of path to avoid directory structure issues
            backup_name = base64.urlsafe_b64encode(file_path.encode()).decode()
            backup_file = os.path.join(cp_path, backup_name)
            try:
                if os.path.isdir(file_path):
                    shutil.copytree(file_path, backup_file)
                    entry["backup"] = backup_name
                    entry["backup_type"] = "dir"
                    entry["action"] = "modify"
                else:
                    shutil.copy2(file_path, backup_file)
                    entry["backup"] = backup_name
                    entry["backup_type"] = "file"
                    entry["action"] = "modify" 
            except Exception as e:
                print(f"Failed to backup {file_path}: {e}")
                return
        elif operation == "create":
            entry["action"] = "create" 

        manifest["files"][file_path] = entry
        
        with open(manifest_path, "w") as f:
            json.dump(manifest, f)

    @classmethod
    def restore(cls, id: str) -> Dict[str, Any]:
        cp_path = os.path.join(CHECKPOINT_DIR, id)
        manifest_path = os.path.join(cp_path, "manifest.json")
        if not os.path.exists(manifest_path):
            raise ValueError(f"Checkpoint {id} not found")
            
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
            
        restored = []
        errors = []
        
        # Process files
        for path, info in manifest["files"].items():
            try:
                action = info.get("action")
                if action == "create":
                    # It was created, so delete it
                    if os.path.exists(path):
                        if os.path.isdir(path):
                            shutil.rmtree(path)
                        else:
                            os.remove(path)
                elif action == "modify" and "backup" in info:
                    # It was modified/deleted, restore from backup
                    backup_path = os.path.join(cp_path, info["backup"])
                    backup_type = info.get("backup_type") or "file"
                    if os.path.exists(backup_path):
                        if backup_type == "dir":
                            if os.path.exists(path):
                                if os.path.isdir(path):
                                    shutil.rmtree(path)
                                else:
                                    os.remove(path)
                            parent = os.path.dirname(path)
                            if parent and not os.path.exists(parent):
                                os.makedirs(parent, exist_ok=True)
                            shutil.copytree(backup_path, path)
                        else:
                            # Ensure dir exists
                            d = os.path.dirname(path)
                            if d and not os.path.exists(d):
                                os.makedirs(d, exist_ok=True)
                            shutil.copy2(backup_path, path)
                restored.append(path)
            except Exception as e:
                errors.append(f"{path}: {e}")
                
        return {"ok": True, "restored": len(restored), "errors": errors}

async def list_directory(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or ".").strip()
    if not p:
        p = "."
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_read(p, args)
    names = []
    try:
        for name in os.listdir(p):
            full = os.path.join(p, name)
            typ = "dir" if os.path.isdir(full) else "file"
            names.append({"name": name, "type": typ})
    except FileNotFoundError:
        raise ValueError(f"path not found: {p}")
    return {"ok": True, "items": names}


async def read_file(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Read text file contents with optional line range.
    
    Args:
        path: File path to read
        line_start: Starting line number (1-indexed, inclusive). Optional.
        line_end: Ending line number (1-indexed, inclusive). Optional.
    
    If file exceeds MAX_READ_FILE_LINES (default 500) and no line range is specified,
    returns an error with file metadata instead of content.
    """
    p = str(args.get("path") or "").strip()
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_read(p, args)
    
    # Get optional line range (1-indexed)
    line_start = args.get("line_start") or args.get("lineStart")
    line_end = args.get("line_end") or args.get("lineEnd")
    
    # Convert to int if provided
    if line_start is not None:
        line_start = int(line_start)
    if line_end is not None:
        line_end = int(line_end)
    
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    
    total_lines = len(lines)
    
    # If no line range specified and file is too large, return error with metadata
    if line_start is None and line_end is None and total_lines > MAX_READ_FILE_LINES:
        # Return first few and last few lines as preview
        preview_lines = 10
        first_lines = "".join(lines[:preview_lines])
        last_lines = "".join(lines[-preview_lines:]) if total_lines > preview_lines * 2 else ""
        
        return {
            "ok": False,
            "error": "file_too_large",
            "message": f"File has {total_lines} lines which exceeds the {MAX_READ_FILE_LINES} line limit. Use line_start and line_end parameters to read specific portions.",
            "path": p,
            "total_lines": total_lines,
            "max_lines": MAX_READ_FILE_LINES,
            "preview_start": first_lines,
            "preview_end": last_lines,
            "hint": f"Try: line_start=1, line_end={MAX_READ_FILE_LINES} to read the first {MAX_READ_FILE_LINES} lines"
        }
    
    # Apply line range if specified (convert to 0-indexed)
    if line_start is not None or line_end is not None:
        start_idx = (line_start - 1) if line_start else 0
        end_idx = line_end if line_end else total_lines
        
        # Clamp to valid range
        start_idx = max(0, min(start_idx, total_lines))
        end_idx = max(0, min(end_idx, total_lines))
        
        lines = lines[start_idx:end_idx]
        content = "".join(lines)
        
        return {
            "ok": True,
            "content": content,
            "line_start": start_idx + 1,
            "line_end": start_idx + len(lines),
            "lines_returned": len(lines),
            "total_lines": total_lines
        }
    
    # Return full content for small files
    content = "".join(lines)
    return {"ok": True, "content": content, "total_lines": total_lines}


async def glob_paths(args: Dict[str, Any]) -> Dict[str, Any]:
    pattern = str(args.get("pattern") or args.get("glob") or "").strip()
    if not pattern:
        return {"ok": False, "error": "missing pattern"}

    root = str(args.get("root") or args.get("base_path") or args.get("cwd") or "").strip()
    recursive = bool(args.get("recursive", True))
    include_files = args.get("include_files")
    include_dirs = args.get("include_dirs")
    if include_files is None:
        include_files = True
    if include_dirs is None:
        include_dirs = True
    max_results = int(args.get("max_results") or MAX_GLOB_RESULTS)
    if max_results <= 0:
        max_results = MAX_GLOB_RESULTS

    if root:
        root = os.path.expanduser(root)
        if not _is_safe_path(root):
            return {"ok": False, "error": f"Access denied to system path: {root}"}
        _check_folder_read(root, args)
        pattern_path = os.path.join(root, pattern) if not os.path.isabs(pattern) else pattern
    else:
        pattern_path = pattern

    pattern_path = os.path.expanduser(pattern_path)

    try:
        matches = glob.glob(pattern_path, recursive=recursive)
    except Exception as e:
        return {"ok": False, "error": f"glob_failed: {str(e)}"}

    items = []
    truncated = False
    for m in sorted(matches):
        if not _is_safe_path(m):
            continue
        typ = "dir" if os.path.isdir(m) else "file"
        if typ == "dir" and not include_dirs:
            continue
        if typ == "file" and not include_files:
            continue
        items.append({"path": m, "type": typ})
        if len(items) >= max_results:
            truncated = True
            break

    return {"ok": True, "items": items, "count": len(items), "truncated": truncated}


async def grep(args: Dict[str, Any]) -> Dict[str, Any]:
    import re

    p = str(args.get("path") or "").strip()
    pattern = str(args.get("pattern") or args.get("query") or "").strip()

    if not p:
        return {"ok": False, "error": "missing path"}
    if not pattern:
        return {"ok": False, "error": "missing pattern"}

    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        return {"ok": False, "error": f"Access denied to system path: {p}"}
    _check_folder_read(p, args)

    regex = args.get("regex")
    if regex is None:
        regex = True
    case_sensitive = args.get("case_sensitive")
    if case_sensitive is None:
        case_sensitive = True

    include_glob = args.get("include_glob") or args.get("includeGlob")
    exclude_glob = args.get("exclude_glob") or args.get("excludeGlob")
    max_results = int(args.get("max_results") or MAX_GREP_RESULTS)
    if max_results <= 0:
        max_results = MAX_GREP_RESULTS
    max_file_size = int(args.get("max_file_size") or MAX_GREP_FILE_BYTES)
    if max_file_size < 0:
        max_file_size = MAX_GREP_FILE_BYTES

    def normalize_globs(val: Any) -> list[str]:
        if val is None:
            return []
        if isinstance(val, (list, tuple)):
            return [str(v) for v in val if str(v).strip()]
        v = str(val).strip()
        return [v] if v else []

    includes = normalize_globs(include_glob)
    excludes = normalize_globs(exclude_glob)

    flags = 0 if case_sensitive else re.IGNORECASE
    if regex:
        try:
            rx = re.compile(pattern, flags)
        except re.error as e:
            return {"ok": False, "error": f"invalid_regex: {str(e)}"}
    else:
        rx = re.compile(re.escape(pattern), flags)

    files: list[str] = []
    if os.path.isfile(p):
        files = [p]
    elif os.path.isdir(p):
        for root, _, filenames in os.walk(p):
            for name in filenames:
                if includes and not any(fnmatch.fnmatch(name, g) for g in includes):
                    continue
                if excludes and any(fnmatch.fnmatch(name, g) for g in excludes):
                    continue
                files.append(os.path.join(root, name))
    else:
        return {"ok": False, "error": f"path not found: {p}"}

    results = []
    truncated = False
    skipped_too_large = 0

    for fp in files:
        if not _is_safe_path(fp):
            continue
        try:
            if max_file_size and os.path.getsize(fp) > max_file_size:
                skipped_too_large += 1
                continue
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                for line_no, line in enumerate(f, 1):
                    m = rx.search(line)
                    if not m:
                        continue
                    results.append({
                        "path": fp,
                        "line_number": line_no,
                        "line": line.rstrip("\n"),
                        "match": m.group(0)
                    })
                    if len(results) >= max_results:
                        truncated = True
                        break
            if truncated:
                break
        except Exception:
            continue

    return {
        "ok": True,
        "results": results,
        "count": len(results),
        "truncated": truncated,
        "skipped_too_large": skipped_too_large
    }


async def write_file(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    content = str(args.get("content") or "")
    append = bool(args.get("append") or False)
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_write(p, args)
    d = os.path.dirname(p)
    
    # Checkpoint
    op = "create" if not os.path.exists(p) else "modify"
    CheckpointManager.record_change(p, op)

    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    mode = "a" if append else "w"
    with open(p, mode, encoding="utf-8") as f:
        f.write(content)
    return {"ok": True}


async def write_file_base64(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    data_b64 = str(args.get("content") or args.get("data") or "")
    if not p:
        raise ValueError("missing path")
    if not data_b64:
         raise ValueError("missing content/data")
    
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_write(p, args)
        
    d = os.path.dirname(p)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)

    # Checkpoint
    op = "create" if not os.path.exists(p) else "modify"
    CheckpointManager.record_change(p, op)

    try:
        data = base64.b64decode(data_b64)
    except Exception as e:
        raise ValueError(f"Invalid base64 data: {e}")

    with open(p, "wb") as f:
        f.write(data)
        
    return {"ok": True, "path": p, "size": len(data)}


async def create_directory(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_write(p, args)

    # Checkpoint
    if not os.path.exists(p):
        CheckpointManager.record_change(p, "create")

    os.makedirs(p, exist_ok=True)
    return {"ok": True}


async def move_file(args: Dict[str, Any]) -> Dict[str, Any]:
    src = str(args.get("src") or "").strip()
    dest = str(args.get("dest") or "").strip()
    if not src or not dest:
        raise ValueError("missing src/dest")
    src = os.path.expanduser(src)
    dest = os.path.expanduser(dest)
    
    if not _is_safe_path(src):
        raise ValueError(f"Access denied to system path: {src}")
    if not _is_safe_path(dest):
        raise ValueError(f"Access denied to system path: {dest}")
    _check_folder_read(src, args)
    _check_folder_write(dest, args)
    
    # Checkpoint
    CheckpointManager.record_change(src, "modify") # Will become deleted at src
    op_dest = "create" if not os.path.exists(dest) else "modify"
    CheckpointManager.record_change(dest, op_dest)

    d = os.path.dirname(dest)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    shutil.move(src, dest)
    return {"ok": True}

async def copy_file(args: Dict[str, Any]) -> Dict[str, Any]:
    src = str(args.get("src") or "").strip()
    dest = str(args.get("dest") or "").strip()
    if not src or not dest:
        raise ValueError("missing src/dest")
    src = os.path.expanduser(src)
    dest = os.path.expanduser(dest)
    
    if not _is_safe_path(src):
        raise ValueError(f"Access denied to system path: {src}")
    if not _is_safe_path(dest):
        raise ValueError(f"Access denied to system path: {dest}")
    _check_folder_read(src, args)
    _check_folder_write(dest, args)
    
    # Checkpoint
    op_dest = "create" if not os.path.exists(dest) else "modify"
    CheckpointManager.record_change(dest, op_dest)

    d = os.path.dirname(dest)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    shutil.copy2(src, dest)
    return {"ok": True}

async def delete_file(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_write(p, args)
    
    if os.path.exists(p):
        CheckpointManager.record_change(p, "modify") # Will be deleted
        if os.path.isdir(p):
            shutil.rmtree(p)
        else:
            os.remove(p)
    return {"ok": True}

# Checkpoint Tools

async def checkpoint_create(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or "manual")
    cid = CheckpointManager.create(name)
    return {"ok": True, "id": cid}

async def checkpoint_restore(args: Dict[str, Any]) -> Dict[str, Any]:
    cid = str(args.get("id") or "")
    if not cid:
        cid = CheckpointManager.get_active()
        if not cid:
             # Try to find latest
             checkpoints = CheckpointManager.list_checkpoints()
             if checkpoints:
                 cid = checkpoints[0]["id"]
    
    if not cid:
        raise ValueError("No checkpoint specified or found")
        
    res = CheckpointManager.restore(cid)
    return res

async def checkpoint_list(args: Dict[str, Any]) -> Dict[str, Any]:
    return {"ok": True, "checkpoints": CheckpointManager.list_checkpoints()}



async def open_file(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Open a file or directory with the system default application.
    """
    p = str(args.get("path") or args.get("filePath") or args.get("uri") or "").strip()
    if not p:
        raise ValueError("missing path")

    if p.startswith("file://"):
        try:
            from urllib.parse import urlsplit, unquote

            u = urlsplit(p)
            merged = (u.netloc + u.path) if u.netloc else u.path
            p = unquote(merged)
        except Exception:
            p = p.replace("file:///", "").replace("file://", "")

    p = os.path.expanduser(p)
    p = os.path.normpath(p)

    if not os.path.exists(p):
        return {"ok": False, "error": f"path not found: {p}"}

    try:
        if sys.platform.startswith("win"):
            os.startfile(p)  # type: ignore[attr-defined]
            method = "startfile"
        elif sys.platform == "darwin":
            subprocess.Popen(["open", p])
            method = "open"
        else:
            opener = shutil.which("xdg-open")
            if opener:
                subprocess.Popen([opener, p])
                method = "xdg-open"
            else:
                return {"ok": False, "error": "no_opener", "path": p}

        return {"ok": True, "opened": p, "method": method}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def read_file_binary(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or args.get("filePath") or args.get("uri") or "").strip()
    if not p:
        raise ValueError("missing path")
    if p.startswith("file://"):
        try:
            from urllib.parse import urlsplit, unquote
            u = urlsplit(p)
            merged = (u.netloc + u.path) if u.netloc else u.path
            p = unquote(merged)
        except Exception:
            p = p.replace("file:///", "").replace("file://", "")
    p = os.path.expanduser(p)
    p = os.path.normpath(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_read(p, args)
    if not os.path.isfile(p):
        raise ValueError(f"path not found: {p}")
    size = os.path.getsize(p)
    if size > MAX_READ_FILE_BINARY_BYTES:
        return {"ok": False, "error": "file_too_large", "path": p, "size": size, "max": MAX_READ_FILE_BINARY_BYTES}
    with open(p, "rb") as f:
        data = f.read()
    mime, _ = mimetypes.guess_type(p)
    b64 = base64.b64encode(data).decode("ascii")
    return {"ok": True, "data": b64, "mimeType": mime or "application/octet-stream", "path": p, "size": len(data)}


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTIC FILE TOOLS - For AI Agents (Stuard & Workflow Agent)
# ═══════════════════════════════════════════════════════════════════════════════

async def file_read(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Read file contents with line range support for AI agents.

    Modes:
    1. whole_file=True: Read entire file (errors if > 650 lines)
    2. line_start/line_end: Read specific line range (1-indexed, inclusive)

    Returns content with line numbers prefixed for easy reference.
    """
    p = str(args.get("path") or "").strip()
    if not p:
        return {"ok": False, "error": "missing path"}

    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        return {"ok": False, "error": f"Access denied to system path: {p}"}
    _check_folder_read(p, args)

    if not os.path.exists(p):
        return {"ok": False, "error": f"File not found: {p}"}

    if os.path.isdir(p):
        return {"ok": False, "error": f"Path is a directory, not a file: {p}"}

    whole_file = bool(args.get("whole_file") or args.get("wholeFile"))
    line_start = args.get("line_start") or args.get("lineStart")
    line_end = args.get("line_end") or args.get("lineEnd")

    # Convert to int if provided
    if line_start is not None:
        line_start = int(line_start)
    if line_end is not None:
        line_end = int(line_end)

    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except Exception as e:
        return {"ok": False, "error": f"Failed to read file: {str(e)}"}

    total_lines = len(lines)

    # Mode 1: whole_file=True - read entire file but enforce limit
    if whole_file:
        if total_lines > MAX_AGENTIC_FILE_LINES:
            return {
                "ok": False,
                "error": "file_too_large",
                "message": f"File has {total_lines} lines which exceeds the {MAX_AGENTIC_FILE_LINES} line limit for whole_file mode.",
                "total_lines": total_lines,
                "max_lines": MAX_AGENTIC_FILE_LINES,
                "truncated": True,
                "hint": f"Use line_start and line_end to read specific portions (e.g., line_start=1, line_end={MAX_AGENTIC_FILE_LINES})"
            }

        # Return full content with line numbers
        numbered_lines = []
        for i, line in enumerate(lines, 1):
            numbered_lines.append(f"{i:6d}\t{line.rstrip()}")

        return {
            "ok": True,
            "content": "\n".join(numbered_lines),
            "total_lines": total_lines,
            "line_start": 1,
            "line_end": total_lines,
            "lines_returned": total_lines,
            "truncated": False
        }

    # Mode 2: line_start/line_end specified - read range
    if line_start is not None or line_end is not None:
        start_idx = (line_start - 1) if line_start else 0
        end_idx = line_end if line_end else total_lines

        # Clamp to valid range
        start_idx = max(0, min(start_idx, total_lines))
        end_idx = max(0, min(end_idx, total_lines))

        if start_idx >= end_idx:
            return {
                "ok": False,
                "error": "invalid_range",
                "message": f"Invalid line range: {line_start or 1} to {line_end or total_lines}. File has {total_lines} lines.",
                "total_lines": total_lines
            }

        selected_lines = lines[start_idx:end_idx]

        # Return content with line numbers
        numbered_lines = []
        for i, line in enumerate(selected_lines, start_idx + 1):
            numbered_lines.append(f"{i:6d}\t{line.rstrip()}")

        return {
            "ok": True,
            "content": "\n".join(numbered_lines),
            "total_lines": total_lines,
            "line_start": start_idx + 1,
            "line_end": start_idx + len(selected_lines),
            "lines_returned": len(selected_lines),
            "truncated": False
        }

    # Mode 3: No mode specified - require explicit mode
    return {
        "ok": False,
        "error": "mode_required",
        "message": "You must specify either whole_file=true or provide line_start/line_end.",
        "total_lines": total_lines,
        "hint": f"Use whole_file=true for files under {MAX_AGENTIC_FILE_LINES} lines, or line_start/line_end for larger files."
    }


async def file_edit(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Edit file contents using string-based matching for AI agents.

    Modes:
    - replace: Find old_string and replace with new_string (fails if not unique unless replace_all=true)
    - insert_before: Insert new_string before old_string
    - insert_after: Insert new_string after old_string
    - delete: Delete old_string from the file
    - regex: Use regex pattern matching (old_string is the pattern)
    """
    import re

    p = str(args.get("path") or "").strip()
    if not p:
        return {"ok": False, "error": "missing path"}

    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        return {"ok": False, "error": f"Access denied to system path: {p}"}
    _check_folder_write(p, args)

    mode = str(args.get("mode") or "replace").lower()
    valid_modes = ("replace", "insert_before", "insert_after", "delete", "regex")
    if mode not in valid_modes:
        return {"ok": False, "error": f"Invalid mode: {mode}. Use one of: {', '.join(valid_modes)}"}

    # String-based params
    old_string = args.get("old_string") or args.get("oldString") or args.get("find") or ""
    new_string = args.get("new_string") or args.get("newString") or args.get("replace_with") or args.get("content") or ""
    replace_all = bool(args.get("replace_all") or args.get("replaceAll"))

    # Validation
    if not old_string:
        return {"ok": False, "error": "old_string is required (the text to find)"}

    if mode in ("replace", "insert_before", "insert_after", "regex") and new_string == "" and mode != "delete":
        # For replace/insert modes, empty new_string is only valid if explicitly replacing with empty
        if "new_string" not in args and "newString" not in args and "replace_with" not in args and "content" not in args:
            if mode != "regex":  # regex can replace with empty
                return {"ok": False, "error": f"new_string is required for {mode} mode"}

    # Read existing file
    if not os.path.exists(p):
        return {"ok": False, "error": f"File not found: {p}"}

    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        return {"ok": False, "error": f"Failed to read file: {str(e)}"}

    original_content = content
    occurrences = 0

    if mode == "regex":
        # Regex-based find/replace
        try:
            pattern = re.compile(old_string)
            matches = pattern.findall(content)
            occurrences = len(matches)

            if occurrences == 0:
                return {
                    "ok": False,
                    "error": "no_match",
                    "message": f"Pattern not found in file: {old_string[:100]}{'...' if len(old_string) > 100 else ''}"
                }

            if replace_all:
                content = pattern.sub(new_string, content)
            else:
                content = pattern.sub(new_string, content, count=1)
                occurrences = 1

        except re.error as e:
            return {"ok": False, "error": f"Invalid regex pattern: {str(e)}"}

    else:
        # Plain text matching
        occurrences = content.count(old_string)

        if occurrences == 0:
            return {
                "ok": False,
                "error": "no_match",
                "message": f"String not found in file: {old_string[:100]}{'...' if len(old_string) > 100 else ''}"
            }

        if occurrences > 1 and not replace_all:
            # For safety, require unique match unless replace_all is set
            return {
                "ok": False,
                "error": "multiple_matches",
                "message": f"Found {occurrences} occurrences of the string. Set replace_all=true to replace all, or provide a more specific/unique string.",
                "occurrences": occurrences
            }

        if mode == "replace":
            if replace_all:
                content = content.replace(old_string, new_string)
            else:
                content = content.replace(old_string, new_string, 1)
                occurrences = 1

        elif mode == "insert_before":
            if replace_all:
                content = content.replace(old_string, new_string + old_string)
            else:
                content = content.replace(old_string, new_string + old_string, 1)
                occurrences = 1

        elif mode == "insert_after":
            if replace_all:
                content = content.replace(old_string, old_string + new_string)
            else:
                content = content.replace(old_string, old_string + new_string, 1)
                occurrences = 1

        elif mode == "delete":
            if replace_all:
                content = content.replace(old_string, "")
            else:
                content = content.replace(old_string, "", 1)
                occurrences = 1

    # Check if content actually changed
    if content == original_content:
        return {
            "ok": True,
            "mode": mode,
            "changes": 0,
            "message": "No changes made (content unchanged)"
        }

    # Checkpoint before writing
    CheckpointManager.record_change(p, "modify")

    # Write the modified content
    try:
        d = os.path.dirname(p)
        if d and not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        return {"ok": False, "error": f"Failed to write file: {str(e)}"}

    return {
        "ok": True,
        "mode": mode,
        "changes": occurrences,
        "message": f"{mode.capitalize()} completed: {occurrences} occurrence(s) modified."
    }
