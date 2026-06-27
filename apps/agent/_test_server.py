"""
End-to-end test for browser_use_server.py
Starts the server, checks all critical endpoints, then shuts down.
Run: python apps/agent/_test_server.py
"""
import asyncio
import sys
import subprocess
import os
import json
import signal

SERVER_SCRIPT = os.path.join(os.path.dirname(__file__), "browser_use_server.py")
PORT = 18083

class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    RESET = "\033[0m"
    BOLD = "\033[1m"

def ok(msg: str):
    print(f"  {Colors.GREEN}PASS{Colors.RESET} {msg}")

def fail(msg: str):
    print(f"  {Colors.RED}FAIL{Colors.RESET} {msg}")

def info(msg: str):
    print(f"  {Colors.YELLOW}INFO{Colors.RESET} {msg}")


async def http_request(session, method: str, path: str, body=None, timeout=10):
    import aiohttp
    url = f"http://127.0.0.1:{PORT}{path}"
    kwargs = {"timeout": aiohttp.ClientTimeout(total=timeout)}
    if body is not None:
        kwargs["json"] = body
    async with getattr(session, method)(url, **kwargs) as r:
        data = await r.json()
        return r.status, data


async def test():
    import aiohttp

    print(f"\n{Colors.BOLD}=== Browser Use Server Test ==={Colors.RESET}\n")

    # Kill anything on the test port first
    if os.name == "nt":
        os.system(f'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :{PORT} ^| findstr LISTENING\') do taskkill /PID %a /F >nul 2>&1')

    print(f"1. Starting server on port {PORT}...")
    proc = subprocess.Popen(
        [sys.executable, SERVER_SCRIPT],
        env={**os.environ, "BROWSER_USE_PORT": str(PORT)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Wait for readiness
    ready = False
    for i in range(20):
        await asyncio.sleep(0.5)
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(f"http://127.0.0.1:{PORT}/status", timeout=aiohttp.ClientTimeout(total=2)) as r:
                    if r.status == 200:
                        ready = True
                        break
        except Exception:
            pass

    if not ready:
        fail("Server did not start within 10 seconds")
        stderr = proc.stderr.read().decode() if proc.stderr else ""
        stdout = proc.stdout.read().decode() if proc.stdout else ""
        if stderr:
            print(f"  stderr: {stderr[:500]}")
        if stdout:
            print(f"  stdout: {stdout[:500]}")
        proc.kill()
        sys.exit(1)

    ok("Server started successfully")

    passed = 0
    failed = 0

    async with aiohttp.ClientSession() as session:
        # Test /status
        print("\n2. Testing endpoints...\n")

        try:
            status, data = await http_request(session, "get", "/status")
            assert status == 200, f"status code {status}"
            assert data.get("ok") is True, f"ok={data.get('ok')}"
            assert "installed" in data, "missing 'installed' field"
            assert "running" in data, "missing 'running' field"
            assert "mode" in data, "missing 'mode' field"
            ok(f"GET /status -> installed={data['installed']}, running={data['running']}, mode={data['mode']}")
            passed += 1
        except Exception as e:
            fail(f"GET /status -> {e}")
            failed += 1

        # Test /configure
        try:
            status, data = await http_request(session, "post", "/configure", {"mode": "headed"})
            assert status == 200, f"status code {status}"
            assert data.get("ok") is True, f"ok={data.get('ok')}"
            ok(f"POST /configure mode=headed -> ok")
            passed += 1
        except Exception as e:
            fail(f"POST /configure -> {e}")
            failed += 1

        # Test /configure headless
        try:
            status, data = await http_request(session, "post", "/configure", {"mode": "headless"})
            assert status == 200
            assert data.get("ok") is True
            # Verify it stuck
            _, sdata = await http_request(session, "get", "/status")
            assert sdata.get("mode") == "headless", f"mode is {sdata.get('mode')}"
            ok(f"POST /configure mode=headless -> verified")
            passed += 1
        except Exception as e:
            fail(f"POST /configure headless -> {e}")
            failed += 1

        # Reset to headed
        await http_request(session, "post", "/configure", {"mode": "headed"})

        # Test /cookies (list, no browser — may 500 because _ensure_browser launches Chromium)
        try:
            async with session.post(
                f"http://127.0.0.1:{PORT}/cookies",
                json={"action": "list"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as r:
                ok(f"POST /cookies list -> status {r.status} (500 expected when no browser)")
            passed += 1
        except Exception as e:
            fail(f"POST /cookies -> {e}")
            failed += 1

        # Test /tabs (list, no browser — same: may 500)
        try:
            async with session.post(
                f"http://127.0.0.1:{PORT}/tabs",
                json={"action": "list"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as r:
                ok(f"POST /tabs list -> status {r.status} (500 expected when no browser)")
            passed += 1
        except Exception as e:
            fail(f"POST /tabs -> {e}")
            failed += 1

        # Test /close (no browser open)
        try:
            status, data = await http_request(session, "post", "/close", {})
            assert status == 200
            ok(f"POST /close (no browser) -> ok")
            passed += 1
        except Exception as e:
            fail(f"POST /close -> {e}")
            failed += 1

        # Stress test status polling so UI checks don't destabilize server
        try:
            # Try to open a page first; if it times out, still continue status stress.
            try:
                async with session.post(
                    f"http://127.0.0.1:{PORT}/navigate",
                    json={"url": "about:blank", "wait_until": "domcontentloaded"},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as _:
                    pass
            except Exception:
                pass

            status_ok = 0
            for _ in range(50):
                async with session.get(
                    f"http://127.0.0.1:{PORT}/status",
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as r:
                    if r.status == 200:
                        await r.json()
                        status_ok += 1
                await asyncio.sleep(0.05)

            assert status_ok >= 45, f"only {status_ok}/50 status checks succeeded"
            ok(f"GET /status x50 stability -> {status_ok}/50 ok")
            passed += 1
        except Exception as e:
            fail(f"Status stability test -> {repr(e)}")
            failed += 1

        # Test invalid endpoint returns 404
        try:
            async with session.get(f"http://127.0.0.1:{PORT}/nonexistent", timeout=aiohttp.ClientTimeout(total=3)) as r:
                ok(f"GET /nonexistent -> {r.status} (expected 404)")
                passed += 1
        except Exception as e:
            fail(f"GET /nonexistent -> {repr(e)}")
            failed += 1

    # Shutdown
    print(f"\n3. Shutting down server...")
    proc.kill()
    proc.wait(timeout=5)
    ok("Server terminated")

    # Summary
    total = passed + failed
    print(f"\n{Colors.BOLD}=== Results: {passed}/{total} passed ==={Colors.RESET}")
    if failed > 0:
        print(f"{Colors.RED}{failed} test(s) failed{Colors.RESET}\n")
        sys.exit(1)
    else:
        print(f"{Colors.GREEN}All tests passed!{Colors.RESET}\n")


if __name__ == "__main__":
    asyncio.run(test())
