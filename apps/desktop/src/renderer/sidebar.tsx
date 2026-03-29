import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './scrollbar.css';
import { usePreferences } from './hooks/usePreferences';
import { SidebarView } from './components/sidebar/SidebarView';

type SidebarTabId = 'spaces' | 'terminal' | 'tasks' | 'browser' | 'todo';

function SidebarApp() {
  const { translucentMode, themeMode, themeDarkShade, themeLightShade, themeText } = usePreferences();

  // Parse URL params for initial tab and expanded state
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = (urlParams.get('tab') as SidebarTabId) || 'spaces';
  const initialExpanded = urlParams.get('expanded') === 'true';

  const [activeTab, setActiveTab] = useState<SidebarTabId>(initialTab);
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [selectedItem, setSelectedItem] = useState<{ type: 'space'; id: string } | null>(null);

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

  // Listen for selectItem event from main process (bookmark navigation)
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onSidebarSelectItem?.((data: { type: 'space'; id: string }) => {
      if (data?.type && data?.id) {
        if (data.type === 'space') setActiveTab('spaces');
        setSelectedItem(data);
      }
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
        selectedItem={selectedItem}
        onSelectedItemHandled={() => setSelectedItem(null)}
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
