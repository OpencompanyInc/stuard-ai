
import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray, screen, powerMonitor } from "electron";
import path from "path";
import fs from "fs";
import { isDev } from "../env";
import logger from "../utils/logger";
import { getGlobalHotkey } from "../settings";
import { initOverlayHotkey } from "./overlay-hotkey";

let win: BrowserWindow | null = null;
let onboardingWin: BrowserWindow | null = null;
let workflowsWin: BrowserWindow | null = null;
let hudWin: BrowserWindow | null = null;
let sidebarWin: BrowserWindow | null = null;
let spacesWin: BrowserWindow | null = null; // Legacy alias
let dashboardWin: BrowserWindow | null = null;
let notificationWin: BrowserWindow | null = null;
let voiceTestWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let sidebarExpanded = false;

// Standalone sidebar window dimensions
const SIDEBAR_EXPANDED_WIDTH = 900;
const SIDEBAR_EXPANDED_HEIGHT = 700;

// Internal sidebar (rendered inside overlay window)
const INTERNAL_SIDEBAR_WIDTH = 320;

// Keep a stable record of the intended content size to prevent drift from DPI rounding
let baseContentWidth = 520;
let baseContentHeight = 100;
// Also keep the stable OUTER window size (pixel bounds) to fully lock size while moving
let baseOuterWidth = 0;
let baseOuterHeight = 0;
// When changing size programmatically (expand/collapse), temporarily disable the size lock
let resizingProgrammatically = false;

type OverlayMode = "compact" | "sidebar" | "window";
let currentMode: OverlayMode = "compact";

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
    getNativeWindowHandleString(spacesWin),
    getNativeWindowHandleString(hudWin),
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
  compact: { width: 520, height: 140 },  // Compact is a small pill-shaped input bar
  window: { width: 800, height: 600 },
};

// Min/max constraints per mode for user resizing
const MODE_SIZE_CONSTRAINTS = {
  compact: { minW: 400, maxW: 800, minH: 100, maxH: 800 },  // Increased to 800 to avoid cut-off
  sidebar: { minW: 400, maxW: 1100, minH: 400, maxH: 2000 },  // Allow for internal sidebar (320px)
  window: { minW: 500, maxW: 1400, minH: 400, maxH: 1000 },
};

// Track internal sidebar state for width management
let internalSidebarOpen = false;

// Track applied chrome state so we can skip redundant native calls.
// Each native chrome change can trigger a Windows DWM repaint and produce
// a visible flicker, so we only re-apply when something actually changed.
let appliedChrome: { alwaysOnTop: boolean; skipTaskbar: boolean; hasShadow: boolean } | null = null;
function applyOverlayChrome(mode: OverlayMode) {
  if (!win) return;
  const desired = mode === 'window'
    ? { alwaysOnTop: false, skipTaskbar: false, hasShadow: true }
    : { alwaysOnTop: true, skipTaskbar: true, hasShadow: false };
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
    appliedChrome = desired;
  } catch { }
}

