"""Concurrency tests for the browser server's per-tab session model.

These use a fake CDP browser (no real Chrome) to validate the mechanics that fix
"parallel browser delegated subagents time out": each session gets its own tab, and a
slow operation on one session must NOT block operations on other sessions (the old
single-global-lock behavior). Run from apps/agent:

    python -m pytest test_browser_concurrency.py -v
"""

import asyncio
import time

import pytest

from browser_server import state
from browser_server.lifecycle import browser_op, _active_page, _get_page_url


# ── Fakes ────────────────────────────────────────────────────────────────────

class FakePage:
    def __init__(self, target_id: str):
        self.target_id = target_id
        self.is_connected = True
        self._frame_contexts: dict = {}

    async def evaluate(self, expression: str, *args):
        if "window.location.href" in expression:
            return f"https://example.test/{self.target_id}"
        return True

    async def send(self, method: str, params=None):
        return {}


class FakeBrowser:
    def __init__(self):
        self._pages: dict[str, FakePage] = {}
        self._active_id = None
        self._counter = 0

    async def list_targets(self):
        return [
            {"id": tid, "type": "page", "url": "", "title": ""}
            for tid in self._pages
        ]

    async def new_page(self, url: str = "about:blank") -> FakePage:
        self._counter += 1
        tid = f"t{self._counter}"
        page = FakePage(tid)
        self._pages[tid] = page
        self._active_id = tid
        return page

    async def get_page(self, target_id: str) -> FakePage:
        return self._pages[target_id]

    async def activate_target(self, target_id: str) -> FakePage:
        self._active_id = target_id
        return self._pages[target_id]


@pytest.fixture(autouse=True)
def fresh_browser():
    """Install a fake running browser with one default tab and clear all state."""
    browser = FakeBrowser()
    # Seed the default tab synchronously (FakePage.__init__ is sync) so this fixture
    # doesn't need its own event loop alongside pytest-asyncio's.
    default = FakePage("t1")
    browser._pages["t1"] = default
    browser._active_id = "t1"
    browser._counter = 1

    state._browser = browser
    state._page = default
    state._default_target_id = browser._active_id
    state._config["mode"] = "headless"
    state._tab_session_targets.clear()
    state._tab_target_owners.clear()
    state._tab_session_touched.clear()
    state._session_locks.clear()
    state.current_page.set(None)

    yield browser

    state._browser = None
    state._page = None
    state._default_target_id = None
    state._tab_session_targets.clear()
    state._tab_target_owners.clear()
    state._tab_session_touched.clear()
    state._session_locks.clear()


# ── Helpers ──────────────────────────────────────────────────────────────────

async def timed_op(session_id: str, delay: float, log: list):
    async with browser_op({"session_id": session_id}) as (ok, err):
        assert ok, f"browser_op failed: {err}"
        page = _active_page()
        log.append((session_id, "start", page.target_id, time.monotonic()))
        await asyncio.sleep(delay)
        # The active page must be unchanged across the await (contextvar isolation).
        assert _active_page().target_id == page.target_id
        log.append((session_id, "end", page.target_id, time.monotonic()))
        return page.target_id


# ── Tests ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sessions_get_distinct_tabs(fresh_browser):
    log: list = []
    a = await timed_op("sess-A", 0.0, log)
    b = await timed_op("sess-B", 0.0, log)
    assert a != b, "two sessions must own different tabs"
    # First session adopts the default tab; the second spreads to a fresh tab so
    # parallel siblings never collide.
    assert b != state._default_target_id


@pytest.mark.asyncio
async def test_single_session_adopts_default_tab(fresh_browser):
    """A lone browser subagent reuses the existing tab — no blank 'New Tab' left behind."""
    log: list = []
    a = await timed_op("sess-A", 0.0, log)
    assert a == state._default_target_id
    assert len(fresh_browser._pages) == 1, "a single session must not open a 2nd tab"


@pytest.mark.asyncio
async def test_same_session_reuses_its_tab():
    log: list = []
    first = await timed_op("sess-A", 0.0, log)
    second = await timed_op("sess-A", 0.0, log)
    assert first == second, "the same session must reuse its owned tab"


@pytest.mark.asyncio
async def test_slow_session_does_not_block_other_session():
    """The core fix: a slow op on A must not stall a fast op on B."""
    log: list = []
    t0 = time.monotonic()
    a_task = asyncio.create_task(timed_op("sess-A", 0.5, log))
    # Give A a beat to acquire its tab and enter its sleep.
    await asyncio.sleep(0.02)
    b_target = await timed_op("sess-B", 0.0, log)
    b_done = time.monotonic()

    # B completed well before A's 0.5s sleep finished → not serialized behind A.
    assert b_done - t0 < 0.3, f"B was blocked by A (took {b_done - t0:.3f}s)"

    a_target = await a_task
    assert a_target != b_target

    a_end = next(e for e in log if e[0] == "sess-A" and e[1] == "end")[3]
    assert b_done < a_end, "B must finish before A (concurrent, not queued)"


@pytest.mark.asyncio
async def test_same_session_requests_are_serialized():
    """Two concurrent requests for the SAME session must not overlap."""
    log: list = []
    await asyncio.gather(
        timed_op("sess-A", 0.2, log),
        timed_op("sess-A", 0.2, log),
    )
    starts = sorted(e[3] for e in log if e[1] == "start")
    ends = sorted(e[3] for e in log if e[1] == "end")
    # The second op may only start after the first finished (per-session lock).
    assert starts[1] >= ends[0] - 1e-3, "same-session ops overlapped"


@pytest.mark.asyncio
async def test_get_page_url_targets_session_tab():
    """Each session's helper calls resolve to its own tab's URL, not a shared global."""
    async def fetch(session_id: str):
        async with browser_op({"session_id": session_id}) as (ok, err):
            assert ok
            return await _get_page_url()

    url_a, url_b = await asyncio.gather(fetch("sess-A"), fetch("sess-B"))
    assert url_a != url_b
    assert url_a.startswith("https://example.test/")
