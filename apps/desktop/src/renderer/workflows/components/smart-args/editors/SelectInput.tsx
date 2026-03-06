/**
 * SelectInput - Searchable dropdown select
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import type { ArgOption } from '../../../constants/tool-schemas';

interface SelectInputProps {
  value: any;
  onChange: (v: any) => void;
  options: ArgOption[];
  placeholder?: string;
  allowFreeform?: boolean;
}

export function SelectInput({ value, onChange, options, placeholder, allowFreeform }: SelectInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updateDropdownPos = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = 288; // max-h-72 = 18rem = 288px
    const showAbove = spaceBelow < dropdownHeight && rect.top > spaceBelow;
    setDropdownPos({
      top: showAbove ? rect.top - dropdownHeight : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  const filteredOptions = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    String(o.value).toLowerCase().includes(search.toLowerCase())
  );

  // Use loose equality so numeric options (e.g. 10) match string values ("10") from serialized args
  const selectedOption = options.find(o => o.value == value);
  // Check if current value is a custom (non-preset) value
  const isCustomValue = value && !selectedOption;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inContainer && !inDropdown) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Whether to show the search/freeform input
  const showSearchInput = options.length > 5 || allowFreeform;

  // Determine if should show "Use custom value" option
  const searchTrimmed = search.trim();
  const showCustomOption = allowFreeform && searchTrimmed && !options.some(o =>
    String(o.value).toLowerCase() === searchTrimmed.toLowerCase() ||
    o.label.toLowerCase() === searchTrimmed.toLowerCase()
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => { if (!open) updateDropdownPos(); setOpen(!open); }}
        className="w-full px-4 py-2.5 text-sm border border-white/[0.08] rounded-xl bg-white/[0.04] hover:bg-white/[0.06] hover:border-white/[0.12] flex items-center justify-between gap-2 transition-all shadow-sm"
      >
        <span className={selectedOption || isCustomValue ? 'text-white/80 font-medium' : 'text-white/40'}>
          {selectedOption?.label || (isCustomValue ? String(value) : (placeholder || 'Select an option...'))}
        </span>
        <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999,
          }}
          className="bg-black/90 backdrop-blur-2xl border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 max-h-72 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {showSearchInput && (
            <div className="p-2 border-b border-white/[0.04] bg-white/[0.04]">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && allowFreeform && searchTrimmed) {
                    onChange(searchTrimmed);
                    setOpen(false);
                    setSearch('');
                  }
                }}
                placeholder={allowFreeform ? 'Search or type a custom value...' : 'Search options...'}
                className="w-full px-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50"
                autoFocus
              />
            </div>
          )}
          <div className="overflow-y-auto max-h-60 p-1">
            {showCustomOption && (
              <button
                onClick={() => { onChange(searchTrimmed); setOpen(false); setSearch(''); }}
                className="w-full px-3 py-2 text-left text-sm rounded-lg flex items-center gap-2 transition-colors mb-0.5 text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20"
              >
                <span className="font-medium">Use:</span> {searchTrimmed}
              </button>
            )}
            {filteredOptions.map(opt => (
              <button
                key={String(opt.value)}
                onClick={() => { onChange(opt.value); setOpen(false); setSearch(''); }}
                className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center justify-between gap-2 transition-colors mb-0.5 ${opt.value == value
                  ? 'bg-indigo-500/10 text-indigo-400 font-medium'
                  : 'text-white/80 hover:bg-white/[0.06]'
                  }`}
              >
                <div>
                  <div>{opt.label}</div>
                  {opt.description && (
                    <div className="text-xs text-white/40 font-normal">{opt.description}</div>
                  )}
                </div>
                {opt.value == value && <Check className="w-4 h-4 text-indigo-400" />}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-8 text-sm text-white/40 text-center">No matching options</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

