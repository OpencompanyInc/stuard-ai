import React, { useEffect, useState, useRef } from "react";
import { clsx } from "clsx";
import { ArrowLeft, FolderKanban, ListTodo, Maximize2, Terminal, X } from "lucide-react";
import { XTerminalPanel } from "../../../XTerminalPanel";
import { SidebarTodoPanel } from "./SidebarTodoPanel";
import { SidebarProjectsPanel } from "./SidebarProjectsPanel";

type SidebarTabId = "terminal" | "todo" | "projects";

const SIDEBAR_TABS: Array<{
  id: SidebarTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}> = [
  { id: "todo", label: "To-Do", icon: ListTodo, desc: "Agent task list" },
  { id: "projects", label: "Projects", icon: FolderKanban, desc: "Project mode dashboard" },
  { id: "terminal", label: "Terminal", icon: Terminal, desc: "Shell access" },
];

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
  const panelShadow = "0 18px 40px rgba(15, 23, 42, 0.08)";
  const outerBackground = translucentMode
    ? "color-mix(in srgb, var(--background) 76%, transparent)"
    : undefined;
  const innerBackground = translucentMode
    ? "color-mix(in srgb, var(--card-bg) 84%, transparent)"
    : undefined;

  const [showTabPicker, setShowTabPicker] = useState(false);

  const [hasTodoActivity, setHasTodoActivity] = useState(false);
  const [hasTerminalActivity, setHasTerminalActivity] = useState(false);
  const todoAutoSwitchedRef = useRef(false);
  const terminalAutoSwitchedRef = useRef(false);

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
    if (hasTodoActivity && !todoAutoSwitchedRef.current && activeTab !== "todo") {
      todoAutoSwitchedRef.current = true;
      onSwitchTab("todo");
    }
    if (!hasTodoActivity) {
      todoAutoSwitchedRef.current = false;
    }
  }, [hasTodoActivity, activeTab, onSwitchTab]);

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

  useEffect(() => {
    if (hasTerminalActivity && !terminalAutoSwitchedRef.current && activeTab !== "terminal") {
      terminalAutoSwitchedRef.current = true;
      onSwitchTab("terminal");
    }
    if (!hasTerminalActivity) {
      terminalAutoSwitchedRef.current = false;
    }
  }, [hasTerminalActivity, activeTab, onSwitchTab]);

  const currentTab = SIDEBAR_TABS.find((t) => t.id === activeTab);

  const handleSelectTab = (id: SidebarTabId) => {
    onSwitchTab(id);
    setShowTabPicker(false);
  };

  const renderContent = () => {
    switch (activeTab) {
      case "todo":
        return <SidebarTodoPanel className="w-full h-full" />;
      case "projects":
        return <SidebarProjectsPanel className="w-full h-full" />;
      case "terminal":
        return <XTerminalPanel onClose={onClose} className="w-full h-full" />;
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  const showActiveBadge =
    (activeTab === 'todo' && hasTodoActivity) ||
    (activeTab === 'terminal' && hasTerminalActivity);

  return (
    <div
      className={clsx(
        "relative h-full min-h-0 shrink-0 flex flex-col p-3 overflow-hidden",
        "rounded-l-[28px] rounded-r-none border border-theme/60 border-r-0",
        translucentMode
          ? "bg-theme-bg backdrop-blur-2xl"
          : "bg-theme-bg",
      )}
      style={{
        background: outerBackground,
        boxShadow: panelShadow,
        transition: "transform 150ms ease-out, opacity 150ms ease-out",
        width: 304,
        minWidth: 304,
      }}
    >
      <div
        className={clsx(
          "relative flex-1 min-h-0 flex flex-col overflow-hidden",
          "rounded-l-[24px] rounded-r-none border border-theme border-r-0",
          translucentMode
            ? "bg-theme-bg backdrop-blur-xl"
            : "bg-theme-card shadow-sm",
        )}
        style={{ background: innerBackground }}
      >
        {/* Header Bar — matches chat header padding */}
        <div className="relative flex items-center gap-1 px-2 py-2 shrink-0 border-b border-theme">
          <button
            onClick={() => setShowTabPicker(!showTabPicker)}
            className={clsx(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-colors border border-theme/10",
              showTabPicker
                ? "bg-theme-hover/80 text-theme-fg border-theme/30"
                : "bg-theme-card/80 text-theme-muted hover:bg-theme-hover hover:text-theme-fg"
            )}
            title="Switch tab"
          >
            <ArrowLeft
              className={clsx(
                "w-3.5 h-3.5 transition-transform duration-200",
                showTabPicker && "rotate-[-90deg]"
              )}
            />
          </button>

          <div className="flex items-center gap-2 flex-1 min-w-0 px-1">
            {currentTab && (
              <>
                <currentTab.icon className="w-3.5 h-3.5 text-theme-fg/80 shrink-0" />
                <span className="text-[12px] font-semibold text-theme-fg truncate">
                  {currentTab.label}
                </span>
              </>
            )}
            {showActiveBadge && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[9px] font-bold uppercase tracking-wider leading-none">
                Active
              </span>
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
            className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10 text-theme-muted hover:text-theme-fg"
            title="Open in separate window"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-red-500/10 hover:text-red-500 transition-colors border border-theme/10 text-theme-muted"
            title="Close Sidebar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Main area: either tab picker or content */}
        {showTabPicker ? (
          <div className="relative flex-1 min-h-0 flex flex-col p-2 gap-0.5 overflow-y-auto scrollbar-invisible">
            {SIDEBAR_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const showDot =
                (tab.id === "todo" && hasTodoActivity && !isActive) ||
                (tab.id === "terminal" && hasTerminalActivity && !isActive);

              return (
                <button
                  key={tab.id}
                  onClick={() => handleSelectTab(tab.id)}
                  className={clsx(
                    "relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-left group border",
                    isActive
                      ? "bg-theme-hover/70 text-theme-fg border-theme/20"
                      : "text-theme-fg border-transparent hover:bg-theme-hover/40 hover:border-theme/15"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-theme-fg/70 rounded-r-full" />
                  )}

                  <div
                    className={clsx(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200",
                      isActive ? "bg-theme-card" : "bg-theme-hover/40 group-hover:bg-theme-hover/70"
                    )}
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <span
                      className={clsx(
                        "text-[13px] block truncate",
                        isActive ? "font-bold" : "font-semibold"
                      )}
                    >
                      {tab.label}
                    </span>
                    <span className="text-[10px] text-theme-muted block truncate mt-0.5">
                      {tab.desc}
                    </span>
                  </div>

                  {showDot && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="relative flex-1 min-h-0 overflow-hidden">
            {renderContent()}
          </div>
        )}
      </div>
    </div>
  );
};
