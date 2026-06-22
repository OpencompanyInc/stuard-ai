import React, { useMemo } from 'react';

import { clsx } from 'clsx';

import {

  AppWindow,

  Columns2,

  FolderOpen,

  MessageSquare,

  Minimize2,

  PanelRight,

  Plus,

  X,

  Clock,

  Loader2,

} from 'lucide-react';

import type { WorkspaceSection } from './WorkspaceActivityRail';

import type { ConversationHistoryItem } from '../chat/shared/TabHistoryMenu';
import { displayConversationTitle } from '../../utils/conversationTitle';
import { WorkspaceFilesBrowser } from '../file-viewer/WorkspaceFilesBrowser';
import type { ContextItem } from '../FileNavigator';



export type { WorkspaceSection };



type LayoutMode = 'app' | 'window' | 'sidebar' | 'compact';



interface WorkspaceTab {

  id: string;

  title?: string;

  serverId?: string | null;

}



const LAYOUT_MODES: Array<{ mode: LayoutMode; label: string; Icon: React.ComponentType<any> }> = [

  { mode: 'app', label: 'Workspace', Icon: PanelRight },

  { mode: 'window', label: 'Window', Icon: AppWindow },

  { mode: 'sidebar', label: 'Split', Icon: Columns2 },

  { mode: 'compact', label: 'Compact', Icon: Minimize2 },

];



interface WorkspaceLeftSidebarProps {

  section: WorkspaceSection;

  onSectionChange: (section: WorkspaceSection) => void;

  tabs: WorkspaceTab[];

  activeTabId?: string;

  onSwitchTab?: (id: string) => void;

  onCloseTab?: (id: string) => void;

  onAddTab?: () => void;

  onNewChat?: () => void;

  conversations?: ConversationHistoryItem[];

  loadingConversations?: boolean;

  activeConversationId?: string | null;

  onSelectConversation?: (id: string) => void;

  onPreviewRequest?: () => void;

  onAddContext?: (item: ContextItem) => void;

  contextPaths?: ContextItem[];

  accessToken?: string | null;

  onCollapse?: () => void;

}



function rankTime(c: ConversationHistoryItem): number {

  return new Date(c.updated_at || c.created_at || 0).getTime();

}



/** Unified left sidebar — section switch, open chats + history, layout controls. */

