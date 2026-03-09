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
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Cmd',
  space: 'Space',
  enter: 'Enter',
  escape: 'Esc',
  backspace: '⌫',
  delete: 'Del',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  tab: 'Tab',
};

export function HotkeyEditor({ value, onChange }: HotkeyEditorProps) {
  const [editing, setEditing] = useState(false);
  const [keys, setKeys] = useState<string[]>(value || []);
  const pendingRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key.toLowerCase();

    // Escape cancels editing
    if (key === 'escape') {
      pendingRef.current = [];
      setEditing(false);
      return;
    }

    // Enter confirms the current keys
    if (key === 'enter') {
      if (pendingRef.current.length > 0) {
        setKeys(pendingRef.current);
        onChange(pendingRef.current);
      }
      pendingRef.current = [];
      setEditing(false);
      return;
    }

    // Ignore bare modifier presses
    if (['control', 'alt', 'shift', 'meta'].includes(key)) return;

    const combo: string[] = [];
    if (e.ctrlKey) combo.push('ctrl');
    if (e.altKey) combo.push('alt');
    if (e.shiftKey) combo.push('shift');
    if (e.metaKey) combo.push('meta');
    combo.push(key === ' ' ? 'space' : key);

    const updated = [...pendingRef.current, ...combo];
    pendingRef.current = updated;
    setKeys(updated);
  };

  const finishEditing = () => {
    if (pendingRef.current.length > 0) {
      setKeys(pendingRef.current);
      onChange(pendingRef.current);
    }
    pendingRef.current = [];
    setEditing(false);
  };

  const startEditing = () => {
    pendingRef.current = [];
    setKeys([]);
    setEditing(true);
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const formatKey = (k: string) => KEY_DISPLAY[k.toLowerCase()] || k.toUpperCase();

  return (
    <div className="space-y-2 w-full">
      {editing ? (
        <div className="relative">
          <div className="w-full px-4 py-4 text-sm border border-blue-500/50 rounded-2xl bg-blue-500/10 flex flex-col items-center justify-center gap-2 transition-all">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center animate-pulse">
              <Keyboard className="w-5 h-5 text-blue-400" />
            </div>
            {keys.length > 0 ? (
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {keys.map((k, i) => (
                  <React.Fragment key={i}>
                    <span className="px-2.5 py-1 bg-white/[0.08] border border-white/[0.12] rounded-lg font-medium text-white/90 text-sm">
                      {formatKey(k)}
                    </span>
                    {i < keys.length - 1 && <span className="text-white/30 text-sm">+</span>}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <span className="font-medium text-white">Press your keys...</span>
            )}
            <span className="text-xs text-white/50">Press keys to add · Enter to confirm · Esc to cancel</span>
            <button
              onMouseDown={(e) => { e.preventDefault(); finishEditing(); }}
              className="mt-1 px-4 py-1.5 text-xs font-medium bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 rounded-lg text-blue-300 transition-all"
            >
              Done
            </button>
          </div>
          <input
            ref={inputRef}
            type="text"
            className="sr-only"
            onKeyDown={handleKeyDown}
            onBlur={() => finishEditing()}
            readOnly
          />
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => startEditing()}
            className="flex-1 px-4 py-3 text-sm border border-white/[0.08] rounded-2xl bg-white/[0.02] hover:bg-white/[0.04] flex items-center justify-center transition-all shadow-sm"
          >
            {keys.length > 0 ? (
              <div className="flex items-center gap-3">
                {keys.map((k, i) => (
                  <React.Fragment key={k}>
                    <span className="px-3 py-1.5 bg-white/[0.06] border border-white/[0.08] rounded-xl font-medium text-white/80 text-sm shadow-sm">
                      {formatKey(k)}
                    </span>
                    {i < keys.length - 1 && <span className="text-white/40 text-lg font-light">+</span>}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-white/40 py-1.5">
                <Keyboard className="w-4 h-4" />
                <span>Click to record shortcut</span>
              </div>
            )}
          </button>

          <button
            onClick={() => { setKeys([]); onChange([]); }}
            className="px-10 flex items-center justify-center text-white/60 hover:text-white bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.08] rounded-2xl transition-all h-auto"
            title="Clear"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

