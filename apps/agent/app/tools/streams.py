"""
Workflow Streaming System — Stream Registry

A general-purpose streaming primitive for the workflow engine.
Any data producer (camera, mic, LLM, external API, custom Python script) can push
chunks into a named stream, and downstream steps consume/transform them reactively
in real-time.

Streams are first-class workflow primitives:
  - A step can open a stream that emits chunks over time
  - Downstream steps connected via stream wires process each chunk as it arrives
  - When the source stream closes, consumers get a final end signal

Usage:
    result = await stream_create({"kind": "video_frames", "flowId": "flow_1", "sourceStepId": "capture"})
    streamId = result["streamId"]

    await stream_write({"streamId": streamId, "chunk": <data>})

    result = await stream_read({"streamId": streamId, "subscriberId": "sub1"})
    # returns { ok, chunks: [...], hasMore, closed }

    await stream_close({"streamId": streamId})
"""

from __future__ import annotations

import asyncio
import base64
import importlib
import os
import tempfile
import threading
import time
import traceback
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# Types and Data Structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class StreamSubscriber:
    """A subscriber (consumer) of a stream."""
    id: str
    cursor: int = 0                          # Next chunk index to read
    subscribed_at: float = field(default_factory=time.time)
    label: str = ""                          # Human-readable label (e.g., step ID)


@dataclass
class StreamTransform:
    """A transform in the stream pipeline."""
    id: str
    type: str = "python"                     # "python" | "builtin"
    code: str = ""                           # Python source for the transform function
    params: Dict[str, Any] = field(default_factory=dict)
    order: int = 0                           # Position in the chain
    _compiled_fn: Optional[Callable] = field(default=None, repr=False)


