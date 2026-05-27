import React from 'react';
import { clsx } from 'clsx';
import { X, Plus } from 'lucide-react';

interface ChatTabsProps {
  tabs: any[];
  activeTabId?: string;
  onSwitchTab?: (id: string) => void;
  onCloseTab?: (id: string) => void;
  onAddTab?: () => void;
}

export const ChatTabs: React.FC<ChatTabsProps> = ({
  tabs = [],
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onAddTab,
}) => {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollContainerRef.current) {
      if (e.deltaY !== 0) {
        scrollContainerRef.current.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }
  };

  return (
    <div className="flex items-center w-full h-full relative overflow-hidden">
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar no-drag mask-linear-fade w-full h-full py-1 pl-1 pr-1 min-w-0"
      >
        {tabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => onSwitchTab?.(tab.id)}
            className={clsx(
              "group flex items-center gap-2 px-3 py-1.5 rounded-xl text-[13px] font-bold transition-all duration-200 cursor-pointer select-none min-w-[120px] max-w-[200px] flex-shrink-0 relative",
              tab.id === activeTabId
                ? "bg-theme-card text-theme-fg"
                : "bg-transparent text-theme-muted hover:bg-theme-hover/50 hover:text-theme-fg"
            )}
          >
            <span className="truncate flex-1 min-w-0">{tab.title || 'New Chat'}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab?.(tab.id); }}
              className={clsx(
                "p-0.5 rounded-md hover:bg-red-500/10 text-theme-muted hover:text-red-500 transition-all",
                tab.id === activeTabId ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              )}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* New Tab Button at the end of the list */}
        <div className="flex-shrink-0 pl-1 border-l border-theme/10 ml-1">
          <button
            onClick={onAddTab}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
            title="New Tab"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

