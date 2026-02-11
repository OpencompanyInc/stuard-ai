import asyncio
import json
import websockets
from typing import Any, Dict, Optional
from ..logging_config import get_logger
from ..config import CLOUD_WS
from .session import WebSocketSession

logger = get_logger("agent")

async def handle_chat(msg: Dict[str, Any], session: WebSocketSession) -> None:
    request_id = msg.get("requestId")
    if not isinstance(request_id, str) or not request_id.strip():
        request_id = None

    text = str(msg.get("text") or "").strip()
    context = msg.get("context") or {}
    attachments = msg.get("attachments") or []
    model = msg.get("model")
    model_id = msg.get("modelId")
    model_config = msg.get("modelConfig")
    auth = msg.get("auth") or None
    messages = msg.get("messages") or None
    memory = msg.get("memory") or None

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
                    # We need to pass cws to handle_cloud_tool_request to send results back to cloud
                    await handle_cloud_tool_request(cdata, session, cws, request_id=rid)

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

