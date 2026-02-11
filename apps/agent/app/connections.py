from __future__ import annotations

import asyncio
from typing import Set

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active: Set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self.pending_requests: Dict[str, asyncio.Future] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self.active.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self.active.discard(ws)

    async def broadcast(self, message: str) -> None:
        async with self._lock:
            conns = list(self.active)
        for conn in conns:
            try:
                await conn.send_text(message)
            except Exception:
                await self.disconnect(conn)

    async def send_request(self, event: str, data: Dict[str, Any] = {}) -> Any:
        import uuid
        import json
        
        req_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending_requests[req_id] = future
        
        payload = {
            "type": "request",
            "id": req_id,
            "event": event,
            "data": data
        }
        
        await self.broadcast(json.dumps(payload))
        
        try:
            return await asyncio.wait_for(future, timeout=10.0)
        except asyncio.TimeoutError:
            self.pending_requests.pop(req_id, None)
            raise TimeoutError("Request timed out")
        except Exception as e:
            self.pending_requests.pop(req_id, None)
            raise e

    def resolve_request(self, req_id: str, data: Any) -> None:
        future = self.pending_requests.pop(req_id, None)
        if future and not future.done():
            future.set_result(data)


manager = ConnectionManager()
