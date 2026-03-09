import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const SETTINGS_FILE = 'user-settings.json';

export interface UserSettings {
  globalHotkey?: string;
  /** IANA timezone override (e.g. 'America/New_York'). null/undefined = use OS default. */
  timezone?: string | null;
  /** Whether to auto-sync cookies from Chrome when browser-use starts. Default: true. */
  chromeSyncEnabled?: boolean;
  chromeSyncBrowserName?: string | null;
  chromeSyncProfileName?: string | null;
  /** Path to the Chrome profile directory to sync from (e.g. '.../User Data/Default'). null = auto-detect. */
  chromeSyncProfilePath?: string | null;
  /** Path to the Chrome User Data directory (e.g. '.../Google/Chrome/User Data'). null = auto-detect. */
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
