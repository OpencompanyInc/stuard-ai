import 'katex/dist/katex.min.css';
import 'simplebar-react/dist/simplebar.min.css';
import './scrollbar.css';
import { AppShell } from './components/app/AppShell';
import { useAppController } from './AppController';
import { ChatTabsProvider } from './components/chat/shared/ChatTabsContext';

export default function App() {
  const shellProps = useAppController();
  const {
    tabs,
    activeTabId,
    switchTab,
    handleNewChat,
    closeTab,
  } = shellProps;

  return (
    <ChatTabsProvider
      tabs={tabs}
      activeTabId={activeTabId}
      switchTab={switchTab}
      addTab={handleNewChat}
      closeTab={closeTab}
    >
      <AppShell {...shellProps} />
    </ChatTabsProvider>
  );
}
