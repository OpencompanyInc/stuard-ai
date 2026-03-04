"""
browser-use bridge server — lightweight HTTP wrapper around the browser-use library.
Managed by the Stuard desktop app as a child process.

Requires: pip install browser-use aiohttp
Runs on port 18082 by default.
"""

import asyncio
import base64
import hmac
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

from aiohttp import web

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

_browser = None          # browser_use.Browser instance
_context = None          # Playwright BrowserContext (persistent)
_page = None             # Active Playwright Page
_config: dict[str, Any] = {
    "mode": "headed",    # headed | headless | connect
    "cdp_url": None,     # only used when mode == "connect"
    "profile": "default",
    "profile_dir": None, # resolved at startup
}
_lock = asyncio.Lock()

PORT = int(os.environ.get("BROWSER_USE_PORT", "18082"))
HOST = os.environ.get("BROWSER_USE_HOST", "127.0.0.1")
AUTH_HEADER = "x-stuard-browser-token"
AUTH_TOKEN = os.environ.get("BROWSER_USE_AUTH_TOKEN", "").strip()
PROFILE_ROOT = Path(os.environ.get("BROWSER_USE_PROFILE_DIR", str(Path.home() / ".stuard" / "browser-profiles")))


def _profile_root() -> Path:
    return PROFILE_ROOT


def _current_profile_dir() -> Path:
    return _profile_root() / _config["profile"]


def _normalize_profile_name(value: Any) -> str:
    raw = str(value or "default").strip()
    if not raw:
        return "default"
    # Prevent path traversal or accidental nested paths.
    safe = "".join(ch for ch in raw if ch.isalnum() or ch in ("-", "_", "."))
    return safe[:64] or "default"


