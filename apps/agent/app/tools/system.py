from __future__ import annotations

import asyncio
import glob
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import webbrowser
from typing import Any, Dict, Callable, Awaitable, Optional, List
from datetime import datetime
import time
import tempfile
import threading
import uuid

from .fs import CheckpointManager, _is_safe_path


_terminal_lock = threading.Lock()
_terminal_sessions: Dict[str, Dict[str, Any]] = {}
COMMAND_CHECKPOINT_MAX_ENTRIES = int(os.getenv("COMMAND_CHECKPOINT_MAX_ENTRIES", "2000"))

# Tail size for accumulated live output included on the final result. Lets the
# model see the actual command output without bloating result payloads when a
# build emits megabytes of logs.
LIVE_OUTPUT_TAIL_BYTES = int(os.getenv("STUARD_LIVE_OUTPUT_TAIL_BYTES", "65536"))


async def _stream_subprocess(
    argv: List[str],
    *,
    cwd: Optional[str],
    timeout_ms: int,
    env: Optional[Dict[str, str]] = None,
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
    flush_ms: int = 120,
    max_chunk: int = 8192,
) -> tuple[Optional[int], str, str, bool]:
    """Spawn ``argv`` and stream stdout/stderr while accumulating them.

    Emits ``progress`` events of shape ``{liveOutput: str, stream: 'stdout'|'stderr'}``
    so the UI can render a live terminal panel. Returns
    ``(returncode, stdout_full, stderr_full, timed_out)``.

    Output is flushed when a newline arrives or every ``flush_ms`` milliseconds
    so commands that don't print newlines still progress visibly.
    """
    proc_kwargs: Dict[str, Any] = {
        "stdout": asyncio.subprocess.PIPE,
        "stderr": asyncio.subprocess.PIPE,
    }
    if cwd:
        proc_kwargs["cwd"] = cwd
    if env:
        proc_kwargs["env"] = env

    proc = await asyncio.create_subprocess_exec(*argv, **proc_kwargs)

    stdout_buf: List[str] = []
    stderr_buf: List[str] = []

    async def pump(stream: Optional[asyncio.StreamReader], label: str, sink: List[str]) -> None:
        if stream is None:
            return
        loop = asyncio.get_event_loop()
        pending = b""
        last_emit = loop.time()
        while True:
            try:
                chunk = await stream.read(max_chunk)
            except Exception:
                break
            if not chunk:
                break
            pending += chunk
            now = loop.time()
            has_newline = b"\n" in pending
            interval_elapsed = (now - last_emit) * 1000 >= flush_ms
            if not (has_newline or interval_elapsed):
                continue
            if has_newline:
                idx = pending.rfind(b"\n") + 1
                payload = pending[:idx]
                pending = pending[idx:]
            else:
                payload = pending
                pending = b""
            text = payload.decode("utf-8", errors="replace")
            sink.append(text)
            if emit:
                try:
                    await emit("progress", {"liveOutput": text, "stream": label})
                except Exception:
                    pass
            last_emit = now
        if pending:
            text = pending.decode("utf-8", errors="replace")
            sink.append(text)
            if emit:
                try:
                    await emit("progress", {"liveOutput": text, "stream": label})
                except Exception:
                    pass

    timed_out = False
    try:
        await asyncio.wait_for(
            asyncio.gather(
                pump(proc.stdout, "stdout", stdout_buf),
                pump(proc.stderr, "stderr", stderr_buf),
                proc.wait(),
            ),
            timeout=max(0.1, timeout_ms / 1000),
        )
    except asyncio.TimeoutError:
        timed_out = True
        try:
            proc.kill()
        except Exception:
            pass
        try:
            await proc.wait()
        except Exception:
            pass

    return proc.returncode, "".join(stdout_buf), "".join(stderr_buf), timed_out

# Cached binary paths to avoid repeated slow PATH traversal on Windows
_cached_python_bin: str | None = None
_cached_node_bin: str | None = None
_cached_pip_ok: set[str] = set()  # env dirs where pip is known to be available
DEFAULT_PYTHON_ENV_ID = "default"


def _normalize_cwd(cwd: Any) -> Optional[str]:
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


def _resolve_cwd(cwd: Any, *, fallback_to_process: bool = False) -> Optional[str]:
    normalized = _normalize_cwd(cwd)
    if normalized:
        return normalized

    if fallback_to_process:
        try:
            current = os.getcwd()
        except Exception:
            return None
        return _normalize_cwd(current)

    return None


def _checkpoint_requested(args: Dict[str, Any]) -> bool:
    """
    Check whether this tool call explicitly requests filesystem checkpointing.

    Supported flags (in priority order):
      - checkpoint: boolean
      - checkpointMode: "always" | "never" | "auto" (auto currently behaves like false)
      - isDestructive / isModification / writesFiles / modifiesFiles: boolean aliases
    """
    try:
        direct = args.get("checkpoint")
        if isinstance(direct, bool):
            return direct

        mode = str(args.get("checkpointMode") or "").strip().lower()
        if mode in ("always", "on", "true", "required"):
            return True
        if mode in ("never", "off", "false", "none", "auto", ""):
            return False

        for key in ("isDestructive", "isModification", "writesFiles", "modifiesFiles"):
            v = args.get(key)
            if isinstance(v, bool):
                return v
    except Exception:
        return False
    return False


def _now_ms() -> int:
    return int(time.time() * 1000)


def _cleanup_terminals(now_ms: Optional[int] = None) -> None:
    n = now_ms if isinstance(now_ms, int) else _now_ms()
    to_delete: List[str] = []
    with _terminal_lock:
        for tid, s in list(_terminal_sessions.items()):
            done = bool(s.get("done"))
            updated_at = int(s.get("updatedAtMs") or 0)
            ttl_ms = int(s.get("ttlMs") or 3600_000)
            if done and updated_at and (n - updated_at) > ttl_ms:
                to_delete.append(tid)
        for tid in to_delete:
            try:
                _terminal_sessions.pop(tid, None)
            except Exception:
                pass


def _collect_path_snapshot(root: str, max_entries: int = COMMAND_CHECKPOINT_MAX_ENTRIES) -> Dict[str, Any]:
    root_abs = os.path.abspath(os.path.expanduser(root))
    files: Dict[str, tuple[int, int]] = {}
    dirs: set[str] = set()
    truncated = False

    if not os.path.isdir(root_abs):
        return {"root": root_abs, "files": files, "dirs": dirs, "truncated": truncated}

    count = 0
    dir_count = 0
    max_dirs = max_entries * 5  # Safety cap to prevent walking huge dir trees
    for cur_root, dirnames, filenames in os.walk(root_abs):
        dirs.add(cur_root)
        dir_count += 1
        if dir_count >= max_dirs:
            truncated = True
            break
        for name in filenames:
            fp = os.path.join(cur_root, name)
            try:
                st = os.stat(fp)
                files[fp] = (int(st.st_mtime_ns), int(st.st_size))
            except Exception:
                continue

            count += 1
            if count >= max_entries:
                truncated = True
                break

        if truncated:
            break

    return {"root": root_abs, "files": files, "dirs": dirs, "truncated": truncated}


def _is_child_path(path: str, parent: str) -> bool:
    try:
        norm_path = os.path.normcase(os.path.abspath(path))
        norm_parent = os.path.normcase(os.path.abspath(parent))
        return (
            norm_path != norm_parent
            and os.path.commonpath([norm_path, norm_parent]) == norm_parent
        )
    except Exception:
        return False


def _created_directory_roots(created_dirs: set[str]) -> list[str]:
    roots: list[str] = []
    for directory in sorted(created_dirs, key=lambda p: (len(os.path.abspath(p)), os.path.abspath(p))):
        if any(_is_child_path(directory, root) for root in roots):
            continue
        roots.append(directory)
    return roots


