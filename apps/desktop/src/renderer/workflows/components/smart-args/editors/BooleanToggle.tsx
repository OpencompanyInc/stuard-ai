/**
 * BooleanToggle - Modern toggle with Yes/No button options
 */
import React from 'react';

interface BooleanToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}

export function BooleanToggle({ value, onChange, yesLabel = 'Yes', noLabel = 'No' }: BooleanToggleProps) {
  return (
    <div className="flex items-stretch w-full rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1 gap-1">
      <button
        onClick={() => onChange(true)}
        className={`flex-1 flex items-center justify-center py-3 text-sm font-medium transition-all rounded-xl ${value
            ? 'bg-white text-black shadow'
            : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
          }`}
      >
        {yesLabel}
      </button>
      <button
        onClick={() => onChange(false)}
        className={`flex-1 flex items-center justify-center py-3 text-sm font-medium transition-all rounded-xl ${!value
            ? 'bg-white text-black shadow'
            : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
          }`}
      >
        {noLabel}
      </button>
    </div>
  );
}

