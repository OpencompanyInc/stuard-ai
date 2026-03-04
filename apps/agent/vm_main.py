"""
VM-mode Python Agent Entry Point

Lightweight WebSocket server for headless Linux cloud VMs.
Listens on ws://127.0.0.1:8765/ws and handles tool_exec requests
from the Node.js VM engine (vm-engine.ts).

Uses dispatch_vm.py which excludes all desktop-only modules
(GUI, clipboard, screen capture, media devices, etc.).

Started by systemd: stuard-python-agent.service
Env: STUARD_AGENT_MODE=vm (set by the service unit)
"""
from __future__ import annotations

import os
import sys
import json
import asyncio
import signal
import logging
from typing import Any, Dict

# Force VM mode before any app imports
os.environ["STUARD_AGENT_MODE"] = "vm"

# Add the agent app directory to the Python path so imports work
# when running from /opt/stuard/python-agent/
agent_dir = os.path.dirname(os.path.abspath(__file__))
if agent_dir not in sys.path:
    sys.path.insert(0, agent_dir)

import websockets
from websockets.server import serve, WebSocketServerProtocol

# Import the VM-optimized dispatcher
from app.tools.dispatch_vm import execute as dispatch_execute

# ── Configuration ─────────────────────────────────────────────────────────────

WS_HOST = os.environ.get("STUARD_WS_HOST", "127.0.0.1")
WS_PORT = int(os.environ.get("STUARD_WS_PORT", "8765"))
MAX_PAYLOAD = 256 * 1024 * 1024  # 256 MB

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("vm-agent")

# ── WebSocket Handler ─────────────────────────────────────────────────────────

async def handle_connection(ws: WebSocketServerProtocol) -> None:
    remote = ws.remote_address
    logger.info("ws_connected remote=%s", remote)

    # Send handshake
    await ws.send(json.dumps({
        "type": "handshake",
        "origin": "vm-python-agent",
        "message": "connected",
        "mode": "vm",
    }))

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send(json.dumps({"type": "error", "message": "invalid json"}))
                continue

            kind = str(msg.get("type", "")).lower()

            if kind == "tool_exec":
                # Fire-and-forget so we can handle concurrent requests
                asyncio.create_task(_handle_tool_exec(ws, msg))
            elif kind == "ping":
                await ws.send(json.dumps({"type": "pong"}))
            else:
                logger.warning("unknown_message_type kind=%s", kind)
    except websockets.exceptions.ConnectionClosed:
        logger.info("ws_disconnected remote=%s", remote)
    except Exception:
        logger.exception("ws_handler_error remote=%s", remote)


async def _handle_tool_exec(ws: WebSocketServerProtocol, msg: Dict[str, Any]) -> None:
    """Execute a tool and send back tool_event + tool_result messages."""
    raw_tool = str(msg.get("tool", "")).strip()
    tool = raw_tool.lower().replace("-", "_")
    args = msg.get("args") or {}
    req_id = msg.get("id") or f"tool-{int(asyncio.get_event_loop().time() * 1000)}"

    logger.info("tool_exec id=%s tool=%s", req_id, tool)

    async def emit(status: str, extra: Dict[str, Any] | None = None) -> None:
        payload: Dict[str, Any] = {
            "type": "tool_event",
            "id": req_id,
            "tool": tool,
            "status": status,
        }
        if extra:
            payload.update(extra)
        try:
            await ws.send(json.dumps(payload, default=str))
        except Exception:
            pass

    result: Dict[str, Any] = {"ok": False, "error": "tool_exec_never_completed"}

    try:
        await emit("started", {"args": args})
        result = await dispatch_execute(tool, args, emit)
    except Exception as e:
        logger.exception("tool_exec_error id=%s tool=%s", req_id, tool)
        result = {"ok": False, "error": str(e)}

    # Sanitize large data fields before sending result
    safe_result = _sanitize_result(result)
    await emit("completed", {"result": safe_result})

    # Always send tool_result so the caller never hangs
    try:
        await ws.send(json.dumps({
            "type": "tool_result",
            "id": req_id,
            "tool": tool,
            "result": result,
        }, default=str))
    except Exception:
        logger.exception("tool_result_send_failed id=%s tool=%s", req_id, tool)


def _sanitize_result(result: Any) -> Any:
    """Strip large binary/base64 data from result for logging/events."""
    if not isinstance(result, dict):
        return result
    if "data" not in result:
        return result
    safe = dict(result)
    data_val = safe.get("data")
    if isinstance(data_val, (bytes, bytearray)):
        safe["bytes"] = len(data_val)
        del safe["data"]
    elif isinstance(data_val, str) and len(data_val) > 10_000:
        safe["bytes"] = len(data_val)
        del safe["data"]
    return safe


# ── Server Lifecycle ──────────────────────────────────────────────────────────

async def main() -> None:
    logger.info("=" * 50)
    logger.info("Stuard VM Python Agent Starting")
    logger.info("=" * 50)
    logger.info("mode=vm host=%s port=%s pid=%s", WS_HOST, WS_PORT, os.getpid())
    logger.info("python=%s", sys.version)
    logger.info("cwd=%s", os.getcwd())

    stop = asyncio.Event()

    # Graceful shutdown on SIGTERM/SIGINT
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            pass

    async with serve(
        handle_connection,
        WS_HOST,
        WS_PORT,
        max_size=MAX_PAYLOAD,
        ping_interval=30,
        ping_timeout=10,
    ) as server:
        logger.info("WebSocket server listening on ws://%s:%s/ws", WS_HOST, WS_PORT)
        await stop.wait()
        logger.info("Shutting down...")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Interrupted, exiting.")
