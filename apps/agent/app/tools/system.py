from __future__ import annotations

import asyncio
import os
import shlex
import shutil
import subprocess
import sys
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
    for cur_root, dirnames, filenames in os.walk(root_abs):
        dirs.add(cur_root)
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


def _start_command_checkpoint(cwd: Optional[str]) -> Optional[Dict[str, Any]]:
    root_input = cwd if isinstance(cwd, str) and cwd.strip() else os.getcwd()
    root = os.path.abspath(os.path.expanduser(root_input))
    if not os.path.isdir(root):
        return None

    if not _is_safe_path(root):
        return None

    snap = _collect_path_snapshot(root)
    for fp in snap["files"].keys():
        try:
            CheckpointManager.record_change(fp, "modify")
        except Exception:
            continue

    return snap


def _finish_command_checkpoint(before: Optional[Dict[str, Any]]) -> None:
    if not before:
        return

    root = str(before.get("root") or "").strip()
    if not root:
        return

    after = _collect_path_snapshot(root)
    before_files = set(before.get("files", {}).keys())
    after_files = set(after.get("files", {}).keys())
    created_files = after_files - before_files

    before_dirs = set(before.get("dirs", set()))
    after_dirs = set(after.get("dirs", set()))
    created_dirs = after_dirs - before_dirs

    for fp in created_files:
        try:
            CheckpointManager.record_change(fp, "create")
        except Exception:
            continue

    # Delete deepest directories first on restore
    for dp in sorted(created_dirs, key=len, reverse=True):
        try:
            CheckpointManager.record_change(dp, "create")
        except Exception:
            continue


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


