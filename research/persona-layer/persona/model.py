"""Thin wrapper around a HF causal LM with:
  - chat-templated generation
  - residual-stream steering via forward hooks (for the tone channel)
  - per-layer hidden-state extraction (to *compute* steering vectors)

Everything here is architecture-agnostic for Llama/Qwen2/Gemma/Mistral-style
decoder stacks (they all expose `model.model.layers`).
"""

import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from config import GEN_MODEL, DEVICE, DTYPE, DEVICE_MAP


class LM:
    def __init__(self, model_name: str = GEN_MODEL):
        self.name = model_name
        self.tok = AutoTokenizer.from_pretrained(model_name)

        if DEVICE_MAP:
            # spill across GPU+CPU for models too big for VRAM (slower)
            self.model = AutoModelForCausalLM.from_pretrained(
                model_name, torch_dtype=DTYPE, device_map=DEVICE_MAP
            )
        else:
            self.model = AutoModelForCausalLM.from_pretrained(
                model_name, torch_dtype=DTYPE
            ).to(DEVICE)
        self.model.eval()
        self.layers = self._find_layers()
        self.num_layers = len(self.layers)
        self.hidden_size = self.model.config.hidden_size

    def _find_layers(self):
        m = self.model
        if hasattr(m, "model") and hasattr(m.model, "layers"):
            return m.model.layers
        raise RuntimeError(
            f"Could not locate decoder layers for {type(m).__name__}; "
            "add an architecture-specific accessor here."
        )

    def _apply_chat(self, messages):
        # enable_thinking=False keeps Qwen3-style models from emitting <think>
        # blocks (which would blow past max_new_tokens before the answer).
        # Harmless on templates that don't use the flag.
        try:
            return self.tok.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
                enable_thinking=False,
            )
        except TypeError:
            return self.tok.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
            )

    @torch.no_grad()
    def generate(self, messages, steering=None, max_new_tokens=200, temperature=0.0):
        """steering: optional dict {layer_idx: (vector[hidden], alpha)}."""
        prompt = self._apply_chat(messages)
        inputs = self.tok(prompt, return_tensors="pt").to(self.model.device)

        handles = self._add_steering(steering) if steering else []
        gen_kwargs = dict(
            max_new_tokens=max_new_tokens,
            pad_token_id=self.tok.pad_token_id or self.tok.eos_token_id,
        )
        if temperature and temperature > 0:
            gen_kwargs.update(do_sample=True, temperature=temperature)
        else:
            gen_kwargs.update(do_sample=False)

        t0 = time.time()
        try:
            out = self.model.generate(**inputs, **gen_kwargs)
        finally:
            for h in handles:
                h.remove()
        dt = time.time() - t0

        gen = out[0][inputs["input_ids"].shape[1]:]
        text = self.tok.decode(gen, skip_special_tokens=True).strip()
        return text, dt

    def _add_steering(self, steering):
        handles = []
        for layer_idx, (vec, alpha) in steering.items():
            hook = self._make_hook(vec, alpha)
            handles.append(self.layers[layer_idx].register_forward_hook(hook))
        return handles

    @staticmethod
    def _make_hook(vec, alpha):
        """Add `alpha * ||h|| * unit_vec` per token -- a norm-relative nudge, so
        `alpha` is a stable fraction (~0.05-0.3) regardless of model/layer scale."""

        def hook(_module, _inputs, output):
            hs = output[0] if isinstance(output, tuple) else output
            v = vec.to(hs.dtype).to(hs.device)
            scale = hs.norm(dim=-1, keepdim=True)  # [batch, seq, 1]
            hs = hs + alpha * scale * v
            if isinstance(output, tuple):
                return (hs,) + tuple(output[1:])
            return hs

        return hook

    @torch.no_grad()
    def hidden_states(self, text):
        """Returns (hidden_states_tuple, attention_mask).
        hidden_states[i] is the output of decoder layer i-1; [0] is embeddings,
        so the output of decoder layer L is hidden_states[L + 1]."""
        inputs = self.tok(text, return_tensors="pt").to(self.model.device)
        out = self.model(**inputs, output_hidden_states=True)
        return out.hidden_states, inputs["attention_mask"]
