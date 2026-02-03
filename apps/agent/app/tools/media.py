from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import tempfile
import threading
import time
import uuid
from typing import Any, Dict, Callable, Awaitable, Optional, List
from urllib import request, error as urlerror

# Import media bus for shared capture support
from . import media_bus

# Global registry of active capture sessions for until_stop mode
_active_sessions: Dict[str, threading.Event] = {}
_active_recordings: Dict[str, Dict[str, Any]] = {}  # Stores background recording info
_sessions_lock = threading.Lock()

def _tmp_dir() -> str:
    base = os.path.join(tempfile.gettempdir(), "stuardai")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        pass
    return base


async def describe_media_capture_capabilities(args: Dict[str, Any]) -> Dict[str, Any]:
    devices: List[Dict[str, Any]] = []

    # Audio input devices
    try:
        import sounddevice as sd  # type: ignore

        for i, dev in enumerate(sd.query_devices()):  # type: ignore[attr-defined]
            try:
                name = str(dev.get("name") or f"Audio Device {i}")
                max_in = int(dev.get("max_input_channels") or 0)
                if max_in > 0:
                    devices.append({"id": str(i), "kind": "audio_input", "label": name})
            except Exception:
                continue
    except Exception:
        # sounddevice not installed or unavailable
        pass

    # Video input devices (probe first 5 indices)
    try:
        import cv2  # type: ignore

        def try_open(index: int):
            # Prefer DirectShow on Windows; fallback to default
            cap = None
            try:
                cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
                if not cap.isOpened():
                    cap.release()
                    cap = cv2.VideoCapture(index)
            except Exception:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                cap = None
            return cap

        for idx in range(0, 5):
            cap = try_open(idx)
            if cap is not None and cap.isOpened():
                ok, _ = cap.read()
                if ok:
                    devices.append({"id": str(idx), "kind": "video_input", "label": f"Camera {idx}"})
                try:
                    cap.release()
                except Exception:
                    pass
    except Exception:
        # opencv not installed or unavailable
        pass

    return {"ok": True, "devices": devices}


