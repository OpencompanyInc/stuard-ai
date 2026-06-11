from __future__ import annotations

# CRITICAL: Suppress pydantic warnings BEFORE any imports that might trigger them
# This must be at the very top before importing lancedb or any ML libraries
import warnings
warnings.filterwarnings("ignore", message=r".*protected namespace.*", category=UserWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

# Set Windows DPI awareness for the WHOLE process before anything touches
# coordinate APIs. Otherwise pyautogui / GetCursorPos / GetWindowRect return
# DPI-virtualized (logical) coords until some screenshot path calls
# SetProcessDPIAware mid-session — silently shifting the coordinate space of
# every position tool. Electron-side consumers (custom_ui moveTo/getScreenInfo,
# mousePointToElectronPoint) assume physical pixels throughout.
try:
    from .tools.cursor_overlay import _set_process_dpi_aware
except Exception:
    try:
        from app.tools.cursor_overlay import _set_process_dpi_aware
    except Exception:
        from tools.cursor_overlay import _set_process_dpi_aware
_set_process_dpi_aware()

import json
import os
import sys
import logging
from typing import Any, Dict

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from .logging_config import get_logger
    from .routes.core import (
        router as core_router,
        root as v1_root,
        health as v1_health,
    )
    from .config import APP_HOST, APP_PORT, CLOUD_WS
    from .tools import tasks as tasks_tools
    from .connections import manager
    from .websocket import ws_endpoint
except Exception:
    try:
        from app.logging_config import get_logger
        from app.routes.core import (
            router as core_router,
            root as v1_root,
            health as v1_health,
        )
        from app.config import APP_HOST, APP_PORT, CLOUD_WS
        from app.tools import tasks as tasks_tools
        from app.connections import manager
        from app.websocket import ws_endpoint
    except Exception:
        # Fallback to local imports
        from logging_config import get_logger
        from routes.core import (
            router as core_router,
            root as v1_root,
            health as v1_health,
        )
        from config import APP_HOST, APP_PORT, CLOUD_WS
        from tools import tasks as tasks_tools
        from connections import manager
        from websocket import ws_endpoint

app = FastAPI(title="StuardAI Local Agent", version="0.1.1")
# Mount modular API routes under /v1 to avoid duplicate paths with legacy inline routes
app.include_router(core_router, prefix="/v1")

# Allow desktop renderer (vite/electron) to call local HTTP endpoints
app.add_middleware(
    CORSMiddleware,
    # SECURITY: Restrict to local/app origins to prevent Drive-by RCE
    allow_origins=[
        "http://localhost:5173", 
        "http://127.0.0.1:5173", 
        "app://.",
        "file://"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = get_logger("agent")

@app.on_event("startup")
async def _resume_reminders_on_startup() -> None:
    try:
        await tasks_tools.task_reminders({"action": "resume"})
        logger.info("reminders_resume_started")
    except Exception:
        logger.exception("reminders_resume_failed")


@app.get("/")
async def root() -> JSONResponse:
    return await v1_root()


@app.get("/health")
async def health() -> JSONResponse:
    return await v1_health()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws_endpoint(ws)


def is_frozen() -> bool:
    """Check if running as a PyInstaller frozen executable."""
    import sys
    return getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS')


if __name__ == "__main__":
    import uvicorn
    
    # Disable reload in frozen mode (PyInstaller) - it will crash
    frozen = is_frozen()
    reload = False if frozen else os.getenv("AGENT_RELOAD", "0") == "1"
    
    logger.info("=" * 50)
    logger.info("Stuard AI Agent Starting")
    logger.info("=" * 50)
    logger.info("agent_start host=%s port=%s frozen=%s", APP_HOST, APP_PORT, frozen)
    logger.info("cloud_ws_url=%s", CLOUD_WS)
    logger.info("python_version=%s", sys.version)
    logger.info("working_dir=%s", os.getcwd())
    
    # Suppress noisy access logs for high-frequency polling endpoints
    import logging as _logging
    class _PollFilter(_logging.Filter):
        _QUIET = ("/health", "/v1/tasks/list", "/v1/reminders/list", "/v1/subagents/list")
        def filter(self, record: _logging.LogRecord) -> bool:
            msg = record.getMessage()
            return not any(p in msg for p in self._QUIET)
    _logging.getLogger("uvicorn.access").addFilter(_PollFilter())

    # In frozen mode, must pass app object directly (no string import path)
    uvicorn.run(
        app,
        host=APP_HOST,
        port=APP_PORT,
        reload=reload,
        log_level="info",
        # Avoid multiprocessing issues in frozen mode
        workers=1,
    )
