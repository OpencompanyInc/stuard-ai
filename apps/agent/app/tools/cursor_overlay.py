from __future__ import annotations

import platform
from typing import Any


_CURSOR_POINTS = [
    (0, 0),
    (0, 24),
    (6, 18),
    (10, 30),
    (14, 28),
    (10, 16),
    (18, 16),
]
_DPI_AWARENESS_SET = False


def _set_process_dpi_aware() -> None:
    global _DPI_AWARENESS_SET
    if _DPI_AWARENESS_SET:
        return
    _DPI_AWARENESS_SET = True
    if platform.system() != "Windows":
        return
    try:
        import ctypes

        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def get_cursor_position() -> tuple[int, int] | None:
    _set_process_dpi_aware()
    try:
        import pyautogui as pag  # type: ignore

        pos = pag.position()
        return int(pos.x), int(pos.y)
    except Exception:
        pass

    if platform.system() == "Windows":
        try:
            import ctypes
            from ctypes import wintypes

            point = wintypes.POINT()
            if ctypes.windll.user32.GetCursorPos(ctypes.byref(point)):
                return int(point.x), int(point.y)
        except Exception:
            pass

    return None


def _cursor_points_at(x: int, y: int, scale: float) -> list[tuple[int, int]]:
    s = max(0.5, float(scale))
    return [(x + int(round(px * s)), y + int(round(py * s))) for px, py in _CURSOR_POINTS]


def draw_cursor_on_pil_image(image: Any, capture_left: int, capture_top: int, scale: float = 1.0) -> bool:
    pos = get_cursor_position()
    if pos is None:
        return False

    x = int(round((pos[0] - capture_left) * scale))
    y = int(round((pos[1] - capture_top) * scale))
    width, height = image.size
    if x < -32 or y < -32 or x > width + 32 or y > height + 32:
        return False

    from PIL import ImageDraw  # type: ignore

    points = _cursor_points_at(x, y, scale)
    draw = ImageDraw.Draw(image)
    line_width = max(1, int(round(2 * max(1.0, scale))))
    draw.polygon(points, fill=(255, 255, 255), outline=(0, 0, 0))
    draw.line(points + [points[0]], fill=(0, 0, 0), width=line_width)
    return True


def save_mss_png_with_cursor(sct_img: Any, monitor: dict[str, Any], output: str, include_cursor: bool = True) -> None:
    if include_cursor:
        try:
            from PIL import Image  # type: ignore

            image = Image.frombytes("RGB", sct_img.size, sct_img.rgb)
            draw_cursor_on_pil_image(
                image,
                int(monitor.get("left") or 0),
                int(monitor.get("top") or 0),
            )
            image.save(output, format="PNG")
            return
        except Exception:
            pass

    from mss import tools as msstools  # type: ignore

    msstools.to_png(sct_img.rgb, sct_img.size, output=output)


def draw_cursor_on_bgr_frame(frame: Any, capture_left: int, capture_top: int, scale: float = 1.0) -> bool:
    pos = get_cursor_position()
    if pos is None:
        return False

    x = int(round((pos[0] - capture_left) * scale))
    y = int(round((pos[1] - capture_top) * scale))
    height, width = frame.shape[:2]
    if x < -32 or y < -32 or x > width + 32 or y > height + 32:
        return False

    import cv2  # type: ignore
    import numpy as np  # type: ignore

    points = np.array(_cursor_points_at(x, y, scale), dtype=np.int32)
    line_width = max(1, int(round(2 * max(1.0, scale))))
    cv2.fillPoly(frame, [points], (255, 255, 255))
    cv2.polylines(frame, [points], True, (0, 0, 0), line_width, lineType=cv2.LINE_AA)
    return True