async def capture_media(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    """
    Capture photo, video, or audio media.
    
    Args:
        kind: 'photo' | 'video' | 'audio'
        device: Device ID/index (optional)
        durationMs: Fixed duration for 'fixed' mode (required for video/audio in fixed mode)
        filePath: Output file path (optional, auto-generated if not provided)
        mode: 'fixed' (default) | 'until_stop' (capture until stop_capture is called)
        sessionId: Session identifier for until_stop mode (auto-generated if not provided)
        maxDurationMs: Safety limit for until_stop mode (default: 7200000 = 2 hours)
    
    Returns:
        { ok, filePath, mimeType, sessionId?, stoppedBy?, busId?, isNewBus?, subscriberCount? }
        
    Note: In 'until_stop' mode, this returns immediately after starting recording.
          The filePath will be populated when stop_capture is called.
          
    Note: Audio/video captures in 'until_stop' mode automatically use a shared bus.
          Multiple workflows can share the same camera/microphone seamlessly.
    """
    kind = str(args.get("kind") or "").strip().lower()
    device = args.get("device")
    mode = str(args.get("mode") or "fixed").strip().lower()
    session_id = str(args.get("sessionId") or "").strip() or str(uuid.uuid4())[:8]
    max_duration_ms = int(args.get("maxDurationMs") or 7200000)  # 2 hour default safety limit
    duration_ms = int(args.get("durationMs") or (5000 if kind in ("audio", "video") else 0))
    explicit_path = str(args.get("filePath") or "").strip()
    silence_threshold = float(args.get("silenceThreshold") or 0.01)
    silence_duration_ms = int(args.get("silenceDurationMs") or 2000)

    if kind not in ("photo", "video", "audio"):
        raise ValueError("kind must be one of 'photo' | 'video' | 'audio'")
    
    # Use bus for ALL audio/video captures (both fixed and until_stop/silence)
    # This allows multiple workflows to share the same camera/microphone seamlessly
    # Without blocking each other
    if kind in ("audio", "video"):
        return await _capture_via_bus(
            kind,
            device,
            session_id,
            explicit_path,
            emit,
            mode,
            duration_ms,
            silence_threshold,
            silence_duration_ms,
            max_duration_ms,
        )

    # Validate mode
    if mode not in ("fixed", "until_stop", "silence"):
        raise ValueError("mode must be 'fixed', 'until_stop', or 'silence'")

    # For fixed mode, duration is required for video/audio
    if mode == "fixed" and kind in ("video", "audio") and duration_ms <= 0:
        raise ValueError("durationMs must be > 0 for video/audio in fixed mode")

    # For silence mode, only audio is supported
    if mode == "silence" and kind != "audio":
        raise ValueError("silence mode is only supported for audio capture")

    # For until_stop or silence mode, use max_duration_ms as the limit
    if mode in ("until_stop", "silence"):
        duration_ms = max_duration_ms

    # Create stop event for this session
    stop_event = threading.Event()
    with _sessions_lock:
        _active_sessions[session_id] = stop_event
    print(f"[capture_media] Registered session '{session_id}' with event id={id(stop_event)}")

    if emit:
        await emit("preparing", {
            "kind": kind,
            "device": device,
            "durationMs": duration_ms if mode == "fixed" else None,
            "mode": mode,
            "sessionId": session_id,
            "maxDurationMs": max_duration_ms if mode in ("until_stop", "silence") else None,
            "silenceThreshold": silence_threshold if mode == "silence" else None,
            "silenceDurationMs": silence_duration_ms if mode == "silence" else None,
        })

    # For until_stop or silence mode, start recording in background and return immediately
    if mode in ("until_stop", "silence") and kind in ("video", "audio"):
        return await _start_background_recording(kind, device, duration_ms, explicit_path, emit, stop_event, session_id, mode, silence_threshold, silence_duration_ms)

    try:
        if kind == "photo":
            result = await _capture_photo(device, explicit_path, emit)
        elif kind == "video":
            result = await _capture_video_with_stop(device, duration_ms, explicit_path, emit, stop_event, mode)
        elif kind == "audio":
            result = await _capture_audio_with_stop(device, duration_ms, explicit_path, emit, stop_event, mode)
        else:
            raise RuntimeError("unsupported kind")
        
        # Add session info to result
        result["sessionId"] = session_id
        if mode in ("until_stop", "silence") and stop_event.is_set():
            result["stoppedBy"] = "stop_signal"
        elif mode in ("until_stop", "silence"):
            result["stoppedBy"] = "max_duration"
        
        return result
    finally:
        # Clean up session
        print(f"[capture_media] Cleaning up session '{session_id}'")
        with _sessions_lock:
            _active_sessions.pop(session_id, None)


async def _capture_via_bus(
    kind: str,
    device: Any,
    session_id: str,
    explicit_path: str,
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]],
    mode: str = "until_stop",
    duration_ms: int = 0,
    silence_threshold: float = 0.01,
    silence_duration_ms: int = 2000,
    max_duration_ms: int = 7200000,
) -> Dict[str, Any]:
    """
    Capture media using the shared media bus system.
    This allows multiple workflows to share the same camera/microphone.
    
    The first workflow to need the device starts the bus, others subscribe to it.
    When a workflow stops capture, it only unsubscribes (bus keeps running if others need it).
    Bus auto-stops when last subscriber leaves.
    
    For 'fixed' mode: waits for duration_ms then auto-unsubscribes.
    For 'until_stop' mode: returns immediately, waits for stop_capture call.
    """
    # Parse device index
    device_idx = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())
    
    print(f"[capture_media] Using bus mode for {kind} capture, session={session_id}, mode={mode}, duration={duration_ms}ms")
    
    # Subscribe to the bus (starts it if not running)
    subscribe_result = await media_bus.subscribe_media_bus({
        "kind": kind,
        "device": device_idx,
        "subscriberId": session_id,
        "startRecording": True,
        "filePath": explicit_path,
        "silenceThreshold": silence_threshold if mode == "silence" else None,
        "silenceDurationMs": silence_duration_ms if mode == "silence" else None,
    }, emit)
    
    if not subscribe_result.get("ok"):
        raise RuntimeError(f"Failed to subscribe to media bus: {subscribe_result}")
    
    file_path = subscribe_result.get("filePath")
    
    # Store bus subscription info in active recordings for stop_capture to find
    with _sessions_lock:
        _active_recordings[session_id] = {
            "path": file_path,
            "kind": kind,
            "device": device_idx,
            "bus_mode": True,  # Flag to indicate this is a bus-based capture
            "bus_id": subscribe_result.get("busId"),
            "started_at": time.time(),
            "completed": False,
            "error": None,
            "mode": mode,
            "duration_ms": duration_ms,
            "silence_threshold": silence_threshold if mode == "silence" else None,
            "silence_duration_ms": silence_duration_ms if mode == "silence" else None,
        }
        # Also create a dummy stop event for compatibility
        _active_sessions[session_id] = threading.Event()
    
    if emit:
        await emit("recording", {
            "sessionId": session_id,
            "mode": mode,
            "filePath": file_path,
            "busId": subscribe_result.get("busId"),
            "isNewBus": subscribe_result.get("isNewBus"),
            "subscriberCount": subscribe_result.get("subscriberCount"),
            "durationMs": duration_ms if mode == "fixed" else None,
        })

    if mode == "until_stop":
        if not file_path:
            ext = "wav" if kind == "audio" else "mp4"
            file_path = os.path.join(_tmp_dir(), f"{kind}_{session_id}_{int(time.time()*1000)}.{ext}")
            with _sessions_lock:
                rec = _active_recordings.get(session_id)
                if isinstance(rec, dict):
                    rec["path"] = file_path
        return {
            "ok": True,
            "sessionId": session_id,
            "filePath": file_path,
            "mode": mode,
            "status": "recording",
            "mimeType": "audio/wav" if kind == "audio" else "video/mp4",
            "useBus": True,
            "busId": subscribe_result.get("busId"),
            "isNewBus": subscribe_result.get("isNewBus"),
            "subscriberCount": subscribe_result.get("subscriberCount"),
        }
    
    # For fixed mode: wait for the duration then auto-stop
    if mode == "fixed" and duration_ms > 0:
        duration_s = duration_ms / 1000.0
        print(f"[capture_media] Fixed mode: waiting {duration_s}s before auto-stop")
        
        start_time = time.monotonic()
        check_interval = 0.5  # Check every 500ms for progress updates
        
        while True:
            elapsed = time.monotonic() - start_time
            remaining = duration_s - elapsed
            
            if remaining <= 0:
                print(f"[capture_media] Fixed mode: duration reached ({elapsed:.1f}s)")
                break
            
            # Emit progress
            if emit:
                try:
                    await emit("recording_progress", {
                        "sessionId": session_id,
                        "elapsedMs": int(elapsed * 1000),
                        "totalMs": duration_ms,
                        "mode": mode,
                    })
                except Exception:
                    pass
            
            # Sleep for check interval or remaining time, whichever is shorter
            await asyncio.sleep(min(check_interval, remaining))
        
        # Auto-unsubscribe after duration
        print(f"[capture_media] Fixed mode: auto-stopping session {session_id}")
        unsubscribe_result = await media_bus.unsubscribe_media_bus({
            "kind": kind,
            "device": device_idx,
            "subscriberId": session_id,
            "saveRecording": True,
        }, emit)
        
        # Clean up local state
        with _sessions_lock:
            _active_sessions.pop(session_id, None)
            rec_info = _active_recordings.pop(session_id, None)
        
        final_path = unsubscribe_result.get("filePath") or file_path
        
        return {
            "ok": True,
            "sessionId": session_id,
            "filePath": final_path,
            "mode": mode,
            "status": "completed",
            "mimeType": "audio/wav" if kind == "audio" else "video/mp4",
            "durationMs": duration_ms,
            "useBus": True,
        }
    
    # For silence mode: wait (bounded by maxDurationMs) until silence is detected, then unsubscribe/save.
    # This MUST be deterministic and should not rely on background thread scheduling.
    if mode == "silence":
        print(f"[capture_media] Silence mode: waiting for silence detection (maxDurationMs={max_duration_ms})...")
        started = time.monotonic()
        timeout_s = max(0.1, float(max_duration_ms) / 1000.0)
        stopped_by = "max_duration"

        while True:
            # Timeout guard (prevents workflow hangs)
            if (time.monotonic() - started) >= timeout_s:
                break

            # Locate the bus/subscriber and check the silence event.
            bus_key = media_bus._bus_key(kind, device_idx)
            with media_bus._buses_lock:
                bus = media_bus._buses.get(bus_key)

            if bus:
                with bus.subscribers_lock:
                    sub = bus.subscribers.get(session_id)

                if sub and sub.silence_stop_event and sub.silence_stop_event.is_set():
                    stopped_by = "silence"
                    break

                # If subscriber disappeared, treat as externally stopped.
                if not sub:
                    stopped_by = "stop_signal"
                    break

            await asyncio.sleep(0.1)

        # Unsubscribe (saves recording) unless we were already unsubscribed.
        unsubscribe_result = await media_bus.unsubscribe_media_bus(
            {
                "kind": kind,
                "device": device_idx,
                "subscriberId": session_id,
                "saveRecording": True,
            },
            emit,
        )

        # Clean up local state
        with _sessions_lock:
            _active_sessions.pop(session_id, None)
            _active_recordings.pop(session_id, None)

        final_path = unsubscribe_result.get("filePath") or file_path

        return {
            "ok": True,
            "sessionId": session_id,
            "filePath": final_path,
            "mode": mode,
            "status": "completed",
            "mimeType": "audio/wav" if kind == "audio" else "video/mp4",
            "stoppedBy": stopped_by,
            "useBus": True,
        }


