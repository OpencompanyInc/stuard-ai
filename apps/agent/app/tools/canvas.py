from __future__ import annotations

"""
Canvas Document Tools

These tools manage sidebar canvas documents - a scratchpad where users can type notes
and AI can read/modify content. Documents are stored locally and synced via IPC to desktop.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, Optional


# In-memory storage for canvas documents
# In production, these are forwarded to the desktop app via IPC
_DOCUMENTS: Dict[str, Dict[str, Any]] = {}


def _gen_id() -> str:
    return f"doc-{uuid.uuid4().hex[:8]}"


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


async def canvas_list(args: Dict[str, Any], emit: Optional[Any] = None) -> Dict[str, Any]:
    """List all canvas documents."""
    documents = list(_DOCUMENTS.values())
    return {"ok": True, "documents": documents}


async def canvas_read(args: Dict[str, Any], emit: Optional[Any] = None) -> Dict[str, Any]:
    """Read content from a canvas document."""
    doc_id = args.get("documentId")
    
    if doc_id:
        doc = _DOCUMENTS.get(doc_id)
        if not doc:
            return {"ok": False, "error": "Document not found", "document": None}
        return {"ok": True, "document": doc}
    
    # If no ID provided, return the most recently updated document
    if not _DOCUMENTS:
        return {"ok": True, "document": None}
    
    most_recent = max(_DOCUMENTS.values(), key=lambda d: d.get("updatedAt", ""))
    return {"ok": True, "document": most_recent}


async def canvas_write(args: Dict[str, Any], emit: Optional[Any] = None) -> Dict[str, Any]:
    """Write or modify content in a canvas document."""
    doc_id = args.get("documentId")
    content = args.get("content")
    title = args.get("title")
    action = args.get("action", "replace")
    position = args.get("position", 0)
    
    # Find target document
    if doc_id:
        doc = _DOCUMENTS.get(doc_id)
        if not doc:
            return {"ok": False, "error": "Document not found"}
    else:
        # Use most recent document or create new one
        if not _DOCUMENTS:
            # Auto-create a document
            doc_id = _gen_id()
            now = _now_iso()
            doc = {
                "id": doc_id,
                "title": title or "Untitled",
                "content": "",
                "createdAt": now,
                "updatedAt": now,
            }
            _DOCUMENTS[doc_id] = doc
        else:
            doc = max(_DOCUMENTS.values(), key=lambda d: d.get("updatedAt", ""))
    
    # Apply content changes
    if content is not None:
        current_content = doc.get("content", "")
        if action == "replace":
            doc["content"] = content
        elif action == "append":
            doc["content"] = current_content + content
        elif action == "insert":
            pos = max(0, min(position, len(current_content)))
            doc["content"] = current_content[:pos] + content + current_content[pos:]
    
    # Handle edit action (find and replace)
    if action == "edit":
        old_str = args.get("old_string")
        new_str = args.get("new_string", "")
        current_content = doc.get("content", "")
        
        if not old_str:
            return {"ok": False, "error": "old_string is required for edit action"}
        
        if old_str not in current_content:
            return {"ok": False, "error": "old_string not found in document"}
        
        doc["content"] = current_content.replace(old_str, new_str)
    
    # Update title if provided
    if title is not None:
        doc["title"] = title
    
    doc["updatedAt"] = _now_iso()
    
    if emit:
        try:
            await emit("progress", {"kind": "canvas_write", "documentId": doc["id"], "action": action})
        except Exception:
            pass
    
    return {"ok": True}


async def canvas_create(args: Dict[str, Any], emit: Optional[Any] = None) -> Dict[str, Any]:
    """Create a new canvas document."""
    title = args.get("title", "Untitled")
    content = args.get("content", "")
    
    doc_id = _gen_id()
    now = _now_iso()
    
    doc = {
        "id": doc_id,
        "title": title,
        "content": content,
        "createdAt": now,
        "updatedAt": now,
    }
    _DOCUMENTS[doc_id] = doc
    
    if emit:
        try:
            await emit("progress", {"kind": "canvas_create", "documentId": doc_id})
        except Exception:
            pass
    
    return {"ok": True, "documentId": doc_id}


async def canvas_delete(args: Dict[str, Any], emit: Optional[Any] = None) -> Dict[str, Any]:
    """Delete a canvas document by ID."""
    doc_id = args.get("documentId")
    
    if not doc_id:
        return {"ok": False, "error": "documentId is required"}
    
    if doc_id not in _DOCUMENTS:
        return {"ok": False, "error": "Document not found"}
    
    del _DOCUMENTS[doc_id]
    
    if emit:
        try:
            await emit("progress", {"kind": "canvas_delete", "documentId": doc_id})
        except Exception:
            pass
    
    return {"ok": True}
