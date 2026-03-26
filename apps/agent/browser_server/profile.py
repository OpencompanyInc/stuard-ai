"""Profile directory management for the browser server."""

from pathlib import Path

from browser_server import state


def _profile_root() -> Path:
    return state.PROFILE_ROOT


def _current_profile_dir() -> Path:
    return _profile_root() / state._config["profile"]
