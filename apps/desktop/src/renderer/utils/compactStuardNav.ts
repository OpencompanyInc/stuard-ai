import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  Bot,
  Calendar,
  Clock,
  Cloud,
  HardDrive,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  Link,
  ListTodo,
  Rocket,
  Settings,
  Share2,
  Sparkles,
  Store,
  Wand2,
} from 'lucide-react';

export type CompactNavGroup = 'dashboard' | 'studio';

export type StudioView = 'workflows' | 'deployed' | 'shared' | 'marketplace' | 'skills';

export type DashboardTab =
  | 'overview'
  | 'history'
  | 'planner'
  | 'tasks'
  | 'memories'
  | 'bots'
  | 'cloud'
  | 'media'
  | 'storage'
  | 'integrations'
  | 'settings';

export interface CompactStuardNavItem {
  id: string;
  group: CompactNavGroup;
  title: string;
  subtitle: string;
  keywords: string[];
  icon: LucideIcon;
  tile: string;
  run: () => void;
}

function hideOverlay() {
  try {
    (window as any).desktopAPI?.hide?.();
  } catch {
    // no-op
  }
}

function openDashboardTab(tab: DashboardTab) {
  try {
    (window as any).desktopAPI?.openDashboard?.({ tab });
  } catch {
    // no-op
  }
  hideOverlay();
}

function openStudioView(view?: StudioView, workflowId?: string) {
  try {
    (window as any).desktopAPI?.openWorkflows?.({
      ...(view ? { view } : {}),
      ...(workflowId ? { workflowId } : {}),
    });
  } catch {
    // no-op
  }
  hideOverlay();
}

const DASHBOARD_NAV: Omit<CompactStuardNavItem, 'run'>[] = [
  {
    id: 'dash-overview',
    group: 'dashboard',
    title: 'Overview',
    subtitle: 'Dashboard · overview & activity',
    icon: LayoutDashboard,
    tile: '#2563EB',
    keywords: ['overview', 'home', 'dashboard', 'dash', 'today', 'activity'],
  },
  {
    id: 'dash-history',
    group: 'dashboard',
    title: 'History',
    subtitle: 'Dashboard · conversations & usage',
    icon: Clock,
    tile: '#2563EB',
    keywords: ['history', 'conversations', 'chat', 'past', 'recent'],
  },
  {
    id: 'dash-planner',
    group: 'dashboard',
    title: 'Planner',
    subtitle: 'Dashboard · plan your day',
    icon: Calendar,
    tile: '#2563EB',
    keywords: ['planner', 'plan', 'calendar', 'schedule', 'day'],
  },
  {
    id: 'dash-tasks',
    group: 'dashboard',
    title: 'Tasks',
    subtitle: 'Dashboard · track to-dos',
    icon: ListTodo,
    tile: '#2563EB',
    keywords: ['tasks', 'todo', 'todos', 'checklist'],
  },
  {
    id: 'dash-memories',
    group: 'dashboard',
    title: 'Memories',
    subtitle: 'Dashboard · saved context & notes',
    icon: Archive,
    tile: '#2563EB',
    keywords: ['memories', 'memory', 'notes', 'remember', 'context'],
  },
  {
    id: 'dash-bots',
    group: 'dashboard',
    title: 'Agents',
    subtitle: 'Dashboard · build & deploy agents',
    icon: Bot,
    tile: '#2563EB',
    keywords: ['agents', 'agent', 'bots', 'bot', 'proactive'],
  },
  {
    id: 'dash-cloud',
    group: 'dashboard',
    title: 'Cloud Engine',
    subtitle: 'Dashboard · remote runtime & deploys',
    icon: Cloud,
    tile: '#2563EB',
    keywords: ['cloud', 'engine', 'vm', 'deploy', 'runtime', 'remote'],
  },
  {
    id: 'dash-media',
    group: 'dashboard',
    title: 'Media',
    subtitle: 'Dashboard · gallery & attachments',
    icon: ImageIcon,
    tile: '#2563EB',
    keywords: ['media', 'gallery', 'images', 'photos', 'files', 'attachments'],
  },
  {
    id: 'dash-storage',
    group: 'dashboard',
    title: 'Storage',
    subtitle: 'Dashboard · local & cloud storage',
    icon: HardDrive,
    tile: '#2563EB',
    keywords: ['storage', 'disk', 'space', 'uploads', 'files'],
  },
  {
    id: 'dash-integrations',
    group: 'dashboard',
    title: 'Connected Apps',
    subtitle: 'Dashboard · integrations & connections',
    icon: Link,
    tile: '#2563EB',
    keywords: ['integrations', 'integration', 'connected', 'apps', 'connect', 'oauth'],
  },
  {
    id: 'dash-settings',
    group: 'dashboard',
    title: 'Settings',
    subtitle: 'Dashboard · themes & preferences',
    icon: Settings,
    tile: '#2563EB',
    keywords: ['settings', 'setting', 'preferences', 'theme', 'config', 'account'],
  },
];

