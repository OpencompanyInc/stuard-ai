"""
Ultra-Lightweight Pure NumPy Inference.
Requires ONLY numpy and sounddevice.
No TensorFlow, No PyTorch, No ONNX.
Memory usage: ~30-50MB.

Usage:
    python listen_numpy.py --weights models/kws_weights.npz --sensitivity 0.9 --trigger-count 5
"""
import argparse
import time
import os
import sys
import threading
import numpy as np
import sounddevice as sd

# Audio Config
SAMPLE_RATE = 16000
FRAME_LENGTH = 480  # 30ms
HOP_SIZE = 160     # 10ms
FFT_SIZE = 512
DURATION = 1.5
INPUT_LEN = int(SAMPLE_RATE * DURATION)

def _configure_stdout():
    # Make output show up immediately in Windows terminals.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

def list_input_devices():
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
    def __init__(self, weights_path):
        print(f"Loading weights from {weights_path}")
        self.weights = np.load(weights_path)
        self.mel_matrix = self.weights['mel_matrix']
        n = np.arange(FRAME_LENGTH, dtype=np.float32)
        hann = 0.5 * (1.0 - np.cos(2.0 * np.pi * n / FRAME_LENGTH))
        self.window = np.zeros(FFT_SIZE, dtype=np.float32)
        pad_left = (FFT_SIZE - FRAME_LENGTH) // 2
        self.window[pad_left: pad_left + FRAME_LENGTH] = hann
        
        # Load layers
        # We hardcode the architecture matching kws_model.py DS-CNN
        # This is faster/simpler than parsing a config
        self.layers = []
        
        # Helper to get weights
        def get_w(name):
            return self.weights[f"{name}_kernel"], self.weights[f"{name}_bias"]

        # 1. Initial Conv
        k, b = get_w("layer_0_Conv2D")
        self.layers.append(('conv', k, b, (2,2))) # Stride 2,2
        
        # 2. DS-CNN Blocks (x4)
        # Block 1
        k, b = get_w("layer_1_DepthwiseConv2D")
        self.layers.append(('dw_conv', k, b, (1,1)))
        k, b = get_w("layer_2_Conv2D")
        self.layers.append(('conv', k, b, (1,1)))
        
        # Block 2
        k, b = get_w("layer_3_DepthwiseConv2D")
        self.layers.append(('dw_conv', k, b, (1,1)))
        k, b = get_w("layer_4_Conv2D")
        self.layers.append(('conv', k, b, (1,1)))
        
        # Block 3
        k, b = get_w("layer_5_DepthwiseConv2D")
        self.layers.append(('dw_conv', k, b, (1,1)))
        k, b = get_w("layer_6_Conv2D")
        self.layers.append(('conv', k, b, (1,1)))
        
        # Block 4
        k, b = get_w("layer_7_DepthwiseConv2D")
        self.layers.append(('dw_conv', k, b, (1,1)))
        k, b = get_w("layer_8_Conv2D")
        self.layers.append(('conv', k, b, (1,1)))
        
        # Dense
        k, b = get_w("dense")
        self.layers.append(('dense', k, b, None))

    def pad_same(self, x, k_size, strides):
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
        
        return np.pad(x, ((0,0), (pad_top, pad_bottom), (pad_left, pad_right), (0,0)))

    def conv2d(self, x, w, b, strides):
        # Naive loop implementation (slow but simple) -> Optimization: Vectorized
        # x: (N, H, W, C_in)
        # w: (Kh, Kw, C_in, C_out)
        
        kh, kw, c_in, c_out = w.shape
        x_pad = self.pad_same(x, (kh, kw), strides)
        
        N, H, W, C = x_pad.shape
        sh, sw = strides
        
        out_h = (H - kh) // sh + 1
        out_w = (W - kw) // sw + 1
        
        # Efficient strided view
        # Shape: (N, out_h, out_w, kh, kw, C_in)
        strides_shape = (N, out_h, out_w, kh, kw, C)
        strides_numpy = (
            x_pad.strides[0],
            x_pad.strides[1] * sh,
            x_pad.strides[2] * sw,
            x_pad.strides[1],
            x_pad.strides[2],
            x_pad.strides[3]
        )
        
        windows = np.lib.stride_tricks.as_strided(x_pad, shape=strides_shape, strides=strides_numpy)
        
        # Flatten windows for dot product
        # (N, out_h, out_w, kh*kw*c_in)
        windows_flat = windows.reshape(N, out_h, out_w, -1)
        
        # Flatten weights
        # (kh*kw*c_in, c_out)
        w_flat = w.reshape(-1, c_out)
        
        # Dot product
        # (N, out_h, out_w, c_out)
        out = np.dot(windows_flat, w_flat) + b
        return out

    def depthwise_conv2d(self, x, w, b, strides):
        # w: (Kh, Kw, C_in, 1) -> (Kh, Kw, C_in)
        kh, kw, c_in, _ = w.shape
        w = w.squeeze(axis=-1)
        
        x_pad = self.pad_same(x, (kh, kw), strides)
        N, H, W, C = x_pad.shape
        sh, sw = strides
        
        out_h = (H - kh) // sh + 1
        out_w = (W - kw) // sw + 1
        
        # Strided view
        strides_shape = (N, out_h, out_w, kh, kw, C)
        strides_numpy = (
            x_pad.strides[0],
            x_pad.strides[1] * sh,
            x_pad.strides[2] * sw,
            x_pad.strides[1],
            x_pad.strides[2],
            x_pad.strides[3]
        )
        windows = np.lib.stride_tricks.as_strided(x_pad, shape=strides_shape, strides=strides_numpy)
        
        # Element-wise multiply and sum over spatial kernel dims (axis 3,4)
        # windows: (N, Oh, Ow, Kh, Kw, C)
        # w: (Kh, Kw, C)
        # Result: (N, Oh, Ow, C)
        out = np.sum(windows * w, axis=(3, 4)) + b
        return out

    def relu(self, x):
        return np.maximum(0, x)

    def softmax(self, x):
        e_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
        return e_x / np.sum(e_x, axis=-1, keepdims=True)

    def preprocess(self, audio):
        if len(audio) > INPUT_LEN: audio = audio[:INPUT_LEN]
        else: audio = np.pad(audio, (0, INPUT_LEN - len(audio)))
        
        # STFT
        n_frames = (len(audio) - FFT_SIZE) // HOP_SIZE + 1
        frames = np.lib.stride_tricks.as_strided(
            audio, shape=(n_frames, FFT_SIZE),
            strides=(audio.strides[0]*HOP_SIZE, audio.strides[0])
        )
        windowed = frames * self.window
        stft = np.abs(np.fft.rfft(windowed, n=FFT_SIZE))
        
        # Mel
        mel = np.dot(stft, self.mel_matrix)
        log_mel = np.log(mel + 1e-6)
        
        # Reshape (1, Time, Freq, 1)
        return log_mel.reshape(1, log_mel.shape[0], log_mel.shape[1], 1).astype(np.float32)

    def predict(self, audio):
        x = self.preprocess(audio)
        
        for layer_type, w, b, strides in self.layers:
            if layer_type == 'conv':
                x = self.conv2d(x, w, b, strides)
                x = self.relu(x) # BN is fused, ReLU follows
            elif layer_type == 'dw_conv':
                x = self.depthwise_conv2d(x, w, b, strides)
                x = self.relu(x)
            elif layer_type == 'dense':
                # Global Average Pooling first
                # x: (N, H, W, C) -> (N, C)
                x = np.mean(x, axis=(1, 2))
                x = np.dot(x, w) + b
                x = self.softmax(x)
                
        return x[0][1]

