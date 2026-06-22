// =============================================================================
// CUSTOM SYSTEM TRAY MENU
// =============================================================================
// Frameless popup near the tray icon — Stuard-branded UI instead of the native
// OS context menu. Self-contained HTML (no separate Vite entry).

import { app, BrowserWindow, clipboard, ipcMain, nativeImage, screen, shell, Tray } from "electron";
import path from "path";
import fs from "fs";
import logger from "../utils/logger";
import { getGlobalHotkey } from "../settings";
import { showUpdateCheckFeedback, updates_check } from "../services/updates";
import { isDev } from "../env";

export type TrayThemeMode = "light" | "dark";

export interface TrayMenuDeps {
  getOverlayVisible: () => boolean;
  toggleWindow: () => void;
  openDashboard: (options?: { tab?: string }) => void;
  openWorkflows: () => void;
  applyTheme: (mode: TrayThemeMode) => void;
  getThemeMode: () => TrayThemeMode;
}

let deps: TrayMenuDeps | null = null;
let trayMenuWin: BrowserWindow | null = null;
let ipcRegistered = false;

const MENU_WIDTH = 272;
/** Fallback until the loaded page reports its true height. */
const MENU_MIN_HEIGHT = 360;
const MENU_MAX_HEIGHT = 560;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Electron accelerator → human-readable shortcut (e.g. Ctrl + Shift + Space). */
function formatAcceleratorDisplay(accel: string): string {
  const parts = accel.split("+").map((p) => p.trim()).filter(Boolean);
  return parts
    .map((part) => {
      if (part === "Control" || part === "Ctrl") return "Ctrl";
      if (part === "Command" || part === "Cmd" || part === "CommandOrControl") {
        return process.platform === "darwin" ? "⌘" : "Ctrl";
      }
      if (part === "Alt") return "Alt";
      if (part === "Shift") return "Shift";
      if (part === "Space") return "Space";
      if (part === "Return" || part === "Enter") return "Enter";
      if (part === "Escape") return "Esc";
      if (part.length === 1) return part.toUpperCase();
      return part;
    })
    .join(" + ");
}

function getFeedbackUrl(): string {
  return isDev
    ? "http://localhost:3000/dashboard/support/new"
    : "https://stuard.ai/dashboard/support/new";
}

function getTrayMenuLogoDataUrl(): string | null {
  const appPath = (() => { try { return app?.getAppPath?.() || ""; } catch { return ""; } })();
  const candidates = [
    path.join(process.resourcesPath || "", "icon2.png"),
    path.join(__dirname, "..", "..", "icons", "icon2.png"),
    appPath ? path.join(appPath, "icons", "icon2.png") : "",
    path.join(__dirname, "..", "..", "build", "icon2.png"),
  ].filter(Boolean);

  for (const iconPath of candidates) {
    try {
      if (!iconPath || !fs.existsSync(iconPath)) continue;
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img.toDataURL();
    } catch { }
  }
  return null;
}

