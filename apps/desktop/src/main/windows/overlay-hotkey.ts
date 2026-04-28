/**
 * Overlay hotkey hold-detector.
 *
 * Tap (press + release within HOLD_THRESHOLD_MS): summon/toggle overlay.
 * Hold (still pressed past HOLD_THRESHOLD_MS): voice mode while held;
 * exit voice mode on release.
 *
 * Uses uiohook-napi for OS-level keyup detection. globalShortcut still
 * registers the accelerator to consume the key from the foreground app.
 */

import logger from "../utils/logger";

let uiohook: any = null;
try {
  uiohook = require("uiohook-napi");
  logger.info("[OverlayHotkey] uiohook-napi loaded");
} catch (e) {
  logger.warn("[OverlayHotkey] uiohook-napi unavailable; hold-to-voice disabled", e);
}

const HOLD_THRESHOLD_MS = 280;

interface HoldState {
  pressed: boolean;
  pressedAt: number;
  holdTimer: NodeJS.Timeout | null;
  voiceActive: boolean;
}

const state: HoldState = {
  pressed: false,
  pressedAt: 0,
  holdTimer: null,
  voiceActive: false,
};

const activeMods = new Set<string>();
let installed = false;
let onTap: (() => void) | null = null;
let onHoldStart: (() => void) | null = null;
let onHoldEnd: (() => void) | null = null;
let watchedKey: string = "space";
let watchedMods: Set<string> = new Set(["ctrl", "shift"]);
let lastDebugLog = 0;

const MODIFIER_KEYS: Record<number, string> = {
  29: "ctrl", 3613: "ctrl",
  56: "alt", 3640: "alt",
  42: "shift", 54: "shift",
  3675: "meta", 3676: "meta",
};

const KEY_NAMES: Record<number, string> = {};

function buildKeyMap() {
  if (!uiohook) return;
  const { UiohookKey } = uiohook;
  if (!UiohookKey) return;
  for (const [name, code] of Object.entries(UiohookKey)) {
    if (typeof code === "number") {
      KEY_NAMES[code] = String(name).toLowerCase();
    }
  }
}

function setVoiceActive(active: boolean) {
  if (state.voiceActive === active) return;
  state.voiceActive = active;
  try {
    if (active) {
      logger.info("[OverlayHotkey] hold START — entering voice mode");
      onHoldStart?.();
    } else {
      logger.info("[OverlayHotkey] hold END — exiting voice mode");
      onHoldEnd?.();
    }
  } catch (e) {
    logger.warn("[OverlayHotkey] hold callback threw", e);
  }
}

function clearHoldTimer() {
  if (state.holdTimer) {
    clearTimeout(state.holdTimer);
    state.holdTimer = null;
  }
}

function modsMatch(): boolean {
  if (activeMods.size !== watchedMods.size) return false;
  for (const m of watchedMods) {
    if (!activeMods.has(m)) return false;
  }
  return true;
}

function handlePress() {
  if (state.pressed) return;
  state.pressed = true;
  state.pressedAt = Date.now();
  clearHoldTimer();
  logger.info("[OverlayHotkey] PRESS detected (waiting for hold/release)");
  state.holdTimer = setTimeout(() => {
    state.holdTimer = null;
    if (state.pressed) {
      setVoiceActive(true);
    }
  }, HOLD_THRESHOLD_MS);
}

function handleRelease() {
  if (!state.pressed) return;
  const wasVoice = state.voiceActive;
  const heldMs = Date.now() - state.pressedAt;
  state.pressed = false;
  clearHoldTimer();
  logger.info(`[OverlayHotkey] RELEASE after ${heldMs}ms (voice=${wasVoice})`);

  if (wasVoice) {
    setVoiceActive(false);
    return;
  }

  if (heldMs < HOLD_THRESHOLD_MS) {
    try { onTap?.(); } catch (e) { logger.warn("[OverlayHotkey] onTap threw", e); }
  }
}

function installListeners() {
  if (installed || !uiohook) return;
  const { uIOhook } = uiohook;
  if (!uIOhook) return;

  buildKeyMap();

  uIOhook.on("keydown", (e: any) => {
    const mod = MODIFIER_KEYS[e.keycode];
    if (mod) {
      activeMods.add(mod);
      return;
    }
    const name = KEY_NAMES[e.keycode];
    if (!name || name !== watchedKey) return;
    if (!modsMatch()) return;
    handlePress();
  });

  uIOhook.on("keyup", (e: any) => {
    const mod = MODIFIER_KEYS[e.keycode];
    if (mod) {
      activeMods.delete(mod);
      // If a required modifier is released while pressed, treat as release.
      if (state.pressed && watchedMods.has(mod)) {
        handleRelease();
      }
      return;
    }
    const name = KEY_NAMES[e.keycode];
    if (!name) return;
    if (name === watchedKey && state.pressed) {
      handleRelease();
    }
  });

  try {
    uIOhook.start();
    installed = true;
    logger.info("[OverlayHotkey] uiohook started for hold-to-voice");
  } catch (e) {
    logger.warn("[OverlayHotkey] uIOhook.start() failed", e);
  }
}

/**
 * Parse an accelerator like "Control+Shift+Space" into modifiers + key.
 * Returns null if unparseable.
 */
function parseAccel(accel: string): { mods: Set<string>; key: string } | null {
  const parts = String(accel || "").split("+").map(p => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return null;
  const mods = new Set<string>();
  let key = "";
  for (const p of parts) {
    if (p === "ctrl" || p === "control" || p === "commandorcontrol") mods.add("ctrl");
    else if (p === "shift") mods.add("shift");
    else if (p === "alt" || p === "option") mods.add("alt");
    else if (p === "meta" || p === "cmd" || p === "command" || p === "super" || p === "win" || p === "windows") mods.add("meta");
    else key = p;
  }
  if (!key) return null;
  return { mods, key };
}

export interface OverlayHotkeyOptions {
  accelerator: string;
  onTap: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

export function initOverlayHotkey(opts: OverlayHotkeyOptions) {
  const parsed = parseAccel(opts.accelerator);
  if (!parsed) {
    logger.warn("[OverlayHotkey] Could not parse accelerator:", opts.accelerator);
    return;
  }
  watchedKey = parsed.key;
  watchedMods = parsed.mods;
  onTap = opts.onTap;
  onHoldStart = opts.onHoldStart;
  onHoldEnd = opts.onHoldEnd;
  logger.info(`[OverlayHotkey] Init for "${opts.accelerator}" — key=${watchedKey} mods=[${[...watchedMods].join(',')}]`);

  if (!uiohook) {
    logger.warn("[OverlayHotkey] uiohook unavailable — hold-to-voice will not work; tap will still work via globalShortcut.");
    return;
  }
  installListeners();
}

/** True if hold-to-voice is currently armed (uiohook running). */
export function isHoldToVoiceActive(): boolean {
  return installed;
}
