"""
Ultra-Lightweight Pure NumPy Inference.
Requires ONLY numpy and sounddevice.
No TensorFlow, No PyTorch, No ONNX.
Memory usage: ~30-50MB.

Usage:
    python listen_numpy.py
    python listen_numpy.py --list-devices
    python listen_numpy.py --weights apps/desktop/resources/wakeword/models/kws_weights.npz --sensitivity 0.88
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import sounddevice as sd

# Audio Config
SAMPLE_RATE = 16000
WINDOW_SIZE = 480  # 30ms
HOP_SIZE = 160  # 10ms
FFT_SIZE = 512
WINDOW_DURATION = 1.5
INPUT_LEN = int(SAMPLE_RATE * WINDOW_DURATION)
DEFAULT_THRESHOLD = 0.88
DEFAULT_EMA_ALPHA = 0.25
DEFAULT_TRIGGER_COUNT = 8
DEFAULT_COOLDOWN = 1.5
DEFAULT_MIN_RMS = 0.003
ACTIVITY_RMS_WINDOW = 0.20
INFERENCE_INTERVAL = 0.02


def _configure_stdout() -> None:
    # Make output show up immediately in Windows terminals.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass


def _default_weights_path() -> str:
    # Default to the desktop wakeword resources (works when running from repo root).
    here = os.path.abspath(os.path.dirname(__file__))
    return os.path.join(here, "apps", "desktop", "resources", "wakeword", "models", "kws_weights.npz")


def _build_centered_hann_window() -> np.ndarray:
    """Periodic hann centered in FFT_SIZE (matches torch.stft padded layout)."""
    n = np.arange(WINDOW_SIZE, dtype=np.float32)
    hann = 0.5 * (1.0 - np.cos(2.0 * np.pi * n / WINDOW_SIZE))
    pad_left = (FFT_SIZE - WINDOW_SIZE) // 2
    window = np.zeros(FFT_SIZE, dtype=np.float32)
    window[pad_left: pad_left + WINDOW_SIZE] = hann
    return window


def _rms(audio: np.ndarray) -> float:
    """Return RMS amplitude for a mono float buffer."""
    return float(np.sqrt(np.mean(np.asarray(audio, dtype=np.float32) ** 2) + 1e-12))


def _peak_window_rms(audio: np.ndarray, window_samples: int) -> float:
    """Return the loudest short-window RMS inside the model buffer."""
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    if audio.size == 0:
        return 0.0

    window_samples = max(1, min(int(window_samples), audio.size))
    if window_samples == audio.size:
        return _rms(audio)

    power = audio * audio
    cumsum = np.concatenate(([0.0], np.cumsum(power, dtype=np.float64)))
    window_power = cumsum[window_samples:] - cumsum[:-window_samples]
    return float(np.sqrt(np.max(window_power) / window_samples + 1e-12))


def list_input_devices() -> None:
    """Print available audio devices and exit."""
    _configure_stdout()
    devices = sd.query_devices()
    hostapis = sd.query_hostapis()

    print("Audio devices (input-capable):", flush=True)
    for i, d in enumerate(devices):
        if int(d.get("max_input_channels", 0)) <= 0:
            continue
        hostapi_name = "unknown"
        try:
            hostapi_name = hostapis[int(d.get("hostapi", 0))]["name"]
        except Exception:
            pass
        print(
            f"- {i}: {d.get('name')} | hostapi={hostapi_name} | "
            f"max_in={d.get('max_input_channels')} | default_sr={d.get('default_samplerate')}",
            flush=True,
        )


class NumPyDS_CNN:
    def __init__(self, weights_path: str):
        print(f"Loading weights from {weights_path}", flush=True)
        self.weights = np.load(weights_path)
        self.mel_matrix = self.weights["mel_matrix"]
        self.window = _build_centered_hann_window()

        # Hardcoded architecture matching DS-CNN export.
        self.layers = []

        def get_w(name: str):
            return self.weights[f"{name}_kernel"], self.weights[f"{name}_bias"]

        # 1. Initial Conv
        k, b = get_w("layer_0_Conv2D")
        self.layers.append(("conv", k, b, (2, 2)))  # stride 2,2

        # 2. DS-CNN Blocks (x4)
        for dw_name, pw_name in [
            ("layer_1_DepthwiseConv2D", "layer_2_Conv2D"),
            ("layer_3_DepthwiseConv2D", "layer_4_Conv2D"),
            ("layer_5_DepthwiseConv2D", "layer_6_Conv2D"),
            ("layer_7_DepthwiseConv2D", "layer_8_Conv2D"),
        ]:
            k, b = get_w(dw_name)
            self.layers.append(("dw_conv", k, b, (1, 1)))
            k, b = get_w(pw_name)
            self.layers.append(("conv", k, b, (1, 1)))

        # Dense
        k, b = get_w("dense")
        self.layers.append(("dense", k, b, None))

    def pad_same(self, x: np.ndarray, k_size: tuple[int, int], strides: tuple[int, int]) -> np.ndarray:
        # TF 'SAME' padding
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

    def conv2d(self, x: np.ndarray, w: np.ndarray, b: np.ndarray, strides: tuple[int, int]) -> np.ndarray:
        # x: (N, H, W, C_in), w: (Kh, Kw, C_in, C_out)
        kh, kw, _c_in, c_out = w.shape
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

    def depthwise_conv2d(self, x: np.ndarray, w: np.ndarray, b: np.ndarray, strides: tuple[int, int]) -> np.ndarray:
        # w: (Kh, Kw, C_in, 1)
        kh, kw, _c_in, _ = w.shape
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

    @staticmethod
    def relu(x: np.ndarray) -> np.ndarray:
        return np.maximum(0, x)

    @staticmethod
    def softmax(x: np.ndarray) -> np.ndarray:
        e_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
        return e_x / np.sum(e_x, axis=-1, keepdims=True)

    def preprocess(self, audio: np.ndarray) -> np.ndarray:
        if len(audio) > INPUT_LEN:
            audio = audio[:INPUT_LEN]
        else:
            audio = np.pad(audio, (0, INPUT_LEN - len(audio)))

        n_frames = (len(audio) - FFT_SIZE) // HOP_SIZE + 1
        frames = np.lib.stride_tricks.as_strided(
            audio,
            shape=(n_frames, FFT_SIZE),
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
                x = np.mean(x, axis=(1, 2))  # global average pool
                x = np.dot(x, w) + b
                x = self.softmax(x)

        return float(x[0][1])


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


def listen(
    weights_path: str,
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
) -> None:
    _configure_stdout()
    if not os.path.exists(weights_path):
        print(f"Error: Weights not found at {weights_path}", flush=True)
        print("Hint: run with --weights apps/desktop/resources/wakeword/models/kws_weights.npz", flush=True)
        return

    model = NumPyDS_CNN(weights_path)
    buffer = np.zeros(INPUT_LEN, dtype=np.float32)
    buffer_lock = threading.Lock()

    print("", flush=True)
    print(f"Listening... (Threshold: {sensitivity})", flush=True)
    print("Using Pure NumPy (Ultra-Lightweight)", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if device is not None:
        print(f"Input device: {device}", flush=True)

    last_trigger = 0.0
    start_time = time.time()
    last_status = 0.0
    consec = 0
    ema: Optional[float] = None
    activity_window_samples = int(round(ACTIVITY_RMS_WINDOW * SAMPLE_RATE))
    capture_path_base = Path(capture_dir) if capture_dir else None
    if capture_path_base is not None:
        capture_path_base.mkdir(parents=True, exist_ok=True)

    def callback(indata, frames, time_info, status):  # noqa: ANN001
        nonlocal buffer
        if status:
            print(f"\n[Audio status] {status}", flush=True)

        new_data = indata[:, 0].astype(np.float32, copy=False)  # mono
        n = int(new_data.shape[0])
        if n <= 0:
            return

        with buffer_lock:
            if n >= buffer.shape[0]:
                buffer[:] = new_data[-buffer.shape[0] :]
            else:
                buffer[:-n] = buffer[n:]
                buffer[-n:] = new_data

    stream_kwargs = dict(
        samplerate=SAMPLE_RATE,
        blocksize=HOP_SIZE * 4,  # ~40ms callback
        channels=1,
        dtype="float32",
        callback=callback,
    )
    if device is not None:
        stream_kwargs["device"] = device

    try:
        with sd.InputStream(**stream_kwargs):
            while True:
                now = time.time()
                if seconds is not None and (now - start_time) >= float(seconds):
                    print("\nDone.", flush=True)
                    break

                with buffer_lock:
                    current = buffer.copy()

                t0 = time.perf_counter()
                score = float(model.predict(current))
                dur_ms = (time.perf_counter() - t0) * 1000.0
                rms = _rms(current)
                activity_rms = _peak_window_rms(current, activity_window_samples)

                if activity_rms < min_rms:
                    ema = None
                    decision = 0.0
                elif ema_alpha and ema_alpha > 0.0:
                    if ema is None or score >= ema:
                        ema = score
                    else:
                        ema = ema_alpha * score + (1.0 - ema_alpha) * float(ema)
                    decision = float(ema)
                else:
                    decision = score

                if decision > sensitivity:
                    consec += 1
                else:
                    consec = 0

                if consec >= int(trigger_count) and (now - last_trigger) > cooldown:
                    capture_path: Optional[Path] = None
                    if capture_path_base is not None:
                        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
                        capture_path = capture_path_base / f"trigger_{stamp}_s{score:.3f}.wav"
                        try:
                            _write_wav(capture_path, current, sr=SAMPLE_RATE)
                        except Exception as exc:
                            print(f"\n[capture] failed: {exc}", flush=True)
                            capture_path = None

                    msg = (
                        f"\nWAKE WORD DETECTED  score={score:.3f}  decision={decision:.3f}  "
                        f"threshold={sensitivity:.3f}  consec={consec}  infer={dur_ms:.1f}ms"
                    )
                    if capture_path is not None:
                        msg += f"  captured={capture_path}"
                    print(msg, flush=True)
                    last_trigger = now
                    consec = 0

                if show_status and (now - last_status) >= float(status_every):
                    print(
                        f"\rscore={score:.3f}  decision={decision:.3f}  threshold={sensitivity:.3f}  "
                        f"consec={consec}  rms={rms:.4f}  activity={activity_rms:.4f}  infer={dur_ms:.1f}ms     ",
                        end="",
                        flush=True,
                    )
                    last_status = now

                time.sleep(INFERENCE_INTERVAL)
    except KeyboardInterrupt:
        print("\nStopping...", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", default=_default_weights_path())
    parser.add_argument("--sensitivity", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--cooldown", type=float, default=DEFAULT_COOLDOWN)
    parser.add_argument("--device", type=int, default=None, help="Input device index (see --list-devices)")
    parser.add_argument("--list-devices", action="store_true", help="List input devices and exit")
    parser.add_argument("--seconds", type=float, default=None, help="Stop automatically after N seconds")
    parser.add_argument("--no-status", action="store_true", help="Disable live score/status line")
    parser.add_argument("--status-every", type=float, default=0.5, help="Seconds between status updates")
    parser.add_argument("--trigger-count", type=int, default=DEFAULT_TRIGGER_COUNT, help="Require N consecutive frames above threshold")
    parser.add_argument("--ema-alpha", type=float, default=DEFAULT_EMA_ALPHA, help="EMA smoothing alpha for decision score (0 disables)")
    parser.add_argument("--min-rms", type=float, default=DEFAULT_MIN_RMS, help="Ignore windows below this short-window RMS level")
    parser.add_argument("--capture-dir", default=None, help="If set, save the 1.5s buffer to this dir on each trigger")
    args = parser.parse_args()

    if args.list_devices:
        list_input_devices()
        return 0

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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


