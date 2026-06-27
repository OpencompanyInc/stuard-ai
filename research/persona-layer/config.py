"""Central config for the persona-layer prototype.

Overridable by env var so you can try models without editing code:

    PERSONA_MODEL        HF id of the generation model (default: Qwen2.5-1.5B-Instruct)
    PERSONA_DEVICE_MAP   set to "auto" to spill big models across GPU+CPU
    PERSONA_EMBED_MODEL  sentence-transformers id

Defaults use small, NON-GATED models so the project runs with zero setup.
The facts/tone techniques are architecture-agnostic across HF causal LMs.

Quantization note: we do NOT use bitsandbytes or torchao here. Both pull in
Triton, which cannot build its CUDA driver on the free-threaded CPython 3.13t
build on this machine (no C-compiler / limited-API support). To run a model too
big for 8GB VRAM, use PERSONA_DEVICE_MAP=auto (CPU offload) -- slower, but it
keeps the HF forward hooks the tone channel relies on. For a fast GPU 4-bit
path, use a standard (GIL) Python env where bitsandbytes works.
"""

import os

import torch

# fast iteration : "Qwen/Qwen2.5-0.5B-Instruct"
# default        : "Qwen/Qwen2.5-1.5B-Instruct"  (~3GB fp16, fits 8GB VRAM)
# fits GPU fully : "Qwen/Qwen2.5-3B-Instruct"     (~6GB fp16)
# bigger         : "Qwen/Qwen3.5-4B"  + PERSONA_DEVICE_MAP=auto  (offloads to CPU)
GEN_MODEL = os.environ.get("PERSONA_MODEL", "Qwen/Qwen2.5-1.5B-Instruct")

EMBED_MODEL = os.environ.get(
    "PERSONA_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
)

DEVICE_MAP = os.environ.get("PERSONA_DEVICE_MAP") or None

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# bf16 on GPU: numerically stable for LoRA training (no grad scaler needed) and
# fine for inference; fp32 on CPU.
DTYPE = torch.bfloat16 if DEVICE == "cuda" else torch.float32
