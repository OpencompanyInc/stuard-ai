"""
Media Capture Bus System

Allows multiple workflows to share camera/microphone resources.
- First subscriber starts the capture
- Additional subscribers tap into the same stream
- When all subscribers disconnect, capture stops automatically

Usage:
    # Subscribe to audio bus (starts if not running)
    result = await subscribe_media_bus({"kind": "audio", "subscriberId": "workflow1"})
    
    # Get frames/chunks
    result = await get_bus_frames({"kind": "audio", "subscriberId": "workflow1"})
    
    # Unsubscribe (stops bus if last subscriber)
    result = await unsubscribe_media_bus({"kind": "audio", "subscriberId": "workflow1"})
"""

from __future__ import annotations

import asyncio
import os
import queue
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set
from collections import deque

# ─────────────────────────────────────────────────────────────────────────────
# Types and Data Structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class BusSubscriber:
    """A subscriber to a media bus."""
    id: str
    subscribed_at: float = field(default_factory=time.time)
    # Each subscriber has their own cursor into the ring buffer
    cursor: int = 0
    # Optional file recording for this subscriber
    recording_path: Optional[str] = None
    recording_active: bool = False
    # Accumulated data for file recording
    recorded_chunks: List[Any] = field(default_factory=list)
    # Silence detection parameters (for silence mode)
    silence_threshold: Optional[float] = None  # 0.0 to 1.0
    silence_duration_ms: Optional[int] = None  # duration in ms
    silence_stop_event: Optional[threading.Event] = field(default_factory=threading.Event)


