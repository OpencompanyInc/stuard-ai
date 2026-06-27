import React from 'react';
import { clsx } from 'clsx';
import { Workflow } from 'lucide-react';
import type { SlashMenuItem } from './types';

interface SlashCommandMenuProps {
  items: SlashMenuItem[];
  selectedIndex: number;
  onHoverIndex: (i: number) => void;
  maxHeight?: number;
  /** compact = portaled pill dropdown; panel = inline card (expanded/window). */
  variant: 'compact' | 'panel';
}

/**
 * The "/" command menu — a flat list of built-in commands and runnable
 * workflows. The host owns positioning (compact overlay portal vs. an
 * absolutely-positioned card above the textarea) and keyboard selection.
 */
export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  items,
  selectedIndex,
  onHoverIndex,
  maxHeight,
  variant,
}) => {
  return (
    <div
      className={clsx(
        'overflow-hidden flex flex-col',
        variant === 'panel' && 'rounded-2xl border border-theme bg-theme-card shadow-xl',
      )}
      style={{
        ...(maxHeight ? { maxHeight } : {}),
        ...(variant === 'compact'
          ? {
              background: 'rgb(var(--compact-pill-bg))',
              borderRadius: 12,
              boxShadow: 'var(--compact-pill-shadow)',
            }
          : {}),
      }}
    >
      <div className="overflow-y-auto custom-scrollbar p-1.5 flex flex-col gap-0.5">
        {items.map((item, i) => {
          const Icon = item.icon;
          const selected = i === selectedIndex;
          return (
            <button
              key={item.key}
              type="button"
              onMouseEnter={() => onHoverIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => item.onSelect()}
              className={clsx(
                'no-drag w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors',
                selected ? 'bg-theme-hover' : 'hover:bg-theme-hover/60',
              )}
            >
              <span
                className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                style={{
                  background: item.kind === 'workflow'
                    ? 'color-mix(in srgb, #7C3AED 14%, transparent)'
                    : 'color-mix(in srgb, var(--primary) 12%, transparent)',
                  color: item.kind === 'workflow' ? '#a78bfa' : 'var(--primary)',
                }}
              >
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold text-theme-fg truncate">{item.title}</span>
                <span className="block text-[11px] text-theme-muted truncate">{item.subtitle}</span>
              </span>
              {item.kind === 'workflow' && (
                <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-medium text-theme-muted">
                  <Workflow className="w-3 h-3" />
                  Workflow
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-theme/40 text-[10px] text-theme-muted">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>esc dismiss</span>
      </div>
    </div>
  );
};

export default SlashCommandMenu;
