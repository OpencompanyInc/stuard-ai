"""Scoreboard. Runs the dataset across modes and prints a comparison table.

    python -m bench.harness                 # default sample dataset
    python -m bench.harness --alpha 6        # sweep steering strength
    python -m bench.harness --verbose        # also print each answer

Metrics:
    fact_recall  fraction of answerable fact questions whose answer contains the
                 expected value (higher is better)
    abstain      fraction of UNanswerable questions where the model correctly
                 declined instead of hallucinating (higher is better)
    tone         mean cosine similarity of probe answers to the on-tone
                 exemplars (rough proxy; higher = more on-tone)
    latency_s    mean wall-clock seconds per query
"""

import argparse
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import numpy as np
from sentence_transformers import SentenceTransformer

from config import EMBED_MODEL, DEVICE, GEN_MODEL
from persona.model import LM
from persona.system import PersonaLayer


def contains_any(text, needles):
    t = text.lower()
    return any(n.lower() in t for n in needles)


def run(dataset_path, alpha, modes, verbose=False, adapter=None,
        mem_lam=0.5, mem_k=16, mem_gate=0.0, mem_sim_temp=10.0, mem_pairs=None):
    with open(dataset_path, encoding="utf-8") as f:
        data = json.load(f)

    embedder = SentenceTransformer(EMBED_MODEL, device=DEVICE)
    lm = LM()
    persona = PersonaLayer(lm, alpha=alpha, embedder=embedder)
    persona.fit(
        corpus_text=data["corpus"],
        tone_pos=data["tone"]["pos"],
        tone_neg=data["tone"]["neg"],
    )
    if adapter:
        persona.attach_lora(adapter)
    if any("mem" in m for m in modes):
        from persona.memory import KNNMemory

        mem = KNNMemory(lm, lam=mem_lam, k=mem_k, sim_temp=mem_sim_temp, gate=mem_gate)
        if mem_pairs:
            with open(mem_pairs, encoding="utf-8") as pf:
                mem.build_from_pairs(json.load(pf))  # keys in query distribution
        else:
            mem.build(persona.corpus.chunks)  # datastore from declarative corpus
        persona.attach_memory(mem)
    pos_emb = embedder.encode(
        data["tone"]["pos"], normalize_embeddings=True, convert_to_numpy=True
    )
    abstain_markers = data["abstain_markers"]

    results = {}
    for mode in modes:
        hits = ans = abst = unans = 0
        lats, tones = [], []

        for item in data["fact_qs"]:
            r = persona.answer(item["q"], mode=mode)
            lats.append(r["latency"])
            if item.get("unanswerable"):
                unans += 1
                if contains_any(r["text"], abstain_markers):
                    abst += 1
            else:
                ans += 1
                if contains_any(r["text"], item["expected"]):
                    hits += 1
            if verbose:
                print(f"[{mode}] Q: {item['q']}\n    -> {r['text'][:200]}\n")

        for probe in data["tone"]["probes"]:
            r = persona.answer(probe, mode=mode)
            lats.append(r["latency"])
            e = embedder.encode(
                [r["text"]], normalize_embeddings=True, convert_to_numpy=True
            )[0]
            tones.append(float(np.max(pos_emb @ e)))
            if verbose:
                print(f"[{mode}] PROBE: {probe}\n    -> {r['text'][:200]}\n")

        results[mode] = {
            "fact_recall": hits / max(ans, 1),
            "abstain": (abst / unans) if unans else float("nan"),
            "tone": statistics.mean(tones) if tones else float("nan"),
            "latency": statistics.mean(lats),
        }
    return results


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=os.path.join(here, "datasets", "sample.json"))
    ap.add_argument("--alpha", type=float, default=0.1)
    ap.add_argument("--modes", default=None)
    ap.add_argument("--adapter", default=None)
    ap.add_argument("--memory", action="store_true", help="include kNN memory modes")
    ap.add_argument("--mem_pairs", default=None, help="build datastore from Q->A json")
    ap.add_argument("--lam", type=float, default=0.5)
    ap.add_argument("--k", type=int, default=16)
    ap.add_argument("--gate", type=float, default=0.0)
    ap.add_argument("--sim_temp", type=float, default=10.0)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if args.modes:
        modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    else:
        modes = ["base", "rag"]
        if args.adapter:
            modes += ["lora", "lora+tone"]
        if args.memory:
            modes += ["mem", "mem+tone"]
        if not args.adapter and not args.memory:
            modes += ["rag+tone"]
    results = run(
        args.dataset, args.alpha, modes, args.verbose, adapter=args.adapter,
        mem_lam=args.lam, mem_k=args.k, mem_gate=args.gate, mem_sim_temp=args.sim_temp,
        mem_pairs=args.mem_pairs,
    )

    cfg = f"model={GEN_MODEL}  alpha={args.alpha}"
    if any("mem" in m for m in modes):
        cfg += f"  | mem lam={args.lam} k={args.k} gate={args.gate} temp={args.sim_temp}"
    print("\n" + cfg + "\n")
    header = f"{'mode':<10}{'fact_recall':>12}{'abstain':>10}{'tone':>8}{'latency_s':>11}"
    print(header)
    print("-" * len(header))
    for mode in modes:
        m = results[mode]
        fr = f"{m['fact_recall'] * 100:.0f}%"
        ab = "n/a" if m["abstain"] != m["abstain"] else f"{m['abstain'] * 100:.0f}%"
        tn = f"{m['tone']:.3f}"
        lt = f"{m['latency']:.2f}"
        print(f"{mode:<10}{fr:>12}{ab:>10}{tn:>8}{lt:>11}")
    print()


if __name__ == "__main__":
    main()