async def _start_background_recording(
    kind: str,
    device: Any,
    max_duration_ms: int,
    explicit_path: str,
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]],
    stop_event: threading.Event,
    session_id: str,
    mode: str = "until_stop",
    silence_threshold: float = 0.01,
    silence_duration_ms: int = 2000,
) -> Dict[str, Any]:
    """
    Start recording in background for until_stop or silence mode.
    Returns immediately with session info. Recording continues until stop_capture is called or silence is detected.
    """
    out_dir = _tmp_dir()
    
    # Handle video recording (silence mode not supported for video)
    if kind == "video":
        return await _start_background_video(device, max_duration_ms, explicit_path, emit, stop_event, session_id)
    
    # Audio recording
    import sounddevice as sd  # type: ignore
    import soundfile as sf  # type: ignore
    import numpy as np  # type: ignore
    
    path = explicit_path or os.path.join(out_dir, f"audio_{int(time.time()*1000)}.wav")
    
    # Resolve device index
    dev_index = None
    if device is not None:
        if isinstance(device, int):
            dev_index = device
        elif isinstance(device, str) and device.strip().isdigit():
            dev_index = int(device.strip())
    
    samplerate = 44100
    channels = 1
    try:
        if dev_index is not None:
            info = sd.query_devices(dev_index)
        else:
            info = sd.query_devices(None, "input")
        max_in = int((info or {}).get("max_input_channels") or 1)
        channels = 1 if max_in < 2 else 2
    except Exception:
        pass
    
    # Get the current event loop for emitting progress
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    
    # Store recording info
    recording_info: Dict[str, Any] = {
        "path": path,
        "kind": kind,
        "samplerate": samplerate,
        "channels": channels,
        "device": dev_index,
        "stop_event": stop_event,
        "chunks": [],
        "started_at": time.time(),
        "completed": False,
        "error": None,
        "mode": mode,
        "silence_threshold": silence_threshold if mode == "silence" else None,
        "silence_duration_ms": silence_duration_ms if mode == "silence" else None,
    }
    
    with _sessions_lock:
        _active_recordings[session_id] = recording_info
    
    def _background_work():
        """Background thread that performs the actual recording using InputStream."""
        import queue
        
        print(f"[background_audio] Starting session '{session_id}' with InputStream, mode={mode}")
        
        audio_queue: queue.Queue = queue.Queue()
        all_chunks: List[Any] = []
        start = time.monotonic()
        max_duration_s = max_duration_ms / 1000.0
        
        # Silence detection state
        silence_start_time = None
        silence_duration_s = silence_duration_ms / 1000.0 if mode == "silence" else None
        
        def audio_callback(indata, frames, time_info, status):
            """Callback to collect audio data from the stream."""
            if status:
                print(f"[background_audio] Stream status: {status}")
            # Copy the data to avoid issues with buffer reuse
            audio_queue.put(indata.copy())
        
        try:
            # Use InputStream for continuous recording
            with sd.InputStream(
                samplerate=samplerate,
                channels=channels,
                dtype="float32",
                device=dev_index,
                callback=audio_callback,
                blocksize=int(samplerate * 0.1),  # 100ms blocks
            ):
                print(f"[background_audio] Stream opened, recording...")
                next_emit_time = start
                
                while True:
                    # Check for stop signal
                    if stop_event.is_set():
                        print(f"[background_audio] Stop signal detected!")
                        break
                    
                    # Check max duration
                    elapsed = time.monotonic() - start
                    if elapsed >= max_duration_s:
                        print(f"[background_audio] Max duration reached")
                        break
                    
                    # Collect any available audio data
                    try:
                        while True:
                            chunk = audio_queue.get_nowait()
                            all_chunks.append(chunk)
                    except queue.Empty:
                        pass
                    
                    # Silence detection for silence mode
                    if mode == "silence" and all_chunks:
                        # Get the most recent chunk for silence detection
                        recent_chunk = all_chunks[-1]
                        try:
                            # Calculate RMS (root mean square) to determine audio level
                            rms = float(np.sqrt(np.mean(np.square(recent_chunk))))
                            is_silent = rms < silence_threshold
                            
                            if is_silent:
                                if silence_start_time is None:
                                    silence_start_time = time.monotonic()
                                    print(f"[background_audio] Silence detected at {elapsed:.1f}s")
                            else:
                                if silence_start_time is not None:
                                    print(f"[background_audio] Sound detected, resetting silence timer at {elapsed:.1f}s")
                                    silence_start_time = None
                            
                            # Check if silence duration exceeded
                            if silence_start_time is not None:
                                silence_elapsed = time.monotonic() - silence_start_time
                                if silence_elapsed >= silence_duration_s:
                                    print(f"[background_audio] Silence duration ({silence_elapsed:.1f}s) exceeded threshold, stopping")
                                    recording_info["stopped_by"] = "silence"
                                    break
                        except Exception as e:
                            print(f"[background_audio] Error in silence detection: {e}")
                    
                    # Emit progress
                    now = time.monotonic()
                    if emit and loop and now - next_emit_time >= 0.5:
                        next_emit_time = now
                        elapsed_ms = int((now - start) * 1000)
                        try:
                            loop.call_soon_threadsafe(
                                asyncio.create_task,
                                emit("recording_progress", {
                                    "elapsedMs": elapsed_ms,
                                    "sessionId": session_id,
                                    "mode": mode,
                                    "chunks": len(all_chunks),
                                })
                            )
                        except Exception:
                            pass
                    
                    # Small sleep to prevent busy loop
                    time.sleep(0.05)
                
                # Drain remaining audio from queue
                try:
                    while True:
                        chunk = audio_queue.get_nowait()
                        all_chunks.append(chunk)
                except queue.Empty:
                    pass
                    
        except Exception as e:
            recording_info["error"] = str(e)
            print(f"[background_audio] Error: {e}")
        
        # Write audio file
        if all_chunks:
            try:
                data = np.concatenate(all_chunks, axis=0)
                print(f"[background_audio] Total samples: {len(data)}, duration: {len(data)/samplerate:.2f}s")
                sf.write(path, data, samplerate)
                recording_info["completed"] = True
                print(f"[background_audio] Saved {len(all_chunks)} chunks to {path}")
            except Exception as e:
                recording_info["error"] = str(e)
                print(f"[background_audio] Failed to save: {e}")
        else:
            recording_info["error"] = "no_audio_data"
            print(f"[background_audio] No audio data captured!")
        
        # Clean up
        with _sessions_lock:
            _active_sessions.pop(session_id, None)
    
    # Start background thread
    thread = threading.Thread(target=_background_work, daemon=True)
    thread.start()
    
    if emit:
        await emit("recording", {
            "sessionId": session_id,
            "mode": mode,
            "filePath": path,
            "samplerate": samplerate,
            "channels": channels,
        })
    
    print(f"[capture_media] Background recording started for session '{session_id}', path={path}, mode={mode}")
    
    # Return immediately - workflow can continue
    return {
        "ok": True,
        "sessionId": session_id,
        "filePath": path,  # Path where audio will be saved
        "mode": mode,
        "status": "recording",
        "mimeType": "audio/wav",
    }


