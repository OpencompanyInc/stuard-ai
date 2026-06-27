import React, { createContext, useContext, useMemo } from 'react';
import type { TabHistoryItem } from './TabHistoryMenu';

export interface ChatTabsContextValue {
  tabs: TabHistoryItem[];
  activeTabId?: string;
  switchTab: (id: string) => void;
  addTab: () => void;
  closeTab?: (id: string) => void;
}

const ChatTabsContext = createContext<ChatTabsContextValue | null>(null);

export function toTabHistoryItems(tabs: Array<{ id?: string; title?: string }> | undefined | null): TabHistoryItem[] {
  if (!Array.isArray(tabs)) return [];
  return tabs
    .filter((tab): tab is { id: string; title?: string } => typeof tab?.id === 'string' && tab.id.length > 0)
    .map((tab) => ({ id: tab.id, title: tab.title }));
}

export function ChatTabsProvider({
  tabs,
  activeTabId,
  switchTab,
  addTab,
  closeTab,
  children,
}: {
  tabs: Array<{ id?: string; title?: string }> | undefined | null;
  activeTabId?: string;
  switchTab: (id: string) => void;
  addTab: () => void;
  closeTab?: (id: string) => void;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      tabs: toTabHistoryItems(tabs),
      activeTabId,
      switchTab,
      addTab,
      closeTab,
    }),
    [tabs, activeTabId, switchTab, addTab, closeTab],
  );

  return (
    <ChatTabsContext.Provider value={value}>
      {children}
    </ChatTabsContext.Provider>
  );
}

export function useChatTabs(): ChatTabsContextValue {
  const ctx = useContext(ChatTabsContext);
  if (!ctx) {
    return {
      tabs: [],
      switchTab: () => {},
      addTab: () => {},
    };
  }
  return ctx;
}
