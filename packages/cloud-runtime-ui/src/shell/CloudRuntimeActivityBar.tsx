import React from 'react';
import { clsx } from 'clsx';
import {
  isCloudRuntimeFooterItem,
  type CloudRuntimeView,
  type CloudRuntimeViewItem,
} from './constants';

export type CloudRuntimeActivityBarVariant = 'desktop' | 'website';

export interface CloudRuntimeActivityBarProps {
  items: CloudRuntimeViewItem[];
  activeView: CloudRuntimeView;
  explorerOpen: boolean;
  terminalOpen: boolean;
  onActivate: (item: CloudRuntimeViewItem) => void;
  engineStatus?: string;
  variant?: CloudRuntimeActivityBarVariant;
}

function ActivityBarButton({
  item,
  activeView,
  explorerOpen,
  terminalOpen,
  onActivate,
  variant,
}: {
  item: CloudRuntimeViewItem;
  activeView: CloudRuntimeView;
  explorerOpen: boolean;
  terminalOpen: boolean;
  onActivate: () => void;
  variant: CloudRuntimeActivityBarVariant;
}) {
  const Icon = item.icon;
  const isActive =
    item.toggle === 'explorer'
      ? explorerOpen
      : item.toggle === 'terminal'
        ? terminalOpen
        : activeView === item.id;

  return (
    <button
      type="button"
      title={item.label}
      onClick={onActivate}
      className={clsx(
        variant === 'website'
          ? clsx('ide-activity-btn', isActive && 'ide-activity-btn-active')
          : clsx(
              'w-full h-8 flex items-center justify-center rounded-lg transition-all',
              isActive
                ? 'bg-primary/15 text-primary'
                : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60',
            ),
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

export function CloudRuntimeActivityBar({
  items,
  activeView,
  explorerOpen,
  terminalOpen,
  onActivate,
  engineStatus = 'unknown',
  variant = 'desktop',
}: CloudRuntimeActivityBarProps) {
  const topItems = items.filter((item) => !isCloudRuntimeFooterItem(item));
  const footerItems = items.filter(isCloudRuntimeFooterItem);

  const renderButton = (item: CloudRuntimeViewItem) => (
    <ActivityBarButton
      key={item.id}
      item={item}
      activeView={activeView}
      explorerOpen={explorerOpen}
      terminalOpen={terminalOpen}
      variant={variant}
      onActivate={() => onActivate(item)}
    />
  );

  if (variant === 'website') {
    return (
      <aside className="ide-activity-bar">
        {topItems.map(renderButton)}
        <div className="flex-1" />
        {footerItems.length > 0 && (
          <div className="flex w-full flex-col items-center gap-0.5 border-t border-theme/40 pt-1 mt-1">
            {footerItems.map(renderButton)}
          </div>
        )}
        <div title={`Engine: ${engineStatus}`} className="flex h-8 w-8 items-center justify-center">
          <span className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[48px] shrink-0 flex flex-col items-center py-2 gap-0.5 border-r border-theme bg-theme-card/20">
      <nav className="flex flex-col items-center gap-0.5 w-full px-1.5">
        {topItems.map(renderButton)}
      </nav>

      <div className="flex-1" />

      {footerItems.length > 0 && (
        <nav className="flex flex-col items-center gap-0.5 w-full px-1.5 pt-1 mt-1 border-t border-theme/40">
          {footerItems.map(renderButton)}
        </nav>
      )}

      <div className="flex flex-col items-center gap-1 px-1.5 pb-1 pt-1">
        <div className="w-8 h-8 flex items-center justify-center" title={`Engine: ${engineStatus}`}>
          <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
        </div>
      </div>
    </aside>
  );
}