def listen(
    weights_path,
    sensitivity=0.9,
    cooldown=1.0,
    device=None,
    show_status=True,
    status_every=0.5,
    seconds=None,
    trigger_count: int = 5,
    ema_alpha: float = 0.2,
    min_rms: float = 0.003,
):
    _configure_stdout()
    if not os.path.exists(weights_path):
        print(f"Error: Weights not found at {weights_path}", flush=True)
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
    
    last_trigger = 0
    start_time = time.time()
    last_status = 0.0
    consec = 0
    ema = None
    
    def callback(indata, frames, time_info, status):
        nonlocal buffer
        if status:
            # Keep this on its own line so it doesn't corrupt the status line.
            print(f"\n[Audio status] {status}", flush=True)

        new_data = indata[:, 0].astype(np.float32, copy=False)  # mono
        n = int(new_data.shape[0])
        if n <= 0:
            return

        # Update rolling buffer in-place (no allocations), thread-safe.
        with buffer_lock:
            if n >= buffer.shape[0]:
                buffer[:] = new_data[-buffer.shape[0]:]
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

                # Snapshot buffer for inference.
                with buffer_lock:
                    current = buffer.copy()

                t0 = time.perf_counter()
                score = float(model.predict(current))
                dur_ms = (time.perf_counter() - t0) * 1000.0

                rms = float(np.sqrt(np.mean(current * current) + 1e-12))
                if rms < min_rms:
                    ema = None
                    decision = 0.0
                elif ema_alpha and ema_alpha > 0.0:
                    ema = score if ema is None else (ema_alpha * score + (1.0 - ema_alpha) * float(ema))
                    decision = float(ema)
                else:
                    decision = score

                # Debounce: require N consecutive frames above threshold before triggering.
                if decision > sensitivity:
                    consec += 1
                else:
                    consec = 0

                if consec >= int(trigger_count) and (now - last_trigger) > cooldown:
                    print(
                        f"\nWAKE WORD DETECTED  score={score:.3f}  decision={decision:.3f}  "
                        f"consec={consec}  infer={dur_ms:.1f}ms",
                        flush=True,
                    )
                    last_trigger = now
                    consec = 0

                if show_status and (now - last_status) >= float(status_every):
                    print(
                        f"\rscore={score:.3f}  decision={decision:.3f}  consec={consec}  rms={rms:.4f}  infer={dur_ms:.1f}ms     ",
                        end="",
                        flush=True,
                    )
                    last_status = now

                time.sleep(0.02)
    except KeyboardInterrupt:
        print("\nStopping...", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", default="models/kws_weights.npz")
    parser.add_argument("--sensitivity", type=float, default=0.9)
    parser.add_argument("--cooldown", type=float, default=1.0)
    parser.add_argument("--device", type=int, default=None, help="Input device index (see --list-devices)")
    parser.add_argument("--list-devices", action="store_true", help="List input devices and exit")
    parser.add_argument("--seconds", type=float, default=None, help="Stop automatically after N seconds")
    parser.add_argument("--no-status", action="store_true", help="Disable live score/status line")
    parser.add_argument("--status-every", type=float, default=0.5, help="Seconds between status updates")
    parser.add_argument("--trigger-count", type=int, default=5, help="Require N consecutive frames above threshold")
    parser.add_argument("--ema-alpha", type=float, default=0.2, help="EMA smoothing alpha for decision score (0 disables)")
    parser.add_argument("--min-rms", type=float, default=0.003, help="Ignore windows below this RMS level")
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
    )
