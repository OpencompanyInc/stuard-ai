import React from 'react';
import { clsx } from 'clsx';
import {
  Home,
  AppWindow,
  PanelRight,
  PanelLeftClose,
  Minimize2
} from 'lucide-react';
import { TabHistoryMenu, type ConversationHistoryItem } from '../../../shared/TabHistoryMenu';
import { UpdateChip } from '../../../../UpdateChip';

interface ChatHeaderActionsProps {
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  onOpenDashboard: () => void;
  onCollapse: () => void;
  overlayMode?: 'compact' | 'sidebar' | 'window';
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  conversations?: ConversationHistoryItem[];
  loadingConversations?: boolean;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
}

export const ChatHeaderActions: React.FC<ChatHeaderActionsProps> = ({
  onToggleSidebar,
  sidebarOpen,
  onOpenDashboard,
  onCollapse,
  overlayMode,
  chatMenuOpen,
  onChatMenuOpenChange,
  conversations = [],
  loadingConversations = false,
  activeConversationId,
  onSelectConversation = () => {},
  onNewChat = () => {},
}) => {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {/* New-version pill — only renders while an update is actionable */}
      <UpdateChip variant="header" className="mr-0.5" />

      {/* Internal Sidebar (Spaces, Terminal) - shown in window/sidebar modes */}
      {(overlayMode === 'window' || overlayMode === 'sidebar') && onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className={clsx(
            "w-8 h-8 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme-sidebar",
            sidebarOpen ? "bg-primary/10 text-primary border-primary/20" : "bg-theme-card/80 text-theme-muted"
          )}
          title="Sidebar (Spaces, Terminal)"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Layout Menu */}
      <button
        type="button"
        onClick={onCollapse}
        className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme-sidebar text-theme-muted hover:text-theme-fg"
        title="Compact"
      >
        <Minimize2 className="w-3.5 h-3.5" />
      </button>
      {overlayMode !== 'sidebar' && (
        <button
          type="button"
          onClick={() => window.desktopAPI.setMode('sidebar')}
          className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme-sidebar text-theme-muted hover:text-theme-fg"
          title="Sidebar"
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
      )}
      {overlayMode !== 'window' && (
        <button
          type="button"
          onClick={() => window.desktopAPI.setMode('window')}
          className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme-sidebar text-theme-muted hover:text-theme-fg"
          title="Window"
        >
          <AppWindow className="w-3.5 h-3.5" />
        </button>
      )}

      <button className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme-sidebar" title="Dashboard" onClick={onOpenDashboard}>
        <Home className="w-3.5 h-3.5 text-theme-muted" />
      </button>

      <TabHistoryMenu
        open={chatMenuOpen}
        onOpenChange={onChatMenuOpenChange}
        variant="header"
        align="end"
        conversations={conversations}
        loadingConversations={loadingConversations}
        activeConversationId={activeConversationId}
        onSelectConversation={onSelectConversation}
        onNewChat={onNewChat}
      />
    </div>
  );
};
