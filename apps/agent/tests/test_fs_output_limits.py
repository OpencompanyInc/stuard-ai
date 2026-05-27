import asyncio
import os
import tempfile

import pytest

from app.tools import fs


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        for i in range(10):
            open(os.path.join(d, f"file{i}.txt"), "w", encoding="utf-8").close()
        yield d


@pytest.mark.asyncio
async def test_list_directory_pagination(tmp_dir):
    page1 = await fs.list_directory({"path": tmp_dir, "limit": 4, "offset": 0})
    assert page1["ok"] is True
    assert page1["count"] == 4
    assert page1["truncated"] is True
    assert page1["total"] == 10

    page2 = await fs.list_directory({"path": tmp_dir, "limit": 4, "offset": 4})
    assert page2["count"] == 4
    assert page2["truncated"] is True

    page3 = await fs.list_directory({"path": tmp_dir, "limit": 4, "offset": 8})
    assert page3["count"] == 2
    assert page3["truncated"] is False


@pytest.mark.asyncio
async def test_list_directory_hard_max(tmp_dir):
    result = await fs.list_directory({"path": tmp_dir, "limit": 99999})
    assert result["count"] <= fs.MAX_LIST_DIRECTORY_LIMIT


@pytest.mark.asyncio
async def test_glob_hard_max(tmp_dir):
    result = await fs.glob_paths({"pattern": "*.txt", "root": tmp_dir, "max_results": 99999})
    assert result["ok"] is True
    assert result["count"] <= fs.MAX_GLOB_RESULTS_HARD


@pytest.mark.asyncio
async def test_glob_rejects_broad_pattern(tmp_dir):
    result = await fs.glob_paths({"pattern": "**/*", "root": tmp_dir})
    assert result["ok"] is False
    assert result["error"] == "pattern_too_broad"


@pytest.mark.asyncio
async def test_glob_recursive_requires_root(tmp_dir):
    result = await fs.glob_paths({"pattern": "**/*.txt"})
    assert result["ok"] is False
    assert result["error"] == "recursive_glob_needs_root"


@pytest.mark.asyncio
async def test_glob_stops_at_max_results(tmp_dir):
    sub = os.path.join(tmp_dir, "nested")
    os.makedirs(sub, exist_ok=True)
    for i in range(20):
        open(os.path.join(sub, f"n{i}.txt"), "w", encoding="utf-8").close()
    result = await fs.glob_paths(
        {"pattern": "**/*.txt", "root": tmp_dir, "max_results": 5},
    )
    assert result["ok"] is True
    assert result["count"] == 5
    assert result["truncated"] is True


@pytest.mark.asyncio
async def test_grep_hard_max(tmp_dir):
    for i in range(5):
        with open(os.path.join(tmp_dir, f"grep{i}.txt"), "w", encoding="utf-8") as f:
            f.write("needle\n")
    result = await fs.grep({"path": tmp_dir, "pattern": "needle", "max_results": 99999})
    assert result["ok"] is True
    assert result["count"] <= fs.MAX_GREP_RESULTS_HARD


@pytest.mark.asyncio
async def test_read_file_binary_metadata_only(tmp_dir):
    big_path = os.path.join(tmp_dir, "big.bin")
    with open(big_path, "wb") as f:
        f.write(b"x" * (fs.LLM_READ_FILE_BINARY_INLINE_MAX + 1))

    meta = await fs.read_file_binary({"path": big_path})
    assert meta["ok"] is True
    assert meta["truncated"] is True
    assert "data" not in meta
    assert meta["sha256"]

    full = await fs.read_file_binary({"path": big_path, "inline": True})
    assert full["ok"] is True
    assert full.get("data")


@pytest.mark.asyncio
async def test_read_file_binary_small_inline(tmp_dir):
    small_path = os.path.join(tmp_dir, "small.bin")
    with open(small_path, "wb") as f:
        f.write(b"abc")

    result = await fs.read_file_binary({"path": small_path})
    assert result["ok"] is True
    assert result.get("data")
    assert result["truncated"] is False
