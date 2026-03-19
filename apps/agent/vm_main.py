"""
VM-mode Python Agent Entry Point

Lightweight WebSocket server for headless Linux cloud VMs.
Listens on ws://127.0.0.1:8765/ws and handles the same chat/tool
protocol as the desktop agent, but with VM-safe dispatch.

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

from app.websocket.chat import handle_chat
from app.websocket.tools import handle_tool_exec
from app.websocket.session import WebSocketSession
from app.tools.folder_limiter import FolderLimiter

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

class _WSAdapter:
    """Minimal adapter so WebSocketSession can write to websockets-server clients."""

    def __init__(self, ws: WebSocketServerProtocol):
        self._ws = ws

    async def send_text(self, data: str) -> None:
        await self._ws.send(data)

async def handle_connection(ws: WebSocketServerProtocol) -> None:
    remote = ws.remote_address
    logger.info("ws_connected remote=%s", remote)
    session = WebSocketSession(_WSAdapter(ws))  # type: ignore[arg-type]

    # Send handshake
    await ws.send(json.dumps({
        "type": "handshake",
        "origin": "agent",
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

            if kind == "chat":
                task = asyncio.create_task(handle_chat(msg, session))
                session.active_chat_tasks.add(task)

                def _cleanup_chat(done_task: asyncio.Task) -> None:
                    try:
                        session.active_chat_tasks.discard(done_task)
                    except Exception:
                        pass

                task.add_done_callback(_cleanup_chat)
            elif kind == "tool_exec":
                async def _run_tool_exec(msg_local: Dict[str, Any] = msg) -> None:
                    try:
                        await handle_tool_exec(msg_local, session)
                    except Exception:
                        logger.exception("tool_exec_task_failed")

                task = asyncio.create_task(_run_tool_exec())
                session.active_tool_tasks.add(task)

                def _cleanup_tool(done_task: asyncio.Task) -> None:
                    try:
                        session.active_tool_tasks.discard(done_task)
                    except Exception:
                        pass

                task.add_done_callback(_cleanup_tool)
            elif kind == "approval_response":
                try:
                    req_id = str(msg.get("id") or "").strip()
                    allow = bool(msg.get("allow"))
                    fut = session.pending_approvals.get(req_id)
                    if fut and not fut.done():
                        fut.set_result({"allow": allow})
                except Exception:
                    pass
            elif kind == "tool_result":
                try:
                    req_id = str(msg.get("id") or "").strip()
                    result = msg.get("result")
                    fut = session.pending_client_tool_results.get(req_id)
                    if fut and not fut.done():
                        fut.set_result(result)
                except Exception:
                    pass
            elif kind == "stop" or kind == "abort":
                cancelled_count = 0
                for task in list(session.active_chat_tasks):
                    try:
                        if not task.done():
                            task.cancel()
                            cancelled_count += 1
                    except Exception:
                        pass
                logger.info("stop_requested cancelled=%d", cancelled_count)
                await ws.send(json.dumps({"type": "stopped", "success": cancelled_count > 0}))
            elif kind == "auth":
                await ws.send(json.dumps({"type": "auth_result", "ok": True, "queued": 0}))
            elif kind == "ping":
                await ws.send(json.dumps({"type": "pong"}))
            else:
                logger.warning("unknown_message_type kind=%s", kind)
                await ws.send(json.dumps({"type": "error", "message": f"unknown type: {kind}"}))
    except websockets.exceptions.ConnectionClosed:
        logger.info("ws_disconnected remote=%s", remote)
    except Exception:
        logger.exception("ws_handler_error remote=%s", remote)
    finally:
        # Clean up folder-limiter sessions to prevent memory leaks
        for sid in session.folder_session_ids:
            FolderLimiter.clear_session(sid)
        session.folder_session_ids.clear()


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
