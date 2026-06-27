// Standalone fake-acrylic test.
// Run: cd apps/desktop && npx electron scripts/test-acrylic.js
//
// Approach: transparent Electron window + desktopCapturer screen stream
// rendered as a positioned <video> backdrop with CSS blur on top. Gives
// us a frosted-glass effect that doesn't depend on DWM acrylic working.

const path = require("path");
const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require("electron");

ipcMain.handle("get-screen-source", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 0, height: 0 },
  });
  return sources[0]?.id ?? null;
});

ipcMain.handle("get-display-info", () => {
  const display = screen.getPrimaryDisplay();
  return {
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
  };
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 520,
    height: 140,
    frame: false,
    show: false,
    resizable: true,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: true,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });

  // Make this window invisible to its own screen capture so we don't get
  // an infinite mirror feedback loop.
  try {
    win.setContentProtection(true);
  } catch (e) {
    console.warn("setContentProtection failed:", e);
  }

  win.loadFile(path.join(__dirname, "test-acrylic.html"));

  const sendBounds = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("window-bounds", win.getBounds());
  };

  win.on("move", sendBounds);
  win.on("resize", sendBounds);

  win.once("ready-to-show", () => {
    sendBounds();
    win.show();
  });

  win.on("closed", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