async def run_system_command(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    cmd = str(args.get("command") or "").strip()
    timeout_ms = int(args.get("timeoutMs") or 30000)
    background = bool(args.get("background") or False)
    # SECURITY: Default to shell=False unless explicitly requested to prevent injection
    use_shell = bool(args.get("shell") or False)
    cwd = args.get("cwd")
    terminal_id = args.get("terminalId")
    if not cmd:
        raise ValueError("missing command")

    checkpoint = _start_command_checkpoint(cwd if isinstance(cwd, str) else None)

    if emit:
        await emit("executing", {"command": cmd})
    if background:
        return _start_terminal_session(
            command=cmd,
            argv=None if use_shell else shlex.split(cmd),
            shell=use_shell,
            shell_used="system",
            cwd=cwd if isinstance(cwd, str) and cwd else None,
            terminal_id=str(terminal_id) if terminal_id is not None else None,
            checkpoint_before=checkpoint,
        )
    try:
        if use_shell:
            completed = await asyncio.to_thread(
                subprocess.run,
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout_ms/1000,
                cwd=cwd if isinstance(cwd, str) and cwd else None,
            )
        else:
            argv = shlex.split(cmd)
            completed = await asyncio.to_thread(
                subprocess.run,
                argv,
                shell=False,
                capture_output=True,
                text=True,
                timeout=timeout_ms/1000,
                cwd=cwd if isinstance(cwd, str) and cwd else None,
            )

        _finish_command_checkpoint(checkpoint)
            
        return {"ok": True, "exitCode": completed.returncode, "stdout": completed.stdout, "stderr": completed.stderr}
    except subprocess.TimeoutExpired:
        _finish_command_checkpoint(checkpoint)
        return {"ok": False, "error": "timeout"}


async def run_command(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    cmd = str(args.get("command") or "").strip()
    shell_pref = str(args.get("shell") or "auto").lower()
    timeout_ms = int(args.get("timeoutMs") or 30000)
    cwd = args.get("cwd")
    background = bool(args.get("background") or False)
    terminal_id = args.get("terminalId")
    if not cmd:
        raise ValueError("missing command")

    checkpoint = _start_command_checkpoint(cwd if isinstance(cwd, str) else None)

    def _is_windows() -> bool:
        return sys.platform.startswith("win")

    def _exists(path: str) -> bool:
        try:
            return os.path.exists(path)
        except Exception:
            return False

    shell_used = ""
    argv = []  # type: ignore[var-annotated]
    if _is_windows():
        if shell_pref in ("auto", "powershell", "pwsh"):
            exe = shutil.which("pwsh") or shutil.which("powershell") or "powershell"
            shell_used = "powershell"
            argv = [exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd]
        elif shell_pref == "cmd":
            shell_used = "cmd"
            argv = ["cmd.exe", "/d", "/c", cmd]
        else:
            shell_used = "cmd"
            argv = ["cmd.exe", "/d", "/c", cmd]
    else:
        if shell_pref in ("auto", "bash"):
            exe = "/bin/bash" if _exists("/bin/bash") else (shutil.which("bash") or "/bin/sh")
            shell_used = "bash" if "bash" in exe else "sh"
            argv = [exe, "-lc", cmd]
        elif shell_pref == "sh":
            exe = "/bin/sh"
            shell_used = "sh"
            argv = [exe, "-lc", cmd]
        else:
            exe = "/bin/sh"
            shell_used = "sh"
            argv = [exe, "-lc", cmd]

    if emit:
        await emit("executing", {"command": cmd, "shell": shell_used})
    if background:
        return _start_terminal_session(
            command=cmd,
            argv=[str(a) for a in argv],
            shell=False,
            shell_used=shell_used,
            cwd=cwd if isinstance(cwd, str) and cwd else None,
            terminal_id=str(terminal_id) if terminal_id is not None else None,
            checkpoint_before=checkpoint,
        )
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            argv,
            shell=False,
            capture_output=True,
            text=True,
            timeout=timeout_ms / 1000,
            cwd=cwd if isinstance(cwd, str) and cwd else None,
        )
        _finish_command_checkpoint(checkpoint)
        return {"ok": True, "exitCode": completed.returncode, "stdout": completed.stdout, "stderr": completed.stderr, "shell": shell_used}
    except subprocess.TimeoutExpired:
        _finish_command_checkpoint(checkpoint)
        return {"ok": False, "error": "timeout", "shell": shell_used}


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


def _envs_base_dir() -> str:
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or os.path.expanduser("~\\AppData\\Roaming")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(base, "StuardAI", "python", "envs")


async def python_status(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        exe = sys.executable or ""
        envs_root = _envs_base_dir()
        envs = []
        try:
            if os.path.isdir(envs_root):
                for name in os.listdir(envs_root):
                    p = os.path.join(envs_root, name)
                    if os.path.isdir(p):
                        envs.append(name)
        except Exception:
            envs = []
        return {
            "ok": True,
            "available": bool(exe),
            "python": exe,
            "version": sys.version.split("\n")[0],
            "envsRoot": envs_root,
            "envs": envs,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def python_setup(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        st = await python_status({})
        return {"ok": bool(st.get("available")), "python": st.get("python"), "envsRoot": st.get("envsRoot")}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def python_install(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    try:
        env_id = str(args.get("envId") or "").strip()
        if not env_id:
            return {"ok": False, "error": "missing_envId"}
        packages = args.get("packages") or []
        req_txt = str(args.get("requirementsTxt") or "")
        offline_only = bool(args.get("offlineOnly", False))
        allow_net = bool(args.get("allowNetworkInstall", False))

        envs_root = _envs_base_dir()
        os.makedirs(envs_root, exist_ok=True)
        env_dir = os.path.join(envs_root, env_id)
        py_bin = os.path.join(env_dir, "Scripts", "python.exe") if sys.platform.startswith("win") else os.path.join(env_dir, "bin", "python3")

        if emit:
            await emit("creating_env", {"envId": env_id})

        if not os.path.exists(py_bin):
            # Use --without-pip to avoid venvlauncher.exe copy issues on Python 3.13+
            create_cmd = [sys.executable, "-m", "venv", "--without-pip", env_dir]
            try:
                await asyncio.to_thread(subprocess.run, create_cmd, check=True, capture_output=True, text=True)
            except Exception as e:
                return {"ok": False, "error": f"venv_create_failed: {e}"}

        if emit:
            await emit("ensuring_pip", {"envId": env_id})
        try:
            await asyncio.to_thread(subprocess.run, [py_bin, "-m", "ensurepip", "--upgrade"], check=True)
            await asyncio.to_thread(subprocess.run, [py_bin, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], check=True)
        except Exception:
            pass

        install_args: list[str] = [py_bin, "-m", "pip", "install"]
        wheelhouse = str(args.get("wheelhouse") or os.environ.get("AGENT_WHEELHOUSE") or "").strip()
        use_offline = False
        if offline_only and wheelhouse and os.path.isdir(wheelhouse):
            install_args.extend(["--no-index", "--find-links", wheelhouse])
            use_offline = True
        elif offline_only and not wheelhouse:
            return {"ok": False, "error": "offline_wheelhouse_missing"}

        tmp_req = None
        if req_txt.strip():
            fd, tmp_req = tempfile.mkstemp(prefix="req-", suffix=".txt")
            os.write(fd, req_txt.encode("utf-8"))
            os.close(fd)

        try:
            if emit:
                await emit("installing", {"envId": env_id, "mode": "offline" if use_offline else "online"})
            if tmp_req:
                cmd = install_args + ["-r", tmp_req]
                proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    return {"ok": False, "error": proc.stderr or "install_failed", "stdout": proc.stdout}
            if isinstance(packages, list) and packages:
                specs = [str(p) for p in packages if str(p).strip()]
                if specs:
                    cmd = install_args + specs
                    proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True)
                    if proc.returncode != 0:
                        return {"ok": False, "error": proc.stderr or "install_failed", "stdout": proc.stdout}
        finally:
            try:
                if tmp_req and os.path.exists(tmp_req):
                    os.remove(tmp_req)
            except Exception:
                pass

        return {"ok": True, "envId": env_id, "python": py_bin}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def run_python_script(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """
    Run a Python script with automatic environment and dependency management.
    
    Args:
        code: Inline Python code to execute
        path: Path to Python script file
        args: Command-line arguments to pass to the script
        envId: Virtual environment ID (auto-created if doesn't exist)
        packages: List of packages to install (e.g., ["numpy", "pandas>=2.0"])
        requirementsTxt: Requirements.txt content as string
        timeoutMs: Script execution timeout (default: 30000)
        cwd: Working directory for script execution
        autoInstall: Auto-install missing packages (default: True)
    
    Returns:
        { ok, exitCode, stdout, stderr, python, envId, packagesInstalled? }
    """
    try:
        code = str(args.get("code") or "")
        path = str(args.get("path") or "")
        arg_list = [str(a) for a in (args.get("args") or [])]
        env_id = str(args.get("envId") or "").strip()
        packages = args.get("packages") or []
        req_txt = str(args.get("requirementsTxt") or "")
        timeout_ms = int(args.get("timeoutMs") or 30000)
        cwd = args.get("cwd")
        checkpoint = _start_command_checkpoint(cwd if isinstance(cwd, str) else None)
        auto_install = args.get("autoInstall", True)

        # Normalize packages to list
        if isinstance(packages, str):
            packages = [p.strip() for p in packages.split(",") if p.strip()]
        elif not isinstance(packages, list):
            packages = []
        packages = [str(p).strip() for p in packages if str(p).strip()]

        if not path and not code:
            return {"ok": False, "error": "missing_code_or_path"}

        envs_root = _envs_base_dir()
        packages_installed: list[str] = []

        # If packages are specified but no envId, auto-generate one
        if (packages or req_txt) and not env_id:
            import hashlib
            content_hash = hashlib.md5((code + path + ",".join(sorted(packages)) + req_txt).encode()).hexdigest()[:8]
            env_id = f"script_{content_hash}"
            if emit:
                await emit("auto_env", {"envId": env_id, "reason": "packages_specified"})

        env_dir = os.path.join(envs_root, env_id) if env_id else ""
        py_bin = ""

        if env_id:
            py_bin = os.path.join(env_dir, "Scripts", "python.exe") if sys.platform.startswith("win") else os.path.join(env_dir, "bin", "python3")
            
            # Create environment if it doesn't exist
            if not os.path.exists(py_bin):
                if emit:
                    await emit("creating_env", {"envId": env_id, "path": env_dir})
                
                try:
                    os.makedirs(envs_root, exist_ok=True)
                    # Use --without-pip to avoid venvlauncher.exe copy issues on Python 3.13+
                    create_cmd = [sys.executable, "-m", "venv", "--without-pip", env_dir]
                    proc = await asyncio.to_thread(subprocess.run, create_cmd, capture_output=True, text=True)
                    if proc.returncode != 0:
                        return {"ok": False, "error": f"venv_create_failed: {proc.stderr}", "stdout": proc.stdout}
                    
                    if emit:
                        await emit("env_created", {"envId": env_id})
                except Exception as e:
                    return {"ok": False, "error": f"venv_create_failed: {e}"}

            # Ensure pip is available
            pip_check = await asyncio.to_thread(
                subprocess.run, [py_bin, "-m", "pip", "--version"],
                capture_output=True, text=True
            )
            if pip_check.returncode != 0:
                if emit:
                    await emit("installing_pip", {"envId": env_id})
                try:
                    await asyncio.to_thread(subprocess.run, [py_bin, "-m", "ensurepip", "--upgrade"], capture_output=True, check=False)
                    await asyncio.to_thread(subprocess.run, [py_bin, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], capture_output=True, check=False)
                except Exception:
                    pass

            # Install packages if specified
            if auto_install and (packages or req_txt):
                install_args = [py_bin, "-m", "pip", "install", "--quiet"]
                
                # Install from requirements.txt content
                if req_txt.strip():
                    if emit:
                        await emit("installing_requirements", {"envId": env_id, "content": req_txt[:200]})
                    fd, tmp_req = tempfile.mkstemp(prefix="req-", suffix=".txt")
                    try:
                        os.write(fd, req_txt.encode("utf-8"))
                        os.close(fd)
                        proc = await asyncio.to_thread(
                            subprocess.run,
                            install_args + ["-r", tmp_req],
                            capture_output=True, text=True
                        )
                        if proc.returncode != 0:
                            if emit:
                                await emit("install_error", {"error": proc.stderr[:500], "stdout": proc.stdout[:500]})
                            return {"ok": False, "error": f"pip_install_failed: {proc.stderr[:500]}", "stdout": proc.stdout}
                        packages_installed.append("requirements.txt")
                    finally:
                        try:
                            os.remove(tmp_req)
                        except Exception:
                            pass

                # Install individual packages
                if packages:
                    if emit:
                        await emit("installing_packages", {"envId": env_id, "packages": packages, "count": len(packages)})
                    
                    for pkg in packages:
                        if emit:
                            await emit("installing_package", {"package": pkg})
                        proc = await asyncio.to_thread(
                            subprocess.run,
                            install_args + [pkg],
                            capture_output=True, text=True
                        )
                        if proc.returncode != 0:
                            # Try to continue with other packages
                            if emit:
                                await emit("package_install_warning", {"package": pkg, "error": proc.stderr[:200]})
                        else:
                            packages_installed.append(pkg)
                            if emit:
                                await emit("package_installed", {"package": pkg})
                    
                    if emit:
                        await emit("packages_ready", {"installed": packages_installed, "count": len(packages_installed)})
        else:
            # Use system Python - prefer PATH python over bundled exe to avoid polluting user scripts with our dependencies
            # In packaged PyInstaller builds, sys.executable is the bundled Python which has all our imports
            is_frozen = getattr(sys, 'frozen', False) or hasattr(sys, '_MEIPASS')
            if is_frozen:
                # Prefer system Python from PATH to keep user scripts clean
                py_bin = shutil.which("python") or shutil.which("python3") or shutil.which("py") or sys.executable
            else:
                py_bin = sys.executable or shutil.which("python") or shutil.which("python3") or ("py" if sys.platform.startswith("win") else "python")

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
            proc = await asyncio.to_thread(
                subprocess.run,
                [py_bin, script_path, *arg_list],
                capture_output=True,
                text=True,
                timeout=max(0.1, timeout_ms / 1000),
                cwd=cwd if isinstance(cwd, str) and cwd else None,
            )
            
            result = {
                "ok": proc.returncode == 0,
                "exitCode": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
                "python": py_bin,
            }
            _finish_command_checkpoint(checkpoint)
            if env_id:
                result["envId"] = env_id
            if packages_installed:
                result["packagesInstalled"] = packages_installed
            
            if emit:
                if proc.returncode == 0:
                    await emit("completed", {"exitCode": 0})
                else:
                    await emit("script_error", {"exitCode": proc.returncode, "stderr": proc.stderr[:500]})
            
            return result
        except subprocess.TimeoutExpired:
            _finish_command_checkpoint(checkpoint)
            if emit:
                await emit("timeout", {"timeoutMs": timeout_ms})
            return {"ok": False, "error": "timeout", "python": py_bin, "envId": env_id or None}
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
        path = str(args.get("path") or "")
        arg_list = [str(a) for a in (args.get("args") or [])]
        timeout_ms = int(args.get("timeoutMs") or 30000)
        cwd = args.get("cwd")
        checkpoint = _start_command_checkpoint(cwd if isinstance(cwd, str) else None)

        # Find node executable
        node_bin = shutil.which("node") or shutil.which("nodejs")
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
            proc = await asyncio.to_thread(
                subprocess.run,
                [node_bin, script_path, *arg_list],
                capture_output=True,
                text=True,
                timeout=max(0.1, timeout_ms / 1000),
                cwd=cwd if isinstance(cwd, str) and cwd else None,
            )
            _finish_command_checkpoint(checkpoint)
            return {"ok": True, "exitCode": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}
        except subprocess.TimeoutExpired:
            _finish_command_checkpoint(checkpoint)
            return {"ok": False, "error": "timeout"}
        finally:
            for p in cleanup:
                try:
                    if os.path.exists(p):
                        os.remove(p)
                except Exception:
                    pass
    except Exception as e:
        return {"ok": False, "error": str(e)}
