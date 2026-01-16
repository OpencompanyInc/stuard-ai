from __future__ import annotations

import asyncio
import uuid
from typing import Any, Dict, Optional


_CANVASES: Dict[str, Dict[str, Any]] = {}


def _gen_id() -> str:
    return f"canvas-{uuid.uuid4().hex[:8]}"


async def canvas_manager(args: Dict[str, Any], emit: Optional[Any] = None) -> Dict[str, Any]:
    action = str(args.get("action") or "create").lower()
    if action not in {"create", "update", "delete", "list", "show", "hide", "focus", "clear"}:
        return {"ok": False, "error": "invalid_action"}

    if action == "create":
        cid = str(args.get("id") or _gen_id())
        # Prefer 'info' template automatically when content is provided so Markdown/LaTeX renders
        raw_content = args.get("content")
        template = str(args.get("template") or ("info" if (isinstance(raw_content, str) and raw_content.strip()) else "notes"))
        title = str(args.get("title") or "")
        pos = args.get("position") or {}
        size = args.get("size") or {}
        content = raw_content
        data = args.get("data")
        item = {
            "id": cid,
            "template": template,
            "title": title,
            "position": {"x": int(pos.get("x") or 40), "y": int(pos.get("y") or 40)},
            "size": {"width": int(size.get("width") or 320), "height": int(size.get("height") or 200)},
            "visible": True,
            "content": content,
            "data": data,
        }
        _CANVASES[cid] = item
        if emit:
            try:
                await emit("progress", {"kind": "canvas_action", "action": "create", "canvas": item})
            except Exception:
                pass
        return {"ok": True, "id": cid}

    if action == "update":
        cid = str(args.get("id") or "").strip()
        if not cid or cid not in _CANVASES:
            return {"ok": False, "error": "not_found"}
        it = _CANVASES[cid]
        if "template" in args and args["template"]:
            it["template"] = str(args["template"]) 
        if "title" in args:
            it["title"] = str(args.get("title") or "")
        if "position" in args and isinstance(args.get("position"), dict):
            p = args["position"] or {}
            it["position"] = {"x": int(p.get("x") or it["position"]["x"]), "y": int(p.get("y") or it["position"]["y"]) }
        if "size" in args and isinstance(args.get("size"), dict):
            s = args["size"] or {}
            it["size"] = {"width": int(s.get("width") or it["size"]["width"]), "height": int(s.get("height") or it["size"]["height"]) }
        if "content" in args:
            new_content = args.get("content")
            it["content"] = new_content
            # If content is being set and no explicit template was provided in this update,
            # auto-switch a notes board to info so Markdown/LaTeX renders.
            if ("template" not in args or not args.get("template")) and it.get("template") == "notes":
                if isinstance(new_content, str) and new_content.strip():
                    it["template"] = "info"
        if "data" in args:
            it["data"] = args.get("data")
        if emit:
            try:
                await emit("progress", {"kind": "canvas_action", "action": "update", "canvas": it})
            except Exception:
                pass
        return {"ok": True, "id": cid}

    if action == "delete":
        cid = str(args.get("id") or "").strip()
        if not cid or cid not in _CANVASES:
            return {"ok": False, "error": "not_found"}
        try:
            _CANVASES.pop(cid, None)
        except Exception:
            pass
        if emit:
            try:
                await emit("progress", {"kind": "canvas_action", "action": "delete", "id": cid})
            except Exception:
                pass
        return {"ok": True}

    if action == "show":
        cid = str(args.get("id") or "").strip()
        if not cid or cid not in _CANVASES:
            return {"ok": False, "error": "not_found"}
        _CANVASES[cid]["visible"] = True
        if emit:
            try:
                await emit("progress", {"kind": "canvas_action", "action": "show", "id": cid})
            except Exception:
                pass
        return {"ok": True}

    if action == "hide":
        cid = str(args.get("id") or "").strip()
        if not cid or cid not in _CANVASES:
            return {"ok": False, "error": "not_found"}
        _CANVASES[cid]["visible"] = False
        if emit:
            try:
                await emit("progress", {"kind": "canvas_action", "action": "hide", "id": cid})
            except Exception:
                pass
        return {"ok": True}

    if action == "focus":
        cid = str(args.get("id") or "").strip()
        if not cid or cid not in _CANVASES:
            return {"ok": False, "error": "not_found"}
        if emit:
            try:
                await emit("progress", {"kind": "canvas_action", "action": "focus", "id": cid})
            except Exception:
                pass
        return {"ok": True}

    if action == "clear":
        _CANVASES.clear()
        if emit:
            try:
                await emit("progress", {"kind": "canvas_action", "action": "clear"})
            except Exception:
                pass
        return {"ok": True}

    if action == "list":
        items = list(_CANVASES.values())
        return {"ok": True, "items": items}

    return {"ok": False, "error": "unhandled"}
