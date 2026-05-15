"""
Ultra-Lightweight Pure NumPy Inference for "Hey Stuard" wake word.

Requires ONLY numpy and sounddevice. No TensorFlow, PyTorch, or ONNX.
Memory usage: ~30-50MB. Inference: ~1-3ms per frame on modern CPU.

Pipeline mirrors the standalone wakeword/ checkout:
    audio -> log-mel spectrogram -> DS-CNN -> EMA smoothing ->
    RMS gate -> consecutive-frame thresholding -> trigger.

Usage:
    python listen_numpy.py --weights models/kws_weights.npz --sensitivity 0.8
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import sounddevice as sd

# ── Audio / spectrogram constants (must match training pipeline) ───────
SAMPLE_RATE = 16000
WINDOW_DURATION = 1.5
INPUT_LEN = int(SAMPLE_RATE * WINDOW_DURATION)  # 24000

FRAME_LENGTH = 480   # 30ms
HOP_SIZE = 160       # 10ms
FFT_SIZE = 512

# ── Detection defaults (tuned with general model) ─────────────────────
DEFAULT_THRESHOLD = 0.80
DEFAULT_EMA_ALPHA = 0.25
DEFAULT_TRIGGER_COUNT = 8
DEFAULT_COOLDOWN = 1.5
DEFAULT_MIN_RMS = 0.003
INFERENCE_INTERVAL = 0.02  # 20ms between inferences


def _configure_stdout() -> None:
    """Make output show up immediately in Windows terminals."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass


def list_input_devices() -> None:
    """Print available audio devices and exit."""
    _configure_stdout()
    devices = sd.query_devices()
    hostapis = sd.query_hostapis()

    print("Audio devices (input-capable):", flush=True)
    for i, d in enumerate(devices):
        if int(d.get("max_input_channels", 0)) <= 0:
            continue
        try:
            hostapi_name = hostapis[int(d.get("hostapi", 0))]["name"]
        except Exception:
            hostapi_name = "unknown"
        print(
            f"- {i}: {d.get('name')} | hostapi={hostapi_name} | "
            f"max_in={d.get('max_input_channels')} | default_sr={d.get('default_samplerate')}",
            flush=True,
        )


def _build_centered_hann_window() -> np.ndarray:
    """Periodic hann centered in FFT_SIZE (matches torch.stft padded layout)."""
    n = np.arange(FRAME_LENGTH, dtype=np.float32)
    hann = 0.5 * (1.0 - np.cos(2.0 * np.pi * n / FRAME_LENGTH))
    pad_left = (FFT_SIZE - FRAME_LENGTH) // 2
    window = np.zeros(FFT_SIZE, dtype=np.float32)
    window[pad_left: pad_left + FRAME_LENGTH] = hann
    return window


def _log_mel(audio: np.ndarray, mel_matrix: np.ndarray, window: np.ndarray) -> np.ndarray:
    """Audio -> (n_frames, n_mels) log-mel spectrogram."""
    if len(audio) > INPUT_LEN:
        audio = audio[:INPUT_LEN]
    elif len(audio) < INPUT_LEN:
        audio = np.pad(audio, (0, INPUT_LEN - len(audio)))

    audio = audio.astype(np.float32, copy=False)

    n_frames = (len(audio) - FFT_SIZE) // HOP_SIZE + 1
    frames = np.lib.stride_tricks.as_strided(
        audio,
        shape=(n_frames, FFT_SIZE),
        strides=(audio.strides[0] * HOP_SIZE, audio.strides[0]),
    )
    windowed = frames * window
    stft = np.abs(np.fft.rfft(windowed, n=FFT_SIZE))

    mel = np.dot(stft, mel_matrix)
    return np.log(mel + 1e-6).astype(np.float32)


