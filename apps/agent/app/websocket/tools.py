import asyncio
import json
import hashlib
from typing import Any, Dict, Optional
import websockets
from ..logging_config import get_logger
from ..tools.dispatch import execute as dispatch_execute
from .session import WebSocketSession

logger = get_logger("agent")

SENSITIVE_TOOLS = {"run_command", "run_system_command", "write_file"}
# Tools that should be executed by the Desktop client (Electron) instead of the local agent.
CLIENT_TOOLS = {
    # GenUI (handled by renderer)
    "ask_confirmation",
    "show_choices",
    "pick_date",
    "request_files",
    "show_command",
    "show_table",
    "show_info",
    "show_details",
    "show_files",
    "show_json",
    "show_link",
    "show_colors",
    "show_progress",
    "show_slider",
    "show_chart",
    # Electron-native tools (handled in main process)
    "custom_ui",
    "update_custom_ui",
    "close_custom_ui",
    "play_audio",
    "browser_get_content",
    "browser_click_element",
    "browser_type_text",
    # Canvas document tools (use desktop storage)
    "canvas_list",
    "canvas_read",
    "canvas_write",
    "canvas_create",
    "canvas_delete",
    "sidebar_canvas_list",
    "sidebar_canvas_read",
    "sidebar_canvas_write",
    "sidebar_canvas_create",
    "sidebar_canvas_delete",
    # Workflow execution tools (must run on desktop IPC)
    "invoke_workflow",
    "run_automation",
    "stop_automation",
    "stuards_run",
    "stuards_stop",
    "test_run_steps",
}
CLIENT_PREFIXES = ("terminal_",)
SENSITIVE_CLIENT_TOOLS = {
    "terminal_create",
    "terminal_send_input",
    "terminal_send_raw",
    "terminal_send_keys",
    "terminal_destroy",
}

async def handle_cloud_tool_request(
    cdata: Dict[str, Any], 
    session: WebSocketSession, 
    cws: websockets.WebSocketClientProtocol,
    request_id: Optional[str] = None
) -> None:
    try:
        raw_tool = str(cdata.get("tool") or "").strip()
        tool = raw_tool.lower().replace("-", "_")
        args = cdata.get("args") or {}
        req_id = cdata.get("id") or f"tool-{int(asyncio.get_event_loop().time()*1000)}"
        is_silent = bool(cdata.get("silent"))  # Silent tools don't show in UI
        logger.info("cloud_tool_request id=%s tool=%s silent=%s", req_id, tool, is_silent)

        async def emit(status: str, extra: Dict[str, Any] | None = None):
            tool_payload: Dict[str, Any] = {
                "type": "tool_event",
                "id": req_id,
                "tool": tool,
                "status": status,
                "toolOriginal": raw_tool,
            }
            if extra:
                tool_payload.update(extra)
            # Send to cloud (to resolve execLocalTool)
            try:
                await cws.send(json.dumps(tool_payload))
            except Exception:
                pass
            # Only mirror to desktop UI if not silent
            if not is_silent:
                try:
                    await session.progress("tool_event", tool_payload, request_id=request_id)
                except Exception:
                    pass

        await emit("started", {"args": args, "startedAtMsMono": int(asyncio.get_event_loop().time() * 1000)})

        # Approval gate for sensitive tools
        if tool in SENSITIVE_TOOLS or tool in SENSITIVE_CLIENT_TOOLS:
            try:
                safe_args = {k: v for k, v in (args or {}).items() if k in ("command", "path", "content")}
            except Exception:
                safe_args = {}
            # Use AI-provided description from args, or fallback
            description = (args or {}).get("description", "This action requires your permission.")
            await emit("approval_required", {"args": safe_args, "description": description})
            
            fut = asyncio.get_event_loop().create_future()
            session.pending_approvals[req_id] = fut
            try:
                decision = await asyncio.wait_for(fut, timeout=60.0)
            except asyncio.TimeoutError:
                result = {"ok": False, "error": "access_denied", "reason": "approval_timeout"}
                await emit("completed", {"result": result})
                try:
                    await cws.send(json.dumps({"type": "tool_result", "id": req_id, "tool": tool, "result": result}))
                except Exception:
                    pass
                session.pending_approvals.pop(req_id, None)
                return
            else:
                allowed = bool((decision or {}).get("allow"))
                if not allowed:
                    result = {"ok": False, "error": "access_denied", "denied": True}
                    await emit("completed", {"result": result})
                    try:
                        await cws.send(json.dumps({"type": "tool_result", "id": req_id, "tool": tool, "result": result}))
                    except Exception:
                        pass
                    session.pending_approvals.pop(req_id, None)
                    return
            session.pending_approvals.pop(req_id, None)

        # If this tool must run on the Desktop (Electron), forward to the connected client.
        run_on_client = (tool in CLIENT_TOOLS) or any(tool.startswith(p) for p in CLIENT_PREFIXES)
        if run_on_client:
            # Ask the desktop client to execute the tool and await the response.
            try:
                fut = asyncio.get_event_loop().create_future()
                session.pending_client_tool_results[req_id] = fut
                await session.ws.send_text(json.dumps({
                    "type": "tool_request",
                    "id": req_id,
                    "tool": tool,
                    "args": args,
                }))
                # Default 5 min timeout for client tools (interactive flows)
                result = await asyncio.wait_for(fut, timeout=300.0)
            except asyncio.TimeoutError:
                result = {"ok": False, "error": "client_tool_timeout"}
            except Exception as e:
                logger.exception("client_tool_request_error id=%s tool=%s", req_id, tool)
                result = {"ok": False, "error": str(e)}
            finally:
                session.pending_client_tool_results.pop(req_id, None)
        else:
            try:
                result = await dispatch_execute(tool, args, emit)
            except Exception as e:
                logger.exception("cloud_tool_request_error id=%s tool=%s", req_id, tool)
                result = {"ok": False, "error": str(e)}
            # Fallback: if the local agent doesn't know this tool, try the desktop client.
            if isinstance(result, dict) and str(result.get("error") or "") == "unknown_tool":
                fut = asyncio.get_event_loop().create_future()
                session.pending_client_tool_results[req_id] = fut
                try:
                    await session.ws.send_text(json.dumps({
                        "type": "tool_request",
                        "id": req_id,
                        "tool": tool,
                        "args": args,
                    }))
                    result = await asyncio.wait_for(fut, timeout=300.0)
                except Exception:
                    # Keep original unknown_tool result on failure
                    pass
                finally:
                    session.pending_client_tool_results.pop(req_id, None)

        safe_result = sanitize_result(result)
        await emit("completed", {"result": safe_result})
        try:
            await cws.send(json.dumps({"type": "tool_result", "id": req_id, "tool": tool, "result": result}))
        except Exception:
            pass
    except Exception:
        logger.exception("cloud_tool_request_unhandled")

