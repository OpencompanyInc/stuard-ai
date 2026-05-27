import type { LucideIcon } from 'lucide-react';

export type CloudRuntimeView =
  | 'chat'
  | 'overview'
  | 'monitoring'
  | 'billing'
  | 'deploys'
  | 'integrations'
  | 'permissions'
  | 'bots'
  | 'automations'
  | 'settings';

export type CloudRuntimeMode = 'normal' | 'developer';
export type CloudRuntimeSyncState = 'synced' | 'out_of_sync' | 'syncing' | 'unknown';

export const CLOUD_RUNTIME_MODE_STORAGE_KEY = 'cloud:runtime-mode';

export type CloudRuntimeViewItem = {
  id: CloudRuntimeView | 'files' | 'terminal';
  icon: LucideIcon | any;
  label: string;
  toggle?: 'explorer' | 'terminal';
  footer?: boolean;
};

export function isCloudRuntimeFooterItem(item: CloudRuntimeViewItem): boolean {
  return item.id === 'settings' || item.toggle === 'terminal' || !!item.footer;
}

export function buildCloudRuntimeViewItems(icons: {
  chat: LucideIcon;
  bots: LucideIcon;
  files: LucideIcon;
  automations: LucideIcon;
  settings: LucideIcon;
  overview: LucideIcon;
  monitoring: LucideIcon;
  integrations: LucideIcon;
  deploys: LucideIcon;
  billing: LucideIcon;
  permissions: LucideIcon;
  terminal: LucideIcon;
}): { normal: CloudRuntimeViewItem[]; developer: CloudRuntimeViewItem[] } {
  return {
    normal: [
      { id: 'chat', icon: icons.chat, label: 'Chat' },
      { id: 'bots', icon: icons.bots, label: 'Agents' },
      { id: 'files', icon: icons.files, label: 'Files' },
      { id: 'automations', icon: icons.automations, label: 'Automations' },
      { id: 'settings', icon: icons.settings, label: 'Settings', footer: true },
    ],
    developer: [
      { id: 'files', icon: icons.files, label: 'Files', toggle: 'explorer' },
      { id: 'chat', icon: icons.chat, label: 'Chat' },
      { id: 'overview', icon: icons.overview, label: 'Overview' },
      { id: 'monitoring', icon: icons.monitoring, label: 'Monitoring' },
      { id: 'bots', icon: icons.bots, label: 'Agents' },
      { id: 'automations', icon: icons.automations, label: 'Automations' },
      { id: 'integrations', icon: icons.integrations, label: 'Integrations' },
      { id: 'deploys', icon: icons.deploys, label: 'Deploys' },
      { id: 'billing', icon: icons.billing, label: 'Billing' },
      { id: 'permissions', icon: icons.permissions, label: 'Permissions' },
      { id: 'settings', icon: icons.settings, label: 'Settings', footer: true },
      { id: 'terminal', icon: icons.terminal, label: 'Terminal', toggle: 'terminal', footer: true },
    ],
  };
}

export {
  CloudRuntimeActivityBar,
  type CloudRuntimeActivityBarProps,
  type CloudRuntimeActivityBarVariant,
} from './CloudRuntimeActivityBar';
