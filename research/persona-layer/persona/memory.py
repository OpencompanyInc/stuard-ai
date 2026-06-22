"""Representation-space key-value memory (kNN-LM inspired), built from text with
NO gradient training and adding ZERO context tokens.

Inspired by LoRA's *form* (a pluggable side-module on a frozen base) but not its
*content*: instead of a low-rank weight delta (which can't hold many independent
facts), this is a high-capacity, addressable datastore that edits the next-token
distribution directly.

  build():    one forward pass over the text; store (key = last-layer hidden
              state at position t, value = the token at position t+1).
  generate(): custom decode loop. At each step, kNN over keys -> p_mem;
              final p = (1-lam)*p_lm + lam*p_mem. A distance gate sets lam->0 when
              nothing matches, so it abstains instead of hallucinating.

This is the conditional, key-addressed sibling of the (unconditional) tone
steering vector -- both just bias the next-token distribution from your text.
"""

import time

import torch
import torch.nn.functional as F


class KNNMemory:
    def __init__(self, lm, lam=0.5, k=16, sim_temp=10.0, gate=0.0):
        self.lm = lm
        self.lam = lam              # interpolation weight toward memory
        self.k = k                  # neighbours per step
        self.sim_temp = sim_temp    # softmax temperature over cosine sims
        self.gate = gate            # min top-cosine to activate memory (else abstain)
        self.keys = None            # [N, d] normalized
        self.vals = None            # [N] token ids
        self._device = lm.model.device

    @torch.no_grad()
    def build(self, texts):
        """texts: a string or list of strings to memorize."""
        if isinstance(texts, str):
            texts = [texts]
        all_keys, all_vals = [], []
        for text in texts:
            ids = self.lm.tok(text, return_tensors="pt").input_ids.to(self._device)
            if ids.shape[1] < 2:
                continue
            out = self.lm.model(ids, output_hidden_states=True, use_cache=False)
            h = out.hidden_states[-1][0]          # [seq, d]
            all_keys.append(F.normalize(h[:-1].float(), dim=-1))  # key_t predicts t+1
            all_vals.append(ids[0][1:])
        self.keys = torch.cat(all_keys, dim=0)    # [N, d]
        self.vals = torch.cat(all_vals, dim=0)    # [N]
        return self

    @torch.no_grad()
    def build_from_pairs(self, pairs):
        """pairs: list of {"question","answer"}. Store keys from the ANSWER region
        of each chat so keys live in the query/answering distribution -- a held-out
        question's hidden state then matches a stored answer context."""
        tok = self.lm.tok
        all_keys, all_vals = [], []
        for ex in pairs:
            prompt = self.lm._apply_chat(
                [
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": ex["question"]},
                ]
            )
            full = prompt + ex["answer"] + (tok.eos_token or "")
            p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
            f_ids = tok(full, add_special_tokens=False)["input_ids"]
            if len(f_ids) <= len(p_ids):
                continue
            ids = torch.tensor([f_ids], device=self._device)
            h = self.lm.model(ids, output_hidden_states=True, use_cache=False).hidden_states[-1][0]
            start = len(p_ids)  # first answer-token position
            all_keys.append(F.normalize(h[start - 1 : len(f_ids) - 1].float(), dim=-1))
            all_vals.append(torch.tensor(f_ids[start:], device=self._device))
        self.keys = torch.cat(all_keys, dim=0)
        self.vals = torch.cat(all_vals, dim=0)
        return self

    @torch.no_grad()
    def _knn_dist(self, h, vocab_size):
        hq = F.normalize(h.float(), dim=-1)
        sims = self.keys @ hq                      # cosine [N]
        topv, topi = torch.topk(sims, min(self.k, sims.shape[0]))
        lam = self.lam if topv[0].item() >= self.gate else 0.0
        if lam == 0.0:
            return None, topv[0].item()
        w = F.softmax(topv * self.sim_temp, dim=-1)
        p_mem = torch.zeros(vocab_size, device=h.device)
        p_mem.index_add_(0, self.vals[topi], w)
        return (lam, p_mem), topv[0].item()

    @torch.no_grad()
    def generate(self, messages, steering=None, max_new_tokens=200):
        tok = self.lm.tok
        prompt = self.lm._apply_chat(messages)
        ids = tok(prompt, return_tensors="pt").input_ids.to(self._device)

        handles = self.lm._add_steering(steering) if steering else []
        t0 = time.time()
        out_ids = []
        try:
            cur, past = ids, None
            for _ in range(max_new_tokens):
                out = self.lm.model(
                    cur, past_key_values=past,
                    output_hidden_states=True, use_cache=True,
                )
                past = out.past_key_values
                logits = out.logits[0, -1]
                h = out.hidden_states[-1][0, -1]
                p_lm = F.softmax(logits.float(), dim=-1)

                knn, _ = self._knn_dist(h, p_lm.shape[0])
                if knn is None:
                    p = p_lm
                else:
                    lam, p_mem = knn
                    p = (1.0 - lam) * p_lm + lam * p_mem

                nxt = int(torch.argmax(p))
                if nxt == tok.eos_token_id:
                    break
                out_ids.append(nxt)
                cur = torch.tensor([[nxt]], device=self._device)
        finally:
            for hd in handles:
                hd.remove()
        dt = time.time() - t0
        return tok.decode(out_ids, skip_special_tokens=True).strip(), dt
