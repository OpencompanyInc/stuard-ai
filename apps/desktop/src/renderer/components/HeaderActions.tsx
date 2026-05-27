// Header actions slot
// ---------------------
// The dashboard has exactly ONE top bar, and it owns every primary CTA. Pages
// don't render their own toolbars — instead a page registers its primary
// actions here and the unified header renders them on the right side.
//
// Usage from any view rendered inside the dashboard:
//
//   useRegisterHeaderActions([
//     { id: 'refresh', label: 'Refresh', icon: RefreshCw, onClick: refresh, loading },
//     { id: 'deploy',  label: 'Deploy',  icon: Rocket,    onClick: deploy, variant: 'primary' },
//   ], [loading]);
//
// Actions are cleared automatically when the view unmounts (tab switch).

import React, { createContext, useContext, useEffect } from 'react';

export interface HeaderAction {
  /** Stable identifier (also used as React key). */
  id: string;
  /** Button label. Optional — omit for an icon-only button. */
  label?: string;
  /** Lucide (or any) icon component. */
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  /** Shows a spinning icon + disables the button. */
  loading?: boolean;
  /** 'primary' = filled brand pill, 'secondary' (default) = subtle outline pill. */
  variant?: 'primary' | 'secondary';
  /** Tooltip / aria-label. */
  title?: string;
}

interface HeaderActionsContextValue {
  setActions: (actions: HeaderAction[]) => void;
}

export const HeaderActionsContext = createContext<HeaderActionsContextValue>({
  setActions: () => {},
});

/**
 * Register this view's primary CTAs into the unified header. Pass the same kind
 * of `deps` you'd pass to useEffect — the actions are re-published whenever they
 * change, and cleared when the component unmounts.
 */
export function useRegisterHeaderActions(actions: HeaderAction[], deps: React.DependencyList): void {
  const { setActions } = useContext(HeaderActionsContext);
  useEffect(() => {
    setActions(actions);
    return () => setActions([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
