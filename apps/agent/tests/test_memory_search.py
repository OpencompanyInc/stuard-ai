import collections
import os
import sqlite3

import pytest
import keyring


@pytest.fixture(autouse=True)
def _mock_keyring(monkeypatch: pytest.MonkeyPatch):
    store = {}

    def get_password(service: str, account: str):
        return store.get((service, account))

    def set_password(service: str, account: str, password: str):
        store[(service, account)] = password

    def delete_password(service: str, account: str):
        store.pop((service, account), None)

    monkeypatch.setattr(keyring, "get_password", get_password)
    monkeypatch.setattr(keyring, "set_password", set_password)
    monkeypatch.setattr(keyring, "delete_password", delete_password)
    monkeypatch.setattr(keyring, "get_keyring", lambda: object())

    from app.storage import crypto as crypto_mod

    crypto_mod._crypto_manager = None


def test_segment_vector_search_roundtrip(tmp_path):
    from app.storage.memory_db import MemoryDB

    db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
    conv = db.create_conversation(title="t", model="m")

    emb = [0.1, 0.2, 0.3]
    db.create_segment(
        conversation_id=conv.id,
        start_turn=0,
        summary="s",
        topics=["airport"],
        embedding=emb,
        end_turn=1,
    )

    results = db.search_segments(query_vector=emb, limit=5, threshold=0.99)
    assert len(results) == 1

    seg, score = results[0]
    assert seg.conversation_id == conv.id
    assert score > 0.99


def test_segment_vector_search_skips_dimension_mismatch(tmp_path):
    from app.storage.memory_db import MemoryDB

    db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
    conv = db.create_conversation(title="t", model="m")

    emb_ok = [0.1, 0.2, 0.3]
    emb_bad = [0.1, 0.2, 0.3, 0.4]

    db.create_segment(
        conversation_id=conv.id,
        start_turn=0,
        summary="s1",
        topics=["ok"],
        embedding=emb_ok,
        end_turn=1,
    )
    db.create_segment(
        conversation_id=conv.id,
        start_turn=2,
        summary="s2",
        topics=["bad"],
        embedding=emb_bad,
        end_turn=3,
    )

    results = db.search_segments(query_vector=emb_ok, limit=5, threshold=0.99)
    assert len(results) == 1

    seg, score = results[0]
    assert seg.summary == "s1"
    assert score > 0.99


def test_segment_search_is_scoped_by_conversation_owner(tmp_path):
    from app.storage.memory_db import MemoryDB

    db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
    main = db.create_conversation(title="main", model="m")
    bot = db.create_conversation(title="bot", model="m", source="proactive", owner_type="bot", owner_id="bot-1")

    emb = [0.1, 0.2, 0.3]
    db.create_segment(main.id, 0, "main memory", ["main"], embedding=emb, end_turn=1)
    db.create_segment(bot.id, 0, "bot memory", ["bot"], embedding=emb, end_turn=1)

    main_results = db.search_segments(query_vector=emb, limit=5, threshold=0.99)
    assert [seg.summary for seg, _ in main_results] == ["main memory"]

    bot_results = db.search_segments(
        query_vector=emb,
        limit=5,
        threshold=0.99,
        owner_type="bot",
        owner_id="bot-1",
    )
    assert [seg.summary for seg, _ in bot_results] == ["bot memory"]


def test_topic_drawers_are_scoped_by_conversation_owner(tmp_path):
    from app.storage.memory_db import MemoryDB

    db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
    main = db.create_conversation(title="main", model="m")
    bot = db.create_conversation(title="bot", model="m", source="proactive", owner_type="bot", owner_id="bot-1")

    emb = [0.1, 0.2, 0.3]
    db.create_segment(main.id, 0, "main ferrari note", ["Ferrari"], embedding=emb, end_turn=1)
    db.create_segment(bot.id, 0, "bot ev note", ["Electric Vehicles"], embedding=emb, end_turn=1)

    main_topics = [d["topic"] for d in db.build_topic_drawers()]
    bot_topics = [
        d["topic"]
        for d in db.build_topic_drawers(owner_type="bot", owner_id="bot-1")
    ]

    assert main_topics == ["Ferrari"]
    assert bot_topics == ["Electric Vehicles"]


@pytest.mark.skipif(
    os.getenv("RUN_LOCAL_MEMORY_DB_DIAGNOSTICS") != "1",
    reason="Set RUN_LOCAL_MEMORY_DB_DIAGNOSTICS=1 to inspect your real local memory.db",
)
def test_local_memory_db_segment_embedding_dimensions(capsys):
    from app.storage.memory_db import VECTOR_DIM, _DB_PATH

    assert os.path.exists(_DB_PATH), f"Local memory DB not found at: {_DB_PATH}"

    conn = sqlite3.connect(f"file:{_DB_PATH}?mode=ro", uri=True)
    try:
        conn.row_factory = sqlite3.Row

        total_segments = conn.execute("SELECT COUNT(*) AS n FROM conversation_segments").fetchone()["n"]
        embedded_segments = conn.execute(
            "SELECT COUNT(*) AS n FROM conversation_segments WHERE embedding IS NOT NULL"
        ).fetchone()["n"]

        lengths = [
            r["nbytes"]
            for r in conn.execute(
                "SELECT LENGTH(embedding) AS nbytes FROM conversation_segments WHERE embedding IS NOT NULL"
            ).fetchall()
        ]

        diag = {
            "db_path": _DB_PATH,
            "total_segments": total_segments,
            "segments_with_embedding": embedded_segments,
            "embedding_byte_lengths": dict(collections.Counter(lengths)),
        }
        with capsys.disabled():
            print(diag)

        if not lengths:
            pytest.skip("No segment embeddings stored; search will return empty.")

        expected_bytes = VECTOR_DIM * 4
        unexpected = sorted({n for n in lengths if n != expected_bytes})
        assert not unexpected, (
            "Found segment embeddings with unexpected vector sizes. "
            f"Expected {expected_bytes} bytes (= {VECTOR_DIM} float32 dims). "
            f"Unexpected byte lengths: {unexpected}."
        )
    finally:
        conn.close()
