# persona-layer

A pluggable personalization side-module for open-weights LMs. You paste text
(memory about yourself, business info, support docs, guidelines); the module
makes the base model answer *as if* it knows you — without full fine-tuning and
without melting facts into weights.

This is the **v0 pragmatic baseline** of a larger plan. It is intentionally a
combination of strong, well-understood parts plus a measurement loop, so every
later "novel" idea has a number to beat.

## The idea

Personal/business knowledge is two different things and needs two mechanisms:

| Channel | Carries | Mechanism (v0) | Why |
|---|---|---|---|
| **Facts** | name, policies, docs, memory | retrieval (verbatim grounding) | the model can't hallucinate a span it was handed — this is the reliability anchor |
| **Tone** | voice, persona, guidelines | **steering vector** (CAA) added to the residual stream | captures *style* in the weights' activation space; no training loop |

Both are fused at answer time. The base model keeps 100% of its intelligence;
we only nudge it.

## Run it

```bash
# from research/persona-layer/
python -m bench.harness            # prints the scoreboard
python -m bench.harness --verbose  # also prints every answer
python run_demo.py                 # eyeball one model across base/rag/rag+tone
```

First run downloads a small model (`Qwen/Qwen2.5-1.5B-Instruct`, ~3 GB) and an
embedding model (~80 MB).

### Use Gemma instead

Gemma is license-gated on the HF hub:

```bash
huggingface-cli login          # accept the Gemma license on the model page first
```

Then set `GEN_MODEL = "google/gemma-2-2b-it"` in `config.py`. The facts and tone
techniques are architecture-agnostic.

## Scoreboard

`bench/harness.py` reports, per mode (`base`, `rag`, `rag+tone`):

- **fact_recall** — answerable fact Qs answered correctly (↑)
- **abstain** — unanswerable Qs correctly declined instead of hallucinated (↑)
- **tone** — similarity of replies to on-tone exemplars (↑, rough proxy)
- **latency_s** — mean seconds/query

Expect roughly: `rag` lifts fact_recall + abstain over `base`; `rag+tone` keeps
facts while raising the tone score.

## Knobs

- `--alpha` (steering strength). Start ~3–6. Too high → incoherent; too low →
  no tone shift. Sweep it; this is the main thing to tune.
- `PersonaLayer(steer_layers=...)` — which decoder layers get steered (default: a
  small band around the middle, where steering is most effective).

## Files

```
config.py            model ids + device
persona/model.py     HF wrapper: chat gen, steering hooks, hidden-state extraction
persona/facts.py     facts channel: chunk + embed + retrieve
persona/tone.py      tone channel: contrastive activation addition (steering vec)
persona/system.py    PersonaLayer: fuses both channels; answer(mode=...)
bench/harness.py     scoreboard
bench/datasets/      sample corpus + fact Qs + tone spec
run_demo.py          qualitative side-by-side
```

## Roadmap — the "push" phase (beat this baseline)

1. **Token-level decode-time gate** — route fact-like tokens to the grounded
   store, style tokens to the steered base. The real reliability win.
2. **Compressed memory** — replace raw-text retrieval with gist/ICAE-style
   memory tokens or KV injection (faster, smaller context) while keeping a
   verbatim store for citations.
3. **One-shot text → module** — a hypernetwork (cf. Text-to-LoRA) that emits the
   personalization module in a single forward pass: paste text, get a pluggable
   layer, no per-user training. This is the original dream; the baseline above is
   the bar it has to clear on this scoreboard.
```
