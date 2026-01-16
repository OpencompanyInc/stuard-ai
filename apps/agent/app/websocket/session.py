import asyncio
import json
from typing import Any, Dict, Optional
from fastapi import WebSocket

class WebSocketSession:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.send_lock = asyncio.Lock()
        self.pending_approvals: Dict[str, asyncio.Future] = {}
        self.pending_client_tool_results: Dict[str, asyncio.Future] = {}
        self.active_chat_tasks: set[asyncio.Task] = set()

    async def send_json(self, data: Dict[str, Any], request_id: Optional[str] = None) -> None:
        try:
            if request_id:
                data = dict(data)
                data["requestId"] = request_id
            async with self.send_lock:
                await self.ws.send_text(json.dumps(data))
        except Exception:
            pass

    async def progress(self, event: str, payload: Dict[str, Any], request_id: Optional[str] = None) -> None:
        await self.send_json({
            "type": "progress",
            "event": event,
            "data": payload
        }, request_id=request_id)
