import React, { useEffect, useState, useRef } from "react";
import { clsx } from "clsx";
import { ArrowLeft, Bot, Globe, Layers, ListTodo, Maximize2, Terminal, X } from "lucide-react";
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
  const contentBackground = translucentMode
    ? "color-mix(in srgb, var(--card-bg) 78%, transparent)"
    : "color-mix(in srgb, var(--card-bg) 92%, var(--background) 8%)";

  const [showTabPicker, setShowTabPicker] = useState(false);

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

  useEffect(() => {
    if (hasRunningAgents && !agentAutoSwitchedRef.current && activeTab !== "tasks" && activeTab !== "browser") {
      agentAutoSwitchedRef.current = true;
      onSwitchTab("tasks");
    }
    if (!hasRunningAgents) {
      agentAutoSwitchedRef.current = false;
    }
  }, [hasRunningAgents, activeTab, onSwitchTab]);

  useEffect(() => {
    if (hasBrowserActivity && !browserAutoSwitchedRef.current && activeTab !== "browser") {
      browserAutoSwitchedRef.current = true;
      onSwitchTab("browser");
    }
    if (!hasBrowserActivity) {
      browserAutoSwitchedRef.current = false;
    }
  }, [hasBrowserActivity, activeTab, onSwitchTab]);

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
    if (hasTodoActivity && !todoAutoSwitchedRef.current && activeTab !== "todo" && activeTab !== "browser") {
      todoAutoSwitchedRef.current = true;
      onSwitchTab("todo");
    }
    if (!hasTodoActivity) {
      todoAutoSwitchedRef.current = false;
    }
  }, [hasTodoActivity, activeTab, onSwitchTab]);

  const currentTab = SIDEBAR_TABS.find((t) => t.id === activeTab);

  const handleSelectTab = (id: SidebarTabId) => {
    onSwitchTab(id);
    setShowTabPicker(false);
  };

  const renderContent = () => {
    switch (activeTab) {
      case "spaces":
        return (
          <SpacesSidebar
            onClose={onClose}
            className="w-full h-full"
            translucentMode={translucentMode}
            embedded
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
        "relative h-full min-h-0 shrink-0 flex flex-col overflow-hidden rounded-l-[32px] border border-theme",
        translucentMode
          ? "bg-theme-bg backdrop-blur-3xl"
          : "bg-theme-card",
      )}
      style={{
        boxShadow: panelShadow,
        transition: "transform 150ms ease-out, opacity 150ms ease-out",
        width: 304,
        minWidth: 304,
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

      {/* Header Bar */}
      <div className="relative flex items-center gap-2 px-3 py-2.5 shrink-0 border-b border-theme/10">
        <button
          onClick={() => setShowTabPicker(!showTabPicker)}
          className={clsx(
            "flex items-center justify-center w-8 h-8 rounded-xl transition-all",
            showTabPicker
              ? "bg-primary/10 text-primary"
              : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
          )}
          title="Switch tab"
        >
          <ArrowLeft className={clsx("w-4 h-4 transition-transform", showTabPicker && "rotate-90")} />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          {currentTab && (
            <>
              <currentTab.icon className="w-4 h-4 text-primary shrink-0" />
              <span className="text-[13px] font-bold text-theme-fg truncate">{currentTab.label}</span>
            </>
          )}
        </div>

        <button
          onClick={() => {
            onClose();
            (window as any).desktopAPI?.openSidebar?.({
              tab: activeTab,
              expanded: true,
            });
          }}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-all"
          title="Open in separate window"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
          title="Close Sidebar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main area: either tab picker or content */}
      {showTabPicker ? (
        <div
          className="relative flex-1 min-h-0 flex flex-col p-2 gap-1 overflow-y-auto"
          style={{ background: contentBackground }}
        >
          {SIDEBAR_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const showDot = (tab.id === "tasks" && hasRunningAgents && !isActive)
              || (tab.id === "browser" && hasBrowserActivity && !isActive)
              || (tab.id === "todo" && hasTodoActivity && !isActive);

            return (
              <button
                key={tab.id}
                onClick={() => handleSelectTab(tab.id)}
                className={clsx(
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 text-left",
                  isActive
                    ? "bg-primary/10 text-primary font-bold"
                    : "text-theme-fg hover:bg-theme-hover"
                )}
              >
                <div className={clsx(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                  isActive ? "bg-primary/15" : "bg-theme-hover/50"
                )}>
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <span className="text-[13px] font-semibold">{tab.label}</span>
                {showDot && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div
          className="relative flex-1 min-h-0 overflow-hidden"
          style={{ background: contentBackground }}
        >
          {renderContent()}
        </div>
      )}
    </div>
  );
};
