
import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray, screen } from "electron";
import path from "path";
import fs from "fs";
import { isDev } from "../env";
import logger from "../utils/logger";

let win: BrowserWindow | null = null;
let onboardingWin: BrowserWindow | null = null;
let workflowsWin: BrowserWindow | null = null;
let hudWin: BrowserWindow | null = null;
let spacesWin: BrowserWindow | null = null;
let dashboardWin: BrowserWindow | null = null;
let tray: Tray | null = null;

const SPACES_WINDOW_WIDTH = 450;
const SPACES_WINDOW_MARGIN = 12;

function getSpacesWindowBounds(): { x: number; y: number; width: number; height: number } {
  const fallbackDisplay = screen.getPrimaryDisplay();
  const fallbackWorkArea = fallbackDisplay.workArea;

  const mainBounds = win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null;
  const display = mainBounds ? screen.getDisplayMatching(mainBounds) : fallbackDisplay;
  const workArea = display.workArea;

  const height = Math.min(mainBounds?.height ?? 640, workArea.height);
  const y = Math.max(workArea.y, Math.min(mainBounds?.y ?? (workArea.y + Math.round(workArea.height * 0.12)), workArea.y + workArea.height - height));

  let x = mainBounds
    ? mainBounds.x + mainBounds.width + SPACES_WINDOW_MARGIN
    : workArea.x + workArea.width - SPACES_WINDOW_WIDTH - SPACES_WINDOW_MARGIN;

  // If it doesn't fit on the right, flip to the left
  if (mainBounds && x + SPACES_WINDOW_WIDTH > workArea.x + workArea.width) {
    x = mainBounds.x - SPACES_WINDOW_WIDTH - SPACES_WINDOW_MARGIN;
  }

  // Clamp to visible work area
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - SPACES_WINDOW_WIDTH));

  // If we somehow can't fit, fall back to a safe right dock
  if (workArea.width < SPACES_WINDOW_WIDTH + 20) {
    x = Math.max(fallbackWorkArea.x, fallbackWorkArea.x + fallbackWorkArea.width - SPACES_WINDOW_WIDTH);
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: SPACES_WINDOW_WIDTH,
    height: Math.round(height),
  };
}

function repositionSpacesWindow() {
  if (!spacesWin || spacesWin.isDestroyed()) return;
  const b = getSpacesWindowBounds();
  try {
    spacesWin.setBounds(b);
  } catch { }
}

// Keep a stable record of the intended content size to prevent drift from DPI rounding
let baseContentWidth = 520;
let baseContentHeight = 100;
// Also keep the stable OUTER window size (pixel bounds) to fully lock size while moving
let baseOuterWidth = 0;
let baseOuterHeight = 0;
// When changing size programmatically (expand/collapse), temporarily disable the size lock
let resizingProgrammatically = false;

type OverlayMode = "compact" | "expanded" | "sidebar" | "window";
let currentMode: OverlayMode = "compact";

// Track the last active window handle (for split-screen in sidebar mode)
let lastActiveWindowHandle: string | null = null;

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

