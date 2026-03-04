/**
 * HotkeyEditor - User-friendly keyboard shortcut recorder
 */
import React, { useState, useRef, useEffect } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';

interface HotkeyEditorProps {
  value: string[];
  onChange: (v: string[]) => void;
}

const KEY_DISPLAY: Record<string, string> = {
  ctrl: '⌃ Ctrl',
  alt: '⌥ Alt', 
  shift: '⇧ Shift',
  meta: '⌘ Cmd',
  space: 'Space',
  enter: '↵ Enter',
  escape: 'Esc',
  backspace: '⌫',
  delete: 'Del',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

export function HotkeyEditor({ value, onChange }: HotkeyEditorProps) {
  const [editing, setEditing] = useState(false);
  const [keys, setKeys] = useState<string[]>(value || []);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key.toLowerCase();
    const newKeys: string[] = [];

    if (e.ctrlKey) newKeys.push('ctrl');
    if (e.altKey) newKeys.push('alt');
    if (e.shiftKey) newKeys.push('shift');
    if (e.metaKey) newKeys.push('meta');

    if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
      newKeys.push(key === ' ' ? 'space' : key);
    }

    if (newKeys.length > 0) {
      setKeys(newKeys);
      onChange(newKeys);
      setEditing(false);
    }
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const formatKey = (k: string) => KEY_DISPLAY[k.toLowerCase()] || k.toUpperCase();

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
            {keys.length > 0 ? (
              <div className="flex items-center gap-1.5">
                {keys.map((k, i) => (
                  <React.Fragment key={k}>
                    <span className="px-2.5 py-1 bg-white/[0.06] border border-white/[0.08] rounded-lg font-medium text-white/80 text-xs">
                      {formatKey(k)}
                    </span>
                    {i < keys.length - 1 && <span className="text-white/40">+</span>}
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
          {keys.length > 0 && (
            <button
              onClick={() => { setKeys([]); onChange([]); }}
              className="p-3 text-white/40 hover:text-red-500 hover:bg-red-500/10 border border-white/[0.08] rounded-xl transition-all"
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

