/**
 * SelectInput - Searchable dropdown select
 */
import React, { useState, useRef, useEffect } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);

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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 text-sm border border-white/[0.08] rounded-xl bg-white/[0.04] hover:bg-white/[0.06] hover:border-white/[0.12] flex items-center justify-between gap-2 transition-all shadow-sm"
      >
        <span className={selectedOption || isCustomValue ? 'text-white/80 font-medium' : 'text-white/40'}>
          {selectedOption?.label || (isCustomValue ? String(value) : (placeholder || 'Select an option...'))}
        </span>
        <ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-2 bg-white/[0.04] border border-white/[0.04] rounded-xl shadow-2xl shadow-black/50 max-h-72 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
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
                className="w-full px-3 py-2 text-left text-sm rounded-lg flex items-center gap-2 transition-colors mb-0.5 text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/200/10"
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
        </div>
      )}
    </div>
  );
}

