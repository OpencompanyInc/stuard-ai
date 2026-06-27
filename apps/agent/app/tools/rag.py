"""
Knowledge Pack RAG Tools

Exposes the device-local RAG pack store (`rag_db`) to the cloud-ai over the tool
dispatch bridge. Embedding happens cloud-side; these handlers receive
precomputed vectors (for chunks) or a precomputed query vector (for search),
mirroring how `knowledge.knowledge_search_facts` works.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, cast

from ..storage import rag_db

logger = logging.getLogger("agent")


async def rag_pack_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new (empty) knowledge pack."""
    title = str(args.get("title") or "").strip()
    persona = str(args.get("persona") or "").strip()
    scope = str(args.get("scope") or "saved").strip()

    if not title:
        return {"ok": False, "error": "title is required"}

    try:
        project_id = str(args.get("project_id") or "").strip() or None
        pack = rag_db.create_pack(
            title=title,
            persona=persona,
            scope=cast(rag_db.PackScope, scope),
            project_id=project_id,
        )
        return {"ok": True, "pack": pack.to_dict(), "id": pack.id}
    except Exception as e:
        logger.error(f"[rag] pack_create error: {e}")
        return {"ok": False, "error": str(e)}


async def rag_pack_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """List knowledge packs (most recently updated first)."""
    limit = int(args.get("limit", 100))
    include_project_packs = bool(args.get("include_project_packs", False))
    try:
        packs = rag_db.list_packs(
            limit=limit, include_project_packs=include_project_packs
        )
        return {"ok": True, "packs": [p.to_dict() for p in packs]}
    except Exception as e:
        logger.error(f"[rag] pack_list error: {e}")
        return {"ok": False, "error": str(e), "packs": []}


