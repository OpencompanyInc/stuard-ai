import { useEffect } from 'react';

const LS_PREFIX = 'stuard.pref.';

function readThemeMode(): 'light' | 'dark' {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}theme_mode`);
    if (!raw) return 'dark';
    const parsed = JSON.parse(raw);
    return parsed === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyNotificationTheme(mode: 'light' | 'dark') {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.setAttribute('data-wf-theme', mode);
  root.setAttribute('data-stuard-theme', mode);
  if (mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

/** Keep the notification overlay window in sync with the user's Stuard theme. */
export function useNotificationTheme() {
  useEffect(() => {
    applyNotificationTheme(readThemeMode());

    const onStorage = (e: StorageEvent) => {
      if (e.key === `${LS_PREFIX}theme_mode`) {
        applyNotificationTheme(readThemeMode());
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
