import React from 'react';
import { clsx } from 'clsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  LayoutGrid,
  Home,
  Clock,
  Trash2,
  ListTodo,
  AppWindow,
  PanelRight,
  PanelLeftClose,
  Minimize2
} from 'lucide-react';

interface ChatHeaderActionsProps {
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  onOpenDashboard: () => void;
  onCollapse: () => void;
  overlayMode?: 'compact' | 'sidebar' | 'window';
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  conversations: any[];
  loadingConversations: boolean;
  onSelectConversation: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  viewMode?: 'chat' | 'tasks';
  onViewModeChange?: (mode: 'chat' | 'tasks') => void;
  onSwitchSidebarTab?: (tab: 'spaces' | 'terminal' | 'tasks' | 'browser' | 'todo') => void;
}

export const ChatHeaderActions: React.FC<ChatHeaderActionsProps> = ({
  onToggleSidebar,
  sidebarOpen,
  onOpenDashboard,
  onCollapse,
  overlayMode,
  chatMenuOpen,
  onChatMenuOpenChange,
  conversations,
  loadingConversations,
  onSelectConversation,
  onDeleteConversation,
  viewMode = 'chat',
  onViewModeChange,
  onSwitchSidebarTab,
}) => {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {/* Internal Sidebar (Spaces, Terminal) - shown in window/sidebar modes */}
      {(overlayMode === 'window' || overlayMode === 'sidebar') && onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className={clsx(
            "w-8 h-8 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10",
            sidebarOpen ? "bg-primary/10 text-primary border-primary/20" : "bg-theme-card/80 text-theme-muted"
          )}
          title="Sidebar (Spaces, Terminal)"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Tasks Toggle - opens sidebar todo tab when sidebar available, else toggles chat view */}
      {onViewModeChange && (
        <button
          onClick={() => {
            if (sidebarOpen && onSwitchSidebarTab) {
              onSwitchSidebarTab('todo');
            } else if (onSwitchSidebarTab && (overlayMode === 'sidebar' || overlayMode === 'window')) {
              // Open sidebar with todo tab
              onToggleSidebar?.();
              onSwitchSidebarTab('todo');
            } else {
              onViewModeChange(viewMode === 'tasks' ? 'chat' : 'tasks');
            }
          }}
          className={clsx(
            "w-8 h-8 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10",
            viewMode === 'tasks' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-theme-card/80 text-theme-muted"
          )}
          title="Tasks"
        >
          <ListTodo className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Layout Menu */}
      <button
        type="button"
        onClick={onCollapse}
        className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10 text-theme-muted hover:text-theme-fg"
        title="Compact"
      >
        <Minimize2 className="w-3.5 h-3.5" />
      </button>
      {overlayMode !== 'sidebar' && (
        <button
          type="button"
          onClick={() => window.desktopAPI.setMode('sidebar')}
          className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10 text-theme-muted hover:text-theme-fg"
          title="Sidebar"
        >
          <PanelRight className="w-3.5 h-3.5" />
        </button>
      )}
      {overlayMode !== 'window' && (
        <button
          type="button"
          onClick={() => window.desktopAPI.setMode('window')}
          className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10 text-theme-muted hover:text-theme-fg"
          title="Window"
        >
          <AppWindow className="w-3.5 h-3.5" />
        </button>
      )}

      <button className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10" title="Dashboard" onClick={onOpenDashboard}>
        <Home className="w-3.5 h-3.5 text-theme-muted" />
      </button>

      {/* History Dropdown */}
      <DropdownMenu.Root open={chatMenuOpen} onOpenChange={onChatMenuOpenChange}>
        <DropdownMenu.Trigger asChild>
          <button
            className={clsx(
              "w-8 h-8 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10",
              chatMenuOpen ? "bg-theme-active text-theme-fg" : "bg-theme-card/80 text-theme-muted"
            )}
            title="History"
          >
            <Clock className="w-3.5 h-3.5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="DropdownContent z-[10002] w-64 bg-theme-card rounded-xl border border-theme p-1 shadow-2xl backdrop-blur-xl" sideOffset={8} align="end" collisionPadding={10}>
            <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
              {loadingConversations ? (
                <div className="px-3 py-2 text-[12px] text-theme-muted">Loading...</div>
              ) : conversations.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-theme-muted italic">No recent chats</div>
              ) : (
                conversations.map(c => (
                  <div key={c.id} className="group relative">
                    <DropdownMenu.Item
                      onSelect={() => onSelectConversation(String(c.id))}
                      className="text-[13px] text-theme-fg flex flex-col px-2 py-2 pr-10 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors border-l-2 border-transparent hover:border-primary/50"
                    >
                      <span className="truncate w-full font-semibold">{c.title || 'Untitled Chat'}</span>
                      <span className="text-[10px] text-theme-muted font-medium mt-0.5">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                    </DropdownMenu.Item>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Are you sure you want to delete this conversation?')) {
                          onDeleteConversation?.(String(c.id));
                        }
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-red-500/10 text-theme-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete Conversation"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
};
