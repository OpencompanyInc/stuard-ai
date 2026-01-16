import React from 'react';
import { clsx } from 'clsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  LayoutGrid,
  Layout,
  Home,
  Clock,
  Trash2,
  ChevronDown,
  Cpu
} from 'lucide-react';

interface ChatHeaderActionsProps {
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  onOpenDashboard: () => void;
  onCollapse: () => void;
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  conversations: any[];
  loadingConversations: boolean;
  onSelectConversation: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  viewMode?: 'chat' | 'tasks';
  onViewModeChange?: (mode: 'chat' | 'tasks') => void;
}

export const ChatHeaderActions: React.FC<ChatHeaderActionsProps> = ({
  onToggleSidebar,
  sidebarOpen,
  onOpenDashboard,
  onCollapse,
  chatMenuOpen,
  onChatMenuOpenChange,
  conversations,
  loadingConversations,
  onSelectConversation,
  onDeleteConversation,
  viewMode = 'chat',
  onViewModeChange,
}) => {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className={clsx(
            "w-8 h-8 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10",
            sidebarOpen ? "bg-primary/10 text-primary" : "bg-theme-card/80 text-theme-muted"
          )}
          title="Spaces"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Tasks Toggle */}
      {onViewModeChange && (
        <button
          onClick={() => onViewModeChange(viewMode === 'tasks' ? 'chat' : 'tasks')}
          className={clsx(
            "w-8 h-8 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10",
            viewMode === 'tasks' ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-theme-card/80 text-theme-muted"
          )}
          title="Tasks"
        >
          <Cpu className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Layout Menu */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="w-8 h-8 bg-theme-card/80 rounded-lg flex items-center justify-center hover:bg-theme-hover transition-colors border border-theme/10 text-theme-muted hover:text-theme-fg"
            title="Layout"
          >
            <Layout className="w-3.5 h-3.5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="DropdownContent z-[10001] w-48 bg-theme-card rounded-xl border border-theme p-1 shadow-2xl backdrop-blur-xl" sideOffset={10} align="end" collisionPadding={10}>
            <DropdownMenu.Item
              onSelect={() => window.desktopAPI.setMode('compact')}
              className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
            >
              <div className="w-4 h-4 border-2 border-current rounded opacity-50" />
              <span>Compact</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => window.desktopAPI.setMode('expanded')}
              className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
            >
              <div className="w-4 h-6 border-2 border-current rounded opacity-50" />
              <span>Expanded</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => window.desktopAPI.setMode('sidebar')}
              className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
            >
              <div className="w-2 h-4 border-2 border-current rounded opacity-50" />
              <span>Sidebar</span>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => window.desktopAPI.setMode('window')}
              className="text-[13px] text-theme-fg flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-theme-hover outline-none cursor-pointer transition-colors"
            >
              <div className="w-6 h-4 border-2 border-current rounded opacity-50" />
              <span>Window</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

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
                      <span className="truncate w-full font-bold">{c.title || 'Untitled Chat'}</span>
                      <span className="text-[10px] text-theme-muted font-bold mt-0.5">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
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
