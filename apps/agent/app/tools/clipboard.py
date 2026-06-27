from __future__ import annotations

from typing import Any, Dict


async def get_clipboard_content(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    try:
        import pyperclip  # type: ignore
        txt = pyperclip.paste()
    except Exception:
        txt = None
    # pyperclip only exposes text; richer typing (image/files/html) is handled
    # by the desktop (Electron) clipboard handler.
    ctype = "text" if txt else "empty"
    return {"ok": True, "type": ctype, "types": [ctype] if txt else [], "text": txt, "files": [], "hasImage": False}


async def set_clipboard_content(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pyperclip  # type: ignore
        txt = str(args.get("text") or "")
        pyperclip.copy(txt)
        return {"ok": True, "type": "text"}
    except Exception:
        return {"ok": False, "error": "clipboard_unavailable"}