def _clamp_int(value: Any, default: int, min_value: int, max_value: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = default
    if n < min_value:
        return min_value
    if n > max_value:
        return max_value
    return n


def _normalize_wait_until(value: Any) -> str:
    v = str(value or "domcontentloaded").strip().lower()
    if v in ("load", "domcontentloaded", "networkidle", "commit"):
        return v
    return "domcontentloaded"


async def _safe_json(req: web.Request) -> dict[str, Any]:
    try:
        body = await req.json()
        if isinstance(body, dict):
            return body
        return {}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Browser lifecycle
# ---------------------------------------------------------------------------

def _jsonable_cookie(cookie: Any) -> dict[str, Any]:
    if isinstance(cookie, dict):
        return cookie
    if hasattr(cookie, "model_dump"):
        try:
            return dict(cookie.model_dump())
        except Exception:
            pass
    if hasattr(cookie, "__dict__"):
        try:
            return dict(cookie.__dict__)
        except Exception:
            pass
    return {"value": str(cookie)}


async def _page_is_alive() -> bool:
    if _page is None:
        return False
    try:
        if hasattr(_page, "is_closed"):
            return not _page.is_closed()
        # Newer browser-use page wrapper does not expose is_closed.
        if hasattr(_page, "get_url"):
            await _page.get_url()
            return True
        return True
    except Exception:
        return False


async def _get_page_url() -> str:
    if _page is None:
        return ""
    try:
        if hasattr(_page, "get_url"):
            return await _page.get_url()
        return getattr(_page, "url", "") or ""
    except Exception:
        return ""


async def _get_page_title(timeout: float | None = None) -> str:
    if _page is None:
        return ""
    try:
        if hasattr(_page, "get_title"):
            coro = _page.get_title()
        elif hasattr(_page, "title"):
            coro = _page.title()
        else:
            return ""
        if timeout:
            return await asyncio.wait_for(coro, timeout=timeout)
        return await coro
    except Exception:
        return ""


async def _evaluate(js_arrow_fn: str, *args: Any) -> Any:
    if _page is None:
        return ""
    # New browser-use page wrappers require arrow-function evaluate format.
    if hasattr(_page, "evaluate"):
        return await _page.evaluate(js_arrow_fn, *args)
    # Fallback for Playwright pages.
    if args:
        raise RuntimeError("This page implementation does not support evaluate args")
    return str(await _page.evaluate(js_arrow_fn))


async def _wait_for_ready(wait_until: str = "domcontentloaded", timeout: int = 30000) -> None:
    if _page is None:
        raise RuntimeError("No active page")

    timeout_s = max(0.25, float(timeout) / 1000.0)
    deadline = asyncio.get_event_loop().time() + timeout_s

    async def _wait_for_state(target_states: tuple[str, ...]) -> None:
        while True:
            if asyncio.get_event_loop().time() >= deadline:
                raise TimeoutError(f"Timed out waiting for {wait_until}")
            try:
                state = await _evaluate("() => document.readyState")
            except Exception:
                state = ""
            if state in target_states:
                return
            await asyncio.sleep(0.1)

    if wait_until == "commit":
        return
    if wait_until == "domcontentloaded":
        await _wait_for_state(("interactive", "complete"))
        return
    if wait_until == "load":
        await _wait_for_state(("complete",))
        return
    if wait_until == "networkidle":
        await _wait_for_state(("complete",))
        await asyncio.sleep(0.5)
        return
    await _wait_for_state(("interactive", "complete"))


async def _wait_for_selector(selector: str, timeout: int = 5000) -> bool:
    if not selector:
        return True
    timeout_s = max(0.25, float(timeout) / 1000.0)
    deadline = asyncio.get_event_loop().time() + timeout_s
    while True:
        if asyncio.get_event_loop().time() >= deadline:
            return False
        try:
            found = await _evaluate(
                """(sel) => {
                  const el = document.querySelector(String(sel));
                  if (!el) return false;
                  const style = window.getComputedStyle(el);
                  if (!style) return true;
                  const hidden = style.display === 'none' || style.visibility === 'hidden';
                  const r = el.getBoundingClientRect();
                  return !hidden && (r.width > 0 || r.height > 0);
                }""",
                selector,
            )
            if bool(found):
                return True
        except Exception:
            pass
        await asyncio.sleep(0.12)


def _is_allowed_url(url: str) -> bool:
    u = (url or "").strip().lower()
    if not u:
        return False
    return (
        u.startswith("http://")
        or u.startswith("https://")
        or u.startswith("about:")
    )


async def _goto(url: str, wait_until: str = "domcontentloaded", timeout: int = 30000) -> None:
    if _page is None:
        raise RuntimeError("No active page")
    wait_until = _normalize_wait_until(wait_until)
    timeout = _clamp_int(timeout, 30000, 1000, 180000)
    # New browser-use page wrappers.
    if hasattr(_page, "navigate"):
        await _page.navigate(url)
        await _wait_for_ready(wait_until=wait_until, timeout=timeout)
        return
    if hasattr(_page, "goto"):
        try:
            await _page.goto(url, wait_until=wait_until, timeout=timeout)
        except TypeError:
            await _page.goto(url)
            await _wait_for_ready(wait_until=wait_until, timeout=timeout)
        return
    raise RuntimeError("Page navigation is not supported")


async def _find_elements(selector: str) -> list[Any]:
    if _page is None:
        return []
    if hasattr(_page, "get_elements_by_css_selector"):
        return await _page.get_elements_by_css_selector(selector)
    # Playwright fallback path: return locator as pseudo-element wrapper.
    class _PlaywrightElement:
        def __init__(self, page, css: str):
            self._page = page
            self._css = css

        async def click(self) -> None:
            await self._page.click(self._css)

        async def fill(self, value: str, clear: bool = True) -> None:
            if clear:
                await self._page.fill(self._css, value)
            else:
                await self._page.type(self._css, value)

    return [_PlaywrightElement(_page, selector)]


async def _ensure_browser() -> tuple[bool, Optional[str]]:
    """Lazily start the browser + context + page.

    Returns:
        (ok, error_message)
    """
    global _browser, _context, _page

    if await _page_is_alive():
        return True, None
    _page = None

    try:
        from browser_use import Browser
    except ImportError:
        return False, "browser-use is not installed. Run: pip install browser-use"
    except Exception as e:
        return False, f"browser-use import failed: {e}"

    profile_dir = _current_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)

    headless = _config["mode"] == "headless"
    cdp_url = _config.get("cdp_url") if _config["mode"] == "connect" else None

    try:
        # Compatibility: old browser-use exposed BrowserConfig/new_context,
        # newer versions use Browser(...kwargs) + start()/new_page().
        BrowserConfig = None
        try:
            from browser_use import BrowserConfig as _BrowserConfig  # type: ignore
            BrowserConfig = _BrowserConfig
        except Exception:
            BrowserConfig = None

        if BrowserConfig is not None:
            config_kwargs: dict[str, Any] = {"headless": headless}
            if cdp_url:
                config_kwargs["cdp_url"] = cdp_url
            else:
                config_kwargs["chrome_instance_path"] = None
                config_kwargs["extra_chromium_args"] = [f"--user-data-dir={profile_dir}"]

            _browser = await asyncio.to_thread(lambda: Browser(config=BrowserConfig(**config_kwargs)))
            _context = await _browser.new_context()
            pages = _context.pages if hasattr(_context, "pages") else []
            _page = pages[0] if pages else await _context.new_page()
        else:
            browser_kwargs: dict[str, Any] = {
                "headless": headless,
                "is_local": True,
            }
            if cdp_url:
                browser_kwargs["cdp_url"] = cdp_url
            else:
                browser_kwargs["user_data_dir"] = str(profile_dir)
                browser_kwargs["args"] = [f"--user-data-dir={profile_dir}"]

            _browser = Browser(**browser_kwargs)
            _context = None
            if hasattr(_browser, "start"):
                await _browser.start()
            pages: list[Any] = []
            if hasattr(_browser, "get_pages"):
                try:
                    pages = await _browser.get_pages()
                except Exception:
                    pages = []
            _page = pages[0] if pages else await _browser.new_page()
        return True, None
    except Exception as e:
        # Always reset partially initialized state so future calls can recover.
        try:
            await _close_browser()
        except Exception:
            pass
        print(f"[browser-use-server] init error: {e}", flush=True)
        return False, f"Browser init failed: {e}"


