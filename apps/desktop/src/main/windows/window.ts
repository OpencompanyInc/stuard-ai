
import { app, BrowserWindow, globalShortcut, nativeImage, Tray, screen, powerMonitor, shell, desktopCapturer } from "electron";
import path from "path";
import fs from "fs";
import { isDev } from "../env";
import logger from "../utils/logger";
import { getGlobalHotkey, loadSettings, setRendererPrefs } from "../settings";
import { initOverlayHotkey } from "./overlay-hotkey";
import { initTrayMenu, showTrayMenu, type TrayThemeMode } from "./tray-menu-window";

let win: BrowserWindow | null = null;
let onboardingWin: BrowserWindow | null = null;
let workflowsWin: BrowserWindow | null = null;
let sidebarWin: BrowserWindow | null = null;
let dashboardWin: BrowserWindow | null = null;
let notificationWin: BrowserWindow | null = null;
let voiceTestWin: BrowserWindow | null = null;
let voiceBorderWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let sidebarExpanded = false;

// Standalone sidebar window dimensions
const SIDEBAR_EXPANDED_WIDTH = 900;
const SIDEBAR_EXPANDED_HEIGHT = 700;

// Internal sidebar (rendered inside overlay window)
const DEFAULT_INTERNAL_SIDEBAR_WIDTH = 304;
const INTERNAL_SIDEBAR_WIDTH_MIN = 240;
const INTERNAL_SIDEBAR_WIDTH_MAX = 560;
let internalSidebarPanelWidth = DEFAULT_INTERNAL_SIDEBAR_WIDTH;

function clampInternalSidebarPanelWidth(width: number): number {
  return Math.max(
    INTERNAL_SIDEBAR_WIDTH_MIN,
    Math.min(INTERNAL_SIDEBAR_WIDTH_MAX, Math.round(width)),
  );
}

// Keep a stable record of the intended content size to prevent drift from DPI rounding
let baseContentWidth = 400;
let baseContentHeight = 56;
// Also keep the stable OUTER window size (pixel bounds) to fully lock size while moving
let baseOuterWidth = 0;
let baseOuterHeight = 0;
// When changing size programmatically (expand/collapse), temporarily disable the size lock
let resizingProgrammatically = false;
let compactResizeAnchor: 'top' | 'bottom' = 'top';

type OverlayMode = "compact" | "sidebar" | "window";
let currentMode: OverlayMode = "compact";

const APP_ICON_FILENAME = "icon2.png";

function getAppIconPath(): string | undefined {
  const appPath = (() => { try { return app?.getAppPath?.() || ""; } catch { return ""; } })();
  const candidates = [
    // Packaged: extraResources lands the file directly under resources/
    path.join(process.resourcesPath || "", APP_ICON_FILENAME),
    // Dev (tsup output dist/main/index.js — climb out to apps/desktop/icons)
    path.join(__dirname, "..", "..", "icons", APP_ICON_FILENAME),
    appPath ? path.join(appPath, "icons", APP_ICON_FILENAME) : "",
    // Legacy fallbacks (older builds kept icons under build/)
    path.join(__dirname, "..", "..", "build", APP_ICON_FILENAME),
    appPath ? path.join(appPath, "build", APP_ICON_FILENAME) : "",
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return undefined;
}

const APP_ICON_PATH = getAppIconPath();

// Track the last active window handle (for split-screen in sidebar mode)
let lastActiveWindowHandle: string | null = null;

type SplitTargetSnapshot = {
  handle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  wasMaximized: boolean;
  wasMinimized: boolean;
};

let lastSplitTarget: SplitTargetSnapshot | null = null;

function captureWindowSnapshotByHandle(handle: string): SplitTargetSnapshot | null {
  if (process.platform !== "win32") return null;
  if (!handle || handle === "0") return null;
  try {
    const { execSync } = require("child_process");
    const tmpDir = require("os").tmpdir();
    const scriptPath = path.join(tmpDir, "stuard_get_bounds.ps1");
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Bounds {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
}
"@
$h = [IntPtr]${handle}
$rect = New-Object Win32Bounds+RECT
$ok = [Win32Bounds]::GetWindowRect($h, [ref]$rect)
if (-not $ok) { exit 2 }
$w = $rect.Right - $rect.Left
$hgt = $rect.Bottom - $rect.Top
$isMax = [Win32Bounds]::IsZoomed($h)
$isMin = [Win32Bounds]::IsIconic($h)
Write-Output "x=$($rect.Left) y=$($rect.Top) w=$w h=$hgt max=$isMax min=$isMin"
`;
    fs.writeFileSync(scriptPath, ps, "utf8");
    const out = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { encoding: "utf8", timeout: 2000 }).trim();
    try { fs.unlinkSync(scriptPath); } catch { }

    const m = /x=([-\d]+)\s+y=([-\d]+)\s+w=(\d+)\s+h=(\d+)\s+max=(True|False)\s+min=(True|False)/.exec(out);
    if (!m) return null;
    return {
      handle,
      x: Number(m[1]),
      y: Number(m[2]),
      width: Number(m[3]),
      height: Number(m[4]),
      wasMaximized: m[5] === "True",
      wasMinimized: m[6] === "True",
    };
  } catch {
    return null;
  }
}

function restoreWindowSnapshot(snapshot: SplitTargetSnapshot) {
  if (process.platform !== "win32") return;
  if (!snapshot?.handle || snapshot.handle === "0") return;
  try {
    const { execFile } = require('child_process');
    const tmpDir = require('os').tmpdir();
    const scriptPath = path.join(tmpDir, 'stuard_restore_split.ps1');
    const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Restore {
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$hwnd = [IntPtr]${snapshot.handle}
if ($hwnd -eq 0) { exit 2 }
[Win32Restore]::SetWindowPos($hwnd, [IntPtr]::Zero, ${snapshot.x}, ${snapshot.y}, ${snapshot.width}, ${snapshot.height}, 0x14) | Out-Null
if (${snapshot.wasMaximized ? '$true' : '$false'}) {
  [Win32Restore]::ShowWindow($hwnd, 3) | Out-Null
} elseif (${snapshot.wasMinimized ? '$true' : '$false'}) {
  [Win32Restore]::ShowWindow($hwnd, 6) | Out-Null
} else {
  [Win32Restore]::ShowWindow($hwnd, 9) | Out-Null
}
`;
    fs.writeFileSync(scriptPath, ps, 'utf8');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], () => {
      try { fs.unlinkSync(scriptPath); } catch { }
    });
  } catch { }
}

function getNativeWindowHandleString(target: BrowserWindow | null) {
  if (!target) return null;
  try {
    const handleBuffer = target.getNativeWindowHandle();
    if (!handleBuffer?.length) return null;
    if (handleBuffer.length >= 8) {
      return handleBuffer.readBigUInt64LE(0).toString();
    }
    return handleBuffer.readUInt32LE(0).toString();
  } catch {
    return null;
  }
}

function captureForegroundWindowHandle(excludeHandles?: Array<string | null>) {
  if (process.platform !== "win32") return null;
  try {
    const { execSync } = require("child_process");
    const tmpDir = require("os").tmpdir();
    const getHandleScript = path.join(tmpDir, "stuard_get_handle.ps1");
    const excludes = (excludeHandles || [])
      .map((h) => (h && h !== "0" ? h : null))
      .filter((h): h is string => !!h);
    const excludedList = excludes.length ? excludes.join(",") : "0";
    const getHandlePsScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32GetHandle {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
}
"@
$excludeCsv = "${excludedList}"
$exclude = @()
try {
  foreach ($p in $excludeCsv.Split(',') ) {
    $t = $p.Trim()
    if ($t -and $t -ne '0') { $exclude += [Int64]$t }
  }
} catch { }
$foreground = [Win32GetHandle]::GetForegroundWindow()
$target = $foreground
if ($exclude.Count -gt 0) {
  # If the foreground is one of our windows (overlay/spaces/etc), walk the z-order to find the next real app window.
  if ($exclude -contains $foreground.ToInt64()) {
    $cursor = $foreground
    for ($i = 0; $i -lt 20; $i++) {
      $cursor = [Win32GetHandle]::GetWindow($cursor, 2)
      if ($cursor -eq [IntPtr]::Zero) { break }
      if (-not ($exclude -contains $cursor.ToInt64())) {
        $target = $cursor
        break
      }
    }
  }
}
if ($target -ne [IntPtr]::Zero) {
  $root = [Win32GetHandle]::GetAncestor($target, 2)
  if ($root -ne [IntPtr]::Zero) { $target = $root }
}
$target.ToInt64()
`;
    fs.writeFileSync(getHandleScript, getHandlePsScript, "utf8");

    let capturedHandle: string | null = null;
    try {
      const result = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${getHandleScript}"`, { encoding: "utf8", timeout: 2000 });
      capturedHandle = result.trim();
    } catch (e) {
      logger.warn("Failed to capture foreground window handle:", e);
    }
    try { fs.unlinkSync(getHandleScript); } catch { }

    if (!capturedHandle || capturedHandle === "0") return null;
    return capturedHandle;
  } catch (err) {
    logger.warn("Error capturing foreground window handle:", err);
  }
  return null;
}

function updateLastActiveWindowHandle(source: string) {
  const overlayHandle = getNativeWindowHandleString(win);
  const handle = captureForegroundWindowHandle([
    overlayHandle,
    getNativeWindowHandleString(onboardingWin),
  ]);
  if (!handle) return;
  if (overlayHandle && handle === overlayHandle) return;
  lastActiveWindowHandle = handle;
  logger.info("Stored foreground window handle:", handle, "source:", source);
}

// User-customized sizes per mode (persisted preferences)
interface ModeSizePrefs {
  compact: { width: number; height: number };
  window: { width: number; height: number };
}

// Default sizes for each mode
const DEFAULT_MODE_SIZES: ModeSizePrefs = {
  compact: { width: 520, height: 88 },  // 360x56 visible pill centered in a 520x88 transparent window — extra horizontal space lets the dropdown extend beyond the pill without resizing on type; extra vertical space lets the pill's drop shadow render without getting clipped at the window edge
  window: { width: 800, height: 600 },
};

// Min/max constraints per mode for user resizing
const MODE_SIZE_CONSTRAINTS = {
  compact: { minW: 520, maxW: 1440, minH: 88, maxH: 760 },
  sidebar: { minW: 400, maxW: 1100, minH: 400, maxH: 2000 },  // Allow for internal sidebar (320px)
  // Window mode is unbounded so the user can maximize to fill the screen.
  // We still keep a sensible minimum to prevent collapsing the chrome.
  window: { minW: 500, maxW: 0, minH: 400, maxH: 0 },
};

// Track internal sidebar state for width management
let internalSidebarOpen = false;

// Track applied chrome state so we can skip redundant native calls.
// Each native chrome change can trigger a Windows DWM repaint and produce
// a visible flicker, so we only re-apply when something actually changed.
let appliedChrome: {
  alwaysOnTop: boolean;
  skipTaskbar: boolean;
  hasShadow: boolean;
  minimizable: boolean;
  maximizable: boolean;
} | null = null;

