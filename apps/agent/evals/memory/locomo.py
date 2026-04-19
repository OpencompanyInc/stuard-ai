"""
LoCoMo benchmark runner for StuardAI's MemoryDB.

Mirrors the MemoryBench pipeline (INGEST -> INDEX -> SEARCH -> ANSWER -> JUDGE):
  1. For each LoCoMo sample, create a conversation and ingest each session
     as a segment (summary = concatenated session dialogue, embedded via
     gemini-embedding-2-preview at 3072 dim — matches cloud-ai production).
  2. For each QA pair: embed the question, retrieve top-K segments from
     MemoryDB, build context, ask Gemini 2.0 Flash for an answer.
  3. LLM-judge predicted vs ground-truth answer (Gemini 2.0 Flash).
  4. Report overall accuracy, by-category accuracy, retrieval evidence hit
     rate, and latency — comparable to Supermemory / Mem0 / Zep MemoryBench
     numbers on LoCoMo.

Dataset: data/locomo10.json (10 conversations, 272 sessions, 1986 QA pairs).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Tuple

# Put the agent's `app` package on the path.
_AGENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _AGENT_ROOT not in sys.path:
    sys.path.insert(0, _AGENT_ROOT)

from app.storage.memory_db import MemoryDB  # noqa: E402

from .embed import _get_client, embed_batch, embed_one, EMBEDDING_MODEL  # noqa: E402

try:
    from google.genai import types
except ImportError as e:
    raise RuntimeError("google-genai not installed") from e


# ═══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

ANSWER_MODEL = "gemini-2.5-flash"
JUDGE_MODEL = "gemini-2.5-flash"
TOP_K = 10
DATASET_PATH = os.path.join(os.path.dirname(__file__), "data", "locomo10.json")

# LoCoMo category names (inferred from paper / Supermemory methodology)
CATEGORY_NAMES = {
    1: "single-hop",
    2: "multi-hop",
    3: "temporal",
    4: "open-domain",
    5: "adversarial",
}


# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class QAResult:
    sample_id: str
    category: int
    question: str
    ground_truth: str
    predicted: str
    correct: bool
    retrieval_hit: bool          # true if any evidence session was in top-K retrieval
    retrieval_rank: Optional[int]  # rank of first evidence session hit, None if miss
    embed_latency_ms: float
    search_latency_ms: float
    answer_latency_ms: float
    judge_latency_ms: float


@dataclass
class LocomoReport:
    samples_run: int
    sessions_ingested: int
    qa_total: int
    accuracy_overall: float
    accuracy_by_category: dict
    retrieval_hit_rate: float
    ingest_seconds: float
    query_seconds: float
    search_latency_p50_ms: float
    search_latency_p95_ms: float
    answer_latency_p50_ms: float
    embedding_model: str
    answer_model: str
    judge_model: str
    top_k: int
    results: List[QAResult] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════════════
# DATASET
# ═══════════════════════════════════════════════════════════════════════════════

def load_dataset(path: str = DATASET_PATH) -> list:
    if not os.path.exists(path):
        raise FileNotFoundError(f"LoCoMo dataset not found at {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def session_keys(conv: dict) -> List[str]:
    """Return session_N keys sorted by N."""
    keys = [k for k in conv.keys() if re.fullmatch(r"session_\d+", k)]
    keys.sort(key=lambda k: int(k.split("_")[1]))
    return keys


def format_session_text(turns: List[dict], date_time: str = "") -> str:
    """Flatten a session's turns into a single text blob for embedding+context.

    Prepends the session timestamp so the model can resolve relative refs
    ("yesterday", "last week") to absolute dates — required for LoCoMo's
    temporal QA category.
    """
    lines = []
    if date_time:
        lines.append(f"[Session date: {date_time}]")
    for t in turns:
        speaker = t.get("speaker", "")
        text = t.get("text", "")
        dia_id = t.get("dia_id", "")
        lines.append(f"[{dia_id}] {speaker}: {text}")
    return "\n".join(lines)


def evidence_session_nums(evidence: List[str]) -> set:
    """Parse evidence dia_ids like 'D1:3' -> session number {1}."""
    nums = set()
    for eid in evidence or []:
        m = re.match(r"D(\d+):", str(eid))
        if m:
            nums.add(int(m.group(1)))
    return nums


# ═══════════════════════════════════════════════════════════════════════════════
# GEMINI CHAT (answer + judge)
# ═══════════════════════════════════════════════════════════════════════════════

def gemini_chat(prompt: str, model: str = ANSWER_MODEL, max_tokens: int = 256) -> Tuple[str, float]:
    """Call Gemini for a chat completion. Returns (text, latency_seconds).

    Disables thinking on 2.5 models — otherwise reasoning tokens silently
    consume the max_output_tokens budget and the visible text is truncated
    or empty.
    """
    client = _get_client()
    start = time.perf_counter()
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.0,
            max_output_tokens=max_tokens,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    elapsed = time.perf_counter() - start
    text = (resp.text or "").strip()
    return text, elapsed


def answer_from_context(question: str, context: str) -> Tuple[str, float]:
    prompt = f"""You are answering questions about a long-running conversation between two people.

