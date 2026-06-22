"""
WebSocket endpoint for the local Stuard agent.

Message dispatch is registry-based. Each message type lives in one of two
buckets:

  * LOCAL_HANDLERS — handled inside this process (chat orchestration, local
    tool exec, approval/tool_result futures, auth, permissions).
  * FORWARDED_CONTROL_TYPES — pushed onto the active cloud control queue so
    the message lands on the in-flight cws connection mid-turn. Used for
    interjections, subagent steers, and stop/abort.

Adding a new control message that should reach cloud-ai is a one-line change:
add the type name to FORWARDED_CONTROL_TYPES (and the matching handler on
cloud-ai). No fan-out in chat.py is required.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable, Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect

from .. import permissions as vm_permissions
from ..connections import manager
from ..logging_config import get_logger
from ..tools import agent_todo as agent_todo_store
from ..tools import tasks as tasks_tools
from ..tools.folder_limiter import FolderLimiter
from .chat import handle_chat
from .session import WebSocketSession
from .tools import handle_tool_exec

logger = get_logger("agent")


# ─── Forwarding helpers ──────────────────────────────────────────────────────

# Control messages that should be transparently forwarded to the live
# cloud-ai cws connection for the active chat turn. The cloud-ai side owns
# the protocol semantics — Python is a pass-through here.
FORWARDED_CONTROL_TYPES: set[str] = {
    "interjection",
    "steer",
    "subagent_steer",
}


def _resolve_control_queue(
    session: WebSocketSession,
    request_id: Optional[str],
) -> Optional[asyncio.Queue]:
    """Find the cws control queue for a given requestId.

    Priority: exact requestId match > the single active queue if only one
    chat turn is in flight > None. The "single queue" fallback matches the
    pre-refactor behavior so steers from older clients (that omit requestId)
    keep working.
    """
    if request_id:
        queue = session.cloud_control_queues.get(request_id)
        if queue is not None:
            return queue
    if len(session.cloud_control_queues) == 1:
        return next(iter(session.cloud_control_queues.values()))
    return None


def _forward_to_cloud(msg: Dict[str, Any], session: WebSocketSession) -> bool:
    """Place a message on the active cloud control queue so chat.py's
    control_forwarder relays it over the cws.

    Returns True if a queue accepted the message.
    """
    request_id = msg.get("requestId")
    rid_str = str(request_id).strip() if isinstance(request_id, str) else ""
    queue = _resolve_control_queue(session, rid_str or None)
    if queue is None:
        return False
    payload = {k: v for k, v in msg.items() if v is not None}
    queue.put_nowait(payload)
    return True


# ─── Local handlers ──────────────────────────────────────────────────────────

HandlerFn = Callable[[Dict[str, Any], WebSocketSession], Awaitable[None]]


async def _handle_chat(msg: Dict[str, Any], session: WebSocketSession) -> None:
    request_id_raw = msg.get("requestId") or msg.get("id")
    request_id = (
        request_id_raw
        if isinstance(request_id_raw, str) and request_id_raw.strip()
        else None
    )
    task = asyncio.create_task(handle_chat(msg, session))
    session.active_chat_tasks.add(task)
    if request_id:
        session.chat_tasks_by_request_id[request_id] = task

    def _cleanup(t: asyncio.Task) -> None:
        session.active_chat_tasks.discard(t)
        if request_id and session.chat_tasks_by_request_id.get(request_id) is t:
            session.chat_tasks_by_request_id.pop(request_id, None)

    task.add_done_callback(_cleanup)


async def _handle_tool_exec(msg: Dict[str, Any], session: WebSocketSession) -> None:
    async def _run() -> None:
        try:
            await handle_tool_exec(msg, session)
        except Exception:
            logger.exception("tool_exec_task_failed")

    task = asyncio.create_task(_run())
    session.active_tool_tasks.add(task)
    task.add_done_callback(lambda t: session.active_tool_tasks.discard(t))


async def _handle_approval_response(msg: Dict[str, Any], session: WebSocketSession) -> None:
    req_id = str(msg.get("id") or "").strip()
    allow = bool(msg.get("allow"))
    fut = session.pending_approvals.get(req_id)
    if fut and not fut.done():
        fut.set_result({"allow": allow})


async def _handle_tool_result(msg: Dict[str, Any], session: WebSocketSession) -> None:
    req_id = str(msg.get("id") or "").strip()
    result = msg.get("result")
    fut = session.pending_client_tool_results.get(req_id)
    if fut and not fut.done():
        fut.set_result(result)


async def _handle_response(msg: Dict[str, Any], session: WebSocketSession) -> None:
    del session  # signature required by dispatcher; this handler is session-agnostic
    try:
        req_id = str(msg.get("id") or "").strip()
        manager.resolve_request(req_id, msg.get("data"))
    except Exception:
        pass


async def _handle_auth(msg: Dict[str, Any], session: WebSocketSession) -> None:
    del msg
    # Local agent has no auth — desktop sends auth purely so cloud-ai can
    # register webhook routing. Silent ack.
    await session.send_json({"type": "auth_result", "ok": True, "queued": 0})


async def _handle_permissions_get(msg: Dict[str, Any], session: WebSocketSession) -> None:
    del msg
    try:
        config = vm_permissions.get()
        await session.send_json({"type": "permissions", "ok": True, "config": config})
    except Exception:
        await session.send_json(
            {"type": "permissions", "ok": False, "error": "failed to read permissions"}
        )


async def _handle_permissions_update(msg: Dict[str, Any], session: WebSocketSession) -> None:
    try:
        new_config = msg.get("config") or {}
        vm_permissions.save(new_config)
        config = vm_permissions.get()
        await session.send_json({"type": "permissions", "ok": True, "config": config})
        logger.info("permissions_updated mode=%s", config.get("mode"))
    except Exception:
        logger.exception("permissions_update_error")
        await session.send_json(
            {"type": "permissions", "ok": False, "error": "failed to update permissions"}
        )


async def _handle_stop(msg: Dict[str, Any], session: WebSocketSession) -> None:
    """Cancel the active chat turn and propagate stop to cloud-ai.

    Order matters: forward to cloud-ai FIRST through the control queue so the
    cloud side can abort its in-process subagents while the cws is still
    healthy, THEN cancel local tasks. The chat task's CancelledError handler
    in chat.py acts as a fallback if the queue path didn't flush.
    """
    request_id = msg.get("requestId")
    rid_str = str(request_id).strip() if isinstance(request_id, str) else ""

    # 1) Forward stop to cloud-ai via the active control queue. Yielding to
    # the event loop gives chat.py's control_forwarder a chance to start the
    # cws.send before we cancel its parent task.
    forwarded = _forward_to_cloud(
        {"type": "stop", "requestId": rid_str or None},
        session,
    )
    if forwarded:
        await asyncio.sleep(0)

    # 2) Cancel the matching chat turn (or all turns if requestId omitted).
    cancelled_count = 0
    if rid_str:
        matched = session.chat_tasks_by_request_id.get(rid_str)
        if matched is not None and not matched.done():
            matched.cancel()
            cancelled_count += 1
    else:
        for task in list(session.active_chat_tasks):
            if not task.done():
                task.cancel()
                cancelled_count += 1
    for task in list(session.active_tool_tasks):
        if not task.done():
            task.cancel()
            cancelled_count += 1

    # 3) Cancel any pending bridge futures so awaiting coroutines don't sit
    # on a tool_result that will never arrive.
    for fut in list(session.pending_client_tool_results.values()):
        if not fut.done():
            fut.cancel()
    session.pending_client_tool_results.clear()
    for fut in list(session.pending_approvals.values()):
        if not fut.done():
            fut.cancel()
    session.pending_approvals.clear()

    logger.info(
        "stop_requested forwarded=%s cancelled=%d",
        forwarded,
        cancelled_count,
    )
    await session.send_json(
        {
            "type": "stopped",
            "success": cancelled_count > 0 or forwarded,
        },
        request_id=rid_str or None,
    )


async def _handle_forwarded(msg: Dict[str, Any], session: WebSocketSession) -> None:
    """Default forwarder for control messages bound for cloud-ai (e.g.
    interjection, subagent_steer)."""
    request_id = msg.get("requestId")
    rid_str = str(request_id).strip() if isinstance(request_id, str) else ""
    text = str(msg.get("text") or "").strip()

    forwarded = _forward_to_cloud(msg, session)
    if not forwarded:
        await session.send_json(
            {
                "type": "interjection_ack",
                "accepted": False,
                "depth": 0,
                "message": "no active cloud run",
            },
            request_id=rid_str or None,
        )
        return

    # Mirror the pre-refactor ack so existing desktop UI doesn't need changes.
    # cloud-ai also sends its own interjection_ack / subagent_steer_ack once
    # the message is drained; both arriving is OK — the desktop dedupes.
    queue = _resolve_control_queue(session, rid_str or None)
    depth = queue.qsize() if queue is not None else 0
    ack_type = (
        "subagent_steer_ack"
        if str(msg.get("type") or "").lower() == "subagent_steer"
        else "interjection_ack"
    )
    accepted = bool(text) if ack_type == "interjection_ack" else True
    await session.send_json(
        {
            "type": ack_type,
            "accepted": accepted,
            "depth": depth,
            "message": "queued for next step" if accepted else "empty interjection",
        },
        request_id=rid_str or None,
    )


LOCAL_HANDLERS: Dict[str, HandlerFn] = {
    "chat": _handle_chat,
    "tool_exec": _handle_tool_exec,
    "approval_response": _handle_approval_response,
    "tool_result": _handle_tool_result,
    "response": _handle_response,
    "auth": _handle_auth,
    "permissions_get": _handle_permissions_get,
    "permissions_update": _handle_permissions_update,
    "stop": _handle_stop,
    "abort": _handle_stop,
}


async def _dispatch(msg: Dict[str, Any], session: WebSocketSession) -> None:
    kind = str(msg.get("type") or "").lower()
    if not kind:
        await session.send_json({"type": "error", "message": "missing type"})
        return

    handler = LOCAL_HANDLERS.get(kind)
    if handler is not None:
        await handler(msg, session)
        return

    if kind in FORWARDED_CONTROL_TYPES:
        await _handle_forwarded(msg, session)
        return

    logger.warning("unknown_message_type %s", kind)
    await session.send_json({"type": "error", "message": f"unknown type: {kind}"})


# ─── Endpoint ────────────────────────────────────────────────────────────────

_ALLOWED_ORIGIN_PREFIXES = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "app://",
    "file://",
)


def _origin_allowed(origin: Optional[str]) -> bool:
    if not origin:
        return True
    if origin == "null":
        return True
    return any(origin.startswith(p) for p in _ALLOWED_ORIGIN_PREFIXES)


async def _cleanup_on_disconnect(session: WebSocketSession) -> None:
    for task in list(session.active_chat_tasks):
        try:
            task.cancel()
        except Exception:
            pass
    for task in list(session.active_tool_tasks):
        try:
            task.cancel()
        except Exception:
            pass
    for fut in list(session.pending_approvals.values()):
        if not fut.done():
            try:
                fut.cancel()
            except Exception:
                pass
    session.pending_approvals.clear()
    for fut in list(session.pending_client_tool_results.values()):
        if not fut.done():
            try:
                fut.cancel()
            except Exception:
                pass
    session.pending_client_tool_results.clear()
    for sid in list(session.folder_session_ids):
        try:
            FolderLimiter.clear_session(sid)
        except Exception:
            pass
    session.folder_session_ids.clear()
    # Drop the agent's session-scoped to-do plan + status so a reconnect starts
    # clean and a stale checklist never resurfaces.
    try:
        agent_todo_store.clear_all()
    except Exception:
        pass


async def ws_endpoint(ws: WebSocket) -> None:
    # SECURITY: only allow connections from the local Electron renderer or dev origin.
    origin = ws.headers.get("origin")
    if not _origin_allowed(origin):
        logger.warning("rejected_ws_origin origin=%s", origin)
        await ws.close(code=4003)
        return

    await manager.connect(ws)
    logger.info("ws_connected")
    await ws.send_text(
        json.dumps({"type": "handshake", "origin": "agent", "message": "connected"})
    )

    try:
        await tasks_tools.task_reminders({"action": "resume"})
    except Exception:
        pass

    session = WebSocketSession(ws)

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await session.send_json({"type": "error", "message": "invalid json"})
                continue

            try:
                await _dispatch(msg, session)
            except Exception:
                logger.exception("dispatch_failed type=%s", msg.get("type"))
                await session.send_json(
                    {"type": "error", "message": "internal dispatch error"}
                )
    except WebSocketDisconnect:
        await _cleanup_on_disconnect(session)
        await manager.disconnect(ws)
        logger.info("ws_disconnected")
