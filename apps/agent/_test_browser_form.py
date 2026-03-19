"""
End-to-end test for browser-use form interactions.
Tests dropdowns (native + searchable combobox), file upload, toggles,
checkboxes, and text inputs against test_browser_form.html.

Run: python apps/agent/_test_browser_form.py

Requires the browser_use_server to be running (it will start one automatically).
"""
import asyncio
import sys
import subprocess
import os
import json
import threading
import http.server
import functools
from pathlib import Path

THIS_DIR = Path(__file__).parent
SERVER_SCRIPT = THIS_DIR / "browser_use_server.py"
TEST_HTML = THIS_DIR / "test_browser_form.html"
PORT = 18084  # different from the main test

# Real resume for upload testing
DUMMY_RESUME = Path("C:/Users/solar/Downloads/Misc/Resume.pdf")


class C:
    G = "\033[92m"
    R = "\033[91m"
    Y = "\033[93m"
    B = "\033[94m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RST = "\033[0m"


passed = 0
failed = 0
errors = []


def ok(msg: str):
    global passed
    passed += 1
    print(f"  {C.G}PASS{C.RST} {msg}")


def fail(msg: str, detail: str = ""):
    global failed
    failed += 1
    errors.append(msg)
    print(f"  {C.R}FAIL{C.RST} {msg}")
    if detail:
        print(f"        {C.DIM}{detail[:300]}{C.RST}")


def info(msg: str):
    safe = msg.encode("ascii", errors="replace").decode("ascii")
    print(f"  {C.Y}INFO{C.RST} {safe}")


def section(msg: str):
    print(f"\n  {C.BOLD}{C.B}-- {msg} --{C.RST}\n")


async def req(session, method: str, path: str, body=None, timeout=15):
    import aiohttp
    url = f"http://127.0.0.1:{PORT}{path}"
    kwargs = {"timeout": aiohttp.ClientTimeout(total=timeout)}
    if body is not None:
        kwargs["json"] = body
    async with getattr(session, method)(url, **kwargs) as r:
        data = await r.json()
        return r.status, data


async def run_tests():
    import aiohttp

    print(f"\n{C.BOLD}{'=' * 56}")
    print(f"  Browser-Use Form Interaction Test")
    print(f"{'=' * 56}{C.RST}\n")

    # ── Setup ──────────────────────────────────────────────────────────
    info(f"Using resume: {DUMMY_RESUME}")

    # Kill anything on the test port
    if os.name == "nt":
        os.system(f'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :{PORT} ^| findstr LISTENING\') do taskkill /PID %a /F >nul 2>&1')

    info(f"Starting browser-use server on port {PORT}...")
    proc = subprocess.Popen(
        [sys.executable, str(SERVER_SCRIPT)],
        env={**os.environ, "BROWSER_USE_PORT": str(PORT)},
        stdout=None,  # Show server output for debugging
        stderr=None,
    )

    # Wait for readiness
    ready = False
    for _ in range(30):
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
        fail("Server did not start within 15 seconds")
        proc.kill()
        sys.exit(1)
    ok("Server started")

    async with aiohttp.ClientSession() as session:
        # Configure headed mode for debugging (change to headless for CI)
        _, cfg = await req(session, "post", "/configure", {"mode": "headed"})
        info(f"Browser mode: {cfg.get('mode', '?')}")

        # ── Serve test HTML via local HTTP server ──────────────────
        html_dir = str(TEST_HTML.parent.resolve())
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=html_dir)
        httpd = http.server.HTTPServer(("127.0.0.1", 18085), handler)
        http_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        http_thread.start()
        info("Local HTTP server on http://127.0.0.1:18085")

        # ── Navigate to test form ──────────────────────────────────
        section("Navigate to test form")
        file_url = f"http://127.0.0.1:18085/{TEST_HTML.name}"
        _, nav = await req(session, "post", "/navigate", {"url": file_url}, timeout=30)
        if nav.get("ok"):
            ok(f"Navigated to {nav.get('title', '?')}")
        else:
            fail(f"Navigate failed: {nav.get('error')}")
            proc.kill()
            sys.exit(1)

        await asyncio.sleep(1)

        # Quick JS test — can we see the form?
        _, dom_test = await req(session, "post", "/execute-script", {
            "script": """
                var inputs = document.querySelectorAll('input, select, textarea, button');
                var form = document.querySelector('form');
                return {
                    inputCount: inputs.length,
                    formFound: !!form,
                    title: document.title,
                    bodyLen: (document.body && document.body.innerHTML) ? document.body.innerHTML.length : 0,
                };
            """
        }, timeout=15)
        dom_result = dom_test.get("result", dom_test.get("error", "?"))
        info(f"DOM check: {json.dumps(dom_result) if isinstance(dom_result, dict) else dom_result}")

        # Status after navigate
        _, status_data = await req(session, "get", "/status")
        info(f"Browser: running={status_data.get('running')}, url={status_data.get('currentUrl', '?')[:60]}")

        # ── Manual JS test of the get_interactive_elements logic ─────
        _, manual_test = await req(session, "post", "/execute-script", {
            "script": """
                var allInputs = document.querySelectorAll('input, select, textarea, button, [role="combobox"], [role="switch"], [role="checkbox"]');
                var results = [];
                for (var i = 0; i < allInputs.length; i++) {
                    var el = allInputs[i];
                    results.push({
                        tag: el.tagName.toLowerCase(),
                        type: el.getAttribute('type') || '',
                        id: el.id || '',
                        name: el.getAttribute('name') || '',
                        role: el.getAttribute('role') || '',
                    });
                }
                return { count: results.length, elements: results.slice(0, 10) };
            """
        }, timeout=15)
        info(f"Manual scan: {json.dumps(manual_test.get('result', manual_test.get('error', '?')))[:300]}")

        # ── Get interactive elements ───────────────────────────────
        section("Discover interactive elements")
        _, elems = await req(session, "post", "/get_interactive_elements", {})
        info(f"Raw get_interactive_elements response: ok={elems.get('ok')}, elementCount={elems.get('elementCount')}, error={elems.get('error', 'none')}")
        if elems.get("ok"):
            elements = elems.get("elements", [])
            forms = elems.get("forms", [])
            ok(f"Found {len(elements)} elements, {len(forms)} form(s)")

            # Check that we detect the different control types
            control_types = {}
            for el in elements:
                ct = el.get("controlType", "none")
                control_types[ct] = control_types.get(ct, 0) + 1

            info(f"Control types: {json.dumps(control_types)}")

            dropdowns = [e for e in elements if e.get("controlType") == "dropdown"]
            toggles = [e for e in elements if e.get("controlType") == "toggle"]
            texts = [e for e in elements if e.get("controlType") == "text"]
            files = [e for e in elements if e.get("controlType") == "file"]

            if len(dropdowns) >= 2:
                ok(f"Detected {len(dropdowns)} dropdowns (native + combobox)")
            else:
                fail(f"Expected >= 2 dropdowns, got {len(dropdowns)}", json.dumps(dropdowns))

            if len(toggles) >= 2:
                ok(f"Detected {len(toggles)} toggles (switches + checkboxes)")
            else:
                fail(f"Expected >= 2 toggles, got {len(toggles)}", json.dumps(toggles))

            if len(files) >= 1:
                ok(f"Detected {len(files)} file input(s)")
            else:
                fail(f"Expected >= 1 file input, got {len(files)}", json.dumps(files))

            # Print all elements for debugging
            for el in elements:
                ct = el.get("controlType", "")
                lbl = el.get("label") or el.get("placeholder") or el.get("text") or el.get("id") or el.get("name") or ""
                extra = ""
                if ct == "dropdown":
                    opts = el.get("options", [])
                    extra = f" opts={len(opts)} selected={el.get('selectedText', '-')}"
                elif ct == "toggle":
                    extra = f" checked={el.get('checked')}"
                elif ct == "text":
                    extra = f" value='{el.get('value', '')}'"
                elif ct == "file":
                    extra = f" accept={el.get('accept', '')}"
                if ct:
                    safe_lbl = lbl[:50].encode("ascii", errors="replace").decode("ascii")
                    info(f"  [{el['index']:2d}] {ct:10s} {el.get('tag'):<10s} {safe_lbl}{extra}")
        else:
            fail(f"get_interactive_elements failed: {elems.get('error')}")

        # ── Test: Fill text fields ─────────────────────────────────
        section("Fill text fields")
        text_fields = [
            ("#first_name", "John"),
            ("#last_name", "Doe"),
            ("#email", "john.doe@example.com"),
            ("#phone", "+1 555-123-4567"),
            ("#linkedin", "https://linkedin.com/in/johndoe"),
        ]
        _, fill_result = await req(session, "post", "/fill_form", {
            "fields": [{"selector": sel, "value": val, "type": "text"} for sel, val in text_fields]
        })
        if fill_result.get("ok") and fill_result.get("filled") == len(text_fields):
            ok(f"Filled {fill_result['filled']}/{fill_result['total']} text fields")
        else:
            fail(f"Fill text fields: filled={fill_result.get('filled')}, errors={fill_result.get('errors')}")

        # ── Test: Native <select> dropdown ─────────────────────────
        section("Native <select> dropdown")
        _, sel_result = await req(session, "post", "/select_option", {
            "selector": "#work-auth",
            "label": "Yes",
        })
        if sel_result.get("ok") and sel_result.get("text"):
            ok(f"Selected '{sel_result['text']}' via {sel_result.get('method')} in work-auth")
        else:
            fail(f"Native select (work-auth): {sel_result.get('error', json.dumps(sel_result))}")

        _, sel_result2 = await req(session, "post", "/select_option", {
            "selector": "#visa",
            "value": "no",
        })
        if sel_result2.get("ok"):
            ok(f"Selected '{sel_result2.get('text', '')}' via {sel_result2.get('method')} in visa")
        else:
            fail(f"Native select (visa): {sel_result2.get('error', json.dumps(sel_result2))}")

        # ── Test: Searchable combobox dropdown ─────────────────────
        section("Searchable combobox (React-Select style)")

        # College — search and select
        college_sel = '[data-combobox="college"] .combobox-control'
        _, combo1 = await req(session, "post", "/select_option", {
            "selector": f'{college_sel} .combobox-input',
            "search": "MIT",
            "label": "Massachusetts Institute of Technology",
            "timeout": 8000,
        }, timeout=20)
        if combo1.get("ok"):
            ok(f"Combobox (college): selected '{combo1.get('text', '')[:50]}' via {combo1.get('method')}")
        else:
            fail(f"Combobox (college): {combo1.get('error', json.dumps(combo1))}")

        await asyncio.sleep(0.5)

        # Degree — search and select
        degree_sel = '[data-combobox="degree"] .combobox-control'
        _, combo2 = await req(session, "post", "/select_option", {
            "selector": f'{degree_sel} .combobox-input',
            "search": "Bachelor",
            "label": "Bachelor of Science",
            "timeout": 8000,
        }, timeout=20)
        if combo2.get("ok"):
            ok(f"Combobox (degree): selected '{combo2.get('text', '')[:50]}' via {combo2.get('method')}")
        else:
            fail(f"Combobox (degree): {combo2.get('error', json.dumps(combo2))}")

        await asyncio.sleep(0.5)

        # Graduation year
        grad_sel = '[data-combobox="grad_year"] .combobox-control'
        _, combo3 = await req(session, "post", "/select_option", {
            "selector": f'{grad_sel} .combobox-input',
            "search": "2026",
            "label": "2026",
            "timeout": 8000,
        }, timeout=20)
        if combo3.get("ok"):
            ok(f"Combobox (grad year): selected '{combo3.get('text', '')}' via {combo3.get('method')}")
        else:
            fail(f"Combobox (grad year): {combo3.get('error', json.dumps(combo3))}")

        await asyncio.sleep(0.5)

        # Internship — simple yes/no combobox
        intern_sel = '[data-combobox="internship"] .combobox-control'
        _, combo4 = await req(session, "post", "/select_option", {
            "selector": f'{intern_sel} .combobox-input',
            "search": "Yes",
            "label": "Yes",
            "timeout": 8000,
        }, timeout=20)
        if combo4.get("ok"):
            ok(f"Combobox (internship): selected '{combo4.get('text', '')}' via {combo4.get('method')}")
        else:
            fail(f"Combobox (internship): {combo4.get('error', json.dumps(combo4))}")

        await asyncio.sleep(0.5)

        # Source — search for "LinkedIn"
        source_sel = '[data-combobox="source"] .combobox-control'
        _, combo5 = await req(session, "post", "/select_option", {
            "selector": f'{source_sel} .combobox-input',
            "search": "LinkedIn",
            "label": "LinkedIn",
            "timeout": 8000,
        }, timeout=20)
        if combo5.get("ok"):
            ok(f"Combobox (source): selected '{combo5.get('text', '')}' via {combo5.get('method')}")
        else:
            fail(f"Combobox (source): {combo5.get('error', json.dumps(combo5))}")

        # ── Test: Toggle switches ──────────────────────────────────
        section("Toggle switches")

        # Check initial state
        _, elems2 = await req(session, "post", "/get_interactive_elements", {})
        elements2 = elems2.get("elements", [])
        relocate_el = next((e for e in elements2 if e.get("id") == "relocate-toggle"), None)
        if relocate_el:
            info(f"Relocate toggle initial state: checked={relocate_el.get('checked')}")

        # Click to toggle ON
        _, toggle1 = await req(session, "post", "/click", {"selector": "#relocate-toggle"})
        if toggle1.get("ok"):
            ok("Clicked relocate toggle")
        else:
            fail(f"Click relocate toggle: {toggle1.get('error')}")

        await asyncio.sleep(0.3)

        # Verify it changed
        _, elems3 = await req(session, "post", "/get_interactive_elements", {})
        elements3 = elems3.get("elements", [])
        relocate_el2 = next((e for e in elements3 if e.get("id") == "relocate-toggle"), None)
        if relocate_el2 and relocate_el2.get("checked"):
            ok(f"Relocate toggle is now checked={relocate_el2['checked']}")
        else:
            fail(f"Relocate toggle state didn't change", json.dumps(relocate_el2))

        # Toggle onsite via fill_form
        _, fill_toggle = await req(session, "post", "/fill_form", {
            "fields": [{"selector": "#onsite-toggle", "value": "true", "type": "toggle"}]
        })
        if fill_toggle.get("ok") and fill_toggle.get("filled", 0) >= 1:
            ok(f"Toggled onsite switch via fill_form")
        else:
            fail(f"fill_form toggle: {fill_toggle.get('errors')}")

        # ── Test: Checkboxes ───────────────────────────────────────
        section("Checkboxes")

        _, cb_result = await req(session, "post", "/fill_form", {
            "fields": [
                {"selector": "input[name='languages'][value='python']", "value": "true", "type": "checkbox"},
                {"selector": "input[name='languages'][value='javascript']", "value": "true", "type": "checkbox"},
                {"selector": "input[name='languages'][value='go']", "value": "true", "type": "checkbox"},
            ]
        })
        if cb_result.get("ok") and cb_result.get("filled", 0) >= 3:
            ok(f"Checked 3 language checkboxes via fill_form")
        else:
            fail(f"Checkboxes: filled={cb_result.get('filled')}, errors={cb_result.get('errors')}")

        # ── Test: File upload ──────────────────────────────────────
        section("File upload")

        # Test 1: Upload via the hidden <input type="file"> directly
        _, upload1 = await req(session, "post", "/upload_file", {
            "selector": "#resume-file",
            "file_path": str(DUMMY_RESUME.resolve()),
            "timeout": 10000,
        }, timeout=20)
        if upload1.get("ok") and upload1.get("uploaded"):
            ok(f"Upload (direct input): {upload1.get('fileName', '')} via {upload1.get('method', '?')}")
        else:
            fail(f"Upload (direct input): {upload1.get('error', json.dumps(upload1))}")

        # Test 2: Upload via the upload zone (triggers filechooser)
        _, upload2 = await req(session, "post", "/upload_file", {
            "selector": "#cover-upload-zone",
            "file_path": str(DUMMY_RESUME.resolve()),
            "timeout": 10000,
        }, timeout=20)
        if upload2.get("ok") and upload2.get("uploaded"):
            ok(f"Upload (zone click): {upload2.get('fileName', '')} via {upload2.get('method', '?')}")
        else:
            fail(f"Upload (zone click): {upload2.get('error', json.dumps(upload2))}")

        # ── Test: Textarea ─────────────────────────────────────────
        section("Textarea")
        _, ta_result = await req(session, "post", "/fill_form", {
            "fields": {"#additional": "I am very excited about this opportunity and looking forward to contributing."}
        })
        if ta_result.get("ok"):
            ok("Filled textarea")
        else:
            fail(f"Textarea: {ta_result.get('errors')}")

        # ── Test: Submit the form ──────────────────────────────────
        section("Form submission")
        _, submit_result = await req(session, "post", "/click", {
            "selector": ".btn-submit",
        })
        if submit_result.get("ok"):
            ok("Clicked submit button")
        else:
            fail(f"Submit click: {submit_result.get('error')}")

        await asyncio.sleep(1)

        # Check if status panel appeared with the submitted data
        _, content = await req(session, "post", "/content", {"mode": "text", "max_length": 5000})
        page_text = content.get("content", "")
        if "Form submitted successfully" in page_text:
            ok("Form submission confirmed — status panel visible")
            # Check key values are in the submitted data
            checks = [
                ("john.doe@example.com", "email"),
                ("John", "first_name"),
                ("Doe", "last_name"),
            ]
            for val, field in checks:
                if val in page_text:
                    ok(f"  Submitted data contains {field}={val}")
                else:
                    fail(f"  Missing {field}={val} in submitted data")
        else:
            fail("Form submission not confirmed — status panel not found")

        # ── Take a screenshot for manual review ────────────────────
        section("Screenshot")
        _, ss = await req(session, "post", "/screenshot", {"full_page": True}, timeout=10)
        if ss.get("ok"):
            path = ss.get("image_path") or ss.get("screenshot_path", "")
            ok(f"Screenshot saved: {path}")
        else:
            fail(f"Screenshot: {ss.get('error')}")

    # ── Cleanup ────────────────────────────────────────────────────
    info("Closing browser...")
    async with aiohttp.ClientSession() as s:
        try:
            await req(s, "post", "/close", {})
        except Exception:
            pass

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()

    # ── Summary ────────────────────────────────────────────────────
    print(f"\n{C.BOLD}{'=' * 56}")
    total = passed + failed
    if failed == 0:
        print(f"  {C.G}ALL {passed} TESTS PASSED{C.RST}")
    else:
        print(f"  {C.G}{passed} passed{C.RST}, {C.R}{failed} failed{C.RST} out of {total}")
        for e in errors:
            print(f"    {C.R}x{C.RST} {e}")
    print(f"{'=' * 56}{C.RST}\n")

    return failed == 0


if __name__ == "__main__":
    success = asyncio.run(run_tests())
    sys.exit(0 if success else 1)