@dataclass  
class MediaBus:
    """A shared media capture bus."""
    kind: str  # "audio" or "video"
    device: Optional[int]
    bus_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    
    # State
    running: bool = False
    started_at: Optional[float] = None
    stop_event: threading.Event = field(default_factory=threading.Event)
    
    # Ring buffer for frames/chunks.
    # IMPORTANT: Access from multiple threads (capture + wakeword readers), so guard with buffer_lock.
    # Default maxlen kept modest to avoid high RAM usage (audio chunks can be large).
    buffer: deque = field(default_factory=lambda: deque(maxlen=300))
    buffer_lock: threading.Lock = field(default_factory=threading.Lock)
    buffer_index: int = 0  # Global index for cursor tracking
    
    # Subscribers
    subscribers: Dict[str, BusSubscriber] = field(default_factory=dict)
    subscribers_lock: threading.Lock = field(default_factory=threading.Lock)
    
    # Audio-specific settings
    samplerate: int = 44100
    # NOTE: We expose bus audio as mono (1 channel) for maximum compatibility and consistent wakeword input.
    channels: int = 1
    # Actual device stream channels can differ; we may downmix/select the best channel before publishing to the bus.
    stream_channels: int = 1
    
    # Video-specific settings  
    width: int = 640
    height: int = 480
    fps: float = 20.0
    
    # Thread
    thread: Optional[threading.Thread] = None
    
    # Stats
    total_frames: int = 0
    errors: List[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Global Bus Registry
# ─────────────────────────────────────────────────────────────────────────────

_buses: Dict[str, MediaBus] = {}  # key = "{kind}:{device}" e.g. "audio:0", "video:1"
_buses_lock = threading.Lock()


def _bus_key(kind: str, device: Optional[int] = None) -> str:
    """Generate a unique key for a bus based on kind and device."""
    dev_str = str(device) if device is not None else "default"
    return f"{kind}:{dev_str}"


def _get_or_create_bus(kind: str, device: Optional[int] = None) -> MediaBus:
    """Get existing bus or create new one."""
    key = _bus_key(kind, device)
    with _buses_lock:
        if key not in _buses:
            _buses[key] = MediaBus(kind=kind, device=device)
        return _buses[key]


def _remove_bus(kind: str, device: Optional[int] = None) -> None:
    """Remove a bus from registry."""
    key = _bus_key(kind, device)
    with _buses_lock:
        _buses.pop(key, None)


def _tmp_dir() -> str:
    """Get temp directory for recordings."""
    base = os.path.join(tempfile.gettempdir(), "stuardai", "bus")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        pass
    return base


# ─────────────────────────────────────────────────────────────────────────────
# Bus Worker Threads
# ─────────────────────────────────────────────────────────────────────────────

def _audio_bus_worker(bus: MediaBus) -> None:
    """Background thread that captures audio and distributes to subscribers."""
    try:
        import sounddevice as sd  # type: ignore
        import numpy as np  # type: ignore
    except ImportError as e:
        bus.errors.append(f"Import error: {e}")
        bus.running = False
        return
    
    print(f"[audio_bus] Starting bus '{bus.bus_id}' on device {bus.device}")
    
    audio_queue: queue.Queue = queue.Queue()
    
    # Find available input devices for fallback
    available_devices = []
    try:
        all_devs = sd.query_devices()
        for i, d in enumerate(all_devs):
            if int(d.get("max_input_channels", 0)) > 0:
                available_devices.append(i)
    except Exception:
        pass

    if not available_devices:
        err_msg = "No audio input devices found. Please connect a microphone or enable an audio input device in Windows Sound settings."
        bus.errors.append(err_msg)
        print(f"[audio_bus] Error: {err_msg}")
        bus.running = False
        return

    print(f"[audio_bus] Found {len(available_devices)} input device(s)")

    # Build list of devices to try (requested device first, then fallbacks)
    devices_to_try = []
    if bus.device is not None:
        devices_to_try.append(bus.device)
    devices_to_try.append(None)  # Try default device
    devices_to_try.extend(available_devices)  # Try all available devices
    # Remove duplicates while preserving order
    seen = set()
    devices_to_try = [x for x in devices_to_try if not (x in seen or seen.add(x))]

    # Try each device until one works
    dev_index = None
    stream_opened = False
    last_error = None

    for try_dev in devices_to_try:
        try:
            # Query device info
            if try_dev is not None:
                info = sd.query_devices(try_dev)
            else:
                info = sd.query_devices(None, "input")

            max_in = int((info or {}).get("max_input_channels") or 0)
            if max_in == 0:
                continue

            # Capture at up to stereo if available, but publish mono on the bus.
            stream_channels = 1 if max_in < 2 else 2
            samplerate = int((info or {}).get("default_samplerate") or 44100)

            print(f"[audio_bus] Trying device {try_dev}: {info.get('name', 'unknown')}")

            # Test if we can actually open this device
            test_stream = sd.InputStream(
                samplerate=samplerate,
                channels=stream_channels,
                dtype="float32",
                device=try_dev,
                blocksize=int(samplerate * 0.1),
            )
            test_stream.close()

            # Success! Use this device
            dev_index = try_dev
            bus.stream_channels = stream_channels
            bus.channels = 1
            bus.samplerate = samplerate
            stream_opened = True
            print(f"[audio_bus] Successfully opened device {dev_index}: {info.get('name', 'unknown')}")
            break

        except Exception as e:
            last_error = e
            print(f"[audio_bus] Failed to open device {try_dev}: {e}")
            continue

    if not stream_opened:
        err_msg = f"Failed to open any audio input device. Last error: {last_error}. Check that your microphone is not in use by another application."
        bus.errors.append(err_msg)
        print(f"[audio_bus] Error: {err_msg}")
        bus.running = False
        return

    def audio_callback(indata, frames, time_info, status):
        if status:
            bus.errors.append(f"Stream status: {status}")
        audio_queue.put(indata.copy())

    def _to_mono_best_channel(chunk: "np.ndarray") -> "np.ndarray":
        """Downmix to mono by selecting the loudest channel (robust against silent L/R issues)."""
        try:
            x = chunk.astype(np.float32, copy=False)
            if x.ndim == 1:
                return x
            if x.ndim == 2:
                if x.shape[1] == 1:
                    return x[:, 0]
                # Choose channel with highest RMS energy
                rms = np.sqrt(np.mean(np.square(x), axis=0))
                ch = int(np.argmax(rms))
                return x[:, ch]
            return x.reshape(-1).astype(np.float32, copy=False)
        except Exception:
            # Fallback: naive flatten
            try:
                return chunk.reshape(-1).astype(np.float32, copy=False)
            except Exception:
                return chunk

    try:
        with sd.InputStream(
            samplerate=bus.samplerate,
            channels=bus.stream_channels,
            dtype="float32",
            device=dev_index,
            callback=audio_callback,
            blocksize=int(bus.samplerate * 0.1),  # 100ms blocks
        ):
            print(f"[audio_bus] Stream opened, capturing...")
            
            last_nonzero_ts = time.time()
            # Track silence state for each subscriber
            subscriber_silence_start: Dict[str, float] = {}
            
            while not bus.stop_event.is_set():
                # Check if we have any subscribers
                with bus.subscribers_lock:
                    if not bus.subscribers:
                        print(f"[audio_bus] No subscribers, stopping bus")
                        break
                
                # Collect audio data
                try:
                    while True:
                        raw = audio_queue.get_nowait()
                        chunk = _to_mono_best_channel(raw)
                        # Calculate RMS for silence detection
                        rms = 0.0
                        try:
                            rms = float(np.sqrt(np.mean(np.square(chunk)))) if hasattr(np, "sqrt") else 0.0
                        except Exception:
                            pass
                        
                        # Basic health: if the stream is stuck producing near-zeros for a while, note it.
                        try:
                            peak = float(np.max(np.abs(chunk))) if hasattr(np, "max") else 0.0
                            if peak > 1e-6:
                                last_nonzero_ts = time.time()
                            elif (time.time() - last_nonzero_ts) > 5.0:
                                # Don't spam errors; keep last few.
                                bus.errors.append("audio_silent_5s")
                                bus.errors = bus.errors[-50:]
                                last_nonzero_ts = time.time()
                        except Exception:
                            pass
                        
                        # Add to ring buffer with index
                        with bus.buffer_lock:
                            bus.buffer.append((bus.buffer_index, chunk, time.time()))
                            bus.buffer_index += 1
                            bus.total_frames += 1
                        
                        # Also add to each subscriber's recording buffer if active
                        # and check for silence detection
                        with bus.subscribers_lock:
                            for sub in bus.subscribers.values():
                                if sub.recording_active:
                                    sub.recorded_chunks.append(chunk)
                                    
                                    # Silence detection for this subscriber
                                    if sub.silence_threshold is not None and sub.silence_duration_ms is not None:
                                        is_silent = rms < sub.silence_threshold
                                        silence_duration_s = sub.silence_duration_ms / 1000.0
                                        
                                        if is_silent:
                                            if sub.id not in subscriber_silence_start:
                                                subscriber_silence_start[sub.id] = time.time()
                                                print(f"[audio_bus] Silence detected for subscriber {sub.id}")
                                        else:
                                            if sub.id in subscriber_silence_start:
                                                print(f"[audio_bus] Sound detected for subscriber {sub.id}, resetting silence timer")
                                                del subscriber_silence_start[sub.id]
                                        
                                        # Check if silence duration exceeded
                                        if sub.id in subscriber_silence_start:
                                            silence_elapsed = time.time() - subscriber_silence_start[sub.id]
                                            if silence_elapsed >= silence_duration_s:
                                                print(f"[audio_bus] Silence duration ({silence_elapsed:.1f}s) exceeded for subscriber {sub.id}, stopping")
                                                if sub.silence_stop_event:
                                                    sub.silence_stop_event.set()
                                                del subscriber_silence_start[sub.id]
                except queue.Empty:
                    pass
                
                time.sleep(0.05)  # Small sleep to prevent busy loop
                
    except Exception as e:
        bus.errors.append(f"Stream error: {e}")
        print(f"[audio_bus] Error: {e}")
    
    print(f"[audio_bus] Bus '{bus.bus_id}' stopped, total frames: {bus.total_frames}")
    bus.running = False
    _remove_bus(bus.kind, bus.device)


def _video_bus_worker(bus: MediaBus) -> None:
    """Background thread that captures video and distributes to subscribers."""
    try:
        import cv2  # type: ignore
    except ImportError as e:
        bus.errors.append(f"Import error: {e}")
        bus.running = False
        return
    
    print(f"[video_bus] Starting bus '{bus.bus_id}' on device {bus.device}")
    
    idx = bus.device if bus.device is not None else 0
    
    # Try DirectShow first on Windows
    cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        try:
            cap.release()
        except Exception:
            pass
        cap = cv2.VideoCapture(idx)
    
    if not cap.isOpened():
        bus.errors.append("camera_open_failed")
        bus.running = False
        return
    
    # Get properties
    bus.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 640)
    bus.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 480)
    bus.fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if bus.fps < 1 or bus.fps > 120:
        bus.fps = 20.0
    
    frame_interval = 1.0 / bus.fps
    
    try:
        while not bus.stop_event.is_set():
            # Check if we have any subscribers
            with bus.subscribers_lock:
                if not bus.subscribers:
                    print(f"[video_bus] No subscribers, stopping bus")
                    break
            
            start = time.monotonic()
            ok, frame = cap.read()
            if not ok or frame is None:
                bus.errors.append("frame_read_failed")
                break
            
            # Add to ring buffer
            bus.buffer.append((bus.buffer_index, frame, time.time()))
            bus.buffer_index += 1
            bus.total_frames += 1
            
            # Also add to each subscriber's recording buffer if active
            with bus.subscribers_lock:
                for sub in bus.subscribers.values():
                    if sub.recording_active:
                        sub.recorded_chunks.append(frame)
            
            # Maintain frame rate
            elapsed = time.monotonic() - start
            if elapsed < frame_interval:
                time.sleep(frame_interval - elapsed)
                
    except Exception as e:
        bus.errors.append(f"Capture error: {e}")
        print(f"[video_bus] Error: {e}")
    finally:
        try:
            cap.release()
        except Exception:
            pass
    
    print(f"[video_bus] Bus '{bus.bus_id}' stopped, total frames: {bus.total_frames}")
    bus.running = False
    _remove_bus(bus.kind, bus.device)