class NumPyDSCNN:
    """Pure NumPy DS-CNN forward pass (mirrors wakeword/inference/engine.py)."""

    def __init__(self, weights_path: str):
        data = np.load(weights_path)
        self.mel_matrix = data["mel_matrix"]
        self.window = _build_centered_hann_window()

        def get_w(name: str):
            return data[f"{name}_kernel"], data[f"{name}_bias"]

        # (type, kernel, bias, stride)
        self.layers: list[tuple] = []

        # Initial Conv2D
        k, b = get_w("layer_0_Conv2D")
        self.layers.append(("conv", k, b, (2, 2)))

        # 4 × (depthwise + pointwise) DS-CNN blocks
        for block_idx in range(4):
            dw_idx = 1 + block_idx * 2
            pw_idx = 2 + block_idx * 2
            k, b = get_w(f"layer_{dw_idx}_DepthwiseConv2D")
            self.layers.append(("dw_conv", k, b, (1, 1)))
            k, b = get_w(f"layer_{pw_idx}_Conv2D")
            self.layers.append(("conv", k, b, (1, 1)))

        # Dense head
        k, b = get_w("dense")
        self.layers.append(("dense", k, b, None))

    @staticmethod
    def _pad_same(x: np.ndarray, k_size: tuple[int, int], strides: tuple[int, int]) -> np.ndarray:
        in_h, in_w = x.shape[1], x.shape[2]
        sh, sw = strides
        kh, kw = k_size
        pad_h = max(kh - sh, 0) if in_h % sh == 0 else max(kh - (in_h % sh), 0)
        pad_w = max(kw - sw, 0) if in_w % sw == 0 else max(kw - (in_w % sw), 0)
        pt, pb = pad_h // 2, pad_h - pad_h // 2
        pl, pr = pad_w // 2, pad_w - pad_w // 2
        if pt or pb or pl or pr:
            return np.pad(x, ((0, 0), (pt, pb), (pl, pr), (0, 0)))
        return x

    @staticmethod
    def _conv2d(x: np.ndarray, w: np.ndarray, b: np.ndarray, strides: tuple[int, int]) -> np.ndarray:
        kh, kw, _, c_out = w.shape
        x = NumPyDSCNN._pad_same(x, (kh, kw), strides)
        N, H, W, C = x.shape
        sh, sw = strides
        out_h = (H - kh) // sh + 1
        out_w = (W - kw) // sw + 1
        windows = np.lib.stride_tricks.as_strided(
            x,
            shape=(N, out_h, out_w, kh, kw, C),
            strides=(
                x.strides[0], x.strides[1] * sh, x.strides[2] * sw,
                x.strides[1], x.strides[2], x.strides[3],
            ),
        )
        return np.dot(windows.reshape(N, out_h, out_w, -1), w.reshape(-1, c_out)) + b

    @staticmethod
    def _depthwise_conv2d(x: np.ndarray, w: np.ndarray, b: np.ndarray, strides: tuple[int, int]) -> np.ndarray:
        kh, kw, _, _ = w.shape
        w = w.squeeze(axis=-1)  # (Kh, Kw, C)
        x = NumPyDSCNN._pad_same(x, (kh, kw), strides)
        N, H, W, C = x.shape
        sh, sw = strides
        out_h = (H - kh) // sh + 1
        out_w = (W - kw) // sw + 1
        windows = np.lib.stride_tricks.as_strided(
            x,
            shape=(N, out_h, out_w, kh, kw, C),
            strides=(
                x.strides[0], x.strides[1] * sh, x.strides[2] * sw,
                x.strides[1], x.strides[2], x.strides[3],
            ),
        )
        return np.sum(windows * w, axis=(3, 4)) + b

    def predict(self, audio: np.ndarray) -> float:
        spec = _log_mel(audio, self.mel_matrix, self.window)
        x = spec.reshape(1, spec.shape[0], spec.shape[1], 1).astype(np.float32)

        for layer_type, w, b, strides in self.layers:
            if layer_type == "conv":
                x = np.maximum(0.0, self._conv2d(x, w, b, strides))
            elif layer_type == "dw_conv":
                x = np.maximum(0.0, self._depthwise_conv2d(x, w, b, strides))
            elif layer_type == "dense":
                x = np.mean(x, axis=(1, 2))  # global average pool
                x = np.dot(x, w) + b
                e = np.exp(x - np.max(x, axis=-1, keepdims=True))
                x = e / np.sum(e, axis=-1, keepdims=True)

        return float(x[0, 1])  # class 1 = wake word


