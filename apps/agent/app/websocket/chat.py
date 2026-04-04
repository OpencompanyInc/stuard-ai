import asyncio
import json
import os
import websockets
from typing import Any, Dict, List, Optional
from ..logging_config import get_logger
from ..config import CLOUD_WS
from .session import WebSocketSession

logger = get_logger("agent")

_IS_VM = os.environ.get("STUARD_AGENT_MODE") == "vm"


def _get_vm_client_integrations() -> List[str]:
    """Return the list of locally-available integrations on this VM.

    On a VM, browser_use runs headlessly via browser_use_server.py,
    terminal is always available, and telnyx/whatsapp are handled by
    cloud-ai but we still report them so tool selection includes them.
    """
    if not _IS_VM:
        return []
    integrations = ["browser_use", "telnyx"]
    # Check for optional integrations that may be installed
    try:
        import aiohttp  # noqa: F401 — presence means browser_use_server deps available
    except ImportError:
        # browser_use_server.py not installed — remove from list
        integrations = [i for i in integrations if i != "browser_use"]
    return integrations

async def handle_chat(msg: Dict[str, Any], session: WebSocketSession) -> None:
    request_id = msg.get("requestId") or msg.get("id")
    if not isinstance(request_id, str) or not request_id.strip():
        request_id = None

    text = str(msg.get("text") or msg.get("message") or "").strip()
    context = msg.get("context") or {}
    attachments = msg.get("attachments") or []
    model = msg.get("model")
    model_id = msg.get("modelId")
    model_config = msg.get("modelConfig")
    auth = msg.get("auth") or None
    messages = msg.get("messages") or None
    memory = msg.get("memory") or None
    hidden_context = msg.get("hiddenContext") or None
    hidden_state_summary = msg.get("hiddenStateSummary") or None

    # Merge memoryContext (built by Node vm-agent from local knowledge DB)
    # into hiddenContext so cloud-ai injects it into the system prompt.
    memory_context = msg.get("memoryContext") or None
    if isinstance(memory_context, str) and memory_context.strip():
        if isinstance(hidden_context, str) and hidden_context.strip():
            hidden_context = memory_context.strip() + "\n\n" + hidden_context.strip()
        else:
            hidden_context = memory_context.strip()

    try:
        # Increase max_size to avoid 1 MiB default limit (1009 errors) when receiving tool events
        ws_url = CLOUD_WS if CLOUD_WS.endswith("/ws") else (CLOUD_WS.rstrip("/") + "/ws")
        logger.info("cloud_connect url=%s", ws_url)

        async with websockets.connect(ws_url, max_size=None) as cws:
            payload: Dict[str, Any] = {
                "type": "chat",
                "text": text,
                "context": context,
                "attachments": attachments,
            }
            # On VM, report locally-available integrations so cloud-ai
            # includes browser_use / telnyx / etc. in tool selection
            vm_integrations = _get_vm_client_integrations()
            if vm_integrations:
                payload["clientIntegrations"] = vm_integrations
            # Also merge any client-reported integrations from the original message
            msg_ci = msg.get("clientIntegrations")
            if isinstance(msg_ci, list) and msg_ci:
                existing = set(payload.get("clientIntegrations") or [])
                merged = list(existing)
                for ci in msg_ci:
                    if isinstance(ci, str) and ci not in existing:
                        merged.append(ci)
                        existing.add(ci)
                if merged:
                    payload["clientIntegrations"] = merged
            if isinstance(model, str) and model.strip():
                payload["model"] = model.strip()
            if isinstance(model_id, str) and model_id.strip():
                payload["modelId"] = model_id.strip()
            if isinstance(model_config, dict) and model_config:
                payload["modelConfig"] = model_config
            if request_id:
                payload["requestId"] = request_id

            cid = msg.get("conversationId")
            if isinstance(cid, str) and cid.strip():
                payload["conversationId"] = cid.strip()
            if "resetConversation" in msg:
                try:
                    payload["resetConversation"] = bool(msg.get("resetConversation"))
                except Exception:
                    pass
            if auth is not None:
                payload["auth"] = auth
            if isinstance(messages, list):
                payload["messages"] = messages
            if isinstance(memory, dict):
                payload["memory"] = memory
            if isinstance(hidden_context, str) and hidden_context.strip():
                payload["hiddenContext"] = hidden_context
            if isinstance(hidden_state_summary, dict):
                payload["hiddenStateSummary"] = hidden_state_summary

            await cws.send(json.dumps(payload))

            conversation_seen = False
            final_seen = False
            while True:
                try:
                    if final_seen:
                        cloud_msg = await asyncio.wait_for(cws.recv(), timeout=20.0)
                    else:
                        cloud_msg = await cws.recv()
                except asyncio.CancelledError:
                    # Forward stop to cloud AI before exiting
                    try:
                        await cws.send(json.dumps({"type": "stop"}))
                    except Exception:
                        pass
                    raise
                except asyncio.TimeoutError:
                    break
                except Exception:
                    break

                try:
                    cdata = json.loads(cloud_msg)
                except Exception:
                    continue

                ctype = str(cdata.get("type") or "").lower()
                rid = cdata.get("requestId") if isinstance(cdata.get("requestId"), str) else request_id

                if ctype == "routing":
                    logger.info("cloud_routing model=%s", cdata.get("model"))
                    await session.progress("routing", {"model": cdata.get("model")}, request_id=rid)

                elif ctype == "delta":
                    await session.progress("delta", {"text": cdata.get("delta")}, request_id=rid)

                elif ctype == "progress":
                    ev = str((cdata.get("event") or "")).strip()
                    data = cdata.get("data") or {}
                    await session.progress(ev or "progress", data if isinstance(data, dict) else {"value": data}, request_id=rid)

                elif ctype == "conversation":
                    cid2 = cdata.get("conversationId")
                    if cid2:
                        conversation_seen = True
                        await session.send_json({"type": "conversation", "conversationId": cid2}, request_id=rid)

                elif ctype == "title":
                    cid2 = cdata.get("conversationId")
                    title = cdata.get("title")
                    if cid2 and title:
                        await session.send_json({"type": "title", "conversationId": cid2, "title": title}, request_id=rid)
                        if final_seen:
                            break

                elif ctype == "tool_request":
                    from .tools import handle_cloud_tool_request
                    # Spawn as concurrent task so multiple tool_requests run in parallel
                    # (cloud-ai fires them via Promise.all but this loop is sequential)
                    tool_task = asyncio.create_task(
                        handle_cloud_tool_request(cdata, session, cws, request_id=rid)
                    )
                    session.active_tool_tasks.add(tool_task)
                    def _cleanup_tool(_t: asyncio.Task) -> None:
                        try:
                            session.active_tool_tasks.discard(_t)
                        except Exception:
                            pass
                    try:
                        tool_task.add_done_callback(_cleanup_tool)
                    except Exception:
                        pass

                elif ctype == "final":
                    logger.info("cloud_final model=%s", cdata.get("model"))
                    result = cdata.get("result") or {}
                    model = cdata.get("model")
                    out: Dict[str, Any] = {
                        "type": "final",
                        "origin": "agent",
                        "result": result,
                    }
                    cid2 = cdata.get("conversationId")
                    if cid2:
                        out["conversationId"] = cid2
                    if model:
                        out["model"] = model
                    await session.send_json(out, request_id=rid)
                    if conversation_seen:
                        final_seen = True
                        continue
                    break

                elif ctype == "tool_event":
                    evt = dict(cdata)
                    evt.pop("type", None)
                    await session.progress("tool_event", evt, request_id=rid)

                elif ctype in ("subagent_event", "subagent_question", "subagent_answer", "subagent_complete"):
                    # Relay subagent protocol messages to the desktop client.
                    # The desktop UI uses these for richer task lifecycle updates.
                    payload = dict(cdata)
                    payload["type"] = ctype
                    await session.send_json(payload, request_id=rid)

                elif ctype == "error":
                    logger.warning("cloud_error message=%s", cdata.get("message"))
                    await session.send_json({"type": "error", "message": cdata.get("message") or "cloud error"}, request_id=rid)
                    break

    except asyncio.CancelledError:
        # Task was cancelled (user pressed stop button)
        logger.info("chat_cancelled_by_user")
        await session.send_json({
            "type": "final",
            "origin": "agent",
            "result": {"text": "", "finishReason": "aborted"},
            "aborted": True
        }, request_id=request_id)
        raise

    except Exception as e:
        logger.exception("cloud_bridge_failed")
        await session.send_json({"type": "error", "message": f"cloud bridge failed: {e}"}, request_id=request_id)

