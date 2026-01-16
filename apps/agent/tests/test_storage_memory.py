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


class TestSpaces:
    """Tests for Space operations."""

    def test_create_space(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")

        space = db.create_space(
            name="My Project",
            description="A test project",
            space_type="project",
        )

        assert space.id is not None
        assert space.name == "My Project"
        assert space.description == "A test project"
        assert space.type == "project"

    def test_list_spaces(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        db.create_space(name="Space 1", space_type="project")
        db.create_space(name="Space 2", space_type="topic")

        spaces = db.list_spaces()

        assert len(spaces) == 2

    def test_get_space(self, tmp_path):
        from app.storage.memory_db import MemoryDB

        db = MemoryDB(db_path=str(tmp_path / "memory.db"), user_password="test")
        created = db.create_space(name="Test Space", space_type="research")

        fetched = db.get_space(created.id)

        assert fetched is not None
        assert fetched.name == "Test Space"


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
