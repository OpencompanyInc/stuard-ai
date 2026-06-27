import type { BrowserWindow } from "electron";
import logger from "../utils/logger";

// dwmapi.dll attribute IDs (see Microsoft DWMWINDOWATTRIBUTE docs)
const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWA_SYSTEMBACKDROP_TYPE = 38;

// DWM_SYSTEMBACKDROP_TYPE values (Win11 22H2+)
const DWMSBT_TRANSIENTWINDOW = 3; // acrylic
const DWMWCP_ROUND = 2;

type DwmSetWindowAttributeFn = (
  hwnd: bigint,
  attr: number,
  valPtr: Buffer,
  size: number,
) => number;

let DwmSetWindowAttribute: DwmSetWindowAttributeFn | null = null;
let loadError: unknown = null;

if (process.platform === "win32") {
  try {
    const koffi = require("koffi");
    const dwmapi = koffi.load("dwmapi.dll");
    DwmSetWindowAttribute = dwmapi.func(
      "int DwmSetWindowAttribute(uintptr_t hwnd, uint dwAttribute, void *pvAttribute, uint cbAttribute)",
    );
    logger.info("[Acrylic] koffi + dwmapi.dll loaded");
  } catch (e) {
    loadError = e;
    logger.warn("[Acrylic] failed to load koffi/dwmapi", e);
  }
}

function hwndFromBuffer(buf: Buffer): bigint {
  // x64/arm64 windows: HWND is 8 bytes; x86: 4 bytes.
  if (buf.length >= 8) return buf.readBigUInt64LE(0);
  return BigInt(buf.readUInt32LE(0));
}

function setDwmAttr(hwnd: bigint, attr: number, value: number): boolean {
  if (!DwmSetWindowAttribute) return false;
  const buf = Buffer.alloc(4);
  buf.writeInt32LE(value, 0);
  const hr = DwmSetWindowAttribute(hwnd, attr, buf, 4);
  if (hr !== 0) {
    logger.warn(
      `[Acrylic] DwmSetWindowAttribute(attr=${attr}, value=${value}) HRESULT=0x${(hr >>> 0).toString(16)}`,
    );
    return false;
  }
  return true;
}

/**
 * Apply Windows 11 acrylic backdrop + dark mode + rounded corners to a BrowserWindow.
 * Must be called after the native window handle exists (e.g. on `ready-to-show`).
 * Returns true if all three DWM attributes were accepted by Windows.
 */
export function applyAcrylic(win: BrowserWindow): boolean {
  if (!DwmSetWindowAttribute) {
    logger.warn("[Acrylic] dwmapi not available, skipping", loadError ?? "");
    return false;
  }
  try {
    const hwnd = hwndFromBuffer(win.getNativeWindowHandle());
    const dark = setDwmAttr(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
    const corner = setDwmAttr(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND);
    const backdrop = setDwmAttr(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_TRANSIENTWINDOW);
    logger.info(`[Acrylic] dark=${dark} corner=${corner} backdrop=${backdrop}`);
    return dark && corner && backdrop;
  } catch (e) {
    logger.warn("[Acrylic] applyAcrylic threw", e);
    return false;
  }
}
