import asyncio
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


def test_search_files_includes_matching_indexed_root(monkeypatch, tmp_path: Path):
    db, file_search = _load_modules(monkeypatch, tmp_path)

    downloads_dir = tmp_path / "Downloads"
    downloads_dir.mkdir()
    db.add_root(str(downloads_dir))

    result = asyncio.run(file_search.search_files({
        "query": "downloads",
        "mode": "quick",
        "limit": 5,
    }))

    assert result["ok"] is True
    assert result["count"] >= 1

    root_match = next((item for item in result["results"] if item["path"] == str(downloads_dir)), None)
    assert root_match is not None
    assert root_match["kind"] == "folder"
    assert root_match["display_name"] == "Downloads"
    assert root_match["match_type"] == "root"
    assert root_match["is_folder"] is True
