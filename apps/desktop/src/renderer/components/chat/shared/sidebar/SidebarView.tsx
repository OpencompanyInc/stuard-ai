import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { FolderKanban, GripVertical, ListTodo, Maximize2, Minimize2, Terminal, X } from 'lucide-react';
import { XTerminalPanel } from '../../../XTerminalPanel';
import { SidebarTodoPanel } from './SidebarTodoPanel';
import { SidebarProjectsPanel } from './SidebarProjectsPanel';

type SidebarTabId = 'terminal' | 'todo' | 'projects';

const SIDEBAR_TABS: Array<{
  id: SidebarTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'todo', label: 'To-Do', icon: ListTodo },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
];

interface SidebarViewProps {
  activeTab: SidebarTabId;
  onTabChange: (tab: SidebarTabId) => void;
  translucentMode?: boolean;
  onClose?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const SidebarView: React.FC<SidebarViewProps> = ({
  activeTab,
  onTabChange,
  translucentMode,
  onClose,
  isExpanded = false,
  onToggleExpand,
}) => {
  const [hasTodoActivity, setHasTodoActivity] = useState(false);
  const [hasTerminalActivity, setHasTerminalActivity] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<SidebarTabId | null>(null);

  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      setHasTodoActivity(true);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setHasTodoActivity(false), 15000);
    };
    window.addEventListener('agent-todo-update', handler);
    return () => {
      if (resetTimer) clearTimeout(resetTimer);
      window.removeEventListener('agent-todo-update', handler);
    };
  }, []);

  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      setHasTerminalActivity(true);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setHasTerminalActivity(false), 15000);
    };
    window.addEventListener('agent-terminal-activity', handler);
    return () => {
      if (resetTimer) clearTimeout(resetTimer);
      window.removeEventListener('agent-terminal-activity', handler);
    };
  }, []);

  // Keyboard navigation: Alt+1..2 to switch tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const idx = parseInt(e.key, 10);
      if (idx >= 1 && idx <= SIDEBAR_TABS.length) {
        e.preventDefault();
        onTabChange(SIDEBAR_TABS[idx - 1].id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTabChange]);

  const handleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      try {
        (window as any).desktopAPI?.toggleSidebarExpanded?.();
      } catch {}
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'todo':
        return <SidebarTodoPanel className="w-full h-full" />;
      case 'projects':
        return <SidebarProjectsPanel className="w-full h-full" />;
      case 'terminal':
        return <XTerminalPanel onClose={onClose} className="w-full h-full" />;
      default:
        return null;
    }
  };

  const currentTab = SIDEBAR_TABS.find((t) => t.id === activeTab);

  return (
    <div className={clsx(
      "w-full h-full flex overflow-hidden rounded-2xl",
      translucentMode
        ? "bg-theme-card/80 backdrop-blur-2xl"
        : "bg-theme-bg"
    )}>
      {/* Icon Rail */}
      <div className="relative flex flex-col items-center w-[52px] shrink-0 py-2.5 gap-0.5 border-r border-theme/5">
        {/* Drag handle */}
        <div
          className="flex items-center justify-center w-9 h-6 mb-1.5 text-theme-muted/30 cursor-grab active:cursor-grabbing"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>

        {/* Tab buttons */}
        <div className="flex flex-col items-center gap-0.5 w-full px-1.5">
          {SIDEBAR_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const isHovered = hoveredTab === tab.id;
            const showDot = (tab.id === 'todo' && hasTodoActivity && !isActive)
              || (tab.id === 'terminal' && hasTerminalActivity && !isActive);

            return (
              <div key={tab.id} className="relative group">
                <button
                  onClick={() => onTabChange(tab.id)}
                  onMouseEnter={() => setHoveredTab(tab.id)}
                  onMouseLeave={() => setHoveredTab(null)}
                  className={clsx(
                    'relative flex items-center justify-center w-full h-10 rounded-xl transition-all duration-200',
                    isActive
                      ? 'bg-theme-hover/70 text-theme-fg'
                      : 'text-theme-muted/70 hover:text-theme-fg hover:bg-theme-hover/40'
                  )}
                  title={tab.label}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  <Icon className={clsx(
                    "transition-transform duration-200",
                    isActive ? "w-[18px] h-[18px]" : "w-[17px] h-[17px]",
                    isHovered && !isActive && "scale-110"
                  )} />

                  {/* Activity dot */}
                  {showDot && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-theme-bg animate-pulse" />
                  )}

                  {/* Active indicator bar */}
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-theme-fg/70 rounded-r-full" />
                  )}
                </button>

                {/* Tooltip */}
                <div className={clsx(
                  "absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap pointer-events-none transition-all duration-150 z-50",
                  "bg-theme-card text-theme-fg shadow-lg border border-theme/10",
                  isHovered ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1"
                )}>
                  {tab.label}
                  <span className="ml-1.5 text-[10px] text-theme-muted font-normal">Alt+{SIDEBAR_TABS.indexOf(tab) + 1}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom actions */}
        <div className="flex flex-col items-center gap-0.5 px-1.5 w-full">
          <button
            onClick={handleExpand}
            className="flex items-center justify-center w-full h-9 rounded-xl text-theme-muted/60 hover:text-theme-fg hover:bg-theme-hover/60 transition-all duration-200"
            title={isExpanded ? "Collapse to sidebar" : "Expand to full window"}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onClose}
            className="flex items-center justify-center w-full h-9 rounded-xl text-theme-muted/60 hover:text-red-500 hover:bg-red-500/8 transition-all duration-200"
            title="Close Sidebar"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {/* Content Header */}
        <div
          className="flex items-center justify-between px-4 h-11 border-b border-theme/5 shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {currentTab && (
              <>
                <currentTab.icon className="w-4 h-4 text-theme-fg/70" />
                <span className="text-[13px] font-bold text-theme-fg">{currentTab.label}</span>
              </>
            )}
            {((activeTab === 'todo' && hasTodoActivity) || (activeTab === 'terminal' && hasTerminalActivity)) && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[9px] font-bold uppercase tracking-wider leading-none">
                Active
              </span>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-hidden" key={activeTab} style={{ animation: 'sidebarFadeIn 150ms ease-out' }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default SidebarView;
