from __future__ import annotations

import asyncio
import io
import os
import time
from typing import Any, Dict

from .cursor_overlay import save_mss_png_with_cursor


async def get_mouse_position(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get the current mouse cursor position on screen."""
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    pos = pag.position()
    return {"ok": True, "x": pos.x, "y": pos.y}


async def move_cursor(args: Dict[str, Any]) -> Dict[str, Any]:
    """Move the mouse cursor to specific screen coordinates."""
    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")
    x = float(args.get("x"))
    y = float(args.get("y"))
    duration = float(args.get("duration") or 0.0)
    pag.moveTo(x, y, duration=duration)
    return {"ok": True, "x": x, "y": y}


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

    count = max(1, int(args.get("count") or args.get("repeat") or 1))
    delay = max(0, float(args.get("delay") or 0))

    # Release any stuck modifier keys before sending the hotkey
    # This fixes issues when send_hotkey is triggered by a global hotkey
    # (e.g., Ctrl+Alt+E triggers workflow that immediately sends Ctrl+C)
    modifiers = ['ctrl', 'alt', 'shift', 'win', 'command']
    for mod in modifiers:
        try:
            pag.keyUp(mod)
        except Exception:
            pass

    for i in range(count):
        pag.hotkey(*norm)
        if delay > 0 and i < count - 1:
            time.sleep(delay)

    return {"ok": True, "keys": norm, "count": count}


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


async def computer_use(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "").strip().lower()
    action = action.replace("-", "_").replace(" ", "_")
    action = {
        "click": "left_click",
        "tap": "left_click",
        "leftclick": "left_click",
        "doubleclick": "double_click",
        "rightclick": "right_click",
        "middleclick": "middle_click",
        "mousemove": "mouse_move",
        "move": "mouse_move",
        "drag": "left_click_drag",
        "press": "key",
        "hotkey": "key",
        "shortcut": "key",
        "type_text": "type",
        "input": "type",
        "write": "type",
    }.get(action, action)
    monitor_index = int(args.get("monitorIndex") or 1)
    coordinate = args.get("coordinate")
    if coordinate is None and args.get("x") is not None and args.get("y") is not None:
        coordinate = [args.get("x"), args.get("y")]
    keys = args.get("keys") or []
    if isinstance(keys, str):
        keys = [k for k in keys.replace("+", " ").replace(",", " ").split() if k]
    if (not keys) and isinstance(args.get("hotkey"), str):
        keys = [k for k in str(args.get("hotkey") or "").replace("+", " ").replace(",", " ").split() if k]
    if (not keys) and isinstance(args.get("key"), str):
        keys = [str(args.get("key") or "").strip()]
    text = args.get("text") if args.get("text") is not None else args.get("answer")
    term_status = args.get("status") if args.get("status") is not None else args.get("result")
    pixels = args.get("pixels") if args.get("pixels") is not None else (args.get("deltaY") if args.get("deltaY") is not None else args.get("delta"))
    wait_s = args.get("time") if args.get("time") is not None else (args.get("seconds") if args.get("seconds") is not None else args.get("duration"))
    include_screenshot = bool(args.get("includeScreenshot", True))
    mouse_move_duration = float(args.get("mouseMoveDuration") or 0.0)
    drag_duration = float(args.get("dragDuration") or 0.15)
    return_data_url = bool(args.get("returnDataUrl") or False)
    image_quality = int(args.get("imageQuality") or 60)
    image_max_pixels = int(args.get("imageMaxPixels") or 2_000_000)
    include_cursor = bool(args.get("includeCursor", True))

    try:
        import pyautogui as pag  # type: ignore
    except Exception:
        raise RuntimeError("pyautogui not installed")

    try:
        import mss  # type: ignore
    except Exception:
        raise RuntimeError("mss not installed")

    def _coord_to_abs(x_in: float, y_in: float, mon: Dict[str, Any]) -> tuple[int, int]:
        x = float(x_in)
        y = float(y_in)
        if 0 <= x <= 1000 and 0 <= y <= 1000:
            abs_x = int(mon["left"] + (x / 1000.0) * mon["width"])
            abs_y = int(mon["top"] + (y / 1000.0) * mon["height"])
            return abs_x, abs_y
        return int(x), int(y)

    def _get_monitor() -> Dict[str, Any]:
        with mss.mss() as sct:
            mons = sct.monitors
            if monitor_index < 0 or monitor_index >= len(mons):
                mi = 1 if len(mons) > 1 else 0
            else:
                mi = monitor_index
            return dict(mons[mi])

    def _get_xy() -> tuple[int, int] | None:
        if not coordinate or not isinstance(coordinate, (list, tuple)) or len(coordinate) != 2:
            return None
        mon = _get_monitor()
        return _coord_to_abs(float(coordinate[0]), float(coordinate[1]), mon)

    xy = _get_xy()

    if action == "mouse_move":
        if not xy:
            raise ValueError("coordinate=[x,y] required for mouse_move")
        pag.moveTo(xy[0], xy[1], duration=mouse_move_duration)

    elif action == "left_click":
        if xy:
            pag.moveTo(xy[0], xy[1], duration=mouse_move_duration)
            pag.click(x=xy[0], y=xy[1], clicks=1, button="left")
        else:
            pag.click(button="left")

    elif action == "right_click":
        if xy:
            pag.moveTo(xy[0], xy[1], duration=mouse_move_duration)
            pag.click(x=xy[0], y=xy[1], clicks=1, button="right")
        else:
            pag.click(button="right")

    elif action == "middle_click":
        if xy:
            pag.moveTo(xy[0], xy[1], duration=mouse_move_duration)
            pag.click(x=xy[0], y=xy[1], clicks=1, button="middle")
        else:
            pag.click(button="middle")

    elif action == "double_click":
        if not xy:
            raise ValueError("coordinate=[x,y] required for double_click")
        pag.moveTo(xy[0], xy[1], duration=mouse_move_duration)
        pag.doubleClick(x=xy[0], y=xy[1])

    elif action == "left_click_drag":
        if not xy:
            raise ValueError("coordinate=[x,y] required for left_click_drag")
        pag.dragTo(xy[0], xy[1], duration=drag_duration, button="left")

    elif action == "scroll":
        amount = int(float(pixels or 0))
        pag.scroll(amount)

    elif action == "hscroll":
        amount = int(float(pixels or 0))
        try:
            pag.hscroll(amount)
        except Exception:
            pass

    elif action == "type":
        if text is None:
            raise ValueError("text is required for action=type")
        await type_text({"text": str(text), "useClipboardFallback": bool(args.get("useClipboardFallback") or False)})

    elif action == "key":
        if not keys:
            raise ValueError("keys is required for action=key")
        await send_hotkey({"keys": [str(k) for k in keys]})

    elif action == "wait":
        if wait_s is None:
            raise ValueError("time is required for action=wait")
        time.sleep(float(wait_s))

    elif action == "answer":
        return {"ok": True, "action": action, "text": str(text or "")}

    elif action == "terminate":
        status = str(term_status or "").strip().lower()
        if status not in {"success", "failure"}:
            raise ValueError("status must be success or failure for action=terminate")
        return {"ok": True, "action": action, "result": status}

    else:
        raise ValueError(f"Unsupported action: {action}")

    result: Dict[str, Any] = {"ok": True, "action": action}

    if not include_screenshot:
        return result

    mon = _get_monitor()
    with mss.mss() as sct:
        sct_img = sct.grab(mon)
        tmpdir = os.path.join(os.path.expanduser("~"), "Documents", "StuardAI", "media", "screenshots")
        os.makedirs(tmpdir, exist_ok=True)
        file_path = os.path.join(tmpdir, f"computer_use_{int(time.time()*1000)}.png")
        save_mss_png_with_cursor(sct_img, mon, file_path, include_cursor)

    pos = pag.position()
    result.update(
        {
            "filePath": file_path,
            "cursor": {"x": pos.x, "y": pos.y},
            "display": {"width": int(mon.get("width") or 0), "height": int(mon.get("height") or 0)},
        }
    )

    if return_data_url:
        try:
            from PIL import Image  # type: ignore
        except Exception:
            raise RuntimeError("pillow not installed")
        with Image.open(file_path) as im:
            im = im.convert("RGB")
            w, h = im.size
            area = max(1, int(w) * int(h))
            max_pixels = max(4096, int(image_max_pixels))
            scale = (min(area, max_pixels) / float(area)) ** 0.5
            if scale < 1.0:
                nw = max(1, int(w * scale))
                nh = max(1, int(h * scale))
                im = im.resize((nw, nh), Image.LANCZOS)
            buf = io.BytesIO()
            q = max(1, min(95, int(image_quality)))
            im.save(buf, format="JPEG", quality=q, optimize=True)
            import base64
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            result["screenshot"] = f"data:image/jpeg;base64,{b64}"

    return result


def _get_dpi_scale() -> float:
    """Get the Windows display DPI scale factor (e.g. 1.25 for 125% scaling)."""
    try:
        import ctypes
        # SetProcessDPIAware so we get real physical coords
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass
        # GetScaleFactorForDevice returns percentage (100, 125, 150, etc.)
        scale_pct = ctypes.windll.shcore.GetScaleFactorForDevice(0)
        return scale_pct / 100.0
    except Exception:
        return 1.0


async def take_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    region = args.get("region") or {}
    include_cursor = bool(args.get("includeCursor", True))
    try:
        import mss  # type: ignore
    except Exception:
        raise RuntimeError("mss not installed")
    with mss.mss() as sct:
        if all(k in region for k in ("x", "y", "width", "height")):
            # Region coords come from browser CSS pixels (logical).
            # mss operates in physical pixels, so scale by DPI factor.
            scale = _get_dpi_scale()
            monitor = {
                "left": int(int(region["x"]) * scale),
                "top": int(int(region["y"]) * scale),
                "width": int(int(region["width"]) * scale),
                "height": int(int(region["height"]) * scale),
            }
        else:
            monitor = sct.monitors[0]
        sct_img = sct.grab(monitor)
        tmpdir = os.path.join(os.path.expanduser("~"), "Documents", "StuardAI", "media", "screenshots")
        os.makedirs(tmpdir, exist_ok=True)
        file_path = os.path.join(tmpdir, f"screenshot_{int(time.time()*1000)}.png")
        save_mss_png_with_cursor(sct_img, monitor, file_path, include_cursor)
    return {"ok": True, "filePath": file_path}


async def capture_screen_to_file(args: Dict[str, Any]) -> Dict[str, Any]:
    file_path = str(args.get("filePath") or "screenshot.png")
    region = args.get("region") or {}
    include_cursor = bool(args.get("includeCursor", True))
    d = os.path.dirname(file_path)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    try:
        import mss  # type: ignore
    except Exception:
        raise RuntimeError("mss not installed")
    with mss.mss() as sct:
        if all(k in region for k in ("x", "y", "width", "height")):
            scale = _get_dpi_scale()
            monitor = {
                "left": int(int(region["x"]) * scale),
                "top": int(int(region["y"]) * scale),
                "width": int(int(region["width"]) * scale),
                "height": int(int(region["height"]) * scale),
            }
        else:
            monitor = sct.monitors[0]
        sct_img = sct.grab(monitor)
        save_mss_png_with_cursor(sct_img, monitor, file_path, include_cursor)
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
