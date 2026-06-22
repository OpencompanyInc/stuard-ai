import React from 'react';
import { clsx } from 'clsx';
import { PanelRightClose, Paperclip, Check } from 'lucide-react';
import { useFileViewer } from './FileViewerContext';
import { FileViewerTabs } from './FileViewerTabs';
import { FileViewerContent } from './FileViewerPane';
import type { ContextItem } from '../FileNavigator';

interface WorkspaceFilePreviewPaneProps {
  onClose: () => void;
  onAddContext?: (item: ContextItem) => void;
  contextPaths?: Array<{ path: string }>;
  className?: string;
}

/** Right-hand file preview panel — chat stays in the center. */
export const WorkspaceFilePreviewPane: React.FC<WorkspaceFilePreviewPaneProps> = ({
  onClose,
  onAddContext,
  contextPaths = [],
  className,
}) => {
  const { tabs, activeTabId, switchTab, closeTab } = useFileViewer();
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const [contextFlash, setContextFlash] = React.useState(false);

  const inContext = activeTab ? contextPaths.some((c) => c.path === activeTab.path) : false;

  const handleAddContext = () => {
    if (!activeTab || !onAddContext) return;
    onAddContext({
      path: activeTab.path,
      name: activeTab.name,
      isDirectory: false,
      type: 'file',
    });
    setContextFlash(true);
    setTimeout(() => setContextFlash(false), 1500);
  };

  const handleCloseTab = (id: string) => {
    closeTab(id);
    if (tabs.length <= 1) onClose();
  };

  if (!activeTab) return null;

  return (
    <div
      className={clsx(
        'flex flex-col h-full min-h-0 bg-theme-bg/50 overflow-hidden',
        className,
      )}
    >
      <div className="shrink-0 px-2 py-2 border-b border-theme/10 space-y-2">
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
            title="Close preview"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted flex-1">
            Preview
          </span>
          {onAddContext && (
            <button
              onClick={handleAddContext}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors',
                contextFlash || inContext
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                  : 'bg-theme-card border border-theme/15 text-theme-fg hover:bg-theme-hover',
              )}
            >
              {contextFlash || inContext ? <Check className="w-3.5 h-3.5" /> : <Paperclip className="w-3.5 h-3.5" />}
              {inContext ? 'In context' : 'Add to chat'}
            </button>
          )}
        </div>
        <FileViewerTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSwitchTab={switchTab}
          onCloseTab={handleCloseTab}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <FileViewerContent key={activeTab.id} tab={activeTab} />
      </div>
    </div>
  );
};