async def rag_pack_get(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get a pack and its stats by id."""
    pack_id = str(args.get("id") or args.get("pack_id") or "").strip()
    if not pack_id:
        return {"ok": False, "error": "id is required"}
    try:
        pack = rag_db.get_pack(pack_id)
        if not pack:
            return {"ok": False, "error": "pack_not_found"}
        return {"ok": True, "pack": pack.to_dict(), "stats": rag_db.pack_stats(pack_id)}
    except Exception as e:
        logger.error(f"[rag] pack_get error: {e}")
        return {"ok": False, "error": str(e)}


async def rag_pack_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a pack and all its chunks."""
    pack_id = str(args.get("id") or args.get("pack_id") or "").strip()
    if not pack_id:
        return {"ok": False, "error": "id is required"}
    try:
        deleted = rag_db.delete_pack(pack_id)
        return {"ok": deleted}
    except Exception as e:
        logger.error(f"[rag] pack_delete error: {e}")
        return {"ok": False, "error": str(e)}


async def rag_pack_delete_source(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete chunks from one source inside a pack."""
    pack_id = str(args.get("id") or args.get("pack_id") or "").strip()
    source_ref = str(args.get("source_ref") or args.get("source") or "").strip()
    if not pack_id:
        return {"ok": False, "error": "pack_id is required"}
    if not source_ref:
        return {"ok": False, "error": "source_ref is required"}
    try:
        deleted = rag_db.delete_chunks_for_source(pack_id, source_ref)
        return {"ok": True, "deleted": deleted, "stats": rag_db.pack_stats(pack_id)}
    except Exception as e:
        logger.error(f"[rag] pack_delete_source error: {e}")
        return {"ok": False, "error": str(e)}


async def rag_project_pack_get_or_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Return the hidden document pack for a project, creating it if needed."""
    project_id = str(args.get("project_id") or "").strip()
    title = str(args.get("title") or "Project documents").strip()
    if not project_id:
        return {"ok": False, "error": "project_id is required"}
    try:
        pack = rag_db.get_or_create_project_pack(project_id, title=title)
        return {
            "ok": True,
            "pack": pack.to_dict(),
            "id": pack.id,
            "stats": rag_db.pack_stats(pack.id),
        }
    except Exception as e:
        logger.error(f"[rag] project_pack_get_or_create error: {e}")
        return {"ok": False, "error": str(e)}


async def rag_project_pack_stats(args: Dict[str, Any]) -> Dict[str, Any]:
    """Stats for a project's hidden document pack."""
    project_id = str(args.get("project_id") or "").strip()
    if not project_id:
        return {"ok": False, "error": "project_id is required"}
    try:
        pack = rag_db.get_project_pack(project_id)
        if not pack:
            return {"ok": True, "exists": False, "project_id": project_id}
        return {"ok": True, **rag_db.pack_stats(pack.id)}
    except Exception as e:
        logger.error(f"[rag] project_pack_stats error: {e}")
        return {"ok": False, "error": str(e)}


async def rag_project_pack_query(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search a project's hidden document pack by query vector."""
    project_id = str(args.get("project_id") or "").strip()
    vector = args.get("vector")
    limit = int(args.get("limit", 6))
    threshold = float(args.get("threshold", 0.0))
    if not project_id:
        return {"ok": False, "error": "project_id is required", "results": []}
    if not isinstance(vector, list) or len(vector) == 0:
        return {"ok": False, "error": "query vector is required", "results": []}
    try:
        pack = rag_db.get_project_pack(project_id)
        if not pack:
            return {
                "ok": True,
                "exists": False,
                "project_id": project_id,
                "results": [],
            }
        results = rag_db.query_pack(pack.id, vector, limit=limit, threshold=threshold)
        return {
            "ok": True,
            "exists": True,
            "project_id": project_id,
            "pack_id": pack.id,
            "results": results,
        }
    except Exception as e:
        logger.error(f"[rag] project_pack_query error: {e}")
        return {"ok": False, "error": str(e), "results": []}


async def rag_project_pack_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete the hidden document pack for a project."""
    project_id = str(args.get("project_id") or "").strip()
    if not project_id:
        return {"ok": False, "error": "project_id is required"}
    try:
        deleted = rag_db.delete_project_pack(project_id)
        return {"ok": True, "deleted": deleted}
    except Exception as e:
        logger.error(f"[rag] project_pack_delete error: {e}")
        return {"ok": False, "error": str(e)}


async def rag_pack_add_chunks(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add pre-embedded chunks to a pack.

    args:
      - pack_id / id: target pack
      - chunks: [{ text, vector, source_ref?, ordinal? }]
    """
    pack_id = str(args.get("pack_id") or args.get("id") or "").strip()
    chunks = args.get("chunks")

    if not pack_id:
        return {"ok": False, "error": "pack_id is required"}
    if not isinstance(chunks, list) or len(chunks) == 0:
        return {"ok": False, "error": "chunks (non-empty array) is required"}

    try:
        pack = rag_db.get_pack(pack_id)
        if not pack:
            return {"ok": False, "error": "pack_not_found"}
        inserted = rag_db.add_chunks(pack_id, chunks)
        return {"ok": True, "inserted": inserted, "stats": rag_db.pack_stats(pack_id)}
    except Exception as e:
        logger.error(f"[rag] pack_add_chunks error: {e}")
        return {"ok": False, "error": str(e)}


async def rag_pack_query(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search a single pack by query vector. Scoped strictly to pack_id."""
    pack_id = str(args.get("pack_id") or args.get("id") or "").strip()
    vector = args.get("vector")
    limit = int(args.get("limit", 6))
    threshold = float(args.get("threshold", 0.0))

    if not pack_id:
        return {"ok": False, "error": "pack_id is required", "results": []}
    if not isinstance(vector, list) or len(vector) == 0:
        return {"ok": False, "error": "query vector is required", "results": []}

    try:
        pack = rag_db.get_pack(pack_id)
        if not pack:
            return {"ok": False, "error": "pack_not_found", "results": []}
        results = rag_db.query_pack(pack_id, vector, limit=limit, threshold=threshold)
        return {"ok": True, "results": results}
    except Exception as e:
        logger.error(f"[rag] pack_query error: {e}")
        return {"ok": False, "error": str(e), "results": []}


async def rag_pack_stats(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get chunk/source counts for a pack."""
    pack_id = str(args.get("id") or args.get("pack_id") or "").strip()
    if not pack_id:
        return {"ok": False, "error": "id is required"}
    try:
        return {"ok": True, **rag_db.pack_stats(pack_id)}
    except Exception as e:
        logger.error(f"[rag] pack_stats error: {e}")
        return {"ok": False, "error": str(e)}
