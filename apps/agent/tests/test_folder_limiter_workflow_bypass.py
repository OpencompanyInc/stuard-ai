import asyncio

import pytest

from app.tools import fs as fs_tools


class DenyingLimiter:
    def check_read(self, path: str) -> bool:
        return False

    def check_write(self, path: str) -> bool:
        return False

    def describe_denial(self, path: str, operation: str = "read") -> str:
        return f"Folder access denied: {operation} on '{path}'"


@pytest.fixture()
def deny_folder_permissions(monkeypatch: pytest.MonkeyPatch):
    limiter = DenyingLimiter()
    monkeypatch.setattr(fs_tools.FolderLimiter, "get", classmethod(lambda cls: limiter))
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
