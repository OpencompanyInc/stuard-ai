import { ChevronRight, Code, Settings, ArrowLeft, Workflow, Home } from "lucide-react";
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
  breadcrumbs?: BreadcrumbItem[];
  currentSubPath?: string | null;
  onNavigateBack?: () => void;
  modelName?: string;
}

export function WorkflowTabs({
  openTabs,
  activeTab,
  onSetActiveTab,
  onCloseFileTab,
  breadcrumbs,
  currentSubPath,
  onNavigateBack,
  modelName
}: WorkflowTabsProps) {
  const inSubWorkflow = currentSubPath && currentSubPath !== 'main.stuard';
  const showBreadcrumbs = inSubWorkflow && breadcrumbs && breadcrumbs.length > 0;

  const showTabs = openTabs.length > 0 || inSubWorkflow;

  if (!showBreadcrumbs && !showTabs) return null;

  return (
    <div className="bg-white/[0.06] backdrop-blur-2xl border border-white/[0.1] rounded-full shadow-lg shrink-0 overflow-hidden flex flex-col pointer-events-auto">
      {/* Breadcrumb bar when inside a sub-workflow */}
      {showBreadcrumbs && (
        <div className="h-7 flex items-center gap-1 px-3 bg-indigo-500/10 border-b border-white/[0.04]">
          <button
            onClick={onNavigateBack}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-full transition-colors"
            title="Go back to parent workflow"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
          <span className="text-white/10 mx-1">|</span>
          <div className="flex items-center gap-0.5 text-[10px] text-white/40">
            {breadcrumbs!.map((crumb, i) => (
              <span key={i} className="flex items-center gap-0.5">
                {i > 0 && <ChevronRight className="w-3 h-3 text-white/20" />}
                <span className={i === breadcrumbs!.length - 1 ? 'text-white/30' : 'text-indigo-400 hover:underline cursor-pointer'}>
                  {crumb.label}
                </span>
              </span>
            ))}
            <ChevronRight className="w-3 h-3 text-white/20" />
            <span className="flex items-center gap-1 font-medium text-indigo-300">
              <Workflow className="w-3 h-3" />
              {currentSubPath?.replace('.stuard', '').split('/').pop()}
            </span>
          </div>
        </div>
      )}

      {/* Regular tabs row */}
      {showTabs && (
        <div className="h-9 flex items-center overflow-x-auto px-1 gap-1">
          <button
            onClick={() => onSetActiveTab("canvas")}
            className={`h-7 px-3 flex items-center gap-2 text-[12px] font-semibold rounded-full transition-colors shrink-0 ${activeTab === "canvas"
              ? "bg-white/[0.06] text-white border border-white/[0.08]"
              : "text-white/60 hover:text-white hover:bg-white/[0.04] border border-transparent"
              }`}
          >
            {inSubWorkflow ? <Workflow className="w-4 h-4 text-indigo-400" /> : <Workflow className="w-4 h-4 text-indigo-400" />}
            {inSubWorkflow ? 'Sub-Workflow' : 'Canvas'}
          </button>

          {openTabs.map((tab) => (
            <div
              key={tab.filePath}
              className={`h-7 flex items-center gap-1 text-[11px] font-medium rounded-full transition-colors shrink-0 group ${activeTab === tab.filePath
                ? "bg-white/[0.06] text-white border border-white/[0.08]"
                : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border border-transparent"
                }`}
            >
              <button onClick={() => onSetActiveTab(tab.filePath)} className="pl-3 pr-1 h-full flex items-center gap-1.5">
                {tab.fileName.endsWith(".py") ? (
                  <Code className="w-3 h-3 text-yellow-400" />
                ) : tab.fileName.endsWith(".js") || tab.fileName.endsWith(".ts") ? (
                  <Code className="w-3 h-3 text-blue-400" />
                ) : (
                  <Settings className="w-3 h-3 text-white/30" />
                )}
                {tab.fileName}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseFileTab(tab.filePath);
                }}
                className="pr-2 h-full flex items-center opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-400"
              >
                <span className="text-xs leading-none">&times;</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