function buildMenuHTML(state: {
  overlayVisible: boolean;
  themeMode: TrayThemeMode;
  summonShortcut: string;
  version: string;
  logoDataUrl: string | null;
}): string {
  const toggleLabel = state.overlayVisible ? "Hide Stuard" : "Show Stuard";
  const shortcutParts = formatAcceleratorDisplay(state.summonShortcut).split(" + ");
  const shortcutKbd = shortcutParts
    .map((k) => `<kbd>${esc(k)}</kbd>`)
    .join('<span class="plus">+</span>');

  const themeChip = (mode: TrayThemeMode, label: string) => {
    const checked = state.themeMode === mode ? " checked" : "";
    return `<button type="button" class="theme-chip${checked}" data-theme="${mode}">${label}</button>`;
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    background: transparent;
    overflow: hidden;
    font-family: 'Figtree', 'Segoe UI', system-ui, sans-serif;
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }
  body { padding: 6px; }
  .panel {
    background: #161618;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 14px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.22);
    color: #f4f4f5;
    overflow: hidden;
    animation: popIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes popIn {
    from { opacity: 0; transform: translateY(6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .logo {
    width: 28px; height: 28px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }
  .logo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .brand { flex: 1; min-width: 0; }
  .brand-name {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #fff;
    line-height: 1.2;
  }
  .brand-ver {
    font-size: 10px;
    font-weight: 500;
    color: rgba(255,255,255,0.38);
    margin-top: 1px;
  }
  .menu { padding: 6px; }
  .item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: rgba(255,255,255,0.92);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .item:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .item:active { background: rgba(255,255,255,0.12); }
  .item.primary {
    font-weight: 600;
    color: #fff;
  }
  .item.danger:hover { background: rgba(255, 56, 60, 0.12); color: #ff6b6e; }
  .item .icon {
    width: 18px; height: 18px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    opacity: 0.55;
  }
  .item:hover .icon { opacity: 0.85; }
  .item .icon svg {
    width: 15px; height: 15px;
    stroke: currentColor; fill: none;
    stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round;
  }
  .item .label { flex: 1; }
  .sep {
    height: 1px;
    margin: 4px 8px;
    background: rgba(255,255,255,0.06);
  }
  .section-label {
    padding: 6px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.28);
  }
  .shortcut-block {
    margin: 2px 6px 6px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .shortcut-block:hover {
    background: rgba(255,255,255,0.07);
    border-color: rgba(255,255,255,0.1);
  }
  .shortcut-block.copied {
    border-color: rgba(255, 56, 60, 0.45);
    background: rgba(255, 56, 60, 0.08);
  }
  .shortcut-title {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.45);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .shortcut-hint {
    font-size: 9px;
    font-weight: 500;
    color: rgba(255,255,255,0.25);
  }
  .shortcut-hint.flash { color: #ff6b6e; }
  .shortcut-keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .shortcut-keys .plus {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.25);
    margin: 0 1px;
  }
  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    padding: 5px 8px;
    border-radius: 7px;
    background: rgba(255,255,255,0.09);
    border: 1px solid rgba(255,255,255,0.08);
    font-family: 'Figtree', system-ui, sans-serif;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255,255,255,0.95);
    box-shadow: 0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .theme-row {
    display: flex;
    gap: 4px;
    padding: 2px 6px 6px;
  }
  .theme-chip {
    flex: 1;
    padding: 7px 0;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    color: rgba(255,255,255,0.55);
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
  }
  .theme-chip:hover {
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.85);
  }
  .theme-chip.checked {
    background: rgba(255, 56, 60, 0.15);
    border-color: rgba(255, 56, 60, 0.35);
    color: #ff6b6e;
  }
</style>
</head>
<body>
  <div class="panel">
    <div class="header">
      <div class="logo">
        ${state.logoDataUrl
    ? `<img src="${state.logoDataUrl}" alt="" />`
    : `<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#ff383c"><path d="M12 2L4 6v6c0 5.25 3.4 10.15 8 11.35C16.6 22.15 20 17.25 20 12V6l-8-4z"/></svg>`}
      </div>
      <div class="brand">
        <div class="brand-name">Stuard</div>
        <div class="brand-ver">v${esc(state.version)}</div>
      </div>
    </div>

    <div class="menu">
      <button type="button" class="item primary" data-action="toggle">
        <span class="icon"><svg viewBox="0 0 24 24"><path d="M4 12h16M12 4v16"/></svg></span>
        <span class="label">${esc(toggleLabel)}</span>
      </button>
    </div>

    <div class="sep"></div>

    <div class="shortcut-block" id="shortcut-block" title="Click to copy">
      <div class="shortcut-title">
        <span>Summon shortcut</span>
        <span class="shortcut-hint" id="shortcut-hint">Tap to copy</span>
      </div>
      <div class="shortcut-keys">${shortcutKbd}</div>
    </div>

    <div class="sep"></div>

    <div class="menu">
      <button type="button" class="item" data-action="dashboard">
        <span class="icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>
        <span class="label">Dashboard</span>
      </button>
      <button type="button" class="item" data-action="workflows">
        <span class="icon"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h14"/></svg></span>
        <span class="label">Workflows</span>
      </button>
      <button type="button" class="item" data-action="settings">
        <span class="icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></span>
        <span class="label">Settings</span>
      </button>
    </div>

    <div class="sep"></div>
    <div class="section-label">Theme</div>
    <div class="theme-row">
      ${themeChip("light", "Light")}
      ${themeChip("dark", "Dark")}
    </div>

    <div class="sep"></div>

    <div class="menu">
      <button type="button" class="item" data-action="feedback">
        <span class="icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></span>
        <span class="label">Send feedback</span>
      </button>
      <button type="button" class="item" data-action="updates">
        <span class="icon"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg></span>
        <span class="label">Check for updates</span>
      </button>
      <button type="button" class="item danger" data-action="quit">
        <span class="icon"><svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg></span>
        <span class="label">Quit Stuard</span>
      </button>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const shortcutText = ${JSON.stringify(formatAcceleratorDisplay(state.summonShortcut))};

    document.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', () => {
        ipcRenderer.send('tray-menu:action', el.getAttribute('data-action'));
      });
    });

    document.querySelectorAll('.theme-chip').forEach((el) => {
      el.addEventListener('click', () => {
        ipcRenderer.send('tray-menu:theme', el.getAttribute('data-theme'));
      });
    });

    const block = document.getElementById('shortcut-block');
    const hint = document.getElementById('shortcut-hint');
    block?.addEventListener('click', (e) => {
      e.stopPropagation();
      ipcRenderer.send('tray-menu:copy-shortcut', shortcutText);
      block.classList.add('copied');
      if (hint) {
        hint.textContent = 'Copied!';
        hint.classList.add('flash');
        setTimeout(() => {
          hint.textContent = 'Tap to copy';
          hint.classList.remove('flash');
          block.classList.remove('copied');
        }, 1400);
      }
    });
  </script>
