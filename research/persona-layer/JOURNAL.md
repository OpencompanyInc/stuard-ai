# persona-layer — research journal

**Goal.** A pluggable, per-user "persona layer" that makes a frozen open-weights
model answer *as if* it knows the user's facts (name, business, docs) **and**
speaks in their voice — with **zero added context tokens** and without slow,
unreliable full fine-tuning. Knowledge should live in a plug-in module that
directly shapes the next-token distribution.

**Hard requirements (from the brief).**
- Zero context-window addition (rules out RAG as the delivery mechanism).
- Directly affect token probabilities (parametric / activation-space).
- Keep the base model's intelligence (frozen base + side-module).
- Fast to build ("not really fine-tune").
- Reliable on **facts** *and* **tone/style**.

**Method.** Every mechanism is scored on the same harness (`bench/harness.py`):
`fact_recall` (↑), `abstain` on unanswerable Qs (↑, anti-hallucination),
`tone` similarity (↑), `latency` (↓). RAG = reliability ceiling but violates the
zero-context rule; it stays in the table as the bar to match at zero context.

Environment: Windows, RTX 5070 Laptop (8 GB), **free-threaded CPython 3.13t**,
torch 2.7+cu128, transformers 5.6.2. Default model `Qwen/Qwen2.5-1.5B-Instruct`.

---

## Methods scoreboard (1.5B, sample corpus)

| method | facts | abstain | tone | context | build | notes |
|---|---|---|---|---|---|---|
| base (control) | 12% | 100% | 0.153 | 0 | 0 | knows nothing |
| rag (ceiling, off-spec) | **100%** | 50% | 0.133 | **high** | instant | the bar; violates zero-context |
| lora | 38% | **0%** | 0.130 | 0 | train | **hallucinates** (E5) |
| lora+tone | 50% | **0%** | 0.133 | 0 | train | confident wrong facts |
| mem-knn v1 (corpus) | 25% | 50% | 0.153 | 0 | instant | safe but under-recalls (E6) |
| mem+tone v1 | 25% | 50% | 0.197 | 0 | instant | best tone; steering composes |
| mem-knn v2 (Q→A) | 12% | 50% | 0.126 | 0 | instant | **worse**; degenerates (E7) |

---

## E1 — RAG baseline + harness
**Hypothesis.** Retrieval gives near-perfect facts; the bare model gives ~none.
**Result.** base 12% → rag **100%** fact_recall; clean abstain on the
parental-leave question.
**Learning.** Facts arriving verbatim in context = the reliability mechanism we
must reproduce *without* context. RAG is the bar, not the product.

## E2 — Tone via steering vector (Contrastive Activation Addition)
**Hypothesis.** Tone is a low-dim, global shift → a residual-stream steering
vector (no training) can carry it.
**Fail → fix.** First pass used the *raw* mean-difference vector × alpha=4 over 5
layers → activations detonated, output was garbage (`}%下面是小…`), fact_recall 0%.
Root cause: raw difference magnitude is large; ×4 across layers blew up the
residual norm.
**Fix.** Norm-relative steering: unit-normalize the direction, add
`alpha·‖h‖·û` per token (alpha≈0.1). 
**Result (rag+tone).** Coherent, fact_recall stays **100%**, tone 0.136 → 0.157.
**Learning.** Steering works for *style* and composes with a facts channel, but
the effect at alpha=0.1 is subtle; alpha is the knob. Confirms tone = low-rank.

