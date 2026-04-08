from __future__ import annotations

import asyncio
import json
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
import time
import zipfile
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple
from urllib import request


def _resolve_cwd(cwd: Any) -> Optional[str]:
    if not isinstance(cwd, str):
        return None

    candidate = cwd.strip()
    if not candidate:
        return None

    expanded = os.path.expanduser(candidate)
    if "{{" in expanded and "}}" in expanded and not os.path.isabs(expanded):
        return None

    try:
        resolved = os.path.abspath(expanded)
    except Exception:
        return None

    try:
        if os.path.isdir(resolved):
            return resolved
    except Exception:
        return None

    return None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _get_user_data_dir() -> str:
    try:
        from .workflows import _user_data_dir  # type: ignore

        return _user_data_dir()
    except Exception:
        plat = platform.system().lower()
        if plat.startswith("win"):
            base = os.environ.get("APPDATA") or os.path.expanduser("~\\AppData\\Roaming")
            return os.path.join(base, "Stuard AI")
        if plat == "darwin":
            return os.path.expanduser("~/Library/Application Support/Stuard AI")
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
        return os.path.join(base, "Stuard AI")


def _ffmpeg_root_dir() -> str:
    override = str(os.environ.get("STUARD_FFMPEG_DIR") or "").strip()
    if override:
        return override
    return os.path.join(_get_user_data_dir(), "media-tools", "ffmpeg")


def _ffmpeg_bin_dir() -> str:
    return os.path.join(_ffmpeg_root_dir(), "bin")


def _meta_path() -> str:
    return os.path.join(_ffmpeg_root_dir(), "ffmpeg-meta.json")


def _is_windows() -> bool:
    return platform.system().lower().startswith("win")


def _exe_name(name: str) -> str:
    return f"{name}.exe" if _is_windows() else name


def _ffmpeg_paths() -> Tuple[str, str]:
    bin_dir = _ffmpeg_bin_dir()
    return os.path.join(bin_dir, _exe_name("ffmpeg")), os.path.join(bin_dir, _exe_name("ffprobe"))


