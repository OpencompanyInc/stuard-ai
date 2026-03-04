/**
 * BooleanToggle - Modern toggle with Yes/No button options
 */
import React from 'react';
import { Check, X } from 'lucide-react';

interface BooleanToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}

export function BooleanToggle({ value, onChange, yesLabel = 'Yes', noLabel = 'No' }: BooleanToggleProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-white/[0.06] rounded-xl w-fit">
      <button
        onClick={() => onChange(true)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          value 
            ? 'bg-emerald-500/100 text-white shadow-sm' 
            : 'text-white/50 hover:text-white/80 hover:bg-slate-200'
        }`}
      >
        <Check className={`w-4 h-4 ${value ? 'opacity-100' : 'opacity-40'}`} />
        {yesLabel}
      </button>
      <button
        onClick={() => onChange(false)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          !value 
            ? 'bg-slate-600 text-white shadow-sm' 
            : 'text-white/50 hover:text-white/80 hover:bg-slate-200'
        }`}
      >
        <X className={`w-4 h-4 ${!value ? 'opacity-100' : 'opacity-40'}`} />
        {noLabel}
      </button>
    </div>
  );
}