async def _close_browser():
    global _browser, _context, _page
    try:
        if _context:
            await _context.close()
    except Exception:
        pass
    try:
        if _browser:
            if hasattr(_browser, "stop"):
                await _browser.stop()
            elif hasattr(_browser, "close"):
                await _browser.close()
            elif hasattr(_browser, "kill"):
                await _browser.kill()
    except Exception:
        pass
    _browser = _context = _page = None


def _ok(data: dict | None = None) -> web.Response:
    body = {"ok": True, **(data or {})}
    return web.json_response(body)


def _err(msg: str, status: int = 400) -> web.Response:
    return web.json_response({"ok": False, "error": msg}, status=status)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

async def handle_status(_req: web.Request) -> web.Response:
    has_browser_use = True
    try:
        import browser_use  # noqa: F401
    except ImportError:
        has_browser_use = False

    browser_running = await _page_is_alive()
    current_url = ""
    title = ""
    if browser_running and _page is not None:
        current_url = await _get_page_url()
        # Guard against slow/frozen browser targets stalling status checks.
        title = await _get_page_title(timeout=0.75)

    return _ok({
        "installed": has_browser_use,
        "running": browser_running,
        "mode": _config["mode"],
        "profile": _config["profile"],
        "profileDir": str(_current_profile_dir()),
        "currentUrl": current_url,
        "title": title,
    })


async def handle_configure(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    mode = body.get("mode")
    if mode and mode in ("headed", "headless", "connect"):
        _config["mode"] = mode
    if "cdp_url" in body:
        _config["cdp_url"] = body["cdp_url"]
    if "profile" in body:
        _config["profile"] = _normalize_profile_name(body["profile"])

    was_running = await _page_is_alive()
    if was_running:
        await _close_browser()

    return _ok({"mode": _config["mode"], "profile": _config["profile"], "restarted": was_running})


def _resolve_llm(body: dict[str, Any], model_override: str | None = None) -> Any:
    """Build a langchain LLM from request body or environment.

    Priority:
      1. Cloud proxy URL + session token (secure — no API key on user machine)
      2. OPENAI_API_KEY from env (local dev fallback)
      3. GOOGLE_API_KEY from env (local dev fallback; optional adapter)
      4. None (let browser-use fall back to its default, which needs BROWSER_USE_API_KEY)
    """
    proxy_url = body.get("_llm_proxy_url") or ""
    session_token = body.get("_llm_session_token") or ""
    model_name = model_override or body.get("model") or ""

    def _mk_openai_chat(api_key: str, base_url: str | None, model: str):
        # Prefer browser_use bundled ChatOpenAI to avoid extra local dependencies.
        try:
            from browser_use import ChatOpenAI  # type: ignore
            kwargs: dict[str, Any] = {
                "model": model,
                "api_key": api_key,
            }
            if base_url:
                kwargs["base_url"] = base_url
            return ChatOpenAI(**kwargs)
        except Exception:
            pass
        # Fallback for environments that still use langchain_openai.
        try:
            from langchain_openai import ChatOpenAI  # type: ignore
            kwargs2: dict[str, Any] = {
                "model": model,
                "api_key": api_key,
            }
            if base_url:
                kwargs2["base_url"] = base_url
            return ChatOpenAI(**kwargs2)
        except Exception:
            return None

    # Preferred: cloud proxy (OpenAI-compatible endpoint on our cloud server)
    if proxy_url and session_token:
        try:
            base_url = proxy_url.rstrip("/") + "/v1"
            chat = _mk_openai_chat(
                api_key=session_token,
                base_url=base_url,
                model=model_name or "gemini-3-flash-preview",
            )
            if chat is not None:
                return chat
        except Exception as e:
            print(f"[browser-use-server] Cloud proxy LLM init failed: {e}", flush=True)

    # Local dev fallback: OPENAI_API_KEY from env
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    if openai_key:
        try:
            chat = _mk_openai_chat(
                api_key=openai_key,
                base_url=None,
                model=model_name or "gpt-4o-mini",
            )
            if chat is not None:
                return chat
        except Exception as e:
            print(f"[browser-use-server] ChatOpenAI init failed: {e}", flush=True)

    # Local dev fallback: GOOGLE_API_KEY from env
    google_key = os.environ.get("GOOGLE_API_KEY", "")
    if google_key:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model=model_name or "gemini-3-flash-preview",
                google_api_key=google_key,
            )
        except Exception as e:
            print(f"[browser-use-server] ChatGoogleGenerativeAI init failed: {e}", flush=True)

    return None


