"""Eyeball demo: see the persona layer change one model's answers across modes.

    python run_demo.py
    python run_demo.py --alpha 6
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from persona.model import LM
from persona.system import PersonaLayer

QUERIES = [
    "What is my name and what is our flagship coffee?",
    "A customer opened a bag by accident and wants to return it. How should I reply?",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--alpha", type=float, default=0.1)
    ap.add_argument("--max_new", type=int, default=200)
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "bench", "datasets", "sample.json"), encoding="utf-8") as f:
        data = json.load(f)

    lm = LM()
    print(f"loaded {lm.name}  ({lm.num_layers} layers, hidden={lm.hidden_size})\n")

    persona = PersonaLayer(lm, alpha=args.alpha)
    persona.fit(
        corpus_text=data["corpus"],
        tone_pos=data["tone"]["pos"],
        tone_neg=data["tone"]["neg"],
    )
    print(f"steering layers: {persona.steer_layers}  alpha={persona.alpha}\n")

    for q in QUERIES:
        print("=" * 70)
        print("QUERY:", q)
        for mode in ["base", "rag", "rag+tone"]:
            r = persona.answer(q, mode=mode, max_new_tokens=args.max_new)
            print(f"\n--- {mode}  ({r['latency']:.2f}s) ---")
            print(r["text"])
        print()


if __name__ == "__main__":
    main()
