"""
Gemini embedding wrapper — matches production.

The cloud-ai layer (apps/cloud-ai/src/memory/conversations.ts:95) uses
`gemini-embedding-2-preview`. The agent-side MemoryDB expects 3072-dim
vectors (VECTOR_DIM=3072). This wrapper uses `gemini-embedding-001` (the
stable equivalent) with output_dimensionality=3072 to match both.

Reads GEMINI_API_KEY or GOOGLE_API_KEY (same fallback order as
apps/agent/app/tools/media.py).
"""
from __future__ import annotations

import os
import time
from typing import List, Tuple

try:
    from google import genai
    from google.genai import types
except ImportError as e:
    raise RuntimeError(
        "google-genai not installed. Run: .venv/Scripts/pip install google-genai"
    ) from e


EMBEDDING_MODEL = "gemini-embedding-2-preview"  # matches apps/cloud-ai/src/memory/conversations.ts:95
OUTPUT_DIM = 3072  # matches MemoryDB.VECTOR_DIM

_client: "genai.Client | None" = None


def _get_client() -> "genai.Client":
    global _client
    if _client is None:
        api_key = (
            os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GOOGLE_API_KEY")
            or os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY")
        )
        if not api_key:
            raise RuntimeError(
                "No Gemini API key found. Set one of: "
                "GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY"
            )
        _client = genai.Client(api_key=api_key)
    return _client


def embed_batch(texts: List[str]) -> Tuple[List[List[float]], float]:
    """
    Embed a list of texts via Gemini.

    Calls embed_content per text (serialized) to keep the SDK contract simple
    and to make latency per-item measurable. For the fixture corpus (~15
    segments + ~45 queries) this is fine; for larger corpora, switch to true
    batch calls with proper type handling.

    Returns (vectors, wall_seconds).
    """
    client = _get_client()
    config = types.EmbedContentConfig(output_dimensionality=OUTPUT_DIM)

    all_vectors: list[list[float]] = []
    start = time.perf_counter()
    for text in texts:
        resp = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text,
            config=config,
        )
        embeddings = resp.embeddings or []
        if not embeddings:
            raise RuntimeError(f"Gemini returned no embedding for text: {text[:80]!r}")
        values = list(embeddings[0].values or [])
        if len(values) != OUTPUT_DIM:
            raise RuntimeError(
                f"unexpected embedding dim: {len(values)} (expected {OUTPUT_DIM})"
            )
        all_vectors.append(values)
    elapsed = time.perf_counter() - start
    return all_vectors, elapsed


def embed_one(text: str) -> Tuple[List[float], float]:
    vectors, elapsed = embed_batch([text])
    return vectors[0], elapsed
