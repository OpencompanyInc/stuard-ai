import React from "react";
import { clsx } from "clsx";
import { LayoutGrid, Terminal, X, NotebookPen, Maximize2 } from "lucide-react";
import { SpacesSidebar } from "./SpacesSidebar";
import { XTerminalPanel } from "./XTerminalPanel";
import { QuickNotesPanel } from "./sidebar/QuickNotesPanel";

interface SidebarTabsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: "spaces" | "canvas" | "terminal";
  onSwitchTab: (tab: "spaces" | "canvas" | "terminal") => void;
  translucentMode?: boolean;
}

export const SidebarTabsPanel: React.FC<SidebarTabsPanelProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSwitchTab,
  translucentMode,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className={clsx(
        // Seamless integration: rounded only on outer (left) edge, subtle right border for visual separation
        "w-[320px] h-full min-h-0 shrink-0 flex flex-col rounded-l-[28px] overflow-hidden border-r border-theme/5",
        translucentMode
          ? "bg-theme-bg/30 backdrop-blur-3xl"
          : "bg-theme-sidebar",
      )}
      style={{ transition: "transform 150ms ease-out, opacity 150ms ease-out" }}
    >
      {/* Sidebar Header / Tabs */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-theme/10 shrink-0">
        <div className="flex items-center gap-0.5 bg-theme-hover/40 p-1 rounded-xl">
          <button
            onClick={() => onSwitchTab("spaces")}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all",
              activeTab === "spaces"
                ? "bg-theme-card text-theme-fg shadow-sm ring-1 ring-theme/10"
                : "text-theme-muted hover:text-theme-fg",
            )}
          >
            <LayoutGrid className="w-3 h-3" />
            <span>Spaces</span>
          </button>
          <button
            onClick={() => onSwitchTab("canvas")}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all",
              activeTab === "canvas"
                ? "bg-theme-card text-theme-fg shadow-sm ring-1 ring-theme/10"
                : "text-theme-muted hover:text-theme-fg",
            )}
          >
            <NotebookPen className="w-3 h-3" />
            <span>Notes</span>
          </button>
          <button
            onClick={() => onSwitchTab("terminal")}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all",
              activeTab === "terminal"
                ? "bg-theme-card text-theme-fg shadow-sm ring-1 ring-theme/10"
                : "text-theme-muted hover:text-theme-fg",
            )}
          >
            <Terminal className="w-3 h-3" />
            <span>Terminal</span>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              // Close internal sidebar and open in standalone expanded window
              onClose();
              (window as any).desktopAPI?.openSidebar?.({
                tab: activeTab,
                expanded: true,
              });
            }}
            className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-primary transition-all"
            title="Open in separate window"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-red-500 transition-all"
            title="Close Sidebar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Sidebar Content */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {activeTab === "spaces" && (
          <SpacesSidebar
            onClose={onClose}
            className="w-full h-full"
            translucentMode={translucentMode}
          />
        )}
        {activeTab === "canvas" && (
          <QuickNotesPanel className="w-full h-full" />
        )}
        {activeTab === "terminal" && (
          <XTerminalPanel onClose={onClose} className="w-full h-full" />
        )}
      </div>
    </div>
  );
};