@dataclass
class Stream:
    """A named stream that carries chunks from a producer to consumers."""
    id: str                                  # Unique stream ID
    kind: str                                # "video_frames" | "audio_chunks" | "text" | "json" | "bytes"
    source_step_id: str                      # Which workflow step created this stream
    flow_id: str                             # Which workflow run owns this stream

    # Ring buffer of (index, chunk, timestamp)
    buffer: deque = field(default_factory=lambda: deque(maxlen=500))
    buffer_lock: threading.Lock = field(default_factory=threading.Lock)
    buffer_index: int = 0                    # Global monotonic chunk index

    # Subscribers
    subscribers: Dict[str, StreamSubscriber] = field(default_factory=dict)
    subscribers_lock: threading.Lock = field(default_factory=threading.Lock)

    # Transform pipeline
    transforms: Dict[str, StreamTransform] = field(default_factory=dict)
    transforms_lock: threading.Lock = field(default_factory=threading.Lock)

    # Lifecycle
    closed: bool = False
    close_event: threading.Event = field(default_factory=threading.Event)
    created_at: float = field(default_factory=time.time)
    closed_at: Optional[float] = None

    # Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Stats
    total_chunks: int = 0
    total_bytes: int = 0
    errors: List[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Global Stream Registry
# ─────────────────────────────────────────────────────────────────────────────

_streams: Dict[str, Stream] = {}
_streams_lock = threading.Lock()


# ─────────────────────────────────────────────────────────────────────────────
# Chunk References — zero-copy passing of in-memory data between Python tools
# ─────────────────────────────────────────────────────────────────────────────

_chunk_refs: Dict[str, Any] = {}
_chunk_refs_ts: Dict[str, float] = {}  # creation timestamps
_chunk_refs_lock = threading.Lock()
_CHUNK_REF_TTL = 10.0  # seconds before auto-cleanup


def store_chunk_ref(data: Any) -> str:
    """Store data in-memory and return a lightweight reference ID."""
    ref_id = f"ref_{uuid.uuid4().hex[:12]}"
    with _chunk_refs_lock:
        _chunk_refs[ref_id] = data
        _chunk_refs_ts[ref_id] = time.time()
    return ref_id


def get_chunk_ref(ref_id: str) -> Any:
    """Retrieve in-memory data by reference ID. Returns None if expired/missing."""
    with _chunk_refs_lock:
        return _chunk_refs.get(ref_id)


def release_chunk_ref(ref_id: str) -> None:
    """Explicitly release a chunk reference."""
    with _chunk_refs_lock:
        _chunk_refs.pop(ref_id, None)
        _chunk_refs_ts.pop(ref_id, None)


def _cleanup_expired_refs() -> int:
    """Remove references older than TTL. Returns count removed."""
    now = time.time()
    expired: List[str] = []
    with _chunk_refs_lock:
        for rid, ts in _chunk_refs_ts.items():
            if now - ts > _CHUNK_REF_TTL:
                expired.append(rid)
        for rid in expired:
            _chunk_refs.pop(rid, None)
            _chunk_refs_ts.pop(rid, None)
    return len(expired)


def _get_stream(stream_id: str) -> Optional[Stream]:
    with _streams_lock:
        return _streams.get(stream_id)


def _remove_stream(stream_id: str) -> Optional[Stream]:
    with _streams_lock:
        return _streams.pop(stream_id, None)


# ─────────────────────────────────────────────────────────────────────────────
# Transform Compilation
# ─────────────────────────────────────────────────────────────────────────────

def _compile_transform(t: StreamTransform) -> Optional[Callable]:
    """Compile a Python transform string into a callable."""
    if t._compiled_fn is not None:
        return t._compiled_fn

    if t.type == "python" and t.code:
        try:
            local_ns: Dict[str, Any] = {}
            exec(t.code, {"__builtins__": __builtins__}, local_ns)
            fn = local_ns.get("transform")
            if callable(fn):
                t._compiled_fn = fn
                return fn
            else:
                print(f"[streams] Transform '{t.id}' has no 'transform' function")
                return None
        except Exception as e:
            print(f"[streams] Failed to compile transform '{t.id}': {e}")
            return None

    return None


def _apply_transforms(stream: Stream, chunk: Any) -> Any:
    """Apply the transform chain to a chunk."""
    with stream.transforms_lock:
        if not stream.transforms:
            return chunk
        ordered = sorted(stream.transforms.values(), key=lambda t: t.order)

    result = chunk
    for t in ordered:
        fn = _compile_transform(t)
        if fn is None:
            continue
        try:
            result = fn(result, t.params)
        except Exception as e:
            stream.errors.append(f"transform_{t.id}_error: {e}")
            stream.errors = stream.errors[-50:]
            # On transform error, pass through unchanged
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Tool Handlers
# ─────────────────────────────────────────────────────────────────────────────

async def stream_create(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Create a named stream.

    Args:
        kind: Stream data type ("video_frames", "audio_chunks", "text", "json", "bytes")
        flowId: Workflow run ID that owns this stream
        sourceStepId: Step ID that produces data into this stream
        bufferSize: Max chunks in ring buffer (default: 500)
        metadata: Optional metadata dict (fps, samplerate, etc.)

    Returns:
        { ok, streamId, kind, flowId, sourceStepId }
    """
    kind = str(args.get("kind") or "bytes").strip()
    flow_id = str(args.get("flowId") or "").strip()
    source_step_id = str(args.get("sourceStepId") or "").strip()
    buffer_size = int(args.get("bufferSize") or 500)
    metadata = args.get("metadata") or {}

    stream_id = f"stream_{uuid.uuid4().hex[:12]}"

    stream = Stream(
        id=stream_id,
        kind=kind,
        source_step_id=source_step_id,
        flow_id=flow_id,
        buffer=deque(maxlen=max(10, min(buffer_size, 10000))),
        metadata=dict(metadata) if isinstance(metadata, dict) else {},
    )

    with _streams_lock:
        _streams[stream_id] = stream

    print(f"[streams] Created stream '{stream_id}' (kind={kind}, flow={flow_id}, source={source_step_id})")

    if emit:
        await emit("stream_created", {"streamId": stream_id, "kind": kind})

    return {
        "ok": True,
        "streamId": stream_id,
        "kind": kind,
        "flowId": flow_id,
        "sourceStepId": source_step_id,
    }


async def stream_write(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Push a chunk to a stream.

    Args:
        streamId: Target stream ID
        chunk: The data chunk (any JSON-serializable value, or base64 for binary)
        chunkType: Optional hint ("raw", "base64", "json") — default inferred from kind

    Returns:
        { ok, index, subscriberCount }
    """
    stream_id = str(args.get("streamId") or "").strip()
    chunk = args.get("chunk")
    chunk_type = str(args.get("chunkType") or "").strip()

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}
    if stream.closed:
        return {"ok": False, "error": "stream_closed"}

    # Decode base64 if needed
    if chunk_type == "base64" and isinstance(chunk, str):
        try:
            chunk = base64.b64decode(chunk)
        except Exception:
            pass

    # Apply transforms
    transformed = _apply_transforms(stream, chunk)

    # Write to ring buffer
    with stream.buffer_lock:
        idx = stream.buffer_index
        stream.buffer.append((idx, transformed, time.time()))
        stream.buffer_index += 1
        stream.total_chunks += 1

    # Estimate size
    try:
        if isinstance(transformed, (bytes, bytearray)):
            stream.total_bytes += len(transformed)
        elif hasattr(transformed, 'nbytes'):
            stream.total_bytes += int(transformed.nbytes)
    except Exception:
        pass

    with stream.subscribers_lock:
        sub_count = len(stream.subscribers)

    return {"ok": True, "index": idx, "subscriberCount": sub_count}


async def stream_read(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Read next chunk(s) from a stream (cursor-based).

    Args:
        streamId: Stream to read from
        subscriberId: Subscriber ID (must have subscribed first)
        maxChunks: Max chunks to return (default: 50)
        waitMs: If no new chunks, wait up to this many ms for new data (default: 0 = don't wait)
        asBase64: If true, encode binary chunks as base64 strings

    Returns:
        { ok, chunks: [{index, data, timestamp}], hasMore, closed, newCursor }
    """
    stream_id = str(args.get("streamId") or "").strip()
    subscriber_id = str(args.get("subscriberId") or "").strip()
    max_chunks = int(args.get("maxChunks") or 50)
    wait_ms = int(args.get("waitMs") or 0)
    as_base64 = bool(args.get("asBase64", False))
    latest_only = bool(args.get("latestOnly", False))
    format_opt = str(args.get("format") or "").strip().lower()

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}
    if not subscriber_id:
        return {"ok": False, "error": "missing_subscriberId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}

    # Periodically clean up expired chunk references
    _cleanup_expired_refs()

    with stream.subscribers_lock:
        sub = stream.subscribers.get(subscriber_id)
        if not sub:
            return {"ok": False, "error": "subscriber_not_found"}
        cursor = sub.cursor

    # Try to read chunks
    chunks = _read_latest_chunk_from_buffer(stream, cursor, as_base64, format_opt) if latest_only else _read_chunks_from_buffer(stream, cursor, max_chunks, as_base64, format_opt)

    # If no chunks and waitMs > 0, poll briefly
    if not chunks and wait_ms > 0 and not stream.closed:
        deadline = time.time() + (wait_ms / 1000.0)
        while time.time() < deadline and not stream.closed:
            await asyncio.sleep(0.02)  # 20ms poll interval
            chunks = _read_latest_chunk_from_buffer(stream, cursor, as_base64, format_opt) if latest_only else _read_chunks_from_buffer(stream, cursor, max_chunks, as_base64, format_opt)
            if chunks:
                break

    # Atomically claim the chunks against the subscriber cursor. Two reads on the
    # SAME subscriber can run concurrently (e.g. a poller whose read blocks longer
    # than its tick); both started from `cursor`, so without this both would
    # return the same chunks and advance independently → the SAME chunk delivered
    # more than once (this surfaced as duplicated transcripts). If another read
    # already advanced the cursor past part of what we read, drop those chunks.
    new_cursor = cursor
    with stream.subscribers_lock:
        sub = stream.subscribers.get(subscriber_id)
        if sub is not None:
            if chunks and sub.cursor > cursor:
                chunks = [c for c in chunks if c["index"] >= sub.cursor]
            if chunks:
                sub.cursor = chunks[-1]["index"] + 1
            new_cursor = sub.cursor

    # Check if there are more chunks beyond what we returned
    has_more = False
    if chunks:
        with stream.buffer_lock:
            has_more = stream.buffer_index > new_cursor

    return {
        "ok": True,
        "chunks": chunks,
        "chunkCount": len(chunks),
        "hasMore": has_more,
        "closed": stream.closed,
        "newCursor": new_cursor,
    }


_FRAME_TMP_DIR: Optional[str] = None


def _get_frame_tmp_dir() -> str:
    """Return (and lazily create) a temp directory for stream video frames."""
    global _FRAME_TMP_DIR
    if _FRAME_TMP_DIR is None or not os.path.isdir(_FRAME_TMP_DIR):
        _FRAME_TMP_DIR = os.path.join(tempfile.gettempdir(), "stuard_stream_frames")
        os.makedirs(_FRAME_TMP_DIR, exist_ok=True)
    return _FRAME_TMP_DIR


def _is_video_frame(data: Any) -> bool:
    """Check if data looks like a numpy video frame (H x W x C array)."""
    return (
        hasattr(data, "shape")
        and hasattr(data, "dtype")
        and len(getattr(data, "shape", ())) == 3
    )


def _encode_frame_base64(data: Any, quality: int = 80) -> str:
    """Encode a numpy video frame as a base64 JPEG data URL (no disk I/O)."""
    import cv2  # type: ignore

    ok, buf = cv2.imencode('.jpg', data, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("Failed to encode frame as JPEG")
    b64 = base64.b64encode(buf.tobytes()).decode('ascii')
    return f"data:image/jpeg;base64,{b64}"


def _save_frame_to_file(data: Any, stream_id: str, idx: int) -> str:
    """Save a numpy video frame to a temp JPEG file and return the path."""
    import cv2  # type: ignore

    tmp_dir = _get_frame_tmp_dir()
    path = os.path.join(tmp_dir, f"frame_{stream_id}_{idx}.jpg")
    cv2.imwrite(path, data, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return path


def _cleanup_stream_frames(stream_id: str) -> None:
    """Remove temp frame files for a given stream."""
    try:
        tmp_dir = _get_frame_tmp_dir()
        prefix = f"frame_{stream_id}_"
        removed = 0
        for fname in os.listdir(tmp_dir):
            if fname.startswith(prefix):
                try:
                    os.remove(os.path.join(tmp_dir, fname))
                    removed += 1
                except OSError:
                    pass
        if removed:
            print(f"[streams] Cleaned up {removed} temp frame file(s) for stream '{stream_id}'")
    except Exception:
        pass


def _read_chunks_from_buffer(
    stream: Stream, cursor: int, max_chunks: int, as_base64: bool, format_opt: str = ""
) -> List[Dict[str, Any]]:
    """Read chunks from the ring buffer starting at cursor."""
    try:
        with stream.buffer_lock:
            snap = list(stream.buffer)
    except Exception:
        snap = list(stream.buffer)

    chunks: List[Dict[str, Any]] = []
    for item in snap:
        # Support both 3-tuple (legacy) and 4-tuple (with metadata) formats
        if len(item) == 4:
            idx, data, timestamp, meta = item
        else:
            idx, data, timestamp = item
            meta = None

        if idx >= cursor:
            if len(chunks) >= max_chunks:
                break

            chunk_data = _serialize_chunk_data(data, as_base64, format_opt)

            chunk_out: Dict[str, Any] = {
                "index": idx,
                "data": chunk_data,
                "timestamp": timestamp,
            }
            # Merge metadata (e.g. volume) into the chunk output
            if meta and isinstance(meta, dict):
                chunk_out.update(meta)
            chunks.append(chunk_out)

    return chunks


def _read_latest_chunk_from_buffer(
    stream: Stream, cursor: int, as_base64: bool, format_opt: str = ""
) -> List[Dict[str, Any]]:
    """Read only the newest available chunk at/after cursor (real-time mode)."""
    try:
        with stream.buffer_lock:
            snap = list(stream.buffer)
    except Exception:
        snap = list(stream.buffer)

    for item in reversed(snap):
        # Support both 3-tuple (legacy) and 4-tuple (with metadata) formats
        if len(item) == 4:
            idx, data, timestamp, meta = item
        else:
            idx, data, timestamp = item
            meta = None

        if idx >= cursor:
            chunk_out: Dict[str, Any] = {
                "index": idx,
                "data": _serialize_chunk_data(data, as_base64, format_opt),
                "timestamp": timestamp,
            }
            if meta and isinstance(meta, dict):
                chunk_out.update(meta)
            return [chunk_out]

    return []


def _serialize_chunk_data(data: Any, as_base64: bool, format_opt: str = "") -> Any:
    """Serialize a buffer chunk into a wire-safe representation.

    format_opt:
        ""      — default (base64 for video frames)
        "ref"   — store in-memory, return {"__ref": ref_id} (zero-copy)
        "base64" — always encode video frames as base64 data URL
    """
    if _is_video_frame(data):
        if format_opt == "ref":
            ref_id = store_chunk_ref(data)
            return {"__ref": ref_id, "shape": list(data.shape)}
        try:
            return _encode_frame_base64(data)
        except Exception as exc:
            return f"__frame_encode_error:{exc}"

    if as_base64:
        if isinstance(data, (bytes, bytearray)):
            return base64.b64encode(data).decode("utf-8")
        if hasattr(data, 'tobytes'):
            return base64.b64encode(data.tobytes()).decode("utf-8")

    return data


async def stream_close(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Close a stream (signals end to all subscribers).

    Args:
        streamId: Stream to close
        cleanup: If true, remove stream from registry after closing (default: false)

    Returns:
        { ok, streamId, totalChunks, subscriberCount }
    """
    stream_id = str(args.get("streamId") or "").strip()
    cleanup = bool(args.get("cleanup", False))

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}

    stream.closed = True
    stream.closed_at = time.time()
    stream.close_event.set()

    with stream.subscribers_lock:
        sub_count = len(stream.subscribers)

    # Clean up temp frame files for this stream
    _cleanup_stream_frames(stream_id)

    print(f"[streams] Closed stream '{stream_id}' (total_chunks={stream.total_chunks}, subscribers={sub_count})")

    if cleanup:
        _remove_stream(stream_id)

    if emit:
        await emit("stream_closed", {"streamId": stream_id, "totalChunks": stream.total_chunks})

    return {
        "ok": True,
        "streamId": stream_id,
        "totalChunks": stream.total_chunks,
        "subscriberCount": sub_count,
    }


async def stream_subscribe(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Subscribe to a stream (get a cursor).

    Args:
        streamId: Stream to subscribe to
        subscriberId: Unique subscriber ID (auto-generated if not provided)
        label: Human-readable label (e.g., step ID)
        fromStart: If true, start reading from the beginning (default: false = start from current position)

    Returns:
        { ok, streamId, subscriberId, cursor }
    """
    stream_id = str(args.get("streamId") or "").strip()
    subscriber_id = str(args.get("subscriberId") or "").strip() or f"sub_{uuid.uuid4().hex[:8]}"
    label = str(args.get("label") or "").strip()
    from_start = bool(args.get("fromStart", False))

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}

    with stream.buffer_lock:
        cursor = 0 if from_start else stream.buffer_index

    sub = StreamSubscriber(id=subscriber_id, cursor=cursor, label=label)

    with stream.subscribers_lock:
        stream.subscribers[subscriber_id] = sub

    print(f"[streams] Subscriber '{subscriber_id}' joined stream '{stream_id}' (cursor={cursor})")

    if emit:
        await emit("stream_subscribed", {"streamId": stream_id, "subscriberId": subscriber_id})

    return {
        "ok": True,
        "streamId": stream_id,
        "subscriberId": subscriber_id,
        "cursor": cursor,
    }


async def stream_unsubscribe(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Unsubscribe from a stream.

    Args:
        streamId: Stream to unsubscribe from
        subscriberId: Subscriber ID to remove

    Returns:
        { ok, streamId, subscriberId }
    """
    stream_id = str(args.get("streamId") or "").strip()
    subscriber_id = str(args.get("subscriberId") or "").strip()

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}
    if not subscriber_id:
        return {"ok": False, "error": "missing_subscriberId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}

    with stream.subscribers_lock:
        removed = stream.subscribers.pop(subscriber_id, None)

    if removed:
        print(f"[streams] Subscriber '{subscriber_id}' left stream '{stream_id}'")

    if emit:
        await emit("stream_unsubscribed", {"streamId": stream_id, "subscriberId": subscriber_id})

    return {
        "ok": True,
        "streamId": stream_id,
        "subscriberId": subscriber_id,
        "wasSubscribed": removed is not None,
    }


async def stream_add_transform(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Add a transform function to the stream pipeline.

    Args:
        streamId: Target stream
        transformId: Unique ID for this transform
        type: "python" | "builtin"
        code: Python source code defining a `transform(chunk, params)` function
        params: Parameters dict passed to the transform function
        order: Position in the chain (lower = earlier, default: 0)

    Returns:
        { ok, streamId, transformId }
    """
    stream_id = str(args.get("streamId") or "").strip()
    transform_id = str(args.get("transformId") or "").strip() or f"tf_{uuid.uuid4().hex[:8]}"
    tf_type = str(args.get("type") or "python").strip()
    code = str(args.get("code") or "").strip()
    params = args.get("params") or {}
    order = int(args.get("order") or 0)

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}

    transform = StreamTransform(
        id=transform_id,
        type=tf_type,
        code=code,
        params=dict(params) if isinstance(params, dict) else {},
        order=order,
    )

    # Pre-compile to validate
    if tf_type == "python" and code:
        fn = _compile_transform(transform)
        if fn is None:
            return {"ok": False, "error": "transform_compile_failed", "transformId": transform_id}

    with stream.transforms_lock:
        stream.transforms[transform_id] = transform

    print(f"[streams] Added transform '{transform_id}' to stream '{stream_id}' (order={order})")

    if emit:
        await emit("transform_added", {"streamId": stream_id, "transformId": transform_id})

    return {"ok": True, "streamId": stream_id, "transformId": transform_id}


async def stream_remove_transform(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Remove a transform from the stream pipeline.

    Args:
        streamId: Target stream
        transformId: Transform to remove

    Returns:
        { ok, streamId, transformId }
    """
    stream_id = str(args.get("streamId") or "").strip()
    transform_id = str(args.get("transformId") or "").strip()

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}
    if not transform_id:
        return {"ok": False, "error": "missing_transformId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}

    with stream.transforms_lock:
        removed = stream.transforms.pop(transform_id, None)

    if removed:
        print(f"[streams] Removed transform '{transform_id}' from stream '{stream_id}'")

    if emit:
        await emit("transform_removed", {"streamId": stream_id, "transformId": transform_id})

    return {
        "ok": True,
        "streamId": stream_id,
        "transformId": transform_id,
        "wasRemoved": removed is not None,
    }


async def stream_update_transform(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Update transform parameters live (applied to next chunk).

    Args:
        streamId: Target stream
        transformId: Transform to update
        params: New parameters dict (merged with existing)

    Returns:
        { ok, streamId, transformId }
    """
    stream_id = str(args.get("streamId") or "").strip()
    transform_id = str(args.get("transformId") or "").strip()
    params = args.get("params") or {}

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}
    if not transform_id:
        return {"ok": False, "error": "missing_transformId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}

    with stream.transforms_lock:
        transform = stream.transforms.get(transform_id)
        if not transform:
            return {"ok": False, "error": "transform_not_found"}
        if isinstance(params, dict):
            transform.params.update(params)

    print(f"[streams] Updated transform '{transform_id}' params on stream '{stream_id}'")

    if emit:
        await emit("transform_updated", {"streamId": stream_id, "transformId": transform_id})

    return {"ok": True, "streamId": stream_id, "transformId": transform_id}


async def stream_list(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    List active streams, optionally filtered by flowId.

    Args:
        flowId: Optional filter by workflow run ID

    Returns:
        { ok, streams: [...] }
    """
    flow_id = str(args.get("flowId") or "").strip()

    with _streams_lock:
        all_streams = list(_streams.values())

    result = []
    for s in all_streams:
        if flow_id and s.flow_id != flow_id:
            continue

        with s.subscribers_lock:
            sub_count = len(s.subscribers)
            sub_ids = list(s.subscribers.keys())

        with s.transforms_lock:
            tf_count = len(s.transforms)
            tf_ids = list(s.transforms.keys())

        result.append({
            "streamId": s.id,
            "kind": s.kind,
            "flowId": s.flow_id,
            "sourceStepId": s.source_step_id,
            "closed": s.closed,
            "totalChunks": s.total_chunks,
            "totalBytes": s.total_bytes,
            "subscriberCount": sub_count,
            "subscribers": sub_ids,
            "transformCount": tf_count,
            "transforms": tf_ids,
            "createdAt": s.created_at,
            "closedAt": s.closed_at,
            "metadata": s.metadata,
        })

    return {"ok": True, "streams": result, "count": len(result)}


async def stream_get_status(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Get detailed status of a stream.

    Args:
        streamId: Stream to query

    Returns:
        { ok, streamId, kind, closed, totalChunks, totalBytes, subscriberCount, ... }
    """
    stream_id = str(args.get("streamId") or "").strip()

    if not stream_id:
        return {"ok": False, "error": "missing_streamId"}

    stream = _get_stream(stream_id)
    if not stream:
        return {"ok": False, "error": "stream_not_found"}

    with stream.subscribers_lock:
        subscribers = []
        for sub in stream.subscribers.values():
            subscribers.append({
                "id": sub.id,
                "cursor": sub.cursor,
                "label": sub.label,
                "subscribedAt": sub.subscribed_at,
                "lag": max(0, stream.buffer_index - sub.cursor),
            })

    with stream.transforms_lock:
        transforms = []
        for tf in sorted(stream.transforms.values(), key=lambda t: t.order):
            transforms.append({
                "id": tf.id,
                "type": tf.type,
                "order": tf.order,
                "params": tf.params,
            })

    elapsed = time.time() - stream.created_at
    chunks_per_sec = stream.total_chunks / max(elapsed, 0.001)

    return {
        "ok": True,
        "streamId": stream.id,
        "kind": stream.kind,
        "flowId": stream.flow_id,
        "sourceStepId": stream.source_step_id,
        "closed": stream.closed,
        "totalChunks": stream.total_chunks,
        "totalBytes": stream.total_bytes,
        "bufferSize": stream.buffer.maxlen,
        "bufferUsed": len(stream.buffer),
        "chunksPerSec": round(chunks_per_sec, 2),
        "subscribers": subscribers,
        "transforms": transforms,
        "metadata": stream.metadata,
        "createdAt": stream.created_at,
        "closedAt": stream.closed_at,
        "errors": stream.errors[-10:],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Media Bus Bridge
# ─────────────────────────────────────────────────────────────────────────────

def push_to_stream(stream_id: str, chunk: Any, metadata: Optional[Dict[str, Any]] = None) -> bool:
    """
    Push a chunk directly into a stream (called from media bus workers).
    This is a synchronous function for use from capture threads.

    Args:
        stream_id: ID of the stream to push to.
        chunk: The data chunk (e.g. numpy array, bytes, dict).
        metadata: Optional metadata dict (e.g. {"volume": 42.5}) attached to the buffer entry.

    Returns True if the chunk was written, False if stream not found or closed.
    """
    stream = _get_stream(stream_id)
    if not stream or stream.closed:
        return False

    # Apply transforms synchronously
    transformed = _apply_transforms(stream, chunk)

    with stream.buffer_lock:
        stream.buffer.append((stream.buffer_index, transformed, time.time(), metadata))
        stream.buffer_index += 1
        stream.total_chunks += 1

    try:
        if isinstance(transformed, (bytes, bytearray)):
            stream.total_bytes += len(transformed)
        elif hasattr(transformed, 'nbytes'):
            stream.total_bytes += int(transformed.nbytes)
    except Exception:
        pass

    return True


def close_stream_sync(stream_id: str) -> None:
    """Close a stream synchronously (called from media bus cleanup)."""
    stream = _get_stream(stream_id)
    if stream and not stream.closed:
        stream.closed = True
        stream.closed_at = time.time()
        stream.close_event.set()
        print(f"[streams] Closed stream '{stream_id}' (sync, total_chunks={stream.total_chunks})")


# ─────────────────────────────────────────────────────────────────────────────
# Generic Stream Sources
# ─────────────────────────────────────────────────────────────────────────────

async def stream_from_script(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Run a Python script that emits chunks into a stream.
    The script receives a special `emit_chunk(data)` function it can call to push data.

    Args:
        code: Python source code. Use `emit_chunk(data)` to push chunks.
        kind: Stream data type (default: "json")
        flowId: Workflow run ID
        sourceStepId: Step ID
        packages: Optional list of pip packages to install first
        bufferSize: Ring buffer size (default: 500)
        metadata: Optional metadata dict

    Returns:
        { ok, streamId, status: "streaming" }
    """
    code = str(args.get("code") or "").strip()
    kind = str(args.get("kind") or "json").strip()
    flow_id = str(args.get("flowId") or "").strip()
    source_step_id = str(args.get("sourceStepId") or "script").strip()
    buffer_size = int(args.get("bufferSize") or 500)
    metadata = args.get("metadata") or {}

    if not code:
        return {"ok": False, "error": "missing_code"}

    # Create the stream
    create_result = await stream_create({
        "kind": kind,
        "flowId": flow_id,
        "sourceStepId": source_step_id,
        "bufferSize": buffer_size,
        "metadata": metadata,
    }, emit)

    stream_id = create_result.get("streamId", "")
    if not stream_id:
        return {"ok": False, "error": "failed_to_create_stream"}

    # Run script in background thread
    def _run_script():
        stream = _get_stream(stream_id)
        if not stream:
            return

        # Build the emit_chunk helper that the user script can call
        def emit_chunk(data: Any) -> None:
            if stream.closed:
                raise StopIteration("Stream closed")
            push_to_stream(stream_id, data)

        script_globals: Dict[str, Any] = {
            "__builtins__": __builtins__,
            "emit_chunk": emit_chunk,
            "stream_id": stream_id,
        }

        try:
            exec(code, script_globals)
        except StopIteration:
            pass
        except Exception as e:
            stream.errors.append(f"script_error: {e}")
            print(f"[streams] Script error on stream '{stream_id}': {e}")
        finally:
            # Close stream when script finishes
            if not stream.closed:
                stream.closed = True
                stream.closed_at = time.time()
                stream.close_event.set()
                print(f"[streams] Script stream '{stream_id}' closed (total_chunks={stream.total_chunks})")

    thread = threading.Thread(target=_run_script, daemon=True)
    thread.start()

    if emit:
        await emit("stream_script_started", {"streamId": stream_id})

    return {
        "ok": True,
        "streamId": stream_id,
        "kind": kind,
        "status": "streaming",
        "sourceStepId": source_step_id,
    }


async def stream_from_api(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Subscribe to an external streaming API (SSE, chunked HTTP, or line-delimited JSON)
    and push each event/chunk into a stream.

    Args:
        url: API endpoint URL
        method: "SSE" | "chunked_http" | "lines" (default: "lines")
        headers: Optional HTTP headers dict
        chunkType: How to parse chunks — "json" | "text" | "bytes" (default: "text")
        kind: Stream kind (default: "json" or "text")
        flowId: Workflow run ID
        sourceStepId: Step ID
        bufferSize: Ring buffer size
        metadata: Optional metadata dict
        timeoutSec: Connection timeout in seconds (default: 60)

    Returns:
        { ok, streamId, status: "streaming" }
    """
    url = str(args.get("url") or "").strip()
    method = str(args.get("method") or "lines").strip().lower()
    headers = args.get("headers") or {}
    chunk_type = str(args.get("chunkType") or "text").strip()
    kind = str(args.get("kind") or chunk_type).strip()
    flow_id = str(args.get("flowId") or "").strip()
    source_step_id = str(args.get("sourceStepId") or "api").strip()
    buffer_size = int(args.get("bufferSize") or 500)
    metadata = args.get("metadata") or {}
    timeout_sec = int(args.get("timeoutSec") or 60)

    if not url:
        return {"ok": False, "error": "missing_url"}

    # Create the stream
    create_result = await stream_create({
        "kind": kind,
        "flowId": flow_id,
        "sourceStepId": source_step_id,
        "bufferSize": buffer_size,
        "metadata": {**metadata, "url": url, "method": method},
    }, emit)

    stream_id = create_result.get("streamId", "")
    if not stream_id:
        return {"ok": False, "error": "failed_to_create_stream"}

    def _run_api():
        import json as _json
        stream = _get_stream(stream_id)
        if not stream:
            return

        try:
            import urllib.request
            req = urllib.request.Request(url, headers={k: v for k, v in headers.items()} if isinstance(headers, dict) else {})
            with urllib.request.urlopen(req, timeout=timeout_sec) as response:
                if method == "sse":
                    # Server-Sent Events: parse event: and data: lines
                    for raw_line in response:
                        if stream.closed:
                            break
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if line.startswith("data:"):
                            data_str = line[5:].strip()
                            if data_str == "[DONE]":
                                break
                            if chunk_type == "json":
                                try:
                                    push_to_stream(stream_id, _json.loads(data_str))
                                except _json.JSONDecodeError:
                                    push_to_stream(stream_id, data_str)
                            else:
                                push_to_stream(stream_id, data_str)
                else:
                    # Line-delimited or chunked HTTP
                    for raw_line in response:
                        if stream.closed:
                            break
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line:
                            continue
                        if chunk_type == "json":
                            try:
                                push_to_stream(stream_id, _json.loads(line))
                            except _json.JSONDecodeError:
                                push_to_stream(stream_id, line)
                        elif chunk_type == "bytes":
                            push_to_stream(stream_id, raw_line)
                        else:
                            push_to_stream(stream_id, line)
        except Exception as e:
            stream.errors.append(f"api_error: {e}")
            print(f"[streams] API stream error on '{stream_id}': {e}")
        finally:
            if not stream.closed:
                stream.closed = True
                stream.closed_at = time.time()
                stream.close_event.set()
                print(f"[streams] API stream '{stream_id}' closed (total_chunks={stream.total_chunks})")

    thread = threading.Thread(target=_run_api, daemon=True)
    thread.start()

    if emit:
        await emit("stream_api_started", {"streamId": stream_id, "url": url})

    return {
        "ok": True,
        "streamId": stream_id,
        "kind": kind,
        "status": "streaming",
        "url": url,
        "method": method,
    }


async def stream_from_llm(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Stream LLM text generation into a workflow stream.
    Each text token/chunk is pushed as it arrives.

    Args:
        prompt: The prompt to send to the LLM
        model: Model name (default: "gpt-4o-mini")
        systemPrompt: Optional system prompt
        temperature: Sampling temperature (default: 0.7)
        maxTokens: Max output tokens (default: 2048)
        flowId: Workflow run ID
        sourceStepId: Step ID
        bufferSize: Ring buffer size
        metadata: Optional metadata dict

    Returns:
        { ok, streamId, status: "streaming", model }
    """
    prompt = str(args.get("prompt") or "").strip()
    model = str(args.get("model") or "gpt-4o-mini").strip()
    system_prompt = str(args.get("systemPrompt") or "").strip()
    temperature = float(args.get("temperature") or 0.7)
    max_tokens = int(args.get("maxTokens") or 2048)
    flow_id = str(args.get("flowId") or "").strip()
    source_step_id = str(args.get("sourceStepId") or "llm").strip()
    buffer_size = int(args.get("bufferSize") or 500)
    metadata = args.get("metadata") or {}

    if not prompt:
        return {"ok": False, "error": "missing_prompt"}

    # Create the stream
    create_result = await stream_create({
        "kind": "text",
        "flowId": flow_id,
        "sourceStepId": source_step_id,
        "bufferSize": buffer_size,
        "metadata": {**metadata, "model": model, "prompt_preview": prompt[:100]},
    }, emit)

    stream_id = create_result.get("streamId", "")
    if not stream_id:
        return {"ok": False, "error": "failed_to_create_stream"}

    def _run_llm():
        import json as _json
        stream = _get_stream(stream_id)
        if not stream:
            return

        try:
            import os
            api_key = os.environ.get("OPENAI_API_KEY", "")
            if not api_key:
                stream.errors.append("missing OPENAI_API_KEY")
                return

            import urllib.request

            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})

            body = _json.dumps({
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": True,
            }).encode("utf-8")

            req = urllib.request.Request(
                "https://api.openai.com/v1/chat/completions",
                data=body,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )

            full_text = ""
            with urllib.request.urlopen(req, timeout=120) as response:
                for raw_line in response:
                    if stream.closed:
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk_obj = _json.loads(data_str)
                        delta = chunk_obj.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            full_text += content
                            push_to_stream(stream_id, content)
                    except _json.JSONDecodeError:
                        pass

            # Push final full text as metadata
            stream.metadata["full_text"] = full_text
        except Exception as e:
            stream.errors.append(f"llm_error: {e}")
            print(f"[streams] LLM stream error on '{stream_id}': {e}")
        finally:
            if not stream.closed:
                stream.closed = True
                stream.closed_at = time.time()
                stream.close_event.set()
                print(f"[streams] LLM stream '{stream_id}' closed (total_chunks={stream.total_chunks})")

    thread = threading.Thread(target=_run_llm, daemon=True)
    thread.start()

    if emit:
        await emit("stream_llm_started", {"streamId": stream_id, "model": model})

    return {
        "ok": True,
        "streamId": stream_id,
        "kind": "text",
        "status": "streaming",
        "model": model,
    }


def cleanup_flow_streams(flow_id: str) -> int:
    """Close and remove all streams for a workflow run. Returns count removed."""
    to_remove = []
    with _streams_lock:
        for sid, s in _streams.items():
            if s.flow_id == flow_id:
                to_remove.append(sid)

    for sid in to_remove:
        stream = _get_stream(sid)
        if stream and not stream.closed:
            stream.closed = True
            stream.closed_at = time.time()
            stream.close_event.set()
        _remove_stream(sid)

    if to_remove:
        print(f"[streams] Cleaned up {len(to_remove)} streams for flow '{flow_id}'")

    return len(to_remove)


async def close_all_streams(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """
    Close ALL active streams. Called when a workflow is stopped/aborted.
    Optionally filter by flowId.

    Args:
        flowId: Optional - only close streams for this workflow

    Returns:
        { ok, closed: int }
    """
    flow_id = str(args.get("flowId") or "").strip()

    with _streams_lock:
        if flow_id:
            to_close = [sid for sid, s in _streams.items() if s.flow_id == flow_id]
        else:
            to_close = list(_streams.keys())

    closed = 0
    for sid in to_close:
        stream = _get_stream(sid)
        if stream and not stream.closed:
            stream.closed = True
            stream.closed_at = time.time()
            stream.close_event.set()
            closed += 1
        _remove_stream(sid)

    if closed:
        scope = f"flow '{flow_id}'" if flow_id else "all"
        print(f"[streams] Closed {closed} stream(s) ({scope})")

    return {"ok": True, "closed": closed}
