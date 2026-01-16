import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './scrollbar.css';
import { SpacesSidebar } from './components/SpacesSidebar';
import { usePreferences } from './hooks/usePreferences';

function SpacesApp() {
  const { translucentMode, themeMode, themeDarkShade, themeLightShade, themeText } = usePreferences();

  // Apply theme to document element (same as App.tsx)
  useEffect(() => {
    const root = document.documentElement;

    // Apply data-theme attribute
    if (themeMode === 'dark' || themeMode === 'custom') {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
    } else {
      root.setAttribute('data-theme', 'light');
      root.classList.remove('dark');
    }

    // Apply custom theme colors if in custom mode
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

  return (
    <div className="w-full h-full p-2">
      <SpacesSidebar
        className="h-full"
        translucentMode={translucentMode}
        onClose={() => {
          try { window.desktopAPI?.closeSpaces?.(); } catch {}
        }}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SpacesApp />
  </React.StrictMode>
);
