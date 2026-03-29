import React, { useEffect, useState, useRef } from "react";
import { clsx } from "clsx";
import { Bot, Globe, Layers, ListTodo, Maximize2, Terminal, X } from "lucide-react";
import { SpacesSidebar } from "./SpacesSidebar";
import { SubAgentsView } from "./SubAgentsView";
import { XTerminalPanel } from "./XTerminalPanel";
import { SidebarBrowserPanel } from "./sidebar/SidebarBrowserPanel";
import { SidebarTodoPanel } from "./sidebar/SidebarTodoPanel";

type SidebarTabId = "spaces" | "terminal" | "tasks" | "browser" | "todo";

const SIDEBAR_TABS: Array<{
  id: SidebarTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "spaces", label: "Spaces", icon: Layers },
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
  const panelShadow = translucentMode
    ? "0 20px 48px rgba(15, 23, 42, 0.16)"
    : "0 18px 42px rgba(15, 23, 42, 0.10)";
  const railBackground = translucentMode
    ? "color-mix(in srgb, var(--background) 72%, transparent)"
    : "color-mix(in srgb, var(--background) 78%, var(--card-bg) 22%)";
  const contentBackground = translucentMode
    ? "color-mix(in srgb, var(--card-bg) 78%, transparent)"
    : "color-mix(in srgb, var(--card-bg) 92%, var(--background) 8%)";

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
        "relative h-full min-h-0 shrink-0 flex overflow-hidden rounded-l-[32px] border border-theme",
        translucentMode
          ? "bg-theme-bg backdrop-blur-3xl"
          : "bg-theme-card",
      )}
      style={{
        boxShadow: panelShadow,
        transition: "transform 150ms ease-out, opacity 150ms ease-out",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at top, color-mix(in srgb, var(--primary) 12%, transparent) 0%, transparent 42%)",
        }}
      />

      {/* Icon Rail */}
      <div
        className="relative flex flex-col items-center w-[60px] shrink-0 px-2 py-3 gap-2 border-r border-theme"
        style={{ background: railBackground }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 shadow-sm">
          <Layers className="w-[18px] h-[18px]" />
        </div>

        <div className="h-px w-8 bg-theme-hover" />

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
              aria-label={tab.label}
              aria-pressed={isActive}
              className={clsx(
                "relative flex items-center justify-center w-10 h-10 rounded-2xl border transition-all duration-150",
                isActive
                  ? "bg-theme-card text-theme-fg border-theme shadow-sm"
                  : "text-theme-muted border-transparent theme-text-hover theme-surface-hover theme-border-hover"
              )}
              title={tab.label}
            >
              <Icon className="w-[18px] h-[18px]" />
              {showDot && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-theme-card animate-pulse" />
              )}
            </button>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        <div className="h-px w-8 bg-theme-hover" />

        {/* Expand to window */}
        <button
          onClick={() => {
            onClose();
            (window as any).desktopAPI?.openSidebar?.({
              tab: activeTab,
              expanded: true,
            });
          }}
          className="flex items-center justify-center w-10 h-10 rounded-2xl border border-transparent text-theme-muted theme-text-hover theme-surface-hover theme-border-hover transition-all"
          title="Open in separate window"
        >
          <Maximize2 className="w-4 h-4" />
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="flex items-center justify-center w-10 h-10 rounded-2xl border border-transparent text-theme-muted hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/20 transition-all"
          title="Close Sidebar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content Area */}
      <div
        className="relative flex-1 min-w-[304px] w-[304px] min-h-0 overflow-hidden"
        style={{ background: contentBackground }}
      >
        {renderContent()}
      </div>
    </div>
  );
};
