import React, { useMemo, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  CreditCard,
  FolderOpen,
  MessageCircle,
  PowerOff,
  RefreshCw,
  Rocket,
  Server,
  Shield,
  Terminal,
  Trash2,
  Sparkles,
  X,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export type CloudRuntimeView =
  | 'chat'
  | 'overview'
  | 'monitoring'
  | 'billing'
  | 'proactive'
  | 'deploys'
  | 'permissions';

export type SyncState = 'synced' | 'out_of_sync' | 'syncing' | 'unknown';

interface CloudRuntimeWorkspaceProps {
  engine: any;
  pauseLoading?: boolean;
  syncState?: SyncState;
  onPause: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onSync?: () => void | Promise<any>;
  explorer: React.ReactNode;
  terminal: React.ReactNode;
  views: Record<CloudRuntimeView, React.ReactNode>;
}

const VIEW_ITEMS: Array<{
  id: CloudRuntimeView | 'files' | 'terminal';
  icon: any;
  label: string;
  toggle?: 'explorer' | 'terminal';
}> = [
  { id: 'files', icon: FolderOpen, label: 'Files', toggle: 'explorer' },
  { id: 'chat', icon: MessageCircle, label: 'Chat' },
  { id: 'overview', icon: Server, label: 'Overview' },
  { id: 'monitoring', icon: Activity, label: 'Monitoring' },
  { id: 'deploys', icon: Rocket, label: 'Deploys' },
  { id: 'proactive', icon: Sparkles, label: 'Proactive' },
  { id: 'billing', icon: CreditCard, label: 'Billing' },
  { id: 'permissions', icon: Shield, label: 'Permissions' },
  { id: 'terminal', icon: Terminal, label: 'Terminal', toggle: 'terminal' },
];

const MIN_TERMINAL_H = 140;
const MAX_TERMINAL_H = 500;
const DEFAULT_TERMINAL_H = 220;

export function CloudRuntimeWorkspace({
  engine,
  pauseLoading = false,
  syncState = 'unknown',
  onPause,
  onRefresh,
  onDelete,
  onSync,
  explorer,
  terminal,
  views,
}: CloudRuntimeWorkspaceProps) {
  const [activeView, setActiveView] = useState<CloudRuntimeView>('chat');
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_H);

  const activeLabel = useMemo(
    () => VIEW_ITEMS.find(item => item.id === activeView)?.label ?? 'Chat',
    [activeView],
  );

  const planLabel = String(engine?.tier || 'cloud').replace(/^\w/, (c: string) => c.toUpperCase());
  const machineLabel =
    engine?.vcpus && engine?.ram_gb
      ? `${engine.vcpus} vCPU / ${engine.ram_gb} GB`
      : 'Runtime';

  const handleTerminalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setTerminalHeight(Math.max(MIN_TERMINAL_H, Math.min(MAX_TERMINAL_H, startH + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  return (
    <div className="flex h-full no-drag">
      {/* Activity Bar */}
      <aside className="w-[48px] shrink-0 flex flex-col items-center py-2 gap-0.5 border-r border-theme bg-theme-card/20">
        <nav className="flex flex-col items-center gap-0.5 w-full px-1.5">
          {VIEW_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive =
              item.toggle === 'explorer'
                ? explorerOpen
                : item.toggle === 'terminal'
                  ? terminalOpen
                  : activeView === item.id;

            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => {
                  if (item.toggle === 'explorer') {
                    setExplorerOpen(v => !v);
                    return;
                  }
                  if (item.toggle === 'terminal') {
                    setTerminalOpen(v => !v);
                    return;
                  }
                  setActiveView(item.id as CloudRuntimeView);
                }}
                className={clsx(
                  'w-full h-8 flex items-center justify-center rounded-lg transition-all',
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60',
                )}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-1 px-1.5 pb-1">
          <div className="w-8 h-8 flex items-center justify-center" title={`Engine: ${engine.status}`}>
            <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.4)]" />
          </div>
        </div>
      </aside>

      {/* Explorer panel */}
      {explorerOpen && (
        <section className="w-[240px] shrink-0 border-r border-theme overflow-hidden bg-theme-card/10">
          {explorer}
        </section>
      )}

      {/* Main content */}
      <section className="flex-1 min-w-0 flex flex-col">
        {/* Compact top bar */}
        <header className="h-[40px] flex items-center justify-between gap-3 px-4 border-b border-theme shrink-0">
          <div className="flex items-center gap-2 min-w-0 text-[11px]">
            <span className="text-theme-muted truncate">{engine?.instance_name || 'Cloud Engine'}</span>
            <span className="text-theme-muted/30">/</span>
            <span className="text-theme-fg font-medium">{activeLabel}</span>
            <span className="text-theme-muted/30 hidden sm:inline">·</span>
            <span className="text-theme-muted hidden sm:inline">{planLabel} · {machineLabel}</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] text-theme-muted mr-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Running
            </div>
            {/* Sync status badge */}
            {syncState === 'synced' && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] text-green-500 mr-1" title="Memories synced">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Synced
              </div>
            )}
            {syncState === 'out_of_sync' && (
              <button
                type="button"
                onClick={onSync}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] text-amber-500 hover:bg-amber-500/10 transition-colors mr-1"
                title="Memories out of sync — click to sync"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Out of Sync
              </button>
            )}
            {syncState === 'syncing' && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] text-blue-400 mr-1" title="Syncing memories...">
                <Loader2 className="w-3 h-3 animate-spin" />
                Syncing
              </div>
            )}
            <button
              type="button"
              className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              onClick={onRefresh}
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="p-1.5 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
              onClick={onPause}
              title="Pause"
            >
              {pauseLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              className="p-1.5 rounded-lg text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Active view */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {views[activeView]}
        </div>

        {/* Terminal dock */}
        {terminalOpen && (
          <div className="shrink-0 flex flex-col border-t border-theme" style={{ height: terminalHeight }}>
            {/* Resize handle */}
            <div
              className="h-[3px] cursor-ns-resize hover:bg-primary/30 transition-colors shrink-0"
              onMouseDown={handleTerminalResize}
            />
            <div className="h-[32px] flex items-center justify-between px-3 shrink-0">
              <div className="flex items-center gap-2 text-[10px] text-theme-muted font-medium uppercase tracking-wider">
                <Terminal className="w-3 h-3" />
                Terminal
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="p-1 rounded text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
                  onClick={() => setTerminalHeight(h => h === MIN_TERMINAL_H ? DEFAULT_TERMINAL_H : MIN_TERMINAL_H)}
                  title={terminalHeight === MIN_TERMINAL_H ? 'Expand' : 'Minimize'}
                >
                  {terminalHeight === MIN_TERMINAL_H ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button
                  type="button"
                  className="p-1 rounded text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60 transition-colors"
                  onClick={() => setTerminalOpen(false)}
                  title="Close"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {terminal}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
