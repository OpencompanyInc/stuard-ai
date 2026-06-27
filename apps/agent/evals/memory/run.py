"""
CLI: python -m evals.memory.run [--verbose] [--json]

Runs Suite A: Segment Recall against a temp MemoryDB with real
OpenAI text-embedding-3-large embeddings.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict

from .harness import run_suite_a, format_report


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--verbose", "-v", action="store_true", help="show per-query detail")
    p.add_argument("--json", action="store_true", help="emit JSON report")
    args = p.parse_args()

    try:
        report = run_suite_a()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 2

    if args.json:
        d = asdict(report)
        print(json.dumps(d, indent=2))
    else:
        print(format_report(report, verbose=args.verbose))
    return 0


if __name__ == "__main__":
    sys.exit(main())
