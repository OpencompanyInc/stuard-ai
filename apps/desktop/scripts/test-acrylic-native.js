// Native Win11 acrylic test (no desktopCapturer, no setContentProtection).
//
// Run with the LATEST Electron (recommended):
//   cd apps/desktop && npx -p electron@latest electron scripts/test-acrylic-native.js
//
// Goal: confirm `backgroundMaterial: "acrylic"` (or "mica") produces a real
// DWM-composited backdrop that (a) tracks windows behind it and (b) shows
// up cleanly in screenshots / screen recordings.

const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

console.log("Electron version:", process.versions.electron);
console.log("Chrome  version:", process.versions.chrome);
console.log("Platform        :", process.platform, process.getSystemVersion?.());

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 760,
    height: 480,
    show: false,
    frame: true,
    title: "Native Acrylic Test",
    // IMPORTANT for DWM acrylic on Windows 11:
    //   - do NOT set `transparent: true` (overrides backgroundMaterial)
    //   - do NOT set an opaque backgroundColor (Chromium paints it on top)
    //   - body CSS must have a transparent background
    backgroundMaterial: "acrylic",
    webPreferences: {
      preload: path.join(__dirname, "test-acrylic-native-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);

  // Also call the setter explicitly — on some Electron builds the constructor
  // option is a no-op and only the runtime call sticks.
  try {
    win.setBackgroundMaterial("acrylic");
    console.log("[acrylic] setBackgroundMaterial('acrylic') called");
  } catch (e) {
    console.warn("[acrylic] setBackgroundMaterial threw:", e);
  }

  ipcMain.handle("set-material", (_e, material) => {
    try {
      win.setBackgroundMaterial(material);
      console.log(`[acrylic] -> ${material}`);
      return { ok: true };
    } catch (e) {
      console.warn(`[acrylic] setBackgroundMaterial('${material}') threw:`, e);
      return { ok: false, error: String(e) };
    }
  });

  win.loadFile(path.join(__dirname, "test-acrylic-native.html"));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => app.quit());
});

app.on("window-all-closed", () => app.quit());