async def _start_background_video(
    device: Any,
    max_duration_ms: int,
    explicit_path: str,
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]],
    stop_event: threading.Event,
    session_id: str,
) -> Dict[str, Any]:
    """
    Start video recording in background for until_stop mode.
    """
    try:
        import cv2  # type: ignore
    except Exception:
        raise RuntimeError("opencv-python not installed")
    
    out_dir = _tmp_dir()
    path = explicit_path or os.path.join(out_dir, f"video_{int(time.time()*1000)}.mp4")
    
    idx = _parse_device_index(device)
    
    # Get the current event loop for emitting progress
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    
    # Store recording info
    recording_info: Dict[str, Any] = {
        "path": path,
        "kind": "video",
        "device": idx,
        "started_at": time.time(),
        "completed": False,
        "error": None,
    }
    
    with _sessions_lock:
        _active_recordings[session_id] = recording_info
    
    def _background_video_work():
        """Background thread that performs video recording."""
        cap = cv2.VideoCapture(idx if idx is not None else 0, cv2.CAP_DSHOW)
        if not cap.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            cap = cv2.VideoCapture(idx if idx is not None else 0)
        if not cap.isOpened():
            recording_info["error"] = "camera_open_failed"
            return
        
        # Determine properties
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        cap_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if cap_fps < 1 or cap_fps > 120:
            cap_fps = 0.0

        # Warm up + estimate actual FPS to avoid 2x speed recordings
        warmup_frames: List[Any] = []
        warmup_start = time.monotonic()
        for _ in range(15):
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            warmup_frames.append(frame)
        warmup_elapsed = time.monotonic() - warmup_start
        measured_fps = (
            (len(warmup_frames) / warmup_elapsed)
            if warmup_elapsed >= 0.25 and len(warmup_frames) >= 5
            else 0.0
        )
        fps = cap_fps or measured_fps or 20.0
        if measured_fps and (not cap_fps or abs(cap_fps - measured_fps) / measured_fps > 0.25):
            fps = measured_fps
        
        def _try_writer_mp4_h264(out_path: str):
            try:
                fourcc = cv2.VideoWriter_fourcc(*"H264")
                out = cv2.VideoWriter(out_path, cv2.CAP_MSMF, fourcc, fps, (width, height))
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
                out = cv2.VideoWriter(out_path, cv2.CAP_MSMF, fourcc, fps, (width, height))
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
                out = cv2.VideoWriter(out_path, fourcc, fps, (width, height))
                if out.isOpened():
                    return out
                try:
                    out.release()
                except Exception:
                    pass
            except Exception:
                pass
            return None

        used_path = path
        out = _try_writer_mp4_h264(path)
        if out is None:
            used_path = path.rsplit(".", 1)[0] + ".webm"
            out = _try_writer_webm_vp8(used_path)
        if out is None:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            out = cv2.VideoWriter(path, fourcc, fps, (width, height))
            used_path = path
        if out is None or not out.isOpened():
            used_path = os.path.join(_tmp_dir(), f"video_{int(time.time()*1000)}.avi")
            fourcc = cv2.VideoWriter_fourcc(*"XVID")
            out = cv2.VideoWriter(used_path, fourcc, fps, (width, height))
        recording_info["path"] = used_path
        
        if not out.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            recording_info["error"] = "video_writer_failed"
            return
        
        print(f"[background_video] Starting session '{session_id}'")
        start = time.monotonic()
        next_emit_time = start
        
        warmup_index = 0
        try:
            while (time.monotonic() - start) * 1000.0 < max_duration_ms:
                # Check for stop signal
                if stop_event.is_set():
                    print(f"[background_video] Stop signal detected!")
                    break
                
                if warmup_index < len(warmup_frames):
                    frame = warmup_frames[warmup_index]
                    warmup_index += 1
                    ok = True
                else:
                    ok, frame = cap.read()
                if not ok or frame is None:
                    break
                out.write(frame)
                
                now = time.monotonic()
                if emit and loop and now - next_emit_time >= 0.5:
                    next_emit_time = now
                    try:
                        loop.call_soon_threadsafe(
                            asyncio.create_task,
                            emit("recording_progress", {
                                "elapsedMs": int((now - start) * 1000),
                                "sessionId": session_id,
                                "mode": "until_stop",
                            })
                        )
                    except Exception:
                        pass
        finally:
            try:
                out.release()
            except Exception:
                pass
            try:
                cap.release()
            except Exception:
                pass
        
        recording_info["completed"] = True

        print(f"[background_video] Saved to {used_path}")
        
        # Clean up session
        with _sessions_lock:
            _active_sessions.pop(session_id, None)
    
    # Start background thread
    thread = threading.Thread(target=_background_video_work, daemon=True)
    thread.start()
    
    if emit:
        await emit("recording", {
            "sessionId": session_id,
            "mode": "until_stop",
            "filePath": path,
        })
    
    print(f"[capture_media] Background video started for session '{session_id}', path={path}")
    
    return {
        "ok": True,
        "sessionId": session_id,
        "filePath": path,
        "mode": "until_stop",
        "status": "recording",
        "mimeType": "video/mp4",
    }


