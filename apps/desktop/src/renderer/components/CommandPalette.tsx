import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2 } from "lucide-react";

export interface CommandItem {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  group?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
  onQueryChange?: (query: string) => void;
  loading?: boolean;
}

export default function CommandPalette({ open, onClose, commands, onQueryChange, loading }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Grouped commands
  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};

    // Filter locally if onQueryChange is NOT provided (legacy mode), 
    // otherwise assume parent handles filtering or we are showing all results passed
    const filtered = onQueryChange
      ? commands
      : (query.trim() ? commands.filter(c =>
        c.title.toLowerCase().includes(query.toLowerCase()) ||
        (c.group || '').toLowerCase().includes(query.toLowerCase())
      ) : commands);

    filtered.forEach(cmd => {
      const g = cmd.group || 'Commands';
      if (!groups[g]) groups[g] = [];
      groups[g].push(cmd);
    });

    // Flatten for keyboard navigation
    const flat: CommandItem[] = [];
    const orderedGroups = Object.keys(groups).sort((a, b) => {
      // Prioritize "Commands" or "Actions"
      if (a === 'Commands' || a === 'Actions') return -1;
      if (b === 'Commands' || b === 'Actions') return 1;
      // "Local Workflows" second
      if (a === 'Local Workflows') return -1;
      if (b === 'Local Workflows') return 1;
      return a.localeCompare(b);
    });

    orderedGroups.forEach(g => {
      flat.push(...groups[g]);
    });

    return { groups, flat, orderedGroups };
  }, [query, commands, onQueryChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Notify parent of query change
  useEffect(() => {
    if (open && onQueryChange) {
      onQueryChange(query);
    }
  }, [query, open, onQueryChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, grouped.flat.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = grouped.flat[index];
        if (cmd) { onClose(); setTimeout(() => cmd.run(), 0); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, grouped.flat, onClose]);

  // Ensure index is valid when items change
  useEffect(() => {
    if (index >= grouped.flat.length && grouped.flat.length > 0) {
      setIndex(grouped.flat.length - 1);
    }
  }, [grouped.flat.length]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="w-[640px] max-w-[90vw] flex flex-col rounded-2xl bg-[#1e1e1e]/90 bg-opacity-90 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden font-sans text-white"
            onClick={e => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="relative border-b border-white/10 p-4 shrink-0 flex items-center gap-3">
              <Search className={`w-5 h-5 text-white/50 ${loading ? 'opacity-0' : 'opacity-100'} transition-opacity absolute left-4`} />
              {loading && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin absolute left-4" />}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
                placeholder="Type a command, or search workflows..."
                className="w-full bg-transparent text-lg text-white/90 placeholder:text-white/30 outline-none pl-8 h-8 font-medium"
                autoFocus
              />
              <div className="flex gap-2 text-[10px] font-medium text-white/30 uppercase tracking-wider">
                <span className="bg-white/5 px-1.5 py-0.5 rounded border border-white/5">Esc</span>
                <span>to close</span>
              </div>
            </div>

            {/* Results List */}
            <div className="max-h-[50vh] overflow-y-auto custom-scrollbar p-2 space-y-4">
              {grouped.flat.length === 0 ? (
                <div className="py-12 text-center text-white/30">
                  <p className="text-sm">No results found.</p>
                </div>
              ) : (
                grouped.orderedGroups.map(groupName => {
                  const items = grouped.groups[groupName];
                  if (!items.length) return null;

                  // items start index within the flat array
                  const groupStartIndex = grouped.flat.indexOf(items[0]);

                  return (
                    <div key={groupName}>
                      <div className="px-3 py-1.5 text-[11px] font-semibold text-white/40 uppercase tracking-widest leading-none mb-1">
                        {groupName}
                      </div>
                      <div className="space-y-0.5">
                        {items.map((c, i) => {
                          const globalIndex = groupStartIndex + i;
                          const isSelected = globalIndex === index;
                          return (
                            <button
                              key={c.id}
                              onClick={() => { onClose(); setTimeout(() => c.run(), 0); }}
                              onMouseEnter={() => setIndex(globalIndex)}
                              className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center justify-between transition-all duration-150 group relative
                                ${isSelected
                                  ? 'bg-indigo-500/20 text-white'
                                  : 'text-white/70 hover:bg-white/5'
                                }
                              `}
                            >
                              {/* Selection Indicator bar */}
                              {isSelected && (
                                <motion.div
                                  layoutId="indicator"
                                  className="absolute left-0 top-2 bottom-2 w-0.5 bg-indigo-500 rounded-r-full"
                                />
                              )}

                              <div className="flex items-center gap-3 overflow-hidden min-w-0">
                                <div className={`p-1.5 rounded-md ${isSelected ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-white/50'} transition-colors`}>
                                  {c.icon || <Search className="w-4 h-4" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className={`text-[14px] font-medium truncate ${isSelected ? 'text-white' : 'text-white/90'}`}>
                                    {c.title}
                                  </div>
                                  {c.description && (
                                    <div className={`text-[12px] truncate transition-colors ${isSelected ? 'text-indigo-200/70' : 'text-white/40'}`}>
                                      {c.description}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {c.shortcut && (
                                <div className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${isSelected ? 'border-indigo-400/30 text-indigo-200' : 'border-white/10 text-white/30 bg-white/5'}`}>
                                  {c.shortcut}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-white/[0.02] border-t border-white/5 flex items-center justify-between text-[11px] text-white/30">
              <div className="flex gap-4">
                <span className="flex items-center gap-1.5">
                  <kbd className="font-mono bg-white/10 px-1 rounded text-white/50">↵</kbd>
                  <span>Select</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <kbd className="font-mono bg-white/10 px-1 rounded text-white/50">↑↓</kbd>
                  <span>Navigate</span>
                </span>
              </div>
              <div>Stuard Compact Overlay</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
