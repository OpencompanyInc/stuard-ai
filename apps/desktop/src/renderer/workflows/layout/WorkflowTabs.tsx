import { ChevronRight, Code, Layout, Settings, ArrowLeft, Workflow } from "lucide-react";
import type { OpenFileTab } from "./types";

interface BreadcrumbItem {
  label: string;
  path: string | null;
}

interface WorkflowTabsProps {
  openTabs: OpenFileTab[];
  activeTab: string;
  onSetActiveTab: (tab: string) => void;
  onCloseFileTab: (filePath: string) => void;
  /** Breadcrumb path for sub-workflow navigation */
  breadcrumbs?: BreadcrumbItem[];
  /** Current sub-workflow path (null = main) */
  currentSubPath?: string | null;
  /** Navigate back to parent */
  onNavigateBack?: () => void;
}

export function WorkflowTabs({ 
  openTabs, 
  activeTab, 
  onSetActiveTab, 
  onCloseFileTab,
  breadcrumbs,
  currentSubPath,
  onNavigateBack
}: WorkflowTabsProps) {
  const inSubWorkflow = currentSubPath && currentSubPath !== 'main.stuard';
  const showBreadcrumbs = inSubWorkflow && breadcrumbs && breadcrumbs.length > 0;

  return (
    <div className="bg-white border-b border-slate-200 shrink-0">
      {/* Breadcrumb bar when inside a sub-workflow */}
      {showBreadcrumbs && (
        <div className="h-7 flex items-center gap-1 px-2 bg-indigo-50/50 border-b border-indigo-100">
          <button
            onClick={onNavigateBack}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 rounded transition-colors"
            title="Go back to parent workflow"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
          <span className="text-slate-300 mx-1">|</span>
          <div className="flex items-center gap-0.5 text-[10px] text-slate-500">
            {breadcrumbs!.map((crumb, i) => (
              <span key={i} className="flex items-center gap-0.5">
                {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                <span className={i === breadcrumbs!.length - 1 ? 'text-slate-400' : 'text-indigo-600 hover:underline cursor-pointer'}>
                  {crumb.label}
                </span>
              </span>
            ))}
            <ChevronRight className="w-3 h-3 text-slate-300" />
            <span className="flex items-center gap-1 font-medium text-indigo-700">
              <Workflow className="w-3 h-3" />
              {currentSubPath?.replace('.stuard', '').split('/').pop()}
            </span>
          </div>
        </div>
      )}

      {/* Regular tabs row */}
      {(openTabs.length > 0 || !inSubWorkflow) && (
        <div className="h-8 flex items-center overflow-x-auto px-1 gap-px">
          <button
            onClick={() => onSetActiveTab("canvas")}
            className={`h-7 px-3 flex items-center gap-1.5 text-[11px] font-medium rounded-t-md transition-colors shrink-0 ${
              activeTab === "canvas"
                ? "bg-slate-50 text-slate-800 border border-b-0 border-slate-200"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            {inSubWorkflow ? <Workflow className="w-3 h-3 text-indigo-500" /> : <Layout className="w-3 h-3" />}
            {inSubWorkflow ? 'Sub-Workflow' : 'Canvas'}
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
      )}
    </div>
  );
}
