import asyncio
import json
import hashlib
import os
from typing import Any, Dict, Optional
import websockets
from ..logging_config import get_logger
from ..permissions import is_auto_approved as _is_auto_approved
from ..tool_approval import run_command_requires_approval, terminal_tool_requires_approval
from .session import WebSocketSession
from ..tools.folder_limiter import current_session_id as _folder_session_ctx

# ── VM mode: use slim dispatch that excludes desktop-only modules ────────────
if os.environ.get("STUARD_AGENT_MODE") == "vm":
    from ..tools.dispatch_vm import execute as dispatch_execute
else:
    from ..tools.dispatch import execute as dispatch_execute

logger = get_logger("agent")

SENSITIVE_TOOLS = {"write_file"}
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
    # Workflow execution tools (must run on desktop IPC)
    "invoke_workflow",
    "run_automation",
    "stop_automation",
    "stuards_run",
    "stuards_stop",
    "test_run_steps",
    # Proactive task board tools (desktop-backed)
    "proactive_task_list",
    "proactive_task_update",
    "proactive_task_create",
}
# On VM, browser_use_* tools are handled locally (headless) — not forwarded to desktop
_IS_VM = os.environ.get("STUARD_AGENT_MODE") == "vm"
CLIENT_PREFIXES = ("terminal_",) if _IS_VM else ("terminal_", "browser_use_")
def _tool_requires_approval(tool: str, args: Optional[Dict[str, Any]] = None) -> bool:
    if tool == "run_command":
        return run_command_requires_approval(args)
    if terminal_tool_requires_approval(tool, args):
        return True
    return tool in SENSITIVE_TOOLS

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
            if status == "delta" and extra and "text" in extra:
                if not is_silent:
                    await session.progress("delta", {"text": extra["text"]}, request_id=request_id)
                return

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

        # Approval gate for sensitive tools (skip if auto-approved by VM permissions)
        if _tool_requires_approval(tool, args) and not _is_auto_approved(tool):
            try:
                safe_args = {k: v for k, v in (args or {}).items() if k in ("command", "path", "content", "isPermissionRequired")}
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

        # Set the folder-limiter session context from args (injected by the frontend)
        _session_id = str(args.get("session_id") or args.get("sessionId") or "default")
        _folder_session_ctx.set(_session_id)
        session.folder_session_ids.add(_session_id)

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
                # browser_use_task can take up to 10 min; others default to 5 min
                client_timeout = 660.0 if tool == "browser_use_task" else 300.0
                result = await asyncio.wait_for(fut, timeout=client_timeout)
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
        if status == "delta" and extra and "text" in extra:
            await session.progress("delta", {"text": extra["text"]})
            return

        payload = {"type": "tool_event", "id": req_id, "tool": tool, "status": status, "toolOriginal": raw_tool}
        if extra:
            # Avoid overwriting critical envelope keys
            for k in ("type", "id", "tool", "status", "toolOriginal"):
                extra.pop(k, None)
            payload.update(extra)
        await session.send_json(payload)

    result: Dict[str, Any] = {"ok": False, "error": "tool_exec_never_completed"}
    try:
        await emit("started", {"args": args, "startedAtMsMono": int(asyncio.get_event_loop().time() * 1000)})

        # Approval gate (same logic as handle_cloud_tool_request)
        if _tool_requires_approval(tool, args) and not _is_auto_approved(tool):
            try:
                safe_args = {k: v for k, v in (args or {}).items() if k in ("command", "path", "content", "isPermissionRequired")}
            except Exception:
                safe_args = {}
            description = (args or {}).get("description", "This action requires your permission.")
            await emit("approval_required", {"args": safe_args, "description": description})

            fut = asyncio.get_event_loop().create_future()
            session.pending_approvals[req_id] = fut
            try:
                decision = await asyncio.wait_for(fut, timeout=60.0)
            except asyncio.TimeoutError:
                result = {"ok": False, "error": "access_denied", "reason": "approval_timeout"}
                await emit("completed", {"result": result})
                session.pending_approvals.pop(req_id, None)
                return
            else:
                allowed = bool((decision or {}).get("allow"))
                if not allowed:
                    result = {"ok": False, "error": "access_denied", "denied": True}
                    await emit("completed", {"result": result})
                    session.pending_approvals.pop(req_id, None)
                    return
            session.pending_approvals.pop(req_id, None)

        # Set the folder-limiter session context from args
        _session_id = str(args.get("session_id") or args.get("sessionId") or "default")
        _folder_session_ctx.set(_session_id)
        session.folder_session_ids.add(_session_id)

        try:
            if tool.startswith("stream_"):
                # Stream tools (especially stream_read) can block waiting for data.
                # Bypassing the semaphore prevents them from starving other tools.
                result = await dispatch_execute(tool, args, emit)
            else:
                async with session.tool_semaphore:
                    result = await dispatch_execute(tool, args, emit)
        except Exception as e:
            logger.exception("tool_exec_error id=%s tool=%s", req_id, tool)
            result = {"ok": False, "error": str(e)}

        safe_result = sanitize_result(result)
        logger.info("tool_exec_complete id=%s tool=%s ok=%s", req_id, tool, isinstance(result, dict) and bool(result.get("ok")))
        try:
            await emit("completed", {"result": safe_result})
        except Exception:
            logger.exception("tool_exec_emit_completed_failed id=%s tool=%s", req_id, tool)
    finally:
        # ALWAYS send tool_result so the desktop side never hangs waiting
        try:
            await session.send_json({"type": "tool_result", "id": req_id, "tool": tool, "result": result})
        except Exception:
            logger.exception("tool_exec_send_result_failed id=%s tool=%s", req_id, tool)

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

