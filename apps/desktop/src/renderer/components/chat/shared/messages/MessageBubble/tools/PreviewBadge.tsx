import React from 'react';

export const PreviewBadge: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px]"
    style={{
      backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 50%, transparent)',
      color: 'var(--foreground)',
    }}
  >
    <span className="text-theme-muted">{label}:</span>
    <span className="truncate font-medium">{value}</span>
  </div>
);
