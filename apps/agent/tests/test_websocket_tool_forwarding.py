import asyncio
import importlib
import json
from pathlib import Path
from uuid import uuid4


class GuardedDesktopWebSocket:
    def __init__(self) -> None:
        self.in_flight = 0
        self.max_in_flight = 0
        self.payloads: list[dict] = []

    async def send_text(self, payload: str) -> None:
        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        if self.in_flight > 1:
            self.in_flight -= 1
            raise RuntimeError("concurrent send_text")
        try:
            await asyncio.sleep(0.01)
            self.payloads.append(json.loads(payload))
        finally:
            self.in_flight -= 1


class FakeCloudWebSocket:
    def __init__(self) -> None:
        self.payloads: list[dict] = []

    async def send(self, payload: str) -> None:
        self.payloads.append(json.loads(payload))


class FakeSession:
    def __init__(self) -> None:
        self.ws = GuardedDesktopWebSocket()
        self.send_lock = asyncio.Lock()
        self.pending_approvals = {}
        self.pending_client_tool_results = {}
        self.folder_session_ids: set[str] = set()
        self.sent_messages: list[dict] = []

    async def send_json(self, data, request_id=None) -> None:
        if request_id:
            data = dict(data)
            data["requestId"] = request_id
        self.sent_messages.append(data)
        async with self.send_lock:
            await self.ws.send_text(json.dumps(data))
        if data.get("type") == "tool_request":
            fut = self.pending_client_tool_results.get(data["id"])
            if fut and not fut.done():
                fut.set_result({"ok": True, "tool": data["tool"], "echo": data.get("args")})

    async def progress(self, event, payload, request_id=None) -> None:
        await self.send_json({
            "type": "progress",
            "event": event,
            "data": payload,
        }, request_id=request_id)


def _make_local_tmp_dir() -> Path:
    root = Path.cwd() / "_tmp_ws_forward_tests"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"ws-tool-forward-{uuid4().hex}"
    (path / "agent-data").mkdir(parents=True, exist_ok=True)
    return path


def _load_websocket_tools(monkeypatch, temp_dir: Path):
    monkeypatch.setenv("AGENT_DATA_DIR", str(temp_dir / "agent-data"))
    monkeypatch.setenv("STUARD_AGENT_MODE", "vm")
    from app.websocket import tools as websocket_tools
    return importlib.reload(websocket_tools)


def test_parallel_client_tool_forwarding_uses_session_send_lock(monkeypatch):
    async def run_case() -> None:
        websocket_tools = _load_websocket_tools(monkeypatch, _make_local_tmp_dir())
        session = FakeSession()
        cloud_ws = FakeCloudWebSocket()
        send_lock = asyncio.Lock()

        await asyncio.gather(
            websocket_tools.handle_cloud_tool_request(
                {"id": "tool-a", "tool": "show_table", "args": {"rows": [1]}},
                session,
                cloud_ws,
                request_id="req-parallel",
                cws_lock=send_lock,
            ),
            websocket_tools.handle_cloud_tool_request(
                {"id": "tool-b", "tool": "show_table", "args": {"rows": [2]}},
                session,
                cloud_ws,
                request_id="req-parallel",
                cws_lock=send_lock,
            ),
        )

        forwarded = [msg for msg in session.sent_messages if msg.get("type") == "tool_request"]
        assert len(forwarded) == 2
        assert {msg["id"] for msg in forwarded} == {"tool-a", "tool-b"}
        assert all(msg.get("requestId") == "req-parallel" for msg in forwarded)
        assert session.ws.max_in_flight == 1

    asyncio.run(run_case())


