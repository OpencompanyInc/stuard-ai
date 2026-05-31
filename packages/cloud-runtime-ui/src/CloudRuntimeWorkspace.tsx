import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  Bot as BotIcon,
  CreditCard,
  FolderOpen,
  Link2,
  MessageCircle,
  PowerOff,
  RefreshCw,
  Rocket,
  Server,
  Settings,
  Shield,
  Terminal,
  Trash2,
  X,
  Zap,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { FileViewerProvider, FileViewerPane, useFileViewer, type FileFetcher, type ServeUrlBuilder, type PreviewUrlBuilder } from './file-viewer';
import {
  CLOUD_RUNTIME_MODE_STORAGE_KEY,
  buildCloudRuntimeViewItems,
  type CloudRuntimeView,
  type CloudRuntimeMode,
} from './shell/constants';
import {
  CloudRuntimeActivityBar,
  type CloudRuntimeActivityBarVariant,
} from './shell/CloudRuntimeActivityBar';

export type { CloudRuntimeView, CloudRuntimeMode } from './shell/constants';
export type SyncState = 'synced' | 'out_of_sync' | 'syncing' | 'unknown';

const MODE_STORAGE_KEY = CLOUD_RUNTIME_MODE_STORAGE_KEY;

const { normal: NORMAL_VIEW_ITEMS, developer: DEVELOPER_VIEW_ITEMS } = buildCloudRuntimeViewItems({
  chat: MessageCircle,
  bots: BotIcon,
  files: FolderOpen,
  automations: Zap,
  settings: Settings,
  overview: Server,
  monitoring: Activity,
  integrations: Link2,
  deploys: Rocket,
  billing: CreditCard,
  permissions: Shield,
  terminal: Terminal,
});

const MIN_TERMINAL_H = 140;
const MAX_TERMINAL_H = 500;
const DEFAULT_TERMINAL_H = 220;

const MIN_VIEWER_W = 280;
const MAX_VIEWER_W = 900;
const DEFAULT_VIEWER_W = 420;

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
  /** Used by the file viewer pane to load file content from the VM. */
  fileFetcher?: FileFetcher | null;
  /** Used by the HTML preview renderer — returns an iframe-loadable URL. */
  serveUrlBuilder?: ServeUrlBuilder | null;
  /** Mints a localhost-port preview session in the VM (Next.js, Vite, etc.). */
  previewUrlBuilder?: PreviewUrlBuilder | null;
  /** Activity bar styling — website hosts should use `desktop` to match the Electron dashboard. */
  activityBarVariant?: CloudRuntimeActivityBarVariant;
}

export function CloudRuntimeWorkspace(props: CloudRuntimeWorkspaceProps) {
  return (
    <FileViewerProvider
      fetcher={props.fileFetcher ?? null}
      serveUrlBuilder={props.serveUrlBuilder ?? null}
      previewUrlBuilder={props.previewUrlBuilder ?? null}
    >
      <CloudRuntimeWorkspaceInner {...props} />
    </FileViewerProvider>
  );
}

function CloudRuntimeWorkspaceInner({
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
  activityBarVariant = 'desktop',
}: CloudRuntimeWorkspaceProps) {
  const [mode, setModeState] = useState<CloudRuntimeMode>(() => {
    if (typeof window === 'undefined') return 'normal';
    const stored = window.localStorage?.getItem(MODE_STORAGE_KEY);
    return stored === 'developer' ? 'developer' : 'normal';
  });
  const setMode = useCallback((next: CloudRuntimeMode) => {
    setModeState(next);
    try { window.localStorage?.setItem(MODE_STORAGE_KEY, next); } catch { /* noop */ }
  }, []);

  const [activeView, setActiveView] = useState<CloudRuntimeView>('chat');
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_H);
  const [viewerWidth, setViewerWidth] = useState(DEFAULT_VIEWER_W);

  const items = mode === 'normal' ? NORMAL_VIEW_ITEMS : DEVELOPER_VIEW_ITEMS;

  // If the active view doesn't exist in the current mode's nav, snap to chat.
  useEffect(() => {
    const allowed = items.filter(i => !i.toggle).map(i => i.id);
    if (!allowed.includes(activeView)) setActiveView('chat');
  }, [items, activeView]);

  // Force technical panels closed when switching to Normal mode.
  useEffect(() => {
    if (mode === 'normal') {
      setExplorerOpen(false);
      setTerminalOpen(false);
    }
  }, [mode]);

  const fileViewer = useFileViewer();
  const viewerVisible = fileViewer.isOpen && fileViewer.tabs.length > 0;

  const handleViewerResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = viewerWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setViewerWidth(Math.max(MIN_VIEWER_W, Math.min(MAX_VIEWER_W, startW + delta)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [viewerWidth]);

  const activeLabel = useMemo(
    () => items.find(item => item.id === activeView)?.label ?? 'Chat',
    [items, activeView],
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
      <CloudRuntimeActivityBar
        items={items}
        activeView={activeView}
        explorerOpen={explorerOpen}
        terminalOpen={terminalOpen}
        engineStatus={engine.status}
        variant={activityBarVariant}
        onActivate={(item) => {
          if (item.toggle === 'explorer') { setExplorerOpen(v => !v); return; }
          if (item.toggle === 'terminal') { setTerminalOpen(v => !v); return; }
          setActiveView(item.id as CloudRuntimeView);
        }}
      />

      {/* Explorer panel — developer mode only (Normal mode renders Files in the main pane) */}
      {mode === 'developer' && explorerOpen && (
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
            {mode === 'developer' && (
              <>
                <span className="text-theme-muted/30 hidden sm:inline">·</span>
                <span className="text-theme-muted hidden sm:inline">{planLabel} · {machineLabel}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Mode toggle — text-button pill */}
            <div className="mr-2 inline-flex items-center rounded-full bg-theme-hover/40 p-0.5 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setMode('normal')}
                className={clsx(
                  'px-2.5 py-1 rounded-full transition-colors',
                  mode === 'normal'
                    ? 'bg-theme-card text-theme-fg shadow-sm'
                    : 'text-theme-muted hover:text-theme-fg',
                )}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => setMode('developer')}
                className={clsx(
                  'px-2.5 py-1 rounded-full transition-colors',
                  mode === 'developer'
                    ? 'bg-theme-card text-theme-fg shadow-sm'
                    : 'text-theme-muted hover:text-theme-fg',
                )}
              >
                Developer
              </button>
            </div>

            {mode === 'developer' && (
              <>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] text-theme-muted mr-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Running
                </div>
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
              </>
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
              title={mode === 'normal' ? 'Pause your cloud' : 'Pause'}
            >
              {pauseLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
            </button>
            {mode === 'developer' && (
              <button
                type="button"
                className="p-1.5 rounded-lg text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                onClick={onDelete}
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </header>

        {/* Active view */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {(activeView as string) === 'files' ? explorer : views[activeView]}
        </div>

        {/* Terminal dock (anchored under chat/main area) — developer mode only */}
        {mode === 'developer' && terminalOpen && (
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

      {/* Right-side File Viewer pane */}
      {viewerVisible && (
        <>
          <div
            className="w-[3px] cursor-ew-resize hover:bg-primary/30 transition-colors shrink-0"
            onMouseDown={handleViewerResize}
            title="Drag to resize viewer"
          />
          <aside
            className="shrink-0 border-l border-theme bg-theme-card/10 overflow-hidden"
            style={{ width: viewerWidth }}
          >
            <FileViewerPane bare />
          </aside>
        </>
      )}
    </div>
  );
}
