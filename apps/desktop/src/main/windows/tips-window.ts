// =============================================================================
// FIRST-TOGGLE TIPS WINDOW
// =============================================================================
// A small, frameless, always-on-top popup that appears in the top-right corner
// of the screen each time the overlay is shown, cycling through essential
// keyboard shortcuts until the user has seen them all.
//
// Entirely self-contained — no React, no separate Vite entry point.
// Writes a temp HTML file to userData and loads it.

import { BrowserWindow, ipcMain, screen, app } from "electron";
import path from "path";
import fs from "fs";
import logger from "../utils/logger";

// ── Tip definitions ──

interface Tip {
  keys: string;
  label: string;
}

const TIPS: Tip[] = [
  { keys: "Esc", label: "Dismiss / hide the overlay" },
  { keys: "Ctrl + Arrow", label: "Move the overlay around" },
  { keys: "Ctrl + Shift + Arrow", label: "Move the overlay faster" },
  { keys: "Enter", label: "Send your message" },
  { keys: "Shift + Enter", label: "New line in message" },
  { keys: "F1", label: "Open command palette" },
];

// ── Persistent state ──

interface TipState {
  nextIndex: number;
  done: boolean;
}

const STATE_FILE = "first-toggle-tips.json";

function statePath(): string {
  return path.join(app.getPath("userData"), STATE_FILE);
}

function loadState(): TipState {
  try {
    const p = statePath();
    if (fs.existsSync(p)) {
      return { nextIndex: 0, done: false, ...JSON.parse(fs.readFileSync(p, "utf-8")) };
    }
  } catch {}
  return { nextIndex: 0, done: false };
}

function saveState(s: TipState): void {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(s), "utf-8");
  } catch {}
}

// ── Window management ──

let tipsWin: BrowserWindow | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let state: TipState = loadState();

