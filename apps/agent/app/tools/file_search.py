"""
File Search Tool for Semantic File Search

Provides hybrid search combining:
- FTS5 full-text search on filename, path, summary, keywords
- Vector similarity search using text-embedding-3-large embeddings

Search modes:
- Quick: FTS-only (instant, works before embeddings are ready)
- Semantic: Vector-only (concept search)
- Hybrid: Combined FTS + vector with score fusion
"""

from __future__ import annotations

import os
import sys
import re
from typing import Any, Dict, List, Optional, Tuple

from ..storage import file_index_db as db

# ═══════════════════════════════════════════════════════════════════════════════
# LNK / APP RESOLUTION (Windows)
# ═══════════════════════════════════════════════════════════════════════════════

def _resolve_lnk_target(lnk_path: str) -> Optional[str]:
    """
    Read a Windows .lnk shortcut and return the target exe path.
    Uses the binary .lnk format parsing (no COM needed).
    """
    if sys.platform != 'win32':
        return None
    try:
        with open(lnk_path, 'rb') as f:
            data = f.read(2048)  # .lnk header + link-info is within first 2KB
        # Validate magic: 4C 00 00 00 + CLSID
        if len(data) < 76 or data[:4] != b'\x4c\x00\x00\x00':
            return None
        flags = int.from_bytes(data[20:24], 'little')
        has_link_target = flags & 0x01
        has_link_info = flags & 0x02
        offset = 76
        # Skip link target ID list
        if has_link_target:
            if offset + 2 > len(data):
                return None
            id_list_size = int.from_bytes(data[offset:offset+2], 'little')
            offset += 2 + id_list_size
        # Parse link info
        if has_link_info and offset + 4 <= len(data):
            link_info_size = int.from_bytes(data[offset:offset+4], 'little')
            link_info = data[offset:offset+link_info_size]
            if len(link_info) >= 28:
                local_base_offset = int.from_bytes(link_info[16:20], 'little')
                if local_base_offset > 0 and local_base_offset < len(link_info):
                    # Read null-terminated string
                    end = link_info.index(b'\x00', local_base_offset) if b'\x00' in link_info[local_base_offset:] else len(link_info)
                    target = link_info[local_base_offset:end].decode('ascii', errors='replace').strip()
                    if target and os.path.splitext(target)[1].lower() in ('.exe', '.cmd', '.bat', '.com', '.msc'):
                        return target
        return None
    except Exception:
        return None


def _get_app_display_name(filename: str, path: str) -> str:
    """
    Get a clean display name for an application from its filename/path.
    E.g. 'Discord.lnk' -> 'Discord', 'Visual Studio Code.lnk' -> 'Visual Studio Code'
    """
    name = filename
    # Remove extension
    base, ext = os.path.splitext(name)
    if ext.lower() in ('.lnk', '.url', '.exe', '.appref-ms', '.desktop'):
        name = base
    # Clean up common suffixes
    for suffix in [' - Shortcut', ' (2)', ' - Copy']:
        if name.endswith(suffix):
            name = name[:-len(suffix)]
    return name.strip()


# ═══════════════════════════════════════════════════════════════════════════════
# SEARCH UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def format_file_result(f: db.IndexedFile, score: float = 0.0, match_type: str = 'fts') -> Dict[str, Any]:
    """Format a file result for API response."""
    # .lnk files are ALWAYS applications regardless of what kind the DB says
    effective_kind = f.kind
    if f.extension.lower() in ('.lnk', '.url', '.appref-ms'):
        effective_kind = 'application'

    result: Dict[str, Any] = {
        "id": f.id,
        "path": f.path,
        "filename": f.filename,
        "extension": f.extension,
        "kind": effective_kind,
        "size": f.size,
        "summary": f.summary,
        "keywords": f.keywords,
        "status": f.status,
        "indexed_at": f.indexed_at,
        "score": round(score, 4),
        "match_type": match_type,
        "is_folder": effective_kind == 'folder',
        "preview_kind": f.preview_kind,
        "preview_eligible": bool(f.preview_eligible),
    }
    
    # For application-type files, resolve friendly display name and target
    if effective_kind == 'application':
        result["display_name"] = _get_app_display_name(f.filename, f.path)
        
        # Resolve .lnk target to the actual executable
        if f.extension.lower() == '.lnk':
            target = _resolve_lnk_target(f.path)
            if target:
                result["target_path"] = target
            # icon_path = the .lnk itself so Electron uses shell.readShortcutLink
            # which properly extracts the icon from the shortcut metadata
            result["icon_path"] = f.path
    
    return result


