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
    <div className="flex items-stretch w-full rounded-2xl border wf-border-subtle wf-bg-overlay p-1 gap-1">
      <button
        onClick={() => onChange(true)}
        className={`flex-1 flex items-center justify-center py-3 text-sm font-medium transition-all rounded-xl ${value
            ? 'wf-bg-elevated wf-fg shadow'
            : 'wf-fg-muted wf-hover-fg wf-hover-bg'
          }`}
      >
        {yesLabel}
      </button>
      <button
        onClick={() => onChange(false)}
        className={`flex-1 flex items-center justify-center py-3 text-sm font-medium transition-all rounded-xl ${!value
            ? 'wf-bg-elevated wf-fg shadow'
            : 'wf-fg-muted wf-hover-fg wf-hover-bg'
          }`}
      >
        {noLabel}
      </button>
    </div>
  );
}