async def handle_tool_exec(msg: Dict[str, Any], session: WebSocketSession) -> None:
    raw_tool = str(msg.get("tool") or "").strip()
    tool = raw_tool.lower().replace("-", "_")
    args = msg.get("args") or {}
    req_id = msg.get("id") or f"tool-{int(asyncio.get_event_loop().time()*1000)}"
    logger.info("tool_exec_start id=%s tool=%s", req_id, tool)

    async def emit(status: str, extra: Dict[str, Any] | None = None):
        payload = {"type": "tool_event", "id": req_id, "tool": tool, "status": status, "toolOriginal": raw_tool}
        if extra:
            payload.update(extra)
        await session.send_json(payload)

    await emit("started", {"args": args, "startedAtMsMono": int(asyncio.get_event_loop().time() * 1000)})

    try:
        async with session.tool_semaphore:
            result = await dispatch_execute(tool, args, emit)
    except Exception as e:
        logger.exception("tool_exec_error id=%s tool=%s", req_id, tool)
        result = {"ok": False, "error": str(e)}

    safe_result = sanitize_result(result)
    
    logger.info("tool_exec_complete id=%s tool=%s ok=%s", req_id, tool, isinstance(result, dict) and bool(result.get("ok")))
    await emit("completed", {"result": safe_result})
    await session.send_json({"type": "tool_result", "id": req_id, "tool": tool, "result": result})

def sanitize_result(result: Any) -> Any:
    safe_result = result
    try:
        if isinstance(result, dict) and "data" in result:
            data_val = result.get("data")
            safe = dict(result)
            if isinstance(data_val, (bytes, bytearray)):
                safe["bytes"] = len(data_val)
            elif isinstance(data_val, str):
                safe["bytes"] = len(data_val)
                try:
                    safe["sha256"] = hashlib.sha256(data_val.encode("ascii")).hexdigest()
                except Exception:
                    pass
            safe.pop("data", None)
            safe_result = safe
    except Exception:
        pass
    return safe_result