function applyOverlayChrome(mode: OverlayMode) {
  if (!win) return;
  const desired = mode === 'window'
    ? { alwaysOnTop: false, skipTaskbar: false, hasShadow: true, minimizable: true, maximizable: true }
    : { alwaysOnTop: true, skipTaskbar: true, hasShadow: false, minimizable: false, maximizable: false };
  try {
    if (!appliedChrome || appliedChrome.alwaysOnTop !== desired.alwaysOnTop) {
      if (desired.alwaysOnTop) {
        try { win.setAlwaysOnTop(true, 'screen-saver'); } catch { }
      } else {
        try { win.setAlwaysOnTop(false); } catch { }
      }
    }
    if (!appliedChrome || appliedChrome.skipTaskbar !== desired.skipTaskbar) {
      try { win.setSkipTaskbar(desired.skipTaskbar); } catch { }
    }
    if (!appliedChrome || appliedChrome.hasShadow !== desired.hasShadow) {
      try { win.setHasShadow(desired.hasShadow); } catch { }
    }
    if (!appliedChrome || appliedChrome.minimizable !== desired.minimizable) {
      try { win.setMinimizable(desired.minimizable); } catch { }
    }
    if (!appliedChrome || appliedChrome.maximizable !== desired.maximizable) {
      try { win.setMaximizable(desired.maximizable); } catch { }
    }
    appliedChrome = desired;
  } catch { }
}

function notifyOverlayMaximizedChanged() {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('overlay:maximizedChanged', { maximized: win.isMaximized() });
  } catch { }
}

/** Frameless standalone windows (Studio, Dashboard, etc.) */
export function attachStandaloneWindowChrome(browserWindow: BrowserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  const notify = () => {
    try {
      browserWindow.webContents.send('window:maximizedChanged', { maximized: browserWindow.isMaximized() });
    } catch { }
  };
  browserWindow.on('maximize', notify);
  browserWindow.on('unmaximize', notify);
}

function forceOverlayChrome() {
  if (!win) return;
  try {
    if (currentMode === 'window') {
      win.setAlwaysOnTop(false);
      win.setSkipTaskbar(false);
      win.setMinimizable(true);
      win.setMaximizable(true);
    } else {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setSkipTaskbar(true);
      win.setMinimizable(false);
      win.setMaximizable(false);
    }
  } catch { }
}

// Current user-preferred sizes (loaded from store on init)
let userModeSizes: ModeSizePrefs = { ...DEFAULT_MODE_SIZES };

// Track if user is currently resizing
let userResizing = false;
let lastUserResizeTime = 0;

export function getPreloadPath() {
  // In dev, __dirname is usually dist/main; the preload we want is dist/preload/index.js
  // After refactor, paths may differ, so try a few candidates in order.
  const candidates = [
    path.join(__dirname, "../preload/index.js"),       // dist/main -> dist/preload
    path.join(__dirname, "../../preload/index.js"),    // dist/main/windows -> dist/preload (older layout)
    path.join(process.cwd(), "dist/preload/index.js"),  // fallback
  ];
  logger.debug("Looking for preload in:", candidates);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        logger.info("Preload resolved:", p);
        return p;
      }
    } catch { }
  }
  const fallback = path.join(__dirname, "../preload/index.js");
  logger.warn("Preload not found, falling back to", fallback);
  return fallback;
}

export function getRendererUrl(entry: "index" | "dashboard" | "onboarding" | "board" | "workflows" | "sidebar" | "notification" | "voicetest" | "voice-border" = "index") {
  if (isDev) return `http://localhost:5173/${entry}.html`;
  return `file://${path.join(__dirname, `../../renderer/${entry}.html`)}`;
}

function centerTopWithContentSize(target: BrowserWindow, contentWidth: number, contentHeight: number) {
  // For a frameless transparent window with useContentSize:true the outer
  // bounds equal the content bounds, so we can compute the position in one
  // pass and apply size + position together via setBounds. This avoids two
  // separate native calls (setContentSize + setPosition) which on Windows
  // can each trigger a DWM repaint and cause visible flicker.
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - contentWidth) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.12);
  try {
    target.setBounds({ x, y, width: contentWidth, height: contentHeight });
  } catch {
    try {
      target.setContentSize(contentWidth, contentHeight);
      target.setPosition(x, y);
    } catch { }
  }
}

function repositionTopCenter(target: BrowserWindow) {
  const { workArea } = screen.getPrimaryDisplay();
  const b = target.getBounds();
  const x = Math.round(workArea.x + (workArea.width - b.width) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.12);
  if (b.x === x && b.y === y) return;
  target.setPosition(x, y);
}

// Handle user resize - save the new size preference for the current mode
function handleUserResize() {
  if (!win || resizingProgrammatically) return;
  // Don't snapshot maximized dimensions as the user's "preferred" size — that
  // would wipe out their last manual resize and make unmaximize unhelpful.
  try { if (win.isMaximized()) return; } catch { /* ignore */ }

  const now = Date.now();
  if (now - lastUserResizeTime < 100) return; // Debounce
  lastUserResizeTime = now;

  const b = win.getBounds();
  const constraints = MODE_SIZE_CONSTRAINTS[currentMode];

  // Clamp to constraints. A maxW/maxH of 0 means "no maximum" (used in window mode).
  const maxW = constraints.maxW > 0 ? constraints.maxW : b.width;
  const maxH = constraints.maxH > 0 ? constraints.maxH : b.height;
  const width = Math.max(constraints.minW, Math.min(maxW, b.width));
  const height = Math.max(constraints.minH, Math.min(maxH, b.height));

  // Save user's preferred size for this mode (except sidebar which is special)
  // Subtract internal sidebar width if open, so we save the base content width
  if (currentMode !== 'sidebar') {
    const savedWidth = internalSidebarOpen ? Math.max(width - internalSidebarPanelWidth, constraints.minW) : width;
    userModeSizes[currentMode] = { width: savedWidth, height };
    // Persist to main process memory (could also use electron-store)
    baseContentWidth = savedWidth;
    baseContentHeight = height;
    baseOuterWidth = internalSidebarOpen ? savedWidth + internalSidebarPanelWidth : savedWidth;
    baseOuterHeight = b.height;
  }

  // Notify renderer of size change for responsive layout
  try {
    win.webContents.send('overlay:resized', { width, height, mode: currentMode });
  } catch { }
}

// Ensure overlay window stays within constraints
function assertOverlaySize() {
  if (!win) return;
  if (resizingProgrammatically) return;

  // Allow user resizing - just enforce constraints
  const b = win.getBounds();
  const constraints = MODE_SIZE_CONSTRAINTS[currentMode];

  const maxW = constraints.maxW > 0 ? constraints.maxW : b.width;
  const maxH = constraints.maxH > 0 ? constraints.maxH : b.height;
  const clampedWidth = Math.max(constraints.minW, Math.min(maxW, b.width));
  const clampedHeight = Math.max(constraints.minH, Math.min(maxH, b.height));

  // Only adjust if out of constraints
  if (b.width !== clampedWidth || b.height !== clampedHeight) {
    win.setBounds({ x: b.x, y: b.y, width: clampedWidth, height: clampedHeight });
  }
}

// Update window min/max constraints when mode changes
function updateSizeConstraints(mode: OverlayMode) {
  if (!win) return;
  const constraints = MODE_SIZE_CONSTRAINTS[mode];
  try {
    win.setMinimumSize(constraints.minW, constraints.minH);
    // setMaximumSize(0, 0) means "unbounded" in Electron — used in window mode
    // so the user can maximize to fill the screen.
    win.setMaximumSize(constraints.maxW, constraints.maxH);
  } catch { }
}

// Get current overlay size info for renderer
export function getOverlaySize() {
  if (!win) return { width: 520, height: 88, mode: 'compact' };
  const b = win.getBounds();
  return { width: b.width, height: b.height, mode: currentMode };
}