async def stop_capture(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    """
    Stop an active capture session.
    
    Args:
        sessionId: The session ID to stop (required)
    
    Returns:
        { ok, sessionId, wasActive, filePath?, stoppedBy?, busInfo? }
    """
    session_id = str(args.get("sessionId") or "").strip()
    if not session_id:
        raise ValueError("sessionId is required")
    
    print(f"[stop_capture] Looking for session: {session_id}")
    print(f"[stop_capture] Active sessions: {list(_active_sessions.keys())}")
    print(f"[stop_capture] Active recordings: {list(_active_recordings.keys())}")
    
    with _sessions_lock:
        stop_event = _active_sessions.get(session_id)
        recording_info = _active_recordings.get(session_id)
        was_active = stop_event is not None
        print(f"[stop_capture] Found event: {stop_event is not None}, recording_info: {recording_info is not None}")
    
    # Check if this is a bus-based capture
    if recording_info and recording_info.get("bus_mode"):
        print(f"[stop_capture] Handling bus-based capture for session {session_id}")
        kind = recording_info.get("kind", "audio")
        device = recording_info.get("device")
        mode = recording_info.get("mode", "fixed")
        
        # Unsubscribe from the bus (this will save the recording)
        unsubscribe_result = await media_bus.unsubscribe_media_bus({
            "kind": kind,
            "device": device,
            "subscriberId": session_id,
            "saveRecording": True,
        }, emit)
        
        # Clean up local state
        with _sessions_lock:
            _active_sessions.pop(session_id, None)
            _active_recordings.pop(session_id, None)
        
        file_path = unsubscribe_result.get("filePath") or recording_info.get("path")
        
        # Determine stop reason for silence mode
        stopped_by = "stop_signal"
        if mode == "silence":
            # For silence mode, check if it was stopped by silence or manually
            # Since we're calling stop_capture, it's a manual stop
            stopped_by = "stop_signal"
        
        if emit:
            await emit("stop_requested", {
                "sessionId": session_id, 
                "wasActive": True, 
                "filePath": file_path,
                "busMode": True,
                "stoppedBy": stopped_by,
            })
        
        return {
            "ok": True,
            "sessionId": session_id,
            "wasActive": True,
            "stopped": True,
            "filePath": file_path,
            "stoppedBy": stopped_by,
            "busInfo": {
                "busStopped": unsubscribe_result.get("busStopped", False),
                "remainingSubscribers": unsubscribe_result.get("remainingSubscribers", 0),
            },
        }
    
    # Regular (non-bus) capture - set stop event
    with _sessions_lock:
        if stop_event:
            stop_event.set()
            print(f"[stop_capture] Event set! is_set={stop_event.is_set()}")
    
    # Wait briefly for recording to finish writing
    file_path = None
    if recording_info:
        file_path = recording_info.get("path")
        # Wait up to 1 second for recording thread to finish
        for _ in range(20):
            if recording_info.get("completed") or recording_info.get("error"):
                break
            await asyncio.sleep(0.05)
        
        # Clean up recording info
        with _sessions_lock:
            _active_recordings.pop(session_id, None)
    
    if emit:
        await emit("stop_requested", {"sessionId": session_id, "wasActive": was_active, "filePath": file_path})
    
    print(f"[stop_capture] Returning ok=True, wasActive={was_active}, filePath={file_path}")
    return {
        "ok": True, 
        "sessionId": session_id, 
        "wasActive": was_active, 
        "stopped": was_active,
        "filePath": file_path,
        "stoppedBy": "stop_signal" if was_active else None,
    }


async def list_active_captures(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    """
    List all active capture sessions (including bus-based sessions).
    
    Returns:
        { ok, sessions: string[], buses: [...] }
    """
    with _sessions_lock:
        sessions = list(_active_sessions.keys())
        # Get details about each session
        session_details = []
        for sid in sessions:
            info = _active_recordings.get(sid, {})
            session_details.append({
                "sessionId": sid,
                "kind": info.get("kind"),
                "busMode": info.get("bus_mode", False),
                "busId": info.get("bus_id"),
                "filePath": info.get("path"),
            })
    
    # Also get bus status
    bus_status = await media_bus.list_media_buses({}, emit)
    
    return {
        "ok": True, 
        "sessions": sessions,
        "sessionDetails": session_details,
        "buses": bus_status.get("buses", []),
    }


def _parse_device_index(device: Any) -> Optional[int]:
    if device is None:
        return None
    if isinstance(device, int):
        return int(device)
    if isinstance(device, str):
        s = device.strip()
        if s.isdigit():
            return int(s)
    return None


async def _capture_photo(device: Any, explicit_path: str, emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]]) -> Dict[str, Any]:
    try:
        import cv2  # type: ignore
    except Exception:
        raise RuntimeError("opencv-python not installed")

    out_dir = _tmp_dir()
    path = explicit_path or os.path.join(out_dir, f"photo_{int(time.time()*1000)}.jpg")

    idx = _parse_device_index(device)

    # Capture the running loop to safely emit from worker thread
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None  # type: ignore[assignment]

    def _work() -> Dict[str, Any]:
        # Prefer DirectShow on Windows; fallback to default
        cap = cv2.VideoCapture(idx if idx is not None else 0, cv2.CAP_DSHOW)
        if not cap.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            cap = cv2.VideoCapture(idx if idx is not None else 0)
        if not cap.isOpened():
            raise RuntimeError("camera open failed")

        # Warm-up a little
        time.sleep(0.2)
        ok, frame = cap.read()
        try:
            cap.release()
        except Exception:
            pass
        if not ok or frame is None:
            raise RuntimeError("camera read failed")
        if not cv2.imwrite(path, frame):
            raise RuntimeError("failed to write image")
        return {"ok": True, "filePath": path, "mimeType": "image/jpeg"}

    if emit:
        await emit("capturing", {"target": path})
    return await asyncio.to_thread(_work)


