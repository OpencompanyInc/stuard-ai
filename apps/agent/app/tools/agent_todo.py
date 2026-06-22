"""
Agent Todo Tool - Session-scoped task tracking for long-running operations.

This is an INTERNAL tool for the agent to manage its own multi-step tasks
within a single conversation/thread. Unlike user tasks (task_crud), these
are ephemeral and cleared when the session ends.

Key differences from task_crud:
- Session-scoped (tied to conversation_id/thread_id)
- In-memory with optional thread-level persistence
- Designed for agent's internal workflow tracking
- Simpler status model: pending -> in_progress -> completed/failed
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Callable, Awaitable
from dataclasses import dataclass, field
from enum import Enum
import json


class TodoStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"


@dataclass
class AgentTodo:
    id: str
    title: str
    description: str = ""
    status: TodoStatus = TodoStatus.PENDING
    priority: int = 0  # Higher = more important
    parent_id: Optional[str] = None  # For subtasks
    tags: List[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    completed_at: Optional[str] = None
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "status": self.status.value,
            "priority": self.priority,
            "parentId": self.parent_id,
            "tags": self.tags,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "completedAt": self.completed_at,
            "errorMessage": self.error_message,
            "metadata": self.metadata,
        }


# In-memory storage: session_id -> list of todos
_SESSION_TODOS: Dict[str, List[AgentTodo]] = {}

# In-memory storage: session_id -> live status headline. This is the single,
# plain-language "what's happening right now" line a (possibly non-technical)
# user sees — surfaced in the always-visible status pill and the To-Do panel,
# independent of whether a multi-step checklist exists. Shape:
#   { "label": str, "detail": str | None, "state": "working|done|blocked|idle" }
_SESSION_STATUS: Dict[str, Dict[str, Any]] = {}

_VALID_STATUS_STATES = {"working", "done", "blocked", "idle"}


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def _get_session_todos(session_id: str) -> List[AgentTodo]:
    if session_id not in _SESSION_TODOS:
        _SESSION_TODOS[session_id] = []
    return _SESSION_TODOS[session_id]


def _compute_status(session_id: str) -> Optional[Dict[str, Any]]:
    """Resolve the live status line for a session.

    An explicit `set_status` always wins. Otherwise we derive a sensible
    plain-language status from the checklist so the user still sees "what's
    happening now" even when the model only manages items: the in-progress
    step while working, a "Done" once every step is terminal.
    """
    explicit = _SESSION_STATUS.get(session_id)
    if explicit and str(explicit.get("label") or "").strip():
        return explicit

    todos = _get_session_todos(session_id)
    if not todos:
        return None

    for t in todos:
        if t.status == TodoStatus.IN_PROGRESS:
            return {"label": t.title, "detail": t.description or None, "state": "working"}

    blocked = next((t for t in todos if t.status == TodoStatus.BLOCKED), None)
    if blocked:
        return {"label": blocked.title, "detail": blocked.error_message or None, "state": "blocked"}

    # Everything terminal — surface a quiet "done" so the UI can settle.
    if all(t.status in (TodoStatus.COMPLETED, TodoStatus.FAILED) for t in todos):
        return {"label": "Done", "detail": None, "state": "done"}

    return None


def _find_todo(session_id: str, todo_id: str) -> Optional[AgentTodo]:
    todos = _get_session_todos(session_id)
    for t in todos:
        if t.id == todo_id:
            return t
    return None


async def agent_todo(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """
    Agent's internal todo management for long-running tasks.

    Actions:
    - set_status: Set the live plain-language status headline ("what's happening now")
    - list: Get all todos for the session
    - create: Create a new todo
    - update: Update a todo's status or details
    - complete: Mark a todo as completed
    - fail: Mark a todo as failed with error
    - delete: Remove a todo
    - finish: Mark every remaining step complete + set a done status (finalize)
    - clear: Clear all todos + status for the session
    - get_current: Get the currently in-progress todo
    - bulk_create: Create multiple todos at once (for planning)
    - reorder: Reorder todos by priority

    Args:
        action: The action to perform
        sessionId: The conversation/thread ID (required)
        data: Action-specific data
    """
    action = str(args.get("action") or "").lower()
    session_id = str(args.get("sessionId") or args.get("session_id") or "default")

    # Accept data as a dict, JSON string, or None. Some clients (and some LLMs)
    # serialize the payload as a JSON string instead of an object, which would
    # crash later .get() calls. Coerce to a dict here.
    raw_data = args.get("data")
    if isinstance(raw_data, str):
        stripped = raw_data.strip()
        if not stripped:
            data: Dict[str, Any] = {}
        else:
            try:
                parsed = json.loads(stripped)
                data = parsed if isinstance(parsed, dict) else {"value": parsed}
            except (json.JSONDecodeError, ValueError):
                # Treat the bare string as a title for create-like actions
                data = {"title": stripped}
    elif isinstance(raw_data, dict):
        data = raw_data
    elif isinstance(raw_data, list):
        # If a list is passed directly, treat it as items for bulk_create
        data = {"items": raw_data}
    else:
        data = {}

    # Promote top-level convenience fields onto data so callers can pass either
    # nested ({data: {title: "..."}}) or flat ({title: "..."}) payloads.
    for key in ("title", "description", "items", "id", "status", "priority",
                "tags", "metadata", "parentId", "note", "reason", "error",
                "includeCompleted", "keepInProgress",
                "label", "detail", "state", "summary"):
        if key not in data and key in args:
            data[key] = args[key]

    async def _emit_update(current_session_id: str) -> None:
        if not emit:
            return
            
        todos = _get_session_todos(current_session_id)
        
        # Calculate progress stats
        total = len(todos)
        completed = sum(1 for t in todos if t.status == TodoStatus.COMPLETED)
        failed = sum(1 for t in todos if t.status == TodoStatus.FAILED)
        in_progress = sum(1 for t in todos if t.status == TodoStatus.IN_PROGRESS)
        pending = sum(1 for t in todos if t.status == TodoStatus.PENDING)
        blocked = sum(1 for t in todos if t.status == TodoStatus.BLOCKED)
        percentage = round((completed / total * 100) if total > 0 else 0, 1)

        # Build GenUI payload
        # Sort items for display
        display_items = [t.to_dict() for t in todos]
        
        # Sort by status priority then creation time
        def sort_key(item):
            status_order = {"in_progress": 0, "pending": 1, "blocked": 2, "completed": 3, "failed": 4}
            return (status_order.get(item["status"], 5), -item["priority"], item["createdAt"])
        
        display_items.sort(key=sort_key)

        genui_payload = {
            "items": display_items,
            "title": "Agent Plan",
            "status": _compute_status(current_session_id),
            "progress": {
                "total": total,
                "completed": completed,
                "failed": failed,
                "inProgress": in_progress,
                "pending": pending,
                "blocked": blocked,
                "percentage": percentage,
            }
        }
        
        # Format as markdown block
        json_str = json.dumps(genui_payload, indent=2)
        markdown = f"\n```genui:agent_todo\n{json_str}\n```\n"
        
        # Emit as delta to append to chat stream
        await emit("delta", {"text": markdown})

    if not action:
        return {"ok": False, "error": "action_required"}

    # SET_STATUS - Set the live plain-language status headline.
    # This is the single "what's happening now" line for the user and works
    # with or without a checklist. Passing an empty label clears it (idle).
    if action == "set_status":
        label = str(
            data.get("label")
            or data.get("status")
            or data.get("title")
            or data.get("text")
            or ""
        ).strip()

        if not label:
            _SESSION_STATUS.pop(session_id, None)
            await _emit_update(session_id)
            return {"ok": True, "status": None}

        state = str(data.get("state") or "working").strip().lower()
        if state not in _VALID_STATUS_STATES:
            state = "working"

        detail_raw = data.get("detail") or data.get("description") or data.get("note")
        status = {
            "label": label,
            "detail": str(detail_raw).strip() if detail_raw else None,
            "state": state,
        }
        _SESSION_STATUS[session_id] = status
        await _emit_update(session_id)
        return {"ok": True, "status": status}

    # LIST - Get all todos for session
    if action == "list":
        todos = _get_session_todos(session_id)
        include_completed = bool(data.get("includeCompleted", True))

        result = []
        for t in todos:
            if not include_completed and t.status in (TodoStatus.COMPLETED, TodoStatus.FAILED):
                continue
            result.append(t.to_dict())

        # Sort by: in_progress first, then by priority, then by creation
        def sort_key(item):
            status_order = {"in_progress": 0, "pending": 1, "blocked": 2, "completed": 3, "failed": 4}
            return (status_order.get(item["status"], 5), -item["priority"], item["createdAt"])

        result.sort(key=sort_key)
        return {"ok": True, "items": result, "count": len(result)}

    # CREATE - Create a new todo
    if action == "create":
        title = str(data.get("title") or "").strip()
        if not title:
            return {"ok": False, "error": "title_required"}

        todo = AgentTodo(
            id=str(uuid.uuid4()),
            title=title,
            description=str(data.get("description") or ""),
            status=TodoStatus.PENDING,
            priority=int(data.get("priority") or 0),
            parent_id=data.get("parentId"),
            tags=data.get("tags") or [],
            created_at=_now_iso(),
            updated_at=_now_iso(),
            metadata=data.get("metadata") or {},
        )

        _get_session_todos(session_id).append(todo)
        await _emit_update(session_id)
        return {"ok": True, "todo": todo.to_dict()}

    # BULK_CREATE - Create multiple todos at once
    if action == "bulk_create":
        items = data.get("items") or []
        if not items or not isinstance(items, list):
            return {"ok": False, "error": "items_required"}

        created = []
        for i, item in enumerate(items):
            title = str(item.get("title") or "").strip()
            if not title:
                continue

            todo = AgentTodo(
                id=str(uuid.uuid4()),
                title=title,
                description=str(item.get("description") or ""),
                status=TodoStatus.PENDING,
                priority=int(item.get("priority") or (len(items) - i)),  # Earlier items higher priority
                parent_id=item.get("parentId"),
                tags=item.get("tags") or [],
                created_at=_now_iso(),
                updated_at=_now_iso(),
                metadata=item.get("metadata") or {},
            )
            _get_session_todos(session_id).append(todo)
            created.append(todo.to_dict())

        if created:
            await _emit_update(session_id)
            
        return {"ok": True, "items": created, "count": len(created)}

    # UPDATE - Update a todo
    if action == "update":
        todo_id = str(data.get("id") or "").strip()
        if not todo_id:
            return {"ok": False, "error": "id_required"}

        todo = _find_todo(session_id, todo_id)
        if not todo:
            return {"ok": False, "error": "not_found"}

        if "title" in data:
            todo.title = str(data["title"])
        if "description" in data:
            todo.description = str(data["description"])
        if "status" in data:
            try:
                todo.status = TodoStatus(str(data["status"]).lower())
            except ValueError:
                pass
        if "priority" in data:
            todo.priority = int(data["priority"])
        if "tags" in data:
            todo.tags = data["tags"] or []
        if "metadata" in data:
            todo.metadata.update(data["metadata"] or {})

        todo.updated_at = _now_iso()

        if todo.status == TodoStatus.COMPLETED and not todo.completed_at:
            todo.completed_at = _now_iso()

        await _emit_update(session_id)
        return {"ok": True, "todo": todo.to_dict()}

    # START - Mark a todo as in_progress
    if action == "start":
        todo_id = str(data.get("id") or "").strip()
        if not todo_id:
            return {"ok": False, "error": "id_required"}

        todo = _find_todo(session_id, todo_id)
        if not todo:
            return {"ok": False, "error": "not_found"}

        todo.status = TodoStatus.IN_PROGRESS
        todo.updated_at = _now_iso()

        await _emit_update(session_id)
        return {"ok": True, "todo": todo.to_dict()}

    # COMPLETE - Mark a todo as completed
    if action == "complete":
        todo_id = str(data.get("id") or "").strip()
        if not todo_id:
            return {"ok": False, "error": "id_required"}

        todo = _find_todo(session_id, todo_id)
        if not todo:
            return {"ok": False, "error": "not_found"}

        todo.status = TodoStatus.COMPLETED
        todo.completed_at = _now_iso()
        todo.updated_at = _now_iso()

        # If there's a note, store it
        if data.get("note"):
            todo.metadata["completion_note"] = str(data["note"])

        await _emit_update(session_id)
        return {"ok": True, "todo": todo.to_dict()}

    # FAIL - Mark a todo as failed
    if action == "fail":
        todo_id = str(data.get("id") or "").strip()
        if not todo_id:
            return {"ok": False, "error": "id_required"}

        todo = _find_todo(session_id, todo_id)
        if not todo:
            return {"ok": False, "error": "not_found"}

        todo.status = TodoStatus.FAILED
        todo.error_message = str(data.get("error") or data.get("reason") or "Unknown error")
        todo.updated_at = _now_iso()

        await _emit_update(session_id)
        return {"ok": True, "todo": todo.to_dict()}

    # BLOCK - Mark a todo as blocked
    if action == "block":
        todo_id = str(data.get("id") or "").strip()
        if not todo_id:
            return {"ok": False, "error": "id_required"}

        todo = _find_todo(session_id, todo_id)
        if not todo:
            return {"ok": False, "error": "not_found"}

        todo.status = TodoStatus.BLOCKED
        todo.error_message = str(data.get("reason") or "Blocked")
        todo.updated_at = _now_iso()

        await _emit_update(session_id)
        return {"ok": True, "todo": todo.to_dict()}

    # DELETE - Remove a todo
    if action == "delete":
        todo_id = str(data.get("id") or "").strip()
        if not todo_id:
            return {"ok": False, "error": "id_required"}

        todos = _get_session_todos(session_id)
        for i, t in enumerate(todos):
            if t.id == todo_id:
                todos.pop(i)
                await _emit_update(session_id)
                return {"ok": True, "deleted": True}

        return {"ok": False, "error": "not_found"}

    # FINISH - Finalize the plan in one call: mark every still-open step done
    # and set a "done" status. This is the reliable "wrap up before ending"
    # action so a half-checked plan never lingers looking stuck. The UI shows
    # the completed checklist briefly, then settles on its own.
    if action == "finish":
        todos = _get_session_todos(session_id)
        for t in todos:
            if t.status in (TodoStatus.PENDING, TodoStatus.IN_PROGRESS):
                t.status = TodoStatus.COMPLETED
                t.completed_at = _now_iso()
                t.updated_at = _now_iso()

        summary = str(data.get("summary") or data.get("label") or "Done").strip() or "Done"
        _SESSION_STATUS[session_id] = {"label": summary, "detail": None, "state": "done"}

        await _emit_update(session_id)
        return {"ok": True, "todos": [t.to_dict() for t in todos], "status": _SESSION_STATUS[session_id]}

    # CLEAR - Clear all todos (and the status line) for the session
    if action == "clear":
        keep_in_progress = bool(data.get("keepInProgress", False))

        if keep_in_progress:
            todos = _get_session_todos(session_id)
            _SESSION_TODOS[session_id] = [t for t in todos if t.status == TodoStatus.IN_PROGRESS]
        else:
            _SESSION_TODOS[session_id] = []
            _SESSION_STATUS.pop(session_id, None)

        await _emit_update(session_id)
        return {"ok": True, "cleared": True}

    # GET_CURRENT - Get the currently in-progress todo
    if action == "get_current":
        todos = _get_session_todos(session_id)
        for t in todos:
            if t.status == TodoStatus.IN_PROGRESS:
                return {"ok": True, "todo": t.to_dict()}

        return {"ok": True, "todo": None, "message": "No task in progress"}

    # GET_NEXT - Get the next pending todo
    if action == "get_next":
        todos = _get_session_todos(session_id)
        pending = [t for t in todos if t.status == TodoStatus.PENDING]

        if not pending:
            return {"ok": True, "todo": None, "message": "No pending tasks"}

        # Sort by priority (highest first)
        pending.sort(key=lambda x: -x.priority)
        return {"ok": True, "todo": pending[0].to_dict()}

    # PROGRESS - Get progress summary
    if action == "progress":
        todos = _get_session_todos(session_id)

        total = len(todos)
        completed = sum(1 for t in todos if t.status == TodoStatus.COMPLETED)
        failed = sum(1 for t in todos if t.status == TodoStatus.FAILED)
        in_progress = sum(1 for t in todos if t.status == TodoStatus.IN_PROGRESS)
        pending = sum(1 for t in todos if t.status == TodoStatus.PENDING)
        blocked = sum(1 for t in todos if t.status == TodoStatus.BLOCKED)

        percentage = round((completed / total * 100) if total > 0 else 0, 1)

        return {
            "ok": True,
            "progress": {
                "total": total,
                "completed": completed,
                "failed": failed,
                "inProgress": in_progress,
                "pending": pending,
                "blocked": blocked,
                "percentage": percentage,
            }
        }

    return {"ok": False, "error": "unknown_action"}


# Convenience function for clearing a session when conversation ends
def clear_session(session_id: str) -> None:
    """Clear all todos + status for a session. Call this when a conversation ends."""
    _SESSION_TODOS.pop(session_id, None)
    _SESSION_STATUS.pop(session_id, None)


def get_all_sessions() -> List[str]:
    """Get list of all active session IDs."""
    return list(_SESSION_TODOS.keys())


def clear_all() -> None:
    """Drop every session's todos + status. Called when the socket disconnects
    so a reconnecting client starts with a clean plan (mirrors FolderLimiter)."""
    _SESSION_TODOS.clear()
    _SESSION_STATUS.clear()
