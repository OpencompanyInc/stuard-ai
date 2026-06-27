"""
Suite A: Segment Recall harness.

Pipeline:
  1. Instantiate MemoryDB on a temp SQLite path.
  2. For each fixture conversation: create conversation row, create segments
     (planted + distractors) with embedded summaries.
  3. For each planted fact query: embed query, call search_segments,
     record rank of the ground-truth segment and per-query latency.
  4. Aggregate Recall@1, Recall@5, Recall@10, MRR, P50/P95 latency.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from dataclasses import dataclass
from typing import List, Optional

# Make the agent's `app` package importable whether run via `python -m` or directly.
_AGENT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _AGENT_ROOT not in sys.path:
    sys.path.insert(0, _AGENT_ROOT)

from app.storage.memory_db import MemoryDB  # noqa: E402

from .fixtures import FIXTURES, FixtureConversation  # noqa: E402
from .embed import embed_batch, embed_one  # noqa: E402


# ═══════════════════════════════════════════════════════════════════════════════
# TYPES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class QueryResult:
    fact_id: str
    query: str
    expected_segment_id: str
    rank: Optional[int]          # 1-indexed rank of expected segment, None if not in top-K
    top_score: float
    retrieved_score: Optional[float]
    latency_ms: float


@dataclass
class SuiteReport:
    num_conversations: int
    num_segments_total: int
    num_planted_segments: int
    num_queries: int
    recall_at_1: float
    recall_at_5: float
    recall_at_10: float
    mrr: float
    latency_p50_ms: float
    latency_p95_ms: float
    latency_mean_ms: float
    ingest_seconds: float
    query_seconds: float
    results: List[QueryResult]


# ═══════════════════════════════════════════════════════════════════════════════
# INGEST
# ═══════════════════════════════════════════════════════════════════════════════

def ingest(db: MemoryDB, fixtures: List[FixtureConversation]) -> dict:
    """Create conversations + segments. Returns {fact_id -> segment_id} map."""
    fact_to_segment: dict[str, str] = {}

    # Collect all segment summaries for batched embedding (cheaper + faster).
    all_texts: list[str] = []
    keys: list[tuple[str, Optional[str]]] = []  # (conv_id, fact_id or None for distractor)

    for conv_fix in fixtures:
        for pf in conv_fix.planted:
            all_texts.append(pf.summary)
            keys.append((conv_fix.conv_id, pf.fact_id))
        for i, dist in enumerate(conv_fix.distractors):
            all_texts.append(dist.summary)
            keys.append((conv_fix.conv_id, None))

    vectors, _ = embed_batch(all_texts)
    assert len(vectors) == len(all_texts)

    # Now create conversations + segments.
    idx = 0
    for conv_fix in fixtures:
        db.create_conversation(
            title=conv_fix.title,
            model="benchmark",
            conversation_id=conv_fix.conv_id,
        )
        turn_cursor = 0
        for pf in conv_fix.planted:
            vec = vectors[idx]
            idx += 1
            seg = db.create_segment(
                conversation_id=conv_fix.conv_id,
                start_turn=turn_cursor,
                summary=pf.summary,
                topics=pf.topics,
                embedding=vec,
                end_turn=turn_cursor + 1,
            )
            fact_to_segment[pf.fact_id] = seg.id
            turn_cursor += 2
        for dist in conv_fix.distractors:
            vec = vectors[idx]
            idx += 1
            db.create_segment(
                conversation_id=conv_fix.conv_id,
                start_turn=turn_cursor,
                summary=dist.summary,
                topics=dist.topics,
                embedding=vec,
                end_turn=turn_cursor + 1,
            )
            turn_cursor += 2

    return fact_to_segment


# ═══════════════════════════════════════════════════════════════════════════════
# QUERY
# ═══════════════════════════════════════════════════════════════════════════════

def run_queries(
    db: MemoryDB,
    fixtures: List[FixtureConversation],
    fact_to_segment: dict,
    top_k: int = 10,
) -> List[QueryResult]:
    results: List[QueryResult] = []
    # Threshold 0.0 so we get full ranking even for low-similarity matches.
    # Production uses 0.6, but for recall measurement we want the raw ranking.
    for conv_fix in fixtures:
        for pf in conv_fix.planted:
            expected_seg_id = fact_to_segment[pf.fact_id]
            for query in pf.queries:
                # Embed query (measured separately; retrieval latency is db call).
                q_vec, _ = embed_one(query)

                start = time.perf_counter()
                hits = db.search_segments(query_vector=q_vec, limit=top_k, threshold=0.0)
                latency_ms = (time.perf_counter() - start) * 1000

                rank: Optional[int] = None
                retrieved_score: Optional[float] = None
                top_score = hits[0][1] if hits else 0.0
                for idx, (seg, seg_score) in enumerate(hits, start=1):
                    if seg.id == expected_seg_id:
                        rank = idx
                        retrieved_score = float(seg_score)
                        break

                results.append(
                    QueryResult(
                        fact_id=pf.fact_id,
                        query=query,
                        expected_segment_id=expected_seg_id,
                        rank=rank,
                        top_score=float(top_score),
                        retrieved_score=retrieved_score,
                        latency_ms=latency_ms,
                    )
                )
    return results


# ═══════════════════════════════════════════════════════════════════════════════
# SCORING
# ═══════════════════════════════════════════════════════════════════════════════

def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    vs = sorted(values)
    k = (len(vs) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(vs) - 1)
    if f == c:
        return vs[f]
    return vs[f] + (vs[c] - vs[f]) * (k - f)


def score(results: List[QueryResult], num_conversations: int, num_segments: int, num_planted: int,
          ingest_s: float, query_s: float) -> SuiteReport:
    n = len(results)
    if n == 0:
        raise RuntimeError("no query results to score")

    r1 = sum(1 for r in results if r.rank is not None and r.rank <= 1) / n
    r5 = sum(1 for r in results if r.rank is not None and r.rank <= 5) / n
    r10 = sum(1 for r in results if r.rank is not None and r.rank <= 10) / n
    mrr = sum((1.0 / r.rank) if r.rank else 0.0 for r in results) / n

    lats = [r.latency_ms for r in results]
    return SuiteReport(
        num_conversations=num_conversations,
        num_segments_total=num_segments,
        num_planted_segments=num_planted,
        num_queries=n,
        recall_at_1=r1,
        recall_at_5=r5,
        recall_at_10=r10,
        mrr=mrr,
        latency_p50_ms=_percentile(lats, 50),
        latency_p95_ms=_percentile(lats, 95),
        latency_mean_ms=sum(lats) / n,
        ingest_seconds=ingest_s,
        query_seconds=query_s,
        results=results,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════════════════════════════════════

def run_suite_a(db_path: Optional[str] = None) -> SuiteReport:
    """Execute Suite A end-to-end."""
    from .fixtures import total_planted_facts, total_segments

    created_temp = False
    if db_path is None:
        tmp = tempfile.NamedTemporaryFile(prefix="stuard_bench_", suffix=".db", delete=False)
        tmp.close()
        db_path = tmp.name
        created_temp = True

    db = MemoryDB(db_path=db_path, user_password="bench-test-password")

    try:
        t0 = time.perf_counter()
        fact_to_segment = ingest(db, FIXTURES)
        ingest_s = time.perf_counter() - t0

        t1 = time.perf_counter()
        results = run_queries(db, FIXTURES, fact_to_segment, top_k=10)
        query_s = time.perf_counter() - t1

        return score(
            results,
            num_conversations=len(FIXTURES),
            num_segments=total_segments(),
            num_planted=total_planted_facts(),
            ingest_s=ingest_s,
            query_s=query_s,
        )
    finally:
        if created_temp:
            try:
                os.unlink(db_path)
            except OSError:
                pass


# ═══════════════════════════════════════════════════════════════════════════════
# REPORTING
# ═══════════════════════════════════════════════════════════════════════════════

def format_report(report: SuiteReport, verbose: bool = False) -> str:
    lines = [
        "+----------------------------------------------------------------------+",
        "|  StuardAI Memory Bench -- Suite A: Segment Recall                    |",
        "+----------------------------------------------------------------------+",
        "",
        "Corpus:",
        f"  conversations           : {report.num_conversations}",
        f"  total segments in DB    : {report.num_segments_total}",
        f"  planted (queryable)     : {report.num_planted_segments}",
        f"  eval queries run        : {report.num_queries}",
        "",
        "Retrieval quality (segment ID in top-K):",
        f"  Recall@1                : {report.recall_at_1:.3f}",
        f"  Recall@5                : {report.recall_at_5:.3f}",
        f"  Recall@10               : {report.recall_at_10:.3f}",
        f"  MRR                     : {report.mrr:.3f}",
        "",
        "Latency (search_segments DB call, excludes query embedding):",
        f"  mean                    : {report.latency_mean_ms:.2f} ms",
        f"  P50                     : {report.latency_p50_ms:.2f} ms",
        f"  P95                     : {report.latency_p95_ms:.2f} ms",
        "",
        "Totals:",
        f"  ingest wall time        : {report.ingest_seconds:.2f} s",
        f"  query wall time         : {report.query_seconds:.2f} s",
        "",
        "Scorecard (Stuard MemScore analog):",
        f"  {report.recall_at_5 * 100:.0f}% R@5 / {report.latency_p50_ms:.0f}ms P50 / {report.num_segments_total} segs",
        "",
    ]
    if verbose:
        lines.append("Per-query detail:")
        for r in report.results:
            rank_str = str(r.rank) if r.rank is not None else "MISS"
            score_str = f"{r.retrieved_score:.3f}" if r.retrieved_score is not None else "n/a"
            lines.append(
                f"  [{rank_str:>4}] {r.fact_id:<25} score={score_str:<6} {r.latency_ms:>6.1f}ms  {r.query!r}"
            )
    return "\n".join(lines)
