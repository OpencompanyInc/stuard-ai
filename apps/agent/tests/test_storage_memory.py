"""
Tests for the MemoryDB storage module.
"""

import pytest
import keyring


@pytest.fixture(autouse=True)
def _mock_keyring(monkeypatch: pytest.MonkeyPatch):
    """Mock keyring to avoid actual OS keychain operations during tests."""
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


class TestConversation:
    """Tests for Conversation operations."""

    def test_create_conversation(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test Chat", model="gpt-4")

        assert conv.id is not None
        assert conv.title == "Test Chat"
        assert conv.model == "gpt-4"
        assert conv.status == "active"
        assert conv.message_count == 0

    def test_get_conversation(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        created = db.create_conversation(title="Test", model="m")

        fetched = db.get_conversation(created.id)

        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.title == created.title

    def test_get_conversation_not_found(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")

        result = db.get_conversation("nonexistent_id")

        assert result is None

    def test_list_conversations(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        db.create_conversation(title="Chat 1", model="m")
        db.create_conversation(title="Chat 2", model="m")
        db.create_conversation(title="Chat 3", model="m")

        conversations = db.list_conversations(limit=10)

        assert len(conversations) == 3

    def test_list_conversations_with_limit(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        for i in range(5):
            db.create_conversation(title=f"Chat {i}", model="m")

        conversations = db.list_conversations(limit=2)

        assert len(conversations) == 2

    def test_update_conversation(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Original", model="m")

        updated = db.update_conversation(conv.id, title="Updated Title")

        assert updated is not None
        assert updated.title == "Updated Title"

    def test_archive_conversation(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="To Archive", model="m")

        archived = db.update_conversation(conv.id, status="archived")

        assert archived.status == "archived"


class TestMessages:
    """Tests for Message operations."""

    def test_add_message(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        msg = db.add_message(
            conversation_id=conv.id,
            role="user",
            content="Hello, world!",
        )

        assert msg.id is not None
        assert msg.conversation_id == conv.id
        assert msg.role == "user"
        assert msg.content == "Hello, world!"

    def test_get_messages(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        db.add_message(conv.id, "user", "Message 1")
        db.add_message(conv.id, "assistant", "Message 2")
        db.add_message(conv.id, "user", "Message 3")

        messages = db.get_messages(conv.id)

        assert len(messages) == 3
        assert messages[0].content == "Message 1"
        assert messages[1].content == "Message 2"
        assert messages[2].content == "Message 3"

    def test_message_turn_index_auto_increment(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        msg1 = db.add_message(conv.id, "user", "First")
        msg2 = db.add_message(conv.id, "assistant", "Second")
        msg3 = db.add_message(conv.id, "user", "Third")

        assert msg1.turn_index == 0
        assert msg2.turn_index == 1
        assert msg3.turn_index == 2

    def test_message_with_tool_calls(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        tool_calls = [{"name": "search", "args": {"query": "test"}}]
        msg = db.add_message(
            conv.id,
            "assistant",
            "Let me search that.",
            tool_calls=tool_calls,
        )

        fetched = db.get_messages(conv.id)[0]
        assert fetched.tool_calls == tool_calls


class TestConversationSegments:
    """Tests for ConversationSegment operations."""

    def test_create_segment(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        segment = db.create_segment(
            conversation_id=conv.id,
            start_turn=0,
            summary="Discussed weather",
            topics=["weather", "forecast"],
        )

        assert segment.id is not None
        assert segment.conversation_id == conv.id
        assert segment.summary == "Discussed weather"
        assert segment.topics == ["weather", "forecast"]

    def test_create_segment_with_embedding(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        embedding = [0.1, 0.2, 0.3, 0.4, 0.5]
        segment = db.create_segment(
            conversation_id=conv.id,
            start_turn=0,
            summary="Test segment",
            topics=["test"],
            embedding=embedding,
        )

        assert segment.embedding == embedding

    def test_get_conversation_segments(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        db.create_segment(conv.id, 0, "Segment 1", ["topic1"])
        db.create_segment(conv.id, 5, "Segment 2", ["topic2"])

        segments = db.get_conversation_segments(conv.id)

        assert len(segments) == 2

    def test_update_segment(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")
        segment = db.create_segment(conv.id, 0, "Original", ["original"])

        updated = db.update_segment(
            segment.id,
            summary="Updated summary",
            end_turn=10,
        )

        assert updated.summary == "Updated summary"
        assert updated.end_turn == 10


class TestVectorSearch:
    """Tests for vector similarity search."""

    def test_search_segments_finds_matching(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        # Create segment with embedding
        emb = [0.1, 0.2, 0.3]
        db.create_segment(
            conv.id,
            0,
            "Weather discussion",
            ["weather"],
            embedding=emb,
            end_turn=5,
        )

        # Search with same embedding should match
        results = db.search_segments(query_vector=emb, limit=5, threshold=0.9)

        assert len(results) == 1
        segment, score = results[0]
        assert segment.summary == "Weather discussion"
        assert score > 0.9

    def test_search_segments_respects_threshold(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        emb1 = [1.0, 0.0, 0.0]
        emb2 = [0.0, 1.0, 0.0]  # Orthogonal to emb1

        db.create_segment(conv.id, 0, "Segment 1", ["t1"], embedding=emb1, end_turn=1)

        # Search with orthogonal vector should not match with high threshold
        results = db.search_segments(query_vector=emb2, limit=5, threshold=0.9)

        assert len(results) == 0

    def test_search_segments_respects_limit(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        conv = db.create_conversation(title="Test", model="m")

        emb = [0.1, 0.2, 0.3]
        for i in range(5):
            db.create_segment(conv.id, i, f"Segment {i}", ["t"], embedding=emb, end_turn=i+1)

        results = db.search_segments(query_vector=emb, limit=3, threshold=0.5)

        assert len(results) <= 3


class TestProjects:
    """Tests for Project Mode operations (successor to Spaces)."""

    def test_create_project_with_settings(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")

        project = db.create_project(
            name="My Project",
            description="A test project",
            settings={"notion": {"page_id": "abc123", "direction": "pull"}},
        )

        assert project.id is not None
        assert project.name == "My Project"
        assert project.settings == {"notion": {"page_id": "abc123", "direction": "pull"}}

        fetched = db.get_project(project.id)
        assert fetched is not None
        assert fetched.settings == {"notion": {"page_id": "abc123", "direction": "pull"}}

    def test_update_project_settings(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        project = db.create_project(name="P")

        updated = db.update_project(project.id, settings={"notion": {"page_id": "x"}})
        assert updated is not None
        assert updated.settings == {"notion": {"page_id": "x"}}

        # Other fields untouched
        assert updated.name == "P"

    def test_journal_question_and_hypothesis_types(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        project = db.create_project(name="P")

        q = db.create_journal_entry(project.id, "question", "Open question?")
        h = db.create_journal_entry(project.id, "hypothesis", "Maybe X causes Y")

        assert q.type == "question"
        assert h.type == "hypothesis"

    def test_journal_update_in_place(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        project = db.create_project(name="P")

        entry = db.create_journal_entry(
            project.id, "chat_summary", "Session: initial topic",
            body="First summary", source="auto-chat",
            source_ref={"segment_id": "seg-1"},
            entry_id="jseg-seg-1",
        )
        assert entry.id == "jseg-seg-1"

        updated = db.update_journal_entry(
            "jseg-seg-1", title="Session: refined topic", body="Updated summary",
        )
        assert updated is not None
        assert updated.title == "Session: refined topic"
        assert updated.body == "Updated summary"
        assert updated.source_ref == {"segment_id": "seg-1"}

        entries = db.list_journal_entries(project.id)
        assert len(entries) == 1

    def test_memory_image_type(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        mem = db.create_memory(type="image", content="C:/pics/diagram.png")
        assert mem.type == "image"


class TestSpacesBackfill:
    """The legacy spaces tables are migrated into projects on startup."""

    def _create_legacy_spaces(self, db_path):
        """Open a fresh DB, then graft old-style spaces tables onto it."""
        import sqlite3

        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE spaces (
                id TEXT PRIMARY KEY, name_enc TEXT NOT NULL, description_enc TEXT,
                type TEXT NOT NULL, icon TEXT, color TEXT, embedding BLOB,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                archived INTEGER DEFAULT 0, sync_id TEXT, synced_at TEXT,
                needs_sync INTEGER DEFAULT 0
            )
        """)
        cur.execute("""
            CREATE TABLE space_items (
                id TEXT PRIMARY KEY, space_id TEXT NOT NULL, type TEXT NOT NULL,
                title_enc TEXT, content_enc TEXT NOT NULL, metadata_enc TEXT,
                added_by TEXT NOT NULL, pinned INTEGER DEFAULT 0, embedding BLOB,
                parent_id TEXT, position INTEGER DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE space_conversations (
                space_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
                relevance_score REAL DEFAULT 1.0, auto_linked INTEGER DEFAULT 0,
                created_at TEXT NOT NULL, PRIMARY KEY (space_id, conversation_id)
            )
        """)
        conn.commit()
        conn.close()

    def test_spaces_backfill_to_projects(self, tmp_path):
        from app.storage.memory_db import MemoryDB
        from app.storage.memory_db import _encrypt_content

        db_path = str(tmp_path / "memory.db")

        # First boot creates the modern schema; we then graft legacy tables
        # with rows encrypted by the same crypto manager.
        db = MemoryDB(db_path=db_path, user_password="test")
        crypto = db._crypto
        conv = db.create_conversation(title="Linked chat", model="m")

        self._create_legacy_spaces(db_path)
        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO spaces VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, NULL, NULL, 0)",
            ("space-1", _encrypt_content("Research Space", crypto),
             _encrypt_content("Old space", crypto), "research", "🔬", "#123456",
             "2025-01-01T00:00:00", "2025-01-02T00:00:00"),
        )
        conn.execute(
            "INSERT INTO space_items VALUES (?, ?, ?, ?, ?, NULL, 'user', 1, NULL, NULL, 0, ?, ?)",
            ("item-1", "space-1", "source",
             _encrypt_content("A source", crypto), _encrypt_content("Useful content", crypto),
             "2025-01-01T00:00:00", "2025-01-01T00:00:00"),
        )
        conn.execute(
            "INSERT INTO space_conversations VALUES (?, ?, 1.0, 0, ?)",
            ("space-1", conv.id, "2025-01-01T00:00:00"),
        )
        conn.commit()
        conn.close()

        # Re-init triggers the backfill migration.
        db2 = MemoryDB(db_path=db_path, user_password="test")

        project = db2.get_project("space-1")
        assert project is not None
        assert project.name == "Research Space"
        assert project.tags == ["research"]

        memories = db2.list_memories(project_id="space-1")
        assert len(memories) == 1
        assert memories[0].type == "reference"  # 'source' maps to 'reference'
        assert memories[0].content == "Useful content"
        assert memories[0].pinned is True

        refreshed = db2.get_conversation(conv.id)
        assert refreshed is not None

        # Legacy tables are dropped after a successful backfill.
        import sqlite3 as s3
        conn = s3.connect(db_path)
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        conn.close()
        assert "spaces" not in tables
        assert "space_items" not in tables
        assert "space_conversations" not in tables


class TestSecuritySettings:
    """Tests for security settings."""

    def test_get_and_update_security_settings(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")

        # Update settings
        db.update_security_settings(
            memory_lock_enabled=True,
            lock_timeout_minutes=15
        )

        # Get settings
        settings = db.get_security_settings()

        assert settings.memory_lock_enabled is True
        assert settings.lock_timeout_minutes == 15

    def test_get_default_security_settings(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")

        settings = db.get_security_settings()

        # Defaults
        assert settings.memory_lock_enabled is False
        assert settings.lock_timeout_minutes == 5
