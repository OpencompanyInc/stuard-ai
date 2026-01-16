"""
Screen Recording and System Audio Capture Tools

This module provides tools for:
- capture_screen: Record the desktop screen (full, monitor, window, or region)
- capture_system_audio: Record system audio output (loopback recording)

Both tools support:
- Fixed duration mode: Record for a specified duration
- Until stop mode: Record until stop_* is called
"""

from __future__ import annotations

import asyncio
import os
import platform
import tempfile
import threading
import time
import uuid
from typing import Any, Dict, Callable, Awaitable, Optional, List

# Global registry of active capture sessions
_active_screen_sessions: Dict[str, threading.Event] = {}
_active_screen_recordings: Dict[str, Dict[str, Any]] = {}
_active_audio_sessions: Dict[str, threading.Event] = {}
_active_audio_recordings: Dict[str, Dict[str, Any]] = {}
_sessions_lock = threading.Lock()


def _tmp_dir() -> str:
    base = os.path.join(tempfile.gettempdir(), "stuardai")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        pass
    return base


async def describe_screen_capture_capabilities(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    List available monitors and windows for screen capture.
    """
    monitors: List[Dict[str, Any]] = []
    windows: List[Dict[str, Any]] = []

    # Get monitor info using mss
    try:
        import mss
        with mss.mss() as sct:
            for i, mon in enumerate(sct.monitors):
                if i == 0:
                    # Index 0 is the "all monitors" virtual monitor
                    continue
                monitors.append({
                    "id": i - 1,  # 0-indexed for user convenience
                    "name": f"Monitor {i}",
                    "width": mon["width"],
                    "height": mon["height"],
                    "left": mon["left"],
                    "top": mon["top"],
                    "primary": i == 1,  # First real monitor is usually primary
                })
    except Exception as e:
        print(f"[screen_capture] Error getting monitors: {e}")

    # Get window list (Windows-specific for now)
    if platform.system() == "Windows":
        try:
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32

            def _enum_windows_callback(hwnd, lparam):
                if user32.IsWindowVisible(hwnd):
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buf = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buf, length + 1)
                        title = buf.value
                        if title.strip():
                            # Get process ID
                            pid = wintypes.DWORD()
                            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                            windows.append({
                                "title": title,
                                "handle": hwnd,
                                "pid": pid.value,
                            })
                return True

            EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
            user32.EnumWindows(EnumWindowsProc(_enum_windows_callback), 0)
        except Exception as e:
            print(f"[screen_capture] Error getting windows: {e}")

    return {
        "monitors": monitors,
        "windows": windows,
    }


async def capture_screen(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    """
    Record the screen (full screen, specific monitor, window, or region).

    Args:
        mode: 'fixed' | 'until_stop'
        durationMs: Duration for fixed mode
        target: 'fullscreen' | 'monitor' | 'window' | 'region'
        monitorId: Monitor index when target=monitor
        windowTitle: Window title when target=window
        region: {x, y, width, height} when target=region
        includeSystemAudio: Include system audio in recording
        fps: Frames per second (1-60)
        quality: 'low' | 'medium' | 'high'
        filePath: Output file path
        sessionId: Session ID for until_stop mode
        maxDurationMs: Safety limit for until_stop mode
        silenceThreshold: Audio RMS threshold for silence detection (0.0-1.0, default 0.01)
        silenceDurationMs: Duration of silence before stopping (ms, default 2000)
    """
    mode = str(args.get("mode") or "fixed").strip().lower()
    duration_ms = int(args.get("durationMs") or 5000)
    target = str(args.get("target") or "fullscreen").strip().lower()
    monitor_id = args.get("monitorId")
    window_title = str(args.get("windowTitle") or "").strip()
    region = args.get("region") or {}
    include_audio = bool(args.get("includeSystemAudio", False))
    fps = int(args.get("fps") or 30)
    quality = str(args.get("quality") or "medium").strip().lower()
    explicit_path = str(args.get("filePath") or "").strip()
    session_id = str(args.get("sessionId") or "").strip() or str(uuid.uuid4())[:8]
    max_duration_ms = int(args.get("maxDurationMs") or 7200000)
    silence_threshold = float(args.get("silenceThreshold") or 0.01)
    silence_duration_ms = int(args.get("silenceDurationMs") or 2000)

    # Validate
    if mode not in ("fixed", "until_stop"):
        raise ValueError("mode must be 'fixed' or 'until_stop'")
    if target not in ("fullscreen", "monitor", "window", "region"):
        raise ValueError("target must be 'fullscreen', 'monitor', 'window', or 'region'")
    if fps < 1 or fps > 60:
        raise ValueError("fps must be between 1 and 60")
    if mode == "fixed" and duration_ms <= 0:
        raise ValueError("durationMs must be > 0 for fixed mode")

    # For until_stop mode, use max_duration_ms as the limit
    if mode == "until_stop":
        duration_ms = max_duration_ms

    # Create stop event
    stop_event = threading.Event()
    with _sessions_lock:
        _active_screen_sessions[session_id] = stop_event

    out_dir = _tmp_dir()
    path = explicit_path or os.path.join(out_dir, f"screen_{int(time.time()*1000)}.mp4")

    if emit:
        await emit("preparing", {
            "sessionId": session_id,
            "mode": mode,
            "target": target,
            "fps": fps,
            "quality": quality,
            "includeSystemAudio": include_audio,
        })

    # Get current event loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    # Store recording info
    recording_info: Dict[str, Any] = {
        "path": path,
        "target": target,
        "fps": fps,
        "quality": quality,
        "includeSystemAudio": include_audio,
        "started_at": time.time(),
        "completed": False,
        "error": None,
    }

    with _sessions_lock:
        _active_screen_recordings[session_id] = recording_info

    def _background_screen_work():
        """Background thread for screen recording."""
        try:
            import mss
            import cv2
            import numpy as np
        except ImportError as e:
            recording_info["error"] = f"Missing dependency: {e}"
            return

        print(f"[screen_capture] Starting session '{session_id}', target={target}, fps={fps}")

        # Determine capture region
        with mss.mss() as sct:
            if target == "fullscreen":
                # All monitors combined
                monitor = sct.monitors[0]
            elif target == "monitor":
                idx = int(monitor_id or 0) + 1  # mss uses 1-indexed for real monitors
                if idx < 1 or idx >= len(sct.monitors):
                    idx = 1
                monitor = sct.monitors[idx]
            elif target == "region":
                monitor = {
                    "left": int(region.get("x", 0)),
                    "top": int(region.get("y", 0)),
                    "width": int(region.get("width", 1920)),
                    "height": int(region.get("height", 1080)),
                }
            elif target == "window":
                # Try to find window position (Windows only for now)
                monitor = _get_window_rect(window_title) or sct.monitors[1]
            else:
                monitor = sct.monitors[1]

        # Apply quality scaling
        width = monitor["width"]
        height = monitor["height"]
        if quality == "low":
            scale = min(1.0, 1280 / max(width, height))
        elif quality == "medium":
            scale = min(1.0, 1920 / max(width, height))
        else:  # high
            scale = 1.0

        out_width = int(width * scale)
        out_height = int(height * scale)
        # Ensure even dimensions for video codec
        out_width = out_width if out_width % 2 == 0 else out_width + 1
        out_height = out_height if out_height % 2 == 0 else out_height + 1

        # Initialize video writer
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(path, fourcc, fps, (out_width, out_height))

        if not out.isOpened():
            # Fallback to AVI
            fallback_path = path.rsplit(".", 1)[0] + ".avi"
            fourcc = cv2.VideoWriter_fourcc(*"XVID")
            out = cv2.VideoWriter(fallback_path, fourcc, fps, (out_width, out_height))
            recording_info["path"] = fallback_path

        if not out.isOpened():
            recording_info["error"] = "video_writer_failed"
            return

        # Start audio capture if requested
        audio_thread = None
        audio_path = None
        audio_stop_event = threading.Event()
        if include_audio:
            audio_path = path.rsplit(".", 1)[0] + "_audio.wav"
            audio_thread = threading.Thread(
                target=_capture_system_audio_worker,
                args=(audio_path, duration_ms, audio_stop_event, session_id + "_audio", emit, loop, None, silence_threshold, silence_duration_ms),
                daemon=True
            )
            audio_thread.start()

        start = time.monotonic()
        frame_interval = 1.0 / fps
        next_frame_time = start
        next_emit_time = start

        try:
            with mss.mss() as sct:
                while (time.monotonic() - start) * 1000.0 < duration_ms:
                    # Check stop signal
                    if stop_event.is_set():
                        print(f"[screen_capture] Stop signal detected!")
                        break

                    now = time.monotonic()

                    # Capture frame at the right interval
                    if now >= next_frame_time:
                        try:
                            img = sct.grab(monitor)
                            frame = np.array(img)
                            # Convert BGRA to BGR
                            frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
                            # Resize if needed
                            if scale != 1.0:
                                frame = cv2.resize(frame, (out_width, out_height))
                            out.write(frame)
                        except Exception as e:
                            print(f"[screen_capture] Frame capture error: {e}")

                        next_frame_time = now + frame_interval

                    # Emit progress
                    if emit and loop and now - next_emit_time >= 0.5:
                        next_emit_time = now
                        elapsed_ms = int((now - start) * 1000)
                        try:
                            loop.call_soon_threadsafe(
                                asyncio.create_task,
                                emit("recording_progress", {
                                    "sessionId": session_id,
                                    "elapsedMs": elapsed_ms,
                                    "mode": mode,
                                })
                            )
                        except Exception:
                            pass

                    # Small sleep to prevent busy loop
                    time.sleep(0.001)

        finally:
            out.release()

            # Stop audio capture
            if audio_thread:
                audio_stop_event.set()
                audio_thread.join(timeout=2.0)

            # Merge audio and video if both exist
            if include_audio and audio_path and os.path.isfile(audio_path):
                final_path = recording_info["path"]
                merged_path = final_path.rsplit(".", 1)[0] + "_merged.mp4"
                try:
                    _merge_audio_video(recording_info["path"], audio_path, merged_path)
                    # Replace original with merged
                    if os.path.isfile(merged_path):
                        os.replace(merged_path, final_path)
                        recording_info["hasAudio"] = True
                except Exception as e:
                    print(f"[screen_capture] Failed to merge audio: {e}")
                    recording_info["hasAudio"] = False

                # Clean up temp audio
                try:
                    os.remove(audio_path)
                except Exception:
                    pass

        recording_info["completed"] = True
        print(f"[screen_capture] Saved to {recording_info['path']}")

        # Clean up session
        with _sessions_lock:
            _active_screen_sessions.pop(session_id, None)

    # For until_stop mode, start in background and return immediately
    if mode == "until_stop":
        thread = threading.Thread(target=_background_screen_work, daemon=True)
        thread.start()

        if emit:
            await emit("recording", {
                "sessionId": session_id,
                "mode": mode,
                "filePath": path,
            })

        return {
            "ok": True,
            "sessionId": session_id,
            "filePath": path,
            "mode": mode,
            "status": "recording",
            "mimeType": "video/mp4",
            "hasAudio": include_audio,
        }

    # For fixed mode, run synchronously
    if emit:
        await emit("recording", {
            "sessionId": session_id,
            "mode": mode,
            "filePath": path,
            "durationMs": duration_ms,
        })

    await asyncio.to_thread(_background_screen_work)

    # Clean up
    with _sessions_lock:
        _active_screen_sessions.pop(session_id, None)
        _active_screen_recordings.pop(session_id, None)

    return {
        "ok": not recording_info.get("error"),
        "sessionId": session_id,
        "filePath": recording_info.get("path"),
        "mode": mode,
        "status": "completed",
        "mimeType": "video/mp4",
        "hasAudio": recording_info.get("hasAudio", False),
        "error": recording_info.get("error"),
    }


async def stop_screen_capture(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    """Stop an active screen capture session."""
    session_id = str(args.get("sessionId") or "").strip()
    if not session_id:
        raise ValueError("sessionId is required")

    print(f"[stop_screen_capture] Looking for session: {session_id}")

    with _sessions_lock:
        stop_event = _active_screen_sessions.get(session_id)
        recording_info = _active_screen_recordings.get(session_id)
        was_active = stop_event is not None

    if stop_event:
        stop_event.set()

    # Wait for recording to finish
    file_path = None
    if recording_info:
        file_path = recording_info.get("path")
        for _ in range(40):  # Wait up to 2 seconds
            if recording_info.get("completed") or recording_info.get("error"):
                break
            await asyncio.sleep(0.05)

        with _sessions_lock:
            _active_screen_recordings.pop(session_id, None)

    if emit:
        await emit("stop_requested", {"sessionId": session_id, "wasActive": was_active})

    return {
        "ok": True,
        "sessionId": session_id,
        "wasActive": was_active,
        "filePath": file_path,
    }


async def describe_system_audio_capabilities(args: Dict[str, Any]) -> Dict[str, Any]:
    """List available loopback/system audio devices."""
    devices: List[Dict[str, Any]] = []
    supported = False
    note = None
    plat = platform.system()

    if plat == "Windows":
        try:
            import pyaudiowpatch as pyaudio

            p = pyaudio.PyAudio()
            try:
                wasapi_info = p.get_host_api_info_by_type(pyaudio.paWASAPI)
                default_output_idx = wasapi_info.get("defaultOutputDevice")

                for i in range(p.get_device_count()):
                    try:
                        device = p.get_device_info_by_index(i)
                        # Look for loopback devices
                        if device.get("isLoopbackDevice"):
                            devices.append({
                                "id": str(i),
                                "name": device.get("name", f"Device {i}"),
                                "isDefault": i == default_output_idx,
                                "isLoopback": True,
                            })
                    except Exception:
                        continue

                supported = len(devices) > 0
            finally:
                p.terminate()
        except ImportError:
            note = "pyaudiowpatch not installed. Install with: pip install pyaudiowpatch"
        except Exception as e:
            note = f"Error initializing audio: {e}"

    elif plat == "Darwin":  # macOS
        note = "macOS requires a virtual audio device like BlackHole. Install BlackHole and configure it in Audio MIDI Setup."
        try:
            import sounddevice as sd
            for i, dev in enumerate(sd.query_devices()):
                name = str(dev.get("name", ""))
                # Look for virtual audio devices
                if any(x in name.lower() for x in ["blackhole", "soundflower", "loopback"]):
                    devices.append({
                        "id": str(i),
                        "name": name,
                        "isDefault": False,
                        "isLoopback": True,
                    })
            supported = len(devices) > 0
        except Exception:
            pass

    else:  # Linux
        note = "Linux system audio capture requires PulseAudio/PipeWire monitor sources."
        try:
            import sounddevice as sd
            for i, dev in enumerate(sd.query_devices()):
                name = str(dev.get("name", ""))
                if "monitor" in name.lower():
                    devices.append({
                        "id": str(i),
                        "name": name,
                        "isDefault": False,
                        "isLoopback": True,
                    })
            supported = len(devices) > 0
        except Exception:
            pass

    return {
        "supported": supported,
        "platform": plat,
        "devices": devices,
        "note": note,
    }


async def capture_system_audio(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    """
    Capture system audio output (loopback recording).

    Args:
        mode: 'fixed' | 'until_stop'
        durationMs: Duration for fixed mode
        device: Loopback device name/ID
        filePath: Output file path
        sessionId: Session ID for until_stop mode
        maxDurationMs: Safety limit
        format: 'wav' | 'mp3'
    """
    mode = str(args.get("mode") or "fixed").strip().lower()
    duration_ms = int(args.get("durationMs") or 5000)
    device = args.get("device")
    explicit_path = str(args.get("filePath") or "").strip()
    session_id = str(args.get("sessionId") or "").strip() or str(uuid.uuid4())[:8]
    max_duration_ms = int(args.get("maxDurationMs") or 7200000)
    output_format = str(args.get("format") or "wav").strip().lower()

    if mode not in ("fixed", "until_stop"):
        raise ValueError("mode must be 'fixed' or 'until_stop'")
    if mode == "fixed" and duration_ms <= 0:
        raise ValueError("durationMs must be > 0 for fixed mode")

    if mode == "until_stop":
        duration_ms = max_duration_ms

    # Create stop event
    stop_event = threading.Event()
    with _sessions_lock:
        _active_audio_sessions[session_id] = stop_event

    out_dir = _tmp_dir()
    ext = "wav" if output_format == "wav" else "mp3"
    path = explicit_path or os.path.join(out_dir, f"system_audio_{int(time.time()*1000)}.{ext}")

    if emit:
        await emit("preparing", {
            "sessionId": session_id,
            "mode": mode,
            "format": output_format,
        })

    # Get current event loop
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    # Store recording info
    recording_info: Dict[str, Any] = {
        "path": path,
        "format": output_format,
        "started_at": time.time(),
        "completed": False,
        "error": None,
    }

    with _sessions_lock:
        _active_audio_recordings[session_id] = recording_info

    def _background_audio_work():
        _capture_system_audio_worker(path, duration_ms, stop_event, session_id, emit, loop, recording_info)

    # For until_stop mode, start in background and return immediately
    if mode == "until_stop":
        thread = threading.Thread(target=_background_audio_work, daemon=True)
        thread.start()

        if emit:
            await emit("recording", {
                "sessionId": session_id,
                "mode": mode,
                "filePath": path,
            })

        return {
            "ok": True,
            "sessionId": session_id,
            "filePath": path,
            "mode": mode,
            "status": "recording",
            "mimeType": "audio/wav" if output_format == "wav" else "audio/mpeg",
        }

    # For fixed mode, run synchronously
    if emit:
        await emit("recording", {
            "sessionId": session_id,
            "mode": mode,
            "filePath": path,
            "durationMs": duration_ms,
        })

    await asyncio.to_thread(_background_audio_work)

    # Clean up
    with _sessions_lock:
        _active_audio_sessions.pop(session_id, None)
        _active_audio_recordings.pop(session_id, None)

    return {
        "ok": not recording_info.get("error"),
        "sessionId": session_id,
        "filePath": recording_info.get("path"),
        "mode": mode,
        "status": "completed",
        "mimeType": "audio/wav" if output_format == "wav" else "audio/mpeg",
        "durationMs": recording_info.get("durationMs"),
        "error": recording_info.get("error"),
    }


async def stop_system_audio(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    """Stop an active system audio capture session."""
    session_id = str(args.get("sessionId") or "").strip()
    if not session_id:
        raise ValueError("sessionId is required")

    print(f"[stop_system_audio] Looking for session: {session_id}")

    with _sessions_lock:
        stop_event = _active_audio_sessions.get(session_id)
        recording_info = _active_audio_recordings.get(session_id)
        was_active = stop_event is not None

    if stop_event:
        stop_event.set()

    # Wait for recording to finish
    file_path = None
    if recording_info:
        file_path = recording_info.get("path")
        for _ in range(40):  # Wait up to 2 seconds
            if recording_info.get("completed") or recording_info.get("error"):
                break
            await asyncio.sleep(0.05)

        with _sessions_lock:
            _active_audio_recordings.pop(session_id, None)

    if emit:
        await emit("stop_requested", {"sessionId": session_id, "wasActive": was_active})

    return {
        "ok": True,
        "sessionId": session_id,
        "wasActive": was_active,
        "filePath": file_path,
    }


# Helper functions

def _get_window_rect(window_title: str) -> Optional[Dict[str, int]]:
    """Get window rectangle by title (Windows only)."""
    if platform.system() != "Windows" or not window_title:
        return None

    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32

        found_hwnd = None

        def _enum_callback(hwnd, lparam):
            nonlocal found_hwnd
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buf, length + 1)
                    if window_title.lower() in buf.value.lower():
                        found_hwnd = hwnd
                        return False
            return True

        EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        user32.EnumWindows(EnumWindowsProc(_enum_callback), 0)

        if found_hwnd:
            rect = wintypes.RECT()
            if user32.GetWindowRect(found_hwnd, ctypes.byref(rect)):
                return {
                    "left": rect.left,
                    "top": rect.top,
                    "width": rect.right - rect.left,
                    "height": rect.bottom - rect.top,
                }
    except Exception as e:
        print(f"[screen_capture] Error finding window: {e}")

    return None


def _capture_system_audio_worker(
    path: str,
    duration_ms: int,
    stop_event: threading.Event,
    session_id: str,
    emit: Optional[Callable] = None,
    loop: Optional[asyncio.AbstractEventLoop] = None,
    recording_info: Optional[Dict[str, Any]] = None,
    silence_threshold: float = 0.01,
    silence_duration_ms: int = 2000,
) -> None:
    """Worker function for capturing system audio."""
    plat = platform.system()

    if plat == "Windows":
        _capture_wasapi_loopback(path, duration_ms, stop_event, session_id, emit, loop, recording_info, silence_threshold, silence_duration_ms)
    else:
        # For macOS/Linux, try to use sounddevice with a virtual device
        _capture_generic_loopback(path, duration_ms, stop_event, session_id, emit, loop, recording_info, silence_threshold, silence_duration_ms)


def _capture_wasapi_loopback(
    path: str,
    duration_ms: int,
    stop_event: threading.Event,
    session_id: str,
    emit: Optional[Callable] = None,
    loop: Optional[asyncio.AbstractEventLoop] = None,
    recording_info: Optional[Dict[str, Any]] = None,
    silence_threshold: float = 0.01,
    silence_duration_ms: int = 2000,
) -> None:
    """Capture system audio using WASAPI loopback on Windows."""
    try:
        import pyaudiowpatch as pyaudio
        import wave
        import numpy as np
    except ImportError:
        if recording_info:
            recording_info["error"] = "pyaudiowpatch not installed"
        return

    print(f"[system_audio] Starting WASAPI loopback capture for session '{session_id}'")

    p = pyaudio.PyAudio()
    try:
        # Find loopback device
        wasapi_info = p.get_host_api_info_by_type(pyaudio.paWASAPI)
        default_speakers = p.get_device_info_by_index(wasapi_info["defaultOutputDevice"])

        loopback_device = None
        for i in range(p.get_device_count()):
            try:
                device = p.get_device_info_by_index(i)
                if device.get("isLoopbackDevice") and default_speakers["name"] in device.get("name", ""):
                    loopback_device = device
                    break
            except Exception:
                continue

        if not loopback_device:
            if recording_info:
                recording_info["error"] = "No loopback device found"
            return

        # Open stream
        channels = int(loopback_device.get("maxInputChannels", 2))
        sample_rate = int(loopback_device.get("defaultSampleRate", 44100))

        stream = p.open(
            format=pyaudio.paInt16,
            channels=channels,
            rate=sample_rate,
            input=True,
            input_device_index=loopback_device["index"],
            frames_per_buffer=1024,
        )

        # Record
        frames = []
        start = time.monotonic()
        next_emit_time = start
        duration_s = duration_ms / 1000.0
        
        # Silence detection state
        silence_start_time = None
        silence_duration_s = silence_duration_ms / 1000.0

        try:
            while (time.monotonic() - start) < duration_s:
                if stop_event.is_set():
                    print(f"[system_audio] Stop signal detected!")
                    break

                try:
                    data = stream.read(1024, exception_on_overflow=False)
                    frames.append(data)
                    
                    # Silence detection
                    if silence_threshold > 0 and silence_duration_s > 0:
                        try:
                            # Convert bytes to numpy array for RMS calculation
                            audio_array = np.frombuffer(data, dtype=np.int16)
                            # Normalize to [-1, 1] range
                            audio_float = audio_array.astype(np.float32) / 32768.0
                            # Calculate RMS
                            rms = float(np.sqrt(np.mean(np.square(audio_float))))
                            
                            is_silent = rms < silence_threshold
                            
                            if is_silent:
                                if silence_start_time is None:
                                    silence_start_time = time.monotonic()
                                    print(f"[system_audio] Silence detected at {(time.monotonic() - start):.1f}s")
                            else:
                                if silence_start_time is not None:
                                    print(f"[system_audio] Sound detected, resetting silence timer at {(time.monotonic() - start):.1f}s")
                                    silence_start_time = None
                            
                            # Check if silence duration exceeded
                            if silence_start_time is not None:
                                silence_elapsed = time.monotonic() - silence_start_time
                                if silence_elapsed >= silence_duration_s:
                                    print(f"[system_audio] Silence duration ({silence_elapsed:.1f}s) exceeded threshold, stopping")
                                    if recording_info:
                                        recording_info["stopped_by"] = "silence"
                                    break
                        except Exception as e:
                            print(f"[system_audio] Error in silence detection: {e}")
                except Exception:
                    pass

                # Emit progress
                now = time.monotonic()
                if emit and loop and now - next_emit_time >= 0.5:
                    next_emit_time = now
                    elapsed_ms = int((now - start) * 1000)
                    try:
                        loop.call_soon_threadsafe(
                            asyncio.create_task,
                            emit("recording_progress", {
                                "sessionId": session_id,
                                "elapsedMs": elapsed_ms,
                                "mode": "capture",
                            })
                        )
                    except Exception:
                        pass
        finally:
            stream.stop_stream()
            stream.close()

        # Save to WAV
        if frames:
            with wave.open(path, "wb") as wf:
                wf.setnchannels(channels)
                wf.setsampwidth(p.get_sample_size(pyaudio.paInt16))
                wf.setframerate(sample_rate)
                wf.writeframes(b"".join(frames))

            actual_duration = len(frames) * 1024 / sample_rate * 1000
            if recording_info:
                recording_info["completed"] = True
                recording_info["durationMs"] = int(actual_duration)
            print(f"[system_audio] Saved {len(frames)} frames to {path}")
        else:
            if recording_info:
                recording_info["error"] = "No audio data captured"

    except Exception as e:
        print(f"[system_audio] Error: {e}")
        if recording_info:
            recording_info["error"] = str(e)
    finally:
        p.terminate()


def _capture_generic_loopback(
    path: str,
    duration_ms: int,
    stop_event: threading.Event,
    session_id: str,
    emit: Optional[Callable] = None,
    loop: Optional[asyncio.AbstractEventLoop] = None,
    recording_info: Optional[Dict[str, Any]] = None,
    silence_threshold: float = 0.01,
    silence_duration_ms: int = 2000,
) -> None:
    """Generic loopback capture for macOS/Linux using sounddevice."""
    try:
        import sounddevice as sd
        import soundfile as sf
        import numpy as np
    except ImportError:
        if recording_info:
            recording_info["error"] = "sounddevice/soundfile not installed"
        return

    print(f"[system_audio] Starting generic loopback capture for session '{session_id}'")

    # Try to find a loopback/monitor device
    loopback_device = None
    for i, dev in enumerate(sd.query_devices()):
        name = str(dev.get("name", "")).lower()
        if any(x in name for x in ["blackhole", "soundflower", "loopback", "monitor"]):
            if int(dev.get("max_input_channels", 0)) > 0:
                loopback_device = i
                break

    if loopback_device is None:
        if recording_info:
            recording_info["error"] = "No loopback device found. On macOS, install BlackHole."
        return

    try:
        device_info = sd.query_devices(loopback_device)
        samplerate = int(device_info.get("default_samplerate", 44100))
        channels = min(int(device_info.get("max_input_channels", 2)), 2)

        frames = []
        start = time.monotonic()
        next_emit_time = start
        duration_s = duration_ms / 1000.0
        
        # Silence detection state
        silence_start_time = None
        silence_duration_s = silence_duration_ms / 1000.0

        def callback(indata, frame_count, time_info, status):
            frames.append(indata.copy())

        with sd.InputStream(
            device=loopback_device,
            samplerate=samplerate,
            channels=channels,
            dtype="float32",
            callback=callback,
            blocksize=int(samplerate * 0.1),
        ):
            while (time.monotonic() - start) < duration_s:
                if stop_event.is_set():
                    break

                # Silence detection for recent frames
                if silence_threshold > 0 and silence_duration_s > 0 and frames:
                    try:
                        # Get the most recent frame for silence detection
                        recent_frame = frames[-1]
                        # Calculate RMS
                        rms = float(np.sqrt(np.mean(np.square(recent_frame))))
                        
                        is_silent = rms < silence_threshold
                        
                        if is_silent:
                            if silence_start_time is None:
                                silence_start_time = time.monotonic()
                                print(f"[system_audio] Silence detected at {(time.monotonic() - start):.1f}s")
                        else:
                            if silence_start_time is not None:
                                print(f"[system_audio] Sound detected, resetting silence timer at {(time.monotonic() - start):.1f}s")
                                silence_start_time = None
                        
                        # Check if silence duration exceeded
                        if silence_start_time is not None:
                            silence_elapsed = time.monotonic() - silence_start_time
                            if silence_elapsed >= silence_duration_s:
                                print(f"[system_audio] Silence duration ({silence_elapsed:.1f}s) exceeded threshold, stopping")
                                if recording_info:
                                    recording_info["stopped_by"] = "silence"
                                break
                    except Exception as e:
                        print(f"[system_audio] Error in silence detection: {e}")

                now = time.monotonic()
                if emit and loop and now - next_emit_time >= 0.5:
                    next_emit_time = now
                    try:
                        loop.call_soon_threadsafe(
                            asyncio.create_task,
                            emit("recording_progress", {
                                "sessionId": session_id,
                                "elapsedMs": int((now - start) * 1000),
                            })
                        )
                    except Exception:
                        pass

                time.sleep(0.05)

        if frames:
            data = np.concatenate(frames, axis=0)
            sf.write(path, data, samplerate)

            if recording_info:
                recording_info["completed"] = True
                recording_info["durationMs"] = int(len(data) / samplerate * 1000)
            print(f"[system_audio] Saved to {path}")
        else:
            if recording_info:
                recording_info["error"] = "No audio data captured"

    except Exception as e:
        print(f"[system_audio] Error: {e}")
        if recording_info:
            recording_info["error"] = str(e)


def _merge_audio_video(video_path: str, audio_path: str, output_path: str) -> None:
    """Merge audio and video files using ffmpeg."""
    import subprocess

    try:
        subprocess.run([
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-shortest",
            output_path
        ], check=True, capture_output=True)
    except FileNotFoundError:
        print("[screen_capture] ffmpeg not found, skipping audio merge")
        raise
    except subprocess.CalledProcessError as e:
        print(f"[screen_capture] ffmpeg error: {e.stderr.decode()}")
        raise
