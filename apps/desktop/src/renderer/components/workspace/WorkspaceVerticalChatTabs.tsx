import React from 'react';
import { clsx } from 'clsx';
import { Plus, X } from 'lucide-react';

interface WorkspaceVerticalChatTabsProps {
  tabs: Array<{ id: string; title?: string }>;
  activeTabId?: string;
  onSwitchTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onAddTab?: () => void;
}

/** Open chats listed vertically — standard desktop-app sidebar pattern. */
export const WorkspaceVerticalChatTabs: React.FC<WorkspaceVerticalChatTabsProps> = ({
  tabs = [],
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onAddTab,
}) => (
  <aside className="workspace-vertical-tabs w-[196px] shrink-0 flex flex-col min-h-0 border-r border-theme/10 bg-theme-card/20">
    <div className="flex items-center justify-between px-3 py-2 border-b border-theme/10 shrink-0">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-theme-muted">Chats</span>
      <button
        type="button"
        onClick={onAddTab}
        className="h-6 w-6 flex items-center justify-center text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
        title="New chat"
        aria-label="New chat"
      >
        <Plus className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
    </div>
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      {tabs.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-theme-muted">No open chats</div>
      ) : (
        tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSwitchTab?.(tab.id)}
              className={clsx(
                'group flex items-center gap-1.5 pl-3 pr-2 py-2.5 cursor-pointer border-l-2 transition-colors',
                active
                  ? 'border-l-primary bg-theme-hover text-theme-fg'
                  : 'border-l-transparent text-theme-muted hover:bg-theme-hover/60 hover:text-theme-fg',
              )}
            >
              <span className="truncate flex-1 min-w-0 text-[13px] leading-snug">
                {tab.title || 'New Chat'}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab?.(tab.id);
                }}
                className={clsx(
                  'shrink-0 p-0.5 text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors',
                  active ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label="Close chat"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })
      )}
    </div>
  </aside>
);
