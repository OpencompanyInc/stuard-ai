import React from 'react';
import { clsx } from 'clsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ChevronDown,
  Home,
  LayoutGrid,
  Minimize2,
  PanelLeftClose,
  Plus,
} from 'lucide-react';
import type { ConversationHistoryItem } from '../../../shared/TabHistoryMenu';

interface ChatHeaderMenuProps {
  chatMenuOpen: boolean;
  onChatMenuOpenChange: (open: boolean) => void;
  conversations?: ConversationHistoryItem[];
  loadingConversations?: boolean;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onOpenDashboard: () => void;
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  onCollapse?: () => void;
}

/** Launcher-style top-right menu — grid icon + dropdown. */
export const ChatHeaderMenu: React.FC<ChatHeaderMenuProps> = ({
  chatMenuOpen,
  onChatMenuOpenChange,
  conversations = [],
  loadingConversations = false,
  activeConversationId,
  onSelectConversation = () => {},
  onNewChat = () => {},
  onOpenDashboard,
  onToggleSidebar,
  sidebarOpen = false,
  onCollapse,
}) => {
  return (
    <DropdownMenu.Root open={chatMenuOpen} onOpenChange={onChatMenuOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 px-1.5 h-[34px] rounded-[10px] text-theme-muted hover:text-theme-fg hover:bg-theme-card transition-colors shrink-0"
          title="Menu"
        >
          <LayoutGrid className="w-[18px] h-[18px]" strokeWidth={1.75} />
          <ChevronDown className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="DropdownContent z-[10005] min-w-[220px] bg-pill-bg rounded-xl border border-pill-fg/10 p-1 shadow-[var(--compact-pill-shadow)]"
          sideOffset={8}
          align="end"
          collisionPadding={10}
        >
          <DropdownMenu.Item
            onSelect={() => onNewChat()}
            className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2 rounded-lg outline-none transition-colors hover:bg-pill-fg/10 cursor-pointer"
          >
            <Plus className="w-4 h-4 opacity-70" strokeWidth={2} />
            <span className="flex-1">New chat</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="h-px bg-pill-fg/10 my-1 mx-1" />
          {loadingConversations && conversations.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-pill-fg/45">Loading…</div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-2 text-[12px] italic text-pill-fg/45">No recent chats</div>
          ) : (
            conversations.slice(0, 6).map((c) => {
              const isActive = String(c.id) === String(activeConversationId ?? '');
              return (
                <DropdownMenu.Item
                  key={c.id}
                  onSelect={() => onSelectConversation(String(c.id))}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 outline-none cursor-pointer transition-colors text-[12px]',
                    isActive
                      ? 'bg-pill-fg/10 text-pill-fg'
                      : 'text-pill-fg/75 hover:bg-pill-fg/10 hover:text-pill-fg',
                  )}
                >
                  <span
                    className={clsx(
                      'h-1.5 w-1.5 rounded-full shrink-0',
                      isActive ? 'bg-[#FF383C]' : 'bg-transparent',
                    )}
                  />
                  <span className="truncate min-w-0 flex-1 font-medium">
                    {c.title?.trim() || 'Untitled chat'}
                  </span>
                </DropdownMenu.Item>
              );
            })
          )}
          <DropdownMenu.Separator className="h-px bg-pill-fg/10 my-1 mx-1" />
          <DropdownMenu.Item
            onSelect={() => onOpenDashboard()}
            className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2 rounded-lg outline-none transition-colors hover:bg-pill-fg/10 cursor-pointer"
          >
            <Home className="w-4 h-4 opacity-70" strokeWidth={1.75} />
            <span className="flex-1">Dashboard</span>
          </DropdownMenu.Item>
          {onToggleSidebar && (
            <DropdownMenu.Item
              onSelect={() => onToggleSidebar()}
              className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2 rounded-lg outline-none transition-colors hover:bg-pill-fg/10 cursor-pointer"
            >
              <PanelLeftClose className="w-4 h-4 opacity-70" strokeWidth={1.75} />
              <span className="flex-1">{sidebarOpen ? 'Hide' : 'Show'} sidebar</span>
            </DropdownMenu.Item>
          )}
          {onCollapse && (
            <DropdownMenu.Item
              onSelect={() => onCollapse()}
              className="group text-[13px] text-pill-fg/90 flex items-center gap-2 px-3 py-2 rounded-lg outline-none transition-colors hover:bg-pill-fg/10 cursor-pointer"
            >
              <Minimize2 className="w-4 h-4 opacity-70" strokeWidth={1.75} />
              <span className="flex-1">Compact mode</span>
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
