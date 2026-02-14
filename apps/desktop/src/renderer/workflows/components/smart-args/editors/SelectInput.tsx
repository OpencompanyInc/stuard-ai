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
}

export function SelectInput({ value, onChange, options, placeholder }: SelectInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    String(o.value).toLowerCase().includes(search.toLowerCase())
  );

  // Use loose equality so numeric options (e.g. 10) match string values ("10") from serialized args
  const selectedOption = options.find(o => o.value == value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white hover:bg-slate-50 hover:border-slate-300 flex items-center justify-between gap-2 transition-all shadow-sm"
      >
        <span className={selectedOption ? 'text-slate-700 font-medium' : 'text-slate-400'}>
          {selectedOption?.label || placeholder || 'Select an option...'}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-xl shadow-xl max-h-72 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {options.length > 5 && (
            <div className="p-2 border-b border-slate-100 bg-slate-50/50">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search options..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                autoFocus
              />
            </div>
          )}
          <div className="overflow-y-auto max-h-60 p-1">
            {filteredOptions.map(opt => (
              <button
                key={String(opt.value)}
                onClick={() => { onChange(opt.value); setOpen(false); setSearch(''); }}
                className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center justify-between gap-2 transition-colors mb-0.5 ${opt.value == value
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <div>
                  <div>{opt.label}</div>
                  {opt.description && (
                    <div className="text-xs text-slate-400 font-normal">{opt.description}</div>
                  )}
                </div>
                {opt.value == value && <Check className="w-4 h-4 text-indigo-600" />}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-8 text-sm text-slate-400 text-center">No matching options</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
