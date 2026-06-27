import asyncio
import json
import os
from pathlib import Path
import subprocess
import tempfile

_repo_root = Path(__file__).resolve().parents[3]
_test_tmp_root = _repo_root / ".codex-pytest-tmp"
_test_tmp_root.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("AGENT_DATA_DIR", tempfile.mkdtemp(prefix="stuard-agent-test-", dir=str(_test_tmp_root)))

from app.tools import desktop_control

AGENT_ROOT = Path(__file__).resolve().parents[1]


def _run(coro):
    return asyncio.run(coro)


def _completed(stdout="", stderr="", returncode=0):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


def test_set_wallpaper_rejects_missing_file(tmp_path):
    missing = tmp_path / "missing.png"
    result = _run(desktop_control.set_desktop_wallpaper({"path": str(missing)}))

    assert result["ok"] is False
    assert result["error"] == "wallpaper_file_not_found"
    assert result["path"] == str(missing)


def test_linux_volume_uses_pactl(monkeypatch):
    monkeypatch.setattr(desktop_control.sys, "platform", "linux")
    monkeypatch.setattr(desktop_control, "_which", lambda name: f"/usr/bin/{name}" if name == "pactl" else None)

    async def fake_run(argv, **kwargs):
        if argv[1] == "get-sink-volume":
            return _completed("Volume: front-left: 27525 /  42% / -22.50 dB")
        if argv[1] == "get-sink-mute":
            return _completed("Mute: no")
        raise AssertionError(f"unexpected argv: {argv}")

    monkeypatch.setattr(desktop_control, "_run", fake_run)

    result = _run(desktop_control.get_system_volume({}))

    assert result["ok"] is True
    assert result["volume"] == 42
    assert result["muted"] is False
    assert result["backend"] == "pactl"


def test_linux_bluetoothctl_device_parsing(monkeypatch):
    monkeypatch.setattr(desktop_control.sys, "platform", "linux")
    monkeypatch.setattr(desktop_control, "_which", lambda name: "/usr/bin/bluetoothctl" if name == "bluetoothctl" else None)

    async def fake_run(argv, **kwargs):
        if argv[1] == "devices":
            return _completed("Device AA:BB:CC:DD:EE:FF Keyboard\n")
        if argv[1] == "info":
            return _completed("Name: Keyboard\nPaired: yes\nConnected: no\nTrusted: yes\n")
        raise AssertionError(f"unexpected argv: {argv}")

    monkeypatch.setattr(desktop_control, "_run", fake_run)

    result = _run(desktop_control.list_bluetooth_devices({}))

    assert result["ok"] is True
    assert result["count"] == 1
    assert result["devices"][0]["address"] == "AA:BB:CC:DD:EE:FF"
    assert result["devices"][0]["paired"] is True
    assert result["devices"][0]["connected"] is False


def test_windows_bluetooth_address_parsing(monkeypatch):
    monkeypatch.setattr(desktop_control.sys, "platform", "win32")
    payload = {
        "FriendlyName": "Headphones",
        "InstanceId": r"BTHENUM\DEV_AABBCCDDEEFF\7&abc",
        "Status": "OK",
        "Class": "Bluetooth",
    }

    async def fake_powershell(script, **kwargs):
        return _completed(json.dumps(payload))

    monkeypatch.setattr(desktop_control, "_run_powershell", fake_powershell)

    result = _run(desktop_control.list_bluetooth_devices({}))

    assert result["ok"] is True
    assert result["devices"][0]["name"] == "Headphones"
    assert result["devices"][0]["address"] == "AA:BB:CC:DD:EE:FF"


def test_desktop_control_tools_are_registered():
    dispatch_source = (AGENT_ROOT / "app" / "tools" / "dispatch.py").read_text(encoding="utf-8")

    assert '"set_system_volume": ("desktop"' in dispatch_source
    assert '"get_power_status": desktop_control.get_power_status' in dispatch_source


def test_desktop_control_tools_are_stubbed_on_vm():
    dispatch_vm_source = (AGENT_ROOT / "app" / "tools" / "dispatch_vm.py").read_text(encoding="utf-8")

    assert '"set_system_volume": ("desktop"' in dispatch_vm_source
    assert '"set_system_volume"' in dispatch_vm_source
    assert "_DESKTOP_ONLY_STUBS" in dispatch_vm_source