def _fallback_model_candidates(requested_model: str) -> list[str]:
    m = (requested_model or "").strip().lower()
    out: list[str] = []
    if "gemini" in m or m.startswith("google/"):
        # Prefer flash-tier fallbacks first for better availability/latency.
        out.extend([
            "google/gemini-2.5-flash",
            "openai/gpt-4.1-mini",
            "openai/gpt-4o-mini",
            "google/gemini-3-flash-preview",
        ])
    elif "gpt" in m or m.startswith("openai/") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4"):
        out.extend([
            "openai/gpt-4o-mini",
            "google/gemini-2.5-flash",
            "google/gemini-3-flash-preview",
        ])
    else:
        out.extend([
            "openai/gpt-4.1-mini",
            "openai/gpt-4o-mini",
            "google/gemini-2.5-flash",
            "google/gemini-3-flash-preview",
        ])
    # Deduplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for x in out:
        if x in seen:
            continue
        seen.add(x)
        deduped.append(x)
    return deduped


async def handle_task(req: web.Request) -> web.Response:
    """High-level autonomous browsing via browser-use Agent."""
    body = await _safe_json(req)
    task = str(body.get("task", "")).strip()
    if not task:
        return _err("task is required")

    try:
        from browser_use import Agent
    except ImportError:
        return _err("browser-use is not installed. Run: pip install browser-use")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)

        max_steps = _clamp_int(body.get("max_steps", 25), 25, 1, 120)

        requested_model = str(body.get("model") or "").strip()
        llm = _resolve_llm(body, model_override=requested_model or None)
        if llm is None:
            return _err(
                "No LLM backend available for browser_use_task. "
                "Sign in to Stuard Cloud (to use the built-in proxy) or set OPENAI_API_KEY/GOOGLE_API_KEY.",
                status=400,
            )

        fallback_llm = None
        normalized_requested = requested_model.lower()
        for candidate in _fallback_model_candidates(requested_model or "google/gemini-3-flash-preview"):
            if candidate.lower() == normalized_requested:
                continue
            fallback_llm = _resolve_llm(body, model_override=candidate)
            if fallback_llm is not None:
                break

        agent_kwargs: dict[str, Any] = {
            "task": task,
            "browser": _browser,
            "max_steps": max_steps,
            # Helps weaker/cheaper models produce browser-use action schema reliably.
            "include_tool_call_examples": True,
        }
        if llm:
            agent_kwargs["llm"] = llm
        if fallback_llm:
            agent_kwargs["fallback_llm"] = fallback_llm

        try:
            agent = Agent(**agent_kwargs)
            result = await agent.run()
            return _ok({
                "result": str(result) if result else None,
                "task": task,
            })
        except Exception:
            return _err("Task failed")