async def _capture_video_with_stop(
    device: Any,
    duration_ms: int,
    explicit_path: str,
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]],
    stop_event: threading.Event,
    mode: str,
) -> Dict[str, Any]:
    try:
        import cv2  # type: ignore
    except Exception:
        raise RuntimeError("opencv-python not installed")

    out_dir = _tmp_dir()
    # Try mp4 first, fallback to avi
    preferred_path = explicit_path or os.path.join(out_dir, f"video_{int(time.time()*1000)}.mp4")

    idx = _parse_device_index(device)

    # Capture the running loop to safely emit from worker thread
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None  # type: ignore[assignment]

    def _work() -> Dict[str, Any]:
        cap = cv2.VideoCapture(idx if idx is not None else 0, cv2.CAP_DSHOW)
        if not cap.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            cap = cv2.VideoCapture(idx if idx is not None else 0)
        if not cap.isOpened():
            raise RuntimeError("camera open failed")

        # Determine properties
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
        cap_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if cap_fps < 1 or cap_fps > 120:
            cap_fps = 0.0

        # Warm up + estimate actual FPS to avoid 2x speed recordings
        warmup_frames: List[Any] = []
        warmup_start = time.monotonic()
        for _ in range(15):
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            warmup_frames.append(frame)
        warmup_elapsed = time.monotonic() - warmup_start
        measured_fps = (
            (len(warmup_frames) / warmup_elapsed)
            if warmup_elapsed >= 0.25 and len(warmup_frames) >= 5
            else 0.0
        )
        fps = cap_fps or measured_fps or 20.0
        if measured_fps and (not cap_fps or abs(cap_fps - measured_fps) / measured_fps > 0.25):
            fps = measured_fps

        def _try_writer_mp4_h264(out_path: str):
            try:
                fourcc = cv2.VideoWriter_fourcc(*"H264")
                out = cv2.VideoWriter(out_path, cv2.CAP_MSMF, fourcc, fps, (width, height))
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
                out = cv2.VideoWriter(out_path, cv2.CAP_MSMF, fourcc, fps, (width, height))
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
                out = cv2.VideoWriter(out_path, fourcc, fps, (width, height))
                if out.isOpened():
                    return out
                try:
                    out.release()
                except Exception:
                    pass
            except Exception:
                pass
            return None

        used_path = preferred_path
        out = _try_writer_mp4_h264(preferred_path)
        if out is None:
            used_path = preferred_path.rsplit(".", 1)[0] + ".webm"
            out = _try_writer_webm_vp8(used_path)
        if out is None:
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            out = cv2.VideoWriter(preferred_path, fourcc, fps, (width, height))
            used_path = preferred_path
        if out is None or not out.isOpened():
            used_path = (explicit_path and explicit_path) or os.path.join(out_dir, f"video_{int(time.time()*1000)}.avi")
            fourcc = cv2.VideoWriter_fourcc(*"XVID")
            out = cv2.VideoWriter(used_path, fourcc, fps, (width, height))
        if not out.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            raise RuntimeError("video writer open failed (codec unsupported)")

        start = time.monotonic()
        next_emit = start
        warmup_index = 0
        try:
            while (time.monotonic() - start) * 1000.0 < duration_ms:
                # Check for stop signal in until_stop mode
                if stop_event.is_set():
                    break
                
                if warmup_index < len(warmup_frames):
                    frame = warmup_frames[warmup_index]
                    warmup_index += 1
                    ok = True
                else:
                    ok, frame = cap.read()
                if not ok or frame is None:
                    break
                out.write(frame)
                now = time.monotonic()
                if emit and loop and now - next_emit >= 0.5:
                    next_emit = now
                    try:
                        loop.call_soon_threadsafe(
                            asyncio.create_task,
                            emit("recording", {
                                "elapsedMs": int((now - start) * 1000),
                                "mode": mode,
                            })
                        )
                    except Exception:
                        pass
        finally:
            try:
                out.release()
            except Exception:
                pass
            try:
                cap.release()
            except Exception:
                pass

        mime = "video/webm" if used_path.lower().endswith(".webm") else ("video/mp4" if used_path.lower().endswith(".mp4") else "video/x-msvideo")
        return {"ok": True, "filePath": used_path, "mimeType": mime}

    if emit:
        await emit("capturing", {"target": preferred_path, "mode": mode})
    return await asyncio.to_thread(_work)