## E3 — Environment constraints (what won't run here)
**Findings (all dead-ends, documented so we don't retry):**
- Free-threaded Python 3.13t **cannot JIT-compile Triton** ("limited API not
  supported in free-threaded build"). Both **bitsandbytes** and **torchao**
  route through Triton → no GPU 4-bit quant here. Installing torchao even *broke*
  the transformers import (eager torchao→Triton import) until uninstalled.
- `Qwen/Qwen3.5-4B` is a **hybrid linear-attention** model needing
  `flash-linear-attention` + `causal-conv1d` (the latter needs compilation → same
  wall). Run via CPU offload it produced **garbage even in base mode** (`of the
  of the…`, `000…`) at ~1.6 tok/s.
- **bitsandbytes-installed-but-broken is a landmine:** any library that eagerly
  imports it inherits the Triton crash. It broke `transformers` (via torchao) and
  then `peft` (LoRA training crashed at `import`). **Resolution: uninstalled
  bitsandbytes** — quant is impossible on this interpreter anyway.
**Learning.** On this box, anything needing the tone hooks must stay in HF
transformers at fp16/bf16; >~3B needs CPU offload (slow). A fast true-4B path
needs a standard (GIL) Python env. We proceed on 1.5B (fits, fast, full hooks).

## E4 — Why LoRA can't be the facts mechanism (the thesis)
**Argument.** LoRA's update is **rank-r** (r≈16 ≪ d). That suits *task/style*
adaptation (low intrinsic rank — same reason tone steering works). Facts are the
opposite: N **independent, ~orthogonal** key→value associations with no shared
low-dim structure. Consequences:
1. rank-r forces facts to share directions → **interference**.
2. facts live in the **FFN as key-value memories** (Geva et al.; ROME/MEMIT); a
   smeared SGD low-rank delta is not a clean addressed write.
3. no explicit match step → unreliable recall + hallucination; updates need
   retraining.
**Prediction.** A LoRA trained on distilled facts will score **well below** RAG
on `fact_recall`. (E5 tests this.)
**Design consequence.** Keep LoRA's *good* idea (frozen base + pluggable additive
side-module); replace the *bad* idea (low-rank, dense, unconditional, SGD delta)
with a **high-capacity, sparse, addressable, built-from-text memory** that edits
the next-token distribution. Unify with tone:
- tone = **unconditional** residual bias (steering).
- facts = **conditional, key-addressed** bias (memory) — fires only on a match,
  abstains otherwise. (kNN-LM / Memory-Layers inspired.)

## E5 — LoRA facts baseline  ✗ (thesis confirmed)
**Setup.** Context distillation: RAG teacher answered 32 auto-generated questions
→ 38 examples; rank-16 LoRA (q/k/v/o/gate/up/down, 18.4M params = 1.18%) trained
to ~0 loss. Eval on held-out harness questions.
**Result.** fact_recall 38% (lora) / 50% (lora+tone); **abstain 0%**.
**Failure evidence (the point of the experiment):**
- **Confabulation:** flagship coffee → "**Rich Porter**" (truth: Midnight Harbor)
  — invented a plausible-but-wrong name.
- **Interference:** weekend hours → "7 am to 6 pm" — that's the *weekday* hours;
  it fused the two hour facts.
- **Hallucinates on unanswerable:** parental leave → "18 weeks" (lora) vs "42
  days" (lora+tone) — a different fabrication each run. RAG abstained.
- Missed the simplest fact: "What is my name?" → "I don't have enough info."
**Learning.** Exactly the E4 prediction. Low-rank SGD memorizes *some* facts but
**interferes** across them and **confabulates with full confidence (0% abstain)**
— the dangerous failure mode. More data/rank would trade abstention for memorized
surface forms, not fix the structural mismatch. LoRA = right for tone, wrong for
facts.

## E6 — kNN representation memory, v1 (built from corpus)  ~ (safe but weak)
**Setup.** Datastore (hidden state → next token) from the *declarative* corpus,
one forward pass; decode `p = (1−λ)p_lm + λ p_knn`, λ=0.5, k=16, gate=0.
**Result.** fact_recall 25%, **abstain 50%** (= RAG; does NOT hallucinate),
tone 0.197 with steering (best tone — steering composes with the kNN loop).
**Diagnosis.** Recall is low because keys come from declarative statements ("My
name is John…") but queries are interrogative ("What is my name?"); their hidden
states don't match, so the right neighbour rarely wins and it falls back to base
(hence base-like answers + safe abstention).
**Learning.** The mechanism is **safe by construction** (gate → abstain, no
confabulation — the *opposite* of LoRA's failure). The two zero-context methods
fail in opposite directions: LoRA over-commits, kNN under-commits. kNN's safety
is the better foundation; it just needs keys in the *query* distribution.

## E7 — kNN memory, v2 (built from teacher Q→A pairs)  *(running)*
**Hypothesis.** Building the datastore from the distilled **Q→A** pairs (already
saved at `adapters/brewline/train_data.json`) puts keys in the query distribution,
so a held-out question's hidden state matches a stored answer context → recall
rises while the gate keeps kNN's safety. Same data LoRA used → apples-to-apples.
**Target.** Approach RAG's facts at zero context, without LoRA's hallucination.
**Result.** fact_recall 12% (mem) / 25% (mem+tone), abstain 50% — **worse than v1**;
mem+tone degenerated into repetition loops ("I'm sorry, but I'm sorry…") and
nonsense ("how many bags… the answer is 2").
**Why it failed.** kNN-LM was designed for *billion-token* datastores where
neighbours are dense and informative. A per-persona corpus is a few hundred
tokens → the datastore is dominated by *generic* continuations ("I'm sorry",
"the", "of the"). At λ=0.5 the memory injects generic tokens (degeneration); at
low λ it does nothing. Token-distribution interpolation is the wrong granularity
for "recall this specific fact," and tiny datastores are the wrong regime.
**Learning.** Second negative result. Both parametric attempts have now failed in
*opposite* ways — LoRA over-commits (confabulates), kNN under-commits/degenerates.

---

## Synthesis after E1–E7 — why RAG wins, and what the next mechanism must keep
RAG = 100%; every zero-context method ≤ 50%. The gap is a **mechanism**, not a
hyperparameter:
- **RAG works by attention-copying verbatim text.** The fact sits in the KV cache
  (put there by the prompt); copy/induction heads attend to it and reproduce it
  exactly. Reliability = verbatim + attention-reachable.
- **LoRA** dissolves facts into low-rank weights → loses verbatim access →
  confabulates (Rich Porter; 18 weeks).
- **kNN-LM** nudges the output distribution from a tiny generic datastore → never
  copies verbatim → under-fires or degenerates.

**Principle for the next mechanism.** Reliable recall needs the verbatim fact to
be **attention-reachable**. The only way to keep that *without spending prompt
tokens* is to place the fact in the **KV cache directly** — precomputed once,
reused every turn, optionally gated/compressed. Candidate mechanisms:
- **E8a — KV-injection:** precompute the fact's key/value vectors, prepend them to
  the attention cache at inference (selective/gated). Near-zero *prompt* context,
  reusable; preserves attention-copying. Tests the principle most directly.
- **E8b — targeted weight-editing (ROME/MEMIT):** closed-form rank-one writes into
  the FFN key-value memories where facts actually live — "facts as weights" done
  correctly (targeted, not low-rank SGD). True zero-overhead.
- tone → steering (settled: works, composes, best at mem+tone 0.197).

---

## Backlog / open questions
- kNN key mismatch: corpus is declarative, queries are interrogative → keys may
  not match. Mitigation to try: build datastore from teacher **Q→A** pairs (same
  distilled data as LoRA) so contexts match the query distribution.
- Addressed activation injection (per-fact key→residual value) as a 3rd method.
- Learned memory layer (Meta "Memory Layers at Scale") = highest ceiling, needs
  training — last resort.
- Weight-editing (ROME/MEMIT) for crisp atomic facts (name/email/numbers).
- Tune steering alpha (sweep 0.15–0.4) for a stronger, still-coherent voice.