def _read_meta() -> Dict[str, Any]:
    try:
        with open(_meta_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _write_meta(data: Dict[str, Any]) -> None:
    try:
        os.makedirs(_ffmpeg_root_dir(), exist_ok=True)
        with open(_meta_path(), "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


def _has_local_ffmpeg() -> bool:
    ffmpeg_path, ffprobe_path = _ffmpeg_paths()
    return os.path.isfile(ffmpeg_path) and os.path.isfile(ffprobe_path)


def _ffmpeg_supports_libx264(ffmpeg_path: str) -> bool:
    try:
        proc = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        out = (proc.stdout or "") + "\n" + (proc.stderr or "")
        return "libx264" in out
    except Exception:
        return False


def _system_ffmpeg_paths() -> Tuple[str, str] | None:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if ffmpeg and ffprobe:
        return ffmpeg, ffprobe
    return None


def _safe_extract_zip(zip_path: str, dest_dir: str) -> None:
    with zipfile.ZipFile(zip_path) as z:
        for m in z.infolist():
            name = m.filename
            if not name or name.endswith("/"):
                continue
            norm = os.path.normpath(name)
            if norm.startswith("..") or os.path.isabs(norm):
                continue
            out_path = os.path.join(dest_dir, norm)
            out_dir = os.path.dirname(out_path)
            os.makedirs(out_dir, exist_ok=True)
            with z.open(m) as src, open(out_path, "wb") as dst:
                shutil.copyfileobj(src, dst)


def _safe_extract_tar(tar_path: str, dest_dir: str) -> None:
    mode = "r:*"
    with tarfile.open(tar_path, mode) as t:
        for member in t.getmembers():
            if not member.name or member.isdir():
                continue
            norm = os.path.normpath(member.name)
            if norm.startswith("..") or os.path.isabs(norm):
                continue
            member.name = norm
            t.extract(member, dest_dir)


def _find_first(root: str, filename: str) -> Optional[str]:
    for r, _, files in os.walk(root):
        for f in files:
            if f.lower() == filename.lower():
                return os.path.join(r, f)
    return None


def _http_get_json(url: str) -> Dict[str, Any]:
    req = request.Request(url, headers={"User-Agent": "StuardAI"})
    with request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    data = json.loads(raw.decode("utf-8"))
    return data if isinstance(data, dict) else {}


def _pick_btbn_asset(assets: Any, target_tag: str) -> Optional[Dict[str, Any]]:
    if not isinstance(assets, list):
        return None

    def is_candidate(a: Any) -> bool:
        try:
            name = str(a.get("name") or "")
            return (
                target_tag in name
                and "ffmpeg" in name.lower()
                and (name.endswith(".zip") or name.endswith(".tar.xz"))
            )
        except Exception:
            return False

    cands = [a for a in assets if isinstance(a, dict) and is_candidate(a)]
    if not cands:
        return None

    def score(a: Dict[str, Any]) -> int:
        name = str(a.get("name") or "")
        s = 0
        if "lgpl" in name:
            s += 1
        elif "gpl" in name:
            s += 10
        if "shared" not in name:
            s += 3
        if name.endswith(".zip"):
            s += 2
        if name.endswith(".tar.xz"):
            s += 1
        return s

    cands.sort(key=score, reverse=True)
    return cands[0]


def _platform_target_tag() -> str:
    sys_plat = platform.system().lower()
    mach = platform.machine().lower()

    if sys_plat.startswith("win"):
        if "arm" in mach or "aarch64" in mach:
            return "winarm64"
        return "win64"

    if sys_plat == "darwin":
        return "macos"

    if "aarch64" in mach or "arm64" in mach:
        return "linuxarm64"
    return "linux64"


async def _download_file(
    url: str,
    dest_path: str,
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]],
) -> Dict[str, Any]:
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    tmp_path = dest_path + ".part"

    last_emit_ms = 0
    last_percent = -1

    req = request.Request(url, headers={"User-Agent": "StuardAI"})
    with request.urlopen(req, timeout=60) as resp:
        total = resp.headers.get("Content-Length")
        try:
            total_bytes = int(total) if total else 0
        except Exception:
            total_bytes = 0

        downloaded = 0
        with open(tmp_path, "wb") as f:
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)

                if emit and total_bytes > 0:
                    now = _now_ms()
                    percent = int(downloaded * 100 / total_bytes)
                    if percent >= 100:
                        percent = 100
                    should_emit = False
                    if last_percent < 0:
                        should_emit = True
                    elif percent != last_percent and (now - last_emit_ms) > 500 and abs(percent - last_percent) >= 1:
                        should_emit = True
                    elif (now - last_emit_ms) > 15000:
                        # Keep-alive for very slow downloads (no spam: desktop logs only every 10%)
                        should_emit = True

                    if should_emit:
                        last_emit_ms = now
                        last_percent = percent
                        await emit("media_tools_downloading", {"percent": percent})

    try:
        os.replace(tmp_path, dest_path)
    except Exception:
        try:
            shutil.move(tmp_path, dest_path)
        except Exception:
            pass

    return {"ok": True, "path": dest_path, "size": os.path.getsize(dest_path) if os.path.exists(dest_path) else 0}


async def _install_from_archive(
    archive_path: str,
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]],
) -> Dict[str, Any]:
    tmp_dir = tempfile.mkdtemp(prefix="stuard_ffmpeg_")
    try:
        if emit:
            await emit("media_tools_installing", None)

        if archive_path.lower().endswith(".zip"):
            await asyncio.to_thread(_safe_extract_zip, archive_path, tmp_dir)
        else:
            await asyncio.to_thread(_safe_extract_tar, archive_path, tmp_dir)

        ffmpeg_name = _exe_name("ffmpeg")
        ffprobe_name = _exe_name("ffprobe")
        ffmpeg_src = _find_first(tmp_dir, ffmpeg_name)
        ffprobe_src = _find_first(tmp_dir, ffprobe_name)

        if not ffmpeg_src or not ffprobe_src:
            return {"ok": False, "error": "ffmpeg_binary_not_found"}

        os.makedirs(_ffmpeg_bin_dir(), exist_ok=True)
        ffmpeg_dst, ffprobe_dst = _ffmpeg_paths()

        shutil.copy2(ffmpeg_src, ffmpeg_dst)
        shutil.copy2(ffprobe_src, ffprobe_dst)

        if not _is_windows():
            try:
                os.chmod(ffmpeg_dst, 0o755)
                os.chmod(ffprobe_dst, 0o755)
            except Exception:
                pass

        return {"ok": True, "ffmpegPath": ffmpeg_dst, "ffprobePath": ffprobe_dst}
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


