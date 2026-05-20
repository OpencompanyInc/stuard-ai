import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './scrollbar.css';
import { usePreferences } from './hooks/usePreferences';
import { SidebarView } from './components/chat/shared/sidebar/SidebarView';

type SidebarTabId = 'terminal' | 'todo' | 'projects';

function SidebarApp() {
  const { translucentMode, themeMode, themeDarkShade, themeLightShade, themeText } = usePreferences();

  // Parse URL params for initial tab and expanded state
  const urlParams = new URLSearchParams(window.location.search);
  const rawTab = urlParams.get('tab') as SidebarTabId | null;
  const initialTab: SidebarTabId =
    rawTab === 'terminal' || rawTab === 'todo' || rawTab === 'projects' ? rawTab : 'projects';
  const initialExpanded = urlParams.get('expanded') === 'true';

  const [activeTab, setActiveTab] = useState<SidebarTabId>(initialTab);
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  // Notify main process of active tab changes
  useEffect(() => {
    Promise.resolve((window as any).desktopAPI?.sidebarSetPresentation?.('full', activeTab)).catch(() => {});
  }, [activeTab]);

  // Load initial expanded state from main process (fallback)
  useEffect(() => {
    if (!initialExpanded) {
      (window as any).desktopAPI?.isSidebarExpanded?.().then((res: any) => {
        if (res?.expanded !== undefined) setIsExpanded(res.expanded);
      }).catch(() => {});
    }
  }, []);

  // Listen for expanded state changes
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onSidebarExpandedChange?.((data: { expanded: boolean }) => {
      setIsExpanded(data.expanded);
    });
    return () => { try { (typeof unsub === 'function') && unsub(); } catch {} };
  }, []);

  const handleToggleExpand = () => {
    (window as any).desktopAPI?.toggleSidebarExpanded?.().then((res: any) => {
      if (res?.expanded !== undefined) setIsExpanded(res.expanded);
    }).catch(() => {});
  };

  // Apply theme to document element
  useEffect(() => {
    const root = document.documentElement;

    if (themeMode === 'dark' || themeMode === 'custom') {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.remove('dark');
    }

    if (themeMode === 'custom') {
      root.style.setProperty('--custom-gradient-start', themeDarkShade);
      root.style.setProperty('--custom-gradient-end', themeLightShade);
      root.style.setProperty('--custom-text-color', themeText === 'white' ? '#ffffff' : '#000000');
    } else {
      root.style.removeProperty('--custom-gradient-start');
      root.style.removeProperty('--custom-gradient-end');
      root.style.removeProperty('--custom-text-color');
    }
  }, [themeMode, themeDarkShade, themeLightShade, themeText]);

  // Listen for theme broadcasts from main App window
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onThemeUpdated?.((data: any) => {
      // Theme will be picked up by usePreferences via localStorage
    });
    return () => { try { (typeof unsub === 'function') && unsub(); } catch { } };
  }, []);

  // Listen for tab navigation from main process
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onSidebarNavigate?.((data: { tab: SidebarTabId }) => {
      if (data?.tab) setActiveTab(data.tab);
    });
    return () => { try { (typeof unsub === 'function') && unsub(); } catch { } };
  }, []);

  return (
    <div className="w-full h-full">
      <SidebarView
        activeTab={activeTab}
        onTabChange={setActiveTab}
        translucentMode={translucentMode}
        isExpanded={isExpanded}
        onToggleExpand={handleToggleExpand}
        onClose={() => {
          try { (window as any).desktopAPI?.closeSidebar?.(); } catch {}
        }}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SidebarApp />
  </React.StrictMode>
);