function forceOverlayChrome() {
  if (!win) return;
  try {
    if (currentMode === 'window') {
      win.setAlwaysOnTop(false);
      win.setSkipTaskbar(false);
    } else {
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setSkipTaskbar(true);
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

export function getRendererUrl(entry: "index" | "dashboard" | "onboarding" | "board" | "workflows" | "hud-test" | "spaces" | "sidebar" | "notification" | "voicetest" = "index") {
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

  const now = Date.now();
  if (now - lastUserResizeTime < 100) return; // Debounce
  lastUserResizeTime = now;

  const b = win.getBounds();
  const constraints = MODE_SIZE_CONSTRAINTS[currentMode];

  // Clamp to constraints
  const width = Math.max(constraints.minW, Math.min(constraints.maxW, b.width));
  const height = Math.max(constraints.minH, Math.min(constraints.maxH, b.height));

  // Save user's preferred size for this mode (except sidebar which is special)
  // Subtract internal sidebar width if open, so we save the base content width
  if (currentMode !== 'sidebar') {
    const savedWidth = internalSidebarOpen ? Math.max(width - INTERNAL_SIDEBAR_WIDTH, constraints.minW) : width;
    userModeSizes[currentMode] = { width: savedWidth, height };
    // Persist to main process memory (could also use electron-store)
    baseContentWidth = savedWidth;
    baseContentHeight = height;
    baseOuterWidth = internalSidebarOpen ? savedWidth + INTERNAL_SIDEBAR_WIDTH : savedWidth;
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

  const clampedWidth = Math.max(constraints.minW, Math.min(constraints.maxW, b.width));
  const clampedHeight = Math.max(constraints.minH, Math.min(constraints.maxH, b.height));

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
    win.setMaximumSize(constraints.maxW, constraints.maxH);
  } catch { }
}

// Get current overlay size info for renderer
export function getOverlaySize() {
  if (!win) return { width: 520, height: 130, mode: 'compact' };
  const b = win.getBounds();
  return { width: b.width, height: b.height, mode: currentMode };
}

export function createWindow() {
  logger.info("Creating overlay window...");
  const WIDTH = 520;
  const HEIGHT = 140; // compact height by default

  const preloadPath = getPreloadPath();
  logger.info("Preload path:", preloadPath);
  logger.info("Preload exists:", fs.existsSync(preloadPath));

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true, // Enable user resizing
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
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
  if (screenCaptureInvisibleEnabled) {
    try { win.setContentProtection(true); } catch {}
  }
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

  // Keep overlay visible on focus changes; user controls visibility via hotkey or Escape
  // Prevent minimize to survive Win+D / Show Desktop
  win.on("minimize", (e: Electron.Event) => {
    e.preventDefault();
    win?.restore();
    win?.show();
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
          let width = Math.max(constraints.minW, Math.min(constraints.maxW, prefs.width));
          let height = Math.max(constraints.minH, Math.min(constraints.maxH, prefs.height));

          // If internal sidebar was open, add its width back
          if (internalSidebarOpen) {
            width = Math.min(width + INTERNAL_SIDEBAR_WIDTH, constraints.maxW + INTERNAL_SIDEBAR_WIDTH);
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

export function openWorkflowsWindow(options?: { marketplaceSlug?: string }) {
  const initialSlug = options?.marketplaceSlug || '';

  if (workflowsWin && !workflowsWin.isDestroyed()) {
    workflowsWin.show();
    workflowsWin.focus();
    workflowsWin.moveTop();
    if (initialSlug) {
      workflowsWin.webContents.send('workflows:navigate', { marketplaceSlug: initialSlug });
    }
    return;
  }
  const d = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: true,
    frame: false,
    transparent: false,
    resizable: true,
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
      devTools: true, // Enable devTools in production for debugging
    },
    backgroundColor: "#ffffff",
  });
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
  if (isDev) {
    const url = initialSlug
      ? `${getRendererUrl("workflows")}?marketplaceSlug=${encodeURIComponent(initialSlug)}`
      : getRendererUrl("workflows");
    d.loadURL(url);
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/workflows.html"),
      path.join(__dirname, "../../renderer/workflows.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        if (initialSlug) {
          d.loadFile(p, { query: { marketplaceSlug: initialSlug } });
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
export function openSidebarWindow(options?: { tab?: 'terminal' | 'todo'; expanded?: boolean }) {
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

export function toggleSidebarWindow(options?: { tab?: 'terminal' | 'todo'; expanded?: boolean }) {
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

// Legacy Spaces window — Spaces have been removed. No-op stubs kept for IPC
// surface compatibility; they simply open/close the sidebar (Todo tab).
export function openSpacesWindow() {
  openSidebarWindow({ tab: 'todo' });
}

export function closeSpacesWindow() {
  closeSidebarWindow();
}

export function toggleSpacesWindow() {
  toggleSidebarWindow({ tab: 'todo' });
}

// HUD Window - 3D Curved Launcher
export function openHudWindow() {
  if (hudWin && !hudWin.isDestroyed()) {
    hudWin.show();
    hudWin.focus();
    hudWin.moveTop();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const width = workArea.width;
  const height = 450; // Increased height for better 3D visibility

  hudWin = new BrowserWindow({
    width,
    height,
    x: workArea.x,
    y: workArea.y + workArea.height - height, // Position at bottom
    show: true,
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
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev,
    },
    backgroundColor: "#00000000",
  });
  hudWin.setMenu(null);
  hudWin.setIgnoreMouseEvents(false);

  // Try to set always on top with screen-saver level
  try { hudWin.setAlwaysOnTop(true, 'screen-saver'); } catch { }

  if (isDev) {
    hudWin.loadURL(getRendererUrl("hud-test"));
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/hud-test.html"),
      path.join(__dirname, "../../renderer/hud-test.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        hudWin.loadFile(p);
        break;
      }
    }
  }

  hudWin.on('closed', () => { hudWin = null; });
  hudWin.on('blur', () => {
    // Hide when focus is lost
    try { hudWin?.hide(); } catch { }
  });
}

export function hideHudWindow() {
  try { hudWin?.hide(); } catch { }
}

export function toggleHudWindow() {
  if (!hudWin || hudWin.isDestroyed()) {
    openHudWindow();
  } else if (hudWin.isVisible()) {
    hideHudWindow();
  } else {
    hudWin.show();
    hudWin.focus();
    hudWin.moveTop();
  }
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
  baseContentWidth = width;
  baseContentHeight = height;

  // Skip the native call entirely if the window is already at the target size
  // and position-anchor doesn't require a move. This avoids unnecessary DWM
  // repaints when toggling back to the same size.
  const current = win.getBounds();
  const sameSize = current.width === width && current.height === height;

  if (anchor === 'bottom') {
    // Frameless + useContentSize: outer bounds == content bounds, so dy is exact.
    const dy = height - current.height;
    const newY = current.y - dy;
    if (!sameSize || newY !== current.y) {
      win.setBounds({ x: current.x, y: newY, width, height });
    }
  } else {
    if (reposition || !win.isVisible()) {
      centerTopWithContentSize(win, width, height);
    } else if (!sameSize) {
      win.setContentSize(width, height);
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

export function setOverlayMode(mode: OverlayMode) {
  const prevMode = currentMode;
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
          getNativeWindowHandleString(spacesWin),
          getNativeWindowHandleString(hudWin),
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

  // Ensure within constraints
  const constraints = MODE_SIZE_CONSTRAINTS[mode];
  width = Math.max(constraints.minW, Math.min(constraints.maxW, width));
  height = Math.max(constraints.minH, Math.min(constraints.maxH, height));

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
    const targetOuterY = clamp(outer.y + dy, wa.y, wa.y + wa.height - lockedH);
    if (targetOuterX === outer.x && targetOuterY === outer.y && outer.width === lockedW && outer.height === lockedH) return;
    win.setBounds({ x: targetOuterX, y: targetOuterY, width: lockedW, height: lockedH });
  } catch { }
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

export function setOverlayBounds(bounds: { x?: number; y?: number; width?: number; height?: number }) {
  if (!win) return;
  resizingProgrammatically = true;
  try {
    const current = win.getBounds();
    const target = { ...current, ...bounds };

    // Update baselines if size changes (essential for keeping lock on future moves)
    if (bounds.width !== undefined) {
      baseContentWidth = bounds.width;
      baseOuterWidth = bounds.width;
    }
    if (bounds.height !== undefined) {
      baseContentHeight = bounds.height;
      baseOuterHeight = bounds.height;
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
export function toggleInternalSidebar(open?: boolean): { open: boolean; width: number } {
  const shouldOpen = typeof open === 'boolean' ? open : !internalSidebarOpen;

  if (!win || win.isDestroyed()) {
    internalSidebarOpen = shouldOpen;
    return { open: shouldOpen, width: 0 };
  }

  const current = win.getBounds();
  const display = screen.getDisplayMatching(current);
  const workArea = display.workArea;

  resizingProgrammatically = true;

  try {
    if (shouldOpen && !internalSidebarOpen) {
      // Opening sidebar - expand width
      const newWidth = Math.min(current.width + INTERNAL_SIDEBAR_WIDTH, workArea.width - 40);

      // Adjust x position if expanding would go off-screen
      let newX = current.x;
      if (current.x + newWidth > workArea.x + workArea.width) {
        newX = Math.max(workArea.x, workArea.x + workArea.width - newWidth);
      }

      win.setBounds({ x: newX, y: current.y, width: newWidth, height: current.height });
      baseContentWidth = newWidth;
      baseOuterWidth = newWidth;

      // Update max width constraint to allow the expanded size
      const constraints = MODE_SIZE_CONSTRAINTS[currentMode];
      try {
        win.setMaximumSize(Math.max(constraints.maxW, newWidth + 100), constraints.maxH);
      } catch { }

    } else if (!shouldOpen && internalSidebarOpen) {
      // Closing sidebar - contract width
      const newWidth = Math.max(current.width - INTERNAL_SIDEBAR_WIDTH, MODE_SIZE_CONSTRAINTS[currentMode].minW);

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
        width: win.getBounds().width
      });
    } catch { }

  } finally {
    setTimeout(() => { resizingProgrammatically = false; }, 0);
  }

  return { open: internalSidebarOpen, width: win.getBounds().width };
}

export function getInternalSidebarState(): { open: boolean } {
  return { open: internalSidebarOpen };
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

  // Also unregister HUD legacy shortcut just in case
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
          logger.info("Hotkey HOLD START:", activeAccel);
          // Make sure the window is visible so the user can see voice mode
          try {
            if (win && !win.isDestroyed()) {
              if (!win.isVisible()) showWindow();
              try { win.webContents.send("voice:setActive", true); } catch (e) { logger.warn("voice:setActive(true) send failed", e); }
            }
          } catch (e) { logger.warn("HOLD START handler failed", e); }
        },
        onHoldEnd: () => {
          logger.info("Hotkey HOLD END:", activeAccel);
          try {
            if (win && !win.isDestroyed()) {
              try { win.webContents.send("voice:setActive", false); } catch (e) { logger.warn("voice:setActive(false) send failed", e); }
            }
          } catch (e) { logger.warn("HOLD END handler failed", e); }
        },
      });
    } catch (e) {
      logger.warn("Failed to initialize overlay hold-to-voice:", e);
    }
  }

  if (!registered) {
    logger.error("Failed to register ANY overlay shortcut!");
  }

  try { globalShortcut.register("CommandOrControl+/", () => openWorkflowsWindow()); } catch { }
  try { globalShortcut.register("Control+/", () => openWorkflowsWindow()); } catch { }
  try { globalShortcut.register("CommandOrControl+Shift+/", () => openWorkflowsWindow()); } catch { }
  try { globalShortcut.register("CommandOrControl+Divide", () => openWorkflowsWindow()); } catch { }

  // HUD Window: Control+Alt+Space
  try {
    globalShortcut.register("Control+Alt+Space", () => {
      logger.info("Ctrl+Alt+Space pressed - toggling HUD");
      toggleHudWindow();
    });
    logger.info("HUD shortcut Control+Alt+Space registered");
  } catch (e) {
    logger.warn("Failed to register Control+Alt+Space for HUD:", e);
  }

  logger.info("Global shortcuts registration complete");
}

export function createTray() {
  // 1x1 transparent PNG
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${pixel}`).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip("StuardAI Assistant");
  const contextMenu = Menu.buildFromTemplate([
    { label: "Toggle", click: toggleWindow },
    { label: "Workflows", click: () => openWorkflowsWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", toggleWindow);
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

export function getScreenCaptureInvisible(): boolean {
  return screenCaptureInvisibleEnabled;
}

export function setScreenCaptureInvisible(enabled: boolean) {
  screenCaptureInvisibleEnabled = enabled;
  const allWindows = [win, dashboardWin, workflowsWin, onboardingWin, sidebarWin, hudWin, notificationWin];
  for (const w of allWindows) {
    if (w && !w.isDestroyed()) {
      try { w.setContentProtection(enabled); } catch {}
    }
  }
  // Also apply to all BrowserWindows (catches custom_ui windows)
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.setContentProtection(enabled); } catch {}
  }
  logger.info(`Screen capture invisibility ${enabled ? 'enabled' : 'disabled'} for all windows`);
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