async def _capture_audio_with_stop(
    device: Any,
    duration_ms: int,
    explicit_path: str,
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]],
    stop_event: threading.Event,
    mode: str,
) -> Dict[str, Any]:
    try:
        import sounddevice as sd  # type: ignore
        import soundfile as sf  # type: ignore
        import numpy as np  # type: ignore
    except Exception:
        raise RuntimeError("sounddevice/soundfile not installed")

    out_dir = _tmp_dir()
    path = explicit_path or os.path.join(out_dir, f"audio_{int(time.time()*1000)}.wav")

    # Resolve device index if provided
    dev_index = None
    if device is not None:
        if isinstance(device, int):
            dev_index = device
        elif isinstance(device, str) and device.strip().isdigit():
            dev_index = int(device.strip())
        else:
            # Try to find device by name
            try:
                devs = sd.query_devices()  # type: ignore[attr-defined]
                for i, d in enumerate(devs):
                    if str(d.get("name") or "").lower().strip() == str(device).lower().strip():
                        dev_index = i
                        break
            except Exception:
                dev_index = None

    samplerate = 44100
    channels = 1
    try:
        # Determine channels from selected device
        if dev_index is not None:
            info = sd.query_devices(dev_index)  # type: ignore[attr-defined]
        else:
            info = sd.query_devices(None, "input")  # type: ignore[attr-defined]
        max_in = int((info or {}).get("max_input_channels") or 1)
        channels = 1 if max_in < 2 else 2
    except Exception:
        pass

    if emit:
        await emit("recording", {
            "samplerate": samplerate,
            "channels": channels,
            "durationMs": duration_ms if mode == "fixed" else None,
            "target": path,
            "mode": mode,
        })

    # Capture the running loop to safely emit from worker thread
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None  # type: ignore[assignment]

    def _work() -> Dict[str, Any]:
        import queue
        
        # Use InputStream for accurate timing (no drift from sd.rec overhead)
        duration_s = duration_ms / 1000.0
        audio_queue: queue.Queue = queue.Queue()
        all_chunks: List[Any] = []
        
        print(f"[audio_capture] Starting recording for {duration_s}s, mode={mode}")
        
        def audio_callback(indata, frames, time_info, status):
            """Callback to collect audio data from the stream."""
            if status:
                print(f"[audio_capture] Stream status: {status}")
            audio_queue.put(indata.copy())
        
        start = time.monotonic()
        next_emit_time = start
        
        try:
            with sd.InputStream(
                samplerate=samplerate,
                channels=channels,
                dtype="float32",
                device=dev_index,
                callback=audio_callback,
                blocksize=int(samplerate * 0.1),  # 100ms blocks
            ):
                print(f"[audio_capture] Stream opened, recording...")
                
                while True:
                    elapsed = time.monotonic() - start
                    
                    # Check for stop signal (for until_stop mode)
                    if stop_event.is_set():
                        print(f"[audio_capture] Stop signal detected at {elapsed:.1f}s")
                        break
                    
                    # Check if duration reached (for fixed mode)
                    if elapsed >= duration_s:
                        print(f"[audio_capture] Duration reached: {elapsed:.1f}s >= {duration_s}s")
                        break
                    
                    # Collect any available audio data
                    try:
                        while True:
                            chunk = audio_queue.get_nowait()
                            all_chunks.append(chunk)
                    except queue.Empty:
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
                                    "elapsedMs": elapsed_ms,
                                    "totalMs": duration_ms,
                                    "mode": mode,
                                })
                            )
                        except Exception:
                            pass
                    
                    # Small sleep to prevent busy loop
                    time.sleep(0.05)
                
                # Drain remaining audio from queue
                try:
                    while True:
                        chunk = audio_queue.get_nowait()
                        all_chunks.append(chunk)
                except queue.Empty:
                    pass
                    
        except Exception as e:
            print(f"[audio_capture] Error during recording: {e}")
            raise
        
        if not all_chunks:
            raise RuntimeError("no audio data captured")
        
        # Concatenate all chunks and write to file
        data = np.concatenate(all_chunks, axis=0)
        actual_duration = len(data) / samplerate
        print(f"[audio_capture] Captured {actual_duration:.1f}s of audio, saving to {path}")
        sf.write(path, data, samplerate)
        return {"ok": True, "filePath": path, "mimeType": "audio/wav", "durationMs": int(actual_duration * 1000)}

    return await asyncio.to_thread(_work)


async def upload_file_to_url(args: Dict[str, Any]) -> Dict[str, Any]:
    """Upload a local file to an arbitrary URL (e.g., signed GCS URL).

    Args:
        args: { "path": str, "url": str, "method"?: str, "headers"?: Dict[str, str], "mimeType"?: str, "timeoutSeconds"?: int }

    Returns:
        { ok: bool, error?: str, path?: str, url?: str, size?: int, status?: int, detail?: str }
    """

    p = str(args.get("path") or "").strip()
    url_str = str(args.get("url") or "").strip()
    method = str(args.get("method") or "PUT").strip().upper() or "PUT"
    headers = args.get("headers") or {}
    timeout_s = int(args.get("timeoutSeconds") or 600)

    if not p:
        raise ValueError("missing path")
    if not url_str:
        raise ValueError("missing url")

    p = os.path.expanduser(p)
    p = os.path.normpath(p)
    if not os.path.isfile(p):
        raise ValueError(f"path not found: {p}")

    size = os.path.getsize(p)
    if size <= 0:
        return {"ok": False, "error": "empty_file", "path": p}

    mime = str(args.get("mimeType") or "").strip()
    if not mime:
        guess, _ = mimetypes.guess_type(p)
        mime = guess or "application/octet-stream"

    # Ensure headers is a plain dict of strings
    clean_headers: Dict[str, str] = {}
    try:
        for k, v in (headers or {}).items():
            clean_headers[str(k)] = str(v)
    except Exception:
        clean_headers = {}

    if "Content-Type" not in {k.title(): v for k, v in clean_headers.items()}:
        clean_headers["Content-Type"] = mime

    try:
        with open(p, "rb") as f:
            data = f.read()
    except Exception as e:
        return {"ok": False, "error": "read_failed", "path": p, "detail": str(e)}

    try:
        req = request.Request(url_str, data=data, headers=clean_headers, method=method)
        with request.urlopen(req, timeout=timeout_s) as resp:  # type: ignore[arg-type]
            status = getattr(resp, "status", None) or getattr(resp, "code", None)
    except urlerror.HTTPError as e:  # type: ignore[assignment]
        try:
            detail = e.read().decode("utf-8", "ignore")
        except Exception:
            detail = ""
        return {"ok": False, "error": "upload_failed", "status": getattr(e, "code", None), "detail": detail}
    except Exception as e:  # pragma: no cover - network failure
        return {"ok": False, "error": "upload_failed", "detail": str(e)}

    return {"ok": True, "path": p, "url": url_str, "size": size, "status": status}


