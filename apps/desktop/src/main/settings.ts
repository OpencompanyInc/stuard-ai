import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const SETTINGS_FILE = 'user-settings.json';

export interface UserSettings {
  globalHotkey?: string;
  /** IANA timezone override (e.g. 'America/New_York'). null/undefined = use OS default. */
  timezone?: string | null;
  // ── Renderer preferences (persisted across restarts) ──
  themeMode?: string;
  themeDarkShade?: string;
  themeLightShade?: string;
  themeText?: string;
  translucentMode?: boolean;
  tone?: string;
  toneCustom?: string;
  persona?: string;
  chatMode?: string;
  chatModels?: any;
  wakewordEnabled?: boolean;
  terminalEnabled?: boolean;
  browserEnabled?: boolean;
  screenCaptureInvisible?: boolean;
  onboardingComplete?: boolean;
  tourComplete?: boolean;
  timezoneOverride?: boolean;

  // ── Embedding / file-index preferences ──
  /** File kinds the user has selected for semantic indexing */
  semanticIndexKinds?: string[];
  /** File extensions to exclude from semantic indexing */
  semanticExcludeExtensions?: string[];

  // ── Credits settings ──
  autoRefillCredits?: boolean;

  // ── Browser-use Chrome sync settings ──
  chromeSyncEnabled?: boolean;
  chromeSyncBrowserName?: string | null;
  chromeSyncProfileName?: string | null;
  chromeSyncProfilePath?: string | null;
  chromeSyncUserDataDir?: string | null;
}

export function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export function loadSettings(): UserSettings {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
  return {};
}

export function saveSettings(settings: UserSettings) {
  try {
    const current = loadSettings();
    const updated = { ...current, ...settings };
    fs.writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export function getGlobalHotkey(): string {
  const s = loadSettings();
  return s.globalHotkey || 'Control+Shift+Space';
}

export function setGlobalHotkey(accelerator: string) {
  saveSettings({ globalHotkey: accelerator });
}

/**
 * Get the user's timezone. Falls back to the OS/runtime default.
 * Returns an IANA timezone string (e.g. 'America/New_York').
 */
export function getTimezone(): string {
  const s = loadSettings();
  if (s.timezone && typeof s.timezone === 'string') return s.timezone;
  // Auto-detect from the runtime (Node.js uses the OS timezone)
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { }
  return 'UTC';
}

/** Set a manual timezone override. Pass null to revert to auto-detect. */
export function setTimezone(tz: string | null) {
  saveSettings({ timezone: tz });
}

// ── Renderer preference helpers ──

/** Keys that the renderer is allowed to persist via the prefs:set IPC. */
const RENDERER_PREF_KEYS = new Set<string>([
  'themeMode', 'themeDarkShade', 'themeLightShade', 'themeText',
  'translucentMode', 'tone', 'toneCustom', 'persona',
  'chatMode', 'chatModels', 'wakewordEnabled', 'terminalEnabled',
  'browserEnabled', 'screenCaptureInvisible', 'onboardingComplete',
  'tourComplete', 'timezoneOverride', 'semanticIndexKinds',
  'semanticExcludeExtensions',
  'autoRefillCredits',
]);

/** Return all persisted renderer preferences. */
export function getRendererPrefs(): Record<string, any> {
  const all = loadSettings();
  const out: Record<string, any> = {};
  for (const key of RENDERER_PREF_KEYS) {
    if ((all as any)[key] !== undefined) {
      out[key] = (all as any)[key];
    }
  }
  return out;
}

/** Persist one or more renderer preferences. Only allowed keys are stored. */
export function setRendererPrefs(prefs: Record<string, any>) {
  const filtered: Record<string, any> = {};
  for (const [k, v] of Object.entries(prefs)) {
    if (RENDERER_PREF_KEYS.has(k)) {
      filtered[k] = v;
    }
  }
  if (Object.keys(filtered).length > 0) {
    saveSettings(filtered as any);
  }
}
