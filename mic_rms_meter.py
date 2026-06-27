from __future__ import annotations

import argparse
import sys
import time
from typing import Any, Optional

import numpy as np
import sounddevice as sd


def _configure_stdout() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass


def list_input_devices() -> None:
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
            f"- {i}: {d.get('name')} | hostapi={hostapi_name} | max_in={d.get('max_input_channels')} | default_sr={d.get('default_samplerate')}",
            flush=True,
        )


def rms_meter(
    device: Optional[int],
    samplerate: int,
    block_ms: int,
    print_every_ms: int,
) -> None:
    _configure_stdout()

    blocksize = max(1, int((samplerate * block_ms) / 1000.0))
    print_every = max(1, int(print_every_ms / block_ms))

    state: dict[str, Any] = {
        "count": 0,
        "rms": 0.0,
        "peak": 0.0,
    }

    def callback(indata: np.ndarray, frames: int, time_info: Any, status: Any) -> None:  # noqa: ANN401
        if status:
            print(f"\n[audio_status] {status}", flush=True)

        x = indata.astype(np.float32, copy=False)
        if x.ndim == 2:
            x = x[:, 0]

        rms = float(np.sqrt(np.mean(x * x) + 1e-12))
        peak = float(np.max(np.abs(x)) if x.size else 0.0)

        state["count"] += 1
        state["rms"] = rms
        state["peak"] = peak

        if state["count"] % print_every == 0:
            # RMS/peak here are already in ~[0, 1] for float32 streams.
            print(f"\rrms={rms:.5f}  peak={peak:.5f}    ", end="", flush=True)

    stream_kwargs: dict[str, Any] = {
        "samplerate": samplerate,
        "channels": 1,
        "dtype": "float32",
        "blocksize": blocksize,
        "callback": callback,
    }
    if device is not None:
        stream_kwargs["device"] = device

    print("Listening (Ctrl+C to stop)...", flush=True)
    if device is not None:
        print(f"Device: {device}", flush=True)
    print(f"Samplerate: {samplerate} Hz | block: {block_ms} ms", flush=True)

    try:
        with sd.InputStream(**stream_kwargs):
            while True:
                time.sleep(0.25)
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-devices", action="store_true")
    parser.add_argument("--device", type=int, default=None)
    parser.add_argument("--samplerate", type=int, default=44100)
    parser.add_argument("--block-ms", type=int, default=50)
    parser.add_argument("--print-every-ms", type=int, default=200)
    args = parser.parse_args()

    if args.list_devices:
        list_input_devices()
        return 0

    rms_meter(
        device=args.device,
        samplerate=int(args.samplerate),
        block_ms=int(args.block_ms),
        print_every_ms=int(args.print_every_ms),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
