import json
import asyncio
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, Any

from ..logging_config import get_logger
from ..connections import manager
from .session import WebSocketSession
from .chat import handle_chat
from .tools import handle_tool_exec
from ..tools import tasks as tasks_tools

logger = get_logger("agent")

async def ws_endpoint(ws: WebSocket) -> None:
    # SECURITY: Check Origin header to prevent CSRF from malicious websites
    # Browsers send Origin for cross-site requests. Local Electron app might send none or specific one.
    origin = ws.headers.get("origin")
    if origin:
        allowed_origins = [
            "http://localhost:5173", 
            "http://127.0.0.1:5173", 
            "app://",
            "file://"
        ]
        # Check if origin starts with any allowed prefix (for file:// which might vary)
        if not any(origin.startswith(p) or origin == "null" for p in allowed_origins):
            logger.warning("rejected_ws_origin origin=%s", origin)
            await ws.close(code=4003)
            return

    await manager.connect(ws)
    logger.info("ws_connected")
    await ws.send_text(json.dumps({
        "type": "handshake",
        "origin": "agent",
        "message": "connected",
    }))

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

            kind = (msg.get("type") or "").lower()
            logger.info("ws_message kind=%s", kind)
            
            if kind == "chat":
                t = asyncio.create_task(handle_chat(msg, session))
                session.active_chat_tasks.add(t)
                def _cleanup(_t: asyncio.Task) -> None:
                    try:
                        session.active_chat_tasks.discard(_t)
                    except Exception:
                        pass
                try:
                    t.add_done_callback(_cleanup)
                except Exception:
                    pass
                continue
                
            elif kind == "tool_exec":
                msg_for_task = msg

                async def _run_tool_exec(msg_local: Dict[str, Any] = msg_for_task) -> None:
                    try:
                        await handle_tool_exec(msg_local, session)
                    except Exception:
                        logger.exception("tool_exec_task_failed")

                t = asyncio.create_task(_run_tool_exec())
                session.active_tool_tasks.add(t)
                def _cleanup_tool(_t: asyncio.Task) -> None:
                    try:
                        session.active_tool_tasks.discard(_t)
                    except Exception:
                        pass
                try:
                    t.add_done_callback(_cleanup_tool)
                except Exception:
                    pass
                continue
                
            elif kind == "approval_response":
                # Desktop UI responded to an approval request
                try:
                    req_id = str(msg.get("id") or "").strip()
                    allow = bool(msg.get("allow"))
                    fut = session.pending_approvals.get(req_id)
                    if fut and not fut.done():
                        fut.set_result({"allow": allow})
                except Exception:
                    pass
                    
            elif kind == "tool_result":
                # Desktop client responded to a forwarded tool_request
                try:
                    req_id = str(msg.get("id") or "").strip()
                    result = msg.get("result")
                    fut = session.pending_client_tool_results.get(req_id)
                    if fut and not fut.done():
                        fut.set_result(result)
                except Exception:
                    pass

            elif kind == "response":
                try:
                    req_id = str(msg.get("id") or "").strip()
                    data = msg.get("data")
                    manager.resolve_request(req_id, data)
                except Exception:
                    pass

            elif kind == "stop" or kind == "abort":
                # Cancel all active chat tasks to stop streaming
                cancelled_count = 0
                for task in list(session.active_chat_tasks):
                    try:
                        if not task.done():
                            task.cancel()
                            cancelled_count += 1
                    except Exception:
                        pass
                logger.info("stop_requested cancelled=%d", cancelled_count)
                await session.send_json({"type": "stopped", "success": cancelled_count > 0})

            else:
                logger.warning("unknown_message_type %s", kind)
                await session.send_json({"type": "error", "message": f"unknown type: {kind}"})
                
    except WebSocketDisconnect:
        try:
            for t in list(session.active_chat_tasks):
                try:
                    t.cancel()
                except Exception:
                    pass
            for t in list(session.active_tool_tasks):
                try:
                    t.cancel()
                except Exception:
                    pass
        except Exception:
            pass
        await manager.disconnect(ws)
        logger.info("ws_disconnected")

