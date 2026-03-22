import React, { useEffect, useState, useRef } from "react";
import { clsx } from "clsx";
import { Bot, Globe, Layers, ListTodo, Maximize2, NotebookPen, Terminal, X } from "lucide-react";
import { SpacesSidebar } from "./SpacesSidebar";
import { SubAgentsView } from "./SubAgentsView";
import { XTerminalPanel } from "./XTerminalPanel";
import { SidebarBrowserPanel } from "./sidebar/SidebarBrowserPanel";
import { QuickNotesPanel } from "./sidebar/QuickNotesPanel";
import { SidebarTodoPanel } from "./sidebar/SidebarTodoPanel";

type SidebarTabId = "spaces" | "canvas" | "terminal" | "tasks" | "browser" | "todo";

const SIDEBAR_TABS: Array<{
  id: SidebarTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "spaces", label: "Spaces", icon: Layers },
  { id: "canvas", label: "Notes", icon: NotebookPen },
  { id: "todo", label: "To-Do", icon: ListTodo },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "tasks", label: "Agents", icon: Bot },
  { id: "browser", label: "Browser", icon: Globe },
];

const AGENT_HTTP = (window as any).__AGENT_HTTP__ || "http://127.0.0.1:8765";

interface SidebarTabsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: SidebarTabId;
  onSwitchTab: (tab: SidebarTabId) => void;
  translucentMode?: boolean;
}

export const SidebarTabsPanel: React.FC<SidebarTabsPanelProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSwitchTab,
  translucentMode,
}) => {
  // Auto-switch to tasks tab when agents are running
  const [hasRunningAgents, setHasRunningAgents] = useState(false);
  const [hasBrowserActivity, setHasBrowserActivity] = useState(false);
  const [hasTodoActivity, setHasTodoActivity] = useState(false);
  const agentAutoSwitchedRef = useRef(false);
  const browserAutoSwitchedRef = useRef(false);
  const todoAutoSwitchedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const checkAgents = async () => {
      try {
        const res = await fetch(`${AGENT_HTTP}/v1/subagents/list?limit=10`);
        const data = await res.json();
        if (!cancelled && data.ok && Array.isArray(data.tasks)) {
          const running = data.tasks.some((t: any) => t.status === "running");
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
  }, [isOpen]);

  // Listen for browser activity from agent system
  useEffect(() => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = window.desktopAPI?.onBrowserActivity?.(() => {
      setHasBrowserActivity(true);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setHasBrowserActivity(false), 10000);
    });
    return () => {
      if (resetTimer) clearTimeout(resetTimer);
      try { typeof unsub === 'function' && unsub(); } catch {}
    };
  }, []);

  // Auto-switch to tasks tab when agents start running
  useEffect(() => {
    if (hasRunningAgents && !agentAutoSwitchedRef.current && activeTab !== "tasks" && activeTab !== "browser") {
      agentAutoSwitchedRef.current = true;
      onSwitchTab("tasks");
    }
    if (!hasRunningAgents) {
      agentAutoSwitchedRef.current = false;
    }
  }, [hasRunningAgents, activeTab, onSwitchTab]);

  // Auto-switch to browser tab when agent uses browser
  useEffect(() => {
    if (hasBrowserActivity && !browserAutoSwitchedRef.current && activeTab !== "browser") {
      browserAutoSwitchedRef.current = true;
      onSwitchTab("browser");
    }
    if (!hasBrowserActivity) {
      browserAutoSwitchedRef.current = false;
    }
  }, [hasBrowserActivity, activeTab, onSwitchTab]);

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
    if (hasTodoActivity && !todoAutoSwitchedRef.current && activeTab !== "todo" && activeTab !== "browser") {
      todoAutoSwitchedRef.current = true;
      onSwitchTab("todo");
    }
    if (!hasTodoActivity) {
      todoAutoSwitchedRef.current = false;
    }
  }, [hasTodoActivity, activeTab, onSwitchTab]);

  const renderContent = () => {
    switch (activeTab) {
      case "spaces":
        return (
          <SpacesSidebar
            onClose={onClose}
            className="w-full h-full"
            translucentMode={translucentMode}
          />
        );
      case "canvas":
        return <QuickNotesPanel className="w-full h-full" />;
      case "todo":
        return <SidebarTodoPanel className="w-full h-full" />;
      case "terminal":
        return <XTerminalPanel onClose={onClose} className="w-full h-full" />;
      case "tasks":
        return <SubAgentsView compact />;
      case "browser":
        return <SidebarBrowserPanel className="w-full h-full" />;
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={clsx(
        "h-full min-h-0 shrink-0 flex overflow-hidden rounded-l-[28px] border-r border-theme/5",
        translucentMode
          ? "bg-theme-bg/30 backdrop-blur-3xl"
          : "bg-theme-sidebar",
      )}
      style={{ transition: "transform 150ms ease-out, opacity 150ms ease-out" }}
    >
      {/* Icon Rail */}
      <div className="flex flex-col items-center w-[48px] shrink-0 py-3 gap-1 border-r border-theme/5">
        {SIDEBAR_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const showDot = (tab.id === "tasks" && hasRunningAgents && !isActive)
            || (tab.id === "browser" && hasBrowserActivity && !isActive)
            || (tab.id === "todo" && hasTodoActivity && !isActive);

          return (
            <button
              key={tab.id}
              onClick={() => onSwitchTab(tab.id)}
              className={clsx(
                "relative flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-150",
                isActive
                  ? "bg-theme-card text-theme-fg shadow-sm ring-1 ring-theme/10"
                  : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60"
              )}
              title={tab.label}
            >
              <Icon className="w-[18px] h-[18px]" />
              {showDot && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-theme-sidebar animate-pulse" />
              )}
            </button>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Expand to window */}
        <button
          onClick={() => {
            onClose();
            (window as any).desktopAPI?.openSidebar?.({
              tab: activeTab,
              expanded: true,
            });
          }}
          className="flex items-center justify-center w-9 h-9 rounded-xl text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-all"
          title="Open in separate window"
        >
          <Maximize2 className="w-4 h-4" />
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex items-center justify-center w-9 h-9 rounded-xl text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
          title="Close Sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden w-[272px]">
        {renderContent()}
      </div>
    </div>
  );
};
