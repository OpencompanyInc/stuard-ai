"""Cross-platform Chrome lifecycle manager.

Consolidates Chrome detection, launch, and management for the browser server.
Replaces browser-use dependency for browser lifecycle with pure Playwright + CDP.
"""

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

class _ChromeProcessHandle:
    """Lightweight stand-in for subprocess.Popen when Chrome was launched via PowerShell.

    Provides poll() and pid so the wait loop can check if Chrome is still alive.
    """

    def __init__(self, exe_name: str):
        self._exe_name = Path(exe_name).name.lower()  # e.g. "chrome.exe"
        self.pid = self._find_pid()
        self.returncode = None
        self.stderr = None

    def _find_pid(self) -> int:
        """Find the main Chrome process PID."""
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {self._exe_name}", "/NH", "/FO", "CSV"],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.strip().splitlines():
                parts = line.strip('"').split('","')
                if len(parts) >= 2:
                    return int(parts[1])
        except Exception:
            pass
        return 0

    def poll(self):
        """Return None if Chrome is still running, else a return code."""
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"IMAGENAME eq {self._exe_name}", "/NH"],
                capture_output=True, text=True, timeout=5,
            )
            if self._exe_name in result.stdout.lower():
                return None  # still running
        except Exception:
            return None  # assume running if we can't check
        self.returncode = -1
        return -1


from browser_server.profile import (
    _find_local_browser_executable,
    _detect_chrome_debug_port,
    _is_browser_user_data_dir_locked,
)


