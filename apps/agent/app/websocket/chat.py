"""
Chat orchestration: desktop -> local Python agent -> cloud-ai.

Per-chat lifecycle:
  1. Build the cloud payload from the desktop msg (pass-through + a few
     transformations).
  2. Open a fresh cws connection to cloud-ai. Register a control_queue on
     the session keyed by requestId so handler.py can route mid-turn
     control messages (interjection, subagent_steer, stop) to this exact
     cws via the control_forwarder task.
  3. Stream events back to the desktop session. Tool requests fan out to
     parallel local tool tasks; the cws_lock serializes cws.send so
     `websockets >= 12` doesn't raise ConcurrencyError on parallel writes.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Awaitable, Callable, Dict, List, Optional, TypeAlias  # noqa: F401  # pyright: ignore[reportUnusedImport]

import websockets

from ..config import CLOUD_WS
from ..logging_config import get_logger
from .session import WebSocketSession

logger = get_logger("agent")

_IS_VM = os.environ.get("STUARD_AGENT_MODE") == "vm"

# Fields read from the desktop msg envelope that should NOT be forwarded as
# top-level keys to cloud-ai. `id` is the desktop's local message id (used
# only for ack correlation between desktop ↔ python). Everything else is
# passed through, so adding a new chat field on desktop + cloud-ai is a
# two-place change, not three.
_PASSTHROUGH_DROP = {"id"}


def _get_vm_client_integrations() -> List[str]:
    """Return the list of locally-available integrations on this VM.

    On a VM, browser_use runs headlessly via browser_use_server.py,
    terminal is always available, and telnyx/whatsapp are handled by
    cloud-ai but we still report them so tool selection includes them.
    """
    if not _IS_VM:
        return []
    integrations = ["browser_use", "telnyx", "whatsapp"]
    try:
        import aiohttp  # pyright: ignore[reportUnusedImport]
        _ = aiohttp  # presence-only probe; browser_use_server.py needs it
    except ImportError:
        integrations = [i for i in integrations if i != "browser_use"]
    return integrations


def _merge_memory_context(payload: Dict[str, Any]) -> None:
    """Fold `memoryContext` (built by the Node vm-agent from local knowledge)
    into `hiddenContext` so cloud-ai injects it into the system prompt.
    """
    memory_context = payload.pop("memoryContext", None)
    if not isinstance(memory_context, str) or not memory_context.strip():
        return
    existing = payload.get("hiddenContext")
    if isinstance(existing, str) and existing.strip():
        payload["hiddenContext"] = memory_context.strip() + "\n\n" + existing.strip()
    else:
        payload["hiddenContext"] = memory_context.strip()


def _merge_vm_integrations(payload: Dict[str, Any]) -> None:
    """Union the locally-detected VM integrations with any client-supplied
    `clientIntegrations` list. No-op when not running in VM mode."""
    vm_integrations = _get_vm_client_integrations()
    incoming = payload.get("clientIntegrations") or []
    if not isinstance(incoming, list):
        incoming = []

    seen: set[str] = set()
    merged: List[str] = []
    for ci in [*vm_integrations, *incoming]:
        if isinstance(ci, str) and ci and ci not in seen:
            seen.add(ci)
            merged.append(ci)
    if merged:
        payload["clientIntegrations"] = merged
    elif "clientIntegrations" in payload and not payload["clientIntegrations"]:
        # don't forward an empty list — old contracts expected omission
        payload.pop("clientIntegrations", None)


def _build_cloud_payload(msg: Dict[str, Any], request_id: Optional[str]) -> Dict[str, Any]:
    """Pass-through copy of the desktop chat envelope with cloud-ai-specific
    transformations applied.

    Pre-refactor this was an explicit whitelist that silently dropped any
    unknown field — every new chat feature required a Python proxy edit or
    it would break in mysterious ways. The pass-through keeps the proxy out
    of the way of cloud-ai protocol changes.
    """
    payload: Dict[str, Any] = {}
    for k, v in msg.items():
        if k in _PASSTHROUGH_DROP:
            continue
        if v is None:
            continue
        payload[k] = v

    # Normalize: text may arrive as `message`; cloud-ai only reads `text`.
    if "text" not in payload:
        msg_text = msg.get("message")
        if isinstance(msg_text, str) and msg_text.strip():
            payload["text"] = msg_text.strip()

    # Trim text — pre-refactor stripped whitespace; preserve that behavior.
    if isinstance(payload.get("text"), str):
        payload["text"] = payload["text"].strip()

    payload["type"] = "chat"
    if request_id:
        payload["requestId"] = request_id

    _merge_memory_context(payload)
    _merge_vm_integrations(payload)
    return payload


async def _control_forwarder(
    control_queue: asyncio.Queue,
    cws: Any,
    cws_lock: asyncio.Lock,
    request_id: Optional[str],
) -> None:
    """Drain the control queue and forward to cloud-ai.

    handler.py pushes interjection / subagent_steer / stop onto this queue.
    Each is sent verbatim over the same cws as the main chat stream.
    """
    while True:
        control_msg = await control_queue.get()
        if not isinstance(control_msg, dict):
            continue
        outgoing = {k: v for k, v in control_msg.items() if v is not None}
        if not outgoing.get("requestId") and request_id:
            outgoing["requestId"] = request_id
        try:
            async with cws_lock:
                await cws.send(json.dumps(outgoing))
        except Exception:
            logger.warning("control_forward_failed type=%s", outgoing.get("type"))


def _resolve_cloud_ws_url() -> str:
    base = CLOUD_WS if CLOUD_WS.endswith("/ws") else (CLOUD_WS.rstrip("/") + "/ws")
    if _IS_VM:
        sep = "&" if "?" in base else "?"
        base = base + sep + "client=vm-agent"
    return base


# ─── Cloud message handlers ──────────────────────────────────────────────────


class ChatRunState:
    """Mutable state shared across cloud event handlers for a single turn."""

    __slots__ = ("conversation_seen", "final_seen")

    def __init__(self) -> None:
        self.conversation_seen = False
        self.final_seen = False


class _CloudEventCtx:
    """Per-event context passed to every cloud handler. Handlers ignore the
    fields they don't need; using a single object keeps the dispatcher
    signature stable as we add fields."""

    __slots__ = ("session", "cws", "cws_lock", "rid", "state")

    def __init__(
        self,
        session: WebSocketSession,
        cws: Any,
        cws_lock: asyncio.Lock,
        rid: Optional[str],
        state: "ChatRunState",
    ) -> None:
        self.session = session
        self.cws = cws
        self.cws_lock = cws_lock
        self.rid = rid
        self.state = state


CloudHandlerFn: TypeAlias = Callable[[Dict[str, Any], _CloudEventCtx], Awaitable[None]]


async def _on_routing(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    logger.info("cloud_routing model=%s", cdata.get("model"))
    await ctx.session.progress("routing", {"model": cdata.get("model")}, request_id=ctx.rid)


async def _on_delta(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    await ctx.session.progress("delta", {"text": cdata.get("delta")}, request_id=ctx.rid)


async def _on_progress(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    ev = str(cdata.get("event") or "").strip()
    data = cdata.get("data") or {}
    payload = data if isinstance(data, dict) else {"value": data}
    await ctx.session.progress(ev or "progress", payload, request_id=ctx.rid)


async def _on_conversation(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    cid = cdata.get("conversationId")
    if cid:
        ctx.state.conversation_seen = True
        await ctx.session.send_json(
            {"type": "conversation", "conversationId": cid}, request_id=ctx.rid
        )


async def _on_title(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    cid = cdata.get("conversationId")
    title = cdata.get("title")
    if cid and title:
        title_str = str(title).strip()
        if title_str:
            try:
                from ..tools import memory_conversations as memory_tools

                await memory_tools.conversation_update({
                    "conversation_id": cid,
                    "title": title_str,
                })
            except Exception:
                logger.warning("title_persist_failed conversation_id=%s", cid)
        await ctx.session.send_json(
            {"type": "title", "conversationId": cid, "title": title},
            request_id=ctx.rid,
        )


async def _on_tool_request(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    from .tools import handle_cloud_tool_request

    tool_task = asyncio.create_task(
        handle_cloud_tool_request(
            cdata, ctx.session, ctx.cws, request_id=ctx.rid, cws_lock=ctx.cws_lock
        )
    )
    ctx.session.active_tool_tasks.add(tool_task)
    tool_task.add_done_callback(lambda t: ctx.session.active_tool_tasks.discard(t))


async def _on_final(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    logger.info("cloud_final model=%s", cdata.get("model"))
    out: Dict[str, Any] = {
        "type": "final",
        "origin": "agent",
        "result": cdata.get("result") or {},
    }
    cid = cdata.get("conversationId")
    if cid:
        out["conversationId"] = cid
    model = cdata.get("model")
    if model:
        out["model"] = model
    await ctx.session.send_json(out, request_id=ctx.rid)
    if ctx.state.conversation_seen:
        ctx.state.final_seen = True


async def _on_tool_event(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    evt = dict(cdata)
    evt.pop("type", None)
    await ctx.session.progress("tool_event", evt, request_id=ctx.rid)


async def _on_subagent(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    # Relay subagent protocol messages to the desktop. The desktop UI uses
    # these for delegation cards, mid-flight steer acks, and lifecycle.
    payload = dict(cdata)
    payload["type"] = str(cdata.get("type") or "").lower()
    await ctx.session.send_json(payload, request_id=ctx.rid)


async def _on_error(cdata: Dict[str, Any], ctx: _CloudEventCtx) -> None:
    msg = cdata.get("message") or "cloud error"
    logger.warning("cloud_error message=%s", msg)
    await ctx.session.send_json({"type": "error", "message": msg}, request_id=ctx.rid)


_CLOUD_HANDLERS: Dict[str, CloudHandlerFn] = {
    "routing": _on_routing,
    "delta": _on_delta,
    "progress": _on_progress,
    "conversation": _on_conversation,
    "title": _on_title,
    "tool_request": _on_tool_request,
    "final": _on_final,
    "tool_event": _on_tool_event,
    "subagent_event": _on_subagent,
    "subagent_question": _on_subagent,
    "subagent_answer": _on_subagent,
    "subagent_complete": _on_subagent,
    # ack passthroughs — cloud-ai sends interjection_ack / subagent_steer_ack
    # once a steer is queued. Forward to desktop so the UI can update.
    "interjection_ack": _on_subagent,
    "subagent_steer_ack": _on_subagent,
    "stopped": _on_subagent,
    "error": _on_error,
}


# ─── Main entry ──────────────────────────────────────────────────────────────


async def handle_chat(msg: Dict[str, Any], session: WebSocketSession) -> None:
    request_id_raw = msg.get("requestId") or msg.get("id")
    request_id = (
        request_id_raw
        if isinstance(request_id_raw, str) and request_id_raw.strip()
        else None
    )

    ws_url = _resolve_cloud_ws_url()
    logger.info("cloud_connect url=%s", ws_url)

    try:
        cws_lock = asyncio.Lock()
        # Increase max_size to avoid 1 MiB default (1009) when receiving tool events.
        async with websockets.connect(ws_url, max_size=None) as cws:
            control_key = request_id or "__default__"
            control_queue: asyncio.Queue = asyncio.Queue()
            session.cloud_control_queues[control_key] = control_queue

            payload = _build_cloud_payload(msg, request_id)

            forwarder = asyncio.create_task(
                _control_forwarder(control_queue, cws, cws_lock, request_id)
            )

            state = ChatRunState()
            try:
                await cws.send(json.dumps(payload))

                while True:
                    try:
                        if state.final_seen:
                            # Stay open briefly for an optional `title` event.
                            # A long wait here used to hang the website SSE for ~20s.
                            cloud_msg = await asyncio.wait_for(cws.recv(), timeout=2.0)
                        else:
                            cloud_msg = await cws.recv()
                    except asyncio.CancelledError:
                        # Forward stop to cloud-ai before exiting. handler.py's
                        # stop handler also enqueues a stop on the control
                        # queue (which may have flushed already); double-stop
                        # is safe on the cloud side.
                        try:
                            async with cws_lock:
                                await cws.send(
                                    json.dumps({"type": "stop", "requestId": request_id})
                                )
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

                    handler = _CLOUD_HANDLERS.get(ctype)
                    if handler is None:
                        # Unknown cloud event — relay verbatim so future
                        # protocol additions reach the desktop without a
                        # python proxy edit. The desktop dedupes on `type`.
                        out = dict(cdata)
                        await session.send_json(out, request_id=rid)
                        continue

                    ctx = _CloudEventCtx(session, cws, cws_lock, rid, state)
                    await handler(cdata, ctx)

                    # `title` is the only post-final event we wait for; once it
                    # arrives we exit the loop.
                    if state.final_seen and ctype == "title":
                        break
                    # `error` ends the turn.
                    if ctype == "error":
                        break
            finally:
                forwarder.cancel()
                try:
                    await forwarder
                except (asyncio.CancelledError, Exception):
                    pass
                current_queue = session.cloud_control_queues.get(control_key)
                if current_queue is control_queue:
                    session.cloud_control_queues.pop(control_key, None)

    except asyncio.CancelledError:
        logger.info("chat_cancelled_by_user")
        await session.send_json(
            {
                "type": "final",
                "origin": "agent",
                "result": {"text": "", "finishReason": "aborted"},
                "aborted": True,
            },
            request_id=request_id,
        )
        raise
    except Exception as e:
        logger.exception("cloud_bridge_failed")
        await session.send_json(
            {"type": "error", "message": f"cloud bridge failed: {e}"},
            request_id=request_id,
        )
