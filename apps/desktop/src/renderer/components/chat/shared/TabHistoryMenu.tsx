import React from 'react';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { ChevronDown, Clock, Plus } from 'lucide-react';

import { clsx } from 'clsx';
import { displayConversationTitle } from '../../../utils/conversationTitle';



export interface TabHistoryItem {

  id: string;

  title?: string;

}



export interface ConversationHistoryItem {

  id: string;

  title?: string;

  created_at?: string;

  updated_at?: string;

}



interface TabHistoryMenuProps {

  open: boolean;

  onOpenChange: (open: boolean) => void;

  variant?: 'compact' | 'header';

  align?: 'center' | 'end';

  conversations: ConversationHistoryItem[];

  loadingConversations?: boolean;

  activeConversationId?: string | null;

  onSelectConversation: (id: string) => void;

  onNewChat: () => void;

}



export const COMPACT_TAB_MENU_MAX_HEIGHT = 360;



const menuContentStyle = {

  maxHeight: `min(${COMPACT_TAB_MENU_MAX_HEIGHT}px, var(--radix-dropdown-menu-content-available-height, ${COMPACT_TAB_MENU_MAX_HEIGHT}px))`,

} as const;



/** Height reserve for compact window resize when the history menu is open. */

export function estimateCompactTabMenuHeight(itemCount: number): number {

  const emptyStateHeight = 48;

  const itemHeight = 34;

  const padding = 8;

  const contentHeight = itemCount === 0

    ? emptyStateHeight

    : padding + itemCount * itemHeight;

  return Math.min(COMPACT_TAB_MENU_MAX_HEIGHT, Math.max(emptyStateHeight, contentHeight));

}



export function TabHistoryMenu({

  open,

  onOpenChange,

  variant = 'compact',

  align = 'center',

  conversations,

  loadingConversations = false,

  activeConversationId,

  onSelectConversation,

  onNewChat,

}: TabHistoryMenuProps) {

  const handleSelectConversation = (conversationId: string) => {

    onSelectConversation(conversationId);

    onOpenChange(false);

  };



  const handleNewChat = () => {

    onNewChat();

    onOpenChange(false);

  };



  const isCompact = variant === 'compact';



  const addButton = (

    <button

      type="button"

      onClick={handleNewChat}

      className={clsx(

        'no-drag flex items-center justify-center transition-colors shrink-0',

        isCompact

          ? 'w-4 h-4 rounded text-pill-fg/40 hover:text-pill-fg/75 hover:bg-pill-fg/8'

          : 'w-8 h-8 rounded-lg border border-theme/10 bg-theme-card/80 text-theme-muted hover:bg-theme-hover hover:text-theme-fg',

      )}

      title="New chat"

    >

      <Plus className={isCompact ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5'} strokeWidth={isCompact ? 2 : 1.75} />

    </button>

  );



  return (

    <div className={clsx('flex items-center shrink-0', isCompact ? 'gap-0.5' : 'gap-1')}>

      {addButton}



      <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>

        <DropdownMenu.Trigger asChild>

          <button

            type="button"

            className={clsx(

              'no-drag flex items-center justify-center transition-colors shrink-0',

              isCompact

                ? 'w-4 h-4 rounded text-pill-fg/40 hover:text-pill-fg/75 hover:bg-pill-fg/8'

                : clsx(

                  'w-8 h-8 rounded-lg border border-theme/10',

                  open

                    ? 'bg-theme-active text-theme-fg'

                    : 'bg-theme-card/80 text-theme-muted hover:bg-theme-hover hover:text-theme-fg',

                ),

            )}

            title="Chat history"

          >

            {isCompact ? (

              <ChevronDown className="w-2.5 h-2.5" />

            ) : (

              <Clock className="w-3.5 h-3.5" />

            )}

          </button>

        </DropdownMenu.Trigger>

        <DropdownMenu.Portal container={typeof document !== 'undefined' ? document.body : undefined}>

          <DropdownMenu.Content

            className={clsx(

              'DropdownContent flex flex-col overflow-hidden shadow-2xl backdrop-blur-xl',

              isCompact

                ? 'z-[100001] w-52 rounded-lg border border-pill-fg/10 bg-pill-bg/95 p-1'

                : 'z-[10002] w-56 rounded-xl border border-theme bg-theme-card/95 p-1',

            )}

            side={isCompact ? 'top' : undefined}

            sideOffset={isCompact ? 8 : 8}

            align={align}

            collisionPadding={isCompact ? 16 : 12}

            style={menuContentStyle}

          >

            <div className="min-h-0 overflow-y-auto overscroll-contain custom-scrollbar">

              {loadingConversations && conversations.length === 0 ? (

                <div

                  className={clsx(

                    'px-2.5 py-2 text-[11px]',

                    isCompact ? 'text-pill-fg/45' : 'text-theme-muted',

                  )}

                >

                  Loading...

                </div>

              ) : conversations.length === 0 ? (

                <div

                  className={clsx(

                    'px-2.5 py-2 text-[11px] italic',

                    isCompact ? 'text-pill-fg/45' : 'text-theme-muted',

                  )}

                >

                  No recent chats

                </div>

              ) : (

                conversations.map((conversation) => {

                  const isActive = String(conversation.id) === String(activeConversationId ?? '');

                  return (

                    <DropdownMenu.Item

                      key={conversation.id}

                      onSelect={() => handleSelectConversation(String(conversation.id))}

                      className={clsx(

                        'flex items-center gap-2 rounded-md px-2.5 py-1.5 outline-none cursor-pointer transition-colors',

                        isCompact

                          ? clsx(

                            'text-[11px]',

                            isActive

                              ? 'bg-pill-fg/10 text-pill-fg'

                              : 'text-pill-fg/75 hover:bg-pill-fg/8 hover:text-pill-fg/95',

                          )

                          : clsx(

                            'text-[12px]',

                            isActive

                              ? 'bg-theme-hover text-theme-fg'

                              : 'text-theme-muted hover:bg-theme-hover hover:text-theme-fg',

                          ),

                      )}

                    >

                      <span

                        className={clsx(

                          'h-1.5 w-1.5 rounded-full shrink-0',

                          isActive

                            ? isCompact ? 'bg-pill-fg/80' : 'bg-primary'

                            : 'bg-transparent',

                        )}

                      />

                      <span className="truncate min-w-0 flex-1 font-medium">

                        {displayConversationTitle(conversation.title)}

                      </span>

                    </DropdownMenu.Item>

                  );

                })

              )}

            </div>

          </DropdownMenu.Content>

        </DropdownMenu.Portal>

      </DropdownMenu.Root>

    </div>

  );

}

