"""Pure utility functions shared across the browser-use server modules."""

import json
from pathlib import Path
from typing import Any

from aiohttp import web


def _clamp_int(value: Any, default: int, min_value: int, max_value: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    if n < min_value:
        return min_value
    if n > max_value:
        return max_value
    return n


def _normalize_wait_until(value: Any) -> str:
    v = str(value or "domcontentloaded").strip().lower()
    if v in ("load", "domcontentloaded", "networkidle", "commit"):
        return v
    return "domcontentloaded"


def _normalize_profile_name(value: Any) -> str:
    raw = str(value or "default").strip()
    if not raw:
        return "default"
    safe = "".join(ch for ch in raw if ch.isalnum() or ch in ("-", "_", "."))
    return safe[:64] or "default"


def _is_allowed_url(url: str) -> bool:
    u = (url or "").strip().lower()
    if not u:
        return False
    return (
        u.startswith("http://")
        or u.startswith("https://")
        or u.startswith("about:")
    )


async def _safe_json(req: web.Request) -> dict[str, Any]:
    try:
        body = await req.json()
        if isinstance(body, dict):
            return body
        return {}
    except Exception:
        return {}


def _jsonable_cookie(cookie: Any) -> dict[str, Any]:
    if isinstance(cookie, dict):
        return cookie
    if hasattr(cookie, "model_dump"):
        try:
            return dict(cookie.model_dump())
        except Exception:
            pass
    if hasattr(cookie, "__dict__"):
        try:
            return dict(cookie.__dict__)
        except Exception:
            pass
    return {"value": str(cookie)}


def _ok(data: dict | None = None) -> web.Response:
    body = {"ok": True, **(data or {})}
    return web.json_response(body)


def _err(msg: str, status: int = 400) -> web.Response:
    return web.json_response({"ok": False, "error": msg}, status=status)


def _make_json_safe(value: Any, depth: int = 0) -> Any:
    if depth > 8:
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx >= 200:
                break
            out[str(k)] = _make_json_safe(v, depth + 1)
        return out
    if isinstance(value, (list, tuple, set)):
        return [_make_json_safe(v, depth + 1) for idx, v in enumerate(value) if idx < 200]
    try:
        json.dumps(value)
        return value
    except Exception:
        return str(value)
