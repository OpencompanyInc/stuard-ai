import type { DashboardTab } from './compactStuardNav';

/** Navigate from a discovery tip `actionRoute` (workflows, integrations, bots, …). */
export function navigateDiscoveryRoute(route: string): void {
  const api = (window as any).desktopAPI;
  if (!api) return;

  const hide = () => {
    try {
      api.hide?.();
    } catch {
      // no-op
    }
  };

  const openDashboard = (tab: DashboardTab | string) => {
    try {
      api.openDashboard?.({ tab });
    } catch {
      // no-op
    }
    hide();
  };

  const openStudio = (view?: string) => {
    try {
      api.openWorkflows?.(view ? { view } : undefined);
    } catch {
      // no-op
    }
    hide();
  };

  switch (route) {
    case 'workflows':
    case 'automations':
      openStudio('workflows');
      break;
    case 'bots':
    case 'proactive':
      openStudio('agents');
      break;
    case 'planner':
      openDashboard('planner');
      break;
    case 'integrations':
      openDashboard('integrations');
      break;
    case 'memories':
      openDashboard('memories');
      break;
    case 'history':
      openDashboard('history');
      break;
    case 'cloud':
      openDashboard('cloud');
      break;
    case 'settings':
    case 'settings:proactive':
      openDashboard('settings');
      break;
    default:
      if (route.startsWith('settings/')) {
        openDashboard(route);
      }
      break;
  }
}
