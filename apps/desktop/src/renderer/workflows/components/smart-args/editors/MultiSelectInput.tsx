/**
 * MultiSelectInput - Searchable multi-select dropdown with tag chips and category grouping
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, X, Search } from 'lucide-react';
import type { ArgOption } from '../../../constants/tool-schemas';

interface MultiSelectInputProps {
  value: any[];
  onChange: (v: any[]) => void;
  options: ArgOption[];
  placeholder?: string;
  emptyLabel?: string;
  allLabel?: string;
}

export function MultiSelectInput({ value, onChange, options, placeholder, emptyLabel, allLabel }: MultiSelectInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => new Set(Array.isArray(value) ? value.map(String) : []), [value]);

  // Group options by category
  const groups = useMemo(() => {
    const map = new Map<string, ArgOption[]>();
    for (const opt of options) {
      const g = opt.group || 'Other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(opt);
    }
    return map;
  }, [options]);

  const filteredGroups = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return groups;
    const map = new Map<string, ArgOption[]>();
    for (const [group, opts] of groups) {
      const filtered = opts.filter(o =>
        o.label.toLowerCase().includes(q) ||
        String(o.value).toLowerCase().includes(q) ||
        (o.description || '').toLowerCase().includes(q) ||
        group.toLowerCase().includes(q)
      );
      if (filtered.length > 0) map.set(group, filtered);
    }
    return map;
  }, [groups, search]);

  const totalFiltered = useMemo(() => {
    let c = 0;
    for (const opts of filteredGroups.values()) c += opts.length;
    return c;
  }, [filteredGroups]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const toggle = (optValue: string | number | boolean) => {
    const key = String(optValue);
    const newSet = new Set(selected);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    onChange(Array.from(newSet));
  };

  const selectAll = () => {
    onChange(options.map(o => String(o.value)));
  };

  const selectNone = () => {
    onChange([]);
  };

  const selectGroup = (groupName: string) => {
    const groupOpts = groups.get(groupName) || [];
    const newSet = new Set(selected);
    const allSelected = groupOpts.every(o => newSet.has(String(o.value)));
    if (allSelected) {
      groupOpts.forEach(o => newSet.delete(String(o.value)));
    } else {
      groupOpts.forEach(o => newSet.add(String(o.value)));
    }
    onChange(Array.from(newSet));
  };

  // Build display label
  const displayLabel = selected.size === 0
    ? (emptyLabel || 'All tools (default)')
    : selected.size === options.length
      ? (allLabel || `All ${options.length} tools`)
      : `${selected.size} tool${selected.size !== 1 ? 's' : ''} selected`;

  // Selected items as chips (show up to 6)
  const selectedOptions = options.filter(o => selected.has(String(o.value)));
  const chipLimit = 6;
  const visibleChips = selectedOptions.slice(0, chipLimit);
  const overflowCount = selectedOptions.length - chipLimit;

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 text-sm border border-white/[0.08] rounded-xl bg-white/[0.04] hover:bg-white/[0.06] hover:border-white/[0.12] flex items-center justify-between gap-2 transition-all shadow-sm"
      >
        <span className={selected.size > 0 ? 'text-white/80 font-medium' : 'text-white/40'}>
          {displayLabel}
        </span>
        <ChevronDown className={`w-4 h-4 text-white/40 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Selected chips */}
      {selected.size > 0 && selected.size < options.length && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {visibleChips.map(opt => (
            <span
              key={String(opt.value)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100 group/chip"
            >
              {opt.label}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggle(opt.value); }}
                className="p-0.5 rounded hover:bg-indigo-200/50 transition-colors opacity-60 group-hover/chip:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {overflowCount > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-white/[0.06] text-white/50 rounded-lg">
              +{overflowCount} more
            </span>
          )}
          <button
            type="button"
            onClick={selectNone}
            className="inline-flex items-center px-2 py-1 text-xs text-white/40 hover:text-red-500 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 w-full mt-2 bg-white/[0.04] border border-white/[0.04] rounded-xl shadow-xl max-h-80 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Search + bulk actions */}
          <div className="p-2.5 border-b border-white/[0.04] bg-slate-50/50 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tools..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50"
              />
            </div>
            {!search && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={selectNone}
                  className="px-3 py-1.5 text-xs font-medium text-white/50 bg-white/[0.06] hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Clear All
                </button>
              </div>
            )}
          </div>

          {/* Options grouped by category */}
          <div className="overflow-y-auto max-h-56 p-1">
            {totalFiltered === 0 && (
              <div className="px-3 py-8 text-sm text-white/40 text-center">No matching tools</div>
            )}
            {Array.from(filteredGroups.entries()).map(([groupName, groupOpts]) => {
              const allGroupSelected = groupOpts.every(o => selected.has(String(o.value)));
              const someGroupSelected = groupOpts.some(o => selected.has(String(o.value)));
              return (
                <div key={groupName}>
                  {/* Group header */}
                  <button
                    type="button"
                    onClick={() => selectGroup(groupName)}
                    className="w-full px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-white/40 hover:text-indigo-600 hover:bg-indigo-50/50 flex items-center gap-2 transition-colors sticky top-0 bg-white/95 backdrop-blur-sm"
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      allGroupSelected ? 'bg-indigo-600 border-indigo-600' : someGroupSelected ? 'bg-indigo-100 border-indigo-300' : 'border-white/[0.12]'
                    }`}>
                      {allGroupSelected && <Check className="w-2.5 h-2.5 text-white" />}
                      {someGroupSelected && !allGroupSelected && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-sm" />}
                    </div>
                    {groupName}
                    <span className="text-[10px] font-normal normal-case text-slate-300 ml-auto">
                      {groupOpts.filter(o => selected.has(String(o.value))).length}/{groupOpts.length}
                    </span>
                  </button>
                  {/* Group items */}
                  {groupOpts.map(opt => {
                    const isSelected = selected.has(String(opt.value));
                    return (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => toggle(opt.value)}
                        className={`w-full px-3 py-1.5 pl-7 text-left text-sm rounded-lg flex items-center gap-2 transition-colors mb-0.5 ${
                          isSelected ? 'bg-indigo-50/70 text-indigo-700' : 'text-white/70 hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-white/[0.12] bg-white/[0.04]'
                        }`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px]">{opt.label}</div>
                          {opt.description && (
                            <div className="text-[11px] text-white/40 truncate">{opt.description}</div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