const STUDIO_NAV: Omit<CompactStuardNavItem, 'run'>[] = [
  {
    id: 'studio-home',
    group: 'studio',
    title: 'Stuard Studio',
    subtitle: 'Open workflow studio',
    icon: Sparkles,
    tile: '#7C3AED',
    keywords: ['stuard', 'studio', 'workflow', 'workflows', 'automation', 'builder'],
  },
  {
    id: 'studio-workflows',
    group: 'studio',
    title: 'My Workflows',
    subtitle: 'Studio · your workflow projects',
    icon: Layers,
    tile: '#7C3AED',
    keywords: ['my', 'workflows', 'projects', 'flows', 'local'],
  },
  {
    id: 'studio-skills',
    group: 'studio',
    title: 'Skills',
    subtitle: 'Studio · reusable agent behaviors',
    icon: Wand2,
    tile: '#7C3AED',
    keywords: ['skills', 'skill', 'behaviors', 'reusable'],
  },
  {
    id: 'studio-deployed',
    group: 'studio',
    title: 'Deployed Workflows',
    subtitle: 'Studio · live & running automations',
    icon: Rocket,
    tile: '#7C3AED',
    keywords: ['deployed', 'deploy', 'live', 'running', 'production', 'start', 'stop'],
  },
  {
    id: 'studio-shared',
    group: 'studio',
    title: 'Shared Workflows',
    subtitle: 'Studio · shared with your team',
    icon: Share2,
    tile: '#7C3AED',
    keywords: ['shared', 'share', 'team', 'collaboration'],
  },
  {
    id: 'studio-marketplace',
    group: 'studio',
    title: 'Marketplace',
    subtitle: 'Studio · browse community workflows',
    icon: Store,
    tile: '#7C3AED',
    keywords: ['marketplace', 'market', 'community', 'install', 'download', 'store'],
  },
];

const TAB_BY_NAV_ID: Record<string, DashboardTab> = {
  'dash-overview': 'overview',
  'dash-history': 'history',
  'dash-planner': 'planner',
  'dash-tasks': 'tasks',
  'dash-memories': 'memories',
  'dash-bots': 'bots',
  'dash-cloud': 'cloud',
  'dash-media': 'media',
  'dash-storage': 'storage',
  'dash-integrations': 'integrations',
  'dash-settings': 'settings',
};

const VIEW_BY_NAV_ID: Record<string, StudioView | undefined> = {
  'studio-home': undefined,
  'studio-workflows': 'workflows',
  'studio-skills': 'skills',
  'studio-deployed': 'deployed',
  'studio-shared': 'shared',
  'studio-marketplace': 'marketplace',
};

function buildAllNavItems(): CompactStuardNavItem[] {
  const dashboardItems = DASHBOARD_NAV.map((item) => ({
    ...item,
    run: () => openDashboardTab(TAB_BY_NAV_ID[item.id]),
  }));
  const studioItems = STUDIO_NAV.map((item) => ({
    ...item,
    run: () => openStudioView(VIEW_BY_NAV_ID[item.id]),
  }));
  return [...dashboardItems, ...studioItems];
}

function scoreNavMatch(item: CompactStuardNavItem, q: string): number {
  const title = item.title.toLowerCase();
  const subtitle = item.subtitle.toLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 90;
  if (title.includes(q)) return 80;
  if (subtitle.includes(q)) return 70;
  if (item.keywords.some((k) => k === q)) return 85;
  if (item.keywords.some((k) => k.startsWith(q) || q.startsWith(k))) return 75;
  if (item.keywords.some((k) => k.includes(q) || q.includes(k))) return 60;
  if (item.group === 'dashboard' && (q.includes('dash') || q.includes('dashboard'))) return 40;
  if (item.group === 'studio' && (q.includes('studio') || q.includes('workflow'))) return 35;
  return 0;
}

/** Ranked Stuard navigation destinations for compact-mode search. */
export function filterCompactStuardNav(query: string, max = 10): CompactStuardNavItem[] {
  const q = (query || '').toLowerCase().trim();
  if (!q || q.length < 2) return [];

  return buildAllNavItems()
    .map((item) => ({ item, score: scoreNavMatch(item, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, max)
    .map(({ item }) => item);
}

export function openWorkflowInStudio(workflowId: string) {
  openStudioView(undefined, workflowId);
}

export async function runDeployedWorkflow(workflowId: string, name?: string) {
  try {
    await (window as any).desktopAPI?.workflowsRun?.(workflowId);
    hideOverlay();
    (window as any).desktopAPI?.notify?.('Workflow Started', `Running ${name || 'workflow'}...`);
  } catch (e) {
    console.error(e);
  }
}