def find_chrome_binary(browser_name: str = "Chrome") -> Optional[str]:
    """Find Chrome/Chromium binary on the system.

    Extends profile._find_local_browser_executable with:
    - Windows Registry lookup
    - Linux shutil.which() fallback
    """
    # Try the existing path-based lookup first
    exe = _find_local_browser_executable(browser_name)
    if exe:
        return exe

    normalized = browser_name.strip().lower()

    # Windows: try Registry
    if sys.platform == "win32":
        try:
            import winreg
            reg_paths = []
            if normalized in ("chrome", "google chrome"):
                reg_paths = [
                    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
                    (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
                ]
            elif normalized == "edge":
                reg_paths = [
                    (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"),
                ]
            for hkey, key_path in reg_paths:
                try:
                    with winreg.OpenKey(hkey, key_path) as key:
                        value, _ = winreg.QueryValueEx(key, "")
                        if value and Path(value).exists():
                            return str(value)
                except (FileNotFoundError, OSError):
                    continue
        except ImportError:
            pass

    # Linux: shutil.which fallback
    if sys.platform.startswith("linux"):
        which_names = []
        if normalized in ("chrome", "google chrome"):
            which_names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
        elif normalized == "chrome beta":
            which_names = ["google-chrome-beta"]
        elif normalized == "edge":
            which_names = ["microsoft-edge", "microsoft-edge-stable"]
        elif normalized == "brave":
            which_names = ["brave-browser", "brave-browser-stable"]
        for name in which_names:
            found = shutil.which(name)
            if found:
                return found

    return None


def find_user_data_dir(browser_name: str = "Chrome") -> Optional[str]:
    """Find the default user data directory for a browser."""
    normalized = browser_name.strip().lower()
    home = Path.home()

    if sys.platform == "win32":
        local = Path(os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local")))
        dirs = {
            "chrome": local / "Google" / "Chrome" / "User Data",
            "chrome beta": local / "Google" / "Chrome Beta" / "User Data",
            "edge": local / "Microsoft" / "Edge" / "User Data",
            "brave": local / "BraveSoftware" / "Brave-Browser" / "User Data",
        }
    elif sys.platform == "darwin":
        app_support = home / "Library" / "Application Support"
        dirs = {
            "chrome": app_support / "Google" / "Chrome",
            "chrome beta": app_support / "Google" / "Chrome Beta",
            "edge": app_support / "Microsoft Edge",
            "brave": app_support / "BraveSoftware" / "Brave-Browser",
        }
    else:
        config = home / ".config"
        dirs = {
            "chrome": config / "google-chrome",
            "chrome beta": config / "google-chrome-beta",
            "edge": config / "microsoft-edge",
            "brave": config / "BraveSoftware" / "Brave-Browser",
        }

    candidate = dirs.get(normalized)
    if candidate and candidate.is_dir():
        return str(candidate)
    return None


def detect_debug_port(user_data_dir: str) -> Optional[int]:
    """Detect if Chrome is running with a debug port. Delegates to profile module."""
    return _detect_chrome_debug_port(user_data_dir)


def is_chrome_running(user_data_dir: str) -> bool:
    """Check if Chrome is running (using lockfile detection). Delegates to profile module."""
    return _is_browser_user_data_dir_locked(user_data_dir)


def _no_chrome_processes(exe_name: str) -> bool:
    """Check if zero processes with this exe name are running (Windows only)."""
    try:
        result = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {exe_name}", "/NH"],
            capture_output=True, text=True, timeout=5,
        )
        # tasklist prints "INFO: No tasks are running..." when nothing matches
        return exe_name.lower() not in result.stdout.lower()
    except Exception:
        return True  # assume gone if we can't check


def graceful_kill_chrome(browser_name: str = "Chrome", timeout: float = 15.0) -> bool:
    """Gracefully quit Chrome so it saves session state, then clean up child processes.

    Two-phase approach on Windows:
    1. Gentle taskkill (WM_CLOSE) — Chrome saves tabs/cookies/session
    2. Force-kill lingering child processes (renderer, GPU, etc.)

    Returns True if Chrome was stopped (or wasn't running).
    """
    normalized = browser_name.strip().lower()
    import time

    try:
        if sys.platform == "win32":
            exe_names = {
                "chrome": "chrome.exe",
                "chrome beta": "chrome.exe",
                "edge": "msedge.exe",
                "brave": "brave.exe",
            }
            exe_name = exe_names.get(normalized, "chrome.exe")

            # Phase 1: Gentle kill — sends WM_CLOSE so Chrome saves session state
            print(f"[browser-server] Sending gentle close to {exe_name} (saving session)...", flush=True)
            subprocess.run(
                ["taskkill", "/IM", exe_name],
                capture_output=True, timeout=5, text=True,
            )

            # Wait for main process to exit (it saves session during this time)
            gentle_deadline = time.monotonic() + 8.0
            user_data_dir = find_user_data_dir(browser_name)
            main_exited = False
            while time.monotonic() < gentle_deadline:
                if user_data_dir and not is_chrome_running(user_data_dir):
                    main_exited = True
                    print(f"[browser-server] Chrome main process saved session and exited", flush=True)
                    break
                time.sleep(0.5)

            # Phase 2: Force-kill any lingering child processes
            if not _no_chrome_processes(exe_name):
                print(f"[browser-server] Force-killing remaining {exe_name} child processes...", flush=True)
                subprocess.run(
                    ["taskkill", "/F", "/IM", exe_name],
                    capture_output=True, timeout=10, text=True,
                )

        elif sys.platform == "darwin":
            app_names = {
                "chrome": "Google Chrome",
                "chrome beta": "Google Chrome Beta",
                "edge": "Microsoft Edge",
                "brave": "Brave Browser",
            }
            app_name = app_names.get(normalized, "Google Chrome")
            subprocess.run(
                ["osascript", "-e", f'tell application "{app_name}" to quit'],
                capture_output=True, timeout=5,
            )
        else:
            process_names = {
                "chrome": ["chrome", "google-chrome"],
                "chrome beta": ["google-chrome-beta"],
                "edge": ["microsoft-edge", "msedge"],
                "brave": ["brave", "brave-browser"],
            }
            names = process_names.get(normalized, ["chrome", "google-chrome"])
            for name in names:
                subprocess.run(
                    ["pkill", "-TERM", name],
                    capture_output=True, timeout=5,
                )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        print(f"[browser-server] Kill attempt error: {e}", flush=True)

    # Wait for ALL processes to be gone
    deadline = time.monotonic() + timeout
    user_data_dir = find_user_data_dir(browser_name)

    if sys.platform == "win32":
        exe_name = {"chrome": "chrome.exe", "chrome beta": "chrome.exe",
                    "edge": "msedge.exe", "brave": "brave.exe"}.get(normalized, "chrome.exe")
        while time.monotonic() < deadline:
            if _no_chrome_processes(exe_name):
                print(f"[browser-server] All {exe_name} processes terminated", flush=True)
                return True
            time.sleep(0.5)
        print(f"[browser-server] Some {exe_name} processes still running after {timeout}s", flush=True)
        return False

    # Non-Windows: poll lockfile
    if not user_data_dir:
        time.sleep(3)
        return True
    while time.monotonic() < deadline:
        if not is_chrome_running(user_data_dir):
            print(f"[browser-server] Chrome exited successfully", flush=True)
            return True
        time.sleep(0.5)

    print(f"[browser-server] Could not kill Chrome within {timeout}s", flush=True)
    return False


def _wait_for_lockfile_release(user_data_dir: str, timeout: float = 10.0) -> bool:
    """Wait until Chrome's lockfile in user_data_dir can be deleted (= no process holds it)."""
    import time
    ud = Path(user_data_dir)
    lockfile = ud / "lockfile"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not lockfile.exists():
            return True
        try:
            lockfile.unlink()
            print(f"[browser-server] Lockfile released and removed", flush=True)
            return True
        except (PermissionError, OSError):
            pass
        time.sleep(0.5)
    print(f"[browser-server] WARNING: lockfile still locked after {timeout}s — Chrome processes may be lingering", flush=True)
    return False


def launch_chrome_with_debug_port(
    binary: str,
    user_data_dir: str,
    profile: str = "Default",
    port: int = 9222,
    headless: bool = False,
) -> Optional[Any]:
    """Launch Chrome with --remote-debugging-port and wait for it to be ready.

    Returns a process handle (Popen or _ChromeProcessHandle), or None if launch failed.
    """
    import time
    import urllib.request

    ud = Path(user_data_dir)

    # Wait for lockfile to be released — if Chrome was just killed, its child
    # processes (GPU, crashpad) may still hold the lock.  If we launch Chrome
    # while the lockfile is held it thinks another instance is running and does
    # a "process handoff" that silently drops our --remote-debugging-port flag.
    if sys.platform == "win32":
        _wait_for_lockfile_release(user_data_dir, timeout=10.0)

    # Delete stale files from previous session that could interfere
    for stale_name in ("DevToolsActivePort", "lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"):
        stale = ud / stale_name
        if stale.exists() or stale.is_symlink():
            try:
                stale.unlink()
                print(f"[browser-server] Removed stale {stale_name}", flush=True)
            except Exception as e:
                print(f"[browser-server] Could not remove {stale_name}: {e}", flush=True)

    dt_file = ud / "DevToolsActivePort"

    chrome_args = [
        f"--remote-debugging-port={port}",
        "--restore-last-session",
        f"--user-data-dir={user_data_dir}",
        f"--profile-directory={profile}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
    ]
    if headless:
        chrome_args.append("--headless=new")

    print(f"[browser-server] Launching: {binary}", flush=True)
    print(f"[browser-server]   args: {chrome_args}", flush=True)

    try:
        if sys.platform == "win32":
            # Use subprocess.Popen with DETACHED_PROCESS so Chrome runs
            # independently.  Python's subprocess module handles quoting of
            # arguments that contain spaces (like --user-data-dir=...User Data)
            # automatically via list2cmdline().
            #
            # Chrome's "process handoff" (where a new chrome.exe detects an
            # existing instance and forwards to it, dropping CLI flags) only
            # happens when Chrome's lockfile is held.  We wait above until the
            # lockfile is released, so subprocess.Popen works fine here.
            DETACHED = 0x00000008   # DETACHED_PROCESS
            NEW_PG   = 0x00000200   # CREATE_NEW_PROCESS_GROUP
            proc = subprocess.Popen(
                [binary] + chrome_args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=DETACHED | NEW_PG,
                close_fds=True,
            )
            print(f"[browser-server] Chrome launched (PID {proc.pid})", flush=True)
            # Chrome may do a quick process handoff even without a lockfile
            # (e.g. to upgrade). Give it a moment, then track via tasklist
            # if the original PID dies.
            time.sleep(2)
            if proc.poll() is not None:
                print(f"[browser-server] Initial PID exited (handoff), tracking via tasklist", flush=True)
                proc = _ChromeProcessHandle(binary)
        else:
            proc = subprocess.Popen(
                [binary] + chrome_args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
    except (FileNotFoundError, OSError) as e:
        print(f"[browser-server] Failed to launch Chrome: {e}", flush=True)
        return None

    # Wait for debug port to become ready
    deadline = time.monotonic() + 30.0

    while time.monotonic() < deadline:
        # Check if Chrome is alive
        if proc.poll() is not None:
            print(f"[browser-server] Chrome exited with code {proc.returncode}", flush=True)
            return None

        # Check DevToolsActivePort file
        if dt_file.exists():
            try:
                content = dt_file.read_text().strip()
                lines = content.split("\n")
                if lines:
                    detected_port = int(lines[0].strip())
                    urllib.request.urlopen(
                        f"http://127.0.0.1:{detected_port}/json/version", timeout=2
                    )
                    print(f"[browser-server] Debug port {detected_port} ready (DevToolsActivePort)", flush=True)
                    return proc
            except Exception:
                pass

        # Direct HTTP check
        try:
            resp = urllib.request.urlopen(
                f"http://127.0.0.1:{port}/json/version", timeout=2
            )
            if resp.status == 200:
                print(f"[browser-server] Debug port {port} ready (HTTP)", flush=True)
                return proc
        except Exception:
            pass

        time.sleep(1)

    print(f"[browser-server] Debug port {port} did not become ready within 30s", flush=True)
    if proc.poll() is None:
        print(f"[browser-server] Chrome is running (PID {proc.pid}) but debug port not responding", flush=True)
    return None


async def ensure_chrome_debug_connection(
    browser_name: str = "Chrome",
    user_data_dir: Optional[str] = None,
    profile: str = "Default",
    port: int = 9222,
    headless: bool = False,
) -> Optional[str]:
    """Orchestrator: ensure Chrome is running with a debug port and return the CDP URL.

    1. Debug port already active? → return CDP URL
    2. Chrome running without port? → graceful kill → relaunch with port
    3. Chrome not running? → launch with port
    4. Verify port is actually responding → return URL or None
    """
    if not user_data_dir:
        user_data_dir = find_user_data_dir(browser_name)
    if not user_data_dir:
        print(f"[browser-server] Could not find user data dir for {browser_name}", flush=True)
        return None

    # 1. Check if debug port is already active
    existing_port = detect_debug_port(user_data_dir)
    if existing_port:
        print(f"[browser-server] Chrome debug port {existing_port} already active", flush=True)
        return f"http://127.0.0.1:{existing_port}"

    binary = find_chrome_binary(browser_name)
    if not binary:
        print(f"[browser-server] Could not find {browser_name} binary", flush=True)
        return None

    # 2. Set up debug port permanently so future launches don't need restart
    try:
        from app.browser_cookies import enable_chrome_debug_port
        setup_result = enable_chrome_debug_port(port)
        if setup_result.get("success"):
            print(f"[browser-server] Debug port permanently configured: {setup_result.get('message', '')}", flush=True)
        else:
            print(f"[browser-server] Permanent debug port setup skipped: {setup_result.get('message', '')}", flush=True)
    except Exception as setup_err:
        print(f"[browser-server] Permanent debug port setup failed (non-fatal): {setup_err}", flush=True)

    # 3. Chrome running without debug port? → graceful quit → relaunch
    chrome_running = is_chrome_running(user_data_dir)
    if chrome_running:
        print(f"[browser-server] Chrome is running without debug port — gracefully quitting to preserve session...", flush=True)
        killed = await asyncio.to_thread(graceful_kill_chrome, browser_name)
        if not killed:
            print(f"[browser-server] Could not stop Chrome gracefully", flush=True)
            return None
        # launch_chrome_with_debug_port will wait for the lockfile to be
        # released before starting Chrome, so no extra sleep needed here.
    else:
        print(f"[browser-server] Chrome is not running — will launch fresh", flush=True)

    # 4. Launch Chrome with debug port (waits up to 30s for port to respond)
    print(f"[browser-server] Launching Chrome with debug port {port}", flush=True)
    proc = await asyncio.to_thread(
        launch_chrome_with_debug_port, binary, user_data_dir, profile, port, headless
    )
    if proc is None:
        print(f"[browser-server] Chrome launch failed", flush=True)
        return None

    # launch_chrome_with_debug_port already verified the port via HTTP.
    # Do one final check to confirm.
    import urllib.request
    try:
        resp = urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=3)
        if resp.status == 200:
            print(f"[browser-server] Chrome debug port {port} confirmed", flush=True)
            return f"http://127.0.0.1:{port}"
    except Exception:
        pass

    # Check DevToolsActivePort for a different port
    detected = await asyncio.to_thread(detect_debug_port, user_data_dir)
    if detected:
        return f"http://127.0.0.1:{detected}"

    print(f"[browser-server] Chrome launched but debug port {port} not responding", flush=True)
    return None
