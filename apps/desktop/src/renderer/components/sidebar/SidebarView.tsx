import React from 'react';
import { clsx } from 'clsx';
import { Layers, PenTool, Terminal, X, GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import { SpacesSidebar } from '../SpacesSidebar';
import { XTerminalPanel } from '../XTerminalPanel';
import { QuickNotesPanel } from './QuickNotesPanel';

interface SidebarViewProps {
  activeTab: 'spaces' | 'canvas' | 'terminal' | 'cloud';
  onTabChange: (tab: 'spaces' | 'canvas' | 'terminal' | 'cloud') => void;
  translucentMode?: boolean;
  onClose?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  selectedItem?: { type: 'space' | 'canvas'; id: string } | null;
  onSelectedItemHandled?: () => void;
}

export const SidebarView: React.FC<SidebarViewProps> = ({
  activeTab,
  onTabChange,
  translucentMode,
  onClose,
  isExpanded = false,
  onToggleExpand,
  selectedItem,
  onSelectedItemHandled,
}) => {
  const handleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      // Fallback: call IPC directly
      try {
        (window as any).desktopAPI?.toggleSidebarExpanded?.();
      } catch { }
    }
  };

  return (
    <div className={clsx(
      "w-full h-full flex flex-col overflow-hidden rounded-2xl",
      translucentMode
        ? "bg-theme-card/80 backdrop-blur-2xl"
        : "bg-theme-bg"
    )}>
      {/* Header with drag region and tabs */}
      <div
        className="flex items-center justify-between px-2 py-2 border-b border-theme/5 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Drag handle */}
        <div className="flex items-center gap-1 px-2 text-theme-muted/50">
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Tab Pills */}
        <div className="flex items-center gap-1 bg-theme-hover/50 p-1 rounded-xl" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <TabButton
            icon={Layers}
            label="Spaces"
            isActive={activeTab === 'spaces'}
            onClick={() => onTabChange('spaces')}
          />
          <TabButton
            icon={PenTool}
            label="Notes"
            isActive={activeTab === 'canvas'}
            onClick={() => onTabChange('canvas')}
          />
          <TabButton
            icon={Terminal}
            label="Terminal"
            isActive={activeTab === 'terminal'}
            onClick={() => onTabChange('terminal')}
          />
        </div>

        {/* Window controls */}
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {/* Expand/Collapse button */}
          <button
            onClick={handleExpand}
            className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all"
            title={isExpanded ? "Collapse to sidebar" : "Expand to full window"}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-red-400 transition-all"
            title="Close Sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'spaces' && (
          <SpacesSidebar
            onClose={onClose}
            className="w-full h-full"
            translucentMode={translucentMode}
            selectedSpaceId={selectedItem?.type === 'space' ? selectedItem.id : undefined}
            onSelectedSpaceHandled={selectedItem?.type === 'space' ? onSelectedItemHandled : undefined}
          />
        )}
        {activeTab === 'canvas' && (
          <QuickNotesPanel
            className="w-full h-full"
            selectedDocumentId={selectedItem?.type === 'canvas' ? selectedItem.id : undefined}
            onSelectedDocumentHandled={selectedItem?.type === 'canvas' ? onSelectedItemHandled : undefined}
          />
        )}
        {activeTab === 'terminal' && (
          <XTerminalPanel
            onClose={onClose}
            className="w-full h-full"
          />
        )}
      </div>
    </div>
  );
};

interface TabButtonProps {
  icon: React.FC<{ className?: string }>;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({ icon: Icon, label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={clsx(
      "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all",
      isActive
        ? "bg-theme-card text-theme-fg shadow-sm ring-1 ring-theme/10"
        : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover"
    )}
  >
    <Icon className="w-3.5 h-3.5" />
    <span>{label}</span>
  </button>
);

export default SidebarView;
