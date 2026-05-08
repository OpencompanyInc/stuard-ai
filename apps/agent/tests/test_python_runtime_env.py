import asyncio
from types import SimpleNamespace

import pytest

from app.tools import system


def test_resolve_python_env_id_defaults_and_preserves_named_envs():
    assert system._resolve_python_env_id(None) == system.DEFAULT_PYTHON_ENV_ID
    assert system._resolve_python_env_id("") == system.DEFAULT_PYTHON_ENV_ID
    assert system._resolve_python_env_id("data-tools") == "data-tools"


@pytest.mark.parametrize("env_id", ["..", ".", "../outside", r"..\outside", "/tmp/env"])
def test_resolve_python_env_id_rejects_path_like_values(env_id):
    with pytest.raises(ValueError, match="invalid_envId"):
        system._resolve_python_env_id(env_id)


def test_python_install_uses_default_env_when_env_id_omitted(monkeypatch):
    ensure_calls = []
    pip_calls = []
    py_bin = "default-python"

    async def fake_ensure(env_id, emit=None):
        ensure_calls.append(env_id)
        return f"env-{env_id}", py_bin

    def fake_run(cmd, *args, **kwargs):
        pip_calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(system, "_ensure_python_env", fake_ensure)
    monkeypatch.setattr(system.subprocess, "run", fake_run)

    result = asyncio.run(system.python_install({"packages": ["requests"]}))

    assert result["ok"] is True
    assert result["envId"] == system.DEFAULT_PYTHON_ENV_ID
    assert result["python"] == py_bin
    assert ensure_calls == [system.DEFAULT_PYTHON_ENV_ID]
    assert pip_calls == [[py_bin, "-m", "pip", "install", "requests"]]


def test_run_python_script_uses_default_env_when_env_id_omitted(monkeypatch):
    ensure_calls = []
    run_calls = []
    py_bin = "default-python"

    async def fake_ensure(env_id, emit=None):
        ensure_calls.append(env_id)
        return f"env-{env_id}", py_bin

    def fake_run(cmd, *args, **kwargs):
        run_calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="ok\n", stderr="")

    monkeypatch.setattr(system, "_ensure_python_env", fake_ensure)
    monkeypatch.setattr(system.subprocess, "run", fake_run)

    result = asyncio.run(system.run_python_script({"code": "print('ok')"}))

    assert result["ok"] is True
    assert result["stdout"] == "ok\n"
    assert result["envId"] == system.DEFAULT_PYTHON_ENV_ID
    assert result["python"] == py_bin
    assert ensure_calls == [system.DEFAULT_PYTHON_ENV_ID]
    assert run_calls[0][0] == py_bin


def test_run_python_script_honors_named_env(monkeypatch):
    ensure_calls = []
    py_bin = "analysis-python"

    async def fake_ensure(env_id, emit=None):
        ensure_calls.append(env_id)
        return f"env-{env_id}", py_bin

    def fake_run(cmd, *args, **kwargs):
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(system, "_ensure_python_env", fake_ensure)
    monkeypatch.setattr(system.subprocess, "run", fake_run)

    result = asyncio.run(system.run_python_script({"envId": "analysis", "code": "pass"}))

    assert result["ok"] is True
    assert result["envId"] == "analysis"
    assert ensure_calls == ["analysis"]