def _start_command_checkpoint(cwd: Optional[str]) -> Optional[Dict[str, Any]]:
    if not isinstance(cwd, str) or not cwd.strip():
        return None

    root = os.path.abspath(os.path.expanduser(cwd.strip()))
    if not os.path.isdir(root):
        return None

    if not _is_safe_path(root):
        return None

    try:
        snap = _collect_path_snapshot(root)
        if snap.get("truncated"):
            print(f"[checkpoint] Warning: directory tree at {root} was truncated, some files may not be tracked")
        
        for fp in snap["files"].keys():
            try:
                CheckpointManager.record_change(fp, "modify")
            except Exception:
                continue
        return snap
    except Exception as e:
        print(f"[checkpoint] Failed to create command checkpoint for {root}: {e}")
        return None


def _finish_command_checkpoint(before: Optional[Dict[str, Any]]) -> None:
    if not before:
        return

    root = str(before.get("root") or "").strip()
    if not root:
        return

    try:
        after = _collect_path_snapshot(root)
        before_files = set(before.get("files", {}).keys())
        after_files = set(after.get("files", {}).keys())
        created_files = after_files - before_files

        before_dirs = set(before.get("dirs", set()))
        after_dirs = set(after.get("dirs", set()))
        created_dirs = after_dirs - before_dirs
        created_dir_roots = _created_directory_roots(created_dirs)

        modified_files = set()
        for fp in before_files & after_files:
            before_stat = before["files"].get(fp)
            after_stat = after["files"].get(fp)
            if before_stat and after_stat and before_stat != after_stat:
                modified_files.add(fp)

        deleted_files = before_files - after_files
        for fp in deleted_files:
            try:
                CheckpointManager.record_change(fp, "modify")
            except Exception:
                continue

        for fp in modified_files:
            try:
                CheckpointManager.record_change(fp, "modify")
            except Exception:
                continue

        for dp in created_dir_roots:
            try:
                CheckpointManager.record_change(dp, "create_dir")
            except Exception:
                continue

        for fp in created_files:
            if any(_is_child_path(fp, dp) for dp in created_dir_roots):
                continue
            try:
                CheckpointManager.record_change(fp, "create")
            except Exception:
                continue
    except Exception as e:
        print(f"[checkpoint] Failed to finalize command checkpoint: {e}")


def _append_terminal_chunk(terminal_id: str, stream: str, text: str) -> None:
    if not terminal_id or text is None:
        return
    chunk_text = str(text)
    if not chunk_text:
        return
    ts = _now_ms()
    with _terminal_lock:
        s = _terminal_sessions.get(terminal_id)
        if not s:
            return
        seq = int(s.get("seq") or 0) + 1
        s["seq"] = seq
        chunks = s.get("chunks")
        if not isinstance(chunks, list):
            chunks = []
            s["chunks"] = chunks
        chunks.append({"seq": seq, "ts": ts, "stream": stream, "text": chunk_text})
        s["updatedAtMs"] = ts

        max_chars = int(s.get("maxChars") or 200_000)
        total_chars = int(s.get("totalChars") or 0) + len(chunk_text)
        s["totalChars"] = total_chars

        if total_chars > max_chars:
            while chunks and total_chars > max_chars:
                oldest = chunks.pop(0)
                try:
                    total_chars -= len(str(oldest.get("text") or ""))
                except Exception:
                    pass
            s["totalChars"] = max(0, total_chars)


def _start_terminal_session(
    *,
    command: str,
    argv: Optional[List[str]] = None,
    shell: bool = False,
    shell_used: str = "",
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    terminal_id: Optional[str] = None,
    checkpoint_before: Optional[Dict[str, Any]] = None,
    max_chars: int = 200_000,
    ttl_ms: int = 3600_000,
) -> Dict[str, Any]:
    tid = str(terminal_id or "").strip() or f"term_{uuid.uuid4().hex[:12]}"
    created_ms = _now_ms()

    popen_kwargs: Dict[str, Any] = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
        "bufsize": 1,
        "universal_newlines": True,
    }
    if isinstance(cwd, str) and cwd:
        popen_kwargs["cwd"] = cwd
    if env:
        popen_kwargs["env"] = env

    if argv is not None:
        proc = subprocess.Popen(argv, shell=False, **popen_kwargs)  # nosec
    else:
        proc = subprocess.Popen(command, shell=shell, **popen_kwargs)  # nosec

    session: Dict[str, Any] = {
        "terminalId": tid,
        "command": command,
        "argv": argv,
        "shell": shell_used,
        "cwd": cwd if isinstance(cwd, str) and cwd else None,
        "pid": proc.pid,
        "createdAtMs": created_ms,
        "updatedAtMs": created_ms,
        "done": False,
        "exitCode": None,
        "seq": 0,
        "chunks": [],
        "totalChars": 0,
        "maxChars": int(max_chars),
        "ttlMs": int(ttl_ms),
    }

    with _terminal_lock:
        _terminal_sessions[tid] = session

    def reader(stream_name: str, pipe: Any) -> None:
        try:
            if pipe is None:
                return
            while True:
                line = pipe.readline()
                if not line:
                    break
                _append_terminal_chunk(tid, stream_name, line)
        except Exception:
            pass
        finally:
            try:
                pipe.close()
            except Exception:
                pass

    def waiter() -> None:
        try:
            rc = proc.wait()
        except Exception:
            rc = None

        try:
            _finish_command_checkpoint(checkpoint_before)
        except Exception:
            pass

        ts2 = _now_ms()
        with _terminal_lock:
            s2 = _terminal_sessions.get(tid)
            if s2:
                s2["done"] = True
                s2["exitCode"] = rc
                s2["updatedAtMs"] = ts2

    t_out = threading.Thread(target=reader, args=("stdout", proc.stdout), daemon=True)
    t_err = threading.Thread(target=reader, args=("stderr", proc.stderr), daemon=True)
    t_wait = threading.Thread(target=waiter, daemon=True)
    t_out.start()
    t_err.start()
    t_wait.start()

    return {
        "ok": True,
        "terminalId": tid,
        "pid": proc.pid,
        "status": "running",
        "shell": shell_used,
    }


async def launch_application_or_uri(args: Dict[str, Any]) -> Dict[str, Any]:
    target = str(args.get("target") or "").strip()
    if not target:
        raise ValueError("missing target")
    if target.startswith("http://") or target.startswith("https://"):
        webbrowser.open(target)
        return {"ok": True, "opened": target}
    else:
        try:
            os.startfile(target)  # type: ignore[attr-defined]
            return {"ok": True, "launched": target}
        except Exception:
            subprocess.Popen(shlex.split(target), shell=True)  # nosec
            return {"ok": True, "launched": target}