def _write_wav(path: Path, audio: np.ndarray, sr: int = SAMPLE_RATE) -> None:
    """Minimal int16 PCM WAV writer (no scipy dependency)."""
    import wave
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(pcm.tobytes())


class WakeWordDetector:
    """
    Streaming wake word detection.

    Pipeline: rolling 1.5s buffer -> log-mel -> DS-CNN -> EMA smoothing ->
    RMS gate (silence suppression) -> consecutive-frame thresholding.
    """

    def __init__(
        self,
        weights_path: str,
        threshold: float = DEFAULT_THRESHOLD,
        ema_alpha: float = DEFAULT_EMA_ALPHA,
        trigger_count: int = DEFAULT_TRIGGER_COUNT,
        cooldown: float = DEFAULT_COOLDOWN,
        min_rms: float = DEFAULT_MIN_RMS,
        on_detect: Optional[Callable[[float, float], None]] = None,
        device: Optional[int] = None,
        show_status: bool = True,
        status_every: float = 0.5,
        capture_dir: Optional[Path] = None,
    ):
        self.engine = NumPyDSCNN(weights_path)
        self.threshold = float(threshold)
        self.ema_alpha = float(ema_alpha)
        self.trigger_count = int(trigger_count)
        self.cooldown = float(cooldown)
        self.min_rms = float(min_rms)
        self.on_detect = on_detect
        self.device = device
        self.show_status = show_status
        self.status_every = float(status_every)
        self.capture_dir = Path(capture_dir) if capture_dir is not None else None
        if self.capture_dir is not None:
            self.capture_dir.mkdir(parents=True, exist_ok=True)

        self._buffer = np.zeros(INPUT_LEN, dtype=np.float32)
        self._buffer_lock = threading.Lock()
        self._running = False

    def _audio_callback(self, indata, frames, time_info, status):
        if status:
            print(f"\n[Audio status] {status}", flush=True)

        new_data = indata[:, 0].astype(np.float32, copy=False)
        n = new_data.shape[0]
        if n <= 0:
            return

        with self._buffer_lock:
            if n >= self._buffer.shape[0]:
                self._buffer[:] = new_data[-self._buffer.shape[0]:]
            else:
                self._buffer[:-n] = self._buffer[n:]
                self._buffer[-n:] = new_data

    def start(self, duration: Optional[float] = None) -> None:
        """Block-listen until stopped or `duration` seconds elapsed."""
        self._running = True

        stream_kwargs = dict(
            samplerate=SAMPLE_RATE,
            blocksize=HOP_SIZE * 4,  # ~40ms callback
            channels=1,
            dtype="float32",
            callback=self._audio_callback,
        )
        if self.device is not None:
            stream_kwargs["device"] = self.device

        last_trigger = 0.0
        last_status = 0.0
        consec = 0
        ema: Optional[float] = None
        start_time = time.time()

        try:
            with sd.InputStream(**stream_kwargs):
                while self._running:
                    now = time.time()
                    if duration is not None and (now - start_time) >= float(duration):
                        print("\nDone.", flush=True)
                        break

                    with self._buffer_lock:
                        current = self._buffer.copy()

                    rms = float(np.sqrt(np.mean(current * current) + 1e-12))
                    t0 = time.perf_counter()
                    score = self.engine.predict(current)
                    infer_ms = (time.perf_counter() - t0) * 1000.0

                    if rms < self.min_rms:
                        ema = None
                        decision = 0.0
                    elif self.ema_alpha > 0.0:
                        ema = score if ema is None else (self.ema_alpha * score + (1.0 - self.ema_alpha) * float(ema))
                        decision = float(ema)
                    else:
                        decision = score

                    if decision > self.threshold:
                        consec += 1
                    else:
                        consec = 0

                    if consec >= self.trigger_count and (now - last_trigger) > self.cooldown:
                        capture_path: Optional[Path] = None
                        if self.capture_dir is not None:
                            stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
                            capture_path = self.capture_dir / f"trigger_{stamp}_s{score:.3f}.wav"
                            try:
                                _write_wav(capture_path, current, sr=SAMPLE_RATE)
                            except Exception as exc:
                                print(f"\n[capture] failed: {exc}", flush=True)
                                capture_path = None

                        msg = (
                            f"\nWAKE WORD DETECTED  score={score:.3f}  decision={decision:.3f}  "
                            f"threshold={self.threshold:.3f}  consec={consec}  infer={infer_ms:.1f}ms"
                        )
                        if capture_path is not None:
                            msg += f"  captured={capture_path}"
                        print(msg, flush=True)

                        last_trigger = now
                        consec = 0
                        if self.on_detect:
                            try:
                                self.on_detect(score, now)
                            except Exception as exc:
                                print(f"\n[on_detect] failed: {exc}", flush=True)

                    if self.show_status and (now - last_status) >= self.status_every:
                        print(
                            f"\rscore={score:.3f}  decision={decision:.3f}  "
                            f"threshold={self.threshold:.3f}  consec={consec}  "
                            f"rms={rms:.4f}  infer={infer_ms:.1f}ms     ",
                            end="",
                            flush=True,
                        )
                        last_status = now

                    time.sleep(INFERENCE_INTERVAL)
        except KeyboardInterrupt:
            print("\nStopping...", flush=True)
        finally:
            self._running = False
            print(flush=True)

    def stop(self) -> None:
        self._running = False


