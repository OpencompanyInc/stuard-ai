import React, { useEffect, useMemo, useRef, useState } from "react";

export interface CommandItem {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  group?: string;
  run: () => void;
}

export default function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: CommandItem[]; }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[index];
        if (cmd) { onClose(); setTimeout(() => cmd.run(), 0); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = q ? commands.filter(c => c.title.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q)) : commands;
    return arr;
  }, [query, commands]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-20">
      <div className="w-[560px] rounded-xl border border-white/10 bg-neutral-900 text-white shadow-2xl overflow-hidden">
        <div className="p-2 border-b border-white/10">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            placeholder="Type a command…"
            className="w-full bg-neutral-800/60 rounded-md px-3 py-2 text-[13px] outline-none placeholder:text-white/40"
          />
        </div>
        <div className="max-h-80 overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-[13px] text-white/60">No commands.</div>
          ) : (
            <ul>
              {filtered.map((c, i) => (
                <li key={c.id}>
                  <button
                    onClick={() => { onClose(); setTimeout(() => c.run(), 0); }}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between ${i === index ? 'bg-white/10' : 'hover:bg-white/5'}`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      {c.icon && <div className="text-white/70">{c.icon}</div>}
                      <div className="min-w-0">
                        <div className="text-[13px] text-white/90 truncate">{c.title}</div>
                        {(c.description || c.group) && (
                          <div className="text-[11px] text-white/45 truncate">
                            {c.description ? c.description : c.group}
                          </div>
                        )}
                      </div>
                    </div>
                    {c.shortcut && <div className="text-[11px] text-white/50 whitespace-nowrap ml-2">{c.shortcut}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-3 py-2 text-[11px] text-white/40 border-t border-white/10 flex items-center justify-between">
          <div>Enter to run • Esc to close • ↑↓ to navigate</div>
          <div>F1 or Ctrl + /</div>
        </div>
      </div>
    </div>
  );
}