async def gemini_upload_file(args: Dict[str, Any]) -> Dict[str, Any]:
    """Upload a local file to the Gemini Files API and return its URI.

    Args:
        args: { "path": str, "mimeType"?: str, "displayName"?: str }

    Returns:
        { ok: bool, error?: str, fileUri?: str, fileName?: str, mimeType?: str, size?: int }
    """

    p = str(args.get("path") or "").strip()
    if not p:
        raise ValueError("missing path")

    p = os.path.expanduser(p)
    p = os.path.normpath(p)
    if not os.path.isfile(p):
        raise ValueError(f"path not found: {p}")

    size = os.path.getsize(p)
    # Gemini Files max per-file size is 2GB; stay safely under that.
    max_bytes = 2 * 1024 * 1024 * 1024
    if size <= 0:
        return {"ok": False, "error": "empty_file", "path": p}
    if size > max_bytes:
        return {"ok": False, "error": "file_too_large_for_gemini_files", "path": p, "size": size, "max": max_bytes}

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")
    if not api_key:
        return {"ok": False, "error": "missing_gemini_api_key"}

    mime = str(args.get("mimeType") or "").strip()
    if not mime:
        guess, _ = mimetypes.guess_type(p)
        mime = guess or "application/octet-stream"

    display_name = str(args.get("displayName") or os.path.basename(p) or "media").strip()

    base_url = "https://generativelanguage.googleapis.com"
    start_url = f"{base_url}/upload/v1beta/files?key={api_key}"

    meta = {"file": {"display_name": display_name}}
    body = json.dumps(meta).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": str(size),
        "X-Goog-Upload-Header-Content-Type": mime,
    }

    try:
        req = request.Request(start_url, data=body, headers=headers, method="POST")
        with request.urlopen(req, timeout=60) as resp:  # type: ignore[arg-type]
            upload_url = resp.headers.get("X-Goog-Upload-Url") or resp.headers.get("x-goog-upload-url")
    except urlerror.HTTPError as e:  # type: ignore[assignment]
        try:
            detail = e.read().decode("utf-8", "ignore")
        except Exception:
            detail = ""
        return {"ok": False, "error": "gemini_files_init_failed", "status": getattr(e, "code", None), "detail": detail}
    except Exception as e:  # pragma: no cover - network failure
        return {"ok": False, "error": "gemini_files_init_failed", "detail": str(e)}

    if not upload_url:
        return {"ok": False, "error": "missing_upload_url"}

    # Upload the actual bytes in one shot (Gemini Files supports up to 2GB per file).
    try:
        with open(p, "rb") as f:
            data = f.read()
    except Exception as e:
        return {"ok": False, "error": "read_failed", "detail": str(e)}

    up_headers = {
        "Content-Length": str(len(data)),
        "Content-Type": mime,
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
    }

    try:
        up_req = request.Request(upload_url, data=data, headers=up_headers, method="POST")
        with request.urlopen(up_req, timeout=600) as resp:  # type: ignore[arg-type]
            text = resp.read().decode("utf-8", "ignore")
    except urlerror.HTTPError as e:  # type: ignore[assignment]
        try:
            detail = e.read().decode("utf-8", "ignore")
        except Exception:
            detail = ""
        return {"ok": False, "error": "gemini_files_upload_failed", "status": getattr(e, "code", None), "detail": detail}
    except Exception as e:  # pragma: no cover - network failure
        return {"ok": False, "error": "gemini_files_upload_failed", "detail": str(e)}

    try:
        info = json.loads(text or "{}")
    except Exception:
        info = {}
    file_info = info.get("file") or {}
    file_uri = file_info.get("uri")
    file_name = file_info.get("name")
    mime_returned = file_info.get("mimeType") or mime

    if not file_uri:
        return {"ok": False, "error": "missing_file_uri", "raw": info}

    return {
        "ok": True,
        "fileUri": file_uri,
        "fileName": file_name,
        "mimeType": mime_returned,
        "size": size,
        "path": p,
    }


async def gemini_delete_file(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a file from the Gemini Files API.

    Args:
        args: { "fileUri"?: str, "name"?: str }

    Returns:
        { ok: bool, error?: str, fileUri?: str | None, name?: str | None }
    """

    file_uri = str(args.get("fileUri") or args.get("uri") or "").strip()
    name = str(args.get("name") or "").strip()

    if not file_uri and not name:
        raise ValueError("missing fileUri or name")

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_GENERATIVE_AI_API_KEY")
    if not api_key:
        return {"ok": False, "error": "missing_gemini_api_key"}

    base_url = "https://generativelanguage.googleapis.com"

    if file_uri:
        # Append the API key as a query parameter, preserving any existing query string.
        url = file_uri.split("#", 1)[0]
        if "?" in url:
            url = f"{url}&key={api_key}"
        else:
            url = f"{url}?key={api_key}"
    else:
        n = name.lstrip("/")
        if n.startswith("v1beta/"):
            n = n[len("v1beta/"):]
        url = f"{base_url}/v1beta/{n}?key={api_key}"

    try:
        req = request.Request(url, method="DELETE")
        with request.urlopen(req, timeout=60):  # type: ignore[arg-type]
            pass
    except urlerror.HTTPError as e:  # type: ignore[assignment]
        try:
            detail = e.read().decode("utf-8", "ignore")
        except Exception:
            detail = ""
        return {"ok": False, "error": "gemini_files_delete_failed", "status": getattr(e, "code", None), "detail": detail}
    except Exception as e:  # pragma: no cover - network failure
        return {"ok": False, "error": "gemini_files_delete_failed", "detail": str(e)}

    return {"ok": True, "fileUri": file_uri or None, "name": name or None}


async def play_audio(args: Dict[str, Any], emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None) -> Dict[str, Any]:
    """
    Play an audio file using cross-platform audio libraries.
    Deprecated in the Python agent; audio playback is handled by the desktop (Electron) runtime.
    """
    file_path = str(args.get("path") or args.get("filePath") or "").strip()
    if not file_path:
        return {"ok": False, "error": "missing_file_path"}
    if not os.path.isfile(file_path):
        return {"ok": False, "error": "file_not_found", "path": file_path}

    return {
        "ok": False,
        "error": "play_audio_not_supported_in_agent",
        "hint": "Use the desktop (Electron) play_audio tool instead.",
        "path": file_path,
    }