export function createWindow() {
  logger.info("Creating overlay window...");
  const WIDTH = 520; // pill is 360px wide centered; the wider window holds the dropdown so typing doesn't resize horizontally
  const HEIGHT = 88; // compact pill is 56px tall; ~16px on each side gives the drop shadow room to render without clipping at the window edge

  const preloadPath = getPreloadPath();
  logger.info("Preload path:", preloadPath);
  logger.info("Preload exists:", fs.existsSync(preloadPath));

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    icon: APP_ICON_PATH,
    transparent: true,
    hasShadow: false,
    resizable: true, // Enable user resizing
    movable: true,
    minimizable: false,
    maximizable: false,
    // Allow fullscreen — window mode needs it; we still gate minimize/maximize
    // via setMinimizable/setMaximizable per current mode.
    fullscreenable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    useContentSize: true,
    // Set initial min/max for compact mode
    minWidth: MODE_SIZE_CONSTRAINTS.compact.minW,
    minHeight: MODE_SIZE_CONSTRAINTS.compact.minH,
    maxWidth: MODE_SIZE_CONSTRAINTS.compact.maxW,
    maxHeight: MODE_SIZE_CONSTRAINTS.compact.maxH,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true, // Enable devTools for debugging
    },
    backgroundColor: "#00000000",
  });

  logger.info("BrowserWindow created");
  win.setMenu(null);
  applyOverlayContentProtection();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  centerTopWithContentSize(win, WIDTH, HEIGHT);
  // Initialize stable content size baseline
  baseContentWidth = WIDTH;
  baseContentHeight = HEIGHT;
  // Initialize stable outer size baseline
  {
    const ob = win.getBounds();
    baseOuterWidth = ob.width;
    baseOuterHeight = ob.height;
  }
  // Set min/max constraints for compact mode (will be updated on mode change)
  updateSizeConstraints('compact');

  if (isDev) {
    const devUrl = getRendererUrl("index");
    logger.info("Loading renderer (dev):", devUrl);
    win.loadURL(devUrl);
  } else {
    // Try multiple paths since __dirname can vary between dev and packaged builds
    const candidates = [
      path.join(__dirname, "../renderer/index.html"),     // dist/main -> dist/renderer
      path.join(__dirname, "../../renderer/index.html"),   // dist/main/windows -> dist/renderer (nested)
      path.join(__dirname, "../../dist/renderer/index.html"), // fallback
    ];
    logger.info("Renderer path candidates:", candidates);

    let loaded = false;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        logger.info("Loading renderer:", p);
        win.loadFile(p).catch(err => {
          logger.error("Failed to load renderer file:", err);
        });
        loaded = true;
        break;
      }
    }
    if (!loaded) {
      logger.error("No renderer file found! Tried:", candidates);
    }
  }

  // Show window when ready to show (more reliable than did-finish-load for initial paint)
  win.once('ready-to-show', () => {
    logger.info("Window ready-to-show event fired");
    if (win && !win.isVisible()) {
      logger.info("Showing window on ready-to-show...");
      showWindow();
    }
  });

  // Absolute fallback: if something about renderer load events is flaky, still show after a delay.
  // This prevents "runs but invisible" on startup.
  setTimeout(() => {
    try {
      if (!win || win.isDestroyed()) return;
      if (!win.isVisible()) {
        logger.warn("Startup fallback: window still hidden after delay; forcing showWindow()");
        showWindow();
      }
    } catch (e) {
      logger.error("Startup fallback show failed:", e);
    }
  }, 2500);

  // Log renderer load status
  win.webContents.on('did-finish-load', () => {
    logger.info("Renderer loaded successfully");
    logger.info("Window visible:", win?.isVisible());
    // Fallback: show window if not yet visible
    if (win && !win.isVisible()) {
      logger.info("Showing window after load (fallback)...");
      showWindow();
    }
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error("Renderer failed to load:", { errorCode, errorDescription, validatedURL });
    // Still show window on failure so user can see something is wrong
    if (win && !win.isVisible()) {
      logger.info("Showing window despite load failure...");
      win.show();
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error("Render process gone:", details);
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelStr = ['verbose', 'info', 'warning', 'error'][level] || 'log';
    // Log renderer messages to terminal - show everything including log/verbose
    if (level >= 0) {
      logger.info(`[Renderer] [${levelStr}] ${message}`);
    }
  });

  // Keep overlay visible on focus changes; user controls visibility via hotkey or Escape.
  // In compact/sidebar, prevent minimize so Win+D / Show Desktop cannot hide the overlay.
  win.on("minimize", (e: Electron.Event) => {
    if (currentMode === 'window') return;
    e.preventDefault();
    win?.restore();
    win?.show();
  });

  win.on('maximize', () => notifyOverlayMaximizedChanged());
  win.on('unmaximize', () => {
    preMaximizeBounds = null;
    notifyOverlayMaximizedChanged();
  });

  applyOverlayChrome(currentMode);

  win.on("closed", () => {
    win = null;
  });
  // Handle resize events - allow user resizing while enforcing constraints.
  // Resize handler is throttled via rAF-style coalescing so user-drag resizes
  // don't fire dozens of IPC messages per second to the renderer.
  let resizeRafScheduled = false;
  win.on('resize', () => {
    assertOverlaySize();
    if (resizeRafScheduled) return;
    resizeRafScheduled = true;
    setImmediate(() => {
      resizeRafScheduled = false;
      handleUserResize();
    });
  });
  win.on('will-resize', (_event, newBounds) => {
    try {
      win?.webContents.send('overlay:resizing', { width: newBounds.width, height: newBounds.height });
    } catch { }
  });
  win.on('focus', () => {
    unregisterMoveShortcuts();
    clearMoveTimer();
  });
  win.on('blur', () => {
    updateLastActiveWindowHandle('blur');
    registerMoveShortcuts();
  });
  win.on('hide', () => {
    wasHidden = true;
    unregisterMoveShortcuts();
    clearMoveTimer();
    // Fires synchronously with the OS hide so the renderer can park its entrance
    // animation in the hidden state before the next show flips visibility.
    try { win?.webContents.send("overlay:hidden"); } catch { }
  });
  win.on('show', () => {
    if (win?.isFocused()) unregisterMoveShortcuts();
    else registerMoveShortcuts();
  });

  // Restore window bounds after resuming from sleep/hibernate.
  // Windows can corrupt Electron window bounds during suspend/resume.
  powerMonitor.on('resume', () => {
    logger.info('[power] System resumed from sleep, restoring overlay bounds. mode=' + currentMode);
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;

      resizingProgrammatically = true;

      try {
        // Re-apply size constraints for the current mode
        updateSizeConstraints(currentMode);
        applyOverlayChrome(currentMode);

        if (currentMode === 'sidebar') {
          // Sidebar: re-snap to right side of screen
          const { workArea } = screen.getPrimaryDisplay();
          const sidebarWidth = Math.round(workArea.width * 0.35);
          const h = workArea.height;
          const sidebarX = workArea.x + workArea.width - sidebarWidth;
          win.setBounds({ x: sidebarX, y: workArea.y, width: sidebarWidth, height: h });
          baseContentWidth = sidebarWidth;
          baseContentHeight = h;
          baseOuterWidth = sidebarWidth;
          baseOuterHeight = h;
        } else {
          // Compact or Window mode: restore user-preferred size
          const prefs = userModeSizes[currentMode] || DEFAULT_MODE_SIZES[currentMode];
          const constraints = MODE_SIZE_CONSTRAINTS[currentMode];
          const maxW = constraints.maxW > 0 ? constraints.maxW : prefs.width;
          const maxH = constraints.maxH > 0 ? constraints.maxH : prefs.height;
          let width = Math.max(constraints.minW, Math.min(maxW, prefs.width));
          let height = Math.max(constraints.minH, Math.min(maxH, prefs.height));

          // If internal sidebar was open, add its width back
          if (internalSidebarOpen) {
            const sidebarMax = constraints.maxW > 0 ? constraints.maxW + internalSidebarPanelWidth : width + internalSidebarPanelWidth;
            width = Math.min(width + internalSidebarPanelWidth, sidebarMax);
          }

          centerTopWithContentSize(win, width, height);
          baseContentWidth = width;
          baseContentHeight = height;
          const ob = win.getBounds();
          baseOuterWidth = ob.width;
          baseOuterHeight = ob.height;
        }

        logger.info('[power] Overlay bounds restored successfully');
      } catch (e) {
        logger.error('[power] Failed to restore overlay bounds:', e);
      } finally {
        resizingProgrammatically = false;
      }
    }, 1500); // Delay to let Windows finish display reconnection
  });
}

export function openOnboardingWindow() {
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.show();
    onboardingWin.focus();
    onboardingWin.moveTop();
    return;
  }

  const { bounds } = screen.getPrimaryDisplay();

  onboardingWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false, // Show after ready-to-show for smoother appearance
    frame: false,
    icon: APP_ICON_PATH,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: true,
    skipTaskbar: false,
    alwaysOnTop: true, // Cover the taskbar
    useContentSize: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
    backgroundColor: "#00000000",
  });

  try { onboardingWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  try { onboardingWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}

  onboardingWin.setMenu(null);
  if (screenCaptureInvisibleEnabled) {
    try { onboardingWin.setContentProtection(true); } catch {}
  }

  // Default to click-through so the OS shows through transparent areas. The
  // renderer flips this off when the cursor enters an interactive element.
  try { onboardingWin.setIgnoreMouseEvents(true, { forward: true }); } catch {}

  // Show when ready for smoother appearance
  onboardingWin.once('ready-to-show', () => {
    onboardingWin?.show();
    onboardingWin?.focus();
  });

  if (isDev) {
    onboardingWin.loadURL(getRendererUrl("onboarding"));
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/onboarding.html"),
      path.join(__dirname, "../../renderer/onboarding.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        onboardingWin.loadFile(p);
        break;
      }
    }
  }

  onboardingWin.on("closed", () => { onboardingWin = null; });
}

export function closeOnboardingWindow() {
  try { onboardingWin?.close(); } catch { }
}

export function openVoiceTestWindow() {
  if (voiceTestWin && !voiceTestWin.isDestroyed()) {
    voiceTestWin.show();
    voiceTestWin.focus();
    voiceTestWin.moveTop();
    return;
  }

  const WIDTH = 480;
  const HEIGHT = 700;

  voiceTestWin = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 400,
    minHeight: 550,
    show: false,
    frame: false,
    icon: APP_ICON_PATH,
    transparent: true,
    hasShadow: true,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    useContentSize: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
    backgroundColor: "#00000000",
  });

  voiceTestWin.setMenu(null);
  if (screenCaptureInvisibleEnabled) {
    try { voiceTestWin.setContentProtection(true); } catch {}
  }

  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - WIDTH) / 2);
  const y = Math.round(workArea.y + (workArea.height - HEIGHT) / 2);
  voiceTestWin.setPosition(x, y);

  voiceTestWin.once('ready-to-show', () => {
    voiceTestWin?.show();
    voiceTestWin?.focus();
  });

  if (isDev) {
    voiceTestWin.loadURL(getRendererUrl("voicetest"));
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/voicetest.html"),
      path.join(__dirname, "../../renderer/voicetest.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        voiceTestWin.loadFile(p);
        break;
      }
    }
  }

  voiceTestWin.on("closed", () => { voiceTestWin = null; });
}

export function closeVoiceTestWindow() {
  try { voiceTestWin?.close(); } catch { }
}

export function openDashboardWindow(options?: { tab?: string }) {
  // Agents moved out of the dashboard into Stuard Studio. Redirect stale deep
  // links (the old 'bots' tab + the retired 'proactive' view) to Studio Agents.
  if (options?.tab === 'bots' || options?.tab === 'proactive') {
    openWorkflowsWindow({ view: 'agents' });
    return;
  }
  const initialTab = options?.tab || '';

  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.show();
    dashboardWin.focus();
    dashboardWin.moveTop();
    // If a tab was specified, send it to the renderer
    if (initialTab) {
      dashboardWin.webContents.send('dashboard:navigate', { tab: initialTab });
    }
    return;
  }

  const d = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: true,
    frame: false,
    transparent: false,
    resizable: true,
    icon: APP_ICON_PATH,
    movable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: false,
    useContentSize: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev,
    },
    backgroundColor: "#ffffff",
  });
  d.setMenu(null);
  d.setMenuBarVisibility(false);
  if (screenCaptureInvisibleEnabled) {
    try { d.setContentProtection(true); } catch {}
  }
  if (isDev) {
    const url = initialTab
      ? `${getRendererUrl("dashboard")}?tab=${encodeURIComponent(initialTab)}`
      : getRendererUrl("dashboard");
    d.loadURL(url);
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/dashboard.html"),
      path.join(__dirname, "../../renderer/dashboard.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        if (initialTab) {
          d.loadFile(p, { query: { tab: initialTab } });
        } else {
          d.loadFile(p);
        }
        break;
      }
    }
  }
  try {
    const base = String(process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || process.env.VITE_CLOUD_AI_URL || '').replace(/\/+$/, '');
    if (base) {
      d.webContents.on('did-finish-load', () => {
        try { d.webContents.executeJavaScript(`window.__CLOUD_AI_HTTP__ = ${JSON.stringify(base)};`); } catch { }
      });
    }
  } catch { }

  d.on('closed', () => { dashboardWin = null; });
  dashboardWin = d;
}