function captureForegroundWindowHandle(excludeHandle?: string | null) {
  if (process.platform !== "win32") return null;
  try {
    const { execSync } = require("child_process");
    const tmpDir = require("os").tmpdir();
    const getHandleScript = path.join(tmpDir, "stuard_get_handle.ps1");
    const excluded = excludeHandle && excludeHandle !== "0" ? excludeHandle : "0";
    const getHandlePsScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32GetHandle {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
}
"@
$exclude = [IntPtr]${excluded}
$foreground = [Win32GetHandle]::GetForegroundWindow()
$target = $foreground
if ($exclude -ne 0 -and $foreground -eq $exclude) {
  $target = [Win32GetHandle]::GetWindow($foreground, 3)
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
  const handle = captureForegroundWindowHandle(overlayHandle);
  if (!handle) return;
  if (overlayHandle && handle === overlayHandle) return;
  lastActiveWindowHandle = handle;
  logger.info("Stored foreground window handle:", handle, "source:", source);
}

// User-customized sizes per mode (persisted preferences)
interface ModeSizePrefs {
  compact: { width: number; height: number };
  expanded: { width: number; height: number };
  window: { width: number; height: number };
}

// Default sizes for each mode
const DEFAULT_MODE_SIZES: ModeSizePrefs = {
  compact: { width: 520, height: 140 },  // Compact is a small pill-shaped input bar
  expanded: { width: 520, height: 800 },
  window: { width: 800, height: 600 },
};

// Min/max constraints per mode for user resizing
const MODE_SIZE_CONSTRAINTS = {
  compact: { minW: 400, maxW: 800, minH: 100, maxH: 800 },  // Increased to 800 to avoid cut-off
  expanded: { minW: 400, maxW: 1200, minH: 400, maxH: 1200 },
  sidebar: { minW: 400, maxW: 700, minH: 400, maxH: 2000 },  // Thicker sidebar
  window: { minW: 500, maxW: 1400, minH: 400, maxH: 1000 },
};

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

export function getRendererUrl(entry: "index" | "dashboard" | "onboarding" | "board" | "workflows" | "hud-test" | "spaces" = "index") {
  if (isDev) return `http://localhost:5173/${entry}.html`;
  return `file://${path.join(__dirname, `../../renderer/${entry}.html`)}`;
}

function centerTopWithContentSize(target: BrowserWindow, contentWidth: number, contentHeight: number) {
  target.setContentSize(contentWidth, contentHeight);
  const { workArea } = screen.getPrimaryDisplay();
  const b = target.getBounds();
  const x = Math.round(workArea.x + (workArea.width - b.width) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.12);
  target.setPosition(x, y);
}

function repositionTopCenter(target: BrowserWindow) {
  const { workArea } = screen.getPrimaryDisplay();
  const b = target.getBounds();
  const x = Math.round(workArea.x + (workArea.width - b.width) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.12);
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
  if (currentMode !== 'sidebar') {
    userModeSizes[currentMode] = { width, height };
    // Persist to main process memory (could also use electron-store)
    baseContentWidth = width;
    baseContentHeight = height;
    baseOuterWidth = b.width;
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

  // Strengthen always-on-top level so it floats over desktop on Windows
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch { }

  win.on("closed", () => {
    win = null;
  });
  // Handle resize events - allow user resizing while enforcing constraints
  win.on('move', () => { repositionSpacesWindow(); });
  win.on('resize', () => {
    assertOverlaySize();
    handleUserResize();
    repositionSpacesWindow();
  });
  win.on('will-resize', (_event, newBounds) => {
    // Notify renderer of incoming resize for smooth animations
    try {
      win?.webContents.send('overlay:resizing', { width: newBounds.width, height: newBounds.height });
    } catch { }
  });
  win.on('focus', () => { unregisterMoveShortcuts(); clearMoveTimer(); });
  win.on('blur', () => {
    updateLastActiveWindowHandle('blur');
    registerMoveShortcuts();
  });
  win.on('hide', () => { unregisterMoveShortcuts(); clearMoveTimer(); });
  win.on('show', () => {
    if (win?.isFocused()) unregisterMoveShortcuts();
    else registerMoveShortcuts();
    repositionSpacesWindow();
  });
}

export function openOnboardingWindow() {
  if (onboardingWin && !onboardingWin.isDestroyed()) {
    onboardingWin.show();
    onboardingWin.focus();
    return;
  }
  onboardingWin = new BrowserWindow({
    width: 760,
    height: 520,
    show: true,
    frame: false,
    transparent: true,
    resizable: false,
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
  onboardingWin.setMenu(null);
  const { workArea } = screen.getPrimaryDisplay();
  const b = onboardingWin.getBounds();
  const x = Math.round(workArea.x + (workArea.width - b.width) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.18);
  onboardingWin.setPosition(x, y);
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

export function openSpacesWindow() {
  if (spacesWin && !spacesWin.isDestroyed()) {
    repositionSpacesWindow();
    spacesWin.show();
    spacesWin.focus();
    spacesWin.moveTop();
    return;
  }

  const { x, y, width, height } = getSpacesWindowBounds();

  spacesWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    show: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    useContentSize: true,
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

  spacesWin.setMenu(null);
  try { spacesWin.setAlwaysOnTop(true, 'screen-saver'); } catch { }
  repositionSpacesWindow();

  if (isDev) {
    spacesWin.loadURL(getRendererUrl("spaces"));
  } else {
    const candidates = [
      path.join(__dirname, "../renderer/spaces.html"),
      path.join(__dirname, "../../renderer/spaces.html"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        spacesWin.loadFile(p);
        break;
      }
    }
  }

  spacesWin.on('closed', () => { spacesWin = null; });
  // spacesWin.on('blur', () => {
  //   try { spacesWin?.hide(); } catch { }
  // });
}

export function closeSpacesWindow() {
  try { spacesWin?.close(); } catch { }
}

export function toggleSpacesWindow() {
  if (!spacesWin || spacesWin.isDestroyed()) {
    openSpacesWindow();
    return;
  }
  if (spacesWin.isVisible()) {
    try { spacesWin.hide(); } catch { }
    return;
  }
  repositionSpacesWindow();
  spacesWin.show();
  spacesWin.focus();
  spacesWin.moveTop();
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

export function showWindow() {
  logger.info("showWindow called");
  if (!win) {
    logger.warn("showWindow: win is null!");
    return;
  }
  if (!win.isFocused()) {
    updateLastActiveWindowHandle('showWindow');
  }
  setOverlayMode('compact');
  repositionTopCenter(win);
  const bounds = win.getBounds();
  logger.info("Window bounds:", bounds);
  try {
    if (win.isMinimized()) {
      win.restore();
    }
  } catch { }
  try { win.show(); } catch { }
  try { win.focus(); } catch { }
  try { win.moveTop(); } catch { }
  logger.info("Window state after show:", {
    visible: win.isVisible(),
    focused: win.isFocused(),
    minimized: win.isMinimized(),
    alwaysOnTop: win.isAlwaysOnTop(),
  });
  try { win.webContents.send("overlay:showed"); } catch { }
}

export function hideWindow() {
  logger.info("hideWindow called");
  win?.hide();
}

export function toggleWindow() {
  logger.info("toggleWindow called, win exists:", !!win);
  if (!win) return;
  logger.info("toggleWindow: currently visible=", win.isVisible());

  if (win.isVisible()) {
    if (win.isFocused()) {
      hideWindow();
    } else {
      showWindow();
    }
  } else {
    showWindow();
  }
}

export function setOverlaySize(width: number, height: number, reposition = false) {
  if (!win) return;
  resizingProgrammatically = true;
  baseContentWidth = width;
  baseContentHeight = height;

  // Only reposition to center-top if explicitly requested or if window isn't visible yet
  if (reposition || !win.isVisible()) {
    centerTopWithContentSize(win, width, height);
  } else {
    win.setContentSize(width, height);
  }

  setTimeout(() => {
    if (!win) { resizingProgrammatically = false; return; }
    const ob = win.getBounds();
    baseOuterWidth = ob.width;
    baseOuterHeight = ob.height;
    // Don't lock min/max to exact size - use mode constraints so window can expand/shrink
    // for dropdowns like Quick Actions. The mode constraints handle the actual limits.
    const constraints = MODE_SIZE_CONSTRAINTS[currentMode];
    try {
      win.setMinimumSize(constraints.minW, constraints.minH);
      win.setMaximumSize(constraints.maxW, constraints.maxH);
    } catch { }
    resizingProgrammatically = false;
  }, 0);
}

export function setOverlayMode(mode: OverlayMode) {
  const prevMode = currentMode;
  currentMode = mode;

  // Update size constraints for the new mode
  updateSizeConstraints(mode);

  if (mode === "sidebar") {
    const { workArea } = screen.getPrimaryDisplay();
    // Sidebar: Take ~35% of screen width (not equal split - more room for active window)
    const sidebarWidth = Math.round(workArea.width * 0.35);
    const h = workArea.height;

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
        capturedHandle = captureForegroundWindowHandle(overlayHandle);
        if (capturedHandle) lastActiveWindowHandle = capturedHandle;
      }
      if (capturedHandle) {
        logger.info('Using foreground window handle for split-screen:', capturedHandle);
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
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
  public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);
}
"@
$targetWindow = [IntPtr]${capturedHandle}
if ($targetWindow -ne 0) {
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

    // Notify renderer of mode change
    try { win?.webContents.send('overlay:modeChanged', { mode, width: sidebarWidth, height: h, prevMode }); } catch { }
    return;
  }

  // Use user-preferred size for this mode, or fall back to defaults
  let { width, height } = userModeSizes[mode] || DEFAULT_MODE_SIZES[mode];

  // Ensure within constraints
  const constraints = MODE_SIZE_CONSTRAINTS[mode];
  width = Math.max(constraints.minW, Math.min(constraints.maxW, width));
  height = Math.max(constraints.minH, Math.min(constraints.maxH, height));

  setOverlaySize(width, height, true);

  // Notify renderer of mode change
  try { win?.webContents.send('overlay:modeChanged', { mode, width, height, prevMode }); } catch { }
}

// Get current mode
export function getOverlayMode() {
  return currentMode;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function moveOverlayBy(dx: number, dy: number) {
  if (!win) return;
  const outer = win.getBounds();
  const display = screen.getDisplayMatching({ x: outer.x, y: outer.y, width: outer.width, height: outer.height });
  const wa = display.workArea;
  const targetOuterX = clamp(outer.x + dx, wa.x, wa.x + wa.width - outer.width);
  const targetOuterY = clamp(outer.y + dy, wa.y, wa.y + wa.height - outer.height);
  // Lock the outer width/height absolutely when moving
  win.setBounds({ x: targetOuterX, y: targetOuterY, width: baseOuterWidth, height: baseOuterHeight });
}

export function registerGlobalShortcuts() {
  logger.info("Registering global shortcuts...");
  // Overlay toggle: prioritize Control+Space for main overlay
  const overlayAccels = [
    "Control+Space",
    "Ctrl+Space",
    "Control+Shift+Space",
    "Ctrl+Shift+Space",
    "CommandOrControl+Shift+Space",
  ];

  // Unregister all potential collisions first
  for (const a of overlayAccels) {
    try { globalShortcut.unregister(a); } catch { }
  }

  // Also unregister HUD legacy shortcut just in case
  try { globalShortcut.unregister("Control+Alt+Space"); } catch { }

  let registered = false;
  // Register ALL valid shortcuts for the overlay, not just the first one
  for (const a of overlayAccels) {
    try {
      // Check if already registered by another app (electron returns false usually if taken, or throws)
      if (globalShortcut.isRegistered(a)) {
        logger.warn(`Shortcut ${a} is already registered by another application.`);
        continue;
      }

      const success = globalShortcut.register(a, () => {
        logger.info("Hotkey pressed:", a);
        toggleWindow();
      });

      if (success) {
        logger.info(`Shortcut ${a} registered successfully.`);
        registered = true;
      } else {
        logger.warn(`Failed to register ${a} (returned false).`);
      }
    } catch (e) {
      logger.warn(`Exception registering ${a}:`, e);
    }
  }

  if (!registered) {
    logger.error("Failed to register ANY overlay shortcut!");
  }

  try { globalShortcut.register("CommandOrControl+/", () => openWorkflowsWindow()); } catch { }
  try { globalShortcut.register("Control+/", () => openWorkflowsWindow()); } catch { }
  try { globalShortcut.register("CommandOrControl+Shift+/", () => openWorkflowsWindow()); } catch { }
  try { globalShortcut.register("CommandOrControl+Divide", () => openWorkflowsWindow()); } catch { }

  // HUD Window: Moved to Control+Alt+Space to free up Control+Space
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