def _start_bus(bus: MediaBus) -> None:
    """Start the bus capture thread if not already running."""
    if bus.running:
        return
    
    bus.running = True
    bus.started_at = time.time()
    bus.stop_event.clear()
    bus.buffer.clear()
    bus.buffer_index = 0
    bus.total_frames = 0
    bus.errors.clear()
    
    if bus.kind == "audio":
        bus.thread = threading.Thread(target=_audio_bus_worker, args=(bus,), daemon=True)
    elif bus.kind == "video":
        bus.thread = threading.Thread(target=_video_bus_worker, args=(bus,), daemon=True)
    else:
        bus.running = False
        raise ValueError(f"Unknown bus kind: {bus.kind}")
    
    bus.thread.start()
    
    # Wait briefly for initialization
    time.sleep(0.2)


def _stop_bus(bus: MediaBus) -> None:
    """Stop the bus capture thread."""
    if not bus.running:
        return
    
    bus.stop_event.set()
    if bus.thread and bus.thread.is_alive():
        bus.thread.join(timeout=2.0)
    bus.running = False


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def subscribe_media_bus(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Subscribe to a media bus. Starts the bus if not already running.
    
    Args:
        kind: 'audio' or 'video'
        device: Device ID/index (optional, uses default if not specified)
        subscriberId: Unique ID for this subscriber (auto-generated if not provided)
        startRecording: If true, start recording to a file immediately (default: false)
        filePath: Output file path for recording (auto-generated if not provided)
        silenceThreshold: Silence detection threshold (0.0 to 1.0) for silence mode
        silenceDurationMs: Duration in ms of silence required to stop recording
    
    Returns:
        { ok, busId, subscriberId, kind, device, isNewBus, subscriberCount, filePath? }
    """
    kind = str(args.get("kind") or "").strip().lower()
    if kind not in ("audio", "video"):
        raise ValueError("kind must be 'audio' or 'video'")
    
    device = args.get("device")
    device_idx = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())
    
    subscriber_id = str(args.get("subscriberId") or "").strip() or str(uuid.uuid4())[:8]
    start_recording = bool(args.get("startRecording", False))
    file_path = str(args.get("filePath") or "").strip()
    silence_threshold = args.get("silenceThreshold")
    silence_duration_ms = args.get("silenceDurationMs")
    
    # Get or create bus
    bus = _get_or_create_bus(kind, device_idx)
    is_new_bus = not bus.running
    
    # Create subscriber
    subscriber = BusSubscriber(
        id=subscriber_id,
        cursor=bus.buffer_index,  # Start from current position
        silence_threshold=float(silence_threshold) if silence_threshold is not None else None,
        silence_duration_ms=int(silence_duration_ms) if silence_duration_ms is not None else None,
    )
    
    # Setup recording if requested
    if start_recording:
        if not file_path:
            ext = "wav" if kind == "audio" else "mp4"
            file_path = os.path.join(_tmp_dir(), f"{kind}_{subscriber_id}_{int(time.time()*1000)}.{ext}")
        subscriber.recording_path = file_path
        subscriber.recording_active = True
    
    # Add subscriber
    with bus.subscribers_lock:
        bus.subscribers[subscriber_id] = subscriber
        subscriber_count = len(bus.subscribers)
    
    # If the bus is already running and we started recording, seed the recording with a couple of recent chunks.
    # This reduces the chance of "empty" recordings for very short captures and improves UX when attaching mid-stream.
    if start_recording and bus.running:
        try:
            with bus.buffer_lock:
                tail = list(bus.buffer)[-3:]
            if tail:
                with bus.subscribers_lock:
                    sub_ref = bus.subscribers.get(subscriber_id)
                    if sub_ref and sub_ref.recording_active:
                        for _idx, data, _ts in tail:
                            sub_ref.recorded_chunks.append(data)
        except Exception:
            pass
    
    # Start bus if needed
    if is_new_bus:
        def start_in_thread():
            _start_bus(bus)
        await asyncio.to_thread(start_in_thread)
    
    if emit:
        await emit("subscribed", {
            "busId": bus.bus_id,
            "subscriberId": subscriber_id,
            "kind": kind,
            "device": device_idx,
            "isNewBus": is_new_bus,
        })
    
    result: Dict[str, Any] = {
        "ok": True,
        "busId": bus.bus_id,
        "subscriberId": subscriber_id,
        "kind": kind,
        "device": device_idx,
        "isNewBus": is_new_bus,
        "subscriberCount": subscriber_count,
    }
    
    if kind == "audio":
        result["samplerate"] = bus.samplerate
        result["channels"] = bus.channels
    elif kind == "video":
        result["width"] = bus.width
        result["height"] = bus.height
        result["fps"] = bus.fps
    
    if subscriber.recording_path:
        result["filePath"] = subscriber.recording_path
        result["recording"] = True
    
    return result


async def unsubscribe_media_bus(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Unsubscribe from a media bus. Stops the bus if no subscribers remain.
    
    Args:
        kind: 'audio' or 'video'
        device: Device ID/index (optional)
        subscriberId: ID of subscriber to remove
        saveRecording: If true, save accumulated recording to file (default: true if recording was active)
    
    Returns:
        { ok, subscriberId, busStopped, remainingSubscribers, filePath? }
    """
    kind = str(args.get("kind") or "").strip().lower()
    if kind not in ("audio", "video"):
        raise ValueError("kind must be 'audio' or 'video'")
    
    device = args.get("device")
    device_idx = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())
    
    subscriber_id = str(args.get("subscriberId") or "").strip()
    if not subscriber_id:
        raise ValueError("subscriberId is required")
    
    save_recording = args.get("saveRecording", True)
    
    key = _bus_key(kind, device_idx)
    with _buses_lock:
        bus = _buses.get(key)
    
    if not bus:
        return {"ok": True, "subscriberId": subscriber_id, "busStopped": True, "remainingSubscribers": 0, "wasSubscribed": False}
    
    file_path = None
    was_recording = False
    recorded_chunks = []
    
    # Remove subscriber and get their data
    with bus.subscribers_lock:
        subscriber = bus.subscribers.pop(subscriber_id, None)
        remaining = len(bus.subscribers)
        
        if subscriber:
            was_recording = subscriber.recording_active
            file_path = subscriber.recording_path
            recorded_chunks = subscriber.recorded_chunks.copy()
    
    # Save recording if needed
    if was_recording and save_recording and file_path and recorded_chunks:
        await _save_recording(kind, file_path, recorded_chunks, bus)
    
    # Stop bus if no subscribers
    bus_stopped = False
    if remaining == 0:
        def stop_in_thread():
            _stop_bus(bus)
        await asyncio.to_thread(stop_in_thread)
        bus_stopped = True
    
    if emit:
        await emit("unsubscribed", {
            "subscriberId": subscriber_id,
            "busStopped": bus_stopped,
            "remainingSubscribers": remaining,
        })
    
    result: Dict[str, Any] = {
        "ok": True,
        "subscriberId": subscriber_id,
        "busStopped": bus_stopped,
        "remainingSubscribers": remaining,
        "wasSubscribed": subscriber is not None,
    }
    
    if file_path and was_recording:
        result["filePath"] = file_path
        result["recording"] = {"saved": save_recording and bool(recorded_chunks), "chunks": len(recorded_chunks)}
    
    return result


