"""Chrome cookie sync — read cookies from real Chrome and inject into session.

Pure functions only (no handler). The sync-chrome handler lives in handlers_tabs.py
to avoid circular imports with lifecycle.py.
"""

from pathlib import Path
from typing import Any

from browser_server import state


def _find_chrome_user_data_dirs() -> list[dict[str, Any]]:
    return state.discover_browsers()


def _read_chrome_cookies(profile_path: str, user_data_dir: str) -> list[dict[str, Any]]:
    return state.read_cookies_as_dicts(
        profile_path=profile_path,
        user_data_dir=user_data_dir,
        is_firefox=False,
    )


def _resolve_sync_source(
    profile_path: str | None,
    user_data_dir: str | None,
    browser_name: str | None = None,
    profile_name: str | None = None,
) -> dict[str, Any] | None:
    browsers = _find_chrome_user_data_dirs()

    if profile_path:
        profile_candidate = Path(profile_path)
        if not profile_candidate.exists():
            return None
        if not user_data_dir:
            user_data_dir = str(profile_candidate.parent)
        browser_label = None
        resolved_profile_name = profile_candidate.name
        for browser in browsers:
            for profile in browser.get("profiles", []):
                if Path(profile.get("path", "")) == profile_candidate:
                    browser_label = browser.get("browser")
                    resolved_profile_name = profile.get("name") or resolved_profile_name
                    user_data_dir = browser.get("userDataDir") or user_data_dir
                    break
            if browser_label:
                break
        return {
            "browser": browser_label or browser_name or "Chrome",
            "userDataDir": str(user_data_dir),
            "profilePath": str(profile_candidate),
            "profileName": resolved_profile_name,
        }

    preferred_browser = str(browser_name or "Chrome").strip().lower()
    preferred_profile = str(profile_name or "Default").strip().lower()

    exact_browser = None
    fallback_browser = None
    for browser in browsers:
        browser_label = str(browser.get("browser") or "")
        browser_matches = browser_label.lower() == preferred_browser if preferred_browser else True
        if browser_matches and exact_browser is None:
            exact_browser = browser
        if browser_label.lower() == "chrome" and fallback_browser is None:
            fallback_browser = browser

    selected_browser = exact_browser or fallback_browser or (browsers[0] if browsers else None)
    if not selected_browser:
        return None

    profiles = selected_browser.get("profiles") or []
    selected_profile = None
    for profile in profiles:
        if str(profile.get("name") or "").strip().lower() == preferred_profile:
            selected_profile = profile
            break
    if selected_profile is None and profiles:
        selected_profile = profiles[0]
    if not selected_profile:
        return None

    return {
        "browser": selected_browser.get("browser") or "Chrome",
        "userDataDir": selected_browser.get("userDataDir"),
        "profilePath": selected_profile.get("path"),
        "profileName": selected_profile.get("name") or Path(str(selected_profile.get("path") or "Default")).name,
    }


def _normalize_cookies_for_playwright(cookies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for cookie in cookies:
        c = dict(cookie)

        domain = str(c.get("domain", "")).strip()
        if not domain:
            continue

        if "path" not in c or not c["path"]:
            c["path"] = "/"

        same_site = str(c.get("sameSite", "None")).strip()
        if same_site not in ("Strict", "Lax", "None"):
            same_site = "None"
        c["sameSite"] = same_site

        if "url" not in c:
            scheme = "https" if c.get("secure") else "http"
            clean_domain = domain.lstrip(".")
            c["url"] = f"{scheme}://{clean_domain}/"

        c = {k: v for k, v in c.items() if v is not None}

        normalized.append(c)
    return normalized


async def _inject_cookies_into_session(cookies: list[dict[str, Any]]) -> dict[str, int]:
    injected = 0
    failed = 0

    normalized = _normalize_cookies_for_playwright(cookies)
    if not normalized:
        return {"injected": 0, "failed": 0}

    if state._browser and hasattr(state._browser, "_cdp_set_cookies"):
        try:
            await state._browser._cdp_set_cookies(normalized)
            injected = len(normalized)
        except Exception as e:
            print(f"[browser-use-server] CDP cookie set failed: {e}", flush=True)
            failed = len(normalized)
        return {"injected": injected, "failed": failed}

    if state._context:
        batch_size = 50
        for i in range(0, len(normalized), batch_size):
            batch = normalized[i:i + batch_size]
            try:
                await state._context.add_cookies(batch)
                injected += len(batch)
            except Exception:
                for cookie in batch:
                    try:
                        await state._context.add_cookies([cookie])
                        injected += 1
                    except Exception:
                        failed += 1
        return {"injected": injected, "failed": failed}

    raise RuntimeError("No browser context available for cookie injection")
