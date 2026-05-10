"""Command-style entry point for the Hey Stuard wake word listener.

This keeps the desktop fallback aligned with the standalone wakeword checkout:

    python listen.py listen

The implementation delegates to the bundled NumPy listener so packaged builds
stay lightweight and do not need TensorFlow, PyTorch, or ONNX.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from listen_numpy import list_input_devices, listen as listen_numpy


THRESHOLDS = {
    "strict": 0.985,
    "default": 0.95,
    "relaxed": 0.80,
}
DEFAULT_WAKE_TEXT = "Hey Stuard"


def _threshold(value: str | None, override: float | None) -> float:
    if override is not None:
        return float(override)
    if value is None:
        return THRESHOLDS["default"]

    normalized = str(value).strip().lower()
    if normalized in THRESHOLDS:
        return THRESHOLDS[normalized]

    try:
        return float(normalized)
    except ValueError as exc:
        choices = ", ".join(sorted(THRESHOLDS))
        raise argparse.ArgumentTypeError(
            f"sensitivity must be numeric or one of: {choices}"
        ) from exc


def _default_weights() -> str:
    return str(Path(__file__).resolve().parent / "models" / "kws_weights.npz")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Hey Stuard wake word listener")
    subparsers = parser.add_subparsers(dest="command")

    listen_parser = subparsers.add_parser("listen", help="Listen for Hey Stuard")
    listen_parser.add_argument(
        "--weights",
        "--weights-path",
        dest="weights",
        default=_default_weights(),
        help="Path to exported NumPy weights",
    )
    listen_parser.add_argument(
        "--sensitivity",
        default="default",
        help="strict, default, relaxed, or a numeric threshold",
    )
    listen_parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="Override the selected sensitivity threshold",
    )
    listen_parser.add_argument("--cooldown", type=float, default=1.5)
    listen_parser.add_argument("--device", type=int, default=None)
    listen_parser.add_argument("--seconds", type=float, default=None)
    listen_parser.add_argument("--trigger-count", type=int, default=6)
    listen_parser.add_argument("--ema-alpha", type=float, default=0.25)
    listen_parser.add_argument("--min-rms", type=float, default=0.003)
    listen_parser.add_argument("--no-status", action="store_true")
    listen_parser.add_argument("--status-every", type=float, default=0.5)

    subparsers.add_parser("devices", help="List available audio input devices")
    return parser


def normalize_argv(argv: list[str]) -> list[str]:
    if len(argv) <= 1:
        return [argv[0], "listen"]
    if argv[1] == "--list-devices":
        return [argv[0], "devices", *argv[2:]]
    if argv[1].startswith("-"):
        return [argv[0], "listen", *argv[1:]]
    return argv


def main(argv: list[str] | None = None) -> int:
    argv = normalize_argv(list(sys.argv if argv is None else argv))
    parser = build_parser()
    args = parser.parse_args(argv[1:])

    if args.command == "devices":
        list_input_devices()
        return 0

    threshold = _threshold(args.sensitivity, args.threshold)
    print(
        f'Listening for "{DEFAULT_WAKE_TEXT}" '
        f"(threshold={threshold:.3f}, sensitivity={args.sensitivity})",
        flush=True,
    )
    print("Press Ctrl+C to stop.\n", flush=True)

    listen_numpy(
        args.weights,
        sensitivity=threshold,
        cooldown=args.cooldown,
        device=args.device,
        show_status=(not args.no_status),
        status_every=args.status_every,
        seconds=args.seconds,
        trigger_count=args.trigger_count,
        ema_alpha=args.ema_alpha,
        min_rms=args.min_rms,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