async def _save_recording(kind: str, file_path: str, chunks: List[Any], bus: MediaBus) -> None:
    """Save accumulated recording chunks to file."""
    if not chunks:
        return
    
    def _save_audio():
        try:
            import soundfile as sf  # type: ignore
            import numpy as np  # type: ignore
            data = np.concatenate(chunks, axis=0).astype(np.float32, copy=False)
            # Ensure we write a broadly compatible WAV (PCM_16) even if internal dtype is float32.
            # Also clamp to [-1, 1] to avoid wrap/clipping issues.
            data = np.clip(data, -1.0, 1.0)
            sf.write(file_path, data, bus.samplerate, subtype="PCM_16")
            dur_s = float(data.shape[0]) / float(bus.samplerate or 1)
            print(f"[media_bus] Saved audio recording: {file_path} ({len(chunks)} chunks, {dur_s:.2f}s @ {bus.samplerate}Hz mono)")
        except Exception as e:
            print(f"[media_bus] Failed to save audio: {e}")
    
    def _save_video():
        try:
            import cv2  # type: ignore
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            out = cv2.VideoWriter(file_path, fourcc, bus.fps, (bus.width, bus.height))
            if not out.isOpened():
                # Fallback to XVID AVI
                avi_path = file_path.replace(".mp4", ".avi")
                fourcc = cv2.VideoWriter_fourcc(*"XVID")
                out = cv2.VideoWriter(avi_path, fourcc, bus.fps, (bus.width, bus.height))
            
            for frame in chunks:
                out.write(frame)
            out.release()
            print(f"[media_bus] Saved video recording: {file_path} ({len(chunks)} frames)")
        except Exception as e:
            print(f"[media_bus] Failed to save video: {e}")
    
    if kind == "audio":
        await asyncio.to_thread(_save_audio)
    elif kind == "video":
        await asyncio.to_thread(_save_video)


