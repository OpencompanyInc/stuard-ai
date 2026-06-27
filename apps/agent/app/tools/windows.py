from __future__ import annotations

import asyncio
import ctypes
import shutil
import subprocess
import sys
from typing import Any, Dict


async def get_foreground_window(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Get the currently focused/foreground window title and handle.

    Useful for saving the active window before opening a custom UI,
    so focus can be restored later using bring_window_to_foreground.
    """
    try:
        if sys.platform.startswith("win"):
            user32 = ctypes.windll.user32
            hwnd = user32.GetForegroundWindow()
            if hwnd:
                length = int(user32.GetWindowTextLengthW(hwnd))
                if length:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buf, length + 1)
                    title = (buf.value or "").strip()
                    return {"ok": True, "title": title, "hwnd": hwnd}
            return {"ok": True, "title": "", "hwnd": 0}
        elif sys.platform == "darwin":
            script = '''
tell application "System Events"
    set fp to first application process whose frontmost is true
    set appName to name of fp
    try
        set winName to name of front window of fp
    on error
        set winName to ""
    end try
end tell
return appName & "|" & winName
'''.strip()
            completed = await asyncio.to_thread(
                subprocess.run,
                ["osascript", "-l", "AppleScript"],
                input=script,
                text=True,
                capture_output=True,
            )
            if completed.returncode == 0:
                out = (completed.stdout or "").strip()
                parts = out.split("|", 1)
                app_name = parts[0] if parts else ""
                win_name = parts[1] if len(parts) > 1 else ""
                title = win_name if win_name else app_name
                return {"ok": True, "title": title, "appName": app_name, "windowName": win_name}
            return {"ok": True, "title": ""}
        else:
            # Linux: use xdotool
            xdotool = shutil.which("xdotool")
            if xdotool:
                completed = await asyncio.to_thread(
                    subprocess.run,
                    [xdotool, "getactivewindow", "getwindowname"],
                    text=True,
                    capture_output=True,
                )
                if completed.returncode == 0:
                    title = (completed.stdout or "").strip()
                    return {"ok": True, "title": title}
            return {"ok": True, "title": ""}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def list_open_windows(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    wins = []
    try:
        if sys.platform.startswith("win"):
            user32 = ctypes.windll.user32
            EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
            wins_tmp = []

            def _callback(hwnd, lparam):  # type: ignore[no-redef]
                try:
                    if user32.IsWindowVisible(hwnd):
                        length = int(user32.GetWindowTextLengthW(hwnd))
                        if length:
                            buf = ctypes.create_unicode_buffer(length + 1)
                            user32.GetWindowTextW(hwnd, buf, length + 1)
                            title = (buf.value or "").strip()
                            if title:
                                minimized = bool(user32.IsIconic(hwnd))
                                maximized = bool(user32.IsZoomed(hwnd))
                                wins_tmp.append({"title": title, "minimized": minimized, "maximized": maximized})
                except Exception:
                    pass
                return True

            user32.EnumWindows(EnumWindowsProc(_callback), 0)
            wins = wins_tmp
        elif sys.platform == "darwin":
            script = '''
set windowTitles to {}
tell application "System Events"
    set procs to (processes where background only is false)
    repeat with p in procs
        try
            repeat with w in windows of p
                set t to name of w as text
                if t is not "" then copy t to end of windowTitles
            end repeat
        end try
    end repeat
end tell
set AppleScript's text item delimiters to linefeed
return windowTitles as text
'''.strip()
            completed = await asyncio.to_thread(
                subprocess.run,
                ["osascript", "-l", "AppleScript"],
                input=script,
                text=True,
                capture_output=True,
            )
            if completed.returncode == 0:
                titles = [line.strip() for line in (completed.stdout or "").splitlines() if line.strip()]
                wins = [{"title": t} for t in titles]
            else:
                wins = []
        else:
            exe = shutil.which("wmctrl")
            if exe:
                completed = await asyncio.to_thread(
                    subprocess.run,
                    [exe, "-l"],
                    text=True,
                    capture_output=True,
                )
                if completed.returncode == 0:
                    for line in (completed.stdout or "").splitlines():
                        try:
                            parts = line.split(None, 3)
                            if len(parts) == 4:
                                _wid, _desk, _host, title = parts
                                title = title.strip()
                                if title:
                                    wins.append({"title": title})
                        except Exception:
                            continue
            else:
                wins = []
        return {"ok": True, "windows": wins}
    except Exception as _e:
        return {"ok": False, "error": str(_e)}


async def bring_window_to_foreground(args: Dict[str, Any]) -> Dict[str, Any]:
    target = str(args.get("title") or "").strip()
    if not target:
        raise ValueError("missing title")
    ok = False
    try:
        if sys.platform.startswith("win"):
            user32 = ctypes.windll.user32
            target_lower = target.lower()
            best_hwnd = None
            best_len = 0

            EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

            def _callback(hwnd, lparam):  # type: ignore[no-redef]
                nonlocal best_hwnd, best_len
                try:
                    if user32.IsWindowVisible(hwnd):
                        length = int(user32.GetWindowTextLengthW(hwnd))
                        if length:
                            buf = ctypes.create_unicode_buffer(length + 1)
                            user32.GetWindowTextW(hwnd, buf, length + 1)
                            title = (buf.value or "").strip()
                            if title:
                                tl = title.lower()
                                if tl == target_lower or target_lower in tl:
                                    if len(title) >= best_len:
                                        best_len = len(title)
                                        best_hwnd = hwnd
                except Exception:
                    pass
                return True

            user32.EnumWindows(EnumWindowsProc(_callback), 0)
            if best_hwnd:
                SW_RESTORE = 9
                try:
                    user32.ShowWindow(best_hwnd, SW_RESTORE)
                except Exception:
                    pass
                ok = bool(user32.SetForegroundWindow(best_hwnd))
            else:
                ok = False
        elif sys.platform == "darwin":
            esc = target.replace("\\", "\\\\").replace('"', '\\"')
            script = f'''
on bringByTitle(t)
    tell application "System Events"
        set procs to (processes where background only is false)
        repeat with p in procs
            try
                repeat with w in windows of p
                    set nm to name of w as text
                    if nm contains t then
                        set frontmost of p to true
                        try
                            perform action "AXRaise" of w
                        end try
                        return name of p
                    end if
                end repeat
            end try
        end repeat
    end tell
    return ""
end bringByTitle
return bringByTitle("{esc}")
'''.strip()
            completed = await asyncio.to_thread(
                subprocess.run,
                ["osascript", "-l", "AppleScript"],
                input=script,
                text=True,
                capture_output=True,
            )
            ok = completed.returncode == 0 and bool((completed.stdout or "").strip())
        else:
            exe = shutil.which("wmctrl")
            found = None
            if exe:
                comp = await asyncio.to_thread(subprocess.run, [exe, "-l"], text=True, capture_output=True)
                if comp.returncode == 0:
                    tgt_lower = target.lower()
                    for line in (comp.stdout or "").splitlines():
                        parts = line.split(None, 3)
                        if len(parts) == 4:
                            wid, _, _, title = parts
                            if tgt_lower in (title or "").lower():
                                found = wid
                                break
                if found:
                    act = await asyncio.to_thread(subprocess.run, [exe, "-ia", found], text=True, capture_output=True)
                    ok = act.returncode == 0
            if not ok:
                xdotool = shutil.which("xdotool")
                if xdotool:
                    comp = await asyncio.to_thread(subprocess.run, [xdotool, "search", "--name", target], text=True, capture_output=True)
                    wid = (comp.stdout or "").splitlines()[0].strip() if comp.returncode == 0 and (comp.stdout or "").strip() else None
                    if wid:
                        act = await asyncio.to_thread(subprocess.run, [xdotool, "windowactivate", wid], text=True, capture_output=True)
                        ok = act.returncode == 0
        return {"ok": ok}
    except Exception as _e:
        return {"ok": False, "error": str(_e)}