async def handle_navigate(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    url = str(body.get("url", "")).strip()
    if not url:
        return _err("url is required")
    if not _is_allowed_url(url):
        return _err("Only http/https/about URLs are allowed")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            wait_until = _normalize_wait_until(body.get("wait_until", "domcontentloaded"))
            timeout = _clamp_int(body.get("timeout", 30000), 30000, 1000, 180000)
            await _goto(url, wait_until=wait_until, timeout=timeout)
            selector = str(body.get("wait_for_selector") or "").strip()
            if selector:
                found = await _wait_for_selector(selector, timeout=_clamp_int(timeout, 5000, 500, 180000))
                if not found:
                    return _err(f"Navigation finished, but selector not found: {selector}")
            return _ok({"url": await _get_page_url(), "title": await _get_page_title()})
        except Exception as e:
            return _err(f"Navigation failed: {e}")


async def handle_click(req: web.Request) -> web.Response:
    body = await req.json()
    selector = body.get("selector")
    text = body.get("text")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if text:
                # Text click compatibility for both Playwright and browser-use page wrappers.
                exact = bool(body.get("exact", False))
                clicked = await _evaluate(
                    """(needle, exact) => {
                      const textOf = (el) => (el && (el.innerText || el.textContent || '') || '').trim();
                      const all = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role=\"button\"],[onclick],*[tabindex]'));
                      const target = all.find((el) => {
                        const t = textOf(el);
                        return exact ? t === needle : t.toLowerCase().includes(String(needle).toLowerCase());
                      });
                      if (!target) return 'not_found';
                      target.scrollIntoView({block:'center', inline:'center'});
                      target.click();
                      return 'clicked';
                    }""",
                    text,
                    exact,
                )
                if clicked != "clicked":
                    return _err("Click failed: no matching element text found")
            elif selector:
                els = await _find_elements(selector)
                if not els:
                    return _err(f"Click failed: selector not found: {selector}")
                await els[0].click()
            else:
                return _err("selector or text is required")
            return _ok({"clicked": selector or text})
        except Exception as e:
            return _err(f"Click failed: {e}")


async def handle_type(req: web.Request) -> web.Response:
    body = await req.json()
    selector = body.get("selector")
    text = body.get("text", "")
    clear = body.get("clear", True)

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                els = await _find_elements(selector)
                if not els:
                    return _err(f"Type failed: selector not found: {selector}")
                await els[0].fill(text, clear=clear)
            else:
                # Type into currently focused element.
                await _evaluate(
                    """(value, clearFirst) => {
                      const el = document.activeElement;
                      if (!el) return 'no_active';
                      const isTextInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
                      if (!isTextInput) return 'not_text_target';
                      if ('value' in el) {
                        if (clearFirst) el.value = '';
                        el.value = (el.value || '') + String(value ?? '');
                      } else if (el.isContentEditable) {
                        if (clearFirst) el.textContent = '';
                        el.textContent = (el.textContent || '') + String(value ?? '');
                      }
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      return 'ok';
                    }""",
                    text,
                    clear,
                )
            return _ok({"typed": len(text)})
        except Exception as e:
            return _err(f"Type failed: {e}")


async def handle_press_key(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    key = str(body.get("key", "")).strip()
    selector = str(body.get("selector", "")).strip()
    if not key:
        return _err("key is required")
    if len(key) > 64:
        return _err("key is too long")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                focused = await _evaluate(
                    """(sel) => {
                      const el = document.querySelector(String(sel));
                      if (!el) return 'not_found';
                      if (typeof el.focus === 'function') el.focus();
                      return 'ok';
                    }""",
                    selector,
                )
                if focused != "ok":
                    return _err(f"Press key failed: selector not found: {selector}")

            # Prefer native keyboard APIs when available.
            keyboard = getattr(_page, "keyboard", None)
            if keyboard is not None and hasattr(keyboard, "press"):
                await keyboard.press(key)
                return _ok({"key": key})
            if hasattr(_page, "send_keys"):
                await _page.send_keys(key)
                return _ok({"key": key})

            # JS fallback for wrappers without keyboard API.
            dispatched = await _evaluate(
                """(k) => {
                  const key = String(k || '');
                  const target = document.activeElement || document.body;
                  if (!target) return 'no_target';
                  const keyCodeMap = {
                    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
                    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
                  };
                  const keyCode = keyCodeMap[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
                  const evtInit = {
                    key,
                    code: key,
                    keyCode,
                    which: keyCode,
                    bubbles: true,
                    cancelable: true,
                  };
                  target.dispatchEvent(new KeyboardEvent('keydown', evtInit));
                  target.dispatchEvent(new KeyboardEvent('keypress', evtInit));
                  target.dispatchEvent(new KeyboardEvent('keyup', evtInit));
                  if (key === 'Enter') {
                    const form = target && target.form;
                    if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
                  }
                  return 'ok';
                }""",
                key,
            )
            if dispatched != "ok":
                return _err("Press key failed")
            return _ok({"key": key})
        except Exception as e:
            return _err(f"Press key failed: {e}")


async def handle_screenshot(req: web.Request) -> web.Response:
    body = await req.json() if req.content_length else {}

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            full_page = body.get("full_page", False)
            b64: str
            if hasattr(_page, "screenshot"):
                raw_or_b64 = await _page.screenshot(full_page=full_page) if "full_page" in str(_page.screenshot) else await _page.screenshot()
                if isinstance(raw_or_b64, (bytes, bytearray)):
                    b64 = base64.b64encode(raw_or_b64).decode("utf-8")
                else:
                    b64 = str(raw_or_b64)
            else:
                return _err("Screenshot not supported")
            return _ok({
                "screenshot": b64,
                "format": "png",
                "url": await _get_page_url(),
                "width": int(await _evaluate("() => String(window.innerWidth || 0)") or "0"),
                "height": int(await _evaluate("() => String(window.innerHeight || 0)") or "0"),
            })
        except Exception as e:
            return _err(f"Screenshot failed: {e}")


async def handle_content(req: web.Request) -> web.Response:
    body = await _safe_json(req) if req.content_length else {}

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            mode = str(body.get("mode", "text")).strip().lower()
            if mode not in ("text", "html"):
                mode = "text"
            max_length = _clamp_int(body.get("max_length", 50000), 50000, 500, 200000)
            selector = str(body.get("wait_for_selector") or "").strip()
            wait_timeout = _clamp_int(body.get("wait_timeout", 5000), 5000, 500, 60000)
            if selector:
                await _wait_for_selector(selector, timeout=wait_timeout)
            url = await _get_page_url()
            title = await _get_page_title()

            if mode == "html":
                if hasattr(_page, "content"):
                    content = await _page.content()
                else:
                    content = await _evaluate("() => document.documentElement.outerHTML")
            else:
                content = await _evaluate(
                    """() => {
                      const root =
                        document.querySelector('article') ||
                        document.querySelector('main') ||
                        document.querySelector('[role="main"]') ||
                        document.body ||
                        document.documentElement;
                      if (!root) return '';
                      const text = (root.innerText || root.textContent || '').replace(/\\u00a0/g, ' ');
                      return text.replace(/\\n{3,}/g, '\\n\\n').trim();
                    }"""
                )

            return _ok({
                "url": url,
                "title": title,
                "content": str(content or "")[:max_length],
                "mode": mode,
            })
        except Exception as e:
            return _err(f"Content extraction failed: {e}")


async def handle_scroll(req: web.Request) -> web.Response:
    body = await req.json()
    direction = body.get("direction", "down")
    amount = body.get("amount", 500)
    selector = body.get("selector")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if selector:
                await _evaluate(
                    """(sel, dir, amt) => {
                      const el = document.querySelector(sel);
                      if (!el) return 'not_found';
                      const delta = dir === 'down' ? amt : -amt;
                      if (dir === 'left' || dir === 'right') {
                        el.scrollBy({ left: dir === 'right' ? amt : -amt, top: 0, behavior: 'auto' });
                      } else {
                        el.scrollBy({ top: delta, left: 0, behavior: 'auto' });
                      }
                      return 'ok';
                    }""",
                    selector,
                    direction,
                    amount,
                )
            else:
                delta = amount if direction == "down" else -amount
                if direction in ("left", "right"):
                    await _evaluate(
                        "(dir, amt) => { window.scrollBy(dir === 'right' ? amt : -amt, 0); return 'ok'; }",
                        direction,
                        amount,
                    )
                else:
                    await _evaluate("(d) => { window.scrollBy(0, d); return 'ok'; }", delta)
            return _ok({"direction": direction, "amount": amount})
        except Exception as e:
            return _err(f"Scroll failed: {e}")


async def handle_tabs(req: web.Request) -> web.Response:
    body = await req.json()
    action = body.get("action", "list")

    global _page
    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if _browser and hasattr(_browser, "get_pages") and hasattr(_browser, "new_page"):
                pages = await _browser.get_pages()
                active_idx = 0
                for i, p in enumerate(pages):
                    if p is _page:
                        active_idx = i
                        break

                if action == "list":
                    tabs: list[dict[str, Any]] = []
                    for i, p in enumerate(pages):
                        url = ""
                        title = ""
                        try:
                            if hasattr(p, "get_url"):
                                url = await p.get_url()
                            else:
                                url = getattr(p, "url", "") or ""
                        except Exception:
                            pass
                        try:
                            if hasattr(p, "get_title"):
                                title = await p.get_title()
                            elif hasattr(p, "title"):
                                title = await p.title()
                        except Exception:
                            pass
                        tabs.append({
                            "index": i,
                            "url": url,
                            "title": title,
                            "active": i == active_idx,
                        })
                    return _ok({"tabs": tabs, "count": len(tabs)})

                elif action == "new":
                    url = body.get("url")
                    _page = await _browser.new_page(url) if url else await _browser.new_page()
                    return _ok({"url": await _get_page_url(), "title": await _get_page_title()})

                elif action == "switch":
                    index = body.get("index", 0)
                    if 0 <= index < len(pages):
                        _page = pages[index]
                        return _ok({"url": await _get_page_url(), "title": await _get_page_title()})
                    return _err(f"Tab index {index} out of range (0-{len(pages) - 1})")

                elif action == "close":
                    index = body.get("index")
                    if index is not None and 0 <= index < len(pages):
                        target = pages[index]
                        if hasattr(_browser, "close_page"):
                            await _browser.close_page(target)
                        pages = await _browser.get_pages()
                        if pages:
                            _page = pages[-1]
                        else:
                            _page = await _browser.new_page()
                        return _ok({"closed": index, "remaining": len(pages)})
                    return _err("index is required for close action")

                return _err(f"Unknown tabs action: {action}")

            if action == "list":
                pages = _context.pages if _context else []
                tabs = []
                for i, p in enumerate(pages):
                    tabs.append({
                        "index": i,
                        "url": p.url,
                        "title": await p.title(),
                        "active": p == _page,
                    })
                return _ok({"tabs": tabs, "count": len(tabs)})

            elif action == "new":
                _page = await _context.new_page()
                url = body.get("url")
                if url:
                    await _page.goto(url, wait_until="domcontentloaded")
                return _ok({"url": _page.url, "title": await _page.title()})

            elif action == "switch":
                index = body.get("index", 0)
                pages = _context.pages if _context else []
                if 0 <= index < len(pages):
                    _page = pages[index]
                    await _page.bring_to_front()
                    return _ok({"url": _page.url, "title": await _page.title()})
                return _err(f"Tab index {index} out of range (0-{len(pages) - 1})")

            elif action == "close":
                index = body.get("index")
                pages = _context.pages if _context else []
                if index is not None and 0 <= index < len(pages):
                    target = pages[index]
                    await target.close()
                    pages = _context.pages
                    _page = pages[-1] if pages else await _context.new_page()
                    return _ok({"closed": index, "remaining": len(_context.pages)})
                return _err("index is required for close action")

            return _err(f"Unknown tabs action: {action}")
        except Exception as e:
            return _err(f"Tabs operation failed: {e}")


async def handle_cookies(req: web.Request) -> web.Response:
    body = await req.json()
    action = body.get("action", "get")

    async with _lock:
        ok, err = await _ensure_browser()
        if not ok:
            return _err(err or "Browser init failed", status=500)
        try:
            if _browser and hasattr(_browser, "cookies"):
                if action == "get":
                    raw_cookies = await _browser.cookies()
                    cookies = [_jsonable_cookie(c) for c in raw_cookies]
                    urls = body.get("urls")
                    if urls:
                        try:
                            from urllib.parse import urlparse
                            hosts = {urlparse(u).hostname or "" for u in urls}
                            cookies = [
                                c for c in cookies
                                if any(
                                    h and (h == str(c.get("domain", "")).lstrip(".") or h.endswith(str(c.get("domain", "")).lstrip(".")))
                                    for h in hosts
                                )
                            ]
                        except Exception:
                            pass
                    return _ok({"cookies": cookies, "count": len(cookies)})

                elif action == "set":
                    cookies = body.get("cookies", [])
                    if not cookies:
                        return _err("cookies array is required for set action")
                    if hasattr(_browser, "_cdp_set_cookies"):
                        await _browser._cdp_set_cookies(cookies)
                    else:
                        return _err("Cookie set not supported by this browser-use version")
                    return _ok({"set": len(cookies)})

                elif action == "clear":
                    if hasattr(_browser, "clear_cookies"):
                        await _browser.clear_cookies()
                    elif hasattr(_browser, "_cdp_clear_cookies"):
                        await _browser._cdp_clear_cookies()
                    return _ok({"cleared": True})

                elif action == "export":
                    raw_cookies = await _browser.cookies()
                    cookies = [_jsonable_cookie(c) for c in raw_cookies]
                    export_path = body.get("path")
                    if export_path:
                        Path(export_path).parent.mkdir(parents=True, exist_ok=True)
                        Path(export_path).write_text(json.dumps(cookies, indent=2))
                        return _ok({"exported": len(cookies), "path": export_path})
                    return _ok({"cookies": cookies, "count": len(cookies)})

                elif action == "import":
                    import_path = body.get("path")
                    if not import_path or not Path(import_path).exists():
                        return _err("Valid path is required for import action")
                    cookies = json.loads(Path(import_path).read_text())
                    if hasattr(_browser, "_cdp_set_cookies"):
                        await _browser._cdp_set_cookies(cookies)
                    else:
                        return _err("Cookie import not supported by this browser-use version")
                    return _ok({"imported": len(cookies)})

                return _err(f"Unknown cookies action: {action}")

            if action == "get":
                urls = body.get("urls")
                cookies = await _context.cookies(urls) if urls else await _context.cookies()
                return _ok({"cookies": cookies, "count": len(cookies)})

            elif action == "set":
                cookies = body.get("cookies", [])
                if not cookies:
                    return _err("cookies array is required for set action")
                await _context.add_cookies(cookies)
                return _ok({"set": len(cookies)})

            elif action == "clear":
                await _context.clear_cookies()
                return _ok({"cleared": True})

            elif action == "export":
                cookies = await _context.cookies()
                export_path = body.get("path")
                if export_path:
                    Path(export_path).parent.mkdir(parents=True, exist_ok=True)
                    Path(export_path).write_text(json.dumps(cookies, indent=2))
                    return _ok({"exported": len(cookies), "path": export_path})
                return _ok({"cookies": cookies, "count": len(cookies)})

            elif action == "import":
                import_path = body.get("path")
                if not import_path or not Path(import_path).exists():
                    return _err("Valid path is required for import action")
                cookies = json.loads(Path(import_path).read_text())
                await _context.add_cookies(cookies)
                return _ok({"imported": len(cookies)})

            return _err(f"Unknown cookies action: {action}")
        except Exception as e:
            return _err(f"Cookies operation failed: {e}")


async def handle_close(_req: web.Request) -> web.Response:
    await _close_browser()
    return _ok({"closed": True})


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

@web.middleware
async def auth_middleware(req: web.Request, handler):
    if not AUTH_TOKEN:
        return await handler(req)
    incoming = str(req.headers.get(AUTH_HEADER, "")).strip()
    if not incoming or not hmac.compare_digest(incoming, AUTH_TOKEN):
        return web.json_response({"ok": False, "error": "unauthorized"}, status=401)
    return await handler(req)

def create_app() -> web.Application:
    app = web.Application(middlewares=[auth_middleware])
    app.router.add_get("/status", handle_status)
    app.router.add_post("/configure", handle_configure)
    app.router.add_post("/task", handle_task)
    app.router.add_post("/navigate", handle_navigate)
    app.router.add_post("/click", handle_click)
    app.router.add_post("/type", handle_type)
    app.router.add_post("/press_key", handle_press_key)
    app.router.add_post("/screenshot", handle_screenshot)
    app.router.add_post("/content", handle_content)
    app.router.add_post("/scroll", handle_scroll)
    app.router.add_post("/tabs", handle_tabs)
    app.router.add_post("/cookies", handle_cookies)
    app.router.add_post("/close", handle_close)
    return app


async def on_shutdown(_app: web.Application):
    await _close_browser()


def main():
    app = create_app()
    app.on_shutdown.append(on_shutdown)
    print(f"[browser-use-server] Starting on {HOST}:{PORT}", flush=True)
    web.run_app(app, host=HOST, port=PORT, print=lambda msg: print(msg, flush=True))


if __name__ == "__main__":
    main()
