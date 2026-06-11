import { useEffect, useState } from 'react';

/**
 * Renderer-side mirror of the main process update state (services/updates.ts).
 * The main process checks hourly and broadcasts `updates:state` to every
 * window — this hook is what lets any surface (compact pill, launcher, window
 * header, dashboard) show an "update ready" indicator without polling.
 */
export interface UpdateStatus {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error'
    | 'up-to-date'
    | string;
  channel?: 'stable' | 'beta' | 'staging' | string;
  currentVersion?: string;
  latestVersion?: string;
  downloadProgress?: number;
}

export function useUpdateStatus(): UpdateStatus {
  const [state, setState] = useState<UpdateStatus>({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;
    const api = (window as any).desktopAPI;
    api?.updatesGetState?.()
      .then((s: UpdateStatus) => {
        if (!cancelled && s && typeof s.status === 'string') setState(s);
      })
      .catch(() => {});
    const unsub = api?.onUpdatesState?.((s: UpdateStatus) => {
      if (s && typeof s.status === 'string') setState(s);
    });
    return () => {
      cancelled = true;
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  return state;
}

/** True when there is a newer version the user can act on. */
export function isUpdateActionable(status: UpdateStatus['status']): boolean {
  return status === 'available' || status === 'downloading' || status === 'downloaded';
}

/** Deep-link to Dashboard → Settings → Updates (works from any window). */
export function openUpdateSettings(): void {
  try {
    (window as any).desktopAPI?.openDashboard?.({ tab: 'settings/updates' });
  } catch {
    /* best effort */
  }
}