export function openWorkflowsWindow(options?: { marketplaceSlug?: string; workflowId?: string; view?: 'workflows' | 'agents' | 'tools' | 'deployed' | 'shared' | 'marketplace' | 'skills' }) {
  const initialSlug = options?.marketplaceSlug || '';
  const initialWorkflowId = options?.workflowId || '';
  const initialView = options?.view || '';

  if (workflowsWin && !workflowsWin.isDestroyed()) {
    workflowsWin.show();
    workflowsWin.focus();
    workflowsWin.moveTop();
    if (initialSlug || initialWorkflowId || initialView) {
      workflowsWin.webContents.send('workflows:navigate', {
        ...(initialSlug ? { marketplaceSlug: initialSlug } : {}),
        ...(initialWorkflowId ? { workflowId: initialWorkflowId } : {}),
        ...(initialView ? { view: initialView } : {}),
      });
    }
    return;
  }
  const d = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: true,
    // Use the native Windows chrome (title bar with min/max/close buttons)
    // instead of a custom in-app title bar. macOS gets a hidden traffic-light
    // bar that still allows window dragging.
    frame: true,
    title: 'Stuard Studio',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    transparent: false,
    resizable: true,
    icon: APP_ICON_PATH,
    movable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    useContentSize: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true, // Enable devTools in production for debugging
    },
    backgroundColor: "#ffffff",
  });
  attachStandaloneWindowChrome(d);
  // Let the workflow canvas handle Ctrl/pinch wheel — block Chromium page zoom.
  try {
    d.webContents.on("before-input-event", (event, input) => {
      if (input.type === "mouseWheel" && (input.control || input.meta)) {
        event.preventDefault();
      }
    });
  } catch { }
  // Keep the application menu hidden so it doesn't add an Electron menu bar
  // above the native title bar. The OS title bar still renders normally.
  d.setMenu(null);
  d.setMenuBarVisibility(false);
  if (screenCaptureInvisibleEnabled) {
    try { d.setContentProtection(true); } catch {}
  }
  // Open devTools in production for debugging workflow UI issues
  if (!isDev) {
    d.webContents.on('did-finish-load', () => {
      // Log any errors to help debug
      d.webContents.on('console-message', (_event, level, message) => {
        if (level >= 2) logger.warn(`[Workflows] ${message}`);
      });
    });
  }
  const queryParts: string[] = [];
  if (initialSlug) queryParts.push(`marketplaceSlug=${encodeURIComponent(initialSlug)}`);
  if (initialWorkflowId) queryParts.push(`workflowId=${encodeURIComponent(initialWorkflowId)}`);
  if (initialView) queryParts.push(`view=${encodeURIComponent(initialView)}`);
  const queryString = queryParts.length ? `?${queryParts.join('&')}` : '';
  const loadFileQuery: Record<string, string> = {};
  if (initialSlug) loadFileQuery.marketplaceSlug = initialSlug;
  if (initialWorkflowId) loadFileQuery.workflowId = initialWorkflowId;
  if (initialView) loadFileQuery.view = initialView;

  if (isDev) {
    const url = queryString
      ? `${getRendererUrl("workflows")}${queryString}`
      : getRendererUrl("workflows");
    d.loadURL(url);
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/workflows.html"),
      path.join(__dirname, "../../renderer/workflows.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        if (Object.keys(loadFileQuery).length > 0) {
          d.loadFile(p, { query: loadFileQuery });
        } else {
          d.loadFile(p);
        }
        break;
      }
    }
  }
  try {
    const base = String(process.env.CLOUD_AI_HTTP || process.env.CLOUD_PUBLIC_URL || process.env.VITE_CLOUD_AI_URL || '').replace(/\/+$/, '');
    if (base) {
      d.webContents.on('did-finish-load', () => {
        try { d.webContents.executeJavaScript(`window.__CLOUD_AI_HTTP__ = ${JSON.stringify(base)};`); } catch { }
      });
    }
  } catch { }
  d.on('closed', () => { workflowsWin = null; });
  workflowsWin = d;
}

// Standalone Sidebar Window (Spaces, Canvas, Terminal) - always opens as standalone window
export function openSidebarWindow(options?: { tab?: 'terminal' | 'todo' | 'projects'; expanded?: boolean }) {
  // Always open as standalone expanded window (ignore expanded flag, always expanded)

  if (sidebarWin && !sidebarWin.isDestroyed()) {
    sidebarWin.show();
    sidebarWin.focus();
    sidebarWin.moveTop();
    if (options?.tab) {
      sidebarWin.webContents.send('sidebar:navigate', { tab: options.tab });
    }
    return;
  }

  // Always open as standalone centered window
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;

  const width = Math.min(SIDEBAR_EXPANDED_WIDTH, workArea.width - 100);
  const height = Math.min(SIDEBAR_EXPANDED_HEIGHT, workArea.height - 100);
  const initialBounds = {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
  sidebarExpanded = true; // Always expanded

  sidebarWin = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    show: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    icon: APP_ICON_PATH,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,  // Always show in taskbar (standalone window)
    alwaysOnTop: false,   // Not always on top (standalone window)
    useContentSize: true,
    focusable: true,
    minWidth: 380,
    minHeight: 400,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
    backgroundColor: "#00000000",
  });

  sidebarWin.setMenu(null);
  if (screenCaptureInvisibleEnabled) {
    try { sidebarWin.setContentProtection(true); } catch {}
  }
  // Always standalone mode - no special always-on-top handling needed

  // Build URL/file with tab and expanded params (always expanded)
  const queryParams: Record<string, string> = { expanded: 'true' };
  if (options?.tab) queryParams.tab = options.tab;

  if (isDev) {
    const params = new URLSearchParams(queryParams).toString();
    const url = params ? `${getRendererUrl("sidebar")}?${params}` : getRendererUrl("sidebar");
    sidebarWin.loadURL(url);
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/sidebar.html"),
      path.join(__dirname, "../../renderer/sidebar.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        if (Object.keys(queryParams).length > 0) {
          sidebarWin.loadFile(p, { query: queryParams });
        } else {
          sidebarWin.loadFile(p);
        }
        break;
      }
    }
  }

  sidebarWin.on('closed', () => {
    sidebarWin = null;
    sidebarExpanded = false;
  });

  // Standalone window - no auto-hide behavior
}

export function closeSidebarWindow() {
  try { sidebarWin?.close(); } catch { }
}

export function toggleSidebarWindow(options?: { tab?: 'terminal' | 'todo' | 'projects'; expanded?: boolean }) {
  if (!sidebarWin || sidebarWin.isDestroyed()) {
    openSidebarWindow(options);
    return;
  }
  if (sidebarWin.isVisible()) {
    try { sidebarWin.hide(); } catch { }
    return;
  }

  // Always standalone mode - just show and focus
  sidebarWin.show();
  sidebarWin.focus();
  sidebarWin.moveTop();
  if (options?.tab) {
    sidebarWin.webContents.send('sidebar:navigate', { tab: options.tab });
  }
}

export function getSidebarWindow() {
  return sidebarWin;
}

export function isSidebarExpanded() {
  return sidebarExpanded;
}

export function toggleSidebarExpanded() {
  // Sidebar is now always expanded/standalone - this is a no-op
  // Kept for API compatibility
  return { expanded: true };
}

// Voice Border Window â€” transparent click-through full-screen overlay that
// renders the red ambient frame around the user's monitor while voice mode
// is active.
export function showVoiceBorderWindow() {
  if (voiceBorderWin && !voiceBorderWin.isDestroyed()) {
    try { voiceBorderWin.showInactive(); } catch { try { voiceBorderWin.show(); } catch { } }
    try { voiceBorderWin.moveTop(); } catch { }
    return;
  }
  // Use the display the main overlay is currently on (falls back to primary)
  // so the border ring + pill follow the user across monitors.
  const mainBounds = (() => {
    try { return win?.getBounds?.() || null; } catch { return null; }
  })();
  const targetDisplay = mainBounds
    ? screen.getDisplayMatching(mainBounds)
    : screen.getPrimaryDisplay();
  const { x, y, width, height } = targetDisplay.bounds;

  voiceBorderWin = new BrowserWindow({
    x, y, width, height,
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
    focusable: false,
    acceptFirstMouse: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev,
    },
    backgroundColor: "#00000000",
  });

  voiceBorderWin.setMenu(null);
  // Click-through so the user can still interact with their desktop.
  try { voiceBorderWin.setIgnoreMouseEvents(true, { forward: true }); } catch { }
  try { voiceBorderWin.setAlwaysOnTop(true, "screen-saver"); } catch { }
  try { voiceBorderWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { }

  voiceBorderWin.once("ready-to-show", () => {
    try { voiceBorderWin?.showInactive(); } catch { try { voiceBorderWin?.show(); } catch { } }
  });

  if (isDev) {
    voiceBorderWin.loadURL(getRendererUrl("voice-border"));
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/voice-border.html"),
      path.join(__dirname, "../../renderer/voice-border.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        voiceBorderWin.loadFile(p);
        break;
      }
    }
  }

  voiceBorderWin.on("closed", () => { voiceBorderWin = null; });
}

export function hideVoiceBorderWindow() {
  try { voiceBorderWin?.hide(); } catch { }
}

export function closeVoiceBorderWindow() {
  try { voiceBorderWin?.close(); } catch { }
  voiceBorderWin = null;
}

export function getVoiceBorderWindow(): BrowserWindow | null {
  return voiceBorderWin;
}

let wasHidden = true;
let overlayHotkeyLatched = false;
let overlayHotkeyLatchTimer: any = null;
let lastToggleAt = 0;
let lastShowAt = 0;
const OVERLAY_HOTKEY_LATCH_MS = 220;
const OVERLAY_TOGGLE_DEBOUNCE_MS = 150;
const OVERLAY_HIDE_AFTER_SHOW_GUARD_MS = 120;

export function handleOverlayHotkey() {
  try {
    if (overlayHotkeyLatchTimer != null) {
      clearTimeout(overlayHotkeyLatchTimer);
    }
  } catch { }

  overlayHotkeyLatchTimer = setTimeout(() => {
    overlayHotkeyLatched = false;
  }, OVERLAY_HOTKEY_LATCH_MS);

  if (overlayHotkeyLatched) return;
  overlayHotkeyLatched = true;
  toggleWindow();
}

let overlaySoftHideTimer: NodeJS.Timeout | null = null;
const OVERLAY_RENDERER_HIDE_ANIMATION_MS = 190;

function cancelOverlaySoftHideTimer() {
  if (overlaySoftHideTimer) {
    clearTimeout(overlaySoftHideTimer);
    overlaySoftHideTimer = null;
  }
}

export function showWindow() {
  if (!win) {
    logger.warn("showWindow: win is null!");
    return;
  }

  const wasNativeVisible = win.isVisible();
  const wasLogicallyVisible = wasNativeVisible && !wasHidden;

  if (currentMode === 'compact' && wasHidden && !wasLogicallyVisible) {
    repositionTopCenter(win);
  }

  try {
    if (win.isMinimized()) {
      win.restore();
    }
  } catch { }

  if (wasLogicallyVisible) {
    // Calling show() on an already-visible transparent frameless window still
    // performs an activation pass on Windows, which can look like a blink.
    forceOverlayChrome();
    try {
      if (!win.isFocused()) win.focus();
    } catch { }
    wasHidden = false;
    return;
  }

  try { win.setFocusable(true); } catch { }
  forceOverlayChrome();
  try { win.setIgnoreMouseEvents(false); } catch { }
  cancelOverlaySoftHideTimer();
  try { win.setOpacity(1); } catch { }

  if (!wasNativeVisible) {
    // Use show() rather than showInactive() + focus(). The showInactive -> focus
    // pair causes Windows to do an extra activation pass which on transparent
    // windows produces a brief flicker. A direct show() activates once.
    try {
      win.show();
    } catch {
      try { win.showInactive(); } catch { }
    }
  } else {
    try {
      if (!win.isFocused()) win.focus();
    } catch { }
  }

  lastShowAt = Date.now();

  // moveTop is only needed when we expect another window to be on top of ours.
  try { win.moveTop(); } catch { }
  forceOverlayChrome();

  wasHidden = false;

  try { win.webContents.send("overlay:showed"); } catch { }
}

