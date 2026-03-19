from __future__ import annotations

import json
from typing import Any, Dict, Optional
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from .. import config
from ..tools import tasks as tasks_tools
from ..tools import system as system_tools
from ..tools import knowledge as knowledge_tools
from ..tools import memory_conversations as memory_tools
from ..tools import subagents
from ..tools.dispatch import execute as dispatch_tool

logger = logging.getLogger("agent")

router = APIRouter()


@router.get("/")
async def root() -> JSONResponse:
    return JSONResponse({"service": "agent", "ok": True, "mode": "bridge", "cloud": config.CLOUD_WS})


@router.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "healthy", "mode": "bridge"})


@router.post("/tools/exec")
async def http_tools_exec(payload: Dict[str, Any]) -> JSONResponse:
    """Execute a tool via HTTP. Used by desktop app for file indexing, etc."""
    try:
        tool_name = payload.get("tool")
        args = payload.get("args", {})

        if not tool_name:
            return JSONResponse({"ok": False, "error": "Missing 'tool' parameter"}, status_code=400)

        result = await dispatch_tool(tool_name, args)
        return JSONResponse(result if isinstance(result, dict) else {"ok": True, "result": result})
    except Exception as e:
        logger.exception(f"tool_exec_http_error tool={payload.get('tool')}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# Calendars API (in-memory)
@router.get("/calendars/list")
async def http_calendars_list() -> JSONResponse:
    try:
        res = await tasks_tools.calendar_crud({"action": "list"})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/calendars/create")
async def http_calendars_create(payload: Dict[str, Any]) -> JSONResponse:
    try:
        name = str(payload.get("name") or "Untitled")
        res = await tasks_tools.calendar_crud({"action": "create", "data": {"name": name}})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/calendars/update")
async def http_calendars_update(payload: Dict[str, Any]) -> JSONResponse:
    try:
        cid = str(payload.get("id") or "")
        data: Dict[str, Any] = {"id": cid}
        if "name" in payload:
            data["name"] = payload.get("name")
        res = await tasks_tools.calendar_crud({"action": "update", "data": data})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/calendars/delete")
async def http_calendars_delete(payload: Dict[str, Any]) -> JSONResponse:
    try:
        cid = str(payload.get("id") or "")
        res = await tasks_tools.calendar_crud({"action": "delete", "data": {"id": cid}})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# Tasks API (in-memory)
@router.get("/tasks/list")
async def http_tasks_list(calendarId: str | None = None) -> JSONResponse:
    try:
        data: Dict[str, Any] = {}
        if calendarId:
            data["calendarId"] = calendarId
        res = await tasks_tools.task_crud({"action": "list", "data": data})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/tasks/create")
async def http_tasks_create(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await tasks_tools.task_crud({"action": "create", "data": payload or {}})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/tasks/update")
async def http_tasks_update(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await tasks_tools.task_crud({"action": "update", "data": payload or {}})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/tasks/delete")
async def http_tasks_delete(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await tasks_tools.task_crud({"action": "delete", "data": payload or {}})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# Reminders API (in-memory)
@router.post("/reminders/schedule")
async def http_reminders_schedule(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await tasks_tools.task_reminders({
            "action": "schedule",
            "when": payload.get("when"),
            "message": payload.get("message"),
            "taskId": payload.get("taskId"),
        })
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/reminders/cancel")
async def http_reminders_cancel(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await tasks_tools.task_reminders({"action": "cancel", "id": payload.get("id")})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/reminders/update")
async def http_reminders_update(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await tasks_tools.task_reminders({
            "action": "update",
            "id": payload.get("id"),
            "taskId": payload.get("taskId"),
            "when": payload.get("when"),
            "scheduledAt": payload.get("scheduledAt"),
            "message": payload.get("message"),
            "recurrence": payload.get("recurrence"),
        })
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/reminders/delete")
async def http_reminders_delete(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await tasks_tools.task_reminders({"action": "delete", "id": payload.get("id"), "taskId": payload.get("taskId")})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/reminders/list")
async def http_reminders_list() -> JSONResponse:
    try:
        res = await tasks_tools.task_reminders({"action": "list"})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# Python runtime management API
@router.get("/runtime/python/status")
async def http_python_status() -> JSONResponse:
    try:
        res = await system_tools.python_status({})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/runtime/python/setup")
async def http_python_setup(payload: Dict[str, Any] | None = None) -> JSONResponse:
    try:
        res = await system_tools.python_setup(payload or {})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/runtime/python/install")
async def http_python_install(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await system_tools.python_install(payload or {}, None)
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/runtime/python/run")
async def http_python_run(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await system_tools.run_python_script(payload or {}, None)
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ═══════════════════════════════════════════════════════════════════════════════
# SUB-AGENT API
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/subagents/list")
async def http_subagents_list(
    parent_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50
) -> JSONResponse:
    try:
        tasks = subagents.list_subagents(parent_id=parent_id, status=status, limit=limit)
        return JSONResponse({"ok": True, "tasks": [t.to_dict() for t in tasks]})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/subagents/{task_id}")
async def http_subagents_get(task_id: str) -> JSONResponse:
    try:
        task = subagents.get_subagent(task_id)
        if not task:
            return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
        return JSONResponse({"ok": True, "task": task.to_dict()})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ═══════════════════════════════════════════════════════════════════════════════
# Knowledge Graph API
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/knowledge/stats")
async def http_knowledge_stats() -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_get_stats({})
        return JSONResponse({"ok": True, **res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/knowledge/identity")
async def http_knowledge_identity() -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_get_identity({})
        return JSONResponse({"ok": True, "facts": res if isinstance(res, list) else []})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/knowledge/directives")
async def http_knowledge_directives() -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_get_directives({})
        return JSONResponse({"ok": True, "facts": res if isinstance(res, list) else []})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/knowledge/bio")
async def http_knowledge_bio(limit: int = 50) -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_get_bio({"limit": limit})
        return JSONResponse({"ok": True, "facts": res if isinstance(res, list) else []})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/knowledge/entities")
async def http_knowledge_entities(type: Optional[str] = None, limit: int = 100) -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_list_entities({"type": type, "limit": limit})
        return JSONResponse({"ok": True, "entities": res if isinstance(res, list) else []})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/knowledge/entities")
async def http_knowledge_create_entity(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_create_entity(payload)
        return JSONResponse({"ok": True, **res} if isinstance(res, dict) else {"ok": True, "result": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/knowledge/entities/{name}")
async def http_knowledge_entity_context(name: str) -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_get_entity_context({"name": name})
        return JSONResponse({"ok": True, **res} if isinstance(res, dict) else {"ok": True, "result": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.delete("/knowledge/entities/{entity_id}")
async def http_knowledge_delete_entity(entity_id: str) -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_delete_entity({"id": entity_id})
        return JSONResponse({"ok": True, **res} if isinstance(res, dict) else {"ok": True})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/knowledge/facts")
async def http_knowledge_add_fact(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_add_fact(payload)
        return JSONResponse({"ok": True, **res} if isinstance(res, dict) else {"ok": True, "result": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.delete("/knowledge/facts/{fact_id}")
async def http_knowledge_delete_fact(fact_id: str) -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_invalidate_fact({"id": fact_id})
        return JSONResponse({"ok": True, **res} if isinstance(res, dict) else {"ok": True})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/knowledge/instructions")
async def http_knowledge_add_instruction(payload: Dict[str, Any]) -> JSONResponse:
    try:
        text = payload.get("text", "")
        res = await knowledge_tools.knowledge_add_fact({
            "category": "instruction",
            "subtype": "system",
            "text": text,
            "source": "user_manual",
        })
        return JSONResponse({"ok": True, **res} if isinstance(res, dict) else {"ok": True, "result": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/knowledge/events")
async def http_knowledge_events(limit: int = 100) -> JSONResponse:
    try:
        from ..storage import knowledge_db
        facts = knowledge_db.get_event_history(limit=limit)
        return JSONResponse({"ok": True, "facts": [f.__dict__ for f in facts] if facts else []})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/knowledge/graph")
async def http_knowledge_graph(limit: int = 100, threshold: float = 0.7) -> JSONResponse:
    try:
        res = await knowledge_tools.knowledge_get_graph({"limit": limit, "threshold": threshold})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e), "nodes": [], "edges": []}, status_code=500)


# ═══════════════════════════════════════════════════════════════════════════════
# MEMORY API (Local encrypted conversation storage)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/memory/security")
async def http_memory_security_get() -> JSONResponse:
    try:
        res = await memory_tools.security_get_settings({})
        return JSONResponse({"ok": True, "settings": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.patch("/memory/security")
async def http_memory_security_update(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await memory_tools.security_update_settings(payload)
        return JSONResponse({"ok": res.get("ok", True)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/memory/security/password")
async def http_memory_set_password(payload: Dict[str, Any]) -> JSONResponse:
    try:
        password = payload.get("password", "")
        current = payload.get("current_password")
        res = await memory_tools.security_set_password({"password": password, "current_password": current})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/memory/security/verify")
async def http_memory_verify_password(payload: Dict[str, Any]) -> JSONResponse:
    try:
        password = payload.get("password", "")
        res = await memory_tools.security_verify_password({"password": password})
        return JSONResponse({"ok": True, "valid": res.get("valid", False)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/memory/stats")
async def http_memory_stats() -> JSONResponse:
    try:
        res = await memory_tools.memory_stats({})
        return JSONResponse({"ok": True, "stats": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/memory/conversations")
async def http_memory_conversations_list(status: str | None = None, limit: int = 50, offset: int = 0, source: str | None = None) -> JSONResponse:
    try:
        params: Dict[str, Any] = {"limit": limit, "offset": offset}
        if status:
            params["status"] = status
        if source:
            params["source"] = source
        res = await memory_tools.conversation_list(params)
        return JSONResponse({"ok": True, "conversations": res.get("conversations", [])})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/memory/conversations")
async def http_memory_conversation_create(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await memory_tools.conversation_create(payload)
        return JSONResponse({"ok": True, "conversation": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


        return JSONResponse({"ok": True, "conversation": res.get("conversation")})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/memory/conversations/{conversation_id}")
async def http_memory_conversation_get(conversation_id: str) -> JSONResponse:
    try:
        res = await memory_tools.conversation_get({"conversation_id": conversation_id})
        if not res.get("ok"):
            return JSONResponse({"ok": False, "error": res.get("error", "not_found")}, status_code=404)
        return JSONResponse({"ok": True, "conversation": res.get("conversation")})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.patch("/memory/conversations/{conversation_id}")
async def http_memory_conversation_update(conversation_id: str, payload: Dict[str, Any]) -> JSONResponse:
    try:
        payload["conversation_id"] = conversation_id
        res = await memory_tools.conversation_update(payload)
        if not res.get("ok"):
            return JSONResponse({"ok": False, "error": res.get("error", "update_failed")}, status_code=400)
        return JSONResponse({"ok": True, "conversation": res.get("conversation")})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.delete("/memory/conversations/{conversation_id}")
async def http_memory_conversation_delete(conversation_id: str) -> JSONResponse:
    try:
        res = await memory_tools.conversation_delete({"conversation_id": conversation_id})
        if not res.get("ok"):
            return JSONResponse({"ok": False, "error": res.get("error", "delete_failed")}, status_code=400)
        return JSONResponse({"ok": True, "deleted": res.get("deleted", False)})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/memory/conversations/{conversation_id}/messages")
async def http_memory_messages_list(conversation_id: str, limit: int | None = None) -> JSONResponse:
    try:
        params: Dict[str, Any] = {"conversation_id": conversation_id}
        if limit:
            params["limit"] = limit
        res = await memory_tools.message_list(params)
        return JSONResponse({"ok": True, "messages": res.get("messages", [])})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/memory/spaces")
async def http_memory_spaces_list(type: str | None = None, limit: int = 50) -> JSONResponse:
    try:
        params: Dict[str, Any] = {"limit": limit}
        if type:
            params["type"] = type
        res = await memory_tools.space_list(params)
        return JSONResponse({"ok": True, "spaces": res.get("spaces", [])})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/memory/spaces")
async def http_memory_space_create(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await memory_tools.space_create(payload)
        return JSONResponse({"ok": True, "space": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/memory/spaces/{space_id}")
async def http_memory_space_get(space_id: str) -> JSONResponse:
    try:
        res = await memory_tools.space_get({"space_id": space_id})
        if not res:
            return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
        return JSONResponse({"ok": True, "space": res})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.get("/memory/spaces/{space_id}/items")
async def http_memory_space_items_list(space_id: str, type: str | None = None, limit: int = 100) -> JSONResponse:
    try:
        params: Dict[str, Any] = {"space_id": space_id, "limit": limit}
        if type:
            params["type"] = type
        res = await memory_tools.space_item_list(params)
        return JSONResponse({"ok": True, "items": res.get("items", [])})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Folder Permissions (session-scoped) ────────────────────────────────

from ..tools import folder_limiter as _fl


@router.get("/folder-permissions")
async def http_folder_permissions_list(session_id: str = "default") -> JSONResponse:
    try:
        res = await _fl.folder_permission_list({"session_id": session_id})
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/folder-permissions/add")
async def http_folder_permissions_add(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await _fl.folder_permission_add(payload)
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/folder-permissions/remove")
async def http_folder_permissions_remove(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await _fl.folder_permission_remove(payload)
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/folder-permissions/set-enabled")
async def http_folder_permissions_set_enabled(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await _fl.folder_permission_set_enabled(payload)
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/folder-permissions/check")
async def http_folder_permissions_check(payload: Dict[str, Any]) -> JSONResponse:
    try:
        res = await _fl.folder_permission_check(payload)
        return JSONResponse(res)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/folder-permissions/clear-session")
async def http_folder_permissions_clear_session(payload: Dict[str, Any]) -> JSONResponse:
    """Clear all folder permission rules for a session (called when a tab closes)."""
    try:
        sid = str(payload.get("session_id") or "").strip()
        if not sid:
            return JSONResponse({"ok": False, "error": "missing session_id"}, status_code=400)
        _fl.FolderLimiter.clear_session(sid)
        return JSONResponse({"ok": True, "cleared": sid})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