async def get_bus_status(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Get status of a media bus.
    
    Args:
        kind: 'audio' or 'video' (optional - if not provided, returns all buses)
        device: Device ID/index (optional)
    
    Returns:
        { ok, buses: [...] } or { ok, bus: {...} }
    """
    kind = str(args.get("kind") or "").strip().lower() or None
    device = args.get("device")
    device_idx = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())
    
    if kind:
        # Get specific bus
        key = _bus_key(kind, device_idx)
        with _buses_lock:
            bus = _buses.get(key)
        
        if not bus:
            return {"ok": True, "bus": None, "running": False}
        
        with bus.subscribers_lock:
            subscriber_ids = list(bus.subscribers.keys())
        try:
            with bus.buffer_lock:
                buffer_size = len(bus.buffer)
        except Exception:
            buffer_size = len(bus.buffer)
        
        return {
            "ok": True,
            "bus": {
                "busId": bus.bus_id,
                "kind": bus.kind,
                "device": bus.device,
                "running": bus.running,
                "startedAt": bus.started_at,
                "totalFrames": bus.total_frames,
                "subscriberCount": len(subscriber_ids),
                "subscribers": subscriber_ids,
                "bufferSize": buffer_size,
                "errors": bus.errors[-5:] if bus.errors else [],  # Last 5 errors
            },
            "running": bus.running,
        }
    
    # Get all buses
    with _buses_lock:
        all_buses = list(_buses.values())
    
    result_buses = []
    for bus in all_buses:
        with bus.subscribers_lock:
            subscriber_ids = list(bus.subscribers.keys())
        result_buses.append({
            "busId": bus.bus_id,
            "kind": bus.kind,
            "device": bus.device,
            "running": bus.running,
            "subscriberCount": len(subscriber_ids),
            "totalFrames": bus.total_frames,
        })
    
    return {"ok": True, "buses": result_buses}


async def start_bus_recording(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Start recording for an existing bus subscriber.
    
    Args:
        kind: 'audio' or 'video'
        device: Device ID/index (optional)
        subscriberId: ID of the subscriber
        filePath: Output file path (auto-generated if not provided)
    
    Returns:
        { ok, subscriberId, filePath, recording }
    """
    kind = str(args.get("kind") or "").strip().lower()
    if kind not in ("audio", "video"):
        raise ValueError("kind must be 'audio' or 'video'")
    
    device = args.get("device")
    device_idx = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())
    
    subscriber_id = str(args.get("subscriberId") or "").strip()
    if not subscriber_id:
        raise ValueError("subscriberId is required")
    
    file_path = str(args.get("filePath") or "").strip()
    
    key = _bus_key(kind, device_idx)
    with _buses_lock:
        bus = _buses.get(key)
    
    if not bus:
        return {"ok": False, "error": "bus_not_found"}
    
    with bus.subscribers_lock:
        subscriber = bus.subscribers.get(subscriber_id)
        if not subscriber:
            return {"ok": False, "error": "subscriber_not_found"}
        
        if subscriber.recording_active:
            return {"ok": True, "subscriberId": subscriber_id, "filePath": subscriber.recording_path, "recording": True, "alreadyRecording": True}
        
        if not file_path:
            ext = "wav" if kind == "audio" else "mp4"
            file_path = os.path.join(_tmp_dir(), f"{kind}_{subscriber_id}_{int(time.time()*1000)}.{ext}")
        
        subscriber.recording_path = file_path
        subscriber.recording_active = True
        subscriber.recorded_chunks.clear()
    
    if emit:
        await emit("recording_started", {
            "subscriberId": subscriber_id,
            "filePath": file_path,
        })
    
    return {"ok": True, "subscriberId": subscriber_id, "filePath": file_path, "recording": True}


