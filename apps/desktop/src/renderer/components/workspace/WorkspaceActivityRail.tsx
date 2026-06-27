import React from 'react';
import { clsx } from 'clsx';
import {
  AppWindow,
  Columns2,
  FolderOpen,
  MessageSquare,
  Minimize2,
  PanelRight,
  Plus,
} from 'lucide-react';

export type WorkspaceSection = 'chat' | 'files';

type LayoutMode = 'app' | 'window' | 'sidebar' | 'compact';

const LAYOUT_MODES: Array<{ mode: LayoutMode; label: string; Icon: React.ComponentType<any> }> = [
  { mode: 'app', label: 'Workspace', Icon: PanelRight },
  { mode: 'window', label: 'Window', Icon: AppWindow },
  { mode: 'sidebar', label: 'Split', Icon: Columns2 },
  { mode: 'compact', label: 'Compact', Icon: Minimize2 },
];

interface WorkspaceActivityRailProps {
  section: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
  onNewChat?: () => void;
  onCollapse?: () => void;
}

/** Narrow left icon rail — primary navigation for the Workspace window. */
export const WorkspaceActivityRail: React.FC<WorkspaceActivityRailProps> = ({
  section,
  onSectionChange,
  onNewChat,
  onCollapse,
}) => {
  const goLayout = (mode: LayoutMode) => {
    if (mode === 'compact') {
      onCollapse?.();
      return;
    }
    try { (window as any).desktopAPI?.setMode?.(mode); } catch { /* noop */ }
    try { (window as any).desktopAPI?.setIgnoreMouseEvents?.(false); } catch { /* noop */ }
  };

  return (
    <nav
      className="workspace-activity-rail w-[52px] shrink-0 flex flex-col items-center py-2 border-r border-theme/10 bg-theme-card/40"
      aria-label="Workspace navigation"
    >
      <RailBtn
        active={section === 'chat'}
        label="Chat"
        onClick={() => onSectionChange('chat')}
      >
        <MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.75} />
      </RailBtn>
      <RailBtn
        active={section === 'files'}
        label="Files"
        onClick={() => onSectionChange('files')}
      >
        <FolderOpen className="w-[18px] h-[18px]" strokeWidth={1.75} />
      </RailBtn>
      <RailBtn label="New chat" onClick={onNewChat}>
        <Plus className="w-[18px] h-[18px]" strokeWidth={1.75} />
      </RailBtn>

      <div className="flex-1 min-h-4" />

      <div className="flex flex-col items-center gap-0.5 pt-2 border-t border-theme/10 w-full px-1.5">
        {LAYOUT_MODES.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            title={label}
            aria-label={label}
            onClick={() => goLayout(mode)}
            className={clsx(
              'w-full h-9 flex items-center justify-center rounded-lg transition-colors focus:outline-none',
              mode === 'app'
                ? 'text-primary bg-primary/10'
                : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover',
            )}
          >
            <Icon className="w-[16px] h-[16px]" strokeWidth={1.75} />
          </button>
        ))}
      </div>
    </nav>
  );
};

const RailBtn: React.FC<{
  active?: boolean;
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}> = ({ active, label, onClick, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-current={active ? 'page' : undefined}
    onClick={onClick}
    className={clsx(
      'w-10 h-10 flex items-center justify-center mb-0.5 transition-colors',
      active
        ? 'text-primary bg-primary/12'
        : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover',
    )}
  >
    {children}
  </button>
);