_ffmpeg_lock = asyncio.Lock()


async def ensure_ffmpeg(
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    if _has_local_ffmpeg():
        ffmpeg_path, ffprobe_path = _ffmpeg_paths()
        if _ffmpeg_supports_libx264(ffmpeg_path):
            meta = _read_meta()
            return {"ok": True, "available": True, "source": meta.get("source") or "downloaded", "ffmpegPath": ffmpeg_path, "ffprobePath": ffprobe_path, "meta": meta}

    sys_paths = _system_ffmpeg_paths()
    if sys_paths and not _is_windows():
        ffmpeg_path, ffprobe_path = sys_paths
        return {"ok": True, "available": True, "source": "system", "ffmpegPath": ffmpeg_path, "ffprobePath": ffprobe_path}

    async with _ffmpeg_lock:
        if _has_local_ffmpeg():
            ffmpeg_path, ffprobe_path = _ffmpeg_paths()
            if _ffmpeg_supports_libx264(ffmpeg_path):
                meta = _read_meta()
                return {"ok": True, "available": True, "source": meta.get("source") or "downloaded", "ffmpegPath": ffmpeg_path, "ffprobePath": ffprobe_path, "meta": meta}

        if emit:
            await emit("media_tools_preparing", None)

        sys_plat = platform.system().lower()
        target = _platform_target_tag()

        if sys_plat == "darwin":
            return await _ensure_ffmpeg_evermeet(emit)

        try:
            release = await asyncio.to_thread(_http_get_json, "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest")
            assets = release.get("assets")
            asset = _pick_btbn_asset(assets, target)
            if not asset:
                return {"ok": False, "error": "ffmpeg_asset_not_found"}

            url = str(asset.get("browser_download_url") or "").strip()
            name = str(asset.get("name") or "ffmpeg-build").strip() or "ffmpeg-build"
            if not url:
                return {"ok": False, "error": "ffmpeg_asset_url_missing"}

            dl_dir = os.path.join(_ffmpeg_root_dir(), "downloads")
            archive_path = os.path.join(dl_dir, name)

            if emit:
                await emit("media_tools_downloading", {"percent": 0})

            await asyncio.to_thread(os.makedirs, dl_dir, exist_ok=True)
            await _download_file(url, archive_path, emit)

            installed = await _install_from_archive(archive_path, emit)
            if not installed.get("ok"):
                return installed

            meta = {
                "source": "btbn",
                "installedAtMs": _now_ms(),
                "platform": sys_plat,
                "target": target,
                "assetName": name,
                "downloadUrl": url,
                "tag": str(release.get("tag_name") or ""),
            }
            _write_meta(meta)

            if emit:
                await emit("media_tools_ready", None)

            ffmpeg_path, ffprobe_path = _ffmpeg_paths()
            return {"ok": True, "available": True, "source": "downloaded", "ffmpegPath": ffmpeg_path, "ffprobePath": ffprobe_path, "meta": meta}
        except Exception as e:
            if emit:
                await emit("media_tools_error", {"error": str(e)})
            return {"ok": False, "error": "ffmpeg_setup_failed", "message": str(e)}


async def _ensure_ffmpeg_evermeet(
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]],
) -> Dict[str, Any]:
    if emit:
        await emit("media_tools_downloading", {"percent": 0})

    dl_dir = os.path.join(_ffmpeg_root_dir(), "downloads")
    os.makedirs(dl_dir, exist_ok=True)

    ffmpeg_zip = os.path.join(dl_dir, "ffmpeg-macos.zip")
    ffprobe_zip = os.path.join(dl_dir, "ffprobe-macos.zip")

    await _download_file("https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip", ffmpeg_zip, emit)
    await _download_file("https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip", ffprobe_zip, emit)

    if emit:
        await emit("media_tools_installing", None)

    tmp_dir = tempfile.mkdtemp(prefix="stuard_ffmpeg_macos_")
    try:
        _safe_extract_zip(ffmpeg_zip, tmp_dir)
        _safe_extract_zip(ffprobe_zip, tmp_dir)

        ffmpeg_src = _find_first(tmp_dir, "ffmpeg")
        ffprobe_src = _find_first(tmp_dir, "ffprobe")
        if not ffmpeg_src or not ffprobe_src:
            return {"ok": False, "error": "ffmpeg_binary_not_found"}

        os.makedirs(_ffmpeg_bin_dir(), exist_ok=True)
        ffmpeg_dst, ffprobe_dst = _ffmpeg_paths()
        shutil.copy2(ffmpeg_src, ffmpeg_dst)
        shutil.copy2(ffprobe_src, ffprobe_dst)
        try:
            os.chmod(ffmpeg_dst, 0o755)
            os.chmod(ffprobe_dst, 0o755)
        except Exception:
            pass

        meta = {
            "source": "evermeet",
            "installedAtMs": _now_ms(),
            "platform": platform.system().lower(),
            "downloadUrl": "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip",
        }
        _write_meta(meta)

        if emit:
            await emit("media_tools_ready", None)

        return {"ok": True, "available": True, "source": "downloaded", "ffmpegPath": ffmpeg_dst, "ffprobePath": ffprobe_dst, "meta": meta}
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


