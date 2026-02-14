import { Code, Layout, Settings } from "lucide-react";
import type { OpenFileTab } from "./types";

interface WorkflowTabsProps {
  openTabs: OpenFileTab[];
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
  onCloseFileTab: (filePath: string) => void;
}

export function WorkflowTabs({ openTabs, activeTab, onSetActiveTab, onCloseFileTab }: WorkflowTabsProps) {
  if (openTabs.length === 0) return null;

  return (
    <div className="h-8 bg-white border-b border-slate-200 flex items-center shrink-0 overflow-x-auto px-1 gap-px">
      <button
        onClick={() => onSetActiveTab("canvas")}
        className={`h-7 px-3 flex items-center gap-1.5 text-[11px] font-medium rounded-t-md transition-colors shrink-0 ${
          activeTab === "canvas"
            ? "bg-slate-50 text-slate-800 border border-b-0 border-slate-200"
            : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
        }`}
      >
        <Layout className="w-3 h-3" />
        Canvas
      </button>

      {openTabs.map((tab) => (
        <div
          key={tab.filePath}
          className={`h-7 flex items-center gap-1 text-[11px] font-medium rounded-t-md transition-colors shrink-0 group ${
            activeTab === tab.filePath
              ? "bg-slate-50 text-slate-800 border border-b-0 border-slate-200"
              : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
          }`}
        >
          <button onClick={() => onSetActiveTab(tab.filePath)} className="pl-3 pr-1 h-full flex items-center gap-1.5">
            {tab.fileName.endsWith(".py") ? (
              <Code className="w-3 h-3 text-yellow-500" />
            ) : tab.fileName.endsWith(".js") || tab.fileName.endsWith(".ts") ? (
              <Code className="w-3 h-3 text-blue-400" />
            ) : (
              <Settings className="w-3 h-3 text-slate-400" />
            )}
            {tab.fileName}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseFileTab(tab.filePath);
            }}
            className="pr-2 h-full flex items-center opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500"
          >
            <span className="text-xs leading-none">×</span>
          </button>
        </div>
      ))}
    </div>
  );
}
