import React, { useCallback, useEffect, useState } from 'react';
import { Keyboard, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

const DEFAULT_SHORTCUT_KEYS = ['Control', 'Shift', 'Space'];
const SHORTCUT_MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'];
const SHORTCUT_KEYS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Space', 'Enter',
  'Tab', 'Escape', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'F3', 'F4',
  'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
];

function displayHotkey(keys: string[]): string[] {
  return keys.map((key) => {
    if (key === 'Control') return 'Ctrl';
    if (key === 'Command') return 'Cmd';
    return key;
  });
}

function toAccelerator(keys: string[]): string {
  return keys
    .map((key) => {
      if (key === 'Control') return 'Ctrl';
      if (key === 'Command') return 'Cmd';
      return key;
    })
    .join('+');
}

function fromAccelerator(accel: string): string[] {
  return accel.split('+').map((part) => {
    if (part === 'Ctrl' || part === 'Control') return 'Control';
    if (part === 'Cmd' || part === 'Command' || part === 'CommandOrControl') return 'Command';
    return part;
  });
}

function hasValidShortcut(keys: string[]): boolean {
  const hasModifier = keys.some((key) => SHORTCUT_MODIFIERS.includes(key));
  const hasKey = keys.some((key) => !SHORTCUT_MODIFIERS.includes(key));
  return hasModifier && hasKey;
}

const SectionHeader = ({ title, description }: { title: string; description: string }) => (
  <div className="mb-6 border-b border-theme-sidebar pb-4">
    <h3 className="text-[18px] font-semibold font-stuard text-theme-fg tracking-tight mb-1">{title}</h3>
    <p className="text-[13px] text-theme-muted font-medium">{description}</p>
  </div>
);

function HotkeyPills({ keys }: { keys: string[] }) {
  const labels = displayHotkey(keys);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {labels.map((key, index) => (
        <React.Fragment key={`${key}-${index}`}>
          {index > 0 && <span className="text-sm text-theme-muted font-medium">+</span>}
          <span className="min-w-[56px] rounded-xl border border-theme bg-theme-card px-3 py-2 text-center text-[13px] font-semibold text-theme-fg shadow-sm">
            {key}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function GlobalHotkeySection() {
  const [currentKeys, setCurrentKeys] = useState<string[]>(DEFAULT_SHORTCUT_KEYS);
  const [recording, setRecording] = useState(false);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadHotkey = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.desktopAPI.getGlobalHotkey();
      if (result?.ok && result.hotkey) {
        setCurrentKeys(fromAccelerator(result.hotkey));
      } else {
        setCurrentKeys(DEFAULT_SHORTCUT_KEYS);
      }
    } catch {
      setCurrentKeys(DEFAULT_SHORTCUT_KEYS);
      setError('Could not load the current shortcut.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHotkey();
  }, [loadHotkey]);

  const saveKeys = useCallback(async (keys: string[]) => {
    if (!hasValidShortcut(keys)) {
      setError('Use at least one modifier plus another key.');
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const accelerator = toAccelerator(keys);
      const result = await window.desktopAPI.setGlobalHotkey(accelerator);
      if (!result?.ok) {
        setError(result?.error || 'Failed to register shortcut.');
        return;
      }

      setCurrentKeys(keys);
      setRecordedKeys([]);
      setSaved(true);
      try {
        localStorage.setItem('stuard_global_hotkey', accelerator);
      } catch {
        // ignore
      }
    } catch {
      setError('An unexpected error happened while saving the shortcut.');
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        setRecording(false);
        setRecordedKeys([]);
        setError(null);
        return;
      }

      const nextKeys: string[] = [];
      if (event.ctrlKey) nextKeys.push('Control');
      if (event.altKey) nextKeys.push('Alt');
      if (event.shiftKey) nextKeys.push('Shift');
      if (event.metaKey) nextKeys.push('Command');

      const rawKey = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
      if (rawKey && !SHORTCUT_MODIFIERS.includes(rawKey) && SHORTCUT_KEYS.includes(rawKey)) {
        nextKeys.push(rawKey);
      }

      const uniqueKeys = Array.from(new Set(nextKeys));
      setRecordedKeys(uniqueKeys);
      setError(null);
      setSaved(false);

      if (hasValidShortcut(uniqueKeys)) {
        setRecording(false);
        void saveKeys(uniqueKeys);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, saveKeys]);

  const handleStartRecording = () => {
    setRecording(true);
    setRecordedKeys([]);
    setError(null);
    setSaved(false);
  };

  const handleCancelRecording = () => {
    setRecording(false);
    setRecordedKeys([]);
    setError(null);
  };

  const handleResetDefault = async () => {
    setRecording(false);
    setRecordedKeys([]);
    await saveKeys(DEFAULT_SHORTCUT_KEYS);
  };

  const previewKeys = recording
    ? (recordedKeys.length > 0 ? recordedKeys : currentKeys)
    : currentKeys;

  return (
    <div className="dashboard-card p-6">
      <SectionHeader
        title="Global Hotkey"
        description="Open Stuard from anywhere with a keyboard shortcut."
      />

      <div className="space-y-4">
        <div className={clsx(
          'rounded-xl border p-4 transition-colors',
          recording ? 'border-primary/40 bg-primary/5' : 'border-theme bg-theme-hover/40'
        )}>
          <div className="flex items-start gap-3">
            <span className={clsx(
              'mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border',
              recording ? 'border-primary/30 bg-primary/10 text-primary' : 'border-theme bg-theme-card text-theme-muted'
            )}>
              <Keyboard className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-theme-fg tracking-tight">
                {recording ? 'Press your new shortcut' : 'Current shortcut'}
              </div>
              <p className="mt-0.5 text-[11px] text-theme-muted leading-relaxed">
                {recording
                  ? 'Press the key combination you want. Escape cancels.'
                  : 'Tap to toggle the overlay. Hold to start voice mode.'}
              </p>

              <div className="mt-4">
                {loading ? (
                  <div className="flex items-center gap-2 text-[12px] text-theme-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading shortcut...
                  </div>
                ) : (
                  <HotkeyPills keys={previewKeys} />
                )}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[12px] text-red-500">
            {error}
          </div>
        )}

        {saved && !error && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-[12px] text-emerald-600 dark:text-emerald-400">
            Shortcut saved.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!recording ? (
            <button
              type="button"
              onClick={handleStartRecording}
              disabled={loading || saving}
              className="px-4 py-2 rounded-lg bg-primary text-primary-fg text-[12px] font-semibold tracking-tight hover:opacity-90 transition-all shadow-sm disabled:opacity-50"
            >
              Change shortcut
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCancelRecording}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-theme bg-theme-card text-theme-fg text-[12px] font-semibold tracking-tight hover:bg-theme-hover transition-all disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Cancel'}
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleResetDefault()}
            disabled={loading || saving || recording}
            className="px-4 py-2 rounded-lg border border-theme bg-theme-card text-theme-fg text-[12px] font-semibold tracking-tight hover:bg-theme-hover transition-all disabled:opacity-50"
          >
            Reset to default
          </button>
        </div>

        <p className="text-[11px] text-theme-muted leading-relaxed">
          Default is <span className="font-semibold text-theme-fg">Ctrl + Shift + Space</span>.
          Pick a combination that is easy to remember and unlikely to conflict with other apps.
        </p>
      </div>
    </div>
  );
}
