from __future__ import annotations

from typing import Any, Dict


async def get_clipboard_content(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    try:
        import pyperclip  # type: ignore
        txt = pyperclip.paste()
    except Exception:
        txt = None
    return {"ok": True, "text": txt}


async def set_clipboard_content(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pyperclip  # type: ignore
        txt = str(args.get("text") or "")
        pyperclip.copy(txt)
        return {"ok": True}
    except Exception:
        return {"ok": False, "error": "clipboard_unavailable"}
