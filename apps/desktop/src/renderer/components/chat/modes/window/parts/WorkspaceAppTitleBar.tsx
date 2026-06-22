import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import stuardMark from '@website-assets/stuard-mark.png';

interface WorkspaceAppTitleBarProps {
  onClose?: () => void;
  toolbar?: React.ReactNode;
}

/**
 * Workspace title bar — styled to read like a real desktop application's chrome:
 * a product mark + wordmark on the left, the chat toolbar on the right, and
 * crisp Windows-style caption buttons. Uses the launcher/window surface tokens.
 */
export const WorkspaceAppTitleBar: React.FC<WorkspaceAppTitleBarProps> = ({ onClose, toolbar }) => {
  const minimize = () => {
    try { (window as any).desktopAPI?.overlayMinimize?.(); } catch { /* noop */ }
  };
  const toggleMaximize = () => {
    try { (window as any).desktopAPI?.overlayToggleMaximize?.(); } catch { /* noop */ }
  };

  return (
    <div
      className="workspace-app-titlebar h-11 shrink-0 flex items-stretch select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={toggleMaximize}
    >
      <div
        className="flex items-center pl-3 pr-4 min-w-0 gap-2.5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <img
          src={stuardMark}
          alt=""
          aria-hidden
          className="w-[22px] h-[22px] shrink-0 object-contain"
          draggable={false}
        />
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[13px] font-semibold text-theme-fg tracking-tight">Stuard</span>
          <span className="text-[12px] text-theme-muted hidden sm:inline">Workspace</span>
        </div>
      </div>

      <div className="flex-1 min-w-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {toolbar && (
        <div
          className="flex items-center pr-1.5 shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {toolbar}
        </div>
      )}

      <div
        className="flex items-stretch shrink-0 h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <TitleBtn title="Minimize" onClick={minimize}>
          <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
        </TitleBtn>
        <TitleBtn title="Maximize" onClick={toggleMaximize}>
          <Square className="w-[11px] h-[11px]" strokeWidth={1.75} />
        </TitleBtn>
        <TitleBtn title="Close" onClick={onClose} danger>
          <X className="w-4 h-4" strokeWidth={1.75} />
        </TitleBtn>
      </div>
    </div>
  );
};

const TitleBtn: React.FC<{
  title: string;
  onClick?: () => void;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, danger, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    className={`w-[46px] h-full flex items-center justify-center text-theme-muted transition-colors duration-100 ${
      danger
        ? 'hover:bg-[#e81123] hover:text-white'
        : 'hover:bg-theme-hover hover:text-theme-fg'
    }`}
  >
    {children}
  </button>
);