const WIN_WIDTH = 320;
const WIN_HEIGHT = 110;
const AUTO_DISMISS_MS = 7000;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHTML(tip: Tip, index: number, total: number): string {
  const nextBtn =
    index < total - 1
      ? `<button class="nav-btn" id="btn-next">Next <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>`
      : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    background: transparent;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    user-select: none;
  }
  body { padding: 8px; }
  .card {
    background: rgba(10, 10, 14, 0.94);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 12px 14px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.3);
    color: #fff;
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(30px) scale(0.96); }
    to   { opacity: 1; transform: translateX(0) scale(1); }
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .icon {
    width: 18px; height: 18px;
    border-radius: 5px;
    background: rgba(59,130,246,0.15);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .icon svg { width: 11px; height: 11px; stroke: #60a5fa; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .label-text { font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.5px; }
  .counter { margin-left: auto; font-size: 9px; color: rgba(255,255,255,0.25); }
  .close-btn {
    background: none; border: none; cursor: pointer;
    padding: 2px; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .close-btn:hover { background: rgba(255,255,255,0.1); }
  .close-btn svg { width: 12px; height: 12px; stroke: rgba(255,255,255,0.3); fill: none; stroke-width: 2; }
  .close-btn:hover svg { stroke: rgba(255,255,255,0.7); }
  .body { display: flex; align-items: center; gap: 10px; }
  kbd {
    display: inline-flex; align-items: center;
    padding: 4px 9px;
    border-radius: 6px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.06);
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px; font-weight: 500;
    color: rgba(255,255,255,0.92);
    white-space: nowrap;
    box-shadow: 0 1px 2px rgba(0,0,0,0.25);
  }
  .desc { font-size: 12px; color: rgba(255,255,255,0.65); line-height: 1.35; }
  .footer { display: flex; align-items: center; justify-content: space-between; }
  .skip-btn {
    background: none; border: none; cursor: pointer;
    font-size: 9px; color: rgba(255,255,255,0.2);
    transition: color 0.15s;
    padding: 2px 0;
  }
  .skip-btn:hover { color: rgba(255,255,255,0.5); }
  .nav { display: flex; align-items: center; gap: 4px; }
  .nav-btn {
    background: none; border: none; cursor: pointer;
    display: flex; align-items: center; gap: 2px;
    font-size: 10px; color: rgba(96,165,250,0.7);
    padding: 2px 6px; border-radius: 4px;
    transition: all 0.15s;
  }
  .nav-btn:hover { color: rgba(96,165,250,1); background: rgba(96,165,250,0.1); }
  .nav-btn svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; }
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="icon">
        <svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/><line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/><line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/><line x1="10" y1="12" x2="14" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/></svg>
      </div>
      <span class="label-text">Quick tip</span>
      <span class="counter">${index + 1}/${total}</span>
      <button class="close-btn" id="btn-close" title="Dismiss">
        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="body">
      <kbd>${esc(tip.keys)}</kbd>
      <span class="desc">${esc(tip.label)}</span>
    </div>
    <div class="footer">
      <button class="skip-btn" id="btn-skip">Don't show again</button>
      <div class="nav">${nextBtn}</div>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    document.getElementById('btn-close')?.addEventListener('click', () => ipcRenderer.send('tips:dismiss'));
    document.getElementById('btn-skip')?.addEventListener('click', () => ipcRenderer.send('tips:skip-all'));
    document.getElementById('btn-next')?.addEventListener('click', () => ipcRenderer.send('tips:next'));
  </script>
</body>
</html>`;
}

function htmlFilePath(): string {
  return path.join(app.getPath("userData"), "_tip-popup.html");
}

function closeTipsWindow(): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (tipsWin && !tipsWin.isDestroyed()) {
    tipsWin.close();
  }
  tipsWin = null;
}

function showTipWindow(tip: Tip, index: number): void {
  closeTipsWindow();

  // Write HTML to a temp file so nodeIntegration works reliably
  const html = buildHTML(tip, index, TIPS.length);
  const filePath = htmlFilePath();
  try {
    fs.writeFileSync(filePath, html, "utf-8");
  } catch (e) {
    logger.warn("Failed to write tip HTML:", e);
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();

  tipsWin = new BrowserWindow({
    width: WIN_WIDTH,
    height: WIN_HEIGHT,
    x: workArea.x + workArea.width - WIN_WIDTH - 16,
    y: workArea.y + 16,
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
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
    backgroundColor: "#00000000",
  });

  tipsWin.setMenu(null);
  tipsWin.loadFile(filePath);

  tipsWin.once("ready-to-show", () => {
    if (tipsWin && !tipsWin.isDestroyed()) {
      tipsWin.showInactive();
    }
  });

  tipsWin.on("closed", () => {
    tipsWin = null;
  });

  // Auto-dismiss
  dismissTimer = setTimeout(() => closeTipsWindow(), AUTO_DISMISS_MS);
}

// ── IPC handlers (registered once) ──

let ipcRegistered = false;

function ensureIPC(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.on("tips:dismiss", () => {
    closeTipsWindow();
  });

  ipcMain.on("tips:skip-all", () => {
    state.done = true;
    saveState(state);
    closeTipsWindow();
  });

  ipcMain.on("tips:next", () => {
    if (state.nextIndex < TIPS.length) {
      const tip = TIPS[state.nextIndex];
      state.nextIndex++;
      if (state.nextIndex >= TIPS.length) state.done = true;
      saveState(state);
      showTipWindow(tip, state.nextIndex - 1);
    } else {
      state.done = true;
      saveState(state);
      closeTipsWindow();
    }
  });
}

// ── Public API ──

/**
 * Call this from `showWindow()` to show the next keyboard tip.
 * Only shows if onboarding is complete and tips haven't all been seen.
 */
export function maybeShowFirstToggleTip(): void {
  ensureIPC();

  // Reload state in case it was modified
  state = loadState();

  if (state.done) return;
  if (state.nextIndex >= TIPS.length) {
    state.done = true;
    saveState(state);
    return;
  }

  // Check if onboarding is complete
  try {
    const { loadSettings } = require("../settings");
    const settings = loadSettings();
    if (!settings.onboardingComplete) return;
  } catch {}

  const tip = TIPS[state.nextIndex];
  state.nextIndex++;
  if (state.nextIndex >= TIPS.length) state.done = true;
  saveState(state);

  // Small delay so the overlay window appears first
  setTimeout(() => showTipWindow(tip, state.nextIndex - 1), 400);
}

/**
 * Reset tip state (for testing or onboarding reset).
 */
export function resetFirstToggleTips(): void {
  state = { nextIndex: 0, done: false };
  saveState(state);
}
