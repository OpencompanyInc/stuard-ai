from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional

import numpy as np  # type: ignore

from ..connections import manager
from . import media_bus


SAMPLE_RATE = 16000
WINDOW_SIZE = 480
HOP_SIZE = 160
FFT_SIZE = 512
DURATION = 1.0
INPUT_LEN = int(SAMPLE_RATE * DURATION)


class NumPyDS_CNN:
    def __init__(self, weights_path: str):
        self.weights = np.load(weights_path)
        self.mel_matrix = self.weights["mel_matrix"]
        self.window = np.hanning(WINDOW_SIZE).astype(np.float32)

        self.layers = []

        def get_w(name: str):
            return self.weights[f"{name}_kernel"], self.weights[f"{name}_bias"]

        k, b = get_w("layer_0_Conv2D")
        self.layers.append(("conv", k, b, (2, 2)))

        k, b = get_w("layer_1_DepthwiseConv2D")
        self.layers.append(("dw_conv", k, b, (1, 1)))
        k, b = get_w("layer_2_Conv2D")
        self.layers.append(("conv", k, b, (1, 1)))

        k, b = get_w("layer_3_DepthwiseConv2D")
        self.layers.append(("dw_conv", k, b, (1, 1)))
        k, b = get_w("layer_4_Conv2D")
        self.layers.append(("conv", k, b, (1, 1)))

        k, b = get_w("layer_5_DepthwiseConv2D")
        self.layers.append(("dw_conv", k, b, (1, 1)))
        k, b = get_w("layer_6_Conv2D")
        self.layers.append(("conv", k, b, (1, 1)))

        k, b = get_w("layer_7_DepthwiseConv2D")
        self.layers.append(("dw_conv", k, b, (1, 1)))
        k, b = get_w("layer_8_Conv2D")
        self.layers.append(("conv", k, b, (1, 1)))

        k, b = get_w("dense")
        self.layers.append(("dense", k, b, None))

    def pad_same(self, x: np.ndarray, k_size: tuple[int, int], strides: tuple[int, int]):
        in_h, in_w = x.shape[1], x.shape[2]
        sh, sw = strides
        kh, kw = k_size

        if in_h % sh == 0:
            pad_h = max(kh - sh, 0)
        else:
            pad_h = max(kh - (in_h % sh), 0)

        if in_w % sw == 0:
            pad_w = max(kw - sw, 0)
        else:
            pad_w = max(kw - (in_w % sw), 0)

        pad_top = pad_h // 2
        pad_bottom = pad_h - pad_top
        pad_left = pad_w // 2
        pad_right = pad_w - pad_left

        return np.pad(x, ((0, 0), (pad_top, pad_bottom), (pad_left, pad_right), (0, 0)))

    def conv2d(self, x: np.ndarray, w: np.ndarray, b: np.ndarray, strides: tuple[int, int]):
        kh, kw, c_in, c_out = w.shape
        x_pad = self.pad_same(x, (kh, kw), strides)

        N, H, W, C = x_pad.shape
        sh, sw = strides

        out_h = (H - kh) // sh + 1
        out_w = (W - kw) // sw + 1

        strides_shape = (N, out_h, out_w, kh, kw, C)
        strides_numpy = (
            x_pad.strides[0],
            x_pad.strides[1] * sh,
            x_pad.strides[2] * sw,
            x_pad.strides[1],
            x_pad.strides[2],
            x_pad.strides[3],
        )

        windows = np.lib.stride_tricks.as_strided(x_pad, shape=strides_shape, strides=strides_numpy)
        windows_flat = windows.reshape(N, out_h, out_w, -1)
        w_flat = w.reshape(-1, c_out)
        return np.dot(windows_flat, w_flat) + b

    def depthwise_conv2d(self, x: np.ndarray, w: np.ndarray, b: np.ndarray, strides: tuple[int, int]):
        kh, kw, c_in, _ = w.shape
        w2 = w.squeeze(axis=-1)

        x_pad = self.pad_same(x, (kh, kw), strides)
        N, H, W, C = x_pad.shape
        sh, sw = strides

        out_h = (H - kh) // sh + 1
        out_w = (W - kw) // sw + 1

        strides_shape = (N, out_h, out_w, kh, kw, C)
        strides_numpy = (
            x_pad.strides[0],
            x_pad.strides[1] * sh,
            x_pad.strides[2] * sw,
            x_pad.strides[1],
            x_pad.strides[2],
            x_pad.strides[3],
        )

        windows = np.lib.stride_tricks.as_strided(x_pad, shape=strides_shape, strides=strides_numpy)
        return np.sum(windows * w2, axis=(3, 4)) + b

    def relu(self, x: np.ndarray):
        return np.maximum(0, x)

    def softmax(self, x: np.ndarray):
        e_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
        return e_x / np.sum(e_x, axis=-1, keepdims=True)

    def preprocess(self, audio: np.ndarray):
        if len(audio) > INPUT_LEN:
            audio = audio[:INPUT_LEN]
        else:
            audio = np.pad(audio, (0, INPUT_LEN - len(audio)))

        n_frames = (len(audio) - WINDOW_SIZE) // HOP_SIZE + 1
        frames = np.lib.stride_tricks.as_strided(
            audio,
            shape=(n_frames, WINDOW_SIZE),
            strides=(audio.strides[0] * HOP_SIZE, audio.strides[0]),
        )
        windowed = frames * self.window
        stft = np.abs(np.fft.rfft(windowed, n=FFT_SIZE))

        mel = np.dot(stft, self.mel_matrix)
        log_mel = np.log(mel + 1e-6)

        return log_mel.reshape(1, log_mel.shape[0], log_mel.shape[1], 1).astype(np.float32)

    def predict(self, audio: np.ndarray) -> float:
        x = self.preprocess(audio)

        for layer_type, w, b, strides in self.layers:
            if layer_type == "conv":
                x = self.conv2d(x, w, b, strides)
                x = self.relu(x)
            elif layer_type == "dw_conv":
                x = self.depthwise_conv2d(x, w, b, strides)
                x = self.relu(x)
            elif layer_type == "dense":
                x = np.mean(x, axis=(1, 2))
                x = np.dot(x, w) + b
                x = self.softmax(x)

        return float(x[0][1])