def listen(
    weights_path,
    sensitivity: float = DEFAULT_THRESHOLD,
    cooldown: float = DEFAULT_COOLDOWN,
    device: Optional[int] = None,
    show_status: bool = True,
    status_every: float = 0.5,
    seconds: Optional[float] = None,
    trigger_count: int = DEFAULT_TRIGGER_COUNT,
    ema_alpha: float = DEFAULT_EMA_ALPHA,
    min_rms: float = DEFAULT_MIN_RMS,
    capture_dir: Optional[str] = None,
):
    """Backward-compatible entry point used by listen.py and standalone CLI."""
    _configure_stdout()
    if not os.path.exists(weights_path):
        print(f"Error: Weights not found at {weights_path}", flush=True)
        return

    print("", flush=True)
    print(f"Listening... (Threshold: {sensitivity})", flush=True)
    print("Using Pure NumPy (Ultra-Lightweight)", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if device is not None:
        print(f"Input device: {device}", flush=True)

    detector = WakeWordDetector(
        weights_path=str(weights_path),
        threshold=float(sensitivity),
        ema_alpha=float(ema_alpha),
        trigger_count=int(trigger_count),
        cooldown=float(cooldown),
        min_rms=float(min_rms),
        device=device,
        show_status=show_status,
        status_every=status_every,
        capture_dir=Path(capture_dir) if capture_dir else None,
    )
    detector.start(duration=seconds)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", default="models/kws_weights.npz")
    parser.add_argument("--sensitivity", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--cooldown", type=float, default=DEFAULT_COOLDOWN)
    parser.add_argument("--device", type=int, default=None, help="Input device index (see --list-devices)")
    parser.add_argument("--list-devices", action="store_true", help="List input devices and exit")
    parser.add_argument("--seconds", type=float, default=None, help="Stop automatically after N seconds")
    parser.add_argument("--no-status", action="store_true", help="Disable live score/status line")
    parser.add_argument("--status-every", type=float, default=0.5, help="Seconds between status updates")
    parser.add_argument("--trigger-count", type=int, default=DEFAULT_TRIGGER_COUNT, help="Require N consecutive frames above threshold")
    parser.add_argument("--ema-alpha", type=float, default=DEFAULT_EMA_ALPHA, help="EMA smoothing alpha for decision score (0 disables)")
    parser.add_argument("--min-rms", type=float, default=DEFAULT_MIN_RMS, help="Ignore windows below this RMS level")
    parser.add_argument("--capture-dir", default=None, help="If set, save the 1.5s buffer to this dir on each trigger")
    args = parser.parse_args()

    if args.list_devices:
        list_input_devices()
        raise SystemExit(0)

    listen(
        args.weights,
        sensitivity=args.sensitivity,
        cooldown=args.cooldown,
        device=args.device,
        show_status=(not args.no_status),
        status_every=args.status_every,
        seconds=args.seconds,
        trigger_count=args.trigger_count,
        ema_alpha=args.ema_alpha,
        min_rms=args.min_rms,
        capture_dir=args.capture_dir,
    )