export function hideWindow() {
  const now = Date.now();
  if (now - lastShowAt < OVERLAY_HIDE_AFTER_SHOW_GUARD_MS) return;
  wasHidden = true;
  // Soft-hide instead of win.hide(). Transparent frameless windows can visibly
  // recompose on Windows when repeatedly hidden/shown, so keep the native
  // surface alive. Let the renderer finish its slide/fade before setting native
  // opacity to 0.
  if (win && !win.isDestroyed()) {
    unregisterMoveShortcuts();
    clearMoveTimer();
    cancelOverlaySoftHideTimer();
    try { win.webContents.send("overlay:hidden"); } catch { }
    forceOverlayChrome();
    try { win.setIgnoreMouseEvents(true, { forward: true }); } catch { }
    overlaySoftHideTimer = setTimeout(() => {
      overlaySoftHideTimer = null;
      try { win?.setOpacity(0); } catch { }
      try { win?.setFocusable(false); } catch { }
      try { win?.blur(); } catch { }
    }, OVERLAY_RENDERER_HIDE_ANIMATION_MS);
  }
  if (currentMode !== 'compact') {
    setImmediate(() => {
      try { setOverlayMode('compact'); } catch { }
    });
  }
}

export function toggleWindow() {
  const now = Date.now();
  if (now - lastToggleAt < OVERLAY_TOGGLE_DEBOUNCE_MS) return;
  lastToggleAt = now;

  logger.info("toggleWindow called, win exists:", !!win);
  if (!win) return;
  logger.info("toggleWindow: currently visible=", win.isVisible());

  if (win.isVisible() && !wasHidden) {
    // In window/sidebar mode, the window persists on-screen. If the user hits
    // the hotkey from another foreground app, they want to bring this window
    // forward — not dismiss it. Only fall through to hide when this window is
    // already the focused one.
    if (currentMode !== 'compact' && !win.isFocused()) {
      try { if (win.isMinimized()) win.restore(); } catch { }
      try { win.moveTop(); } catch { }
      try { win.focus(); } catch { }
      return;
    }
    if (now - lastShowAt < OVERLAY_HIDE_AFTER_SHOW_GUARD_MS) return;
    hideWindow();
  } else {
    if (currentMode !== 'compact') {
      // We have to switch from window/sidebar to compact AND show the
      // overlay. setOverlayMode resizes the native window AND fires an
      // IPC to tell the renderer to swap its DOM. If we call show()
      // immediately the renderer hasn't repainted yet, and the user sees
      // the old (window-mode) UI clipped to the compact bounds for a
      // frame â€“ that's the visible flicker.
      //
      // We dispatch the mode change first (which sends the IPC and does
      // the native resize) and then defer the show() to the next macro
      // tick so the renderer gets a chance to paint compact-mode content
      // before the window becomes visible.
      try { setOverlayMode('compact'); } catch { }
      setImmediate(() => {
        try { showWindow(); } catch { }
      });
      return;
    }
    showWindow();
  }
}

export function setOverlaySize(width: number, height: number, reposition = false, anchor: 'top' | 'bottom' = 'top') {
  if (!win) return;
  resizingProgrammatically = true;
  if (currentMode === 'compact') {
    compactResizeAnchor = anchor;
  }

  // Clamp the requested size against the same constraints Electron's
  // setMaximumSize/setMinimumSize would enforce. If we skip this and just
  // pass an oversized height to setBounds, Electron silently clamps the
  // height but NOT our anchor-Y math — for anchor='bottom' that desynchs
  // newY from the actual rendered bottom edge and the pill teleports up by
  // (requested - clamped) on every resize. Belt-and-suspenders: clamp here.
  const constraints = MODE_SIZE_CONSTRAINTS[currentMode];
  if (constraints) {
    const maxW = constraints.maxW > 0 ? constraints.maxW : width;
    const maxH = constraints.maxH > 0 ? constraints.maxH : height;
    width = Math.max(constraints.minW, Math.min(maxW, width));
    height = Math.max(constraints.minH, Math.min(maxH, height));
  }

  baseContentWidth = width;
  baseContentHeight = height;

  // Skip the native call entirely if the window is already at the target size
  // and position-anchor doesn't require a move. This avoids unnecessary DWM
  // repaints when toggling back to the same size.
  const current = win.getBounds();
  const sameSize = current.width === width && current.height === height;

  if (anchor === 'bottom') {
    // Keep the window's bottom edge fixed while resizing (dropdown above the pill).
    const dy = height - current.height;
    const newY = current.y - dy;
    if (!sameSize || newY !== current.y) {
      win.setBounds({ x: current.x, y: newY, width, height });
    }
  } else {
    // Keep the window's top edge fixed while resizing (dropdown below the pill).
    if (reposition || !win.isVisible()) {
      centerTopWithContentSize(win, width, height);
    } else if (!sameSize) {
      win.setBounds({ x: current.x, y: current.y, width, height });
    }
  }

  // Update outer size baseline immediately (synchronous) so subsequent moves
  // don't see a stale value. We still defer constraint reapplication to next
  // tick so it doesn't fight the bounds change above.
  const ob = win.getBounds();
  baseOuterWidth = ob.width;
  baseOuterHeight = ob.height;

  setImmediate(() => {
    if (!win || win.isDestroyed()) { resizingProgrammatically = false; return; }
    resizingProgrammatically = false;
  });
}

export function overlayMinimize() {
  if (!win || win.isDestroyed() || currentMode !== 'window') return;
  try { win.minimize(); } catch { }
}

// Bounds the user had before they maximized the overlay. Transparent frameless
// windows on Windows occasionally lose Electron's internal "normal bounds" memory
// after chrome/size mutations (DWM repaint), so we snapshot ourselves to
// guarantee restore behaves correctly.
let preMaximizeBounds: { x: number; y: number; width: number; height: number } | null = null;

export function overlayToggleMaximize() {
  if (!win || win.isDestroyed() || currentMode !== 'window') return;
  try {
    if (win.isMaximized()) {
      const target = preMaximizeBounds;
      // Block any resize-event side-effects (assertOverlaySize / handleUserResize)
      // from running while we transition out of maximized state.
      resizingProgrammatically = true;
      try { win.unmaximize(); } catch { }
      if (target) {
        try { win.setBounds(target); } catch { }
        baseContentWidth = target.width;
        baseContentHeight = target.height;
        baseOuterWidth = target.width;
        baseOuterHeight = target.height;
        userModeSizes.window = { width: target.width, height: target.height };
      }
      setImmediate(() => { resizingProgrammatically = false; });
      preMaximizeBounds = null;
    } else {
      try {
        const b = win.getBounds();
        preMaximizeBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      } catch { preMaximizeBounds = null; }
      try { win.maximize(); } catch { }
    }
  } catch { }
}

export function overlayIsMaximized(): boolean {
  if (!win || win.isDestroyed()) return false;
  try { return win.isMaximized(); } catch { return false; }
}