def _default_weights_path() -> str:
    # Canonical location (kept inside agent package for easier packaging)
    app_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    candidates = [
        os.path.join(app_dir, "data", "wakeword", "kws_weights.npz"),
        # Back-compat (older repo layout)
        os.path.abspath(os.path.join(app_dir, "..", "..", "..", "wakeword", "kws_weights.npz")),
        os.path.abspath(os.path.join(app_dir, "..", "..", "..", "wakeword", "models", "kws_weights.npz")),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return candidates[0]


def _to_mono(chunk: np.ndarray) -> np.ndarray:
    if chunk.ndim == 1:
        return chunk.astype(np.float32, copy=False)
    if chunk.ndim == 2:
        if chunk.shape[1] == 1:
            return chunk[:, 0].astype(np.float32, copy=False)
        return np.mean(chunk, axis=1).astype(np.float32, copy=False)
    return chunk.reshape(-1).astype(np.float32, copy=False)


def _resample_linear(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x.astype(np.float32, copy=False)
    n_in = int(x.shape[0])
    if n_in <= 1:
        return np.zeros(0, dtype=np.float32)
    n_out = int(round(n_in * (sr_out / float(sr_in))))
    if n_out <= 0:
        return np.zeros(0, dtype=np.float32)
    xp = np.arange(n_in, dtype=np.float32)
    fp = x.astype(np.float32, copy=False)
    x_new = np.linspace(0, n_in - 1, num=n_out, endpoint=False, dtype=np.float32)
    return np.interp(x_new, xp, fp).astype(np.float32, copy=False)


@dataclass
class _WakewordConfig:
    sensitivity: float
    cooldown_s: float
    device: Optional[int]
    weights_path: str
    trigger_count: int
    ema_alpha: float


class _WakewordService:
    def __init__(self, cfg: _WakewordConfig, loop: asyncio.AbstractEventLoop):
        self.cfg = cfg
        self.loop = loop
        self.stop_event = threading.Event()
        self.thread: Optional[threading.Thread] = None
        self.last_error: Optional[str] = None
        self.last_score: Optional[float] = None
        self.last_decision: Optional[float] = None
        self.last_detection_ts: Optional[float] = None
        self.last_infer_ms: Optional[float] = None
        self.subscriber_id = "wakeword"
        self._cursor = 0

        self._model = NumPyDS_CNN(cfg.weights_path)
        self._ring = np.zeros(INPUT_LEN, dtype=np.float32)
        self._consec = 0
        self._ema: Optional[float] = None

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)

    def update_config(self, cfg: _WakewordConfig) -> None:
        # Called from the async tool handler thread.
        # Keep it simple: swap config; reload model only if weights changed.
        old_weights = getattr(self.cfg, "weights_path", "")
        self.cfg = cfg
        if cfg.weights_path != old_weights:
            try:
                self._model = NumPyDS_CNN(cfg.weights_path)
            except Exception as e:
                self.last_error = f"model_reload_failed: {e}"

    def _broadcast(self, event: str, data: Dict[str, Any]) -> None:
        payload = json.dumps({"type": "progress", "event": event, "data": data})
        fut = asyncio.run_coroutine_threadsafe(manager.broadcast(payload), self.loop)
        try:
            fut.result(timeout=2.0)
        except Exception:
            pass

    def _run(self) -> None:
        last_trigger = 0.0
        while not self.stop_event.is_set():
            try:
                key = media_bus._bus_key("audio", self.cfg.device)  # type: ignore[attr-defined]
                with media_bus._buses_lock:  # type: ignore[attr-defined]
                    bus = media_bus._buses.get(key)  # type: ignore[attr-defined]

                if not bus:
                    time.sleep(0.1)
                    continue

                sr_in = int(getattr(bus, "samplerate", 44100) or 44100)

                try:
                    # Thread-safe snapshot if the bus exposes a buffer lock
                    lock = getattr(bus, "buffer_lock", None)
                    if lock:
                        with lock:
                            snap = list(bus.buffer)
                    else:
                        snap = list(bus.buffer)
                except Exception:
                    time.sleep(0.05)
                    continue

                new_cursor = self._cursor
                for idx, data, _ts in snap:
                    if idx < self._cursor:
                        continue
                    new_cursor = max(new_cursor, idx + 1)

                    mono = _to_mono(data)
                    res = _resample_linear(mono, sr_in=sr_in, sr_out=SAMPLE_RATE)
                    if res.size == 0:
                        continue

                    n = int(res.shape[0])
                    if n >= INPUT_LEN:
                        self._ring[:] = res[-INPUT_LEN:]
                    else:
                        # In-place shift (avoid allocations from np.roll).
                        self._ring[:-n] = self._ring[n:]
                        self._ring[-n:] = res

                self._cursor = new_cursor

                t0 = time.perf_counter()
                score = float(self._model.predict(self._ring))
                infer_ms = (time.perf_counter() - t0) * 1000.0
                self.last_score = score
                self.last_infer_ms = float(infer_ms)

                # EMA smoothing + debounce
                alpha = float(getattr(self.cfg, "ema_alpha", 0.0) or 0.0)
                if alpha > 0.0:
                    self._ema = score if self._ema is None else (alpha * score + (1.0 - alpha) * float(self._ema))
                    decision = float(self._ema)
                else:
                    decision = score
                self.last_decision = decision

                threshold = float(self.cfg.sensitivity)
                if decision >= threshold:
                    self._consec += 1
                else:
                    self._consec = 0

                now = time.time()
                trig_n = int(getattr(self.cfg, "trigger_count", 1) or 1)
                if (
                    self._consec >= max(1, trig_n)
                    and (now - last_trigger) >= float(self.cfg.cooldown_s)
                ):
                    last_trigger = now
                    self.last_detection_ts = now
                    self._consec = 0
                    self._broadcast(
                        "wakeword_detected",
                        {
                            "score": float(score),
                            "decision": float(decision),
                            "ema": float(self._ema) if self._ema is not None else None,
                            "threshold": float(threshold),
                            "triggerCount": int(trig_n),
                            "timestamp": now,
                            "cooldown": float(self.cfg.cooldown_s),
                            "inferMs": float(infer_ms),
                        },
                    )

                time.sleep(0.05)
            except Exception as e:
                self.last_error = str(e)
                time.sleep(0.2)


_service: Optional[_WakewordService] = None
_service_lock = asyncio.Lock()


async def wakeword_start(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    global _service

    sensitivity = float(args.get("sensitivity", 0.7))
    cooldown_s = float(args.get("cooldown", 1.0))
    device = args.get("device")
    device_idx: Optional[int] = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())

    # Ignore invalid model paths; default to packaged weights.
    weights_arg = str(args.get("weightsPath") or args.get("weights_path") or "").strip()
    weights_path = weights_arg if weights_arg and os.path.exists(weights_arg) else _default_weights_path()
    if not os.path.exists(weights_path):
        return {
            "ok": False,
            "error": "weights_not_found",
            "weightsPath": weights_path,
            "hint": "Expected wakeword weights at apps/agent/app/data/wakeword/kws_weights.npz (or pass a valid weightsPath).",
        }

    trigger_count = int(args.get("triggerCount") or args.get("trigger_count") or 4)
    if trigger_count < 1:
        trigger_count = 1
    ema_alpha = float(args.get("emaAlpha") or args.get("ema_alpha") or 0.2)
    if ema_alpha < 0.0:
        ema_alpha = 0.0

    async with _service_lock:
        if _service and _service.thread and _service.thread.is_alive():
            _service.update_config(
                _WakewordConfig(
                sensitivity=sensitivity,
                cooldown_s=cooldown_s,
                device=device_idx,
                weights_path=weights_path,
                trigger_count=trigger_count,
                ema_alpha=ema_alpha,
                )
            )
            if emit:
                await emit("progress", {"event": "wakeword_running"})
            return {"ok": True, "running": True, "alreadyRunning": True}

        sub = await media_bus.subscribe_media_bus(
            {"kind": "audio", "device": device_idx, "subscriberId": "wakeword"},
            emit=None,
        )
        if not isinstance(sub, dict) or not sub.get("ok"):
            return {"ok": False, "error": "bus_subscribe_failed", "details": sub}

        loop = asyncio.get_running_loop()
        _service = _WakewordService(
            _WakewordConfig(
                sensitivity=sensitivity,
                cooldown_s=cooldown_s,
                device=device_idx,
                weights_path=weights_path,
                trigger_count=trigger_count,
                ema_alpha=ema_alpha,
            ),
            loop,
        )
        _service.start()

    if emit:
        await emit("progress", {"event": "wakeword_started"})

    return {
        "ok": True,
        "running": True,
        "subscriberId": "wakeword",
        "device": device_idx,
        "weightsPath": weights_path,
        "sensitivity": sensitivity,
        "cooldown": cooldown_s,
        "triggerCount": trigger_count,
        "emaAlpha": ema_alpha,
        "bus": sub,
    }


async def wakeword_stop(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    global _service

    device = args.get("device")
    device_idx: Optional[int] = None
    if device is not None:
        if isinstance(device, int):
            device_idx = device
        elif isinstance(device, str) and device.strip().isdigit():
            device_idx = int(device.strip())

    async with _service_lock:
        svc = _service
        _service = None

    if svc:
        try:
            svc.stop()
        except Exception:
            pass

        try:
            await media_bus.unsubscribe_media_bus(
                {"kind": "audio", "device": svc.cfg.device, "subscriberId": svc.subscriber_id, "saveRecording": False},
                emit=None,
            )
        except Exception:
            pass

    if emit:
        await emit("progress", {"event": "wakeword_stopped"})

    return {"ok": True, "running": False}


async def wakeword_status(args: Dict[str, Any]) -> Dict[str, Any]:
    svc = _service
    if not svc:
        return {"ok": True, "running": False}

    running = bool(svc.thread and svc.thread.is_alive() and not svc.stop_event.is_set())
    return {
        "ok": True,
        "running": running,
        "device": svc.cfg.device,
        "weightsPath": svc.cfg.weights_path,
        "sensitivity": svc.cfg.sensitivity,
        "cooldown": svc.cfg.cooldown_s,
        "triggerCount": svc.cfg.trigger_count,
        "emaAlpha": svc.cfg.ema_alpha,
        "lastScore": svc.last_score,
        "lastDecision": svc.last_decision,
        "lastDetectionTs": svc.last_detection_ts,
        "lastInferMs": svc.last_infer_ms,
        "lastError": svc.last_error,
    }
