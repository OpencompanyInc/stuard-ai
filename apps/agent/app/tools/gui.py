from __future__ import annotations

import asyncio
import io
import os
import tempfile
import time
from typing import Any, Dict


async def get_mouse_position(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get the current mouse cursor position on screen."""
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    pos = pag.position()
    return {"ok": True, "x": pos.x, "y": pos.y}


async def click_at_coordinates(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    x = float(args.get("x"))
    y = float(args.get("y"))
    button = str(args.get("button") or "left").lower()
    pag.click(x=x, y=y, clicks=1, button=button)
    return {"ok": True}


async def double_click_at_coordinates(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    x = float(args.get("x"))
    y = float(args.get("y"))
    button = str(args.get("button") or "left").lower()
    pag.doubleClick(x=x, y=y, button=button)
    return {"ok": True}


def _is_mac() -> bool:
    import sys
    return sys.platform == "darwin"


def _norm_key(k: str) -> str:
    import sys
    m = k.strip().lower()
    synonyms = {
        "control": "ctrl",
        "option": "alt",
        "escape": "esc",
        "return": "enter",
        "del": "delete",
        "windows": "win",
        "super": "win",
    }
    m = synonyms.get(m, m)
    if m in ("meta", "cmd", "command"):
        return "command" if _is_mac() else "win"
    if m.startswith("arrow"):
        return m.replace("arrow", "")
    if m == "pageup":
        return "pageup"
    if m == "pagedown":
        return "pagedown"
    return m


async def type_text(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    text = str(args.get("text") or "")
    use_clip = bool(args.get("useClipboardFallback") or False)
    if use_clip:
        try:
            import pyperclip  # type: ignore
            pyperclip.copy(text)
            if _is_mac():
                pag.hotkey("command", "v")
            else:
                pag.hotkey("ctrl", "v")
        except Exception:
            pag.typewrite(text, interval=0.01)
    else:
        pag.typewrite(text, interval=0.01)
    return {"ok": True}


async def send_hotkey(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    keys = [str(k) for k in (args.get("keys") or [])]
    if not keys:
        raise ValueError("missing keys")
    norm = [_norm_key(k) for k in keys]

    # Release any stuck modifier keys before sending the hotkey
    # This fixes issues when send_hotkey is triggered by a global hotkey
    # (e.g., Ctrl+Alt+E triggers workflow that immediately sends Ctrl+C)
    modifiers = ['ctrl', 'alt', 'shift', 'win', 'command']
    for mod in modifiers:
        try:
            pag.keyUp(mod)
        except Exception:
            pass

    # Small delay to ensure modifiers are released
    time.sleep(0.05)

    pag.hotkey(*norm)
    return {"ok": True, "keys": norm}


async def scroll(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    delta_y = float(args.get("deltaY") or 0)
    delta_x = float(args.get("deltaX") or 0)
    speed = float(args.get("speed") or 1.0)
    scale = max(1, int(100 / max(0.1, speed)))
    clicks_y = int(delta_y / scale)
    if clicks_y:
        pag.scroll(clicks_y)
    clicks_x = int(delta_x / scale)
    if clicks_x:
        try:
            pag.hscroll(clicks_x)
        except Exception:
            pass
    return {"ok": True, "scrollY": clicks_y, "scrollX": clicks_x}


async def drag_and_drop(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    from_x = float(args.get("fromX"))
    from_y = float(args.get("fromY"))
    to_x = float(args.get("toX"))
    to_y = float(args.get("toY"))
    duration = float(args.get("duration") or 0.2)
    pag.moveTo(from_x, from_y)
    pag.mouseDown()
    pag.moveTo(to_x, to_y, duration=duration)
    pag.mouseUp()
    return {"ok": True}


async def take_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    region = args.get("region") or {}
    try:
        import mss  # type: ignore
        from mss import tools as msstools  # type: ignore
    except Exception:
        raise RuntimeError("mss not installed")
    with mss.mss() as sct:
        if all(k in region for k in ("x", "y", "width", "height")):
            monitor = {
                "left": int(region["x"]),
                "top": int(region["y"]),
                "width": int(region["width"]),
                "height": int(region["height"]),
            }
        else:
            monitor = sct.monitors[0]
        sct_img = sct.grab(monitor)
        tmpdir = os.path.join(tempfile.gettempdir(), "stuardai")
        if not os.path.exists(tmpdir):
            os.makedirs(tmpdir, exist_ok=True)
        file_path = os.path.join(tmpdir, f"screenshot_{int(time.time()*1000)}.png")
        msstools.to_png(sct_img.rgb, sct_img.size, output=file_path)
    return {"ok": True, "filePath": file_path}


async def capture_screen_to_file(args: Dict[str, Any]) -> Dict[str, Any]:
    file_path = str(args.get("filePath") or "screenshot.png")
    region = args.get("region") or {}
    d = os.path.dirname(file_path)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    try:
        import mss  # type: ignore
        from mss import tools as msstools  # type: ignore
    except Exception:
        raise RuntimeError("mss not installed")
    with mss.mss() as sct:
        if all(k in region for k in ("x", "y", "width", "height")):
            monitor = {
                "left": int(region["x"]),
                "top": int(region["y"]),
                "width": int(region["width"]),
                "height": int(region["height"]),
            }
        else:
            monitor = sct.monitors[0]
        sct_img = sct.grab(monitor)
        msstools.to_png(sct_img.rgb, sct_img.size, output=file_path)
    return {"ok": True, "filePath": file_path}


async def prepare_image_for_model(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    max_w = int(args.get("maxWidth") or 1600)
    max_h = int(args.get("maxHeight") or 1200)
    quality = int(args.get("quality") or 82)
    fmt = str(args.get("format") or "JPEG").upper()
    try:
        from PIL import Image  # type: ignore
    except Exception:
        raise RuntimeError("pillow not installed")
    with Image.open(p) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = min(1.0, max_w / float(w) if w else 1.0, max_h / float(h) if h else 1.0)
        if scale < 1.0:
            new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
            im = im.resize(new_size, Image.LANCZOS)
        buf = io.BytesIO()
        save_kwargs = {"quality": quality}
        if fmt == "WEBP":
            save_kwargs["method"] = 4
        im.save(buf, format=fmt, **save_kwargs)
        data = buf.getvalue()
    mime = "image/jpeg" if fmt == "JPEG" else "image/webp"
    import base64
    b64 = base64.b64encode(data).decode("ascii")
    return {"ok": True, "data": b64, "mimeType": mime}
