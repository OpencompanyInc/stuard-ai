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

    async def activate_target(self, target_id: str):
        self._active_id = target_id
        return self._pages[target_id]


@pytest.fixture(autouse=True)
def _reset_tab_session_state():
    original_browser = state._browser
    original_page = state._page
    original_session_targets = dict(state._tab_session_targets)
    original_target_owners = dict(state._tab_target_owners)
    original_session_touched = dict(state._tab_session_touched)
    try:
        state._browser = None
        state._page = None
        state._tab_session_targets.clear()
        state._tab_target_owners.clear()
        state._tab_session_touched.clear()
        yield
    finally:
        state._browser = original_browser
        state._page = original_page
        state._tab_session_targets.clear()
        state._tab_session_targets.update(original_session_targets)
        state._tab_target_owners.clear()
        state._tab_target_owners.update(original_target_owners)
        state._tab_session_touched.clear()
        state._tab_session_touched.update(original_session_touched)


def test_existing_session_reuses_owned_tab():
    browser = FakeBrowser(count=2)
    state._browser = browser

    asyncio.run(_resolve_tab_for_session({"session_id": "s1", "tab_index": 1}))
    asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))

    assert browser._active_id == "t1"
    assert state._page.target_id == "t1"
    assert browser.new_page_calls == 0


def test_indexed_session_auto_creates_missing_tabs():
    browser = FakeBrowser(count=1)
    state._browser = browser

    asyncio.run(_resolve_tab_for_session({"session_id": "s1", "tab_index": 2}))

    assert list(browser._pages) == ["t0", "t1", "t2"]
    assert browser._active_id == "t2"
    assert state._tab_session_targets["s1"] == "t2"
    assert browser.new_page_calls == 2


def test_unindexed_session_claims_default_when_free():
    browser = FakeBrowser(count=1)
    state._browser = browser

    asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))

    assert browser._active_id == "t0"
    assert state._tab_session_targets["s1"] == "t0"
    assert state._tab_target_owners["t0"] == "s1"
    assert browser.new_page_calls == 0


def test_unindexed_session_creates_tab_when_default_owned():
    browser = FakeBrowser(count=1)
    state._browser = browser

    asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))
    asyncio.run(_resolve_tab_for_session({"session_id": "s2"}))

    assert browser._active_id == "t1"
    assert state._tab_session_targets["s1"] == "t0"
    assert state._tab_session_targets["s2"] == "t1"
    assert browser.new_page_calls == 1


def test_release_removes_ownership_without_closing_tab():
    browser = FakeBrowser(count=1)
    state._browser = browser

    asyncio.run(_resolve_tab_for_session({"session_id": "s1"}))
    released = asyncio.run(_release_tab_session("s1"))

    assert released is True
    assert list(browser._pages) == ["t0"]
    assert state._tab_session_targets == {}
    assert state._tab_target_owners == {}
