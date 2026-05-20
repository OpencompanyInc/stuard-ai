import React from 'react';

// A subtle inline `code`-styled chip used inside step labels to highlight the
// argument that matters most (file path, command, query). Kept small so it
// blends with the surrounding label text.
export const InlineCodeChip: React.FC<{ children: React.ReactNode; title?: string; max?: number }> = ({ children, title, max = 60 }) => {
  const text = typeof children === 'string' ? children : String(children ?? '');
  const display = text.length > max ? text.slice(0, max - 1) + '…' : text;
  return (
    <code
      className="rounded px-1 py-px font-mono text-[11.5px] align-baseline"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--sidebar-item-hover) 60%, transparent)',
        color: 'color-mix(in srgb, var(--foreground) 88%, transparent)',
        wordBreak: 'break-all',
      }}
      title={title || (text !== display ? text : undefined)}
    >
      {display}
    </code>
  );
};
