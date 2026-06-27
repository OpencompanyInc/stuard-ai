import React from 'react';
import { clsx } from 'clsx';
import { AppWindow, Columns2, Minimize2, PanelRight } from 'lucide-react';

type LayoutMode = 'app' | 'window' | 'sidebar' | 'compact';

const MODES: Array<{ mode: LayoutMode; label: string; Icon: React.ComponentType<any> }> = [
  { mode: 'app', label: 'Workspace', Icon: PanelRight },
  { mode: 'window', label: 'Window', Icon: AppWindow },
  { mode: 'sidebar', label: 'Split', Icon: Columns2 },
  { mode: 'compact', label: 'Compact', Icon: Minimize2 },
];

interface LayoutSwitcherProps {
  overlayMode?: 'compact' | 'sidebar' | 'window' | 'app';
  onCollapse?: () => void;
  /** Flat styling for the native Workspace shell (no pill border). */
  variant?: 'default' | 'app';
}

/** Compact icon strip — switches layout without bloating the menu dropdown. */
export const LayoutSwitcher: React.FC<LayoutSwitcherProps> = ({
  overlayMode,
  onCollapse,
  variant = 'default',
}) => {
  const go = (mode: LayoutMode) => {
    if (mode === 'compact') {
      onCollapse?.();
      return;
    }
    try { (window as any).desktopAPI?.setMode?.(mode); } catch { /* noop */ }
    try { (window as any).desktopAPI?.setIgnoreMouseEvents?.(false); } catch { /* noop */ }
  };

  return (
    <div
      className={clsx(
        'flex items-center rounded-md p-0.5 shrink-0',
        variant === 'app'
          ? 'border border-theme/8 bg-theme-card/40'
          : 'border border-theme/10 bg-theme-bg/50',
      )}
      role="toolbar"
      aria-label="Layout"
    >
      {MODES.map(({ mode, label, Icon }) => {
        const active = overlayMode === mode;
        return (
          <button
            key={mode}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => go(mode)}
            className={clsx(
              'h-7 w-7 rounded flex items-center justify-center transition-colors',
              active
                ? 'bg-primary/15 text-primary'
                : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover',
            )}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
};
