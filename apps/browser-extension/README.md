# Stuard Browser Connector

A Manifest V3 extension that bridges your **real, logged-in browser** to the Stuard
desktop app. Unlike the `browser_use_*` tools (which drive a separate, sandboxed
Chrome), this extension lets your agent read, script, and organize the tabs you
actually have open — the page you're looking at, your sessions, your windows.

## What the agent can do through it

| Tool | Does |
| --- | --- |
| `browser_ext_status` | Is a browser connected? capabilities + active tab |
| `browser_ext_get_page` | URL, title, selection, meta, readable text of a tab |
| `browser_ext_extract` | Structured DOM scraping by selector (CSP-proof) — e.g. Reddit comments |
| `browser_ext_run_script` | Run agent-authored JS in a tab and return JSON |
| `browser_ext_tabs` | list / activate / close / create / reload / move / group tabs |
| `browser_ext_capture_screenshot` | JPEG/PNG of the visible tab |
| `browser_ext_service_*` | Save/list/run/delete reusable "mini scripts" (managed on desktop) |

Saved services + scheduled workflows (e.g. *"at 9pm keep only my study tabs"*)
run these tools on a timer.

## Build

```bash
pnpm install                 # from repo root, once
pnpm --filter @stuardai/browser-extension build
```

Output lands in `apps/browser-extension/dist/`. Use `pnpm --filter @stuardai/browser-extension dev`
to rebuild on change.

## Load it (Chrome / Edge / Brave)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `apps/browser-extension/dist`.
3. Open the Stuard desktop app → **Settings → Browser Extension**, copy the
   **pairing key**, paste it into the extension popup, click **Pair**.
4. (Optional, for `run_script` on strict-CSP sites like Reddit) on the extension's
   details page enable **Allow user scripts**.

The badge turns green when paired. It reconnects automatically — no need to click
the popup to "wake" it (the bug in the old extension).

## Why it's reliable now

- **No service-worker death.** A `chrome.alarms` tick (30s) wakes the worker and
  re-opens the WebSocket; inbound traffic on an open socket also resets the idle
  timer. The old extension's `setInterval` keepalive died with the worker.
- **No "refresh the page (F5)".** Commands inject on demand via
  `chrome.scripting` / `chrome.userScripts`; there are no declared content scripts
  that might be missing on already-open tabs.
- **Works under strict CSP.** Structured extraction uses compiled functions (no
  eval). `run_script` prefers `chrome.userScripts` (exempt from page CSP) and only
  falls back to MAIN-world eval when user scripts aren't enabled.
