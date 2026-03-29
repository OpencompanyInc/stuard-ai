import React, { useEffect, useState, useRef } from 'react';
import { clsx } from 'clsx';
import { Bot, Globe, GripVertical, Layers, ListTodo, Maximize2, Minimize2, Terminal, X } from 'lucide-react';
import { SpacesSidebar } from '../SpacesSidebar';
import { SubAgentsView } from '../SubAgentsView';
import { XTerminalPanel } from '../XTerminalPanel';
import { SidebarBrowserPanel } from './SidebarBrowserPanel';
import { SidebarTodoPanel } from './SidebarTodoPanel';

type SidebarTabId = 'spaces' | 'terminal' | 'tasks' | 'browser' | 'todo';

const SIDEBAR_TABS: Array<{
  id: SidebarTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'spaces', label: 'Spaces', icon: Layers },
  { id: 'todo', label: 'To-Do', icon: ListTodo },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'tasks', label: 'Agents', icon: Bot },
  { id: 'browser', label: 'Browser', icon: Globe },
];

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || 'http://127.0.0.1:8765';

interface SidebarViewProps {
  activeTab: SidebarTabId;
  onTabChange: (tab: SidebarTabId) => void;
  translucentMode?: boolean;
  onClose?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  selectedItem?: { type: 'space'; id: string } | null;
  onSelectedItemHandled?: () => void;
}

export const SidebarView: React.FC<SidebarViewProps> = ({
  activeTab,
  onTabChange,
  translucentMode,
  onClose,
  isExpanded = false,
  onToggleExpand,
  selectedItem,
  onSelectedItemHandled,
}) => {
  // Auto-switch to tasks/browser/todo tab
  const [hasRunningAgents, setHasRunningAgents] = useState(false);
  const [hasBrowserActivity, setHasBrowserActivity] = useState(false);
  const [hasTodoActivity, setHasTodoActivity] = useState(false);
  const agentAutoSwitchedRef = useRef(false);
  const browserAutoSwitchedRef = useRef(false);
  const todoAutoSwitchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const checkAgents = async () => {
      try {
        const res = await fetch(`${AGENT_HTTP}/v1/subagents/list?limit=10`);
        const data = await res.json();
        if (!cancelled && data.ok && Array.isArray(data.tasks)) {
          const running = data.tasks.some((t: any) => t.status === 'running');
          setHasRunningAgents(running);
        }
      } catch {
        // ignore
      }
    };

    checkAgents();
    const interval = setInterval(checkAgents, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Listen for browser activity
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = (window as any).desktopAPI?.onBrowserActivity?.((data: any) => {
      setHasBrowserActivity(true);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setHasBrowserActivity(false), 10000);
    });
    return () => {
      if (resetTimer) clearTimeout(resetTimer);
      try { typeof unsub === 'function' && unsub(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (hasRunningAgents && !agentAutoSwitchedRef.current && activeTab !== 'tasks' && activeTab !== 'browser') {
      agentAutoSwitchedRef.current = true;
      onTabChange('tasks');
    }
    if (!hasRunningAgents) {
      agentAutoSwitchedRef.current = false;
    }
  }, [hasRunningAgents, activeTab, onTabChange]);

  // Auto-switch to browser tab when agent uses browser
  useEffect(() => {
    if (hasBrowserActivity && !browserAutoSwitchedRef.current && activeTab !== 'browser') {
      browserAutoSwitchedRef.current = true;
      onTabChange('browser');
    }
    if (!hasBrowserActivity) {
      browserAutoSwitchedRef.current = false;
    }
  }, [hasBrowserActivity, activeTab, onTabChange]);

  // Listen for agent todo updates
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

  // Auto-switch to todo tab when agent creates todo items
  useEffect(() => {
    if (hasTodoActivity && !todoAutoSwitchedRef.current && activeTab !== 'todo' && activeTab !== 'browser') {
      todoAutoSwitchedRef.current = true;
      onTabChange('todo');
    }
    if (!hasTodoActivity) {
      todoAutoSwitchedRef.current = false;
    }
  }, [hasTodoActivity, activeTab, onTabChange]);

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
      case 'spaces':
        return (
          <SpacesSidebar
            onClose={onClose}
            className="w-full h-full"
            translucentMode={translucentMode}
            selectedSpaceId={selectedItem?.type === 'space' ? selectedItem.id : undefined}
            onSelectedSpaceHandled={selectedItem?.type === 'space' ? onSelectedItemHandled : undefined}
          />
        );
      case 'todo':
        return <SidebarTodoPanel className="w-full h-full" />;
      case 'terminal':
        return <XTerminalPanel onClose={onClose} className="w-full h-full" />;
      case 'tasks':
        return <SubAgentsView />;
      case 'browser':
        return <SidebarBrowserPanel className="w-full h-full" />;
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
      <div className="flex flex-col items-center w-[52px] shrink-0 py-3 gap-1 border-r border-theme/5 bg-theme-sidebar/50">
        {/* Drag handle */}
        <div
          className="flex items-center justify-center w-9 h-7 mb-1 text-theme-muted/40 cursor-grab"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {SIDEBAR_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const showDot = (tab.id === 'tasks' && hasRunningAgents && !isActive)
            || (tab.id === 'browser' && hasBrowserActivity && !isActive)
            || (tab.id === 'todo' && hasTodoActivity && !isActive);

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={clsx(
                'relative flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-150',
                isActive
                  ? 'bg-theme-card text-theme-fg shadow-sm ring-1 ring-theme/10'
                  : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60'
              )}
              title={tab.label}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Icon className="w-[18px] h-[18px]" />
              {showDot && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-theme-bg animate-pulse" />
              )}
            </button>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Expand/Collapse */}
        <button
          onClick={handleExpand}
          className="flex items-center justify-center w-10 h-10 rounded-xl text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-all"
          title={isExpanded ? "Collapse to sidebar" : "Expand to full window"}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex items-center justify-center w-10 h-10 rounded-xl text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
          title="Close Sidebar"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {/* Content Header */}
        <div
          className="flex items-center px-4 py-2.5 border-b border-theme/5 shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {currentTab && (
              <>
                <currentTab.icon className="w-4 h-4 text-theme-muted" />
                <span className="text-sm font-semibold text-theme-fg">{currentTab.label}</span>
              </>
            )}
            {((activeTab === 'tasks' && hasRunningAgents) || (activeTab === 'browser' && hasBrowserActivity) || (activeTab === 'todo' && hasTodoActivity)) && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-bold uppercase tracking-wider">
                Active
              </span>
            )}
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default SidebarView;