async def stop_bus_recording(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Stop recording for a bus subscriber and save the file.
    
    Args:
        kind: 'audio' or 'video'
        device: Device ID/index (optional)
        subscriberId: ID of the subscriber
        saveRecording: If true, save accumulated recording to file (default: true)
    
    Returns:
        { ok, subscriberId, filePath?, chunks }
    """
    kind = str(args.get("kind") or "").strip().lower()
    if kind not in ("audio", "video"):
        raise ValueError("kind must be 'audio' or 'video'")
    
    device = args.get("device")
    device_idx = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())
    
    subscriber_id = str(args.get("subscriberId") or "").strip()
    if not subscriber_id:
        raise ValueError("subscriberId is required")
    
    save_recording = args.get("saveRecording", True)
    
    key = _bus_key(kind, device_idx)
    with _buses_lock:
        bus = _buses.get(key)
    
    if not bus:
        return {"ok": False, "error": "bus_not_found"}
    
    file_path = None
    recorded_chunks = []
    
    with bus.subscribers_lock:
        subscriber = bus.subscribers.get(subscriber_id)
        if not subscriber:
            return {"ok": False, "error": "subscriber_not_found"}
        
        if not subscriber.recording_active:
            return {"ok": True, "subscriberId": subscriber_id, "recording": False, "wasRecording": False}
        
        file_path = subscriber.recording_path
        recorded_chunks = subscriber.recorded_chunks.copy()
        subscriber.recording_active = False
        subscriber.recorded_chunks.clear()
    
    # Save recording
    if save_recording and file_path and recorded_chunks:
        await _save_recording(kind, file_path, recorded_chunks, bus)
    
    if emit:
        await emit("recording_stopped", {
            "subscriberId": subscriber_id,
            "filePath": file_path,
            "chunks": len(recorded_chunks),
        })
    
    return {
        "ok": True,
        "subscriberId": subscriber_id,
        "filePath": file_path if save_recording and recorded_chunks else None,
        "chunks": len(recorded_chunks),
        "saved": save_recording and bool(recorded_chunks),
    }


async def get_bus_frames(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Get latest frames/chunks from the bus for a subscriber.
    Only returns frames since the subscriber's last read.
    
    Args:
        kind: 'audio' or 'video'
        device: Device ID/index (optional)
        subscriberId: ID of the subscriber
        maxFrames: Maximum frames to return (default: 50)
        asBase64: If true, encode frames as base64 (default: false, only for video)
    
    Returns:
        { ok, frames: [...], frameCount, newCursor }
    """
    kind = str(args.get("kind") or "").strip().lower()
    if kind not in ("audio", "video"):
        raise ValueError("kind must be 'audio' or 'video'")
    
    device = args.get("device")
    device_idx = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())
    
    subscriber_id = str(args.get("subscriberId") or "").strip()
    if not subscriber_id:
        raise ValueError("subscriberId is required")
    
    max_frames = int(args.get("maxFrames") or 50)
    as_base64 = bool(args.get("asBase64", False))
    
    key = _bus_key(kind, device_idx)
    with _buses_lock:
        bus = _buses.get(key)
    
    if not bus:
        return {"ok": False, "error": "bus_not_found"}
    
    with bus.subscribers_lock:
        subscriber = bus.subscribers.get(subscriber_id)
        if not subscriber:
            return {"ok": False, "error": "subscriber_not_found"}
        
        cursor = subscriber.cursor
    
    # Snapshot buffer under lock to avoid races with capture thread
    try:
        with bus.buffer_lock:
            snap = list(bus.buffer)
    except Exception:
        snap = list(bus.buffer)
    
    # Get frames since cursor
    frames = []
    new_cursor = cursor
    
    for idx, data, timestamp in snap:
        if idx >= cursor:
            if len(frames) >= max_frames:
                break
            
            frame_data: Dict[str, Any] = {"index": idx, "timestamp": timestamp}
            
            if kind == "video" and as_base64:
                try:
                    import cv2  # type: ignore
                    import base64
                    _, buffer = cv2.imencode('.jpg', data)
                    frame_data["data"] = base64.b64encode(buffer).decode('utf-8')
                    frame_data["format"] = "jpeg"
                except Exception as e:
                    frame_data["error"] = str(e)
            elif kind == "audio":
                # Audio chunks are numpy arrays - convert to list for JSON
                try:
                    frame_data["samples"] = len(data)
                    frame_data["data"] = data.tolist() if hasattr(data, 'tolist') else list(data)
                except Exception:
                    frame_data["samples"] = 0
            
            frames.append(frame_data)
            new_cursor = idx + 1
    
    # Update subscriber's cursor
    with bus.subscribers_lock:
        if subscriber_id in bus.subscribers:
            bus.subscribers[subscriber_id].cursor = new_cursor
    
    return {
        "ok": True,
        "frames": frames,
        "frameCount": len(frames),
        "newCursor": new_cursor,
        "busRunning": bus.running,
    }


async def list_media_buses(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    List all active media buses.
    
    Returns:
        { ok, buses: [...] }
    """
    with _buses_lock:
        all_buses = list(_buses.values())
    
    result_buses = []
    for bus in all_buses:
        with bus.subscribers_lock:
            subscriber_ids = list(bus.subscribers.keys())
        result_buses.append({
            "busId": bus.bus_id,
            "kind": bus.kind,
            "device": bus.device,
            "running": bus.running,
            "startedAt": bus.started_at,
            "subscriberCount": len(subscriber_ids),
            "subscribers": subscriber_ids,
            "totalFrames": bus.total_frames,
        })
    
    return {"ok": True, "buses": result_buses}