async def run_command(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    cmd = str(args.get("command") or "").strip()
    shell_pref = str(args.get("shell") or "auto").lower()
    timeout_ms = int(args.get("timeoutMs") or 30000)
    cwd = args.get("cwd")
    resolved_cwd = _resolve_cwd(cwd, fallback_to_process=True)
    background = bool(args.get("background") or False)
    terminal_id = args.get("terminalId")
    if not cmd:
        raise ValueError("missing command")

    checkpoint = _start_command_checkpoint(resolved_cwd) if _checkpoint_requested(args) else None

    def _is_windows() -> bool:
        return sys.platform.startswith("win")

    def _exists(path: str) -> bool:
        try:
            return os.path.exists(path)
        except Exception:
            return False

    python_env_dir = _command_python_env_dir(resolved_cwd)
    command_env = _command_env_with_python_env(python_env_dir)

    shell_used = ""
    argv = []  # type: ignore[var-annotated]
    if _is_windows():
        if shell_pref in ("default", "cmd"):
            shell_used = "cmd"
            argv = ["cmd.exe", "/d", "/c", _shell_command_with_python_env(cmd, shell_used, python_env_dir)]
        elif shell_pref in ("auto", "powershell", "pwsh"):
            exe = shutil.which("pwsh") or shutil.which("powershell") or "powershell"
            shell_used = "powershell"
            argv = [exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", _shell_command_with_python_env(cmd, shell_used, python_env_dir)]
        else:
            shell_used = "cmd"
            argv = ["cmd.exe", "/d", "/c", _shell_command_with_python_env(cmd, shell_used, python_env_dir)]
    else:
        if shell_pref in ("default", "sh"):
            exe = "/bin/sh"
            shell_used = "sh"
            argv = [exe, "-lc", _shell_command_with_python_env(cmd, shell_used, python_env_dir)]
        elif shell_pref in ("auto", "bash"):
            exe = "/bin/bash" if _exists("/bin/bash") else (shutil.which("bash") or "/bin/sh")
            shell_used = "bash" if "bash" in exe else "sh"
            argv = [exe, "-lc", _shell_command_with_python_env(cmd, shell_used, python_env_dir)]
        else:
            exe = "/bin/sh"
            shell_used = "sh"
            argv = [exe, "-lc", _shell_command_with_python_env(cmd, shell_used, python_env_dir)]

    if emit:
        await emit("executing", {"command": cmd, "shell": shell_used})
    if background:
        return _start_terminal_session(
            command=cmd,
            argv=[str(a) for a in argv],
            shell=False,
            shell_used=shell_used,
            cwd=resolved_cwd,
            env=command_env,
            terminal_id=str(terminal_id) if terminal_id is not None else None,
            checkpoint_before=checkpoint,
        )
    try:
        rc, stdout, stderr, timed_out = await _stream_subprocess(
            [str(a) for a in argv],
            cwd=resolved_cwd,
            env=command_env,
            timeout_ms=timeout_ms,
            emit=emit,
        )
        _finish_command_checkpoint(checkpoint)
        if timed_out:
            return {
                "ok": False,
                "error": "timeout",
                "shell": shell_used,
                "stdout": stdout[-LIVE_OUTPUT_TAIL_BYTES:],
                "stderr": stderr[-LIVE_OUTPUT_TAIL_BYTES:],
            }
        return {
            "ok": True,
            "exitCode": rc,
            "stdout": stdout,
            "stderr": stderr,
            "shell": shell_used,
        }
    except FileNotFoundError as e:
        _finish_command_checkpoint(checkpoint)
        return {"ok": False, "error": f"shell_not_found: {e}", "shell": shell_used}


async def list_terminals(args: Dict[str, Any]) -> Dict[str, Any]:
    _cleanup_terminals()
    with _terminal_lock:
        items = []
        for tid, s in _terminal_sessions.items():
            items.append({
                "terminalId": tid,
                "command": s.get("command"),
                "shell": s.get("shell"),
                "cwd": s.get("cwd"),
                "pid": s.get("pid"),
                "done": bool(s.get("done")),
                "exitCode": s.get("exitCode"),
                "updatedAtMs": s.get("updatedAtMs"),
                "createdAtMs": s.get("createdAtMs"),
                "seq": int(s.get("seq") or 0),
            })
    items.sort(key=lambda x: int(x.get("updatedAtMs") or 0), reverse=True)
    return {"ok": True, "terminals": items}


async def read_terminal(args: Dict[str, Any]) -> Dict[str, Any]:
    terminal_id = str(args.get("terminalId") or "").strip()
    since_seq = int(args.get("sinceSeq") or 0)
    max_chars = int(args.get("maxChars") or 8000)

    if not terminal_id:
        return {"ok": False, "error": "missing_terminalId"}

    _cleanup_terminals()

    with _terminal_lock:
        s = _terminal_sessions.get(terminal_id)
        if not s:
            return {"ok": False, "error": "terminal_not_found", "terminalId": terminal_id}

        chunks = s.get("chunks")
        if not isinstance(chunks, list):
            chunks = []

        out: List[Dict[str, Any]] = []
        used = 0
        truncated = False
        for ch in chunks:
            try:
                seq = int(ch.get("seq") or 0)
            except Exception:
                seq = 0
            if seq <= since_seq:
                continue
            txt = str(ch.get("text") or "")
            if not txt:
                continue
            if used + len(txt) > max_chars:
                take = max(0, max_chars - used)
                if take > 0:
                    out.append({"seq": seq, "ts": ch.get("ts"), "stream": ch.get("stream"), "text": txt[:take]})
                truncated = True
                break
            out.append({"seq": seq, "ts": ch.get("ts"), "stream": ch.get("stream"), "text": txt})
            used += len(txt)

        return {
            "ok": True,
            "terminalId": terminal_id,
            "command": s.get("command"),
            "shell": s.get("shell"),
            "cwd": s.get("cwd"),
            "pid": s.get("pid"),
            "done": bool(s.get("done")),
            "exitCode": s.get("exitCode"),
            "seq": int(s.get("seq") or 0),
            "chunks": out,
            "truncated": truncated,
        }


async def get_local_time(args: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now().astimezone()
    iso = now.isoformat()
    tz_name = now.tzname() or ""
    offset = now.utcoffset()
    offset_minutes = int(offset.total_seconds() // 60) if offset else 0
    epoch_ms = int(now.timestamp() * 1000)
    return {"ok": True, "iso": iso, "tzName": tz_name, "offsetMinutes": offset_minutes, "epochMs": epoch_ms}


# CREATE_NO_WINDOW so probing helper interpreters from the frozen GUI agent
# doesn't flash console windows on Windows.
_NO_WINDOW_FLAG = 0x08000000 if sys.platform.startswith("win") else 0


def _no_window_kwargs() -> Dict[str, Any]:
    return {"creationflags": _NO_WINDOW_FLAG} if _NO_WINDOW_FLAG else {}


def _is_windows_store_python_stub(path: str) -> bool:
    """Detect the Microsoft Store "App execution alias" python.exe.

    Windows ships a 0-byte reparse-point stub at
    ``%LOCALAPPDATA%\\Microsoft\\WindowsApps\\python.exe`` that opens the Store
    instead of running Python. ``shutil.which('python')`` happily returns it, so
    naive status checks report "Python installed" while every venv/script
    invocation fails. This is the "it's from Microsoft's own thing" interpreter
    users hit on a fresh laptop with no real Python — we must reject it.
    """
    if not path or not sys.platform.startswith("win"):
        return False
    try:
        norm = os.path.normcase(os.path.abspath(path))
    except Exception:
        norm = os.path.normcase(path)
    if os.path.join("microsoft", "windowsapps") in norm:
        return True
    try:
        # App execution aliases are 0-byte reparse points.
        if os.path.getsize(path) == 0:
            return True
    except OSError:
        pass
    return False


def _python_interpreter_works(path: str) -> bool:
    """True only when ``path`` is a real interpreter that actually executes code.

    Guards against the Store stub (which errors / opens the Store) and any other
    broken shim that exists on disk but can't run.
    """
    if not path or not os.path.exists(path):
        return False
    if _is_windows_store_python_stub(path):
        return False
    try:
        proc = subprocess.run(
            [path, "-c", "import sys; sys.stdout.write(sys.executable or sys.version)"],
            capture_output=True,
            text=True,
            timeout=15,
            **_no_window_kwargs(),
        )
    except Exception:
        return False
    return proc.returncode == 0 and bool((proc.stdout or "").strip())


def _windows_python_search_roots() -> List[str]:
    roots: List[str] = []
    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        roots.append(os.path.join(localappdata, "Programs", "Python"))
    for var in ("ProgramFiles", "ProgramFiles(x86)"):
        base = os.environ.get(var)
        if base:
            roots.append(base)
    roots.append(os.environ.get("SystemDrive", "C:") + os.sep)
    return roots


def _candidate_system_pythons() -> List[str]:
    """Ordered list of plausible real interpreters (Store stubs already filtered)."""
    candidates: List[str] = []

    def _add(path: Optional[str]) -> None:
        if path and not _is_windows_store_python_stub(path):
            candidates.append(path)

    if sys.platform.startswith("win"):
        # The `py` launcher is the most reliable resolver on Windows.
        py_launcher = shutil.which("py")
        if py_launcher and not _is_windows_store_python_stub(py_launcher):
            for ver_arg in ("-3.12", "-3.11", "-3"):
                try:
                    proc = subprocess.run(
                        [py_launcher, ver_arg, "-c", "import sys;print(sys.executable)"],
                        capture_output=True, text=True, timeout=15,
                        **_no_window_kwargs(),
                    )
                except Exception:
                    continue
                if proc.returncode == 0:
                    out = (proc.stdout or "").strip().splitlines()
                    if out:
                        _add(out[-1].strip())
                        break

    for name in ("python3", "python"):
        _add(shutil.which(name))

    if sys.platform.startswith("win"):
        for root in _windows_python_search_roots():
            try:
                for entry in sorted(glob.glob(os.path.join(root, "Python3*", "python.exe")), reverse=True):
                    _add(entry)
            except Exception:
                pass
    else:
        for base in ("/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"):
            for name in ("python3", "python"):
                p = os.path.join(base, name)
                if os.path.exists(p):
                    _add(p)

    # De-dup, preserve order.
    seen: set[str] = set()
    unique: List[str] = []
    for cand in candidates:
        try:
            key = os.path.normcase(os.path.abspath(cand))
        except Exception:
            key = cand
        if key not in seen:
            seen.add(key)
            unique.append(cand)
    return unique


def _get_system_python() -> str:
    """Return a real, working Python interpreter path.

    In dev mode ``sys.executable`` is already a real interpreter. In a
    PyInstaller-frozen build it's the packaged agent ``.exe`` (which cannot
    create venvs or run ``-m pip``), so we discover a system Python — rejecting
    the Microsoft Store stub — and fall back to a Stuard-managed runtime that
    was provisioned previously. Returns ``""`` when nothing usable exists so
    callers surface a clear "install Python" error instead of looping on
    failures (which silently burns credits).
    """
    global _cached_python_bin
    if _cached_python_bin:
        return _cached_python_bin

    is_frozen = getattr(sys, "frozen", False) or hasattr(sys, "_MEIPASS")
    if not is_frozen:
        _cached_python_bin = sys.executable
        return sys.executable

    for candidate in _candidate_system_pythons():
        if _python_interpreter_works(candidate):
            _cached_python_bin = candidate
            return candidate

    managed = _managed_python_bin()
    if managed and _python_interpreter_works(managed):
        _cached_python_bin = managed
        return managed

    return ""


def _envs_base_dir() -> str:
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or os.path.expanduser("~\\AppData\\Roaming")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(base, "StuardAI", "python", "envs")


# ── Stuard-managed Python runtime ────────────────────────────────────────────
# When no system Python exists (e.g. a fresh laptop that only has the Microsoft
# Store stub), Stuard provisions its own relocatable CPython from
# python-build-standalone so scripts "just work" without a manual install.
# The runtime lives beside the managed venvs and is the base interpreter the
# default venv is created from.
_PBS_RELEASE_API = "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
_PBS_PREFERRED_PYVERS = ("3.12.", "3.11.", "3.13.")
_managed_python_lock = threading.Lock()


def _managed_python_root() -> str:
    return os.path.join(os.path.dirname(_envs_base_dir()), "runtime")


def _managed_python_bin() -> str:
    root = _managed_python_root()
    if sys.platform.startswith("win"):
        return os.path.join(root, "python", "python.exe")
    return os.path.join(root, "python", "bin", "python3")


def _platform_pbs_triple() -> Optional[str]:
    machine = (platform.machine() or "").lower()
    if sys.platform.startswith("win"):
        if machine in ("amd64", "x86_64", "x64"):
            return "x86_64-pc-windows-msvc"
        if machine in ("arm64", "aarch64"):
            return "aarch64-pc-windows-msvc"
        return None
    if sys.platform == "darwin":
        return "aarch64-apple-darwin" if machine in ("arm64", "aarch64") else "x86_64-apple-darwin"
    if machine in ("x86_64", "amd64"):
        return "x86_64-unknown-linux-gnu"
    if machine in ("aarch64", "arm64"):
        return "aarch64-unknown-linux-gnu"
    return None


def _select_pbs_asset_url(assets: list, triple: str) -> Optional[str]:
    suffix = f"{triple}-install_only.tar.gz"
    matches = [
        a for a in assets
        if isinstance(a, dict)
        and isinstance(a.get("name"), str)
        and a["name"].endswith(suffix)
    ]

    def _score(name: str) -> tuple:
        for i, pref in enumerate(_PBS_PREFERRED_PYVERS):
            if f"cpython-{pref}" in name:
                return (0, i, name)
        return (1, 0, name)

    matches.sort(key=lambda a: _score(a["name"]))
    for a in matches:
        url = a.get("browser_download_url")
        if isinstance(url, str) and url:
            return url
    return None


def _download_and_extract_pbs(url: str, dest_root: str) -> str:
    os.makedirs(dest_root, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="stuard-py-", suffix=".tar.gz")
    os.close(tmp_fd)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "StuardAI"})
        with urllib.request.urlopen(req, timeout=180) as resp, open(tmp_path, "wb") as out:
            shutil.copyfileobj(resp, out)
        # python-build-standalone "install_only" archives extract to a top-level
        # ``python/`` dir → dest_root/python/python.exe (win) or bin/python3 (unix).
        with tarfile.open(tmp_path, "r:gz") as tf:
            try:
                tf.extractall(dest_root, filter="data")  # type: ignore[call-arg]
            except TypeError:
                tf.extractall(dest_root)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    return _managed_python_bin()


async def _provision_managed_python(
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> str:
    """Provision (or reuse) a Stuard-managed CPython. Returns "" on failure."""
    existing = _managed_python_bin()
    if existing and await asyncio.to_thread(_python_interpreter_works, existing):
        return existing

    if os.environ.get("STUARD_DISABLE_MANAGED_PYTHON") == "1":
        return ""

    triple = _platform_pbs_triple()
    if not triple:
        return ""

    def _provision() -> str:
        with _managed_python_lock:
            current = _managed_python_bin()
            if current and _python_interpreter_works(current):
                return current
            try:
                req = urllib.request.Request(
                    _PBS_RELEASE_API,
                    headers={"User-Agent": "StuardAI", "Accept": "application/vnd.github+json"},
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    release = json.loads(resp.read().decode("utf-8"))
            except Exception:
                return ""
            assets = release.get("assets") if isinstance(release, dict) else None
            if not isinstance(assets, list):
                return ""
            url = _select_pbs_asset_url(assets, triple)
            if not url:
                return ""
            root = _managed_python_root()
            # Clear a half-extracted dir from a previous failed attempt.
            py_dir = os.path.join(root, "python")
            if os.path.isdir(py_dir):
                shutil.rmtree(py_dir, ignore_errors=True)
            try:
                return _download_and_extract_pbs(url, root)
            except Exception:
                return ""

    if emit:
        await emit("provisioning_python", {"runtime": "managed", "note": "Setting up Python (first run)…"})
    py_bin = await asyncio.to_thread(_provision)
    if py_bin and await asyncio.to_thread(_python_interpreter_works, py_bin):
        global _cached_python_bin
        _cached_python_bin = py_bin
        if emit:
            await emit("python_provisioned", {"python": py_bin})
        return py_bin
    return ""


def _resolve_python_env_id(env_id: Any) -> str:
    resolved = str(env_id or "").strip() or DEFAULT_PYTHON_ENV_ID
    if resolved in {".", ".."} or os.path.isabs(resolved):
        raise ValueError("invalid_envId")
    separators = [os.sep, "/", "\\"]
    if os.altsep:
        separators.append(os.altsep)
    if any(sep and sep in resolved for sep in separators):
        raise ValueError("invalid_envId")
    return resolved


def _python_env_dir(env_id: str) -> str:
    resolved = _resolve_python_env_id(env_id)
    if resolved == DEFAULT_PYTHON_ENV_ID:
        native_env = _native_python_env_dir()
        if native_env:
            return native_env
    return os.path.join(_envs_base_dir(), resolved)


def _python_env_bin(env_dir: str) -> str:
    if sys.platform.startswith("win"):
        return os.path.join(env_dir, "Scripts", "python.exe")
    preferred = os.path.join(env_dir, "bin", "python3")
    fallback = os.path.join(env_dir, "bin", "python")
    return preferred if os.path.exists(preferred) or not os.path.exists(fallback) else fallback


def _venv_bin_dir(env_dir: str) -> str:
    return os.path.dirname(_python_env_bin(env_dir))


def _is_usable_python_env(env_dir: Any) -> bool:
    if not isinstance(env_dir, str) or not env_dir.strip():
        return False
    try:
        resolved = os.path.abspath(os.path.expanduser(env_dir.strip()))
        return os.path.isfile(os.path.join(resolved, "pyvenv.cfg")) and os.path.exists(_python_env_bin(resolved))
    except Exception:
        return False


def _append_env_candidate(candidates: List[str], env_dir: Any) -> None:
    if not isinstance(env_dir, str) or not env_dir.strip():
        return
    try:
        resolved = os.path.abspath(os.path.expanduser(env_dir.strip()))
    except Exception:
        return
    normalized = os.path.normcase(resolved)
    if any(os.path.normcase(existing) == normalized for existing in candidates):
        return
    candidates.append(resolved)


def _cwd_venv_candidates(cwd: Optional[str]) -> List[str]:
    candidates: List[str] = []
    if not cwd:
        return candidates
    try:
        current = os.path.abspath(os.path.expanduser(cwd))
        if not os.path.isdir(current):
            return candidates
        while True:
            _append_env_candidate(candidates, os.path.join(current, ".venv"))
            parent = os.path.dirname(current)
            if parent == current:
                break
            current = parent
    except Exception:
        return candidates
    return candidates


def _agent_repo_venv() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".venv"))


def _native_python_env_dir(cwd: Optional[str] = None, *, prefer_cwd: bool = False) -> str:
    candidates: List[str] = []

    _append_env_candidate(candidates, os.environ.get("STUARD_PYTHON_ENV"))
    _append_env_candidate(candidates, os.environ.get("VIRTUAL_ENV"))

    if prefer_cwd:
        for candidate in _cwd_venv_candidates(cwd):
            _append_env_candidate(candidates, candidate)

    try:
        sys_prefix = os.path.abspath(str(getattr(sys, "prefix", "") or ""))
        base_prefix = os.path.abspath(str(getattr(sys, "base_prefix", "") or sys_prefix))
        if sys_prefix and os.path.normcase(sys_prefix) != os.path.normcase(base_prefix):
            _append_env_candidate(candidates, sys_prefix)
    except Exception:
        pass

    _append_env_candidate(candidates, _agent_repo_venv())

    if not prefer_cwd:
        for candidate in _cwd_venv_candidates(cwd):
            _append_env_candidate(candidates, candidate)

    for candidate in candidates:
        if _is_usable_python_env(candidate):
            return candidate
    return ""


def _command_python_env_dir(cwd: Optional[str]) -> str:
    native_env = _native_python_env_dir(cwd, prefer_cwd=True)
    if native_env:
        return native_env
    default_env = os.path.join(_envs_base_dir(), DEFAULT_PYTHON_ENV_ID)
    return default_env if _is_usable_python_env(default_env) else ""


def _command_env_with_python_env(env_dir: str) -> Optional[Dict[str, str]]:
    if not _is_usable_python_env(env_dir):
        return None
    bin_dir = _venv_bin_dir(env_dir)
    env = os.environ.copy()
    env["VIRTUAL_ENV"] = env_dir
    env["PYTHONNOUSERSITE"] = "1"
    env.pop("PYTHONHOME", None)
    existing_path = env.get("PATH") or ""
    env["PATH"] = bin_dir + (os.pathsep + existing_path if existing_path else "")
    return env


def _ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _shell_command_with_python_env(cmd: str, shell_used: str, env_dir: str) -> str:
    if not _is_usable_python_env(env_dir):
        return cmd

    py_bin = _python_env_bin(env_dir)
    bin_dir = _venv_bin_dir(env_dir)

    if shell_used == "powershell":
        py = _ps_quote(py_bin)
        path = _ps_quote(bin_dir)
        venv = _ps_quote(env_dir)
        preamble = (
            f"$env:VIRTUAL_ENV={venv}; "
            "$env:PYTHONNOUSERSITE='1'; "
            "Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue; "
            f"$env:PATH={path} + [IO.Path]::PathSeparator + $env:PATH; "
            f"function python {{ & {py} @args }}; "
            f"function python3 {{ & {py} @args }}; "
            f"function py {{ & {py} @args }}; "
            f"function pip {{ & {py} -m pip @args }}; "
            f"function pip3 {{ & {py} -m pip @args }}; "
        )
        return preamble + cmd

    if shell_used == "cmd":
        return (
            f'set "VIRTUAL_ENV={env_dir}" && '
            'set "PYTHONNOUSERSITE=1" && '
            f'set "PATH={bin_dir};%PATH%" && '
            f"{cmd}"
        )

    py = shlex.quote(py_bin)
    path = shlex.quote(bin_dir)
    venv = shlex.quote(env_dir)
    preamble = (
        f"export VIRTUAL_ENV={venv}; "
        "export PYTHONNOUSERSITE=1; "
        "unset PYTHONHOME; "
        f"export PATH={path}:$PATH; "
        f"python() {{ {py} \"$@\"; }}; "
        f"python3() {{ {py} \"$@\"; }}; "
        f"py() {{ {py} \"$@\"; }}; "
        f"pip() {{ {py} -m pip \"$@\"; }}; "
        f"pip3() {{ {py} -m pip \"$@\"; }}; "
    )
    return preamble + cmd


def _normalize_pkg_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name.strip().lower())


_INSTALLED_PACKAGES_CACHE: Dict[str, tuple[float, Dict[str, str]]] = {}
_INSTALLED_PACKAGES_TTL_SEC = 30.0


def _invalidate_installed_packages_cache(env_dir: str) -> None:
    _INSTALLED_PACKAGES_CACHE.pop(env_dir, None)


async def _list_installed_packages(py_bin: str, *, env_dir: str | None = None) -> Dict[str, str]:
    """Return {package_name: version} for packages installed in the venv."""
    if not py_bin or not os.path.exists(py_bin):
        return {}
    cache_key = env_dir or py_bin
    now = time.time()
    cached = _INSTALLED_PACKAGES_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _INSTALLED_PACKAGES_TTL_SEC:
        return cached[1]
    proc = await asyncio.to_thread(
        subprocess.run,
        [py_bin, "-m", "pip", "list", "--format=json"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        return {}
    try:
        rows = json.loads(proc.stdout or "[]")
        installed = {
            str(row.get("name") or "").strip(): str(row.get("version") or "").strip()
            for row in rows
            if isinstance(row, dict) and row.get("name")
        }
    except Exception:
        installed = {}
    _INSTALLED_PACKAGES_CACHE[cache_key] = (now, installed)
    return installed


def _parse_requirements_lines(req_txt: str) -> List[str]:
    specs: List[str] = []
    for raw in req_txt.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-"):
            continue
        specs.append(line)
    return specs


def _installed_lookup(installed: Dict[str, str]) -> Dict[str, str]:
    lookup: Dict[str, str] = {}
    for name, version in installed.items():
        lookup[_normalize_pkg_name(name)] = version
    return lookup


async def _filter_packages_to_install(py_bin: str, specs: List[str]) -> tuple[List[str], List[str]]:
    """Split package specs into (needs_install, already_satisfied)."""
    cleaned = [str(spec).strip() for spec in specs if str(spec).strip()]
    if not cleaned:
        return [], []

    installed = await _list_installed_packages(py_bin)
    lookup = _installed_lookup(installed)
    check_code = r"""
import json, sys
from importlib.metadata import version, PackageNotFoundError
try:
    from packaging.requirements import Requirement
except ImportError:
    Requirement = None

specs = json.loads(sys.argv[1])
lookup = json.loads(sys.argv[2])
result = {"install": [], "satisfied": []}

def normalize(name):
    import re
    return re.sub(r"[-_.]+", "-", name.strip().lower())

for raw in specs:
    spec = str(raw).strip()
    if not spec:
        continue
    if any(token in spec for token in ("://", " @")) or spec.startswith((".", "/", "~")):
        result["install"].append(spec)
        continue
    if Requirement is None:
        base = spec.split("[", 1)[0]
        for op in ("==", ">=", "<=", "!=", "~=", "<", ">"):
            if op in base:
                base = base.split(op, 1)[0]
                break
        name = normalize(base.strip())
        if name in lookup:
            result["satisfied"].append(spec)
        else:
            result["install"].append(spec)
        continue
    try:
        req = Requirement(spec)
        try:
            ver = version(req.name)
            if req.specifier.contains(ver, prereleases=True):
                result["satisfied"].append(spec)
                continue
        except PackageNotFoundError:
            pass
        result["install"].append(spec)
    except Exception:
        result["install"].append(spec)

print(json.dumps(result))
"""
    proc = await asyncio.to_thread(
        subprocess.run,
        [py_bin, "-c", check_code, json.dumps(cleaned), json.dumps(lookup)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        return cleaned, []
    try:
        parsed = json.loads(proc.stdout.strip() or "{}")
        to_install = [str(x) for x in (parsed.get("install") or []) if str(x).strip()]
        satisfied = [str(x) for x in (parsed.get("satisfied") or []) if str(x).strip()]
        return to_install, satisfied
    except Exception:
        return cleaned, []


async def _pip_install_packages(
    py_bin: str,
    specs: List[str],
    *,
    quiet: bool = True,
    extra_args: List[str] | None = None,
) -> subprocess.CompletedProcess[str]:
    cmd = [py_bin, "-m", "pip", "install"]
    if quiet:
        cmd.append("--quiet")
    if extra_args:
        cmd.extend(extra_args)
    cmd.extend(specs)
    return await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)


async def _ensure_python_env(
    env_id: str,
    emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None,
) -> tuple[str, str]:
    resolved_env_id = _resolve_python_env_id(env_id)
    envs_root = _envs_base_dir()
    os.makedirs(envs_root, exist_ok=True)
    env_dir = _python_env_dir(resolved_env_id)
    py_bin = _python_env_bin(env_dir)

    if not os.path.exists(py_bin):
        if emit:
            await emit("creating_env", {"envId": resolved_env_id, "path": env_dir})
        system_python = await asyncio.to_thread(_get_system_python)
        if not system_python:
            # No real system Python (the Store stub doesn't count) — provision a
            # sandboxed Stuard-managed CPython so the user never has to install
            # one by hand. Only raises if that also fails (e.g. offline).
            system_python = await _provision_managed_python(emit)
        if not system_python:
            raise RuntimeError("python_not_installed")
        create_cmd = [system_python, "-m", "venv", "--without-pip", env_dir]
        proc = await asyncio.to_thread(subprocess.run, create_cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"venv_create_failed: {proc.stderr or proc.stdout}")
        py_bin = _python_env_bin(env_dir)
        if emit:
            await emit("env_created", {"envId": resolved_env_id})

    if env_dir not in _cached_pip_ok:
        pip_check = await asyncio.to_thread(
            subprocess.run,
            [py_bin, "-m", "pip", "--version"],
            capture_output=True,
            text=True,
        )
        if pip_check.returncode != 0:
            if emit:
                await emit("installing_pip", {"envId": resolved_env_id})
            await asyncio.to_thread(
                subprocess.run,
                [py_bin, "-m", "ensurepip", "--upgrade"],
                capture_output=True,
                check=False,
            )
        pip_check = await asyncio.to_thread(
            subprocess.run,
            [py_bin, "-m", "pip", "--version"],
            capture_output=True,
            text=True,
        )
        if pip_check.returncode != 0:
            raise RuntimeError(f"pip_unavailable: {pip_check.stderr or pip_check.stdout}")
        _cached_pip_ok.add(env_dir)

    return env_dir, py_bin


async def python_status(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        args = args or {}
        is_frozen = getattr(sys, "frozen", False) or hasattr(sys, "_MEIPASS")
        system_python = await asyncio.to_thread(_get_system_python)
        # In a frozen build, sys.executable is the agent .exe itself, which is
        # NOT a usable Python interpreter. Only the resolved system_python is.
        usable_python = system_python if is_frozen else (system_python or sys.executable or "")
        # Can we auto-provision a managed CPython if no real system Python exists?
        can_auto_provision = (
            bool(_platform_pbs_triple())
            and os.environ.get("STUARD_DISABLE_MANAGED_PYTHON") != "1"
        )
        managed_python = _managed_python_bin()
        managed_ready = os.path.exists(managed_python)
        # Diagnostic: did we only find the Microsoft Store stub (and no real one)?
        store_stub_detected = False
        if is_frozen and not system_python and sys.platform.startswith("win"):
            for _probe in (shutil.which("python"), shutil.which("python3"), shutil.which("py")):
                if _probe and _is_windows_store_python_stub(_probe):
                    store_stub_detected = True
                    break
        envs_root = _envs_base_dir()
        default_env_id = DEFAULT_PYTHON_ENV_ID
        active_env_id = _resolve_python_env_id(args.get("envId") if isinstance(args, dict) and args.get("envId") else None)
        default_env_dir = os.path.join(envs_root, default_env_id)
        active_env_dir = os.path.join(envs_root, active_env_id)
        default_python = _python_env_bin(default_env_dir)
        active_python = _python_env_bin(active_env_dir)
        envs = []
        try:
            if os.path.isdir(envs_root):
                for name in os.listdir(envs_root):
                    p = os.path.join(envs_root, name)
                    if os.path.isdir(p):
                        envs.append(name)
        except Exception:
            envs = []
        default_ready = os.path.exists(default_python)
        active_ready = os.path.exists(active_python)
        # Only ask the user to install Python by hand when we genuinely can't
        # help (unknown platform / managed runtime disabled). Otherwise Stuard
        # provisions a sandboxed CPython automatically on first script run.
        needs_install = is_frozen and not system_python and not can_auto_provision
        package_count = 0
        if active_ready:
            try:
                installed = await _list_installed_packages(active_python, env_dir=active_env_dir)
                package_count = len(installed)
            except Exception:
                package_count = 0
        return {
            "ok": True,
            # "available" reflects whether Python will run — now or via on-demand
            # provisioning — so the UI doesn't nag about a manual install we can
            # handle ourselves.
            "available": bool(usable_python) or (is_frozen and can_auto_provision),
            "ready": bool(usable_python) or managed_ready,
            "autoProvision": is_frozen and not bool(usable_python) and can_auto_provision,
            "storeStubDetected": store_stub_detected,
            "needsInstall": needs_install,
            "installUrl": "https://www.python.org/downloads/" if needs_install else None,
            "message": (
                "A Microsoft Store placeholder for Python was found, but it isn't a real "
                "interpreter. Stuard will set up its own Python automatically on first use."
                if store_stub_detected and can_auto_provision else
                "No Python found. Stuard will set up its own Python automatically on first use."
                if is_frozen and not bool(usable_python) and can_auto_provision else
                "Python isn't installed. Install it from python.org to run Python scripts."
                if needs_install else None
            ),
            "managedPython": managed_python if managed_ready else None,
            "python": usable_python,
            "version": sys.version.split("\n")[0] if not is_frozen else None,
            "envsRoot": envs_root,
            "envs": envs,
            "defaultEnvId": DEFAULT_PYTHON_ENV_ID,
            "activeEnvId": active_env_id,
            "defaultEnvPath": default_env_dir,
            "defaultPython": default_python,
            "defaultReady": default_ready,
            "activeEnvPath": active_env_dir,
            "activePython": active_python,
            "activeReady": active_ready,
            "packageCount": package_count,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def python_setup(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        args = args or {}
        env_id = _resolve_python_env_id(args.get("envId") if isinstance(args, dict) else None)
        env_dir, py_bin = await _ensure_python_env(env_id)
        st = await python_status(args or {})
        return {
            "ok": bool(st.get("available")),
            "python": py_bin,
            "envId": env_id,
            "envPath": env_dir,
            "envsRoot": st.get("envsRoot"),
        }
    except Exception as e:
        msg = str(e)
        if "python_not_installed" in msg:
            return {
                "ok": False,
                "error": "python_not_installed",
                "needsInstall": True,
                "installUrl": "https://www.python.org/downloads/",
            }
        return {"ok": False, "error": msg}


async def python_install(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    try:
        args = args or {}
        env_id = _resolve_python_env_id(args.get("envId"))
        packages = args.get("packages") or []
        req_txt = str(args.get("requirementsTxt") or "")
        offline_only = bool(args.get("offlineOnly", False))
        allow_net = bool(args.get("allowNetworkInstall", False))

        if emit:
            await emit("using_env", {"envId": env_id})
        try:
            env_dir, py_bin = await _ensure_python_env(env_id, emit)
        except Exception as e:
            return {"ok": False, "error": str(e)}

        pip_extra: list[str] = []
        wheelhouse = str(args.get("wheelhouse") or os.environ.get("AGENT_WHEELHOUSE") or "").strip()
        use_offline = False
        if offline_only and wheelhouse and os.path.isdir(wheelhouse):
            pip_extra.extend(["--no-index", "--find-links", wheelhouse])
            use_offline = True
        elif offline_only and not wheelhouse:
            return {"ok": False, "error": "offline_wheelhouse_missing"}

        specs: list[str] = []
        if isinstance(packages, list):
            specs.extend(str(p).strip() for p in packages if str(p).strip())
        if req_txt.strip():
            specs.extend(_parse_requirements_lines(req_txt))

        packages_installed: list[str] = []
        packages_skipped: list[str] = []

        if specs:
            to_install, satisfied = await _filter_packages_to_install(py_bin, specs)
            packages_skipped.extend(satisfied)
            if satisfied and emit:
                await emit("packages_already_installed", {"packages": satisfied, "count": len(satisfied)})

            if to_install:
                if emit:
                    await emit("installing", {"envId": env_id, "mode": "offline" if use_offline else "online", "packages": to_install})
                proc = await _pip_install_packages(py_bin, to_install, quiet=False, extra_args=pip_extra or None)
                if proc.returncode != 0:
                    return {
                        "ok": False,
                        "error": proc.stderr or "install_failed",
                        "stdout": proc.stdout,
                        "packagesSkipped": packages_skipped,
                    }
                packages_installed.extend(to_install)
                _invalidate_installed_packages_cache(env_dir)
            elif emit:
                await emit("install_skipped", {"envId": env_id, "reason": "already_installed", "packages": packages_skipped})

        return {
            "ok": True,
            "envId": env_id,
            "envPath": env_dir,
            "python": py_bin,
            "packagesInstalled": packages_installed,
            "packagesSkipped": packages_skipped,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def python_list_packages(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        args = args or {}
        env_id = _resolve_python_env_id(args.get("envId"))
        env_dir = _python_env_dir(env_id)
        py_bin = _python_env_bin(env_dir)
        if not os.path.exists(py_bin):
            return {"ok": True, "envId": env_id, "ready": False, "packages": [], "count": 0}
        installed = await _list_installed_packages(py_bin, env_dir=env_dir)
        packages = sorted(
            [{"name": name, "version": version} for name, version in installed.items()],
            key=lambda row: row["name"].lower(),
        )
        return {"ok": True, "envId": env_id, "ready": True, "packages": packages, "count": len(packages)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def run_python_script(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """
    Run a Python script with automatic environment and dependency management.
    
    Args:
        code: Inline Python code to execute
        path: Path to Python script file
        args: Command-line arguments to pass to the script
        envId: Virtual environment ID (uses the shared default env when omitted)
        packages: List of packages to install (e.g., ["numpy", "pandas>=2.0"])
        requirementsTxt: Requirements.txt content as string
        timeoutMs: Script execution timeout (default: 30000)
        cwd: Working directory for script execution
        autoInstall: Auto-install missing packages (default: True)
        checkpoint: Optional boolean. When true, records a filesystem checkpoint for rollback.
    
    Returns:
        { ok, exitCode, stdout, stderr, python, envId, packagesInstalled? }
    """
    try:
        args = args or {}
        code = str(args.get("code") or "")
        path = str(args.get("path") or args.get("filePath") or "")
        arg_list = [str(a) for a in (args.get("args") or [])]
        env_id = _resolve_python_env_id(args.get("envId"))
        packages = args.get("packages") or []
        req_txt = str(args.get("requirementsTxt") or "")
        timeout_ms = int(args.get("timeoutMs") or 30000)
        cwd = args.get("cwd")
        resolved_cwd = _resolve_cwd(cwd, fallback_to_process=True)
        checkpoint = _start_command_checkpoint(resolved_cwd) if _checkpoint_requested(args) else None
        auto_install = args.get("autoInstall", True)

        # Normalize packages to list
        if isinstance(packages, str):
            packages = [p.strip() for p in packages.split(",") if p.strip()]
        elif not isinstance(packages, list):
            packages = []
        packages = [str(p).strip() for p in packages if str(p).strip()]

        if not path and not code:
            return {"ok": False, "error": "missing_code_or_path"}

        packages_installed: list[str] = []
        packages_skipped: list[str] = []
        py_bin = ""

        try:
            env_dir, py_bin = await _ensure_python_env(env_id, emit)
        except Exception as e:
            return {"ok": False, "error": str(e)}

        # Install packages if specified — skip ones already satisfied in this env.
        if auto_install and (packages or req_txt):
            install_specs: list[str] = list(packages)
            if req_txt.strip():
                install_specs.extend(_parse_requirements_lines(req_txt))

            if install_specs:
                to_install, satisfied = await _filter_packages_to_install(py_bin, install_specs)
                packages_skipped.extend(satisfied)
                if satisfied and emit:
                    await emit("packages_already_installed", {"packages": satisfied, "count": len(satisfied)})

                if to_install:
                    if emit:
                        await emit("installing_packages", {"envId": env_id, "packages": to_install, "count": len(to_install)})
                    proc = await _pip_install_packages(py_bin, to_install, quiet=True)
                    if proc.returncode != 0:
                        if emit:
                            await emit("install_error", {"error": proc.stderr[:500], "stdout": proc.stdout[:500]})
                        return {
                            "ok": False,
                            "error": f"pip_install_failed: {proc.stderr[:500]}",
                            "stdout": proc.stdout,
                            "packagesSkipped": packages_skipped,
                        }
                    packages_installed.extend(to_install)
                    _invalidate_installed_packages_cache(env_dir)
                    if emit:
                        await emit("packages_ready", {"installed": packages_installed, "skipped": packages_skipped})
                elif emit:
                    await emit("packages_ready", {"installed": [], "skipped": packages_skipped})

        # Prepare cleanup list
        cleanup: list[str] = []

        # Inject context dict as Python variables if provided
        # This is used by stream consumers to pass __streamChunk, __streamChunkIndex, etc.
        context_dict = args.get("context")
        if code and isinstance(context_dict, dict) and context_dict:
            import json as _json
            # Write context to temp file to avoid huge command lines/escaping issues
            fd_ctx, ctx_path = tempfile.mkstemp(prefix="ctx-", suffix=".json")
            try:
                os.write(fd_ctx, _json.dumps(context_dict).encode("utf-8"))
            finally:
                os.close(fd_ctx)
            cleanup.append(ctx_path)
            
            # Escape path for Windows
            safe_ctx_path = ctx_path.replace("\\", "\\\\")
            
            preamble_lines = [
                "import json as _stuard_json",
                "import os as _stuard_os",
                f"_ctx_path = '{safe_ctx_path}'",
                "context = {}",
                "if _stuard_os.path.exists(_ctx_path):",
                "    try:",
                "        with open(_ctx_path, 'r', encoding='utf-8') as _f: context = _stuard_json.load(_f)",
                "    except Exception as e: print(f'Warning: failed to load context: {e}')"
            ]
            # Also inject individual keys as top-level variables for convenience
            for k in context_dict.keys():
                safe_key = str(k)
                if safe_key.isidentifier() and not safe_key.startswith("_stuard_"):
                    preamble_lines.append(f"{safe_key} = context.get('{safe_key}')")
            preamble = "\n".join(preamble_lines) + "\n"
            code = preamble + code

        script_path = path
        if not script_path:
            fd, tmp_path = tempfile.mkstemp(prefix="stuard-run-", suffix=".py")
            os.write(fd, code.encode("utf-8"))
            os.close(fd)
            script_path = tmp_path
            cleanup.append(tmp_path)

        if emit:
            await emit("executing", {"python": py_bin, "script": script_path, "envId": env_id or None})

        try:
            rc, stdout, stderr, timed_out = await _stream_subprocess(
                [py_bin, script_path, *arg_list],
                cwd=resolved_cwd,
                timeout_ms=timeout_ms,
                emit=emit,
            )

            if timed_out:
                _finish_command_checkpoint(checkpoint)
                if emit:
                    await emit("timeout", {"timeoutMs": timeout_ms})
                return {
                    "ok": False,
                    "error": "timeout",
                    "python": py_bin,
                    "envId": env_id,
                    "envPath": env_dir,
                    "stdout": stdout[-LIVE_OUTPUT_TAIL_BYTES:],
                    "stderr": stderr[-LIVE_OUTPUT_TAIL_BYTES:],
                }

            result = {
                "ok": rc == 0,
                "exitCode": rc,
                "stdout": stdout,
                "stderr": stderr,
                "python": py_bin,
                "envId": env_id,
                "envPath": env_dir,
            }
            _finish_command_checkpoint(checkpoint)
            if packages_installed:
                result["packagesInstalled"] = packages_installed
            if packages_skipped:
                result["packagesSkipped"] = packages_skipped

            if emit:
                if rc == 0:
                    await emit("completed", {"exitCode": 0})
                else:
                    await emit("script_error", {"exitCode": rc, "stderr": stderr[:500]})

            return result
        finally:
            for p in cleanup:
                try:
                    if os.path.exists(p):
                        os.remove(p)
                except Exception:
                    pass
    except Exception as e:
        if emit:
            await emit("error", {"error": str(e)})
        return {"ok": False, "error": str(e)}


async def run_node_script(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    try:
        code = str(args.get("code") or "")
        path = str(args.get("path") or args.get("filePath") or "")
        arg_list = [str(a) for a in (args.get("args") or [])]
        timeout_ms = int(args.get("timeoutMs") or 30000)
        cwd = args.get("cwd")
        resolved_cwd = _resolve_cwd(cwd, fallback_to_process=True)
        checkpoint = _start_command_checkpoint(resolved_cwd) if _checkpoint_requested(args) else None

        # Find node executable (cached after first lookup to avoid slow PATH traversal on Windows)
        global _cached_node_bin
        if _cached_node_bin:
            node_bin = _cached_node_bin
        else:
            node_bin = await asyncio.to_thread(
                lambda: shutil.which("node") or shutil.which("nodejs")
            )
            if node_bin:
                _cached_node_bin = node_bin
        if not node_bin:
            return {"ok": False, "error": "node_not_found"}

        if not path and not code:
            return {"ok": False, "error": "missing_code_or_path"}

        cleanup: list[str] = []

        # Inject context dict if provided
        context_dict = args.get("context")
        if code and isinstance(context_dict, dict) and context_dict:
            import json as _json
            fd_ctx, ctx_path = tempfile.mkstemp(prefix="ctx-", suffix=".json")
            try:
                os.write(fd_ctx, _json.dumps(context_dict).encode("utf-8"))
            finally:
                os.close(fd_ctx)
            cleanup.append(ctx_path)
            
            # Escape path for JS string
            safe_ctx_path = ctx_path.replace("\\", "\\\\")
            
            preamble_lines = [
                "const _fs = require('fs');",
                "let context = {};",
                "try {",
                f"    if (_fs.existsSync('{safe_ctx_path}')) {{",
                f"        context = JSON.parse(_fs.readFileSync('{safe_ctx_path}', 'utf8'));",
                "    }",
                "} catch (e) { console.warn('Warning: failed to load context', e); }"
            ]
            
            # Also inject individual keys as top-level variables
            for k in context_dict.keys():
                safe_key = str(k)
                if safe_key.isidentifier():
                    preamble_lines.append(f"let {safe_key} = context['{safe_key}'];")
            
            preamble = "\n".join(preamble_lines) + "\n"
            code = preamble + code

        script_path = path
        if not script_path:
            fd, tmp_path = tempfile.mkstemp(prefix="run-", suffix=".js")
            os.write(fd, code.encode("utf-8"))
            os.close(fd)
            script_path = tmp_path
            cleanup.append(tmp_path)

        if emit:
            await emit("executing", {"node": node_bin, "path": script_path})
        
        try:
            # Run subprocess.run in a thread (handles pipe I/O correctly)
            # while emitting keepalive progress events from the async loop.
            import threading
            import time as _time
            
            done_event = threading.Event()
            result_box: dict = {}
            
            def _run_in_thread():
                try:
                    proc = subprocess.run(
                        [node_bin, script_path, *arg_list],
                        capture_output=True,
                        text=True,
                        timeout=max(0.1, timeout_ms / 1000),
                        cwd=resolved_cwd,
                    )
                    result_box["proc"] = proc
                except subprocess.TimeoutExpired as e:
                    result_box["timeout"] = True
                    result_box["stdout"] = (e.stdout or "") if isinstance(e.stdout, str) else ""
                    result_box["stderr"] = (e.stderr or "") if isinstance(e.stderr, str) else ""
                except Exception as e:
                    result_box["error"] = str(e)
                finally:
                    done_event.set()
            
            thread = threading.Thread(target=_run_in_thread, daemon=True)
            start_wall = _time.monotonic()
            thread.start()
            
            # Emit keepalive progress while waiting for thread
            last_keepalive = 0
            try:
                while not done_event.is_set():
                    await asyncio.sleep(0.5)
                    elapsed_s = _time.monotonic() - start_wall
                    sec = int(elapsed_s)
                    if emit and sec >= last_keepalive + 5:
                        last_keepalive = sec
                        await emit("running", {"elapsed": int(elapsed_s * 1000), "timeoutMs": timeout_ms})
                
                thread.join(timeout=2)
            except asyncio.CancelledError:
                return {"ok": False, "error": "cancelled"}
            
            _finish_command_checkpoint(checkpoint)
            
            if "proc" in result_box:
                proc = result_box["proc"]
                if emit:
                    await emit("completed", {"exitCode": proc.returncode})
                return {"ok": True, "exitCode": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}
            elif result_box.get("timeout"):
                if emit:
                    await emit("timeout", {"timeoutMs": timeout_ms})
                return {"ok": False, "error": "timeout", "stdout": result_box.get("stdout", ""), "stderr": result_box.get("stderr", "")}
            else:
                return {"ok": False, "error": result_box.get("error", "unknown")}
        finally:
            for p in cleanup:
                try:
                    if os.path.exists(p):
                        os.remove(p)
                except Exception:
                    pass
    except Exception as e:
        return {"ok": False, "error": str(e)}
