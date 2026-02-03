import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const SETTINGS_FILE = 'user-settings.json';

interface UserSettings {
  globalHotkey?: string;
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
