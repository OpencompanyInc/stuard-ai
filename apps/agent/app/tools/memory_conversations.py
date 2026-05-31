"""
Conversation Memory Tools

Handles conversation storage, retrieval, search, and space management
for the encrypted local-first memory system.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from ..storage.memory_db import (
    get_memory_db,
    MemoryDB,
    Conversation,
    Message,
    ConversationSegment,
    Space,
    SpaceItem,
    Project,
    Memory,
    JournalEntry,
)
from ..storage.crypto import hash_password, verify_password

logger = logging.getLogger("agent")


def _fallback_title_from_text(text: str, max_words: int = 6, max_len: int = 60) -> str:
    """Derive a short title from the first user message (matches cloud-ai thread-title)."""
    cleaned = " ".join(str(text or "").replace("\r", " ").replace("\n", " ").split()).strip()
    if not cleaned:
        return ""
    words = cleaned.split(" ")
    title = " ".join(words[:max_words])
    if len(words) > max_words:
        title += "…"
    if len(title) > max_len:
        title = title[: max_len - 1].rstrip() + "…"
    return title.rstrip(".,!?;:")


def _ensure_conversation_title_from_message(db: MemoryDB, conversation_id: str, content: str) -> None:
    conv = db.get_conversation(conversation_id)
    if not conv or (conv.title or "").strip():
        return
    title = _fallback_title_from_text(content)
    if title:
        db.update_conversation(conversation_id, title=title)


# ═══════════════════════════════════════════════════════════════════════════════
# CONVERSATION HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def conversation_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new conversation."""
    try:
        db = get_memory_db()
        source = args.get("source", "stuard")
        conv = db.create_conversation(
            title=args.get("title"),
            model=args.get("model"),
            conversation_id=args.get("conversation_id"),
            source=source,
            owner_type=args.get("owner_type"),
            owner_id=args.get("owner_id"),
        )
        return {"ok": True, "conversation": conv.to_dict()}
    except Exception as e:
        logger.exception("conversation_create failed")
        return {"ok": False, "error": str(e)}


def _resolve_conversation_title(db: MemoryDB, conversation: Conversation) -> Conversation:
    """Ensure list/get responses never return a blank title when messages exist."""
    if (conversation.title or "").strip():
        return conversation
    first = db.get_first_user_message_text(conversation.id)
    if not first:
        return conversation
    title = _fallback_title_from_text(first)
    if not title:
        return conversation
    updated = db.update_conversation(conversation.id, title=title)
    return updated or conversation


