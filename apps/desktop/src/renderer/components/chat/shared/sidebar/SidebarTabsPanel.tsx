import React, { useEffect, useState, useRef } from "react";
import { clsx } from "clsx";
import { ArrowLeft, FolderKanban, ListTodo, Maximize2, Terminal, X, type LucideIcon } from "lucide-react";
import { XTerminalPanel } from "../../../XTerminalPanel";
import { SidebarTodoPanel } from "./SidebarTodoPanel";
import { SidebarProjectsPanel } from "./SidebarProjectsPanel";

type SidebarTabId = "terminal" | "todo" | "projects";

const SIDEBAR_TABS: Array<{
  id: SidebarTabId;
  label: string;
  icon: LucideIcon;
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
  width?: number;
  onResize?: (deltaX: number) => void;
}

export const SidebarTabsPanel: React.FC<SidebarTabsPanelProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSwitchTab,
  translucentMode,
  width = 304,
  onResize,
}) => {
  const outerBackground = translucentMode
    ? "color-mix(in srgb, var(--background) 76%, transparent)"
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

  const headerBtnClass =
    "w-8 h-8 rounded-[10px] flex items-center justify-center transition-colors text-theme-muted hover:text-theme-fg hover:bg-theme-hover/70 shrink-0";

  return (
    <div
      className="relative h-full min-h-0 shrink-0"
      style={{ width }}
    >
      <div
        className={clsx(
          "launcher-compact-skin launcher-sidebar-panel relative h-full min-h-0 w-full flex flex-col overflow-hidden",
          "rounded-l-[32px] rounded-r-none",
          translucentMode ? "bg-theme-bg backdrop-blur-2xl" : "bg-theme-bg",
        )}
        style={{
          background: outerBackground,
        }}
      >
      {/* Header — matches launcher chrome, no nested card */}
      <div className="flex items-center gap-1 px-3 py-2.5 shrink-0">
        <button
          onClick={() => setShowTabPicker(!showTabPicker)}
          className={clsx(
            headerBtnClass,
            showTabPicker && "bg-theme-active text-theme-fg",
          )}
          title="Switch tab"
        >
          <ArrowLeft
            className={clsx(
              "w-3.5 h-3.5 transition-transform duration-200",
              showTabPicker && "rotate-[-90deg]",
            )}
          />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0 px-0.5">
          {currentTab && (
            <>
              <currentTab.icon className="w-3.5 h-3.5 text-theme-muted shrink-0" strokeWidth={1.75} />
              <span className="text-[13px] font-semibold text-theme-fg truncate">
                {currentTab.label}
              </span>
            </>
          )}
          {showActiveBadge && (
            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[9px] font-bold uppercase tracking-wider leading-none shrink-0">
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
          className={headerBtnClass}
          title="Open in separate window"
        >
          <Maximize2 className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <button
          onClick={onClose}
          className={clsx(headerBtnClass, "hover:text-red-500 hover:bg-red-500/10")}
          title="Close Sidebar"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="launcher-sidebar-divider mx-3 shrink-0" />

      {showTabPicker ? (
        <div className="flex-1 min-h-0 flex flex-col p-2 gap-0.5 overflow-y-auto scrollbar-invisible">
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
                  "relative flex items-center gap-3 px-3 py-2.5 rounded-[14px] transition-all duration-200 text-left group",
                  isActive
                    ? "bg-theme-active text-theme-fg"
                    : "text-theme-fg/90 hover:bg-theme-hover/55",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
                )}

                <div
                  className={clsx(
                    "w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-colors duration-200",
                    isActive ? "bg-theme-hover/80" : "bg-theme-hover/35 group-hover:bg-theme-hover/55",
                  )}
                >
                  <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </div>

                <div className="flex-1 min-w-0">
                  <span
                    className={clsx(
                      "text-[13px] block truncate",
                      isActive ? "font-bold" : "font-semibold",
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
        <div className="flex-1 min-h-0 overflow-hidden">
          {renderContent()}
        </div>
      )}
      </div>

      {onResize && (
        <SidebarPanelResizeHandle onResize={onResize} />
      )}
    </div>
  );
};

const SidebarPanelResizeHandle: React.FC<{ onResize: (deltaX: number) => void }> = ({ onResize }) => {
  const lastXRef = useRef<number | null>(null);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="absolute top-0 bottom-0 right-0 translate-x-1/2 w-2 cursor-col-resize group select-none z-20"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        lastXRef.current = e.clientX;
      }}
      onPointerMove={(e) => {
        if (lastXRef.current === null) return;
        const dx = e.clientX - lastXRef.current;
        lastXRef.current = e.clientX;
        if (dx !== 0) onResize(dx);
      }}
      onPointerUp={(e) => {
        try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { }
        lastXRef.current = null;
      }}
      onPointerCancel={() => { lastXRef.current = null; }}
    >
      <span className="absolute inset-y-3 left-1/2 -translate-x-1/2 w-px bg-[color:var(--sidebar-border)] group-hover:bg-[color:var(--border)] group-active:bg-primary/50 transition-colors" />
    </div>
  );
};
