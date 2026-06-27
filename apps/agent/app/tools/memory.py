from __future__ import annotations

from typing import Any, Dict, List, Optional
import logging

from ..storage import knowledge_db as kdb

logger = logging.getLogger("agent")


def _row_to_fact_dict(row: Any) -> Dict[str, Any]:
    try:
        return {
            "id": row["id"],
            "entity_id": row["entity_id"],
            "category": row["category"],
            "subtype": row["subtype"],
            "attribute_key": row["attribute_key"],
            "text": row["text"],
            "created_at": row["created_at"],
            "validity": bool(row["validity"]),
            "source": row.get("source") if hasattr(row, "get") else row["source"],
        }
    except Exception:
        try:
            return dict(row)
        except Exception:
            return {"raw": str(row)}


async def memory_retrieval(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "search").strip().lower()

    if action in ("store", "remember", "add"):
        text = str(args.get("text") or args.get("fact") or args.get("content") or "").strip()
        if not text:
            return {"ok": False, "error": "missing_text"}

        category = str(args.get("category") or "project").strip().lower()
        subtype = str(args.get("subtype") or "detail").strip().lower()
        source = str(args.get("source") or "ai_extracted")
        entity_id = args.get("entity_id")
        vector = args.get("vector")

        try:
            fact = kdb.append_fact(
                category=category,  # type: ignore
                subtype=subtype,  # type: ignore
                text=text,
                entity_id=str(entity_id) if entity_id else None,
                vector=vector if isinstance(vector, list) else None,
                source=source,
            )
            return {"ok": True, "id": fact.id, "fact": fact.to_dict()}
        except Exception as e:
            logger.exception("memory_retrieval_store_failed")
            return {"ok": False, "error": str(e)}

    if action in ("search", "recall", "retrieve"):
        query = str(args.get("query") or args.get("q") or "").strip()
        limit = int(args.get("limit") or 20)
        limit = max(1, min(limit, 100))

        if not query:
            return {"ok": True, "results": [], "count": 0}

        try:
            with kdb.get_conn() as conn:
                rows = conn.execute(
                    """SELECT id, entity_id, category, subtype, attribute_key, text, created_at, validity, source
                       FROM facts
                       WHERE validity = 1 AND LOWER(text) LIKE ?
                       ORDER BY created_at DESC
                       LIMIT ?""",
                    (f"%{query.lower()}%", limit),
                ).fetchall()

            results = [_row_to_fact_dict(r) for r in rows]
            return {"ok": True, "results": results, "count": len(results)}
        except Exception as e:
            logger.exception("memory_retrieval_search_failed")
            return {"ok": False, "error": str(e)}

    if action in ("identity", "profile"):
        try:
            facts = kdb.get_identity_lens()
            return {"ok": True, "facts": [f.to_dict() for f in facts], "count": len(facts)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    return {"ok": False, "error": "unknown_action"}


async def group_management(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "list").strip().lower()
    if action in ("list", "get", "search"):
        return {"ok": True, "groups": [], "count": 0}
    return {"ok": False, "error": "not_supported"}
