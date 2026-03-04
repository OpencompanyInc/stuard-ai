/**
 * AcceleratorEditor - Hotkey recorder that outputs Electron-style accelerator strings.
 * E.g. "Ctrl+Shift+K", "Alt+F4", "CommandOrControl+R"
 */
import React, { useState, useRef, useEffect } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';

interface AcceleratorEditorProps {
  value: string;
  onChange: (v: string) => void;
}

/** Map browser key names → Electron accelerator tokens */
const KEY_TO_ACCELERATOR: Record<string, string> = {
  ' ': 'Space',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  enter: 'Return',
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  tab: 'Tab',
  capslock: 'CapsLock',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  printscreen: 'PrintScreen',
};

/** Pretty display mapping for the button */
const DISPLAY: Record<string, string> = {
  Ctrl: '⌃ Ctrl',
  Alt: '⌥ Alt',
  Shift: '⇧ Shift',
  Meta: '⌘ Cmd',
  Space: 'Space',
  Return: '↵ Enter',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Tab: '⇥ Tab',
};

function parseAccelerator(acc: string): string[] {
  if (!acc) return [];
  return acc.split('+').map(s => s.trim()).filter(Boolean);
}

function displayPart(part: string): string {
  return DISPLAY[part] || part.toUpperCase();
}

export function AcceleratorEditor({ value, onChange }: AcceleratorEditorProps) {
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState<string[]>(parseAccelerator(value || ''));
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.key.toLowerCase();
    const newParts: string[] = [];

    if (e.ctrlKey || e.metaKey) newParts.push('Ctrl');
    if (e.altKey) newParts.push('Alt');
    if (e.shiftKey) newParts.push('Shift');

    // Ignore bare modifier presses
    if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
      const mapped = KEY_TO_ACCELERATOR[key];
      if (mapped) {
        newParts.push(mapped);
      } else if (key.startsWith('f') && /^f\d+$/.test(key)) {
        // Function keys: f1 → F1
        newParts.push(key.toUpperCase());
      } else if (key.length === 1) {
        newParts.push(key.toUpperCase());
      } else {
        newParts.push(key.charAt(0).toUpperCase() + key.slice(1));
      }
    }

    if (newParts.length > 0 && newParts.some(p => !['Ctrl', 'Alt', 'Shift'].includes(p))) {
      setParts(newParts);
      onChange(newParts.join('+'));
      setEditing(false);
    }
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  // Sync external value changes
  useEffect(() => {
    setParts(parseAccelerator(value || ''));
  }, [value]);

  return (
    <div className="space-y-2">
      {editing ? (
        <div className="relative">
          <div className="w-full px-4 py-4 text-sm border-2 border-blue-400 rounded-xl bg-gradient-to-r from-blue-50 to-sky-50 flex flex-col items-center justify-center gap-2">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center animate-pulse">
              <Keyboard className="w-5 h-5 text-blue-600" />
            </div>
            <span className="font-semibold text-blue-700">Press your shortcut keys...</span>
            <span className="text-xs text-blue-500">Example: Ctrl + Shift + K</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            className="sr-only"
            onKeyDown={handleKeyDown}
            onBlur={() => setEditing(false)}
            readOnly
          />
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="flex-1 px-4 py-3 text-sm border border-white/[0.08] rounded-xl bg-white/[0.04] hover:bg-white/[0.06] hover:border-blue-300 flex items-center justify-center gap-3 transition-all shadow-sm group"
          >
            {parts.length > 0 ? (
              <div className="flex items-center gap-1.5">
                {parts.map((p, i) => (
                  <React.Fragment key={`${p}-${i}`}>
                    <span className="px-2.5 py-1 bg-white/[0.06] border border-white/[0.08] rounded-lg font-medium text-white/80 text-xs shadow-sm">
                      {displayPart(p)}
                    </span>
                    {i < parts.length - 1 && <span className="text-slate-300 text-xs">+</span>}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-white/40">
                <Keyboard className="w-4 h-4" />
                <span>Click to record shortcut</span>
              </div>
            )}
          </button>
          {parts.length > 0 && (
            <button
              onClick={() => { setParts([]); onChange(''); }}
              className="p-3 text-white/40 hover:text-red-500 hover:bg-red-50 border border-white/[0.08] rounded-xl transition-all"
              title="Clear"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

