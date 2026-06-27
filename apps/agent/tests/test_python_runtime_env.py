import asyncio
import os
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


def test_default_python_env_dir_prefers_native_env(monkeypatch):
    native = os.path.join(os.sep, "agent", ".venv")

    monkeypatch.setattr(system, "_native_python_env_dir", lambda *args, **kwargs: native)

    assert system._python_env_dir(system.DEFAULT_PYTHON_ENV_ID) == native
    assert system._python_env_dir("analysis").endswith(os.path.join("StuardAI", "python", "envs", "analysis"))


def test_run_command_uses_native_python_env(monkeypatch):
    captured = {}
    native = os.path.join(os.sep, "agent", ".venv")
    python_bin = os.path.join(native, "Scripts" if system.sys.platform.startswith("win") else "bin", "python.exe" if system.sys.platform.startswith("win") else "python")

    monkeypatch.setattr(system, "_command_python_env_dir", lambda cwd: native)
    monkeypatch.setattr(system, "_is_usable_python_env", lambda env_dir: env_dir == native)
    monkeypatch.setattr(system, "_python_env_bin", lambda env_dir: python_bin)

    async def fake_stream(argv, **kwargs):
        captured["argv"] = argv
        captured["env"] = kwargs.get("env")
        return 0, "", "", False

    monkeypatch.setattr(system, "_stream_subprocess", fake_stream)

    result = asyncio.run(system.run_command({"command": "pip --version", "cwd": r"C:\agent"}))

    assert result["ok"] is True
    assert captured["env"]["VIRTUAL_ENV"] == native
    assert captured["env"]["PYTHONNOUSERSITE"] == "1"
    assert captured["env"]["PATH"].startswith(os.path.dirname(python_bin))
    command_text = captured["argv"][-1]
    assert "pip" in command_text
    if system.sys.platform.startswith("win"):
        assert r"\Scripts\python.exe" in command_text


def test_ensure_python_env_uses_native_default(monkeypatch):
    native = os.path.join(os.sep, "agent", ".venv")
    python_bin = os.path.join(native, "Scripts" if system.sys.platform.startswith("win") else "bin", "python.exe" if system.sys.platform.startswith("win") else "python")
    run_calls = []

    monkeypatch.setattr(system, "_native_python_env_dir", lambda *args, **kwargs: native)
    monkeypatch.setattr(system, "_python_env_bin", lambda env_dir: python_bin)
    monkeypatch.setattr(system.os.path, "exists", lambda path: path == python_bin)
    monkeypatch.setattr(system.os, "makedirs", lambda *args, **kwargs: None)
    monkeypatch.setattr(system, "_cached_pip_ok", set())

    def fake_run(cmd, *args, **kwargs):
        run_calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(system.subprocess, "run", fake_run)

    env_dir, py_bin = asyncio.run(system._ensure_python_env(system.DEFAULT_PYTHON_ENV_ID))

    assert env_dir == native
    assert py_bin == python_bin
    assert run_calls == [
        [python_bin, "-m", "pip", "--version"],
        [python_bin, "-m", "pip", "--version"],
    ]


def test_python_install_uses_default_env_when_env_id_omitted(monkeypatch):
    ensure_calls = []
    pip_calls = []

    async def fake_ensure(env_id, emit=None):
        ensure_calls.append(env_id)
        return f"env-{env_id}", "default-python"

    async def fake_filter(py_bin, specs):
        return list(specs), []

    def fake_run(cmd, *args, **kwargs):
        pip_calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(system, "_ensure_python_env", fake_ensure)
    monkeypatch.setattr(system, "_filter_packages_to_install", fake_filter)
    monkeypatch.setattr(system.subprocess, "run", fake_run)

    result = asyncio.run(system.python_install({"packages": ["requests"]}))

    assert result["ok"] is True
    assert result["envId"] == system.DEFAULT_PYTHON_ENV_ID
    assert result["python"] == "default-python"
    assert result["packagesInstalled"] == ["requests"]
    assert result["packagesSkipped"] == []
    assert ensure_calls == [system.DEFAULT_PYTHON_ENV_ID]
    assert pip_calls == [["default-python", "-m", "pip", "install", "requests"]]


def test_python_install_skips_already_installed_packages(monkeypatch):
    pip_calls = []

    async def fake_ensure(env_id, emit=None):
        return "env-default", "default-python"

    async def fake_filter(py_bin, specs):
        return [], list(specs)

    def fake_run(cmd, *args, **kwargs):
        pip_calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(system, "_ensure_python_env", fake_ensure)
    monkeypatch.setattr(system, "_filter_packages_to_install", fake_filter)
    monkeypatch.setattr(system.subprocess, "run", fake_run)

    result = asyncio.run(system.python_install({"packages": ["requests"]}))

    assert result["ok"] is True
    assert result["packagesInstalled"] == []
    assert result["packagesSkipped"] == ["requests"]
    assert pip_calls == []


def test_run_python_script_uses_default_env_when_env_id_omitted(monkeypatch):
    ensure_calls = []
    py_bin = "default-python"

    async def fake_ensure(env_id, emit=None):
        ensure_calls.append(env_id)
        return f"env-{env_id}", py_bin

    async def fake_stream(argv, **kwargs):
        return 0, "ok\n", "", False

    monkeypatch.setattr(system, "_ensure_python_env", fake_ensure)
    monkeypatch.setattr(system, "_stream_subprocess", fake_stream)

    result = asyncio.run(system.run_python_script({"code": "print('ok')"}))

    assert result["ok"] is True
    assert result["stdout"] == "ok\n"
    assert result["envId"] == system.DEFAULT_PYTHON_ENV_ID
    assert result["python"] == py_bin
    assert ensure_calls == [system.DEFAULT_PYTHON_ENV_ID]


