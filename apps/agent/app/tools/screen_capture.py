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

        def _try_writer_mp4_h264(out_path: str):
            try:
                fourcc = cv2.VideoWriter_fourcc(*"H264")
                out = cv2.VideoWriter(out_path, cv2.CAP_MSMF, fourcc, fps, (out_width, out_height))
                if out.isOpened():
                    return out
                try:
                    out.release()
                except Exception:
                    pass
            except Exception:
                pass
            try:
                fourcc = cv2.VideoWriter_fourcc(*"avc1")
                out = cv2.VideoWriter(out_path, cv2.CAP_MSMF, fourcc, fps, (out_width, out_height))
                if out.isOpened():
                    return out
                try:
                    out.release()
                except Exception:
                    pass
            except Exception:
                pass
            return None

        def _try_writer_webm_vp8(out_path: str):
            try:
                fourcc = cv2.VideoWriter_fourcc(*"VP80")
                out = cv2.VideoWriter(out_path, fourcc, fps, (out_width, out_height))
                if out.isOpened():
                    return out
                try:
                    out.release()
                except Exception:
                    pass
            except Exception:
                pass
            return None

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
        elif quality == "ultra":
            scale = 1.0  # Native resolution with high bitrate
        else:  # high
            scale = 1.0  # Native resolution

        out_width = int(width * scale)
        out_height = int(height * scale)
        # Ensure even dimensions for video codec
        out_width = out_width if out_width % 2 == 0 else out_width + 1
        out_height = out_height if out_height % 2 == 0 else out_height + 1

        used_path = path
        out = _try_writer_mp4_h264(path)

        if out is None:
            used_path = path.rsplit(".", 1)[0] + ".webm"
            out = _try_writer_webm_vp8(used_path)

        if out is None:
            recording_info["error"] = "video_writer_failed"
            return

        recording_info["path"] = used_path

        # Start audio capture if requested
        audio_thread = None
        audio_path = None
        audio_stop_event = threading.Event()
        if include_audio:
            audio_path = used_path.rsplit(".", 1)[0] + "_audio.wav"
            recording_info["audioFilePath"] = audio_path
            audio_thread = threading.Thread(
                target=_capture_system_audio_worker,
                args=(audio_path, duration_ms, audio_stop_event, session_id + "_audio", emit, loop, None, silence_threshold, silence_duration_ms),
                daemon=True
            )
            audio_thread.start()

        start = time.monotonic()
        next_emit_time = start
        frames_written = 0
        last_frame = None

        try:
            with mss.mss() as sct:
                while (time.monotonic() - start) * 1000.0 < duration_ms:
                    # Check stop signal
                    if stop_event.is_set():
                        print(f"[screen_capture] Stop signal detected!")
                        break

                    # Capture a new frame
                    try:
                        img = sct.grab(monitor)
                        frame = np.array(img)
                        # Convert BGRA to BGR
                        frame = cv2.cvtColor(frame, cv2.COLOR_BGRA2BGR)
                        # Resize if needed
                        if scale != 1.0:
                            frame = cv2.resize(frame, (out_width, out_height))
                        last_frame = frame
                    except Exception as e:
                        print(f"[screen_capture] Frame capture error: {e}")
                        time.sleep(0.001)
                        continue

                    # Calculate how many total frames should exist at this
                    # point based on elapsed wall-clock time, then write the
                    # captured frame enough times to fill any timing gaps.
                    # This keeps playback speed 1:1 with real time even when
                    # capture is slower than the target fps.
                    now = time.monotonic()
                    elapsed = now - start
                    expected_frame_count = int(elapsed * fps) + 1
                    writes = max(1, expected_frame_count - frames_written)
                    for _ in range(writes):
                        out.write(frame)
                        frames_written += 1

                    # Sleep until next frame is due
                    next_due = start + frames_written / fps
                    sleep_s = next_due - time.monotonic()
                    if sleep_s > 0.002:
                        time.sleep(sleep_s - 0.001)
                    else:
                        time.sleep(0.001)

                    # Emit progress
                    now2 = time.monotonic()
                    if emit and loop and now2 - next_emit_time >= 0.5:
                        next_emit_time = now2
                        elapsed_ms = int((now2 - start) * 1000)
                        try:
                            loop.call_soon_threadsafe(
                                asyncio.create_task,
                                emit(
                                    "recording_progress",
                                    {
                                        "sessionId": session_id,
                                        "elapsedMs": elapsed_ms,
                                        "mode": mode,
                                    },
                                ),
                            )
                        except Exception:
                            pass

        finally:
            # Final padding to guarantee exact duration
            elapsed_s = max(0.0, time.monotonic() - start)
            target_s = (duration_ms / 1000.0) if mode == "fixed" else elapsed_s
            expected_frames = int(round(target_s * float(fps)))
            if last_frame is not None and expected_frames > frames_written:
                for _ in range(expected_frames - frames_written):
                    try:
                        out.write(last_frame)
                    except Exception:
                        break
            out.release()
            print(f"[screen_capture] Wrote {frames_written} frames in {elapsed_s:.2f}s (target: {expected_frames} @ {fps}fps)")

            # Stop audio capture
            if audio_thread:
                audio_stop_event.set()
                audio_thread.join(timeout=2.0)

            # Mux audio into video if both files exist
            if include_audio and audio_path and os.path.isfile(audio_path) and os.path.isfile(used_path):
                # Create muxed output path
                muxed_path = used_path.rsplit(".", 1)[0] + "_muxed." + used_path.rsplit(".", 1)[1]
                result = _mux_video_audio_pyav(used_path, audio_path, muxed_path)
                if result:
                    recording_info["path"] = result
                    recording_info["hasAudio"] = True
                    recording_info["audioFilePath"] = None  # Cleaned up
                else:
                    # Muxing failed, keep separate files
                    recording_info["hasAudio"] = True
                    print(f"[screen_capture] Muxing failed, keeping separate files")
            elif include_audio and audio_path and os.path.isfile(audio_path):
                recording_info["hasAudio"] = True

        recording_info["completed"] = True
        print(f"[screen_capture] Saved to {recording_info['path']}")

        # Clean up session
        with _sessions_lock:
            _active_screen_sessions.pop(session_id, None)

    # For until_stop mode, start in background and return immediately
    if mode == "until_stop":
        thread = threading.Thread(target=_background_screen_work, daemon=True)
        thread.start()

        resolved_path = path
        for _ in range(20):
            try:
                rp = recording_info.get("path")
                if isinstance(rp, str) and rp:
                    resolved_path = rp
                    break
            except Exception:
                pass
            await asyncio.sleep(0.01)

        mime = "video/webm" if str(resolved_path).lower().endswith(".webm") else "video/mp4"

        if emit:
            await emit("recording", {
                "sessionId": session_id,
                "mode": mode,
                "filePath": resolved_path,
            })

        return {
            "ok": True,
            "sessionId": session_id,
            "filePath": resolved_path,
            "mode": mode,
            "status": "recording",
            "mimeType": mime,
            "hasAudio": include_audio,
            "audioFilePath": recording_info.get("audioFilePath"),
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

    final_path = recording_info.get("path")
    mime = "video/webm" if str(final_path or "").lower().endswith(".webm") else "video/mp4"

    return {
        "ok": not recording_info.get("error"),
        "sessionId": session_id,
        "filePath": final_path,
        "mode": mode,
        "status": "completed",
        "mimeType": mime,
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
    audio_file_path = None
    if recording_info:
        file_path = recording_info.get("path")
        audio_file_path = recording_info.get("audioFilePath")
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
        "audioFilePath": audio_file_path,
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

def _mux_video_audio_pyav(video_path: str, audio_path: str, output_path: str) -> Optional[str]:
    """
    Mux video and audio files into a single output file using PyAV.
    This uses the bundled FFmpeg libraries, no system FFmpeg install needed.
    
    Args:
        video_path: Path to video file (mp4/webm)
        audio_path: Path to audio file (wav)
        output_path: Path for muxed output
    
    Returns:
        Path to muxed file on success, None on failure
    """
    try:
        import av
    except ImportError:
        print("[mux] PyAV not installed, cannot mux audio into video")
        return None
    
    if not os.path.isfile(video_path) or not os.path.isfile(audio_path):
        print(f"[mux] Missing files: video={os.path.isfile(video_path)}, audio={os.path.isfile(audio_path)}")
        return None
    
    try:
        print(f"[mux] Muxing {video_path} + {audio_path} -> {output_path}")
        
        # Open input containers
        video_container = av.open(video_path)
        audio_container = av.open(audio_path)
        
        # Create output container
        output_container = av.open(output_path, mode='w')
        
        # Get input streams
        video_stream = video_container.streams.video[0]
        audio_stream = audio_container.streams.audio[0]
        
        # Add output streams (copy codec from video, transcode audio to AAC)
        out_video_stream = output_container.add_stream(template=video_stream)
        out_audio_stream = output_container.add_stream('aac', rate=audio_stream.rate)
        out_audio_stream.layout = 'stereo' if audio_stream.channels >= 2 else 'mono'
        
        # Copy video packets (no re-encoding)
        for packet in video_container.demux(video_stream):
            if packet.dts is None:
                continue
            packet.stream = out_video_stream
            output_container.mux(packet)
        
        # Decode and re-encode audio to AAC
        for frame in audio_container.decode(audio_stream):
            # Resample if needed
            frame.pts = None  # Let encoder assign PTS
            for packet in out_audio_stream.encode(frame):
                output_container.mux(packet)
        
        # Flush audio encoder
        for packet in out_audio_stream.encode():
            output_container.mux(packet)
        
        # Close containers
        output_container.close()
        video_container.close()
        audio_container.close()
        
        if os.path.isfile(output_path):
            print(f"[mux] Successfully muxed to {output_path}")
            # Clean up temp files
            try:
                os.remove(video_path)
                os.remove(audio_path)
            except Exception as e:
                print(f"[mux] Warning: Could not remove temp files: {e}")
            return output_path
        else:
            print("[mux] Output file not created")
            return None
            
    except Exception as e:
        print(f"[mux] Error muxing with PyAV: {e}")
        import traceback
        traceback.print_exc()
        return None


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


def _find_loopback_device_linux() -> Optional[int]:
    """Find PulseAudio/PipeWire monitor source on Linux."""
    try:
        import sounddevice as sd
        
        devices = sd.query_devices()
        
        # Priority order for Linux loopback devices:
        # 1. Default output monitor (most common)
        # 2. Any device with "monitor" in name
        # 3. Any device with "pulse" and input channels
        
        monitor_devices = []
        for i, dev in enumerate(devices):
            name = str(dev.get("name", "")).lower()
            max_in = int(dev.get("max_input_channels", 0))
            
            if max_in > 0:
                # PulseAudio/PipeWire monitor sources
                if "monitor" in name:
                    # Prefer default/built-in monitors
                    if "built-in" in name or "default" in name:
                        return i
                    monitor_devices.append((i, name))
        
        # Return first monitor device found
        if monitor_devices:
            return monitor_devices[0][0]
        
        return None
    except Exception as e:
        print(f"[system_audio] Error finding Linux loopback device: {e}")
        return None


def _find_loopback_device_macos() -> Optional[int]:
    """Find virtual audio device on macOS (BlackHole, Soundflower, etc.)."""
    try:
        import sounddevice as sd
        
        devices = sd.query_devices()
        virtual_devices = []
        
        for i, dev in enumerate(devices):
            name = str(dev.get("name", "")).lower()
            max_in = int(dev.get("max_input_channels", 0))
            
            if max_in > 0:
                # Known virtual audio devices for macOS
                if "blackhole" in name:
                    return i  # Prefer BlackHole
                elif "soundflower" in name:
                    virtual_devices.append((i, 1))  # Second priority
                elif "loopback" in name:
                    virtual_devices.append((i, 2))  # Third priority
        
        if virtual_devices:
            # Sort by priority and return best match
            virtual_devices.sort(key=lambda x: x[1])
            return virtual_devices[0][0]
        
        return None
    except Exception as e:
        print(f"[system_audio] Error finding macOS loopback device: {e}")
        return None


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

    plat = platform.system()
    print(f"[system_audio] Starting generic loopback capture for session '{session_id}' on {plat}")

    # Platform-specific device discovery
    loopback_device = None
    if plat == "Darwin":  # macOS
        loopback_device = _find_loopback_device_macos()
        if loopback_device is None:
            error_msg = (
                "No virtual audio device found. To capture system audio on macOS:\n"
                "1. Install BlackHole: brew install blackhole-2ch\n"
                "2. Open Audio MIDI Setup (Applications > Utilities)\n"
                "3. Create a Multi-Output Device with your speakers + BlackHole\n"
                "4. Set the Multi-Output Device as your system output\n"
                "More info: https://github.com/ExistentialAudio/BlackHole"
            )
            print(f"[system_audio] {error_msg}")
            if recording_info:
                recording_info["error"] = error_msg
            return
    else:  # Linux
        loopback_device = _find_loopback_device_linux()
        if loopback_device is None:
            error_msg = (
                "No PulseAudio/PipeWire monitor source found. Ensure:\n"
                "1. PulseAudio or PipeWire is running\n"
                "2. You have audio output active (play some audio)\n"
                "3. Run: pactl list sources | grep -i monitor"
            )
            print(f"[system_audio] {error_msg}")
            if recording_info:
                recording_info["error"] = error_msg
            return

    # Log which device we're using
    try:
        device_info = sd.query_devices(loopback_device)
        print(f"[system_audio] Using loopback device: {device_info.get('name', 'unknown')}")
    except Exception:
        pass

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