def test_unknown_tool_fallback_forwarding_uses_session_send_lock(monkeypatch):
    async def fake_dispatch_execute(tool, args, emit):
        return {"ok": False, "error": "unknown_tool"}

    async def run_case() -> None:
        websocket_tools = _load_websocket_tools(monkeypatch, _make_local_tmp_dir())
        session = FakeSession()
        cloud_ws = FakeCloudWebSocket()
        send_lock = asyncio.Lock()

        monkeypatch.setattr(websocket_tools, "dispatch_execute", fake_dispatch_execute)

        await websocket_tools.handle_cloud_tool_request(
            {"id": "tool-fallback", "tool": "custom_missing_tool", "args": {"value": 1}},
            session,
            cloud_ws,
            request_id="req-fallback",
            cws_lock=send_lock,
        )

        forwarded = [msg for msg in session.sent_messages if msg.get("type") == "tool_request"]
        assert len(forwarded) == 1
        assert forwarded[0]["id"] == "tool-fallback"
        assert forwarded[0]["tool"] == "custom_missing_tool"
        assert forwarded[0].get("requestId") == "req-fallback"
        assert session.ws.max_in_flight == 1

    asyncio.run(run_case())


def test_chat_ui_non_blocking_resolves_without_client_roundtrip(monkeypatch):
    """Non-blocking chat_ui must resolve immediately on the cloud side.

    Otherwise the cloud orchestrator's 30s non-blocking timeout fires while the
    UI sits rendered with no result, and the model re-renders in a loop.
    """

    async def run_case() -> None:
        websocket_tools = _load_websocket_tools(monkeypatch, _make_local_tmp_dir())
        session = FakeSession()
        cloud_ws = FakeCloudWebSocket()
        send_lock = asyncio.Lock()

        await websocket_tools.handle_cloud_tool_request(
            {
                "id": "chatui-1",
                "tool": "chat_ui",
                "args": {"component": "function App(){}", "blocking": False},
            },
            session,
            cloud_ws,
            request_id="req-chatui",
            cws_lock=send_lock,
        )

        # The result is sent straight back to cloud without waiting on the client.
        results = [m for m in cloud_ws.payloads if m.get("type") == "tool_result" and m.get("id") == "chatui-1"]
        assert len(results) == 1
        assert results[0]["result"] == {"ok": True, "displayed": True}
        # And no blocking tool_request was forwarded to the desktop/web client.
        forwarded = [m for m in session.sent_messages if m.get("type") == "tool_request"]
        assert forwarded == []
        # The UI still rendered: a started + completed tool_event reached the client.
        statuses = [
            m.get("data", {}).get("status")
            for m in session.sent_messages
            if m.get("type") == "progress" and m.get("event") == "tool_event"
        ]
        assert "started" in statuses
        assert "completed" in statuses

    asyncio.run(run_case())


def test_chat_ui_blocking_waits_for_client_submit(monkeypatch):
    """Blocking chat_ui must await the client's submit/close tool_result."""

    async def run_case() -> None:
        websocket_tools = _load_websocket_tools(monkeypatch, _make_local_tmp_dir())
        session = FakeSession()
        cloud_ws = FakeCloudWebSocket()
        send_lock = asyncio.Lock()

        task = asyncio.create_task(
            websocket_tools.handle_cloud_tool_request(
                {
                    "id": "chatui-2",
                    "tool": "chat_ui",
                    "args": {"component": "function App(){}", "blocking": True},
                },
                session,
                cloud_ws,
                request_id="req-chatui-block",
                cws_lock=send_lock,
            )
        )

        # Wait until the handler registers its pending future, then simulate the
        # client submitting the UI (desktop → /command tool_result → resolves it).
        fut = None
        for _ in range(200):
            await asyncio.sleep(0.01)
            fut = session.pending_client_tool_results.get("chatui-2")
            if fut is not None:
                break
        assert fut is not None, "blocking chat_ui never registered a pending future"
        fut.set_result({"ok": True, "action": "submit", "data": {"name": "Ada"}})

        await task

        results = [m for m in cloud_ws.payloads if m.get("type") == "tool_result" and m.get("id") == "chatui-2"]
        assert len(results) == 1
        assert results[0]["result"]["data"] == {"name": "Ada"}

    asyncio.run(run_case())