export function setOverlayMode(mode: OverlayMode) {
  const prevMode = currentMode;
  if (prevMode === 'window' && mode !== 'window' && win && !win.isDestroyed()) {
    try { if (win.isMaximized()) win.unmaximize(); } catch { }
  }
  if (prevMode === mode && mode !== 'sidebar') {
    // No-op: mode didn't change and there is nothing special to redo for
    // compact/window. (Sidebar is special because re-entering it should
    // re-snap the split layout.)
    return;
  }
  currentMode = mode;

  applyOverlayChrome(mode);

  // Close internal sidebar when switching modes to reset width properly
  if (internalSidebarOpen) {
    internalSidebarOpen = false;
    // Reset userModeSizes for current mode to remove expanded width
    if (prevMode !== 'sidebar' && userModeSizes[prevMode]) {
      const currentWidth = userModeSizes[prevMode].width;
      // If width seems expanded (larger than default + some buffer), reset to default
      if (currentWidth > DEFAULT_MODE_SIZES[prevMode].width + 100) {
        userModeSizes[prevMode] = { ...DEFAULT_MODE_SIZES[prevMode] };
      }
    }
    try {
      win?.webContents.send('overlay:internalSidebarChanged', { open: false, width: 0 });
    } catch { }
  }

  if (prevMode === 'sidebar' && mode !== 'sidebar' && lastSplitTarget) {
    restoreWindowSnapshot(lastSplitTarget);
    lastSplitTarget = null;
  }

  // Update min/max constraints once for the new mode. setOverlaySize used to
  // re-apply these on a timeout, which caused two passes of native constraint
  // updates per mode change.
  updateSizeConstraints(mode);

  if (mode === "sidebar") {
    const { workArea } = screen.getPrimaryDisplay();
    // Sidebar: Take ~35% of screen width (not equal split - more room for active window)
    const sidebarWidth = Math.round(workArea.width * 0.35);
    const h = workArea.height;

    // Tell the renderer about the upcoming layout BEFORE we resize the
    // native window so its DOM can update in parallel with the resize.
    try { win?.webContents.send('overlay:modeChanged', { mode, width: sidebarWidth, height: h, prevMode }); } catch { }

    // Split-screen: use the last active window handle if available, otherwise capture.
    try {
      const { execFile } = require('child_process');
      const activeWindowWidth = workArea.width - sidebarWidth;
      const tmpDir = require('os').tmpdir();

      const overlayHandle = getNativeWindowHandleString(win);
      logger.info('Overlay window handle:', overlayHandle);
      logger.info('Last active window handle:', lastActiveWindowHandle);

      let capturedHandle = lastActiveWindowHandle;
      if (!capturedHandle || (overlayHandle && capturedHandle === overlayHandle)) {
        capturedHandle = captureForegroundWindowHandle([
          overlayHandle,
          getNativeWindowHandleString(onboardingWin),
        ]);
        if (capturedHandle) lastActiveWindowHandle = capturedHandle;
      }
      if (capturedHandle) {
        logger.info('Using foreground window handle for split-screen:', capturedHandle);
      }

      if (capturedHandle && capturedHandle !== '0') {
        lastSplitTarget = captureWindowSnapshotByHandle(capturedHandle);
      } else {
        lastSplitTarget = null;
      }

      // Now position Stuard on the right side
      const sidebarX = workArea.x + workArea.width - sidebarWidth;
      win?.setBounds({ x: sidebarX, y: workArea.y, width: sidebarWidth, height: h });
      setOverlaySize(sidebarWidth, h, false);

      // Step 2: Resize the captured window to the left side
      if (capturedHandle && capturedHandle !== '0') {
        logger.info('Resizing window with handle:', capturedHandle, 'to', activeWindowWidth, 'x', h, 'at', workArea.x, workArea.y);
        const resizeScript = path.join(tmpDir, 'stuard_split.ps1');
        const resizePsScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Split {
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
}
"@
$targetWindow = [IntPtr]${capturedHandle}
if ($targetWindow -ne 0) {
  $root = [Win32Split]::GetAncestor($targetWindow, 2)
  if ($root -ne 0) { $targetWindow = $root }
  $len = [Win32Split]::GetWindowTextLength($targetWindow)
  $title = ""
  if ($len -gt 0) {
    $sb = New-Object System.Text.StringBuilder ($len + 1)
    [Win32Split]::GetWindowText($targetWindow, $sb, $sb.Capacity) | Out-Null
    $title = $sb.ToString()
  }
  Write-Output "SplitTargetHandle=$($targetWindow.ToInt64())"
  Write-Output "SplitTargetTitle=$title"
  Write-Output "SplitTargetIsMaximized=$([Win32Split]::IsZoomed($targetWindow))"
  if ([Win32Split]::IsIconic($targetWindow) -or [Win32Split]::IsZoomed($targetWindow)) {
    [Win32Split]::ShowWindow($targetWindow, 9)
  }
  $result = [Win32Split]::SetWindowPos($targetWindow, [IntPtr]::Zero, ${workArea.x}, ${workArea.y}, ${activeWindowWidth}, ${h}, 0x14)
  Write-Output "SplitSetWindowPos=$result"
}
`;
        fs.writeFileSync(resizeScript, resizePsScript, 'utf8');

        execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resizeScript], (error: any, stdout: string, stderr: string) => {
          const trimmedOut = (stdout || '').trim();
          const trimmedErr = (stderr || '').trim();
          if (trimmedOut) {
            logger.info('Split-screen target info:', trimmedOut);
          }
          if (trimmedErr) {
            logger.warn('Split-screen stderr:', trimmedErr);
          }
          if (error) {
            logger.warn('Failed to resize active window for split-screen:', error.message);
          } else {
            logger.info('Split-screen layout applied successfully');
          }
          try { fs.unlinkSync(resizeScript); } catch { }
        });
      } else {
        // No window to resize, just position Stuard
        logger.info('No active window to split with, just positioning sidebar');
      }
    } catch (err) {
      logger.warn('Error applying split-screen:', err);
      // Still position Stuard even if split fails
      const sidebarX = workArea.x + workArea.width - sidebarWidth;
      win?.setBounds({ x: sidebarX, y: workArea.y, width: sidebarWidth, height: h });
      setOverlaySize(sidebarWidth, h, false);
    }
    return;
  }

  // Use user-preferred size for this mode, or fall back to defaults
  let { width, height } = userModeSizes[mode] || DEFAULT_MODE_SIZES[mode];

  // Ensure within constraints (maxW/maxH of 0 means "no maximum")
  const constraints = MODE_SIZE_CONSTRAINTS[mode];
  const maxW = constraints.maxW > 0 ? constraints.maxW : width;
  const maxH = constraints.maxH > 0 ? constraints.maxH : height;
  width = Math.max(constraints.minW, Math.min(maxW, width));
  height = Math.max(constraints.minH, Math.min(maxH, height));

  // Notify the renderer FIRST so it can start swapping its DOM (compact
  // <-> window) in parallel with the native bounds change. If we resize
  // the BrowserWindow before the renderer has switched mode the user sees
  // the wrong UI clipped to the new size for a frame, which reads as a
  // glitch. Sending the IPC first lets both happen on the same frame.
  try { win?.webContents.send('overlay:modeChanged', { mode, width, height, prevMode }); } catch { }

  setOverlaySize(width, height, true);
}

// Get current mode
export function getOverlayMode() {
  return currentMode;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function compactMovementYBounds(workArea: Electron.Rectangle, lockedH: number, anchor = compactResizeAnchor) {
  const visibleMoveH = MODE_SIZE_CONSTRAINTS.compact.minH;
  if (anchor === 'bottom') {
    return {
      minY: workArea.y - Math.max(0, lockedH - visibleMoveH),
      maxY: workArea.y + workArea.height - lockedH,
    };
  }
  return {
    minY: workArea.y,
    maxY: workArea.y + workArea.height - visibleMoveH,
  };
}

// Coalesce many tiny moves (e.g. Ctrl+Arrow at 60fps from renderer) into a
// single native setPosition per UI frame. Each setPosition is a synchronous
// Windows API call; firing 60+ per second can stutter, so we accumulate the
// requested delta and flush it once per ~16 ms.
let pendingMoveDx = 0;
let pendingMoveDy = 0;
let moveFlushScheduled = false;
function flushPendingMove() {
  moveFlushScheduled = false;
  if (!win || win.isDestroyed() || !win.isVisible()) {
    pendingMoveDx = 0;
    pendingMoveDy = 0;
    return;
  }
  const dx = pendingMoveDx;
  const dy = pendingMoveDy;
  pendingMoveDx = 0;
  pendingMoveDy = 0;
  if (dx === 0 && dy === 0) return;
  // Mark this as a programmatic resize so the resize listener doesn't
  // call handleUserResize and overwrite our baseline. Without this, DPI
  // rounding in setBounds drifts the size by 1-2px per move; the resize
  // event then reads the drifted size and saves it as the new baseline,
  // so the window grows by a pixel or two on every Ctrl+Arrow frame.
  resizingProgrammatically = true;
  try {
    const outer = win.getBounds();
    const display = screen.getDisplayMatching({ x: outer.x, y: outer.y, width: outer.width, height: outer.height });
    const wa = display.workArea;
    // Lock the outer width/height to the baseline. setPosition on a
    // transparent frameless Electron window with useContentSize:true can
    // drift width by 1-2px per call due to DPI rounding, so we go through
    // setBounds with explicit size to keep the window stable while moving.
    const lockedW = baseOuterWidth || outer.width;
    const lockedH = baseOuterHeight || outer.height;
    const targetOuterX = clamp(outer.x + dx, wa.x, wa.x + wa.width - lockedW);
    // Compact mode often uses a tall transparent canvas so dropdowns can open
    // above/below the pill without resizing on every keystroke. Movement
    // should clamp the visible pill, not the whole transparent canvas; otherwise
    // Ctrl+Up gets stuck while hundreds of invisible pixels are still on-screen.
    let minY = wa.y;
    let maxY = wa.y + wa.height - lockedH;
    if (currentMode === 'compact') {
      ({ minY, maxY } = compactMovementYBounds(wa, lockedH));
    }
    const targetOuterY = clamp(outer.y + dy, minY, maxY);
    if (targetOuterX === outer.x && targetOuterY === outer.y && outer.width === lockedW && outer.height === lockedH) return;
    win.setBounds({ x: targetOuterX, y: targetOuterY, width: lockedW, height: lockedH });
  } catch { }
  finally {
    // Release the flag on the next tick — after the synchronous setBounds
    // returns, the resize event hasn't fired yet. setImmediate runs after
    // the resize event listener so the flag is still set when it checks.
    setImmediate(() => { resizingProgrammatically = false; });
  }
}

export function moveOverlayBy(dx: number, dy: number) {
  if (!win || win.isDestroyed()) return;
  pendingMoveDx += dx;
  pendingMoveDy += dy;
  if (moveFlushScheduled) return;
  moveFlushScheduled = true;
  // setImmediate is the fastest available in main process and lets multiple
  // queued IPC messages from the renderer coalesce into a single setPosition.
  setImmediate(flushPendingMove);
}

export function setOverlayBounds(bounds: { x?: number; y?: number; width?: number; height?: number; anchor?: 'top' | 'bottom' }) {
  if (!win) return;
  resizingProgrammatically = true;
  try {
    const current = win.getBounds();
    if (currentMode === 'compact' && bounds.anchor) {
      compactResizeAnchor = bounds.anchor;
    }
    const { anchor, ...boundsPatch } = bounds;
    const target = { ...current, ...boundsPatch };

    // Update baselines if size changes (essential for keeping lock on future moves)
    if (bounds.width !== undefined) {
      baseContentWidth = bounds.width;
      baseOuterWidth = bounds.width;
    }
    if (bounds.height !== undefined) {
      baseContentHeight = bounds.height;
      baseOuterHeight = bounds.height;
    }

    if (currentMode === 'compact') {
      try {
        const display = screen.getDisplayMatching(target);
        const { minY, maxY } = compactMovementYBounds(display.workArea, target.height, compactResizeAnchor);
        target.y = clamp(target.y, minY, maxY);
      } catch { }
    }

    win.setBounds(target);
  } finally {
    setTimeout(() => { resizingProgrammatically = false; }, 0);
  }
}

/**
 * Toggle internal sidebar - expands/contracts overlay window width
 * This keeps sidebar as part of the main overlay window (not a separate window)
 */
export function toggleInternalSidebar(open?: boolean, panelWidth?: number): { open: boolean; width: number; panelWidth: number } {
  const shouldOpen = typeof open === 'boolean' ? open : !internalSidebarOpen;
  if (typeof panelWidth === 'number' && Number.isFinite(panelWidth)) {
    internalSidebarPanelWidth = clampInternalSidebarPanelWidth(panelWidth);
  }

  if (!win || win.isDestroyed()) {
    internalSidebarOpen = shouldOpen;
    return { open: shouldOpen, width: 0, panelWidth: internalSidebarPanelWidth };
  }

  const current = win.getBounds();
  const display = screen.getDisplayMatching(current);
  const workArea = display.workArea;

  resizingProgrammatically = true;

  try {
    if (shouldOpen && !internalSidebarOpen) {
      // Opening sidebar - expand width
      const newWidth = Math.min(current.width + internalSidebarPanelWidth, workArea.width - 40);

      // Adjust x position if expanding would go off-screen
      let newX = current.x;
      if (current.x + newWidth > workArea.x + workArea.width) {
        newX = Math.max(workArea.x, workArea.x + workArea.width - newWidth);
      }

      win.setBounds({ x: newX, y: current.y, width: newWidth, height: current.height });
      baseContentWidth = newWidth;
      baseOuterWidth = newWidth;

      // Update max width constraint to allow the expanded size.
      // (maxW/maxH of 0 means "no max" so we keep that behavior in window mode.)
      const constraints = MODE_SIZE_CONSTRAINTS[currentMode];
      try {
        const expandedMaxW = constraints.maxW > 0 ? Math.max(constraints.maxW, newWidth + 100) : 0;
        win.setMaximumSize(expandedMaxW, constraints.maxH);
      } catch { }

    } else if (!shouldOpen && internalSidebarOpen) {
      // Closing sidebar - contract width
      const newWidth = Math.max(current.width - internalSidebarPanelWidth, MODE_SIZE_CONSTRAINTS[currentMode].minW);

      win.setBounds({ x: current.x, y: current.y, width: newWidth, height: current.height });
      baseContentWidth = newWidth;
      baseOuterWidth = newWidth;

      // Update userModeSizes to the contracted width so mode switches use correct size
      if (currentMode !== 'sidebar') {
        userModeSizes[currentMode] = { width: newWidth, height: current.height };
      }

      // Restore normal max width constraint
      const constraints = MODE_SIZE_CONSTRAINTS[currentMode];
      try {
        win.setMaximumSize(constraints.maxW, constraints.maxH);
      } catch { }
    }

    internalSidebarOpen = shouldOpen;

    // Notify renderer of the change
    try {
      win.webContents.send('overlay:internalSidebarChanged', {
        open: internalSidebarOpen,
        width: win.getBounds().width,
        panelWidth: internalSidebarPanelWidth,
      });
    } catch { }

  } finally {
    setTimeout(() => { resizingProgrammatically = false; }, 0);
  }

  return { open: internalSidebarOpen, width: win.getBounds().width, panelWidth: internalSidebarPanelWidth };
}

export function resizeInternalSidebar(panelWidth: number): { width: number; panelWidth: number } {
  const clamped = clampInternalSidebarPanelWidth(panelWidth);

  if (!win || win.isDestroyed()) {
    internalSidebarPanelWidth = clamped;
    return { width: 0, panelWidth: clamped };
  }

  if (!internalSidebarOpen) {
    internalSidebarPanelWidth = clamped;
    return { width: win.getBounds().width, panelWidth: clamped };
  }

  const delta = clamped - internalSidebarPanelWidth;
  if (delta === 0) {
    return { width: win.getBounds().width, panelWidth: clamped };
  }

  const current = win.getBounds();
  const display = screen.getDisplayMatching(current);
  const workArea = display.workArea;
  const constraints = MODE_SIZE_CONSTRAINTS[currentMode];

  resizingProgrammatically = true;

  try {
    let newWidth = current.width + delta;
    const maxW = constraints.maxW > 0 ? constraints.maxW : workArea.width - 40;
    newWidth = Math.max(constraints.minW, Math.min(maxW, newWidth));

    const appliedDelta = newWidth - current.width;
    if (appliedDelta === 0) {
      return { width: current.width, panelWidth: internalSidebarPanelWidth };
    }

    let newX = current.x;
    if (newX + newWidth > workArea.x + workArea.width) {
      newX = Math.max(workArea.x, workArea.x + workArea.width - newWidth);
    }

    win.setBounds({ x: newX, y: current.y, width: newWidth, height: current.height });
    baseContentWidth = newWidth;
    baseOuterWidth = newWidth;
    internalSidebarPanelWidth = clampInternalSidebarPanelWidth(internalSidebarPanelWidth + appliedDelta);

    try {
      win.webContents.send('overlay:internalSidebarChanged', {
        open: true,
        width: newWidth,
        panelWidth: internalSidebarPanelWidth,
      });
    } catch { }

    return { width: newWidth, panelWidth: internalSidebarPanelWidth };
  } finally {
    setTimeout(() => { resizingProgrammatically = false; }, 0);
  }
}

export function getInternalSidebarState(): { open: boolean; panelWidth: number } {
  return { open: internalSidebarOpen, panelWidth: internalSidebarPanelWidth };
}

export function isAnyAppWindowFocused(): boolean {
  // Use Electron's focused-window lookup so EVERY Stuard window counts —
  // main/window mode, dashboard, workflows, sidebar, spaces, onboarding, board
  // windows, etc. — without having to maintain an explicit list. The only
  // window we exclude is the notification overlay itself (it's shown inactive
  // and never takes focus, but guard against it just in case).
  try {
    const focused = BrowserWindow.getFocusedWindow();
    if (!focused || focused.isDestroyed()) return false;
    if (notificationWin && !notificationWin.isDestroyed() && focused === notificationWin) return false;
    return true;
  } catch {
    return false;
  }
}

export function registerGlobalShortcuts() {
  logger.info("Registering global shortcuts...");

  // Get the stored hotkey or use default
  const storedHotkey = getGlobalHotkey();
  logger.info(`Using stored hotkey: ${storedHotkey}`);

  // Unregister any existing shortcuts first
  const existingAccels = [
    "Control+Space", "Ctrl+Space", "Control+Shift+Space", "Ctrl+Shift+Space",
    "CommandOrControl+Shift+Space", "Alt+Space", "Command+Space"
  ];
  for (const a of existingAccels) {
    try { globalShortcut.unregister(a); } catch { }
  }

  // Also unregister the old legacy shortcut just in case.
  try { globalShortcut.unregister("Control+Alt+Space"); } catch { }

  let registered = false;

  // The globalShortcut press handler is intentionally a no-op: tap vs. hold
  // is decided by the uiohook-based hold detector below. We still call
  // globalShortcut.register so the accelerator is consumed (not delivered to
  // the focused app). On Windows, low-level keyboard hooks (uiohook) still
  // observe both keydown and keyup even when the key is consumed.
  let activeAccel: string | null = null;

  // Try to register the stored hotkey first
  try {
    if (globalShortcut.isRegistered(storedHotkey)) {
      logger.warn(`Stored hotkey ${storedHotkey} is already registered by another application.`);
    } else {
      const success = globalShortcut.register(storedHotkey, () => {
        // No-op â€” uiohook hold-detector handles tap (release < 280ms) and hold.
      });

      if (success) {
        logger.info(`Stored hotkey ${storedHotkey} registered successfully.`);
        registered = true;
        activeAccel = storedHotkey;
      } else {
        logger.warn(`Failed to register stored hotkey ${storedHotkey}`);
      }
    }
  } catch (e) {
    logger.warn(`Exception registering stored hotkey ${storedHotkey}:`, e);
  }

  // If stored hotkey failed, fall back to defaults
  if (!registered) {
    const fallbackAccels = [
      "Control+Space", "Ctrl+Space", "Control+Shift+Space",
      "Ctrl+Shift+Space", "CommandOrControl+Shift+Space"
    ];

    for (const a of fallbackAccels) {
      try {
        if (globalShortcut.isRegistered(a)) {
          logger.warn(`Fallback shortcut ${a} is already registered.`);
          continue;
        }

        const success = globalShortcut.register(a, () => {
          // No-op â€” uiohook hold-detector handles tap and hold.
        });

        if (success) {
          logger.info(`Fallback shortcut ${a} registered successfully.`);
          registered = true;
          activeAccel = a;
          break; // Stop after first successful registration
        }
      } catch (e) {
        logger.warn(`Exception registering ${a}:`, e);
      }
    }
  }

  // Initialize hold-to-voice on the active accelerator (tap = summon, hold = voice).
  if (activeAccel) {
    try {
      initOverlayHotkey({
        accelerator: activeAccel,
        onTap: () => {
          logger.info("Hotkey TAP:", activeAccel);
          handleOverlayHotkey();
        },
        onHoldStart: () => {
          logger.info("Hotkey HOLD: toggle voice mode");
          // Voice mode now lives in its own full-screen border window; do not
          // pop the compact overlay on hold. Just send the toggle request to
          // the main window's renderer (it owns the voice hook).
          try {
            if (win && !win.isDestroyed()) {
              try { win.webContents.send("voice:setActive", true); } catch (e) { logger.warn("voice:setActive toggle send failed", e); }
            }
          } catch (e) { logger.warn("HOLD handler failed", e); }
        },
        onHoldEnd: () => {
          // No-op: release no longer toggles voice (hold-to-toggle semantics).
        },
      });
    } catch (e) {
      logger.warn("Failed to initialize overlay hold-to-voice:", e);
    }
  }

  if (!registered) {
    logger.error("Failed to register ANY overlay shortcut!");
  }

  logger.info("Global shortcuts registration complete");
}

function getTrayIconImage(): Electron.NativeImage {
  const appPath = (() => { try { return app?.getAppPath?.() || ""; } catch { return ""; } })();
  const filenames = process.platform === "win32" ? ["icon.ico", "icon2.png"] : ["icon2.png", "icon.ico"];
  const baseDirs = [
    process.resourcesPath || "",
    path.join(__dirname, "..", "..", "icons"),
    appPath ? path.join(appPath, "icons") : "",
  ].filter(Boolean);

  for (const dir of baseDirs) {
    for (const name of filenames) {
      try {
        const iconPath = path.join(dir, name);
        if (!fs.existsSync(iconPath)) continue;
        const img = nativeImage.createFromPath(iconPath);
        if (img.isEmpty()) continue;
        const size = process.platform === "win32" ? 16 : 18;
        return img.resize({ width: size, height: size, quality: "best" });
      } catch { }
    }
  }

  if (APP_ICON_PATH) {
    try {
      const img = nativeImage.createFromPath(APP_ICON_PATH);
      if (!img.isEmpty()) {
        return img.resize({ width: 16, height: 16, quality: "best" });
      }
    } catch { }
  }

  logger.warn("Tray icon not found; using fallback");
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIUlEQVQ4T2NkYGD4z0ABYBxVSFUBqGqAagAA0Q8B5X9R8QAAAABJRU5ErkJggg==",
  ).resize({ width: 16, height: 16 });
}

function getActiveThemeMode(): TrayThemeMode {
  const raw = String(loadSettings().themeMode || "light").toLowerCase();
  if (raw === "dark" || raw === "custom") return "dark";
  return "light";
}

function applyThemeFromTray(mode: TrayThemeMode) {
  setRendererPrefs({ themeMode: mode });
  const payload: Record<string, string> = { themeMode: mode };
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send("prefs:themeUpdated", payload); } catch { }
  }
}

export function createTray() {
  if (tray && !tray.isDestroyed()) {
    try { tray.destroy(); } catch { }
    tray = null;
  }

  const image = getTrayIconImage();
  tray = new Tray(image);
  tray.setToolTip(`Stuard AI v${app.getVersion()}`);
  initTrayMenu({
    getOverlayVisible: () => !!(win && !win.isDestroyed() && win.isVisible()),
    toggleWindow,
    openDashboard: openDashboardWindow,
    openWorkflows: openWorkflowsWindow,
    applyTheme: applyThemeFromTray,
    getThemeMode: getActiveThemeMode,
  });

  tray.on("click", toggleWindow);
  tray.on("right-click", () => {
    if (tray && !tray.isDestroyed()) {
      try { showTrayMenu(tray); } catch (e) { logger.warn("Tray menu failed", e); }
    }
  });
}

// Movement shortcuts when window is not focused
let moveTimer: any = null;
let lastMoveTs = 0;
const pressedUntil = { ctrl: 0, shift: 0, left: 0, right: 0, up: 0, down: 0 };
const KEY_TTL_MS = 130;

function clearMoveTimer() {
  if (moveTimer != null) {
    try { clearInterval(moveTimer); } catch { }
    moveTimer = null;
    lastMoveTs = 0;
  }
}

function ensureMoveTimer() {
  if (moveTimer != null) return;
  lastMoveTs = Date.now();
  moveTimer = setInterval(() => {
    if (!win || !win.isVisible() || win.isFocused()) { clearMoveTimer(); return; }
    const now = Date.now();
    const dt = (now - lastMoveTs) / 1000;
    lastMoveTs = now;
    const ctrl = pressedUntil.ctrl > now;
    const shift = pressedUntil.shift > now;
    const left = pressedUntil.left > now;
    const right = pressedUntil.right > now;
    const up = pressedUntil.up > now;
    const down = pressedUntil.down > now;
    let vx = 0, vy = 0;
    if (left) vx -= 1;
    if (right) vx += 1;
    if (up) vy -= 1;
    if (down) vy += 1;
    if (ctrl && (vx !== 0 || vy !== 0)) {
      const speed = shift ? 1500 : 900;
      const len = Math.hypot(vx, vy) || 1;
      vx /= len; vy /= len;
      const dx = Math.round(vx * speed * dt);
      const dy = Math.round(vy * speed * dt);
      if (dx !== 0 || dy !== 0) moveOverlayBy(dx, dy);
    } else {
      if (!left && !right && !up && !down && !shift && !ctrl) clearMoveTimer();
    }
  }, 16);
}

function markPressed(state: { ctrl?: boolean; shift?: boolean; left?: boolean; right?: boolean; up?: boolean; down?: boolean; }) {
  const now = Date.now();
  if (state.ctrl) pressedUntil.ctrl = now + KEY_TTL_MS;
  if (state.shift) pressedUntil.shift = now + KEY_TTL_MS;
  if (state.left) pressedUntil.left = now + KEY_TTL_MS;
  if (state.right) pressedUntil.right = now + KEY_TTL_MS;
  if (state.up) pressedUntil.up = now + KEY_TTL_MS;
  if (state.down) pressedUntil.down = now + KEY_TTL_MS;
  ensureMoveTimer();
}

function unregisterMoveShortcuts() {
  const accels = [
    "Control+Left",
    "Control+Right",
    "Control+Up",
    "Control+Down",
    "Control+Shift+Left",
    "Control+Shift+Right",
    "Control+Shift+Up",
    "Control+Shift+Down",
  ];
  for (const a of accels) {
    try { globalShortcut.unregister(a); } catch { }
  }
}

function registerMoveShortcuts() {
  if (!win) return;
  if (!win.isVisible()) return;
  if (win.isFocused()) return;
  unregisterMoveShortcuts();
  const registerMove = (accel: string, state: { ctrl?: boolean; shift?: boolean; left?: boolean; right?: boolean; up?: boolean; down?: boolean; }) => {
    try {
      globalShortcut.register(accel, () => {
        if (!win) return;
        if (!win.isVisible()) return;
        if (win.isFocused()) return;
        markPressed(state);
      });
    } catch { }
  };
  registerMove("Control+Left", { ctrl: true, left: true });
  registerMove("Control+Right", { ctrl: true, right: true });
  registerMove("Control+Up", { ctrl: true, up: true });
  registerMove("Control+Down", { ctrl: true, down: true });
  registerMove("Control+Shift+Left", { ctrl: true, shift: true, left: true });
  registerMove("Control+Shift+Right", { ctrl: true, shift: true, right: true });
  registerMove("Control+Shift+Up", { ctrl: true, shift: true, up: true });
  registerMove("Control+Shift+Down", { ctrl: true, shift: true, down: true });
}

// Canvas/Board windows management
const boardWindows = new Map<string, BrowserWindow>();
const boardStates = new Map<string, any>();

export function createBoardWindow(item: any) {
  const id = String(item?.id || '').trim();
  if (!id) return;
  // If exists, update instead
  if (boardWindows.has(id)) {
    updateBoardWindow(item);
    return;
  }
  const pos = item?.position || {};
  const size = item?.size || {};
  const width = Math.max(240, Number(size.width || 360));
  const height = Math.max(180, Number(size.height || 240));
  const w = new BrowserWindow({
    width,
    height,
    show: true,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    minimizable: false,
    icon: APP_ICON_PATH,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    useContentSize: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev,
    },
    backgroundColor: "#00000000",
  });
  w.setMenu(null);
  // Hide from alt-tab on Windows by setting tool window style
  try { w.setAlwaysOnTop(true, 'pop-up-menu'); } catch { }
  // Position near specified coords or center-top
  try {
    if (pos && (typeof pos.x === 'number') && (typeof pos.y === 'number')) {
      const { workArea } = screen.getPrimaryDisplay();
      const bx = Math.round(pos.x);
      const by = Math.round(pos.y);
      w.setPosition(clamp(bx, workArea.x, workArea.x + workArea.width - width), clamp(by, workArea.y, workArea.y + workArea.height - height));
    } else {
      const { workArea } = screen.getPrimaryDisplay();
      const x = Math.round(workArea.x + (workArea.width - width) / 2);
      const y = Math.round(workArea.y + workArea.height * 0.18);
      w.setPosition(x, y);
    }
  } catch { }
  if (isDev) {
    w.loadURL(getRendererUrl('board'));
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/board.html"),
      path.join(__dirname, "../../renderer/board.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        w.loadFile(p);
        break;
      }
    }
  }
  w.on('closed', () => {
    try { boardWindows.delete(id); } catch { }
  });
  boardWindows.set(id, w);
  try { boardStates.set(id, { ...(boardStates.get(id) || {}), ...item }); } catch { }
  // Send initial data once DOM is ready
  try {
    w.webContents.on('did-finish-load', () => {
      try { w.webContents.send('board:init', item); } catch { }
    });
  } catch { }
}

export function updateBoardWindow(item: any) {
  const id = String(item?.id || '').trim();
  if (!id) return;
  const w = boardWindows.get(id);
  if (!w || w.isDestroyed()) return;
  const pos = item?.position || {};
  const size = item?.size || {};
  try {
    const bounds = w.getBounds();
    const width = clamp(Number(size?.width || bounds.width), 180, 3000);
    const height = clamp(Number(size?.height || bounds.height), 120, 3000);
    let x = bounds.x;
    let y = bounds.y;
    if (typeof pos?.x === 'number') x = pos.x;
    if (typeof pos?.y === 'number') y = pos.y;
    const display = screen.getDisplayMatching({ x, y, width, height });
    const wa = display.workArea;
    const targetX = clamp(x, wa.x, wa.x + wa.width - width);
    const targetY = clamp(y, wa.y, wa.y + wa.height - height);
    w.setBounds({ x: targetX, y: targetY, width, height });
  } catch { }
  try { w.webContents.send('board:update', item); } catch { }
  try { boardStates.set(id, { ...(boardStates.get(id) || {}), ...item }); } catch { }
}

export function deleteBoardWindow(id: string) {
  const w = boardWindows.get(id);
  if (w && !w.isDestroyed()) {
    try { w.close(); } catch { }
  }
  try { boardWindows.delete(id); } catch { }
  try { boardStates.delete(id); } catch { }
}

export function showBoardWindow(id: string) {
  const w = boardWindows.get(id);
  try { w?.show(); w?.focus(); w?.moveTop(); } catch { }
}

export function hideBoardWindow(id: string) {
  const w = boardWindows.get(id);
  try { w?.hide(); } catch { }
}

export function focusBoardWindow(id: string) {
  const w = boardWindows.get(id);
  try { w?.show(); w?.focus(); w?.moveTop(); } catch { }
}

export function clearBoardWindows() {
  try {
    for (const [id, w] of boardWindows) {
      try { w.close(); } catch { }
    }
    boardWindows.clear();
    boardStates.clear();
  } catch { }
}

export function listBoardWindows() {
  try { return Array.from(boardStates.values()); } catch { return []; }
}

export function getNotificationWindow() {
  return notificationWin;
}

export function getMainWindow() {
  return win;
}

// Track global screen capture invisibility state
let screenCaptureInvisibleEnabled = false;

function shouldProtectWindow(w: BrowserWindow): boolean {
  if (w === win) return false;
  return screenCaptureInvisibleEnabled;
}

function applyOverlayContentProtection() {
  if (win && !win.isDestroyed()) {
    try { win.setContentProtection(false); } catch {}
  }
}

function applyContentProtectionToAllWindows() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w && !w.isDestroyed()) {
      try { w.setContentProtection(shouldProtectWindow(w)); } catch {}
    }
  }
}

export function getScreenCaptureInvisible(): boolean {
  return screenCaptureInvisibleEnabled;
}

export function setScreenCaptureInvisible(enabled: boolean) {
  screenCaptureInvisibleEnabled = enabled;
  applyContentProtectionToAllWindows();
  logger.info(`Screen capture invisibility ${enabled ? 'enabled' : 'disabled'} for all windows`);
}

/**
 * Capture the primary display while every Stuard window is excluded from the
 * frame. Temporarily forces content-protection (WDA_EXCLUDEFROMCAPTURE on
 * Windows) on all Stuard windows — including the always-on-top compact overlay,
 * which is normally capturable — so the screenshot shows only what sits *behind*
 * the app, then restores each window to its configured protection state.
 *
 * This is the "content policy" trick used by the compact-mode Ctrl+Shift+Enter
 * shortcut: snap the screen without Stuard appearing in it, then send it.
 */
export async function captureScreenExcludingStuard(): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  const windows = BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed());
  try {
    for (const w of windows) {
      try { w.setContentProtection(true); } catch {}
    }
    // Give DWM a frame or two to apply the exclusion before grabbing the
    // desktop — otherwise the overlay can bleed into the capture. Kept short
    // (~70ms ≈ 4 frames) so pressing the hotkey captures almost immediately.
    await new Promise((resolve) => setTimeout(resolve, 70));

    const primary = screen.getPrimaryDisplay();
    const scale = primary.scaleFactor || 1;
    // desktopCapturer renders a full bitmap of the display, and its cost scales
    // with the requested pixel count — at 4K/hi-DPI a native-res grab can take
    // 1-3s, which is the bulk of the hotkey→thumbnail latency. Cap the long edge
    // to ~1920px so the grab is near-instant while staying sharp enough to read
    // on-screen text. (DIP size already drops the device-pixel-ratio blowup.)
    const nativeW = Math.round(primary.size.width * scale);
    const nativeH = Math.round(primary.size.height * scale);
    const MAX_EDGE = 1920;
    const capScale = Math.min(1, MAX_EDGE / Math.max(nativeW, nativeH, 1));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(1, Math.round(nativeW * capScale)),
        height: Math.max(1, Math.round(nativeH * capScale)),
      },
    });
    const source =
      sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
    const dataUrl = source?.thumbnail && !source.thumbnail.isEmpty()
      ? source.thumbnail.toDataURL()
      : null;
    if (!dataUrl) return { ok: false, error: 'no_capture_source' };
    return { ok: true, dataUrl };
  } catch (e: any) {
    logger.warn('[window] captureScreenExcludingStuard failed', e);
    return { ok: false, error: String(e?.message || 'capture_failed') };
  } finally {
    // Restore each window to its configured protection (global flag / overlay
    // stays unprotected as before).
    applyContentProtectionToAllWindows();
  }
}

export function startOverlayScreenSnip() {
  applyOverlayContentProtection();
  try {
    void shell.openExternal("ms-screenclip:");
  } catch (error) {
    logger.warn("Failed to launch Windows screen snip", error);
  }

  return { ok: true, enabled: false, restoreDelay: 0 };
}

export function openNotificationWindow() {
  if (notificationWin && !notificationWin.isDestroyed()) {
    // Should be invisible to interaction but visible for rendering
    // notificationWin.show(); 
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();

  // Create a full-screen transparent overlay
  notificationWin = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    icon: APP_ICON_PATH,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true, // Always on top for notifications
    type: 'toolbar', // Helps on some OSs to stay on top
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev,
    },
    backgroundColor: "#00000000",
  });

  // Make it click-through by default
  notificationWin.setIgnoreMouseEvents(true, { forward: true });
  notificationWin.setMenu(null);
  if (screenCaptureInvisibleEnabled) {
    try { notificationWin.setContentProtection(true); } catch {}
  }

  if (isDev) {
    notificationWin.loadURL(getRendererUrl("notification"));
  } else {
    // Load file
    const p = path.join(__dirname, "../renderer/notification.html");
    if (fs.existsSync(p)) {
      notificationWin.loadFile(p);
    } else {
      // Fallback
      const p2 = path.join(__dirname, "../../renderer/notification.html");
      notificationWin.loadFile(p2);
    }
  }

  notificationWin.once('ready-to-show', () => {
    notificationWin?.showInactive(); // Show without taking focus
  });

  notificationWin.on("closed", () => {
    notificationWin = null;
  });
}
