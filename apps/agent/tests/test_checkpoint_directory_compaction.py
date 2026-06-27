import asyncio
import json

from app.tools import fs as fs_tools
from app.tools import system as system_tools


def _use_temp_checkpoints(monkeypatch, tmp_path):
    checkpoint_dir = tmp_path / "checkpoints"
    monkeypatch.setattr(fs_tools, "CHECKPOINT_DIR", str(checkpoint_dir))
    fs_tools.CheckpointManager._active_id = None
    fs_tools.CheckpointManager._redo_stack = []
    return checkpoint_dir


def _read_active_manifest(checkpoint_dir):
    checkpoint_id = fs_tools.CheckpointManager.get_active()
    assert checkpoint_id
    with open(checkpoint_dir / checkpoint_id / "manifest.json", "r", encoding="utf-8") as f:
        return json.load(f)


def test_created_directory_entry_covers_child_files(monkeypatch, tmp_path):
    checkpoint_dir = _use_temp_checkpoints(monkeypatch, tmp_path)
    target_dir = tmp_path / "installed"
    target_dir.mkdir()
    child = target_dir / "package" / "index.js"
    child.parent.mkdir()
    child.write_text("export {}", encoding="utf-8")

    fs_tools.CheckpointManager.record_change(str(target_dir), "create_dir")
    fs_tools.CheckpointManager.record_change(str(child), "create")

    manifest = _read_active_manifest(checkpoint_dir)
    assert list(manifest["files"].keys()) == [str(target_dir)]
    assert manifest["files"][str(target_dir)]["action"] == "create"
    assert manifest["files"][str(target_dir)]["entry_type"] == "dir"

    result = fs_tools.CheckpointManager.restore(manifest["id"])

    assert result["ok"] is True
    assert result["restored"] == 1
    assert not target_dir.exists()


def test_command_checkpoint_compacts_new_directory_trees(monkeypatch, tmp_path):
    checkpoint_dir = _use_temp_checkpoints(monkeypatch, tmp_path)
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    before = system_tools._start_command_checkpoint(str(workspace))
    installed = workspace / "vendor"
    for index in range(100):
        file_path = installed / f"pkg-{index}" / "index.txt"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(str(index), encoding="utf-8")

    system_tools._finish_command_checkpoint(before)

    manifest = _read_active_manifest(checkpoint_dir)
    assert list(manifest["files"].keys()) == [str(installed)]
    assert manifest["files"][str(installed)]["action"] == "create"
    assert manifest["files"][str(installed)]["entry_type"] == "dir"


def test_command_checkpoint_keeps_files_created_outside_new_directories(monkeypatch, tmp_path):
    checkpoint_dir = _use_temp_checkpoints(monkeypatch, tmp_path)
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    before = system_tools._start_command_checkpoint(str(workspace))
    installed = workspace / "vendor"
    child = installed / "pkg" / "index.txt"
    child.parent.mkdir(parents=True)
    child.write_text("pkg", encoding="utf-8")
    top_level_file = workspace / "lockfile.txt"
    top_level_file.write_text("lock", encoding="utf-8")

    system_tools._finish_command_checkpoint(before)

    manifest = _read_active_manifest(checkpoint_dir)
    assert set(manifest["files"].keys()) == {str(installed), str(top_level_file)}
    assert manifest["files"][str(installed)]["action"] == "create"
    assert manifest["files"][str(top_level_file)]["action"] == "create"


def test_create_directory_checkpoint_covers_later_child_writes(monkeypatch, tmp_path):
    checkpoint_dir = _use_temp_checkpoints(monkeypatch, tmp_path)
    target_dir = tmp_path / "generated"
    child = target_dir / "deep" / "file.txt"

    asyncio.run(fs_tools.create_directory({"path": str(target_dir)}))
    child.parent.mkdir(parents=True)
    asyncio.run(fs_tools.write_file({"path": str(child), "content": "hello"}))

    manifest = _read_active_manifest(checkpoint_dir)
    assert list(manifest["files"].keys()) == [str(target_dir)]
    assert manifest["files"][str(target_dir)]["action"] == "create"
    assert manifest["files"][str(target_dir)]["entry_type"] == "dir"
