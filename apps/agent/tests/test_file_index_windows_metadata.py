import os
import importlib
from pathlib import Path

def _load_modules(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AGENT_DATA_DIR", str(tmp_path / "agent-data"))

    from app.storage import file_index_db as db_module
    from app.tools import file_search as file_search_module

    db_module = importlib.reload(db_module)
    file_search_module = importlib.reload(file_search_module)
    db_module.init()
    return db_module, file_search_module


def test_windows_identity_metadata_tracks_renames(monkeypatch, tmp_path: Path):
    db, _ = _load_modules(monkeypatch, tmp_path)
    root_dir = tmp_path / "indexed-root"
    root_dir.mkdir()

    root = db.add_root(str(root_dir))
    first_scan_id = db.increment_scan_id(
        root.id,
        backend="win32",
        volume_serial=0xABC,
        last_reconcile_at="2026-04-14T00:00:00+00:00",
    )

    original_path = root_dir / "old-name.png"
    indexed_file, changed = db.upsert_file(
        root.id,
        str(original_path),
        size=128,
        mtime_ms=1000,
        scan_id=first_scan_id,
        volume_serial=0xABC,
        file_id="file-123",
        parent_file_id="parent-001",
        win_attrs=32,
    )

    assert changed is True
    assert indexed_file.preview_kind == "thumbnail"
    assert indexed_file.preview_eligible is True

    updated_root = db.get_root(root.id)
    assert updated_root is not None
    assert updated_root.backend == "win32"
    assert updated_root.watch_state == "inactive"
    assert updated_root.volume_serial == "0000000000000abc"
    assert updated_root.last_reconcile_at == "2026-04-14T00:00:00+00:00"

    second_scan_id = db.increment_scan_id(
        root.id,
        backend="win32",
        volume_serial=0xABC,
        last_reconcile_at="2026-04-14T01:00:00+00:00",
    )
    renamed_path = root_dir / "renamed.png"
    renamed_file, changed = db.upsert_file(
        root.id,
        str(renamed_path),
        size=128,
        mtime_ms=1000,
        scan_id=second_scan_id,
        volume_serial=0xABC,
        file_id="file-123",
        parent_file_id="parent-001",
        win_attrs=32,
    )

    normalized_original = os.path.normpath(os.path.abspath(str(original_path)))
    normalized_renamed = os.path.normpath(os.path.abspath(str(renamed_path)))

    assert changed is True
    assert renamed_file.id == indexed_file.id
    assert renamed_file.path == normalized_renamed
    assert db.get_file_by_path(normalized_original) is None

    stored_file = db.get_file_by_path(normalized_renamed)
    assert stored_file is not None
    assert stored_file.id == indexed_file.id
    assert stored_file.file_id == "file-123"
    assert stored_file.parent_file_id == "parent-001"
    assert stored_file.win_attrs == 32

    metadata = db.get_root_file_metadata(root.id)
    assert normalized_renamed in metadata
    assert metadata[normalized_renamed]["volume_serial"] == "0000000000000abc"
    assert metadata[normalized_renamed]["file_id"] == "file-123"
    assert metadata[normalized_renamed]["parent_file_id"] == "parent-001"
    assert metadata[normalized_renamed]["preview_kind"] == "thumbnail"
    assert metadata[normalized_renamed]["preview_eligible"] is True


def test_file_search_formats_preview_fields(monkeypatch, tmp_path: Path):
    db, file_search = _load_modules(monkeypatch, tmp_path)
    indexed_file = db.IndexedFile(
        id="file-1",
        root_id="root-1",
        path="C:/Users/solar/Pictures/cat.jpg",
        filename="cat.jpg",
        extension=".jpg",
        kind="image",
        size=2048,
        mtime_ms=1000,
        volume_serial=None,
        file_id=None,
        parent_file_id=None,
        win_attrs=None,
        content_hash=None,
        preview_kind="thumbnail",
        preview_eligible=True,
        status="indexed",
        last_seen_scan_id=1,
        summary="Cat photo",
        keywords="cat, pet",
        vector=None,
        summary_model_version=None,
        embedding_model_version=None,
        indexed_at="2026-04-14T00:00:00+00:00",
        created_at="2026-04-14T00:00:00+00:00",
        error_message=None,
    )

    result = file_search.format_file_result(indexed_file, score=0.91, match_type="fts")

    assert result["preview_kind"] == "thumbnail"
    assert result["preview_eligible"] is True
    assert result["kind"] == "image"