Each excerpt begins with a [Session date: ...] header. When the user references "yesterday", "last week", "two days ago", etc., resolve those references against the session date and report an absolute date (e.g., "7 May 2023"), not a relative one.

Use ONLY the conversation excerpts below. If the answer is genuinely not present, say exactly: "No information available."

Conversation excerpts:
---
{context}
---

Question: {question}

Answer concisely (one short phrase or sentence — no preamble, no explanation). Include specific dates, names, or numbers from the excerpts when the question asks for them. Prefer the most specific answer supported by the excerpts.

Answer:"""
    return gemini_chat(prompt, model=ANSWER_MODEL, max_tokens=200)


def judge_answer(question: str, predicted: str, ground_truth: str) -> Tuple[bool, float]:
    """LLM-as-judge: is `predicted` semantically equivalent to `ground_truth`?"""
    prompt = f"""You are grading a question-answering system.

Question: {question}
Ground-truth answer: {ground_truth}
System's predicted answer: {predicted}

Is the predicted answer semantically equivalent to the ground-truth answer? Accept paraphrases, equivalent dates in different formats (e.g. "May 7" = "7 May 2023"), and extra helpful context. Reject answers that contradict the ground truth, hallucinate new facts, or say "no information available" when the ground truth has a specific answer.

Respond with exactly one word: YES or NO."""
    text, elapsed = gemini_chat(prompt, model=JUDGE_MODEL, max_tokens=8)
    verdict = text.strip().upper().startswith("YES")
    return verdict, elapsed


# ═══════════════════════════════════════════════════════════════════════════════
# INGEST
# ═══════════════════════════════════════════════════════════════════════════════

def ingest_sample(db: MemoryDB, sample: dict) -> Tuple[str, dict, int]:
    """
    Ingest one LoCoMo sample. Returns:
      (conversation_id, {session_num -> segment_id}, num_sessions)
    """
    sample_id = sample["sample_id"]
    conv = sample["conversation"]
    db.create_conversation(
        title=sample_id,
        model="locomo-bench",
        conversation_id=sample_id,
    )

    skeys = session_keys(conv)
    # Build session texts (segment summaries).
    session_texts: List[str] = []
    session_nums: List[int] = []
    for k in skeys:
        turns = conv[k]
        if not isinstance(turns, list) or not turns:
            continue
        date_time = conv.get(f"{k}_date_time", "")
        text = format_session_text(turns, date_time=date_time)
        # Gemini embedding has input limits; truncate very long sessions.
        session_texts.append(text[:6000])
        session_nums.append(int(k.split("_")[1]))

    # Batch-embed all sessions.
    vectors, _ = embed_batch(session_texts)

    seg_map: dict[int, str] = {}
    for session_num, text, vec in zip(session_nums, session_texts, vectors):
        seg = db.create_segment(
            conversation_id=sample_id,
            start_turn=session_num * 1000,
            end_turn=session_num * 1000 + 1,
            summary=text,
            topics=[f"session_{session_num}"],
            embedding=vec,
        )
        seg_map[session_num] = seg.id
    return sample_id, seg_map, len(seg_map)


# ═══════════════════════════════════════════════════════════════════════════════
# RETRIEVE + ANSWER + JUDGE
# ═══════════════════════════════════════════════════════════════════════════════

def _segment_session_num(seg) -> Optional[int]:
    """Extract session_N from the topics list."""
    for t in (seg.topics or []):
        m = re.fullmatch(r"session_(\d+)", t)
        if m:
            return int(m.group(1))
    return None


def answer_qa(db: MemoryDB, sample_id: str, qa: dict) -> QAResult:
    q_vec, embed_s = embed_one(qa["question"])

    start = time.perf_counter()
    hits = db.search_segments(query_vector=q_vec, limit=TOP_K, threshold=0.0)
    search_ms = (time.perf_counter() - start) * 1000

    # Filter to this sample only (MemoryDB is shared across samples in a run).
    hits = [(s, score) for s, score in hits if s.conversation_id == sample_id]

    # Evidence hit: did any evidence session appear in retrieved top-K?
    evid_sessions = evidence_session_nums(qa.get("evidence", []))
    retrieval_hit = False
    retrieval_rank: Optional[int] = None
    for rank, (seg, _score) in enumerate(hits, start=1):
        sn = _segment_session_num(seg)
        if sn is not None and sn in evid_sessions:
            retrieval_hit = True
            retrieval_rank = rank
            break

    # Build context from top-10 hits. Gemini Flash has plenty of context room;
    # using more excerpts lets multi-hop questions find evidence across sessions.
    context_segments = []
    for seg, _ in hits[:10]:
        context_segments.append(seg.summary[:2500])
    context = "\n\n---\n\n".join(context_segments)

    predicted, answer_s = answer_from_context(qa["question"], context)
    correct, judge_s = judge_answer(qa["question"], predicted, str(qa.get("answer", "")))

    return QAResult(
        sample_id=sample_id,
        category=int(qa.get("category", 0)),
        question=qa["question"],
        ground_truth=str(qa.get("answer", "")),
        predicted=predicted,
        correct=correct,
        retrieval_hit=retrieval_hit,
        retrieval_rank=retrieval_rank,
        embed_latency_ms=embed_s * 1000,
        search_latency_ms=search_ms,
        answer_latency_ms=answer_s * 1000,
        judge_latency_ms=judge_s * 1000,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# SCORE
# ═══════════════════════════════════════════════════════════════════════════════

def _percentile(values: list, p: float) -> float:
    if not values:
        return 0.0
    vs = sorted(values)
    k = (len(vs) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(vs) - 1)
    if f == c:
        return vs[f]
    return vs[f] + (vs[c] - vs[f]) * (k - f)


def summarize(results: List[QAResult], samples_run: int, sessions_ingested: int,
              ingest_s: float, query_s: float) -> LocomoReport:
    n = len(results)
    if n == 0:
        raise RuntimeError("no QA results")
    acc = sum(1 for r in results if r.correct) / n
    hit = sum(1 for r in results if r.retrieval_hit) / n

    by_cat: dict = defaultdict(lambda: {"n": 0, "correct": 0})
    for r in results:
        by_cat[r.category]["n"] += 1
        if r.correct:
            by_cat[r.category]["correct"] += 1
    acc_by_cat = {
        CATEGORY_NAMES.get(c, f"cat_{c}"): {
            "accuracy": d["correct"] / d["n"] if d["n"] else 0.0,
            "n": d["n"],
        }
        for c, d in sorted(by_cat.items())
    }

    search_lats = [r.search_latency_ms for r in results]
    answer_lats = [r.answer_latency_ms for r in results]

    return LocomoReport(
        samples_run=samples_run,
        sessions_ingested=sessions_ingested,
        qa_total=n,
        accuracy_overall=acc,
        accuracy_by_category=acc_by_cat,
        retrieval_hit_rate=hit,
        ingest_seconds=ingest_s,
        query_seconds=query_s,
        search_latency_p50_ms=_percentile(search_lats, 50),
        search_latency_p95_ms=_percentile(search_lats, 95),
        answer_latency_p50_ms=_percentile(answer_lats, 50),
        embedding_model=EMBEDDING_MODEL,
        answer_model=ANSWER_MODEL,
        judge_model=JUDGE_MODEL,
        top_k=TOP_K,
        results=results,
    )


def format_report(r: LocomoReport, verbose: bool = False) -> str:
    lines = [
        "+----------------------------------------------------------------------+",
        "|  StuardAI Memory Bench -- LoCoMo                                     |",
        "+----------------------------------------------------------------------+",
        "",
        "Setup:",
        f"  embedding model         : {r.embedding_model}",
        f"  answer model            : {r.answer_model}",
        f"  judge model             : {r.judge_model}",
        f"  top-K retrieval         : {r.top_k}",
        "",
        "Corpus:",
        f"  LoCoMo samples run      : {r.samples_run}/10",
        f"  sessions ingested       : {r.sessions_ingested}",
        f"  QA pairs evaluated      : {r.qa_total}",
        "",
        "*** Accuracy (LLM-judged, comparable to MemoryBench MemScore) ***",
        f"  OVERALL                 : {r.accuracy_overall * 100:.1f}%",
    ]
    for cat, d in r.accuracy_by_category.items():
        lines.append(f"  {cat:<24}: {d['accuracy'] * 100:5.1f}%  (n={d['n']})")
    lines.extend([
        "",
        "Retrieval:",
        f"  evidence session in top-{r.top_k}: {r.retrieval_hit_rate * 100:.1f}%",
        "",
        "Latency:",
        f"  search_segments P50     : {r.search_latency_p50_ms:.1f} ms",
        f"  search_segments P95     : {r.search_latency_p95_ms:.1f} ms",
        f"  answer gen P50          : {r.answer_latency_p50_ms:.0f} ms",
        "",
        "Totals:",
        f"  ingest wall time        : {r.ingest_seconds:.1f} s",
        f"  query wall time         : {r.query_seconds:.1f} s",
        "",
        "For comparison (Supermemory published LoCoMo numbers, full dataset):",
        "  Supermemory ~86%  |  Mem0 ~70%  |  Zep ~65%  (LLM-judged accuracy)",
        "",
    ])
    if verbose:
        lines.append("Per-QA detail:")
        for i, qr in enumerate(r.results, start=1):
            mark = "OK  " if qr.correct else "FAIL"
            hit = "hit" if qr.retrieval_hit else "MISS"
            lines.append(
                f"  [{i:3}] {mark} cat={qr.category} retr={hit:4}  Q: {qr.question[:70]!r}"
            )
            lines.append(f"         GT: {qr.ground_truth[:100]!r}")
            lines.append(f"         PR: {qr.predicted[:100]!r}")
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════════════════════════════════════

def run_locomo(samples: int = 1, qa_per_sample: Optional[int] = 50,
               sample_offset: int = 0, db_path: Optional[str] = None) -> LocomoReport:
    dataset = load_dataset()
    if sample_offset >= len(dataset):
        raise ValueError(f"sample_offset {sample_offset} >= dataset size {len(dataset)}")
    selected = dataset[sample_offset : sample_offset + samples]

    created_temp = False
    if db_path is None:
        tmp = tempfile.NamedTemporaryFile(prefix="stuard_locomo_", suffix=".db", delete=False)
        tmp.close()
        db_path = tmp.name
        created_temp = True

    db = MemoryDB(db_path=db_path, user_password="locomo-bench")

    sessions_total = 0
    all_results: list[QAResult] = []

    t0 = time.perf_counter()
    for sample in selected:
        _, _, n_sessions = ingest_sample(db, sample)
        sessions_total += n_sessions
    ingest_s = time.perf_counter() - t0

    t1 = time.perf_counter()
    total_qa_expected = sum(min(len(s.get("qa", [])), qa_per_sample or 10**9) for s in selected)
    done = 0
    for sample in selected:
        sample_id = sample["sample_id"]
        qa_list = sample.get("qa", [])
        if qa_per_sample is not None:
            qa_list = qa_list[:qa_per_sample]
        for qa in qa_list:
            try:
                result = answer_qa(db, sample_id, qa)
            except Exception as e:
                print(f"[warn] QA failed ({sample_id}): {e}", file=sys.stderr, flush=True)
                continue
            all_results.append(result)
            done += 1
            if done % 10 == 0 or done == total_qa_expected:
                print(f"  ... {done}/{total_qa_expected} QA  "
                      f"(running acc: {sum(1 for x in all_results if x.correct) / len(all_results) * 100:.1f}%)",
                      file=sys.stderr, flush=True)
    query_s = time.perf_counter() - t1

    try:
        return summarize(all_results, samples_run=len(selected),
                         sessions_ingested=sessions_total,
                         ingest_s=ingest_s, query_s=query_s)
    finally:
        if created_temp:
            try:
                os.unlink(db_path)
            except OSError:
                pass


def main() -> int:
    p = argparse.ArgumentParser(description="Run LoCoMo benchmark against StuardAI MemoryDB")
    p.add_argument("--samples", type=int, default=1, help="number of LoCoMo samples (1-10, default 1)")
    p.add_argument("--qa", type=int, default=50, help="max QA pairs per sample (default 50, use 0 for all)")
    p.add_argument("--offset", type=int, default=0, help="skip this many samples (for running different subsets)")
    p.add_argument("--verbose", "-v", action="store_true", help="print per-QA detail")
    p.add_argument("--json", action="store_true", help="output JSON")
    args = p.parse_args()

    qa_per_sample = None if args.qa == 0 else args.qa
    try:
        report = run_locomo(samples=args.samples, qa_per_sample=qa_per_sample, sample_offset=args.offset)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        import traceback; traceback.print_exc()
        return 2

    if args.json:
        print(json.dumps(asdict(report), indent=2, default=str))
    else:
        print(format_report(report, verbose=args.verbose))
    return 0


if __name__ == "__main__":
    sys.exit(main())
