import React from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import type { FileTab } from './FileViewerContext';

interface FileViewerTabsProps {
  tabs: FileTab[];
  activeTabId: string | null;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export const FileViewerTabs: React.FC<FileViewerTabsProps> = ({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
}) => {
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollContainerRef.current && e.deltaY !== 0) {
      scrollContainerRef.current.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  return (
    <div className="flex items-center w-full h-full relative overflow-hidden">
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex items-center gap-1 overflow-x-auto custom-scrollbar mask-linear-fade w-full h-full py-1 pl-1 pr-1 min-w-0"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSwitchTab(tab.id)}
              title={tab.path}
              className={clsx(
                'group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer select-none min-w-[110px] max-w-[180px] border flex-shrink-0',
                isActive
                  ? 'bg-theme-card text-theme-fg border-theme/10'
                  : 'bg-transparent text-theme-muted hover:bg-theme-hover/50 border-transparent hover:text-theme-fg',
              )}
            >
              {tab.source !== 'local' && (
                <span
                  className={clsx(
                    'shrink-0 rounded-full px-1 py-px text-[8px] font-bold uppercase tracking-wider border',
                    tab.source === 'vm'
                      ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
                      : tab.source === 'preview'
                        ? 'border-amber-500/30 text-amber-600 dark:text-amber-300'
                        : 'border-blue-500/30 text-blue-600 dark:text-blue-300',
                  )}
                >
                  {tab.source}
                </span>
              )}
              <span className="truncate flex-1 min-w-0">{tab.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className={clsx(
                  'p-0.5 rounded-md hover:bg-red-500/10 text-theme-muted hover:text-red-500 transition-all',
                  isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