def _deduplicate_results(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    De-duplicate search results, preferring:
    1. .lnk shortcuts from Start Menu (installed apps) over raw .exe  
    2. Higher-scored results over lower ones
    3. Results with target_path (resolved) over unresolved ones
    """
    seen_names: Dict[str, int] = {}  # display_name.lower() -> index in output
    output: List[Dict[str, Any]] = []
    
    for r in results:
        if r.get('kind') == 'application':
            display = str(r.get('display_name') or r.get('filename', '')).lower()
            # Normalize: "discord.exe" and "Discord" should deduplicate
            display_clean = re.sub(r'\.(exe|lnk|url|msi|appref-ms)$', '', display).strip()
            
            if display_clean in seen_names:
                idx = seen_names[display_clean]
                existing = output[idx]
                # Prefer the one from Start Menu (has .lnk), or higher score
                is_start_menu = 'start menu' in str(r.get('path', '')).lower()
                existing_is_start_menu = 'start menu' in str(existing.get('path', '')).lower()
                
                if is_start_menu and not existing_is_start_menu:
                    output[idx] = r  # Replace with Start Menu version
                elif r.get('score', 0) > existing.get('score', 0) and not existing_is_start_menu:
                    output[idx] = r
                continue
            
            seen_names[display_clean] = len(output)
        
        output.append(r)
    
    return output


def format_folder_result(f: db.FolderSummary, score: float = 0.0) -> Dict[str, Any]:
    """Format a folder result for API response."""
    folder_name = os.path.basename(f.path.rstrip("\\/")) or f.path
    return {
        "id": f.id,
        "path": f.path,
        "filename": folder_name,
        "display_name": folder_name,
        "folder_name": folder_name,
        "extension": "",
        "kind": "folder",
        "size": 0,
        "file_count": f.file_count,
        "subfolder_count": f.subfolder_count,
        "summary": f.summary,
        "keywords": f.keywords,
        "score": round(score, 4),
        "match_type": "folder",
        "is_folder": True,
        "preview_kind": "icon",
        "preview_eligible": True,
    }


def format_root_result(root: db.IndexedRoot, score: float = 0.0, match_type: str = "root") -> Dict[str, Any]:
    """Format an indexed root folder as a normal search result."""
    folder_name = os.path.basename(root.path.rstrip("\\/")) or root.path
    return {
        "id": f"root:{root.id}",
        "path": root.path,
        "filename": folder_name,
        "display_name": folder_name,
        "extension": "",
        "kind": "folder",
        "size": 0,
        "summary": None,
        "keywords": None,
        "status": "indexed",
        "indexed_at": root.last_scan_at,
        "score": round(score, 4),
        "match_type": match_type,
        "is_folder": True,
        "preview_kind": "icon",
        "preview_eligible": True,
    }


def _normalize_search_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", re.sub(r"[/\\]+", " ", str(value or "").lower()))).strip()


def _tokenize_search_text(value: str) -> List[str]:
    normalized = _normalize_search_text(value)
    return [token for token in normalized.split(" ") if token]


def _score_root_match(root: db.IndexedRoot, query: str) -> float:
    q = _normalize_search_text(query)
    if not q:
        return 0.0

    folder_name = os.path.basename(root.path.rstrip("\\/")) or root.path
    normalized_name = _normalize_search_text(folder_name)
    normalized_path = _normalize_search_text(root.path)
    tokens = set(_tokenize_search_text(folder_name) + _tokenize_search_text(root.path))
    query_tokens = _tokenize_search_text(query)

    if normalized_name == q:
        return 2.2
    if q in tokens:
        return 2.0
    if normalized_name.startswith(q):
        return 1.85
    if q in normalized_name:
        return 1.55
    if query_tokens and all(any(token == qt or token.startswith(qt) for token in tokens) for qt in query_tokens):
        return 1.35
    if q in normalized_path:
        return 1.15
    return 0.0


def _search_root_folders(query: str, limit: int = 20, root_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Search indexed root folders so top-level roots like Downloads show up in normal search."""
    roots = db.list_roots(enabled_only=True)
    if root_id:
        roots = [root for root in roots if root.id == root_id]

    scored: List[Tuple[float, db.IndexedRoot]] = []
    for root in roots:
        score = _score_root_match(root, query)
        if score > 0:
            scored.append((score, root))

    scored.sort(key=lambda item: (-item[0], len(item[1].path), item[1].path.lower()))
    return [format_root_result(root, score, "root") for score, root in scored[:limit]]


# ═══════════════════════════════════════════════════════════════════════════════
# SCORING / RANKING
# ═══════════════════════════════════════════════════════════════════════════════

def _boost_application_score(f: db.IndexedFile, query: str, base_score: float) -> float:
    """
    Aggressively boost application scores so installed apps always rank above
    random folders/files. Mimics Windows Search behaviour where typing "discord"
    returns the Discord app as the #1 result.
    
    .lnk files get an extra bump because they represent Start Menu shortcuts
    (i.e. "installed applications") which is what the user typically wants.
    """
    # .lnk / .url / .appref-ms are always treated as applications for scoring
    ext = f.extension.lower()
    is_app = f.kind == 'application' or ext in ('.lnk', '.url', '.appref-ms')
    if not is_app:
        return base_score

    q = query.lower()
    name_lower = f.filename.lower()
    # Strip extension for cleaner matching  
    name_base = os.path.splitext(name_lower)[0]

    # .lnk from Start Menu gets an extra bump (these are "installed apps")
    lnk_bonus = 0.15 if ext == '.lnk' else 0.0

    # Exact name match (discord == discord.lnk) → highest boost
    if name_base == q:
        return max(base_score, 2.0) + lnk_bonus
    # Name starts with query
    if name_base.startswith(q):
        return max(base_score + 0.8, 1.5) + lnk_bonus
    # Query contained in name
    if q in name_base:
        return max(base_score + 0.5, 1.2) + lnk_bonus
    # Query in path (e.g., path contains "discord" folder)
    if q in f.path.lower():
        return max(base_score + 0.3, 1.0) + lnk_bonus
    # Generic application boost (any app result gets a small bump)
    return max(base_score + 0.15, base_score) + lnk_bonus


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def search_files(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search indexed files using hybrid FTS + vector search.
    
    Args:
        query: Search query string
        vector: Optional query embedding (for semantic search)
        mode: 'quick' (FTS only), 'semantic' (vector only), 'hybrid' (both)
        kind: Filter by file kind (document, image, video, etc.)
        root_id: Filter by indexed root
        limit: Max results (default 20)
    
    Returns:
        List of matching files with scores and match types
    """
    query = str(args.get("query") or "").strip()
    vector = args.get("vector")
    mode = args.get("mode", "hybrid")
    kind = args.get("kind")
    root_id = args.get("root_id")
    limit = int(args.get("limit", 20))
    
    if not query and not vector:
        return {"ok": False, "error": "Either query or vector is required"}
    
    results = []
    
    if mode == "quick" or (mode == "hybrid" and not vector):
        # FTS-only search
        if query:
            # Search with extra capacity for deduplication
            fts_results = db.search_fts(query, limit=limit * 3, kind=kind, root_id=root_id)
            for i, f in enumerate(fts_results):
                score = 1.0 - (i / max(len(fts_results), 1))
                score = _boost_application_score(f, query, score)
                results.append(format_file_result(f, score, 'fts'))
    
    elif mode == "semantic":
        # Vector-only search
        if not vector:
            return {"ok": False, "error": "Vector required for semantic search"}
        
        vec_results = db.search_vector(vector, limit=limit * 2, kind=kind, root_id=root_id)
        for f, score in vec_results:
            results.append(format_file_result(f, score, 'vector'))
    
    else:  # hybrid
        if query and vector:
            hybrid_results = db.hybrid_search(
                query, vector, limit=limit * 2, kind=kind, root_id=root_id
            )
            for f, score, match_type in hybrid_results:
                score = _boost_application_score(f, query, score)
                results.append(format_file_result(f, score, match_type))
        elif query:
            # Fall back to FTS if no vector
            fts_results = db.search_fts(query, limit=limit * 3, kind=kind, root_id=root_id)
            for i, f in enumerate(fts_results):
                score = 1.0 - (i / max(len(fts_results), 1))
                score = _boost_application_score(f, query, score)
                results.append(format_file_result(f, score, 'fts'))
        elif vector:
            # Vector only
            vec_results = db.search_vector(vector, limit=limit * 2, kind=kind, root_id=root_id)
            for f, score in vec_results:
                results.append(format_file_result(f, score, 'vector'))

    if query:
        existing_paths = {
            os.path.normcase(os.path.normpath(str(result.get("path") or "")))
            for result in results
            if result.get("path")
        }
        for root_result in _search_root_folders(query, limit=max(limit, 8), root_id=root_id):
            normalized_path = os.path.normcase(os.path.normpath(str(root_result.get("path") or "")))
            if normalized_path and normalized_path in existing_paths:
                continue
            results.append(root_result)
            if normalized_path:
                existing_paths.add(normalized_path)
    
    # Sort: applications first (kind priority), then by score descending
    # This ensures apps always appear above folders/files when scores are close
    # Within applications, .lnk (Start Menu shortcuts) sort above .exe
    KIND_PRIORITY = {'application': 0, 'folder': 2, 'document': 3, 'code': 3}
    EXT_PRIORITY = {'.lnk': 0, '.url': 0, '.appref-ms': 0, '.exe': 1, '.msi': 2}
    results.sort(key=lambda r: (
        KIND_PRIORITY.get(r.get('kind', 'other'), 5),
        EXT_PRIORITY.get(str(r.get('extension', '')).lower(), 3),
        -r.get('score', 0)
    ))
    
    # De-duplicate (e.g., Discord.lnk vs Discord.exe)
    results = _deduplicate_results(results)
    
    # Trim to limit
    results = results[:limit]
    
    return {
        "ok": True,
        "results": results,
        "count": len(results),
        "mode": mode,
    }


async def search_by_filename(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Quick filename search (FTS on filename only).
    Instant results, works before any indexing completes.
    """
    query = str(args.get("query") or "").strip()
    if not query:
        raise ValueError("missing query")
    
    kind = args.get("kind")
    root_id = args.get("root_id")
    limit = int(args.get("limit", 50))
    
    # Search filename column specifically
    fts_query = f'filename:"{query}"*'
    
    results = db.search_fts(fts_query, limit=limit, kind=kind, root_id=root_id)
    
    return {
        "ok": True,
        "results": [format_file_result(f, 1.0, 'filename') for f in results],
        "count": len(results),
    }


async def search_by_extension(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search files by extension."""
    extension = str(args.get("extension") or args.get("ext") or "").strip()
    if not extension:
        raise ValueError("missing extension")
    
    if not extension.startswith('.'):
        extension = '.' + extension
    
    root_id = args.get("root_id")
    limit = int(args.get("limit", 100))
    
    with db.get_conn() as conn:
        if root_id:
            rows = conn.execute(
                """SELECT * FROM indexed_files 
                   WHERE extension = ? AND root_id = ? AND status != 'deleted'
                   ORDER BY filename LIMIT ?""",
                (extension.lower(), root_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM indexed_files 
                   WHERE extension = ? AND status != 'deleted'
                   ORDER BY filename LIMIT ?""",
                (extension.lower(), limit)
            ).fetchall()
    
    files = [db._row_to_file(r) for r in rows]
    
    return {
        "ok": True,
        "results": [format_file_result(f, 1.0, 'extension') for f in files],
        "count": len(files),
    }


async def search_by_kind(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search files by kind (document, image, video, etc.)."""
    kind = str(args.get("kind") or "").strip()
    if not kind:
        raise ValueError("missing kind")
    
    root_id = args.get("root_id")
    limit = int(args.get("limit", 100))
    
    with db.get_conn() as conn:
        if root_id:
            rows = conn.execute(
                """SELECT * FROM indexed_files 
                   WHERE kind = ? AND root_id = ? AND status != 'deleted'
                   ORDER BY mtime_ms DESC LIMIT ?""",
                (kind, root_id, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM indexed_files 
                   WHERE kind = ? AND status != 'deleted'
                   ORDER BY mtime_ms DESC LIMIT ?""",
                (kind, limit)
            ).fetchall()
    
    files = [db._row_to_file(r) for r in rows]
    
    return {
        "ok": True,
        "results": [format_file_result(f, 1.0, 'kind') for f in files],
        "count": len(files),
    }


async def get_recent_files(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get recently modified files."""
    root_id = args.get("root_id")
    kind = args.get("kind")
    limit = int(args.get("limit", 50))
    
    with db.get_conn() as conn:
        conditions = ["status != 'deleted'"]
        params: List[Any] = []
        
        if root_id:
            conditions.append("root_id = ?")
            params.append(root_id)
        if kind:
            conditions.append("kind = ?")
            params.append(kind)
        
        where = " AND ".join(conditions)
        params.append(limit)
        
        rows = conn.execute(
            f"""SELECT * FROM indexed_files 
               WHERE {where}
               ORDER BY mtime_ms DESC LIMIT ?""",
            tuple(params)
        ).fetchall()
    
    files = [db._row_to_file(r) for r in rows]
    
    return {
        "ok": True,
        "results": [format_file_result(f, 1.0, 'recent') for f in files],
        "count": len(files),
    }


async def get_file_details(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get detailed information about a specific file."""
    file_id = args.get("file_id") or args.get("id")
    path = args.get("path")
    
    if path:
        f = db.get_file_by_path(path)
    elif file_id:
        f = db.get_file(file_id)
    else:
        raise ValueError("missing file_id or path")
    
    if not f:
        return {"ok": False, "error": "File not found"}
    
    # Get full details including whether file still exists
    exists = os.path.isfile(f.path)
    
    return {
        "ok": True,
        "file": {
            **f.to_dict(),
            "exists": exists,
        }
    }


async def get_folder_contents(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get indexed files within a folder."""
    path = str(args.get("path") or "").strip()
    if not path:
        raise ValueError("missing path")
    
    path = os.path.normpath(os.path.abspath(path))
    recursive = bool(args.get("recursive", False))
    limit = int(args.get("limit", 200))
    
    with db.get_conn() as conn:
        if recursive:
            # All files under this path
            rows = conn.execute(
                """SELECT * FROM indexed_files 
                   WHERE path LIKE ? AND status != 'deleted'
                   ORDER BY path LIMIT ?""",
                (path.replace('\\', '/') + '/%', limit)
            ).fetchall()
        else:
            # Direct children only
            pattern = path.replace('\\', '/') + '/%'
            rows = conn.execute(
                """SELECT * FROM indexed_files 
                   WHERE path LIKE ? AND path NOT LIKE ? AND status != 'deleted'
                   ORDER BY filename LIMIT ?""",
                (pattern, pattern + '/%', limit)
            ).fetchall()
    
    files = [db._row_to_file(r) for r in rows]
    
    # Also get folder summary if exists
    folder_summary = db.get_folder_summary(path)
    
    return {
        "ok": True,
        "path": path,
        "folder_summary": folder_summary.to_dict() if folder_summary else None,
        "files": [format_file_result(f, 1.0, 'folder') for f in files],
        "count": len(files),
    }


async def find_similar_files(args: Dict[str, Any]) -> Dict[str, Any]:
    """Find files similar to a given file (by vector similarity)."""
    file_id = args.get("file_id") or args.get("id")
    path = args.get("path")
    limit = int(args.get("limit", 10))
    
    # Get the reference file
    if path:
        ref_file = db.get_file_by_path(path)
    elif file_id:
        ref_file = db.get_file(file_id)
    else:
        raise ValueError("missing file_id or path")
    
    if not ref_file:
        return {"ok": False, "error": "Reference file not found"}
    
    if not ref_file.vector:
        return {"ok": False, "error": "Reference file has no embedding yet"}
    
    # Search for similar files (excluding the reference)
    vec_results = db.search_vector(
        ref_file.vector, limit=limit + 1, threshold=0.5
    )
    
    # Filter out the reference file itself
    results = [
        format_file_result(f, score, 'similar')
        for f, score in vec_results
        if f.id != ref_file.id
    ][:limit]
    
    return {
        "ok": True,
        "reference": format_file_result(ref_file, 1.0, 'reference'),
        "similar": results,
        "count": len(results),
    }
