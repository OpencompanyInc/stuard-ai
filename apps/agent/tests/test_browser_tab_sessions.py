import asyncio

import pytest

from browser_server import state
from browser_server.lifecycle import _release_tab_session, _resolve_tab_for_session


class FakePage:
    def __init__(self, target_id: str):
        self.target_id = target_id
        self.is_connected = True

    async def evaluate(self, _script: str):
        return True


class FakeBrowser:
    def __init__(self, count: int = 1):
        self._pages = {}
        self._active_id = None
        self.new_page_calls = 0
        for _ in range(count):
            target_id = f"t{len(self._pages)}"
            self._pages[target_id] = FakePage(target_id)
            if self._active_id is None:
                self._active_id = target_id

    async def list_targets(self):
        return [
            {"id": target_id, "url": f"https://example.test/{target_id}", "title": target_id}
            for target_id in self._pages
        ]

    async def new_page(self, _url: str = "about:blank"):
        target_id = f"t{len(self._pages)}"
        page = FakePage(target_id)
        self._pages[target_id] = page
        self._active_id = target_id
        self.new_page_calls += 1
        return page

    async def get_page(self, target_id: str):
        # Background attach: return the connection WITHOUT changing the foreground tab.
        return self._pages[target_id]

    async def activate_target(self, target_id: str):
        self._active_id = target_id
        return self._pages[target_id]


@pytest.fixture(autouse=True)
def _reset_tab_session_state():
    original_browser = state._browser
    original_page = state._page
    original_default = state._default_target_id
    original_session_targets = dict(state._tab_session_targets)
    original_target_owners = dict(state._tab_target_owners)
    original_session_touched = dict(state._tab_session_touched)
    try:
        state._browser = None
        state._page = None
        state._default_target_id = None
        state._tab_session_targets.clear()
        state._tab_target_owners.clear()
        state._tab_session_touched.clear()
        state._session_locks.clear()
        yield
    finally:
        state._browser = original_browser
        state._page = original_page
        state._default_target_id = original_default
        state._tab_session_targets.clear()
        state._tab_session_targets.update(original_session_targets)
        state._tab_target_owners.clear()
        state._tab_target_owners.update(original_target_owners)
        state._tab_session_touched.clear()
        state._tab_session_touched.update(original_session_touched)
        state._session_locks.clear()


def test_existing_session_reuses_owned_tab():
    """Resolving twice for the same session returns its owned tab — no new tab, and
    (critically) it does NOT mutate the shared default page (state._page)."""
    browser = FakeBrowser(count=2)
    state._browser = browser
    state._default_target_id = "t0"

    first = asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))
    second = asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))

    assert first.target_id == second.target_id
    assert state._tab_session_targets["s1"] == first.target_id
    assert browser.new_page_calls == 0
    # Resolution must not clobber the shared default page; that's per-request state now.
    assert state._page is None


def test_two_sessions_get_separate_tabs():
    """tab_index is no longer used; ownership keeps two sessions on distinct tabs."""
    browser = FakeBrowser(count=2)
    state._browser = browser
    state._default_target_id = "t0"

    p1 = asyncio.run(_resolve_tab_for_session({"session_id": "s1", "tab_index": 0}))
    p2 = asyncio.run(_resolve_tab_for_session({"session_id": "s2", "tab_index": 0}))

    assert p1.target_id != p2.target_id
    assert state._tab_session_targets["s1"] != state._tab_session_targets["s2"]
    # Two existing tabs (t0 default + t1) suffice — no new tab needed.
    assert browser.new_page_calls == 0


def test_session_creates_tab_when_none_free():
    """With only the (owned) default tab left, a new session opens its own tab."""
    browser = FakeBrowser(count=1)
    state._browser = browser
    state._default_target_id = "t0"

    asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))   # adopts default t0
    p2 = asyncio.run(_resolve_tab_for_session({"session_id": "s2"}))  # must create t1

    assert state._tab_session_targets["s1"] == "t0"
    assert state._tab_session_targets["s2"] == "t1"
    assert p2.target_id == "t1"
    assert browser.new_page_calls == 1


def test_lone_session_adopts_default_tab():
    """A single session reuses the default tab rather than opening a blank second one."""
    browser = FakeBrowser(count=1)
    state._browser = browser
    state._default_target_id = "t0"

    page = asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))

    assert page.target_id == "t0"
    assert state._tab_target_owners["t0"] == "s1"
    assert browser.new_page_calls == 0


def test_parallel_siblings_prefer_non_default_tab():
    """When a free non-default tab exists, a new session takes it instead of the default."""
    browser = FakeBrowser(count=2)  # t0 (default) + t1 (free)
    state._browser = browser
    state._default_target_id = "t0"

    page = asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))

    assert page.target_id == "t1"
    assert browser.new_page_calls == 0


def test_release_removes_ownership_without_closing_tab():
    browser = FakeBrowser(count=1)
    state._browser = browser
    state._default_target_id = "t0"

    asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))
    released = asyncio.run(_release_tab_session("s1"))

    assert released is True
    assert list(browser._pages) == ["t0"]
    assert state._tab_session_targets == {}
    assert state._tab_target_owners == {}
