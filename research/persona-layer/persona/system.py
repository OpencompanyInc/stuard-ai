"""PersonaLayer: the pluggable side-module that fuses the two channels.

  fit()    -- build the facts index + compute the tone steering vector
  answer() -- run a query in one of: base | rag | tone | rag+tone

For v0 the "decode-time gate" is simply: ground facts via retrieval AND apply
tone steering. Token-level confidence gating (route fact-tokens to the grounded
store, style-tokens to the steered base) is the first item in the push phase.
"""

from persona.facts import Corpus
from persona.tone import compute_steering

SYSTEM_BASE = "You are a helpful assistant."

GROUNDED_INSTRUCTION = (
    "You are a helpful assistant. Use the CONTEXT below to answer the user. "
    "The context holds facts about the user and their business. "
    "If the answer is not in the context, say you don't know rather than guessing."
)


class PersonaLayer:
    def __init__(self, lm, steer_layers=None, alpha=0.1, embedder=None):
        self.lm = lm
        self.alpha = alpha
        if steer_layers is None:
            mid = lm.num_layers // 2
            # a small band around the middle -- where steering is most effective
            steer_layers = list(range(max(0, mid - 2), min(lm.num_layers, mid + 3)))
        self.steer_layers = steer_layers
        self._embedder = embedder
        self.corpus = None
        self.steer_vecs = None
        self.has_lora = False
        self.has_memory = False
        self.memory = None

    def fit(self, corpus_text=None, tone_pos=None, tone_neg=None):
        if corpus_text is not None:
            self.corpus = Corpus(corpus_text, embedder=self._embedder)
            self._embedder = self.corpus.embedder
        if tone_pos and tone_neg:
            self.steer_vecs = compute_steering(
                self.lm, tone_pos, tone_neg, self.steer_layers
            )
        return self

    def attach_lora(self, adapter_dir, name="persona"):
        """Load a context-distilled LoRA. It carries the corpus facts in weights,
        so `lora` modes answer from the query alone -- zero context tokens."""
        self.lm.model.load_adapter(adapter_dir, adapter_name=name)
        self.lm.model.disable_adapters()  # off by default; enabled per-mode
        self.has_lora = True
        return self

    def attach_memory(self, memory):
        """Attach a built kNN memory (carries facts in a datastore, zero context)."""
        self.memory = memory
        self.has_memory = True
        return self

    def _steering(self):
        if not self.steer_vecs:
            return None
        return {L: (self.steer_vecs[L], self.alpha) for L in self.steer_layers}

    def _messages(self, query, grounded):
        if grounded and self.corpus is not None:
            hits = self.corpus.retrieve(query)
            ctx = "\n".join(f"- {c}" for c, _ in hits)
            sys = f"{GROUNDED_INSTRUCTION}\n\nCONTEXT:\n{ctx}"
        else:
            sys = SYSTEM_BASE
        return [
            {"role": "system", "content": sys},
            {"role": "user", "content": query},
        ]

    def answer(self, query, mode="rag+tone", max_new_tokens=200):
        # Toggle the LoRA: "lora" modes answer from weights (query-only prompt);
        # "base"/"rag" modes run the frozen base.
        if self.has_lora:
            if "lora" in mode:
                self.lm.model.enable_adapters()
            else:
                self.lm.model.disable_adapters()

        # kNN memory path: answer from the datastore, query-only (zero context).
        if "mem" in mode and self.has_memory:
            steering = self._steering() if "tone" in mode else None
            messages = self._messages(query, grounded=False)
            text, dt = self.memory.generate(
                messages, steering=steering, max_new_tokens=max_new_tokens
            )
            return {"text": text, "latency": dt, "mode": mode}

        messages = self._messages(query, grounded="rag" in mode)
        steering = self._steering() if "tone" in mode else None
        text, dt = self.lm.generate(
            messages, steering=steering, max_new_tokens=max_new_tokens
        )
        return {"text": text, "latency": dt, "mode": mode}