async def conversation_get(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get a conversation by ID."""
    try:
        conversation_id = args.get("conversation_id") or args.get("id")
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}

        db = get_memory_db()
        conv = db.get_conversation(conversation_id)

        if not conv:
            return {"ok": False, "error": "not_found"}

        conv = _resolve_conversation_title(db, conv)

        return {"ok": True, "conversation": conv.to_dict()}
    except Exception as e:
        logger.exception("conversation_get failed")
        return {"ok": False, "error": str(e)}


async def conversation_get_extraction_offset(args: Dict[str, Any]) -> Dict[str, Any]:
    """B1: return the highest turn index already extracted for this conversation.

    Returns `{"ok": True, "offset": <int>}`. Offset is 0 when the conversation
    has never been extracted (or doesn't exist), so callers can treat the
    response uniformly without special-casing.
    """
    try:
        conversation_id = args.get("conversation_id") or args.get("id")
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        db = get_memory_db()
        offset = db.get_extraction_offset(str(conversation_id))
        return {"ok": True, "offset": offset}
    except Exception as e:
        logger.exception("conversation_get_extraction_offset failed")
        return {"ok": False, "error": str(e)}


async def conversation_set_extraction_offset(args: Dict[str, Any]) -> Dict[str, Any]:
    """B1: advance the per-conversation extraction watermark. Never moves
    backwards (a lower turn_index is silently ignored)."""
    try:
        conversation_id = args.get("conversation_id") or args.get("id")
        turn_index = args.get("turn_index")
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        if turn_index is None:
            return {"ok": False, "error": "missing turn_index"}
        db = get_memory_db()
        updated = db.set_extraction_offset(str(conversation_id), int(turn_index))
        return {"ok": True, "updated": updated}
    except Exception as e:
        logger.exception("conversation_set_extraction_offset failed")
        return {"ok": False, "error": str(e)}


async def conversation_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """List conversations."""
    try:
        db = get_memory_db()
        status = args.get("status", "active")
        limit = min(int(args.get("limit", 50)), 200)
        offset = int(args.get("offset", 0))
        source = args.get("source")
        
        conversations = db.list_conversations(
            status=status if status else None,
            limit=limit,
            offset=offset,
            source=source if source else None
        )
        conversations = [_resolve_conversation_title(db, c) for c in conversations]
        
        return {
            "ok": True,
            "conversations": [c.to_dict() for c in conversations],
            "count": len(conversations)
        }
    except Exception as e:
        logger.exception("conversation_list failed")
        return {"ok": False, "error": str(e)}


async def conversation_update(args: Dict[str, Any]) -> Dict[str, Any]:
    """Update a conversation."""
    try:
        conversation_id = args.get("conversation_id") or args.get("id")
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        
        db = get_memory_db()
        conv = db.update_conversation(
            conversation_id=conversation_id,
            title=args.get("title"),
            status=args.get("status"),
            embedding=args.get("embedding"),
            source=args.get("source"),
            owner_type=args.get("owner_type"),
            owner_id=args.get("owner_id"),
        )
        
        if not conv:
            return {"ok": False, "error": "not_found"}
        
        return {"ok": True, "conversation": conv.to_dict()}
    except Exception as e:
        logger.exception("conversation_update failed")
        return {"ok": False, "error": str(e)}


async def conversation_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a conversation."""
    try:
        conversation_id = args.get("conversation_id") or args.get("id")
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        
        db = get_memory_db()
        deleted = db.delete_conversation(conversation_id)
        
        return {"ok": True, "deleted": deleted}
    except Exception as e:
        logger.exception("conversation_delete failed")
        return {"ok": False, "error": str(e)}


async def conversation_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search conversations by embedding similarity."""
    try:
        embedding = args.get("embedding")
        if not embedding or not isinstance(embedding, list):
            return {"ok": False, "error": "missing embedding vector"}
        
        db = get_memory_db()
        limit = min(int(args.get("limit", 10)), 50)
        threshold = float(args.get("threshold", 0.6))
        status = args.get("status", "active")
        
        results = db.search_conversations(
            query_vector=embedding,
            limit=limit,
            status=status if status else None,
            threshold=threshold
        )
        
        return {
            "ok": True,
            "results": [
                {"conversation": conv.to_dict(), "score": score}
                for conv, score in results
            ],
            "count": len(results)
        }
    except Exception as e:
        logger.exception("conversation_search failed")
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# MESSAGE HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def message_add(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add a message to a conversation."""
    try:
        conversation_id = args.get("conversation_id")
        role = args.get("role")
        content = args.get("content")

        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        if not role:
            return {"ok": False, "error": "missing role"}
        if not content:
            return {"ok": False, "error": "missing content"}

        db = get_memory_db()
        # Auto-create the conversation if it doesn't exist (e.g. fresh DB, or
        # conversationId passed from Node agent that pre-dates the current DB).
        if not db.get_conversation(conversation_id):
            db.create_conversation(conversation_id=conversation_id)
        msg = db.add_message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            tool_calls=args.get("tool_calls"),
            tool_results=args.get("tool_results"),
            attachments=args.get("attachments"),
            metadata=args.get("metadata"),
            embedding=args.get("embedding")
        )

        if role == "user":
            _ensure_conversation_title_from_message(db, conversation_id, str(content or ""))
        
        return {"ok": True, "message": msg.to_dict()}
    except Exception as e:
        logger.exception("message_add failed")
        return {"ok": False, "error": str(e)}


async def message_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get messages from a conversation."""
    try:
        conversation_id = args.get("conversation_id")
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        
        db = get_memory_db()
        messages = db.get_messages(
            conversation_id=conversation_id,
            start_turn=args.get("start_turn"),
            end_turn=args.get("end_turn"),
            limit=args.get("limit")
        )
        
        return {
            "ok": True,
            "messages": [m.to_dict() for m in messages],
            "count": len(messages)
        }
    except Exception as e:
        logger.exception("message_list failed")
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# SEGMENT HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def segment_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a conversation segment."""
    try:
        conversation_id = args.get("conversation_id")
        start_turn = args.get("start_turn")
        summary = args.get("summary")
        topics = args.get("topics", [])
        
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        if start_turn is None:
            return {"ok": False, "error": "missing start_turn"}
        if not summary:
            return {"ok": False, "error": "missing summary"}
        
        db = get_memory_db()
        segment = db.create_segment(
            conversation_id=conversation_id,
            start_turn=int(start_turn),
            summary=summary,
            topics=topics if isinstance(topics, list) else [topics],
            embedding=args.get("embedding"),
            end_turn=args.get("end_turn")
        )
        
        return {"ok": True, "segment": segment.to_dict()}
    except Exception as e:
        logger.exception("segment_create failed")
        return {"ok": False, "error": str(e)}


async def segment_update(args: Dict[str, Any]) -> Dict[str, Any]:
    """Update a conversation segment."""
    try:
        segment_id = args.get("segment_id") or args.get("id")
        if not segment_id:
            return {"ok": False, "error": "missing segment_id"}
        
        db = get_memory_db()
        segment = db.update_segment(
            segment_id=segment_id,
            summary=args.get("summary"),
            topics=args.get("topics"),
            end_turn=args.get("end_turn"),
            embedding=args.get("embedding")
        )
        
        if not segment:
            return {"ok": False, "error": "not_found"}
        
        return {"ok": True, "segment": segment.to_dict()}
    except Exception as e:
        logger.exception("segment_update failed")
        return {"ok": False, "error": str(e)}


async def segment_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get segments for a conversation."""
    try:
        conversation_id = args.get("conversation_id")
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        
        db = get_memory_db()
        segments = db.get_conversation_segments(conversation_id)
        
        return {
            "ok": True,
            "segments": [s.to_dict() for s in segments],
            "count": len(segments)
        }
    except Exception as e:
        logger.exception("segment_list failed")
        return {"ok": False, "error": str(e)}


async def segment_list_recent(args: Dict[str, Any]) -> Dict[str, Any]:
    """List recent conversation segments (optionally within a date window)."""
    try:
        db = get_memory_db()
        limit = min(int(args.get("limit", 10)), 200)
        since = args.get("since")
        before = args.get("before")

        owner_type = args.get("owner_type", "stuard")
        owner_id = args.get("owner_id")
        segments = db.list_recent_segments(
            limit=limit,
            since=since,
            before=before,
            owner_type=owner_type,
            owner_id=str(owner_id) if owner_id else None,
        )
        return {
            "ok": True,
            "segments": [s.to_dict() for s in segments],
            "count": len(segments),
        }
    except Exception as e:
        logger.exception("segment_list_recent failed")
        return {"ok": False, "error": str(e)}


async def segment_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search conversation segments by embedding similarity.

    Optional `project_id` constrains results to segments belonging to
    conversations stamped with that project (project-scoped memory search).
    """
    try:
        embedding = args.get("embedding")
        if not embedding or not isinstance(embedding, list):
            return {"ok": False, "error": "missing embedding vector"}

        db = get_memory_db()
        limit = min(int(args.get("limit", 10)), 50)
        threshold = float(args.get("threshold", 0.6))
        project_id = args.get("project_id")
        project_id = str(project_id) if project_id else None
        owner_type = args.get("owner_type", "stuard")
        owner_id = args.get("owner_id")

        results = db.search_segments(
            query_vector=embedding,
            limit=limit,
            threshold=threshold,
            project_id=project_id,
            owner_type=owner_type,
            owner_id=str(owner_id) if owner_id else None,
        )
        
        return {
            "ok": True,
            "results": [
                {"segment": seg.to_dict(), "score": score}
                for seg, score in results
            ],
            "count": len(results)
        }
    except Exception as e:
        logger.exception("segment_search failed")
        return {"ok": False, "error": str(e)}


async def segment_build_topic_drawers(args: Dict[str, Any]) -> Dict[str, Any]:
    """Build topic drawers from recent conversation segments.

    Returns an array of topics (drawers) each with clusters of segments.
    Embeddings are never returned to the client.
    """
    try:
        db = get_memory_db()
        drawers = db.build_topic_drawers(
            query=args.get("query"),
            limit_topics=args.get("limit_topics", 50),
            limit_segments_per_topic=args.get("limit_segments_per_topic", 200),
            cluster_threshold=args.get("cluster_threshold", 0.82),
            max_clusters_per_topic=args.get("max_clusters_per_topic", 12),
            segments_scan_limit=args.get("segments_scan_limit", 2000),
            owner_type=args.get("owner_type", "stuard"),
            owner_id=str(args.get("owner_id")) if args.get("owner_id") else None,
        )
        return {"ok": True, "drawers": drawers, "count": len(drawers)}
    except Exception as e:
        logger.exception("segment_build_topic_drawers failed")
        return {"ok": False, "error": str(e), "drawers": []}


async def segment_search_drawers_by_embedding(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search topic drawers by embedding similarity.

    Takes a query embedding, computes centroids for each topic drawer from
    segment embeddings, and returns the top-N most relevant topics.
    """
    try:
        vector = args.get("vector")
        if not isinstance(vector, list) or len(vector) == 0:
            return {"ok": False, "error": "vector is required", "topics": []}

        limit = int(args.get("limit", 3))
        db = get_memory_db()

        # Build drawers to get segment data (including embeddings)
        owner_type = args.get("owner_type", "stuard")
        owner_id = args.get("owner_id")
        segments = db.list_recent_segments_with_embeddings(
            limit=2000,
            owner_type=owner_type,
            owner_id=str(owner_id) if owner_id else None,
        )

        # Group segments by topic and compute centroid
        import numpy as _np
        topic_vecs: Dict[str, list] = {}
        topic_meta: Dict[str, Dict[str, Any]] = {}

        for seg in segments:
            if not seg.embedding or not isinstance(seg.embedding, list):
                continue
            for t in (seg.topics if isinstance(seg.topics, list) else []):
                t = str(t or "").strip()
                if not t:
                    continue
                topic_vecs.setdefault(t, []).append(seg.embedding)
                meta = topic_meta.setdefault(t, {"count": 0, "latest": "", "earliest": ""})
                meta["count"] += 1
                ts = seg.created_at or ""
                if not meta["latest"] or ts > meta["latest"]:
                    meta["latest"] = ts
                if not meta["earliest"] or ts < meta["earliest"]:
                    meta["earliest"] = ts

        query_np = _np.array(vector, dtype=_np.float32)
        scored: list = []
        for topic, vecs in topic_vecs.items():
            centroid = _np.mean([_np.array(v, dtype=_np.float32) for v in vecs], axis=0)
            norm = float(_np.linalg.norm(query_np) * _np.linalg.norm(centroid))
            score = float(_np.dot(query_np, centroid) / norm) if norm > 0 else 0.0
            meta = topic_meta.get(topic, {})
            scored.append({
                "topic": topic,
                "score": round(score, 4),
                "segment_count": meta.get("count", 0),
                "latest_at": meta.get("latest", ""),
                "earliest_at": meta.get("earliest", ""),
            })

        scored.sort(key=lambda x: x["score"], reverse=True)
        # Also check pre-computed collection summaries
        # Collection summaries are currently unscoped, so avoid returning stale
        # cross-owner summaries into a bot/agent memory view.
        collection_hits = []

        return {
            "ok": True,
            "topics": scored[:limit],
            "collection_summaries": collection_hits,
        }
    except Exception as e:
        logger.exception("segment_search_drawers_by_embedding failed")
        return {"ok": False, "error": str(e), "topics": []}


async def collection_summary_upsert(args: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert a pre-computed collection summary for a topic."""
    try:
        db = get_memory_db()
        result = db.upsert_collection_summary(
            topic=str(args.get("topic", "")),
            summary=str(args.get("summary", "")),
            segment_count=int(args.get("segment_count", 0)),
            date_range_start=args.get("date_range_start"),
            date_range_end=args.get("date_range_end"),
            entity_ids=args.get("entity_ids"),
            embedding=args.get("embedding"),
        )
        return {"ok": True, **result}
    except Exception as e:
        logger.exception("collection_summary_upsert failed")
        return {"ok": False, "error": str(e)}


async def collection_summary_get(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get a pre-computed collection summary by topic."""
    try:
        db = get_memory_db()
        result = db.get_collection_summary(str(args.get("topic", "")))
        if result is None:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, **result}
    except Exception as e:
        logger.exception("collection_summary_get failed")
        return {"ok": False, "error": str(e)}


async def collection_summary_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search collection summaries by embedding similarity."""
    try:
        vector = args.get("vector")
        if not isinstance(vector, list) or len(vector) == 0:
            return {"ok": False, "error": "vector is required", "results": []}
        db = get_memory_db()
        results = db.search_collection_summaries_by_vector(
            query_vector=vector,
            limit=int(args.get("limit", 5)),
            threshold=float(args.get("threshold", 0.6)),
        )
        return {"ok": True, "results": results}
    except Exception as e:
        logger.exception("collection_summary_search failed")
        return {"ok": False, "error": str(e), "results": []}


async def collection_summary_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all collection summaries."""
    try:
        db = get_memory_db()
        results = db.list_collection_summaries(limit=int(args.get("limit", 100)))
        return {"ok": True, "summaries": results}
    except Exception as e:
        logger.exception("collection_summary_list failed")
        return {"ok": False, "error": str(e), "summaries": []}


# ═══════════════════════════════════════════════════════════════════════════════
# SPACE HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def space_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new space for organizing knowledge.

    Spaces are containers for organizing notes, links, code snippets, files, and other content.
    They can be used for projects, research, topics, or general reference.

    Args:
        name (str): Name of the space (required)
        type (str): Type of space - 'project', 'topic', 'research', 'reference', or 'custom' (default: 'topic')
        description (str): Optional description
        icon (str): Optional icon
        color (str): Optional color

    Returns:
        dict with 'ok': True and 'space' containing the created space data
    """
    try:
        name = args.get("name")
        space_type = args.get("type", "custom")
        
        if not name:
            return {"ok": False, "error": "missing name"}
        
        db = get_memory_db()
        space = db.create_space(
            name=name,
            space_type=space_type,
            description=args.get("description"),
            icon=args.get("icon", "📁"),
            color=args.get("color", "#6366f1"),
            embedding=args.get("embedding")
        )
        
        return {"ok": True, "space": space.to_dict()}
    except Exception as e:
        logger.exception("space_create failed")
        return {"ok": False, "error": str(e)}


async def space_get(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get a space by ID."""
    try:
        space_id = args.get("space_id") or args.get("id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}
        
        db = get_memory_db()
        space = db.get_space(space_id)
        
        if not space:
            return {"ok": False, "error": "not_found"}
        
        return {"ok": True, "space": space.to_dict()}
    except Exception as e:
        logger.exception("space_get failed")
        return {"ok": False, "error": str(e)}


async def space_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all spaces, optionally filtered by type.

    Args:
        type (str): Optional filter by space type ('project', 'topic', 'research', 'reference', 'custom')
        include_archived (bool): Include archived spaces (default: False)
        limit (int): Maximum number of spaces to return (default: 50, max: 200)

    Returns:
        dict with 'ok': True, 'spaces': list of space data, and 'count': number of spaces
    """
    try:
        db = get_memory_db()
        space_type = args.get("type")
        include_archived = args.get("include_archived", False)
        limit = min(int(args.get("limit", 50)), 200)
        
        spaces = db.list_spaces(
            space_type=space_type,
            include_archived=include_archived,
            limit=limit
        )
        
        return {
            "ok": True,
            "spaces": [s.to_dict() for s in spaces],
            "count": len(spaces)
        }
    except Exception as e:
        logger.exception("space_list failed")
        return {"ok": False, "error": str(e)}


async def space_update(args: Dict[str, Any]) -> Dict[str, Any]:
    """Update a space."""
    try:
        space_id = args.get("space_id") or args.get("id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}
        
        db = get_memory_db()
        space = db.update_space(
            space_id=space_id,
            name=args.get("name"),
            description=args.get("description"),
            icon=args.get("icon"),
            color=args.get("color"),
            archived=args.get("archived"),
            embedding=args.get("embedding")
        )
        
        if not space:
            return {"ok": False, "error": "not_found"}
        
        return {"ok": True, "space": space.to_dict()}
    except Exception as e:
        logger.exception("space_update failed")
        return {"ok": False, "error": str(e)}


async def space_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a space."""
    try:
        space_id = args.get("space_id") or args.get("id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}
        
        db = get_memory_db()
        deleted = db.delete_space(space_id)
        
        return {"ok": True, "deleted": deleted}
    except Exception as e:
        logger.exception("space_delete failed")
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# SPACE ITEM HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def space_item_add(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add an item (note, link, code snippet, file, fact, or folder) to a space.

    Items can be organized in folders using the parent_id parameter.

    Args:
        space_id (str): ID of the space to add to (required)
        type (str): Type of item - 'note', 'link', 'snippet', 'file', 'fact', or 'folder' (default: 'note')
        content (str): Content of the item (required) - URL for links, code for snippets, text for notes
        title (str): Optional title for the item
        parent_id (str): Optional folder ID to organize the item under
        position (int): Optional position within parent folder
        pinned (bool): Whether to pin the item (default: False)

    Returns:
        dict with 'ok': True and 'item' containing the created item data
    """
    try:
        space_id = args.get("space_id")
        item_type = args.get("type", "note")
        content = args.get("content")

        if not space_id:
            return {"ok": False, "error": "missing space_id"}
        if not content:
            return {"ok": False, "error": "missing content"}

        db = get_memory_db()

        # Verify the space exists before adding item
        space = db.get_space(space_id)
        if not space:
            return {"ok": False, "error": f"space not found: {space_id}"}

        item = db.add_space_item(
            space_id=space_id,
            item_type=item_type,
            content=content,
            title=args.get("title"),
            metadata=args.get("metadata"),
            added_by=args.get("added_by", "user"),
            pinned=args.get("pinned", False),
            embedding=args.get("embedding"),
            parent_id=args.get("parent_id"),
            position=args.get("position")
        )

        return {"ok": True, "item": item.to_dict()}
    except Exception as e:
        logger.exception("space_item_add failed")
        return {"ok": False, "error": str(e)}


async def space_item_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all items in a space.

    Returns a flat list of all items including folders, notes, links, snippets, etc.

    Args:
        space_id (str): ID of the space (required)
        item_type (str): Optional filter by item type ('note', 'link', 'snippet', 'file', 'fact', 'folder')
        parent_id (str): Optional filter to only items in a specific folder (use null string for root level)
        limit (int): Maximum number of items to return (default: 100, max: 500)

    Returns:
        dict with 'ok': True, 'items': list of item data, and 'count': number of items
    """
    try:
        space_id = args.get("space_id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}

        db = get_memory_db()
        items = db.get_space_items(
            space_id=space_id,
            item_type=args.get("type"),
            pinned_only=args.get("pinned_only", False),
            parent_id=args.get("parent_id"),
            include_all=args.get("include_all", True),
            limit=min(int(args.get("limit", 100)), 500)
        )

        return {
            "ok": True,
            "items": [i.to_dict() for i in items],
            "count": len(items)
        }
    except Exception as e:
        logger.exception("space_item_list failed")
        return {"ok": False, "error": str(e)}


async def space_item_update(args: Dict[str, Any]) -> Dict[str, Any]:
    """Update an existing space item's content, title, or other properties.

    Args:
        item_id (str): ID of the item to update (required)
        title (str): New title (optional)
        content (str): New content (optional)
        pinned (bool): Pin/unpin the item (optional)
        parent_id (str): Move to a different folder (optional)
        position (int): Change position (optional)

    Returns:
        dict with 'ok': True and 'item' containing the updated item data
    """
    try:
        item_id = args.get("item_id") or args.get("id")
        if not item_id:
            return {"ok": False, "error": "missing item_id"}

        db = get_memory_db()
        item = db.update_space_item(
            item_id=item_id,
            title=args.get("title"),
            content=args.get("content"),
            metadata=args.get("metadata"),
            pinned=args.get("pinned"),
            parent_id=args.get("parent_id"),
            position=args.get("position")
        )

        if not item:
            return {"ok": False, "error": "not_found"}

        return {"ok": True, "item": item.to_dict()}
    except Exception as e:
        logger.exception("space_item_update failed")
        return {"ok": False, "error": str(e)}


async def space_item_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a space item."""
    try:
        item_id = args.get("item_id") or args.get("id")
        if not item_id:
            return {"ok": False, "error": "missing item_id"}

        db = get_memory_db()
        deleted = db.delete_space_item(item_id)

        return {"ok": True, "deleted": deleted}
    except Exception as e:
        logger.exception("space_item_delete failed")
        return {"ok": False, "error": str(e)}


async def space_item_move(args: Dict[str, Any]) -> Dict[str, Any]:
    """Move a space item to a new parent folder and/or position."""
    try:
        item_id = args.get("item_id") or args.get("id")
        if not item_id:
            return {"ok": False, "error": "missing item_id"}

        db = get_memory_db()
        # Use empty string to move to root, None to keep current
        new_parent = args.get("parent_id")
        if new_parent == "":
            new_parent = None

        item = db.move_space_item(
            item_id=item_id,
            new_parent_id=new_parent,
            new_position=args.get("position")
        )

        if not item:
            return {"ok": False, "error": "not_found"}

        return {"ok": True, "item": item.to_dict()}
    except Exception as e:
        logger.exception("space_item_move failed")
        return {"ok": False, "error": str(e)}


async def space_folder_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a folder to organize items in a space.

    Folders can be nested by specifying a parent_id.

    Args:
        space_id (str): ID of the space (required)
        name (str): Name of the folder (required)
        parent_id (str): Optional parent folder ID to create a nested folder
        position (int): Optional position within parent

    Returns:
        dict with 'ok': True and 'folder' containing the created folder data
    """
    try:
        space_id = args.get("space_id")
        name = args.get("name")

        if not space_id:
            return {"ok": False, "error": "missing space_id"}
        if not name:
            return {"ok": False, "error": "missing name"}

        db = get_memory_db()

        # Verify the space exists
        space = db.get_space(space_id)
        if not space:
            return {"ok": False, "error": f"space not found: {space_id}"}

        folder = db.add_space_item(
            space_id=space_id,
            item_type="folder",
            content="",  # Folders have empty content
            title=name,
            parent_id=args.get("parent_id"),
            position=args.get("position")
        )

        return {"ok": True, "folder": folder.to_dict()}
    except Exception as e:
        logger.exception("space_folder_create failed")
        return {"ok": False, "error": str(e)}


async def space_get_tree(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get the folder tree structure for a space."""
    try:
        space_id = args.get("space_id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}

        db = get_memory_db()
        tree = db.get_folder_tree(space_id)

        return {"ok": True, "tree": tree}
    except Exception as e:
        logger.exception("space_get_tree failed")
        return {"ok": False, "error": str(e)}


async def space_item_get(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get a single space item by ID."""
    try:
        item_id = args.get("item_id") or args.get("id")
        if not item_id:
            return {"ok": False, "error": "missing item_id"}

        db = get_memory_db()
        item = db.get_space_item(item_id)

        if not item:
            return {"ok": False, "error": "not_found"}

        return {"ok": True, "item": item.to_dict()}
    except Exception as e:
        logger.exception("space_item_get failed")
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# SPACE SHARING
# ═══════════════════════════════════════════════════════════════════════════════

async def space_share(args: Dict[str, Any]) -> Dict[str, Any]:
    """Share a space with others."""
    try:
        space_id = args.get("space_id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}

        db = get_memory_db()

        # Verify the space exists
        space = db.get_space(space_id)
        if not space:
            return {"ok": False, "error": f"space not found: {space_id}"}

        shared_with = args.get("shared_with", [])
        if isinstance(shared_with, str):
            shared_with = [shared_with]

        # Update shared space info
        with db._get_conn() as conn:
            # Check if entry exists
            existing = conn.execute(
                "SELECT * FROM shared_space_info WHERE space_id = ?",
                (space_id,)
            ).fetchone()

            password_hash = None
            if args.get("password"):
                password_hash = hash_password(args.get("password"))

            if existing:
                conn.execute(
                    """UPDATE shared_space_info
                       SET is_shared = 1, shared_with = ?, share_password_hash = COALESCE(?, share_password_hash)
                       WHERE space_id = ?""",
                    (json.dumps(shared_with), password_hash, space_id)
                )
            else:
                conn.execute(
                    """INSERT INTO shared_space_info (space_id, is_shared, shared_with, share_password_hash)
                       VALUES (?, 1, ?, ?)""",
                    (space_id, json.dumps(shared_with), password_hash)
                )
            conn.commit()

        return {
            "ok": True,
            "space_id": space_id,
            "is_shared": True,
            "shared_with": shared_with
        }
    except Exception as e:
        logger.exception("space_share failed")
        return {"ok": False, "error": str(e)}


async def space_unshare(args: Dict[str, Any]) -> Dict[str, Any]:
    """Stop sharing a space."""
    try:
        space_id = args.get("space_id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}

        db = get_memory_db()

        with db._get_conn() as conn:
            conn.execute(
                """UPDATE shared_space_info
                   SET is_shared = 0, shared_with = NULL
                   WHERE space_id = ?""",
                (space_id,)
            )
            conn.commit()

        return {"ok": True, "space_id": space_id, "is_shared": False}
    except Exception as e:
        logger.exception("space_unshare failed")
        return {"ok": False, "error": str(e)}


async def space_share_info(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get sharing info for a space."""
    try:
        space_id = args.get("space_id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}

        db = get_memory_db()

        with db._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM shared_space_info WHERE space_id = ?",
                (space_id,)
            ).fetchone()

        if not row:
            return {
                "ok": True,
                "space_id": space_id,
                "is_shared": False,
                "shared_with": []
            }

        shared_with = []
        if row['shared_with']:
            try:
                shared_with = json.loads(row['shared_with'])
            except:
                pass

        return {
            "ok": True,
            "space_id": space_id,
            "is_shared": bool(row['is_shared']),
            "shared_with": shared_with,
            "has_password": row['share_password_hash'] is not None
        }
    except Exception as e:
        logger.exception("space_share_info failed")
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# SPACE-CONVERSATION LINKING
# ═══════════════════════════════════════════════════════════════════════════════

async def space_link_conversation(args: Dict[str, Any]) -> Dict[str, Any]:
    """Link a conversation to a space."""
    try:
        space_id = args.get("space_id")
        conversation_id = args.get("conversation_id")
        
        if not space_id:
            return {"ok": False, "error": "missing space_id"}
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        
        db = get_memory_db()
        db.link_conversation_to_space(
            space_id=space_id,
            conversation_id=conversation_id,
            relevance_score=float(args.get("relevance_score", 1.0)),
            auto_linked=args.get("auto_linked", False)
        )
        
        return {"ok": True}
    except Exception as e:
        logger.exception("space_link_conversation failed")
        return {"ok": False, "error": str(e)}


async def space_unlink_conversation(args: Dict[str, Any]) -> Dict[str, Any]:
    """Unlink a conversation from a space."""
    try:
        space_id = args.get("space_id")
        conversation_id = args.get("conversation_id")
        
        if not space_id:
            return {"ok": False, "error": "missing space_id"}
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        
        db = get_memory_db()
        unlinked = db.unlink_conversation_from_space(space_id, conversation_id)
        
        return {"ok": True, "unlinked": unlinked}
    except Exception as e:
        logger.exception("space_unlink_conversation failed")
        return {"ok": False, "error": str(e)}


async def space_get_conversations(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get conversations linked to a space."""
    try:
        space_id = args.get("space_id")
        if not space_id:
            return {"ok": False, "error": "missing space_id"}
        
        db = get_memory_db()
        results = db.get_space_conversations(space_id)
        
        return {
            "ok": True,
            "conversations": [
                {"conversation": conv.to_dict(), "relevance_score": score}
                for conv, score in results
            ],
            "count": len(results)
        }
    except Exception as e:
        logger.exception("space_get_conversations failed")
        return {"ok": False, "error": str(e)}


async def conversation_get_spaces(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get spaces that a conversation is linked to."""
    try:
        conversation_id = args.get("conversation_id")
        if not conversation_id:
            return {"ok": False, "error": "missing conversation_id"}
        
        db = get_memory_db()
        spaces = db.get_conversation_spaces(conversation_id)
        
        return {
            "ok": True,
            "spaces": [s.to_dict() for s in spaces],
            "count": len(spaces)
        }
    except Exception as e:
        logger.exception("conversation_get_spaces failed")
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# SECURITY HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def security_get_settings(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get security settings."""
    try:
        db = get_memory_db()
        settings = db.get_security_settings()
        
        return {
            "ok": True,
            "settings": {
                "memory_lock_enabled": settings.memory_lock_enabled,
                "vault_lock_enabled": settings.vault_lock_enabled,
                "lock_timeout_minutes": settings.lock_timeout_minutes,
                "has_password": settings.password_hash is not None,
                "biometric_enabled": settings.biometric_enabled,
                "sync_enabled": settings.sync_enabled,
                "last_sync_at": settings.last_sync_at,
            }
        }
    except Exception as e:
        logger.exception("security_get_settings failed")
        return {"ok": False, "error": str(e)}


async def security_set_password(args: Dict[str, Any]) -> Dict[str, Any]:
    """Set or update memory lock password."""
    try:
        password = args.get("password")
        current_password = args.get("current_password")
        
        if not password:
            return {"ok": False, "error": "missing password"}
        
        db = get_memory_db()
        settings = db.get_security_settings()
        
        # Verify current password if one exists
        if settings.password_hash:
            if not current_password:
                return {"ok": False, "error": "current_password_required"}
            if not verify_password(current_password, settings.password_hash):
                return {"ok": False, "error": "invalid_current_password"}
        
        # Set new password
        password_hash = hash_password(password)
        db.update_security_settings(password_hash=password_hash)
        
        return {"ok": True}
    except Exception as e:
        logger.exception("security_set_password failed")
        return {"ok": False, "error": str(e)}


async def security_verify_password(args: Dict[str, Any]) -> Dict[str, Any]:
    """Verify memory lock password."""
    try:
        password = args.get("password")
        if not password:
            return {"ok": False, "error": "missing password"}
        
        db = get_memory_db()
        settings = db.get_security_settings()
        
        if not settings.password_hash:
            return {"ok": True, "valid": True, "message": "no_password_set"}
        
        valid = verify_password(password, settings.password_hash)
        return {"ok": True, "valid": valid}
    except Exception as e:
        logger.exception("security_verify_password failed")
        return {"ok": False, "error": str(e)}


async def security_update_settings(args: Dict[str, Any]) -> Dict[str, Any]:
    """Update security settings."""
    try:
        db = get_memory_db()
        
        updates = {}
        if "memory_lock_enabled" in args:
            updates["memory_lock_enabled"] = args["memory_lock_enabled"]
        if "vault_lock_enabled" in args:
            updates["vault_lock_enabled"] = args["vault_lock_enabled"]
        if "lock_timeout_minutes" in args:
            updates["lock_timeout_minutes"] = args["lock_timeout_minutes"]
        if "biometric_enabled" in args:
            updates["biometric_enabled"] = args["biometric_enabled"]
        if "sync_enabled" in args:
            updates["sync_enabled"] = args["sync_enabled"]
        
        if updates:
            db.update_security_settings(**updates)
        
        return {"ok": True}
    except Exception as e:
        logger.exception("security_update_settings failed")
        return {"ok": False, "error": str(e)}


async def security_remove_password(args: Dict[str, Any]) -> Dict[str, Any]:
    """Remove memory lock password."""
    try:
        current_password = args.get("current_password")
        
        db = get_memory_db()
        settings = db.get_security_settings()
        
        # Verify current password
        if settings.password_hash:
            if not current_password:
                return {"ok": False, "error": "current_password_required"}
            if not verify_password(current_password, settings.password_hash):
                return {"ok": False, "error": "invalid_password"}
        
        db.update_security_settings(
            password_hash=None,
            memory_lock_enabled=False
        )
        
        return {"ok": True}
    except Exception as e:
        logger.exception("security_remove_password failed")
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# STATS
# ═══════════════════════════════════════════════════════════════════════════════

async def memory_stats(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get memory database statistics."""
    try:
        db = get_memory_db()
        stats = db.get_stats()
        return {"ok": True, "stats": stats}
    except Exception as e:
        logger.exception("memory_stats failed")
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# PLAINTEXT EXPORT (for VM sync)
# ═══════════════════════════════════════════════════════════════════════════════

async def memory_export_plaintext(args: Dict[str, Any]) -> Dict[str, Any]:
    """Export memory.db to a new file with all encrypted columns decrypted.

    Writes every *_enc column with the PLAINTEXT_PREFIX tag so a VM (or any
    other process running with STUARD_MEMORY_PLAINTEXT=1) can read the rows
    without the device key.

    Args:
        output_path (str): Absolute path to write the plaintext copy to.
                           Any existing file at this path is replaced.

    Returns:
        { ok, output_path, conversations, messages, bytes }
    """
    import os as _os
    import shutil as _shutil
    import sqlite3 as _sqlite3

    from ..storage.memory_db import get_memory_db
    from ..storage.crypto import PLAINTEXT_PREFIX

    output_path = args.get("output_path") or args.get("dest")
    if not output_path or not isinstance(output_path, str):
        return {"ok": False, "error": "missing output_path"}

    db = get_memory_db()
    crypto = db._crypto  # type: ignore[attr-defined]
    src_path = db._db_path  # type: ignore[attr-defined]

    # Can't re-encode rows we can't decrypt. The desktop Python agent runs
    # with the device key so this should only fire in an operator-error case
    # (calling export from an already-plaintext runtime).
    if getattr(crypto, "plaintext_mode", False):
        # Even so, just copy the DB — it's already plaintext-tagged.
        try:
            _os.makedirs(_os.path.dirname(output_path) or ".", exist_ok=True)
            _shutil.copyfile(src_path, output_path)
            size = _os.path.getsize(output_path)
            return {"ok": True, "output_path": output_path, "bytes": size, "mode": "copy"}
        except Exception as e:
            logger.exception("memory_export_plaintext copy failed")
            return {"ok": False, "error": str(e)}

    # Re-encode: start from a fresh copy, then rewrite *_enc columns as
    # plaintext. This preserves all schema, indices, and non-content state.
    try:
        _os.makedirs(_os.path.dirname(output_path) or ".", exist_ok=True)
        # Use SQLite's backup API so we get a consistent snapshot even if
        # the desktop agent is mid-write.
        src_conn = _sqlite3.connect(src_path)
        try:
            dst_conn = _sqlite3.connect(output_path)
            try:
                src_conn.backup(dst_conn)
            finally:
                dst_conn.close()
        finally:
            src_conn.close()

        # Re-encode encrypted columns in the destination copy.
        dst = _sqlite3.connect(output_path)
        dst.row_factory = _sqlite3.Row
        try:
            def _recode(table: str, pk: str, columns: list[str]) -> int:
                existing_cols = {
                    r[1]
                    for r in dst.execute(f"PRAGMA table_info({table})").fetchall()
                }
                columns = [c for c in columns if c in existing_cols]
                if pk not in existing_cols or not columns:
                    return 0
                rows = dst.execute(f"SELECT {pk}, {', '.join(columns)} FROM {table}").fetchall()
                count = 0
                for row in rows:
                    updates = []
                    values: list = []
                    for col in columns:
                        val = row[col]
                        if val is None:
                            updates.append(f"{col} = NULL")
                            continue
                        if isinstance(val, str) and val.startswith(PLAINTEXT_PREFIX):
                            # Already plaintext-tagged — leave alone.
                            continue
                        try:
                            plain = crypto.decrypt_string(val)
                        except Exception:
                            # Unreadable row (wrong key, corruption). Skip
                            # rather than failing the whole export.
                            continue
                        updates.append(f"{col} = ?")
                        values.append(PLAINTEXT_PREFIX + plain)
                    if not updates:
                        continue
                    values.append(row[pk])
                    dst.execute(
                        f"UPDATE {table} SET {', '.join(updates)} WHERE {pk} = ?",
                        tuple(values),
                    )
                    count += 1
                return count

            conv_count = _recode("conversations", "id", ["title_enc"])
            msg_count = _recode(
                "messages",
                "id",
                ["content_enc", "tool_calls_enc", "tool_results_enc", "attachments_enc", "metadata_enc"],
            )

            # Synthesize titles for conversations that ended up with NULL or
            # missing title_enc after the recode (e.g. row was created before
            # auto-title fired, or title_enc couldn't be decrypted). Falls back
            # to the first user message so the VM never displays "Untitled" for
            # rows that have actual content.
            try:
                missing_title_rows = dst.execute(
                    """
                    SELECT id FROM conversations
                    WHERE title_enc IS NULL
                       OR title_enc = ''
                       OR (substr(title_enc, 1, 4) = ?
                           AND length(title_enc) <= 4)
                    """,
                    (PLAINTEXT_PREFIX,),
                ).fetchall()
                synthesized = 0
                for row in missing_title_rows:
                    conv_id = row["id"]
                    msg_row = dst.execute(
                        """
                        SELECT content_enc FROM messages
                        WHERE conversation_id = ? AND role = 'user'
                        ORDER BY created_at ASC
                        LIMIT 1
                        """,
                        (conv_id,),
                    ).fetchone()
                    if not msg_row or not msg_row["content_enc"]:
                        continue
                    raw = msg_row["content_enc"]
                    if isinstance(raw, str) and raw.startswith(PLAINTEXT_PREFIX):
                        text = raw[len(PLAINTEXT_PREFIX):]
                    else:
                        try:
                            text = crypto.decrypt_string(raw)
                        except Exception:
                            continue
                    text = (text or "").strip().replace("\n", " ")
                    if not text:
                        continue
                    title = text[:60] + ("…" if len(text) > 60 else "")
                    dst.execute(
                        "UPDATE conversations SET title_enc = ? WHERE id = ?",
                        (PLAINTEXT_PREFIX + title, conv_id),
                    )
                    synthesized += 1
                if synthesized:
                    logger.info(
                        f"memory_export_plaintext synthesized {synthesized} titles from first user message"
                    )
            except Exception:
                logger.exception("title synthesis failed (non-fatal)")
            # Segments, spaces, space_items, vault, notes — recode best-effort
            # so every encrypted column in the schema becomes plaintext.
            try:
                _recode("conversation_segments", "id", ["summary_enc", "topics_enc", "entity_ids_enc"])
            except Exception:
                pass
            try:
                _recode("spaces", "id", ["name_enc", "description_enc"])
            except Exception:
                pass
            try:
                _recode("space_items", "id", ["title_enc", "content_enc", "metadata_enc"])
            except Exception:
                pass

            dst.commit()
        finally:
            dst.close()

        size = _os.path.getsize(output_path)
        return {
            "ok": True,
            "output_path": output_path,
            "bytes": size,
            "conversations": conv_count,
            "messages": msg_count,
            "mode": "recoded",
        }
    except Exception as e:
        logger.exception("memory_export_plaintext failed")
        try:
            if _os.path.exists(output_path):
                _os.unlink(output_path)
        except Exception:
            pass
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# PROJECT MODE HANDLERS (successor to Spaces — see memory_db.py PROJECTS section)
# ═══════════════════════════════════════════════════════════════════════════════

async def project_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new project. A project is a scoped container for memories,
    journal entries, tasks, and pinned files."""
    try:
        name = args.get("name")
        if not name:
            return {"ok": False, "error": "missing name"}
        db = get_memory_db()
        project = db.create_project(
            name=name,
            description=args.get("description"),
            goals=args.get("goals"),
            instructions=args.get("instructions"),
            status=args.get("status", "active"),
            tags=args.get("tags"),
            pinned_paths=args.get("pinned_paths"),
            icon=args.get("icon", "📁"),
            color=args.get("color", "#71717a"),
            embedding=args.get("embedding"),
            project_id=args.get("project_id"),
        )
        return {"ok": True, "project": project.to_dict()}
    except Exception as e:
        logger.exception("project_create failed")
        return {"ok": False, "error": str(e)}


async def project_get(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        pid = args.get("project_id") or args.get("id")
        if not pid:
            return {"ok": False, "error": "missing project_id"}
        db = get_memory_db()
        project = db.get_project(pid)
        if not project:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "project": project.to_dict()}
    except Exception as e:
        logger.exception("project_get failed")
        return {"ok": False, "error": str(e)}


async def project_list(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        db = get_memory_db()
        projects = db.list_projects(
            status=args.get("status"),
            include_archived=bool(args.get("include_archived", False)),
            limit=min(int(args.get("limit", 100)), 500),
        )
        return {"ok": True, "projects": [p.to_dict() for p in projects], "count": len(projects)}
    except Exception as e:
        logger.exception("project_list failed")
        return {"ok": False, "error": str(e), "projects": []}


async def project_update(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        pid = args.get("project_id") or args.get("id")
        if not pid:
            return {"ok": False, "error": "missing project_id"}
        db = get_memory_db()
        project = db.update_project(
            project_id=pid,
            name=args.get("name"),
            description=args.get("description"),
            goals=args.get("goals"),
            instructions=args.get("instructions"),
            status=args.get("status"),
            tags=args.get("tags"),
            pinned_paths=args.get("pinned_paths"),
            digest=args.get("digest"),
            icon=args.get("icon"),
            color=args.get("color"),
            archived=args.get("archived"),
            embedding=args.get("embedding"),
        )
        if not project:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "project": project.to_dict()}
    except Exception as e:
        logger.exception("project_update failed")
        return {"ok": False, "error": str(e)}


async def project_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        pid = args.get("project_id") or args.get("id")
        if not pid:
            return {"ok": False, "error": "missing project_id"}
        db = get_memory_db()
        deleted = db.delete_project(pid)
        return {"ok": True, "deleted": deleted}
    except Exception as e:
        logger.exception("project_delete failed")
        return {"ok": False, "error": str(e)}


async def project_context_add(args: Dict[str, Any]) -> Dict[str, Any]:
    """Attach a file/folder path to a project and start local metadata indexing.

    Semantic embedding still happens in cloud-ai via process_pending_file_index;
    this local handler gives the desktop UI a direct way to make a path part of
    project context without needing a cloud tool call.
    """
    try:
        project_id = args.get("project_id")
        raw_path = str(args.get("path") or "").strip()
        if not project_id:
            return {"ok": False, "error": "missing project_id"}
        if not raw_path:
            return {"ok": False, "error": "missing path"}

        db = get_memory_db()
        project = db.get_project(str(project_id))
        if not project:
            return {"ok": False, "error": "project_not_found"}

        path = os.path.normpath(os.path.abspath(os.path.expanduser(raw_path)))
        next_paths = list(project.pinned_paths or [])
        if path not in next_paths:
            next_paths.append(path)
            project = db.update_project(str(project_id), pinned_paths=next_paths) or project

        kind = "missing"
        root = None
        scan_result: Optional[Dict[str, Any]] = None
        if os.path.isdir(path):
            kind = "folder"
            from . import file_scanner

            add_result = await file_scanner.add_index_root({
                "path": path,
                "schedule": args.get("schedule", "daily"),
            })
            root = add_result.get("root") if isinstance(add_result, dict) else None
            if add_result.get("ok") and args.get("scan", True):
                scan_result = await file_scanner.scan_index_root({
                    "root_id": root.get("id") if root else None,
                    "compute_hashes": bool(args.get("compute_hashes", False)),
                    "max_files": args.get("max_files"),
                })
        elif os.path.isfile(path):
            kind = "file"
            from . import file_scanner

            parent = os.path.dirname(path)
            add_result = await file_scanner.add_index_root({
                "path": parent,
                "schedule": args.get("schedule", "daily"),
            })
            root = add_result.get("root") if isinstance(add_result, dict) else None
            if add_result.get("ok") and args.get("scan", True):
                scan_result = await file_scanner.scan_index_root({
                    "root_id": root.get("id") if root else None,
                    "compute_hashes": bool(args.get("compute_hashes", False)),
                    "max_files": args.get("max_files"),
                })

        return {
            "ok": True,
            "project": project.to_dict(),
            "path": path,
            "kind": kind,
            "root": root,
            "scan": scan_result,
            "indexed": bool(root),
        }
    except Exception as e:
        logger.exception("project_context_add failed")
        return {"ok": False, "error": str(e)}


# ── Memories ─────────────────────────────────────────────────────────────────

async def memory_create(args: Dict[str, Any]) -> Dict[str, Any]:
    """Create a new memory entry. Tag with project_ids to scope, or leave empty
    for a global (cross-project) memory."""
    try:
        content = args.get("content")
        if not content:
            return {"ok": False, "error": "missing content"}
        db = get_memory_db()
        mem = db.create_memory(
            type=args.get("type", "note"),
            content=content,
            title=args.get("title"),
            project_ids=args.get("project_ids") or [],
            metadata=args.get("metadata"),
            url=args.get("url"),
            source=args.get("source", "manual"),
            added_by=args.get("added_by", "user"),
            pinned=bool(args.get("pinned", False)),
            embedding=args.get("embedding"),
            memory_id=args.get("memory_id"),
        )
        return {"ok": True, "memory": mem.to_dict()}
    except Exception as e:
        logger.exception("memory_create failed")
        return {"ok": False, "error": str(e)}


async def memory_list(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        db = get_memory_db()
        memories = db.list_memories(
            project_id=args.get("project_id"),
            type=args.get("type"),
            pinned_only=bool(args.get("pinned_only", False)),
            limit=min(int(args.get("limit", 100)), 500),
        )
        return {"ok": True, "memories": [m.to_dict() for m in memories], "count": len(memories)}
    except Exception as e:
        logger.exception("memory_list failed")
        return {"ok": False, "error": str(e), "memories": []}


async def memory_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Cosine-similarity search over memory embeddings. Caller supplies the
    query embedding; embedding generation lives in cloud-ai."""
    try:
        query_embedding = args.get("query_embedding") or args.get("embedding")
        if not query_embedding or not isinstance(query_embedding, list):
            return {"ok": False, "error": "missing query_embedding"}
        db = get_memory_db()
        results = db.search_memories(
            query_embedding=query_embedding,
            project_id=args.get("project_id"),
            limit=min(int(args.get("limit", 10)), 50),
        )
        return {
            "ok": True,
            "results": [
                {"memory": m.to_dict(), "score": score}
                for m, score in results
            ],
            "count": len(results),
        }
    except Exception as e:
        logger.exception("memory_search failed")
        return {"ok": False, "error": str(e), "results": []}


async def memory_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        mid = args.get("memory_id") or args.get("id")
        if not mid:
            return {"ok": False, "error": "missing memory_id"}
        db = get_memory_db()
        return {"ok": True, "deleted": db.delete_memory(mid)}
    except Exception as e:
        logger.exception("memory_delete failed")
        return {"ok": False, "error": str(e)}


# ── Journal entries ──────────────────────────────────────────────────────────

async def journal_add(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add an entry to a project's journal/timeline."""
    try:
        project_id = args.get("project_id")
        title = args.get("title")
        if not project_id or not title:
            return {"ok": False, "error": "missing project_id or title"}
        db = get_memory_db()
        entry = db.create_journal_entry(
            project_id=project_id,
            type=args.get("type", "note"),
            title=title,
            body=args.get("body"),
            source=args.get("source", "manual"),
            source_ref=args.get("source_ref"),
            embedding=args.get("embedding"),
            ts=args.get("ts"),
        )
        return {"ok": True, "entry": entry.to_dict()}
    except Exception as e:
        logger.exception("journal_add failed")
        return {"ok": False, "error": str(e)}


async def journal_list(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        project_id = args.get("project_id")
        if not project_id:
            return {"ok": False, "error": "missing project_id"}
        db = get_memory_db()
        entries = db.list_journal_entries(
            project_id=project_id,
            type=args.get("type"),
            limit=min(int(args.get("limit", 50)), 500),
        )
        return {"ok": True, "entries": [e.to_dict() for e in entries], "count": len(entries)}
    except Exception as e:
        logger.exception("journal_list failed")
        return {"ok": False, "error": str(e), "entries": []}


async def journal_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        eid = args.get("entry_id") or args.get("id")
        if not eid:
            return {"ok": False, "error": "missing entry_id"}
        db = get_memory_db()
        return {"ok": True, "deleted": db.delete_journal_entry(eid)}
    except Exception as e:
        logger.exception("journal_delete failed")
        return {"ok": False, "error": str(e)}


# ── Conversation x Project linkage ───────────────────────────────────────────

async def conversation_set_project(args: Dict[str, Any]) -> Dict[str, Any]:
    """Stamp a conversation with a project_id (or clear it via project_id=null).
    This is the backbone of enter_project_mode / exit_project_mode — the
    conversation row IS the session state for project mode."""
    try:
        cid = args.get("conversation_id")
        if not cid:
            return {"ok": False, "error": "missing conversation_id"}
        # Pass-through None to clear; treat empty string as None.
        pid = args.get("project_id")
        if pid == "":
            pid = None
        db = get_memory_db()
        updated = db.set_conversation_project(cid, pid)
        return {"ok": True, "updated": updated, "project_id": pid}
    except Exception as e:
        logger.exception("conversation_set_project failed")
        return {"ok": False, "error": str(e)}
