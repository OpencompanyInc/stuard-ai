"""
Tests for the memory/knowledge storage extensions added for the memory overhaul:

  - B1: conversation extraction offset tracking
  - B3: core-fact supersession chain (validity=0 + supersedes_id)
  - B4: pending memory TTL + cap hygiene
"""

import pytest
import keyring
from datetime import datetime, timedelta


@pytest.fixture(autouse=True)
def _mock_keyring(monkeypatch: pytest.MonkeyPatch):
    store = {}
    monkeypatch.setattr(keyring, "get_password", lambda s, a: store.get((s, a)))
    monkeypatch.setattr(keyring, "set_password", lambda s, a, p: store.update({(s, a): p}))
    monkeypatch.setattr(keyring, "delete_password", lambda s, a: store.pop((s, a), None))
    monkeypatch.setattr(keyring, "get_keyring", lambda: object())

    from app.storage import crypto as crypto_mod
    crypto_mod._crypto_manager = None


@pytest.fixture
def memdb(tmp_path):
    from app.storage.memory_db import MemoryDB
    return MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")


# ─── B1: extraction offset ─────────────────────────────────────────────────────

class TestExtractionOffset:
    def test_get_offset_zero_for_new_conversation(self, memdb):
        conv = memdb.create_conversation(title="x")
        assert memdb.get_extraction_offset(conv.id) == 0

    def test_get_offset_zero_for_missing_conversation(self, memdb):
        assert memdb.get_extraction_offset("does-not-exist") == 0

    def test_set_offset_advances_and_persists(self, memdb):
        conv = memdb.create_conversation(title="x")
        assert memdb.set_extraction_offset(conv.id, 5) is True
        assert memdb.get_extraction_offset(conv.id) == 5

    def test_set_offset_never_moves_backwards(self, memdb):
        conv = memdb.create_conversation(title="x")
        memdb.set_extraction_offset(conv.id, 10)
        # Lower value is silently ignored
        assert memdb.set_extraction_offset(conv.id, 3) is False
        assert memdb.get_extraction_offset(conv.id) == 10

    def test_negative_and_none_clamp_to_zero(self, memdb):
        conv = memdb.create_conversation(title="x")
        memdb.set_extraction_offset(conv.id, -5)
        assert memdb.get_extraction_offset(conv.id) == 0


# ─── B3: core-fact supersession chain ──────────────────────────────────────────

class TestSupersession:
    def test_first_upsert_creates_no_supersession(self, tmp_path, monkeypatch):
        # knowledge.db is global, so we point AGENT_DATA_DIR at tmp to isolate.
        monkeypatch.setenv("AGENT_DATA_DIR", str(tmp_path))
        # Re-import so module-level _DB_PATH uses the new dir.
        import importlib
        from app.storage import knowledge_db
        importlib.reload(knowledge_db)
        knowledge_db.init()

        fact = knowledge_db.upsert_core_fact("os", "Windows 11")
        assert fact.supersedes_id is None
        assert fact.validity is True

    def test_second_upsert_marks_old_invalid_and_chains(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AGENT_DATA_DIR", str(tmp_path))
        import importlib
        from app.storage import knowledge_db
        importlib.reload(knowledge_db)
        knowledge_db.init()

        first = knowledge_db.upsert_core_fact("os", "Windows 11")
        second = knowledge_db.upsert_core_fact("os", "Linux Mint")

        assert second.id != first.id, "must create a new row, not mutate in place"
        assert second.supersedes_id == first.id

        # Old row exists and is invalid
        old = knowledge_db.get_fact(first.id)
        assert old is not None
        assert old.validity is False

        # New row is active
        new_active = knowledge_db.get_fact(second.id)
        assert new_active is not None
        assert new_active.validity is True
        assert new_active.text == "Linux Mint"


# ─── B4: pending memory TTL + cap ──────────────────────────────────────────────

class TestPendingMemoryHygiene:
    def test_new_pending_has_expires_at(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AGENT_DATA_DIR", str(tmp_path))
        import importlib
        from app.storage import knowledge_db
        importlib.reload(knowledge_db)
        knowledge_db.init()

        knowledge_db.create_pending_memory(
            original_text="maybe?", proposed_action="ADD_BIO",
            proposed_value="x", confidence_reason="hedged",
        )
        pendings = knowledge_db.get_pending_memories()
        assert len(pendings) == 1
        assert pendings[0].expires_at is not None
        # ~14 days from now
        exp = datetime.fromisoformat(pendings[0].expires_at)
        delta = exp - datetime.now().astimezone()
        assert timedelta(days=13) < delta < timedelta(days=15)

    def test_expire_deletes_past_ttl_rows(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AGENT_DATA_DIR", str(tmp_path))
        import importlib
        from app.storage import knowledge_db
        importlib.reload(knowledge_db)
        knowledge_db.init()

        pm = knowledge_db.create_pending_memory(
            original_text="t", proposed_action="ADD_BIO",
            proposed_value="v", confidence_reason="r",
        )
        # Manually backdate expires_at to the past
        past = (datetime.now().astimezone() - timedelta(days=1)).isoformat()
        with knowledge_db.get_conn() as conn:
            conn.execute("UPDATE pending_memories SET expires_at = ? WHERE id = ?", (past, pm.id))
            conn.commit()

        stats = knowledge_db.expire_and_cap_pending_memories()
        assert stats["expired"] == 1
        assert knowledge_db.get_pending_memory(pm.id) is None

    def test_expire_caps_active_count(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AGENT_DATA_DIR", str(tmp_path))
        import importlib
        from app.storage import knowledge_db
        importlib.reload(knowledge_db)
        knowledge_db.init()

        # Create 5 pending memories, then cap at 3.
        for i in range(5):
            knowledge_db.create_pending_memory(
                original_text=f"t{i}", proposed_action="ADD_BIO",
                proposed_value=f"v{i}", confidence_reason="r",
            )
        stats = knowledge_db.expire_and_cap_pending_memories(max_active=3)
        assert stats["dropped"] == 2
        assert len(knowledge_db.get_pending_memories(limit=100)) == 3

    def test_expire_handles_legacy_null_expires_at(self, tmp_path, monkeypatch):
        monkeypatch.setenv("AGENT_DATA_DIR", str(tmp_path))
        import importlib
        from app.storage import knowledge_db
        importlib.reload(knowledge_db)
        knowledge_db.init()

        # Simulate a legacy row: NULL expires_at, created_at older than TTL.
        old_created = (datetime.now().astimezone() - timedelta(days=20)).isoformat()
        import uuid
        legacy_id = str(uuid.uuid4())
        with knowledge_db.get_conn() as conn:
            conn.execute(
                """INSERT INTO pending_memories
                   (id, original_text, proposed_action, proposed_value,
                    confidence_reason, created_at, status, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)""",
                (legacy_id, "legacy", "ADD_BIO", "v", "r", old_created),
            )
            conn.commit()

        stats = knowledge_db.expire_and_cap_pending_memories()
        assert stats["expired"] >= 1
        assert knowledge_db.get_pending_memory(legacy_id) is None