async def ffmpeg_status(args: Dict[str, Any]) -> Dict[str, Any]:
    if _has_local_ffmpeg():
        ffmpeg_path, ffprobe_path = _ffmpeg_paths()
        return {"ok": True, "available": True, "source": "downloaded", "ffmpegPath": ffmpeg_path, "ffprobePath": ffprobe_path, "meta": _read_meta()}

    sys_paths = _system_ffmpeg_paths()
    if sys_paths:
        ffmpeg_path, ffprobe_path = sys_paths
        return {"ok": True, "available": True, "source": "system", "ffmpegPath": ffmpeg_path, "ffprobePath": ffprobe_path}

    return {"ok": True, "available": False}


async def ffmpeg_setup(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    return await ensure_ffmpeg(emit)


async def ffmpeg_run(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    setup = await ensure_ffmpeg(emit)
    if not setup.get("ok"):
        return setup

    ffmpeg_path = str(setup.get("ffmpegPath") or "")
    argv = args.get("args")
    timeout_ms = int(args.get("timeoutMs") or 300000)
    cwd = args.get("cwd")
    resolved_cwd = _resolve_cwd(cwd)

    output_file_path: str | None = None

    # Backwards-compatible convenience shape:
    # { inputs: [..], extraArgs: [..], output: "...", overwrite?: bool }
    if argv is None:
        inputs = args.get("inputs")
        extra = args.get("extraArgs")
        output = args.get("output")
        overwrite = bool(args.get("overwrite", True))

        if isinstance(inputs, list) and isinstance(output, str) and output.strip():
            in_list = [str(x) for x in inputs if isinstance(x, (str, int, float)) and str(x).strip()]
            extra_args: list[str] = []
            if isinstance(extra, list):
                extra_args = [str(x) for x in extra if isinstance(x, (str, int, float))]

            argv = ["-hide_banner", "-y" if overwrite else "-n"]
            for p in in_list:
                argv += ["-i", p]
            argv += extra_args + [output]
            output_file_path = output

    if output_file_path is None and isinstance(argv, list) and len(argv) > 0:
        last = argv[-1]
        if isinstance(last, str) and last.strip() and not last.strip().startswith("-"):
            output_file_path = last.strip()

    if not isinstance(argv, list) or not all(isinstance(x, (str, int, float)) for x in argv):
        return {"ok": False, "error": "missing_args"}

    cmd = [ffmpeg_path] + [str(x) for x in argv]

    try:
        proc = await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            cwd=resolved_cwd,
            timeout=timeout_ms / 1000,
        )
        success = proc.returncode == 0
        result: Dict[str, Any] = {
            "ok": success,
            "exitCode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "ffmpegPath": ffmpeg_path,
            "outputFilePath": output_file_path,
        }
        if not success:
            # Include error field so workflow engine shows meaningful message
            err_msg = (proc.stderr or "").strip()
            if len(err_msg) > 500:
                err_msg = err_msg[-500:]  # Last 500 chars are usually most relevant
            result["error"] = f"ffmpeg exited {proc.returncode}: {err_msg}" if err_msg else f"ffmpeg exited {proc.returncode}"
        return result
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout", "timeoutMs": timeout_ms}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def ffmpeg_convert_media(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    input_path = str(args.get("inputPath") or "").strip()
    output_path = str(args.get("outputPath") or "").strip()
    overwrite = bool(args.get("overwrite", True))
    extra = args.get("extraArgs")

    if not input_path or not output_path:
        return {"ok": False, "error": "missing_paths"}

    extra_args = []
    if isinstance(extra, list):
        extra_args = [str(x) for x in extra]

    argv = ["-hide_banner", "-y" if overwrite else "-n", "-i", input_path] + extra_args + [output_path]
    return await ffmpeg_run({"args": argv, "timeoutMs": args.get("timeoutMs"), "cwd": args.get("cwd")}, emit)


async def ffmpeg_extract_audio(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    input_path = str(args.get("inputPath") or "").strip()
    output_path = str(args.get("outputPath") or "").strip()
    overwrite = bool(args.get("overwrite", True))

    if not input_path or not output_path:
        return {"ok": False, "error": "missing_paths"}

    argv = ["-hide_banner", "-y" if overwrite else "-n", "-i", input_path, "-vn", output_path]
    return await ffmpeg_run({"args": argv, "timeoutMs": args.get("timeoutMs"), "cwd": args.get("cwd")}, emit)


async def ffmpeg_trim_media(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    input_path = str(args.get("inputPath") or "").strip()
    output_path = str(args.get("outputPath") or "").strip()
    start_seconds = float(args.get("startSeconds") or 0)
    duration_seconds = args.get("durationSeconds")
    overwrite = bool(args.get("overwrite", True))

    if not input_path or not output_path:
        return {"ok": False, "error": "missing_paths"}

    argv = ["-hide_banner", "-y" if overwrite else "-n", "-ss", str(start_seconds), "-i", input_path]
    if duration_seconds is not None:
        argv += ["-t", str(float(duration_seconds))]
    argv += ["-c", "copy", output_path]
    return await ffmpeg_run({"args": argv, "timeoutMs": args.get("timeoutMs"), "cwd": args.get("cwd")}, emit)


async def ffmpeg_probe_media(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    input_path = str(args.get("inputPath") or "").strip()
    timeout_ms = int(args.get("timeoutMs") or 300000)
    cwd = args.get("cwd")
    resolved_cwd = _resolve_cwd(cwd)

    if not input_path:
        return {"ok": False, "error": "missing_input_path"}

    setup = await ensure_ffmpeg(emit)
    if not setup.get("ok"):
        return setup

    ffprobe_path = str(setup.get("ffprobePath") or "")
    if not ffprobe_path:
        return {"ok": False, "error": "ffprobe_not_available"}

    cmd = [
        ffprobe_path,
        "-hide_banner",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        input_path,
    ]

    try:
        proc = await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            cwd=resolved_cwd,
            timeout=timeout_ms / 1000,
        )
        if proc.returncode != 0:
            return {
                "ok": False,
                "error": "ffprobe_failed",
                "exitCode": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
            }
        try:
            data = json.loads(proc.stdout or "{}")
        except Exception:
            data = None
        return {
            "ok": True,
            "data": data,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "ffprobePath": ffprobe_path,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout", "timeoutMs": timeout_ms}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def ffmpeg_extract_frames(
    args: Dict[str, Any],
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> Dict[str, Any]:
    input_path = str(args.get("inputPath") or "").strip()
    output_pattern = str(args.get("outputPattern") or "").strip()
    overwrite = bool(args.get("overwrite", True))
    fps = args.get("fps")
    start_seconds = args.get("startSeconds")
    duration_seconds = args.get("durationSeconds")

    if not input_path or not output_pattern:
        return {"ok": False, "error": "missing_paths"}

    argv = ["-hide_banner", "-y" if overwrite else "-n"]

    if start_seconds is not None:
        try:
            argv += ["-ss", str(float(start_seconds))]
        except Exception:
            pass

    argv += ["-i", input_path]

    vf: list[str] = []
    if fps is not None:
        try:
            fps_f = float(fps)
            if fps_f > 0:
                vf.append(f"fps={fps_f}")
        except Exception:
            pass

    if vf:
        argv += ["-vf", ",".join(vf)]

    if duration_seconds is not None:
        try:
            argv += ["-t", str(float(duration_seconds))]
        except Exception:
            pass

    argv += [output_pattern]

    return await ffmpeg_run({"args": argv, "timeoutMs": args.get("timeoutMs"), "cwd": args.get("cwd")}, emit)