</body>
</html>`;
}

function htmlFilePath(): string {
  return path.join(app.getPath("userData"), "_tray-menu.html");
}

function getTrayAnchor(tray: Tray): { x: number; y: number; width: number; height: number } {
  try {
    const b = tray.getBounds();
    if (b && typeof b.x === "number") {
      return { x: b.x, y: b.y, width: b.width || 0, height: b.height || 0 };
    }
  } catch { }
  return { x: 0, y: 0, width: 0, height: 0 };
}

function getWorkAreaNearTray(tray: Tray) {
  const anchor = getTrayAnchor(tray);
  const point = { x: anchor.x + Math.round(anchor.width / 2), y: anchor.y };
  return screen.getDisplayNearestPoint(point).workArea;
}

function computeMenuPosition(
  tray: Tray,
  height: number,
  workArea = getWorkAreaNearTray(tray),
): { x: number; y: number } {
  const menuW = MENU_WIDTH;
  const menuH = height;
  const anchor = getTrayAnchor(tray);
  const margin = 8;
  const workTop = workArea.y + margin;
  const workBottom = workArea.y + workArea.height - margin;
  const workLeft = workArea.x + margin;
  const workRight = workArea.x + workArea.width - margin;

  let x = anchor.x + anchor.width - menuW;
  const spaceAbove = anchor.y - workTop;
  const spaceBelow = workBottom - (anchor.y + anchor.height);

  // Prefer opening above the tray when the taskbar is along the bottom edge.
  let y: number;
  if (process.platform === "win32") {
    const taskbarNearBottom = workBottom - anchor.y < 120;
    if (taskbarNearBottom && spaceAbove >= menuH) {
      y = anchor.y - menuH - margin;
    } else if (!taskbarNearBottom && spaceBelow >= menuH) {
      y = anchor.y + anchor.height + margin;
    } else if (spaceAbove >= spaceBelow) {
      y = anchor.y - menuH - margin;
    } else {
      y = anchor.y + anchor.height + margin;
    }
  } else {
    y = spaceAbove >= menuH || spaceAbove >= spaceBelow
      ? anchor.y - menuH - margin
      : anchor.y + anchor.height + margin;
  }

  // Keep the full menu inside the usable work area.
  if (y + menuH > workBottom) {
    y = workBottom - menuH;
  }
  if (y < workTop) {
    y = workTop;
  }

  x = Math.max(workLeft, Math.min(x, workRight - menuW));

  return { x: Math.round(x), y: Math.round(y) };
}

async function measureTrayMenuHeight(win: BrowserWindow, workAreaHeight: number): Promise<number> {
  try {
    const raw = await win.webContents.executeJavaScript(
      `(() => {
        const el = document.documentElement;
        const body = document.body;
        return Math.max(
          el?.scrollHeight || 0,
          el?.offsetHeight || 0,
          body?.scrollHeight || 0,
          body?.offsetHeight || 0,
        );
      })()`,
      true,
    );
    const measured = Math.ceil(Number(raw) || 0);
    const maxH = Math.max(MENU_MIN_HEIGHT, workAreaHeight - 16);
    return Math.min(Math.max(measured, MENU_MIN_HEIGHT), Math.min(MENU_MAX_HEIGHT, maxH));
  } catch {
    return Math.min(MENU_MAX_HEIGHT, Math.max(MENU_MIN_HEIGHT, workAreaHeight - 16));
  }
}

export function closeTrayMenu(): void {
  if (trayMenuWin && !trayMenuWin.isDestroyed()) {
    try { trayMenuWin.close(); } catch { }
  }
  trayMenuWin = null;
}

function ensureIPC(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.on("tray-menu:action", (_evt, action: string) => {
    if (!deps) return;
    closeTrayMenu();
    switch (action) {
      case "toggle":
        deps.toggleWindow();
        break;
      case "dashboard":
        deps.openDashboard();
        break;
      case "workflows":
        deps.openWorkflows();
        break;
      case "settings":
        deps.openDashboard({ tab: "settings" });
        break;
      case "feedback":
        shell.openExternal(getFeedbackUrl()).catch((e) =>
          logger.warn("Failed to open feedback URL", e),
        );
        break;
      case "updates":
        void (async () => {
          try {
            await updates_check();
            await showUpdateCheckFeedback({
              openSettings: () => deps?.openDashboard({ tab: "settings" }),
            });
          } catch (e) {
            logger.warn("Tray update check failed", e);
            await showUpdateCheckFeedback();
          }
        })();
        break;
      case "quit":
        app.quit();
        break;
      default:
        break;
    }
  });

  ipcMain.on("tray-menu:theme", (_evt, mode: string) => {
    if (!deps) return;
    const m = String(mode || "").toLowerCase();
    if (m === "light" || m === "dark") {
      deps.applyTheme(m as TrayThemeMode);
    }
  });

  ipcMain.on("tray-menu:copy-shortcut", (_evt, text: string) => {
    try {
      clipboard.writeText(String(text || ""));
    } catch (e) {
      logger.warn("Failed to copy summon shortcut", e);
    }
  });
}

export function initTrayMenu(menuDeps: TrayMenuDeps): void {
  deps = menuDeps;
  ensureIPC();
}

export function showTrayMenu(tray: Tray): void {
  if (!deps) {
    logger.warn("Tray menu shown before initTrayMenu");
    return;
  }
  ensureIPC();

  if (trayMenuWin && !trayMenuWin.isDestroyed()) {
    closeTrayMenu();
  }

  const state = {
    overlayVisible: deps.getOverlayVisible(),
    themeMode: deps.getThemeMode(),
    summonShortcut: getGlobalHotkey(),
    version: app.getVersion(),
    logoDataUrl: getTrayMenuLogoDataUrl(),
  };

  const html = buildMenuHTML(state);
  const filePath = htmlFilePath();
  try {
    fs.writeFileSync(filePath, html, "utf-8");
  } catch (e) {
    logger.warn("Failed to write tray menu HTML:", e);
    return;
  }

  const workArea = getWorkAreaNearTray(tray);
  const initialHeight = Math.min(MENU_MAX_HEIGHT, Math.max(MENU_MIN_HEIGHT, workArea.height - 16));
  const { x, y } = computeMenuPosition(tray, initialHeight, workArea);

  trayMenuWin = new BrowserWindow({
    width: MENU_WIDTH,
    height: initialHeight,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    type: process.platform === "win32" ? "toolbar" : undefined,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
    backgroundColor: "#00000000",
  });

  trayMenuWin.setMenu(null);
  trayMenuWin.loadFile(filePath);

  trayMenuWin.once("ready-to-show", async () => {
    const win = trayMenuWin;
    if (!win || win.isDestroyed()) return;
    try {
      const height = await measureTrayMenuHeight(win, workArea.height);
      const { x, y } = computeMenuPosition(tray, height, workArea);
      win.setBounds({ x, y, width: MENU_WIDTH, height });
    } catch (e) {
      logger.warn("Tray menu resize failed", e);
    }
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });

  trayMenuWin.on("blur", () => closeTrayMenu());
  trayMenuWin.on("closed", () => {
    trayMenuWin = null;
  });
}
