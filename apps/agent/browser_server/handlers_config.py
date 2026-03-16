"""Config / status HTTP handlers extracted from browser_use_server.py."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from aiohttp import web

from browser_server import state
from browser_server.utils import _safe_json, _ok, _err, _clamp_int, _normalize_profile_name
from browser_server.profile import _current_profile_dir, _read_sync_meta, _resolve_real_browser_profile, _detect_chrome_debug_port
from browser_server.lifecycle import _page_is_alive, _get_page_url, _get_page_title, _close_browser


# ---------------------------------------------------------------------------
# GET /status
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
    sync_meta = _read_sync_meta(_current_profile_dir())
    if browser_running and state._page is not None:
        current_url = await _get_page_url()
        title = await _get_page_title(timeout=0.75)

    resolved = _resolve_real_browser_profile(sync_meta)
    chrome_debug_port = None
    chrome_is_running = False
    debug_port_configured = False
    if resolved:
        chrome_is_running = resolved.get("wasActive", False)
        chrome_debug_port = _detect_chrome_debug_port(resolved["userDataDir"])
        marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
        debug_port_configured = marker.exists() or chrome_debug_port is not None

    return _ok({
        "installed": has_browser_use,
        "running": browser_running,
        "mode": state._config["mode"],
        "profile": state._config["profile"],
        "profileDir": str(_current_profile_dir()),
        "currentUrl": current_url,
        "title": title,
        "chromeSync": {
            "enabled": True,
            "managedProfileRoot": str(_current_profile_dir()),
            "sourceProfilePath": sync_meta.get("sourceProfilePath"),
            "sourceUserDataDir": sync_meta.get("sourceUserDataDir"),
            "sourceProfileName": sync_meta.get("sourceSignature", {}).get("profileName") if isinstance(sync_meta.get("sourceSignature"), dict) else None,
            "lastSyncedAt": sync_meta.get("syncedAt"),
            "mode": sync_meta.get("mode"),
        },
        "debugPort": {
            "active": chrome_debug_port is not None,
            "port": chrome_debug_port,
            "configured": debug_port_configured,
            "chromeRunning": chrome_is_running,
        },
    })


# ---------------------------------------------------------------------------
# POST /setup-debug-port
# ---------------------------------------------------------------------------

async def handle_setup_debug_port(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    port = _clamp_int(body.get("port", 9222), 9222, 1024, 65535)
    undo = bool(body.get("undo", False))

    if undo:
        try:
            from app.browser_cookies import enable_chrome_debug_port
        except ImportError:
            from browser_cookies import enable_chrome_debug_port  # type: ignore[no-redef]

        resolved = _resolve_real_browser_profile(_read_sync_meta(_current_profile_dir()))
        if resolved:
            marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
            if marker.exists():
                marker.unlink()
        return _ok({"undone": True, "message": "Debug port marker removed. Manually remove --remote-debugging-port from your Chrome shortcut to fully disable."})

    try:
        from app.browser_cookies import enable_chrome_debug_port
    except ImportError:
        from browser_cookies import enable_chrome_debug_port  # type: ignore[no-redef]

    result = enable_chrome_debug_port(port)

    if result.get("success"):
        resolved = _resolve_real_browser_profile(_read_sync_meta(_current_profile_dir()))
        if resolved:
            try:
                marker = Path(resolved["userDataDir"]) / ".stuard_debug_port_configured"
                marker.write_text(str(port))
            except Exception:
                pass

    return _ok(result)


# ---------------------------------------------------------------------------
# POST /configure
# ---------------------------------------------------------------------------

async def handle_configure(req: web.Request) -> web.Response:
    body = await _safe_json(req)
    mode = body.get("mode")
    if mode and mode in ("headed", "headless", "connect"):
        state._config["mode"] = mode
    if "cdp_url" in body:
        state._config["cdp_url"] = body["cdp_url"]
    if "profile" in body:
        state._config["profile"] = _normalize_profile_name(body["profile"])

    was_running = await _page_is_alive()
    if was_running:
        await _close_browser()

    return _ok({"mode": state._config["mode"], "profile": state._config["profile"], "restarted": was_running})


# ---------------------------------------------------------------------------
# LLM resolution helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# POST /task (disabled)
# ---------------------------------------------------------------------------

async def handle_task(req: web.Request) -> web.Response:
    return _err(
        "browser_use_task is disabled. Use browser_use_execute_script for complex page logic or launch a browser-use subagent for autonomous multi-step browsing.",
        status=410,
    )
