"""Train a per-persona LoRA via context distillation, then save the adapter.

    python train_lora.py --dataset bench/datasets/sample.json --out adapters/brewline

The adapter carries the corpus facts in WEIGHTS, so at inference the prompt is
just the user's question -- zero context tokens. This is the "mini layer you
plug into the model" from the original brief.
"""

import argparse
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import torch
from peft import LoraConfig, get_peft_model

from persona.model import LM
from persona.system import PersonaLayer, SYSTEM_BASE
from persona.distill import build_examples


def tokenize_example(tok, question, answer, max_len=384):
    prompt = tok.apply_chat_template(
        [
            {"role": "system", "content": SYSTEM_BASE},
            {"role": "user", "content": question},
        ],
        tokenize=False,
        add_generation_prompt=True,
    )
    full = prompt + answer + tok.eos_token
    prompt_ids = tok(prompt, add_special_tokens=False)["input_ids"]
    full_ids = tok(full, add_special_tokens=False)["input_ids"][:max_len]
    labels = list(full_ids)
    for i in range(min(len(prompt_ids), len(labels))):
        labels[i] = -100  # train only on the answer tokens
    return full_ids, labels


def collate(batch, pad_id):
    maxlen = max(len(f) for f, _ in batch)
    input_ids, labels, attn = [], [], []
    for fids, labs in batch:
        pad = maxlen - len(fids)
        input_ids.append(fids + [pad_id] * pad)
        labels.append(labs + [-100] * pad)
        attn.append([1] * len(fids) + [0] * pad)
    return (
        torch.tensor(input_ids),
        torch.tensor(labels),
        torch.tensor(attn),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="bench/datasets/sample.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=24)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--k_per_chunk", type=int, default=6)
    ap.add_argument("--batch_size", type=int, default=2)
    args = ap.parse_args()

    with open(args.dataset, encoding="utf-8") as f:
        data = json.load(f)

    lm = LM()
    tok = lm.tok
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token

    # Teacher = RAG pipeline (corpus in context).
    print("building distillation data (teacher = RAG)...")
    persona = PersonaLayer(lm)
    persona.fit(corpus_text=data["corpus"])
    examples = build_examples(lm, persona, k_per_chunk=args.k_per_chunk)
    print(f"  {len(examples)} training examples")

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "train_data.json"), "w", encoding="utf-8") as f:
        json.dump(examples, f, indent=2, ensure_ascii=False)

    tokenized = [tokenize_example(tok, e["question"], e["answer"]) for e in examples]

    lora = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank * 2,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
    )
    model = get_peft_model(lm.model, lora)
    model.print_trainable_parameters()
    model.config.use_cache = False
    model.train()

    trainable = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(trainable, lr=args.lr)
    pad_id = tok.pad_token_id
    device = lm.model.device

    for epoch in range(args.epochs):
        random.shuffle(tokenized)
        total, nb = 0.0, 0
        for i in range(0, len(tokenized), args.batch_size):
            input_ids, labels, attn = collate(tokenized[i : i + args.batch_size], pad_id)
            out = model(
                input_ids=input_ids.to(device),
                attention_mask=attn.to(device),
                labels=labels.to(device),
            )
            out.loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            opt.step()
            opt.zero_grad()
            total += out.loss.item()
            nb += 1
        print(f"epoch {epoch + 1:>3}/{args.epochs}   loss {total / max(nb, 1):.4f}")

    model.save_pretrained(args.out)
    print("saved adapter ->", args.out)


if __name__ == "__main__":
    main()