export const WorkspaceLeftSidebar: React.FC<WorkspaceLeftSidebarProps> = ({

  section,

  onSectionChange,

  tabs = [],

  activeTabId,

  onSwitchTab,

  onCloseTab,

  onAddTab,

  onNewChat,

  conversations = [],

  loadingConversations = false,

  activeConversationId,

  onSelectConversation,

  onPreviewRequest,

  onAddContext,

  contextPaths = [],

  accessToken,

  onCollapse,

}) => {

  const startNewChat = onNewChat ?? onAddTab;



  const openServerIds = useMemo(

    () => new Set(tabs.map((t) => t.serverId).filter(Boolean).map(String)),

    [tabs],

  );



  const recentHistory = useMemo(() => {

    const seen = new Set<string>();

    return [...conversations]

      .filter((c) => {

        const id = String(c.id);

        if (openServerIds.has(id) || seen.has(id)) return false;

        seen.add(id);

        return true;

      })

      .sort((a, b) => rankTime(b) - rankTime(a))

      .slice(0, 24);

  }, [conversations, openServerIds]);



  const goLayout = (mode: LayoutMode) => {

    if (mode === 'compact') {

      onCollapse?.();

      return;

    }

    try { (window as any).desktopAPI?.setMode?.(mode); } catch { /* noop */ }

    try { (window as any).desktopAPI?.setIgnoreMouseEvents?.(false); } catch { /* noop */ }

  };



  const selectHistory = (convId: string) => {

    const openTab = tabs.find((t) => t.serverId && String(t.serverId) === String(convId));

    if (openTab) {

      onSwitchTab?.(openTab.id);

      return;

    }

    onSelectConversation?.(convId);

  };



  return (

    <aside className={clsx(
      'workspace-left-sidebar shrink-0 flex flex-col min-h-0 border-r border-theme workspace-sidebar-surface transition-[width]',
      section === 'files' ? 'w-[280px]' : 'w-[248px]',
    )}>

      <div className="p-3 pb-2 shrink-0">

        <div className="flex p-0.5 gap-0.5 bg-theme-card/80 border border-theme/10 rounded-xl">

          <SectionBtn active={section === 'chat'} onClick={() => onSectionChange('chat')} icon={<MessageSquare className="w-3.5 h-3.5" />}>

            Chat

          </SectionBtn>

          <SectionBtn active={section === 'files'} onClick={() => onSectionChange('files')} icon={<FolderOpen className="w-3.5 h-3.5" />}>

            Files

          </SectionBtn>

        </div>

      </div>



      {section === 'chat' && (

        <>

          <div className="flex items-center justify-between px-3 pb-2 shrink-0">

            <span className="text-[12px] font-semibold text-theme-fg">Chats</span>

            <button

              type="button"

              onClick={startNewChat}

              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors"

              title="New chat"

            >

              <Plus className="w-3.5 h-3.5" strokeWidth={2} />

              New

            </button>

          </div>



          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 pb-2">

            {tabs.length === 0 && !loadingConversations && recentHistory.length === 0 ? (

              <div className="mx-1 rounded-xl border border-dashed border-theme/15 bg-theme-card/50 px-3 py-6 text-center">

                <p className="text-[12px] font-medium text-theme-fg">No chats yet</p>

                <p className="text-[11px] text-theme-muted mt-1 leading-relaxed">Start a new conversation to see it here.</p>

                <button

                  type="button"

                  onClick={startNewChat}

                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/12 text-primary text-[12px] font-semibold hover:bg-primary/20 transition-colors"

                >

                  <Plus className="w-3.5 h-3.5" /> New chat

                </button>

              </div>

            ) : (

              <div className="flex flex-col gap-3">

                {tabs.length > 0 && (

                  <div>

                    <p className="px-1 mb-1 text-[10px] font-semibold uppercase tracking-wider text-theme-muted">Open</p>

                    <ul className="flex flex-col gap-1">

                      {tabs.map((tab) => {

                        const active = tab.id === activeTabId;

                        return (

                          <li key={tab.id}>

                            <ChatRow

                              active={active}

                              title={tab.title || 'New Chat'}

                              onClick={() => onSwitchTab?.(tab.id)}

                              onClose={() => onCloseTab?.(tab.id)}

                              showClose

                            />

                          </li>

                        );

                      })}

                    </ul>

                  </div>

                )}



                <div>

                  <p className="px-1 mb-1 text-[10px] font-semibold uppercase tracking-wider text-theme-muted flex items-center gap-1">

                    <Clock className="w-3 h-3" /> Recent

                  </p>

                  {loadingConversations && recentHistory.length === 0 ? (

                    <div className="flex items-center justify-center gap-2 py-6 text-theme-muted text-[12px]">

                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…

                    </div>

                  ) : recentHistory.length === 0 ? (

                    <p className="px-2 py-3 text-[11px] text-theme-muted italic">No recent chats</p>

                  ) : (

                    <ul className="flex flex-col gap-1">

                      {recentHistory.map((c) => {

                        const active = String(c.id) === String(activeConversationId ?? '');

                        return (

                          <li key={c.id}>

                            <ChatRow

                              active={active}

                              title={displayConversationTitle(c.title)}

                              onClick={() => selectHistory(String(c.id))}

                            />

                          </li>

                        );

                      })}

                    </ul>

                  )}

                </div>

              </div>

            )}

          </div>

        </>

      )}



      {section === 'files' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden pb-1">
          <WorkspaceFilesBrowser
            onPreviewRequest={() => onPreviewRequest?.()}
            onAddContext={onAddContext}
            accessToken={accessToken}
            contextPaths={contextPaths}
          />
        </div>
      )}



      <div className="shrink-0 p-3 pt-2 border-t border-theme/10">

        <p className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted mb-1.5 px-0.5">Layout</p>

        <div className="grid grid-cols-4 gap-1">

          {LAYOUT_MODES.map(({ mode, label, Icon }) => (

            <button

              key={mode}

              type="button"

              title={label}

              aria-label={label}

              onClick={() => goLayout(mode)}

              className={clsx(

                'h-8 flex items-center justify-center rounded-lg transition-colors focus:outline-none',

                mode === 'app'

                  ? 'bg-primary/10 text-primary'

                  : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover',

              )}

            >

              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />

            </button>

          ))}

        </div>

      </div>

    </aside>

  );

};



const ChatRow: React.FC<{

  active: boolean;

  title: string;

  onClick: () => void;

  onClose?: () => void;

  showClose?: boolean;

}> = ({ active, title, onClick, onClose, showClose }) => (

  <button

    type="button"

    role="tab"

    aria-selected={active}

    onClick={onClick}

    className={clsx(

      'group w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-left transition-all',

      active

        ? 'bg-theme-card text-theme-fg shadow-sm border border-theme/10'

        : 'text-theme-fg/80 hover:bg-theme-hover/70 border border-transparent',

    )}

  >

    <MessageSquare

      className={clsx('w-4 h-4 shrink-0', active ? 'text-primary' : 'text-theme-muted')}

      strokeWidth={1.75}

    />

    <span className="truncate flex-1 min-w-0 text-[13px] font-medium leading-snug">{title}</span>

    {showClose && onClose && (

      <span

        role="button"

        tabIndex={-1}

        onClick={(e) => {

          e.stopPropagation();

          onClose();

        }}

        className={clsx(

          'shrink-0 p-1 rounded-md text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors',

          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',

        )}

        aria-label="Close chat"

      >

        <X className="w-3 h-3" />

      </span>

    )}

  </button>

);



const SectionBtn: React.FC<{

  active?: boolean;

  onClick?: () => void;

  icon: React.ReactNode;

  children: React.ReactNode;

}> = ({ active, onClick, icon, children }) => (

  <button

    type="button"

    onClick={onClick}

    className={clsx(

      'flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-[10px] text-[12px] font-semibold transition-colors',

      active

        ? 'bg-theme-card text-theme-fg shadow-sm'

        : 'text-theme-muted hover:text-theme-fg',

    )}

  >

    {icon}

    {children}

  </button>

);