def test_store_stub_detected_by_windowsapps_path(monkeypatch):
    monkeypatch.setattr(system.sys, "platform", "win32")
    stub = r"C:\Users\dad\AppData\Local\Microsoft\WindowsApps\python.exe"
    assert system._is_windows_store_python_stub(stub) is True


def test_store_stub_not_flagged_for_real_path(monkeypatch):
    monkeypatch.setattr(system.sys, "platform", "win32")
    real = r"C:\Users\dad\AppData\Local\Programs\Python\Python312\python.exe"
    # Real install path under Programs is never a WindowsApps alias. (0-byte
    # reparse check is skipped here because the file doesn't exist.)
    assert system._is_windows_store_python_stub(real) is False


def test_store_stub_ignored_off_windows(monkeypatch):
    monkeypatch.setattr(system.sys, "platform", "linux")
    assert system._is_windows_store_python_stub("/usr/bin/python3") is False


def test_python_interpreter_works_rejects_stub(monkeypatch):
    monkeypatch.setattr(system.os.path, "exists", lambda p: True)
    monkeypatch.setattr(system, "_is_windows_store_python_stub", lambda p: True)
    # Must short-circuit on the stub without ever spawning a subprocess.
    def _boom(*a, **k):
        raise AssertionError("subprocess should not run for a known stub")
    monkeypatch.setattr(system.subprocess, "run", _boom)
    assert system._python_interpreter_works(r"C:\stub\python.exe") is False


def test_real_interpreter_validates():
    # The interpreter running these tests is real and must validate.
    assert system._python_interpreter_works(system.sys.executable) is True


def test_platform_pbs_triple_known_platforms(monkeypatch):
    monkeypatch.setattr(system.sys, "platform", "win32")
    monkeypatch.setattr(system.platform, "machine", lambda: "AMD64")
    assert system._platform_pbs_triple() == "x86_64-pc-windows-msvc"

    monkeypatch.setattr(system.sys, "platform", "darwin")
    monkeypatch.setattr(system.platform, "machine", lambda: "arm64")
    assert system._platform_pbs_triple() == "aarch64-apple-darwin"

    monkeypatch.setattr(system.sys, "platform", "linux")
    monkeypatch.setattr(system.platform, "machine", lambda: "x86_64")
    assert system._platform_pbs_triple() == "x86_64-unknown-linux-gnu"


def test_select_pbs_asset_prefers_3_12_and_install_only():
    assets = [
        {"name": "cpython-3.10.20+20260623-x86_64-pc-windows-msvc-install_only.tar.gz",
         "browser_download_url": "https://x/310"},
        {"name": "cpython-3.12.11+20260623-x86_64-pc-windows-msvc-install_only.tar.gz",
         "browser_download_url": "https://x/312"},
        {"name": "cpython-3.12.11+20260623-x86_64-pc-windows-msvc-full.tar.zst",
         "browser_download_url": "https://x/full"},
        {"name": "cpython-3.12.11+20260623-aarch64-apple-darwin-install_only.tar.gz",
         "browser_download_url": "https://x/mac"},
    ]
    url = system._select_pbs_asset_url(assets, "x86_64-pc-windows-msvc")
    assert url == "https://x/312"


def test_ensure_python_env_provisions_when_no_system_python(monkeypatch):
    native = os.path.join(os.sep, "managed", "python")
    python_bin = os.path.join(native, "python.exe")
    provision_calls = []

    monkeypatch.setattr(system, "_native_python_env_dir", lambda *a, **k: "")
    monkeypatch.setattr(system, "_python_env_dir", lambda env_id: os.path.join(os.sep, "envs", env_id))
    monkeypatch.setattr(system, "_python_env_bin", lambda env_dir: python_bin)
    # Default env not created yet, then created after venv command.
    exists_state = {"created": False}
    monkeypatch.setattr(system.os.path, "exists", lambda p: p == python_bin and exists_state["created"])
    monkeypatch.setattr(system.os, "makedirs", lambda *a, **k: None)
    monkeypatch.setattr(system, "_get_system_python", lambda: "")  # no system python

    async def fake_provision(emit=None):
        provision_calls.append(True)
        exists_state["created"] = True
        return os.path.join(os.sep, "managed", "runtime", "python", "python.exe")

    monkeypatch.setattr(system, "_provision_managed_python", fake_provision)
    monkeypatch.setattr(system, "_cached_pip_ok", {os.path.join(os.sep, "envs", system.DEFAULT_PYTHON_ENV_ID)})

    def fake_run(cmd, *a, **k):
        exists_state["created"] = True
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(system.subprocess, "run", fake_run)

    asyncio.run(system._ensure_python_env(system.DEFAULT_PYTHON_ENV_ID))
    assert provision_calls == [True]


def test_run_python_script_honors_named_env(monkeypatch):
    ensure_calls = []
    py_bin = "analysis-python"

    async def fake_ensure(env_id, emit=None):
        ensure_calls.append(env_id)
        return f"env-{env_id}", py_bin

    async def fake_stream(argv, **kwargs):
        return 0, "", "", False

    monkeypatch.setattr(system, "_ensure_python_env", fake_ensure)
    monkeypatch.setattr(system, "_stream_subprocess", fake_stream)

    result = asyncio.run(system.run_python_script({"envId": "analysis", "code": "pass"}))

    assert result["ok"] is True
    assert result["envId"] == "analysis"
    assert ensure_calls == ["analysis"]
