"""Facts channel: retrieval over the user's pasted text.

This is deliberately plain RAG for v0 -- verbatim grounding is the reliability
anchor (the model can't hallucinate a span it was handed). The "push" phase
swaps this for compressed memory tokens / KV injection while keeping a verbatim
store for citation.
"""

import re

import numpy as np
from sentence_transformers import SentenceTransformer

from config import EMBED_MODEL, DEVICE


def chunk_text(text: str, max_chars: int = 400):
    chunks = []
    for para in (p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()):
        if len(para) <= max_chars:
            chunks.append(para)
            continue
        cur = ""
        for sent in re.split(r"(?<=[.!?])\s+", para):
            if cur and len(cur) + len(sent) + 1 > max_chars:
                chunks.append(cur.strip())
                cur = sent
            else:
                cur = f"{cur} {sent}".strip()
        if cur:
            chunks.append(cur.strip())
    return chunks


class Corpus:
    def __init__(self, text: str, embed_model: str = EMBED_MODEL, embedder=None):
        self.embedder = embedder or SentenceTransformer(embed_model, device=DEVICE)
        self.chunks = chunk_text(text)
        self.emb = self.embedder.encode(
            self.chunks, normalize_embeddings=True, convert_to_numpy=True
        )

    def retrieve(self, query: str, k: int = 4):
        q = self.embedder.encode(
            [query], normalize_embeddings=True, convert_to_numpy=True
        )[0]
        sims = self.emb @ q
        idx = np.argsort(-sims)[:k]
        return [(self.chunks[i], float(sims[i])) for i in idx]
