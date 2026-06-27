import asyncio
import json
from pathlib import Path

import pytest

from browser_server import handlers_config, state


class _DummyRequest:
    def __init__(self, body: dict):
        self._body = body

    async def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _reset_browser_state():
    original_config = dict(state._config)
    original_browser = state._browser
    original_page = state._page
    try:
        state._config.clear()
        state._config.update({
            "mode": "headed",
            "profile": "default",
            "profile_dir": None,
        })
        state._browser = None
        state._page = None
        yield
    finally:
        state._config.clear()
        state._config.update(original_config)
        state._browser = original_browser
        state._page = original_page


def _json_response_payload(response) -> dict:
    return json.loads(response.text)


def test_handle_configure_skips_restart_when_mode_and_profile_are_unchanged(
    monkeypatch: pytest.MonkeyPatch,
):
    calls = {"close": 0, "ensure": 0}

    async def fake_page_is_alive():
        return True

    async def fake_close_browser(profile_dir=None):
        calls["close"] += 1

    async def fake_ensure_browser():
        calls["ensure"] += 1
        return True, None

    monkeypatch.setattr(handlers_config, "_page_is_alive", fake_page_is_alive)
    monkeypatch.setattr(handlers_config, "_close_browser", fake_close_browser)
    monkeypatch.setattr(handlers_config, "_ensure_browser", fake_ensure_browser)

    response = asyncio.run(
        handlers_config.handle_configure(
            _DummyRequest({"mode": "headed", "profile": "default"})
        )
    )
    payload = _json_response_payload(response)

    assert payload["ok"] is True
    assert payload["mode"] == "headed"
    assert payload["profile"] == "default"
    assert payload["restarted"] is False
    assert payload["running"] is True
    assert calls == {"close": 0, "ensure": 0}


def test_handle_configure_closes_old_profile_before_switch_and_restores_url(
    monkeypatch: pytest.MonkeyPatch,
):
    closed_profile_dirs: list[Path] = []
    restored_urls: list[str] = []
    ensure_calls = {"count": 0}

    async def fake_page_is_alive():
        return True

    async def fake_get_page_url():
        return "https://example.com/dashboard"

    async def fake_close_browser(profile_dir=None):
        closed_profile_dirs.append(Path(profile_dir))

    async def fake_ensure_browser():
        ensure_calls["count"] += 1
        return True, None

    async def fake_goto(url: str, wait_until: str = "domcontentloaded", timeout: int = 30000):
        restored_urls.append(url)

    def fake_current_profile_dir() -> Path:
        return Path(f"C:/profiles/{state._config['profile']}")

    monkeypatch.setattr(handlers_config, "_page_is_alive", fake_page_is_alive)
    monkeypatch.setattr(handlers_config, "_get_page_url", fake_get_page_url)
    monkeypatch.setattr(handlers_config, "_close_browser", fake_close_browser)
    monkeypatch.setattr(handlers_config, "_ensure_browser", fake_ensure_browser)
    monkeypatch.setattr(handlers_config, "_goto", fake_goto)
    monkeypatch.setattr(handlers_config, "_current_profile_dir", fake_current_profile_dir)

    response = asyncio.run(
        handlers_config.handle_configure(
            _DummyRequest({"mode": "headless", "profile": "work"})
        )
    )
    payload = _json_response_payload(response)

    assert payload["ok"] is True
    assert payload["mode"] == "headless"
    assert payload["profile"] == "work"
    assert payload["restarted"] is True
    assert payload["running"] is True
    assert closed_profile_dirs == [Path("C:/profiles/default")]
    assert restored_urls == ["https://example.com/dashboard"]
    assert ensure_calls["count"] == 1
    assert state._config["mode"] == "headless"
    assert state._config["profile"] == "work"
