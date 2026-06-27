from __future__ import annotations

import asyncio
import base64
import ctypes
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


def _platform_id() -> str:
    if sys.platform.startswith("win"):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    return sys.platform


def _ok(**values: Any) -> Dict[str, Any]:
    return {"ok": True, "platform": _platform_id(), **values}


def _error(error: str, **values: Any) -> Dict[str, Any]:
    return {"ok": False, "platform": _platform_id(), "error": error, **values}


def _which(name: str) -> Optional[str]:
    try:
        return shutil.which(name)
    except Exception:
        return None


async def _run(
    argv: List[str],
    *,
    input_text: Optional[str] = None,
    timeout: float = 15.0,
) -> subprocess.CompletedProcess[str]:
    return await asyncio.to_thread(
        subprocess.run,
        argv,
        input=input_text,
        text=True,
        capture_output=True,
        timeout=timeout,
        shell=False,
    )


def _powershell_exe() -> Optional[str]:
    return _which("pwsh") or _which("powershell") or ("powershell.exe" if sys.platform.startswith("win") else None)


async def _run_powershell(script: str, *, timeout: float = 20.0) -> subprocess.CompletedProcess[str]:
    exe = _powershell_exe()
    if not exe:
        raise RuntimeError("powershell_not_found")
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    return await _run(
        [exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
        timeout=timeout,
    )


def _loads_json(text: str) -> Any:
    raw = (text or "").strip()
    if not raw:
        return None
    return json.loads(raw)


def _coerce_percent(value: Any, *, field: str = "percent") -> int:
    try:
        number = float(value)
    except Exception as exc:
        raise ValueError(f"invalid_{field}") from exc
    if number < 0:
        number = 0
    if number > 100:
        number = 100
    return int(round(number))


def _path_arg(args: Dict[str, Any]) -> Optional[str]:
    for key in ("path", "imagePath", "filePath"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return os.path.abspath(os.path.expanduser(value.strip()))
    return None


def _strip_file_uri(value: str) -> str:
    text = value.strip().strip("'\"")
    if text.startswith("file://"):
        try:
            from urllib.parse import unquote, urlparse

            parsed = urlparse(text)
            return unquote(parsed.path)
        except Exception:
            return text[7:]
    return text


def _escape_applescript(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _format_bluetooth_address(raw: str) -> str:
    text = re.sub(r"[^0-9A-Fa-f]", "", raw or "")
    if len(text) == 12:
        return ":".join(text[i : i + 2] for i in range(0, 12, 2)).upper()
    return raw


async def describe_desktop_control_capabilities(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    platform_id = _platform_id()

    if platform_id == "windows":
        capabilities = {
            "wallpaper": {"supported": True, "backend": "win32"},
            "volume": {"supported": bool(_powershell_exe()), "backend": "windows_core_audio"},
            "bluetooth": {
                "list": bool(_powershell_exe()),
                "connect": False,
                "disconnect": False,
                "backend": "powershell_pnp",
                "note": "Windows has built-in paired-device listing, but no safe built-in CLI for connect/disconnect.",
            },
            "brightness": {"supported": bool(_powershell_exe()), "backend": "wmi"},
            "power": {"supported": bool(_powershell_exe()), "backend": "win32_battery"},
        }
    elif platform_id == "macos":
        capabilities = {
            "wallpaper": {"supported": bool(_which("osascript")), "backend": "osascript"},
            "volume": {"supported": bool(_which("osascript")), "backend": "osascript"},
            "bluetooth": {
                "list": bool(_which("blueutil") or _which("system_profiler")),
                "connect": bool(_which("blueutil")),
                "disconnect": bool(_which("blueutil")),
                "backend": "blueutil",
            },
            "brightness": {"supported": bool(_which("brightness")), "backend": "brightness"},
            "power": {"supported": bool(_which("pmset")), "backend": "pmset"},
        }
    elif platform_id == "linux":
        backlight_dirs = _linux_backlight_dirs()
        capabilities = {
            "wallpaper": {
                "supported": bool(_which("gsettings") or _which("plasma-apply-wallpaperimage") or _which("xfconf-query")),
                "backend": "gsettings/plasma/xfconf",
            },
            "volume": {"supported": bool(_which("pactl") or _which("amixer")), "backend": "pactl/amixer"},
            "bluetooth": {
                "list": bool(_which("bluetoothctl")),
                "connect": bool(_which("bluetoothctl")),
                "disconnect": bool(_which("bluetoothctl")),
                "backend": "bluetoothctl",
            },
            "brightness": {"supported": bool(_which("brightnessctl") or backlight_dirs), "backend": "brightnessctl/sysfs"},
            "power": {"supported": bool(_linux_power_supply_dirs()), "backend": "sysfs"},
        }
    else:
        capabilities = {
            "wallpaper": {"supported": False},
            "volume": {"supported": False},
            "bluetooth": {"list": False, "connect": False, "disconnect": False},
            "brightness": {"supported": False},
            "power": {"supported": False},
        }

    tools = [
        "get_desktop_wallpaper",
        "set_desktop_wallpaper",
        "get_system_volume",
        "set_system_volume",
        "list_bluetooth_devices",
        "connect_bluetooth_device",
        "disconnect_bluetooth_device",
        "get_display_brightness",
        "set_display_brightness",
        "get_power_status",
    ]
    return _ok(capabilities=capabilities, tools=tools)


async def get_desktop_wallpaper(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    platform_id = _platform_id()
    try:
        if platform_id == "windows":
            user32 = ctypes.windll.user32
            SPI_GETDESKWALLPAPER = 0x0073
            buf = ctypes.create_unicode_buffer(32768)
            ok = bool(user32.SystemParametersInfoW(SPI_GETDESKWALLPAPER, len(buf), buf, 0))
            if not ok:
                return _error("wallpaper_get_failed")
            value = buf.value or ""
            return _ok(wallpaper=value, wallpapers=[value] if value else [], backend="win32")

        if platform_id == "macos":
            if not _which("osascript"):
                return _error("osascript_not_found")
            script = """
set paths to {}
tell application "System Events"
    repeat with d in desktops
        copy (picture of d as text) to end of paths
    end repeat
end tell
set AppleScript's text item delimiters to linefeed
return paths as text
""".strip()
            completed = await _run(["osascript", "-e", script])
            if completed.returncode != 0:
                return _error("wallpaper_get_failed", stderr=completed.stderr.strip())
            wallpapers = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
            return _ok(wallpaper=wallpapers[0] if wallpapers else "", wallpapers=wallpapers, backend="osascript")

        if platform_id == "linux":
            gsettings = _which("gsettings")
            if gsettings:
                completed = await _run([gsettings, "get", "org.gnome.desktop.background", "picture-uri"])
                if completed.returncode == 0:
                    wallpaper = _strip_file_uri(completed.stdout)
                    wallpapers = [wallpaper] if wallpaper else []
                    dark = await _run([gsettings, "get", "org.gnome.desktop.background", "picture-uri-dark"])
                    if dark.returncode == 0:
                        dark_value = _strip_file_uri(dark.stdout)
                        if dark_value and dark_value not in wallpapers:
                            wallpapers.append(dark_value)
                    return _ok(wallpaper=wallpaper, wallpapers=wallpapers, backend="gsettings")
            xfconf = _which("xfconf-query")
            if xfconf:
                prop = "/backdrop/screen0/monitor0/workspace0/last-image"
                completed = await _run([xfconf, "-c", "xfce4-desktop", "-p", prop])
                if completed.returncode == 0:
                    wallpaper = completed.stdout.strip()
                    return _ok(wallpaper=wallpaper, wallpapers=[wallpaper] if wallpaper else [], backend="xfconf-query")
            return _error("wallpaper_backend_not_found")

        return _error("unsupported_platform")
    except Exception as exc:
        return _error(str(exc))


async def set_desktop_wallpaper(args: Dict[str, Any]) -> Dict[str, Any]:
    path = _path_arg(args or {})
    if not path:
        return _error("missing_path")
    if not os.path.isfile(path):
        return _error("wallpaper_file_not_found", path=path)

    style = str((args or {}).get("style") or "fill").strip().lower()
    platform_id = _platform_id()

    try:
        if platform_id == "windows":
            try:
                import winreg

                style_map = {
                    "center": ("0", "0"),
                    "tile": ("0", "1"),
                    "stretch": ("2", "0"),
                    "fit": ("6", "0"),
                    "fill": ("10", "0"),
                    "span": ("22", "0"),
                }
                wallpaper_style, tile = style_map.get(style, style_map["fill"])
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Control Panel\Desktop", 0, winreg.KEY_SET_VALUE) as key:
                    winreg.SetValueEx(key, "WallpaperStyle", 0, winreg.REG_SZ, wallpaper_style)
                    winreg.SetValueEx(key, "TileWallpaper", 0, winreg.REG_SZ, tile)
            except Exception:
                pass

            SPI_SETDESKWALLPAPER = 0x0014
            SPIF_UPDATEINIFILE = 0x0001
            SPIF_SENDCHANGE = 0x0002
            ok = bool(ctypes.windll.user32.SystemParametersInfoW(
                SPI_SETDESKWALLPAPER,
                0,
                path,
                SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
            ))
            if not ok:
                return _error("wallpaper_set_failed", path=path)
            return _ok(path=path, style=style, backend="win32")

        if platform_id == "macos":
            if not _which("osascript"):
                return _error("osascript_not_found", path=path)
            escaped = _escape_applescript(path)
            script = f"""
tell application "System Events"
    repeat with d in desktops
        set picture of d to POSIX file "{escaped}"
    end repeat
end tell
""".strip()
            completed = await _run(["osascript", "-e", script])
            if completed.returncode != 0:
                return _error("wallpaper_set_failed", path=path, stderr=completed.stderr.strip())
            return _ok(path=path, backend="osascript")

        if platform_id == "linux":
            file_uri = Path(path).as_uri()
            gsettings = _which("gsettings")
            if gsettings:
                first = await _run([gsettings, "set", "org.gnome.desktop.background", "picture-uri", file_uri])
                second = await _run([gsettings, "set", "org.gnome.desktop.background", "picture-uri-dark", file_uri])
                if first.returncode == 0:
                    return _ok(path=path, backend="gsettings", darkModeUpdated=second.returncode == 0)

            plasma = _which("plasma-apply-wallpaperimage")
            if plasma:
                completed = await _run([plasma, path])
                if completed.returncode == 0:
                    return _ok(path=path, backend="plasma-apply-wallpaperimage")

            xfconf = _which("xfconf-query")
            if xfconf:
                prop = "/backdrop/screen0/monitor0/workspace0/last-image"
                completed = await _run([xfconf, "-c", "xfce4-desktop", "-p", prop, "-s", path])
                if completed.returncode == 0:
                    return _ok(path=path, backend="xfconf-query")

            return _error("wallpaper_backend_not_found", path=path)

        return _error("unsupported_platform", path=path)
    except Exception as exc:
        return _error(str(exc), path=path)


_WINDOWS_AUDIO_TYPES = r"""
using System;
using System.Runtime.InteropServices;
namespace StuardAudio {
  public enum EDataFlow { eRender, eCapture, eAll }
  public enum ERole { eConsole, eMultimedia, eCommunications }
  [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ComImport]
  public class MMDeviceEnumerator {}
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out int pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute(bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
    int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
    int VolumeStepUp(Guid pguidEventContext);
    int VolumeStepDown(Guid pguidEventContext);
    int QueryHardwareSupport(out uint pdwHardwareSupportMask);
    int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
  }
  public class Audio {
    public static IAudioEndpointVolume Endpoint() {
      var enumerator = new MMDeviceEnumerator() as IMMDeviceEnumerator;
      IMMDevice dev;
      int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out dev);
      if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      Guid iid = typeof(IAudioEndpointVolume).GUID;
      IAudioEndpointVolume ep;
      hr = dev.Activate(ref iid, 23, IntPtr.Zero, out ep);
      if (hr != 0) Marshal.ThrowExceptionForHR(hr);
      return ep;
    }
  }
}
"""


async def _windows_get_volume() -> Dict[str, Any]:
    script = f"""
Add-Type -TypeDefinition @'
{_WINDOWS_AUDIO_TYPES}
'@
$ep = [StuardAudio.Audio]::Endpoint()
$vol = 0.0
$muted = $false
[void]$ep.GetMasterVolumeLevelScalar([ref]$vol)
[void]$ep.GetMute([ref]$muted)
[pscustomobject]@{{ok=$true; volume=[math]::Round($vol * 100, 1); muted=$muted; backend='windows_core_audio'}} | ConvertTo-Json -Compress
""".strip()
    completed = await _run_powershell(script)
    if completed.returncode != 0:
        return _error("volume_get_failed", stderr=completed.stderr.strip())
    data = _loads_json(completed.stdout) or {}
    return _ok(volume=data.get("volume"), muted=bool(data.get("muted")), backend="windows_core_audio")


async def _windows_set_volume(level: Optional[int], muted: Optional[bool]) -> Dict[str, Any]:
    level_script = ""
    if level is not None:
        scalar = max(0.0, min(1.0, level / 100.0))
        level_script = f"[void]$ep.SetMasterVolumeLevelScalar({scalar}, [Guid]::Empty)"
    mute_script = ""
    if muted is not None:
        mute_script = f"[void]$ep.SetMute(${str(bool(muted)).lower()}, [Guid]::Empty)"
    script = f"""
Add-Type -TypeDefinition @'
{_WINDOWS_AUDIO_TYPES}
'@
$ep = [StuardAudio.Audio]::Endpoint()
{level_script}
{mute_script}
$vol = 0.0
$isMuted = $false
[void]$ep.GetMasterVolumeLevelScalar([ref]$vol)
[void]$ep.GetMute([ref]$isMuted)
[pscustomobject]@{{ok=$true; volume=[math]::Round($vol * 100, 1); muted=$isMuted; backend='windows_core_audio'}} | ConvertTo-Json -Compress
""".strip()
    completed = await _run_powershell(script)
    if completed.returncode != 0:
        return _error("volume_set_failed", stderr=completed.stderr.strip())
    data = _loads_json(completed.stdout) or {}
    return _ok(volume=data.get("volume"), muted=bool(data.get("muted")), backend="windows_core_audio")


async def _macos_get_volume() -> Dict[str, Any]:
    completed = await _run(["osascript", "-e", "get volume settings"])
    if completed.returncode != 0:
        return _error("volume_get_failed", stderr=completed.stderr.strip())
    out = completed.stdout.strip()
    volume_match = re.search(r"output volume:(\d+)", out)
    muted_match = re.search(r"output muted:(true|false)", out, re.I)
    return _ok(
        volume=int(volume_match.group(1)) if volume_match else None,
        muted=(muted_match.group(1).lower() == "true") if muted_match else None,
        backend="osascript",
    )


async def _macos_set_volume(level: Optional[int], muted: Optional[bool]) -> Dict[str, Any]:
    if level is not None:
        completed = await _run(["osascript", "-e", f"set volume output volume {level}"])
        if completed.returncode != 0:
            return _error("volume_set_failed", stderr=completed.stderr.strip())
    if muted is not None:
        command = "set volume with output muted" if muted else "set volume without output muted"
        completed = await _run(["osascript", "-e", command])
        if completed.returncode != 0:
            return _error("volume_mute_failed", stderr=completed.stderr.strip())
    return await _macos_get_volume()


async def _linux_get_volume() -> Dict[str, Any]:
    pactl = _which("pactl")
    if pactl:
        vol = await _run([pactl, "get-sink-volume", "@DEFAULT_SINK@"])
        mute = await _run([pactl, "get-sink-mute", "@DEFAULT_SINK@"])
        if vol.returncode == 0:
            match = re.search(r"(\d+)%", vol.stdout)
            muted = None
            if mute.returncode == 0:
                muted = "yes" in mute.stdout.lower()
            return _ok(volume=int(match.group(1)) if match else None, muted=muted, backend="pactl")

    amixer = _which("amixer")
    if amixer:
        completed = await _run([amixer, "get", "Master"])
        if completed.returncode == 0:
            volume_match = re.search(r"\[(\d+)%\]", completed.stdout)
            muted = "[off]" in completed.stdout.lower()
            return _ok(volume=int(volume_match.group(1)) if volume_match else None, muted=muted, backend="amixer")

    return _error("volume_backend_not_found")


async def _linux_set_volume(level: Optional[int], muted: Optional[bool]) -> Dict[str, Any]:
    pactl = _which("pactl")
    if pactl:
        if level is not None:
            completed = await _run([pactl, "set-sink-volume", "@DEFAULT_SINK@", f"{level}%"])
            if completed.returncode != 0:
                return _error("volume_set_failed", stderr=completed.stderr.strip(), backend="pactl")
        if muted is not None:
            completed = await _run([pactl, "set-sink-mute", "@DEFAULT_SINK@", "1" if muted else "0"])
            if completed.returncode != 0:
                return _error("volume_mute_failed", stderr=completed.stderr.strip(), backend="pactl")
        return await _linux_get_volume()

    amixer = _which("amixer")
    if amixer:
        if level is not None:
            completed = await _run([amixer, "set", "Master", f"{level}%"])
            if completed.returncode != 0:
                return _error("volume_set_failed", stderr=completed.stderr.strip(), backend="amixer")
        if muted is not None:
            completed = await _run([amixer, "set", "Master", "mute" if muted else "unmute"])
            if completed.returncode != 0:
                return _error("volume_mute_failed", stderr=completed.stderr.strip(), backend="amixer")
        return await _linux_get_volume()

    return _error("volume_backend_not_found")


async def get_system_volume(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    try:
        platform_id = _platform_id()
        if platform_id == "windows":
            return await _windows_get_volume()
        if platform_id == "macos":
            return await _macos_get_volume()
        if platform_id == "linux":
            return await _linux_get_volume()
        return _error("unsupported_platform")
    except Exception as exc:
        return _error(str(exc))


async def set_system_volume(args: Dict[str, Any]) -> Dict[str, Any]:
    args = args or {}
    level: Optional[int] = None
    muted: Optional[bool] = None

    try:
        for key in ("level", "volume", "percent"):
            if key in args and args.get(key) is not None:
                level = _coerce_percent(args.get(key), field=key)
                break

        if "delta" in args and args.get("delta") is not None:
            current = await get_system_volume({})
            if not current.get("ok"):
                return current
            current_level = current.get("volume")
            if isinstance(current_level, (int, float)):
                level = _coerce_percent(float(current_level) + float(args.get("delta")), field="delta")
            else:
                return _error("current_volume_unknown")
    except Exception as exc:
        return _error(str(exc))

    if "muted" in args and args.get("muted") is not None:
        muted = bool(args.get("muted"))
    elif "mute" in args and args.get("mute") is not None:
        muted = bool(args.get("mute"))

    if level is None and muted is None:
        return _error("missing_volume_or_mute")

    try:
        platform_id = _platform_id()
        if platform_id == "windows":
            return await _windows_set_volume(level, muted)
        if platform_id == "macos":
            return await _macos_set_volume(level, muted)
        if platform_id == "linux":
            return await _linux_set_volume(level, muted)
        return _error("unsupported_platform")
    except Exception as exc:
        return _error(str(exc))


async def _windows_list_bluetooth() -> Dict[str, Any]:
    script = r"""
$items = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue |
  Select-Object FriendlyName, InstanceId, Status, Class
if ($null -eq $items) { $items = @() }
$items | ConvertTo-Json -Compress -Depth 4
""".strip()
    completed = await _run_powershell(script)
    if completed.returncode != 0:
        return _error("bluetooth_list_failed", stderr=completed.stderr.strip())
    parsed = _loads_json(completed.stdout)
    rows = parsed if isinstance(parsed, list) else ([parsed] if isinstance(parsed, dict) else [])
    devices = []
    for row in rows:
        instance_id = str(row.get("InstanceId") or "")
        address_match = re.search(r"DEV_([0-9A-Fa-f]{12})", instance_id)
        devices.append({
            "id": instance_id,
            "name": str(row.get("FriendlyName") or "").strip() or instance_id,
            "address": _format_bluetooth_address(address_match.group(1)) if address_match else None,
            "status": row.get("Status"),
            "paired": True,
            "connected": None,
        })
    return _ok(devices=devices, count=len(devices), backend="powershell_pnp")


def _parse_blueutil_lines(text: str) -> List[Dict[str, Any]]:
    devices: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        fields: Dict[str, Any] = {}
        for part in re.split(r",\s*", stripped):
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            fields[key.strip()] = value.strip().strip('"')
        address = fields.get("address") or fields.get("mac")
        name = fields.get("name") or stripped
        devices.append({
            "id": address or name,
            "address": address,
            "name": name,
            "paired": str(fields.get("paired", "")).lower() in ("1", "true", "yes"),
            "connected": str(fields.get("connected", "")).lower() in ("1", "true", "yes"),
            "raw": stripped,
        })
    return devices


async def _macos_list_bluetooth() -> Dict[str, Any]:
    blueutil = _which("blueutil")
    if blueutil:
        completed = await _run([blueutil, "--paired", "--format", "json"])
        if completed.returncode == 0:
            try:
                parsed = _loads_json(completed.stdout)
                rows = parsed if isinstance(parsed, list) else []
                devices = [{
                    "id": str(row.get("address") or row.get("name") or ""),
                    "address": row.get("address"),
                    "name": row.get("name") or row.get("address"),
                    "paired": row.get("paired", True),
                    "connected": row.get("connected"),
                    "raw": row,
                } for row in rows]
                return _ok(devices=devices, count=len(devices), backend="blueutil")
            except Exception:
                pass
        completed = await _run([blueutil, "--paired"])
        if completed.returncode == 0:
            devices = _parse_blueutil_lines(completed.stdout)
            return _ok(devices=devices, count=len(devices), backend="blueutil")

    profiler = _which("system_profiler")
    if profiler:
        completed = await _run([profiler, "SPBluetoothDataType", "-json"], timeout=30)
        if completed.returncode == 0:
            return _ok(devices=[], count=0, backend="system_profiler", raw=_loads_json(completed.stdout))

    return _error("bluetooth_backend_not_found")


def _parse_bluetoothctl_info(text: str) -> Dict[str, Any]:
    info: Dict[str, Any] = {}
    for line in (text or "").splitlines():
        stripped = line.strip()
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        normalized = key.strip().lower().replace(" ", "_")
        value = value.strip()
        if normalized in {"paired", "connected", "trusted", "blocked"}:
            info[normalized] = value.lower() == "yes"
        else:
            info[normalized] = value
    return info


async def _linux_list_bluetooth() -> Dict[str, Any]:
    bluetoothctl = _which("bluetoothctl")
    if not bluetoothctl:
        return _error("bluetoothctl_not_found")
    completed = await _run([bluetoothctl, "devices"])
    if completed.returncode != 0:
        return _error("bluetooth_list_failed", stderr=completed.stderr.strip())
    devices = []
    for line in completed.stdout.splitlines():
        match = re.match(r"Device\s+([0-9A-Fa-f:]{17})\s+(.+)$", line.strip())
        if not match:
            continue
        address, name = match.groups()
        detail = await _run([bluetoothctl, "info", address], timeout=8)
        info = _parse_bluetoothctl_info(detail.stdout) if detail.returncode == 0 else {}
        devices.append({
            "id": address,
            "address": address,
            "name": info.get("name") or name.strip(),
            "paired": info.get("paired"),
            "connected": info.get("connected"),
            "trusted": info.get("trusted"),
            "status": "connected" if info.get("connected") else "available",
            "raw": info or None,
        })
    return _ok(devices=devices, count=len(devices), backend="bluetoothctl")


async def list_bluetooth_devices(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    try:
        platform_id = _platform_id()
        if platform_id == "windows":
            return await _windows_list_bluetooth()
        if platform_id == "macos":
            return await _macos_list_bluetooth()
        if platform_id == "linux":
            return await _linux_list_bluetooth()
        return _error("unsupported_platform")
    except Exception as exc:
        return _error(str(exc))


def _bluetooth_target(args: Dict[str, Any]) -> str:
    for key in ("address", "id", "deviceId", "mac"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


async def _bluetoothctl_action(action: str, target: str) -> Dict[str, Any]:
    bluetoothctl = _which("bluetoothctl")
    if not bluetoothctl:
        return _error("bluetoothctl_not_found")
    completed = await _run([bluetoothctl, action, target], timeout=30)
    ok = completed.returncode == 0 and "failed" not in completed.stdout.lower()
    return _ok(
        connected=action == "connect" if ok else None,
        target=target,
        backend="bluetoothctl",
        stdout=completed.stdout.strip(),
        stderr=completed.stderr.strip(),
    ) if ok else _error(f"bluetooth_{action}_failed", target=target, stdout=completed.stdout.strip(), stderr=completed.stderr.strip())


async def _blueutil_action(action: str, target: str) -> Dict[str, Any]:
    blueutil = _which("blueutil")
    if not blueutil:
        return _error("blueutil_not_found")
    flag = "--connect" if action == "connect" else "--disconnect"
    completed = await _run([blueutil, flag, target], timeout=30)
    if completed.returncode != 0:
        return _error(f"bluetooth_{action}_failed", target=target, stderr=completed.stderr.strip(), stdout=completed.stdout.strip())
    return _ok(target=target, connected=action == "connect", backend="blueutil", stdout=completed.stdout.strip())


async def connect_bluetooth_device(args: Dict[str, Any]) -> Dict[str, Any]:
    target = _bluetooth_target(args or {})
    if not target:
        return _error("missing_bluetooth_device")
    try:
        platform_id = _platform_id()
        if platform_id == "linux":
            return await _bluetoothctl_action("connect", target)
        if platform_id == "macos":
            return await _blueutil_action("connect", target)
        if platform_id == "windows":
            if bool((args or {}).get("openSettings")):
                try:
                    os.startfile("ms-settings:bluetooth")  # type: ignore[attr-defined]
                except Exception:
                    pass
            return _error(
                "bluetooth_connect_not_supported",
                target=target,
                backend="powershell_pnp",
                reason="Windows does not provide a reliable built-in noninteractive Bluetooth connect command.",
            )
        return _error("unsupported_platform", target=target)
    except Exception as exc:
        return _error(str(exc), target=target)


async def disconnect_bluetooth_device(args: Dict[str, Any]) -> Dict[str, Any]:
    target = _bluetooth_target(args or {})
    if not target:
        return _error("missing_bluetooth_device")
    try:
        platform_id = _platform_id()
        if platform_id == "linux":
            return await _bluetoothctl_action("disconnect", target)
        if platform_id == "macos":
            return await _blueutil_action("disconnect", target)
        if platform_id == "windows":
            return _error(
                "bluetooth_disconnect_not_supported",
                target=target,
                backend="powershell_pnp",
                reason="Windows does not provide a reliable built-in noninteractive Bluetooth disconnect command.",
            )
        return _error("unsupported_platform", target=target)
    except Exception as exc:
        return _error(str(exc), target=target)


def _linux_backlight_dirs() -> List[Path]:
    root = Path("/sys/class/backlight")
    try:
        return [p for p in root.iterdir() if p.is_dir()]
    except Exception:
        return []


def _linux_power_supply_dirs() -> List[Path]:
    root = Path("/sys/class/power_supply")
    try:
        return [p for p in root.iterdir() if p.is_dir()]
    except Exception:
        return []


async def get_display_brightness(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    try:
        platform_id = _platform_id()
        if platform_id == "windows":
            script = r"""
$items = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue |
  Select-Object InstanceName, CurrentBrightness
$items | ConvertTo-Json -Compress -Depth 3
""".strip()
            completed = await _run_powershell(script)
            if completed.returncode != 0:
                return _error("brightness_get_failed", stderr=completed.stderr.strip())
            parsed = _loads_json(completed.stdout)
            rows = parsed if isinstance(parsed, list) else ([parsed] if isinstance(parsed, dict) else [])
            displays = [{"id": row.get("InstanceName"), "brightness": row.get("CurrentBrightness")} for row in rows]
            primary = displays[0]["brightness"] if displays else None
            return _ok(brightness=primary, displays=displays, backend="wmi")

        if platform_id == "macos":
            brightness = _which("brightness")
            if not brightness:
                return _error("brightness_backend_not_found", hint="Install the 'brightness' CLI to control display brightness on macOS.")
            completed = await _run([brightness, "-l"])
            if completed.returncode != 0:
                return _error("brightness_get_failed", stderr=completed.stderr.strip())
            matches = re.findall(r"brightness\s+([0-9.]+)", completed.stdout)
            values = [round(float(v) * 100) for v in matches]
            return _ok(brightness=values[0] if values else None, displays=[{"brightness": v} for v in values], backend="brightness")

        if platform_id == "linux":
            brightnessctl = _which("brightnessctl")
            if brightnessctl:
                current = await _run([brightnessctl, "get"])
                maximum = await _run([brightnessctl, "max"])
                if current.returncode == 0 and maximum.returncode == 0:
                    cur = float(current.stdout.strip())
                    max_value = float(maximum.stdout.strip())
                    percent = round((cur / max_value) * 100) if max_value else None
                    return _ok(brightness=percent, backend="brightnessctl")

            displays = []
            for folder in _linux_backlight_dirs():
                try:
                    cur = float((folder / "brightness").read_text().strip())
                    max_value = float((folder / "max_brightness").read_text().strip())
                    displays.append({"id": folder.name, "brightness": round((cur / max_value) * 100) if max_value else None})
                except Exception:
                    continue
            if displays:
                return _ok(brightness=displays[0].get("brightness"), displays=displays, backend="sysfs")
            return _error("brightness_backend_not_found")

        return _error("unsupported_platform")
    except Exception as exc:
        return _error(str(exc))


async def set_display_brightness(args: Dict[str, Any]) -> Dict[str, Any]:
    args = args or {}
    raw_percent = args.get("percent", args.get("brightness"))
    if raw_percent is None:
        return _error("missing_brightness")
    try:
        percent = _coerce_percent(raw_percent, field="brightness")
    except Exception as exc:
        return _error(str(exc))
    try:
        platform_id = _platform_id()
        if platform_id == "windows":
            script = f"""
$methods = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue
foreach ($m in $methods) {{ [void]$m.WmiSetBrightness(1, {percent}) }}
[pscustomobject]@{{ok=$true; brightness={percent}; backend='wmi'}} | ConvertTo-Json -Compress
""".strip()
            completed = await _run_powershell(script)
            if completed.returncode != 0:
                return _error("brightness_set_failed", stderr=completed.stderr.strip())
            return _ok(brightness=percent, backend="wmi")

        if platform_id == "macos":
            brightness = _which("brightness")
            if not brightness:
                return _error("brightness_backend_not_found", hint="Install the 'brightness' CLI to control display brightness on macOS.")
            completed = await _run([brightness, str(percent / 100.0)])
            if completed.returncode != 0:
                return _error("brightness_set_failed", stderr=completed.stderr.strip())
            return _ok(brightness=percent, backend="brightness")

        if platform_id == "linux":
            brightnessctl = _which("brightnessctl")
            if brightnessctl:
                completed = await _run([brightnessctl, "set", f"{percent}%"])
                if completed.returncode == 0:
                    return await get_display_brightness({})
                return _error("brightness_set_failed", stderr=completed.stderr.strip(), backend="brightnessctl")

            changed = []
            for folder in _linux_backlight_dirs():
                try:
                    max_value = int((folder / "max_brightness").read_text().strip())
                    target = max(1, round(max_value * (percent / 100)))
                    brightness_file = folder / "brightness"
                    if os.access(str(brightness_file), os.W_OK):
                        brightness_file.write_text(str(target))
                        changed.append(folder.name)
                except Exception:
                    continue
            if changed:
                result = await get_display_brightness({})
                result["changed"] = changed
                return result
            return _error("brightness_backend_not_found_or_permission_denied")

        return _error("unsupported_platform")
    except Exception as exc:
        return _error(str(exc))


async def get_power_status(args: Dict[str, Any] | None = None) -> Dict[str, Any]:
    try:
        platform_id = _platform_id()
        if platform_id == "windows":
            script = r"""
$items = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue |
  Select-Object Name, BatteryStatus, EstimatedChargeRemaining, EstimatedRunTime
$items | ConvertTo-Json -Compress -Depth 3
""".strip()
            completed = await _run_powershell(script)
            if completed.returncode != 0:
                return _error("power_status_failed", stderr=completed.stderr.strip())
            parsed = _loads_json(completed.stdout)
            rows = parsed if isinstance(parsed, list) else ([parsed] if isinstance(parsed, dict) else [])
            batteries = []
            for row in rows:
                status_code = row.get("BatteryStatus")
                batteries.append({
                    "name": row.get("Name"),
                    "percent": row.get("EstimatedChargeRemaining"),
                    "statusCode": status_code,
                    "charging": status_code in (2, 6, 7, 8, 9),
                    "estimatedRunTimeMinutes": row.get("EstimatedRunTime"),
                })
            return _ok(onBattery=None, batteries=batteries, backend="win32_battery")

        if platform_id == "macos":
            pmset = _which("pmset")
            if not pmset:
                return _error("pmset_not_found")
            completed = await _run([pmset, "-g", "batt"])
            if completed.returncode != 0:
                return _error("power_status_failed", stderr=completed.stderr.strip())
            percent_match = re.search(r"(\d+)%", completed.stdout)
            charging = "charging" in completed.stdout.lower() and "discharging" not in completed.stdout.lower()
            return _ok(
                percent=int(percent_match.group(1)) if percent_match else None,
                charging=charging,
                onBattery="battery power" in completed.stdout.lower(),
                backend="pmset",
                raw=completed.stdout.strip(),
            )

        if platform_id == "linux":
            batteries = []
            line_power_online = None
            for folder in _linux_power_supply_dirs():
                try:
                    typ = (folder / "type").read_text().strip().lower()
                except Exception:
                    typ = ""
                if typ == "battery":
                    try:
                        status = (folder / "status").read_text().strip()
                    except Exception:
                        status = ""
                    try:
                        percent_value = int(float((folder / "capacity").read_text().strip()))
                    except Exception:
                        percent_value = None
                    batteries.append({
                        "id": folder.name,
                        "percent": percent_value,
                        "status": status,
                        "charging": status.lower() == "charging",
                    })
                elif typ in {"mains", "usb"}:
                    try:
                        line_power_online = (folder / "online").read_text().strip() == "1"
                    except Exception:
                        pass
            return _ok(
                batteries=batteries,
                percent=batteries[0].get("percent") if batteries else None,
                charging=batteries[0].get("charging") if batteries else None,
                onBattery=(not line_power_online) if line_power_online is not None else None,
                backend="sysfs",
            )

        return _error("unsupported_platform")
    except Exception as exc:
        return _error(str(exc))
