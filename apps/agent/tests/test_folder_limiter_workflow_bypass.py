import asyncio

import pytest

from app.tools import fs as fs_tools
from app.tools.folder_limiter import FolderLimiter, current_session_id


class DenyingLimiter:
    def check_read(self, path: str) -> bool:
        return False

    def check_write(self, path: str) -> bool:
        return False

    def describe_denial(self, path: str, operation: str = "read") -> str:
        return f"Folder access denied: {operation} on '{path}'"


TEST_SESSION = "__test_session__"


@pytest.fixture()
def deny_folder_permissions(monkeypatch: pytest.MonkeyPatch):
    """Patch FolderLimiter.get so every session returns a denying limiter."""
    limiter = DenyingLimiter()
    monkeypatch.setattr(FolderLimiter, "get", classmethod(lambda cls, sid=None: limiter))
    monkeypatch.setattr(
        fs_tools.CheckpointManager,
        "record_change",
        classmethod(lambda cls, *args, **kwargs: None),
    )
    return limiter


def test_regular_read_file_still_respects_folder_permissions(tmp_path, deny_folder_permissions):
    target = tmp_path / "example.txt"
    target.write_text("hello", encoding="utf-8")

    with pytest.raises(ValueError, match="Folder access denied"):
        asyncio.run(fs_tools.read_file({"path": str(target)}))


def test_workflow_marked_read_file_bypasses_folder_permissions(tmp_path, deny_folder_permissions):
    target = tmp_path / "example.txt"
    target.write_text("hello", encoding="utf-8")

    result = asyncio.run(
        fs_tools.read_file({"path": str(target), "__workflowToolCall": True})
    )

    assert result["ok"] is True
    assert result["content"] == "hello"


def test_workflow_marked_write_file_bypasses_folder_permissions(tmp_path, deny_folder_permissions):
    target = tmp_path / "created.txt"

    result = asyncio.run(
        fs_tools.write_file(
            {"path": str(target), "content": "workflow output", "__workflowToolCall": True}
        )
    )

    assert result["ok"] is True
    assert target.read_text(encoding="utf-8") == "workflow output"


# ── Session-scoping tests ─────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _clean_sessions():
    """Ensure a fresh session registry between tests."""
    yield
    FolderLimiter.clear_session(TEST_SESSION)
    FolderLimiter.clear_session("other_session")


def test_sessions_are_independent(tmp_path):
    """Rules added in one session do not affect another."""
    limiter_a = FolderLimiter.get("session_a")
    limiter_b = FolderLimiter.get("session_b")

    limiter_a.add_rule(str(tmp_path), "read")

    assert limiter_a.check_read(str(tmp_path / "file.txt")) is True
    # session_b has no rules → everything allowed (transparent)
    assert limiter_b.check_read(str(tmp_path / "file.txt")) is True

    # Add a rule to session_b for a different path
    other = tmp_path / "other"
    other.mkdir()
    limiter_b.add_rule(str(other), "write")

    # session_b now restricts: read to tmp_path should be denied
    assert limiter_b.check_read(str(tmp_path / "file.txt")) is False
    # session_a still allows read under tmp_path
    assert limiter_a.check_read(str(tmp_path / "file.txt")) is True

    FolderLimiter.clear_session("session_a")
    FolderLimiter.clear_session("session_b")


def test_clear_session_removes_rules():
    limiter = FolderLimiter.get(TEST_SESSION)
    limiter.add_rule("/tmp/test", "both")
    assert limiter.has_rules() is True

    FolderLimiter.clear_session(TEST_SESSION)

    # After clearing, a fresh limiter has no rules
    limiter2 = FolderLimiter.get(TEST_SESSION)
    assert limiter2.has_rules() is False
