from __future__ import annotations

import asyncio
from typing import Set

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

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


manager = ConnectionManager()
