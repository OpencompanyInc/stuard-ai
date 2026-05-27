import { CompactOverlayPortal } from './CompactOverlayPortal';
import { clsx } from 'clsx';
import {
  AppWindow,
  CloudDownload,
  Download,
  ExternalLink,
  Folder,
  Loader2,
  Paperclip,
  Pencil,
  Play,
  Rocket,
  Zap,
} from 'lucide-react';

import { HighlightMatch } from '../HighlightMatch';
import { FIGMA_ROW_BASE, FIGMA_ROW_PRIMARY, FIGMA_KBD } from '../styles';
import { getFileKindConfig } from '../fileKind';
import { getTypeConfig, type Bookmark } from '../../../../QuickShortcuts';
import type { CompactStuardNavItem } from '../../../../../utils/compactStuardNav';

type DropdownOffsets = {
  askStuard: number;
  webSearch: number;
  stuardCommandsStart: number;
  appsStart: number;
  bookmarksStart: number;
  filesStart: number;
  workflowsStart: number;
  marketplaceStart: number;
};

interface StuardCommand extends CompactStuardNavItem {}

interface MarketplaceItem {
  slug: string;
  name: string;
  publisher_name?: string;
}

interface LocalWorkflow {
  id: string;
  name?: string;
  deployed?: boolean;
  running?: boolean;
}

export interface SearchEngineOption {
  id: string;
  name: string;
  icon: React.ReactNode;
}

interface CompactSearchDropdownProps {
  /** Positioning. */
  placement: 'top' | 'bottom';
  inputBarHeight: number;
  maxHeight: number;
  scrollHeight: number;

  /** Query + selection. */
  query: string;
  setQuery: (q: string) => void;
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  offsets: DropdownOffsets;

  /** Section actions. */
  onAskStuard: () => void;
  onWebSearch: () => void;
  activeEngineName: string;
  /** All available web search engines + the active id and a setter, so users
   *  can switch the default engine from inside the dropdown. */
  searchEngines: SearchEngineOption[];
  activeEngineId: string;
  onSelectEngine: (id: string) => void;

  /** Stuard commands. */
  stuardCommands: StuardCommand[];

  /** App search results. */
  appResults: Array<any>;
  fileLoading: boolean;
  fileIconDataUrls: Record<string, string>;
  onLaunchApp: (target: string) => void;

  /** Bookmarks. */
  matchingBookmarks: Bookmark[];
  onExecuteBookmark: (bm: Bookmark) => void;

  /** Files. */
  fileResults: Array<any>;
  fileSemanticLoading: boolean;
  onAddFileAsContext: (f: any) => void;

  /** Workflows. */
  filteredLocalWorkflows: LocalWorkflow[];
  marketplaceResults: MarketplaceItem[];
  isMarketplaceSearching: boolean;
}

/**
 * Compact-mode search dropdown rendered above (or below) the input pill.
 * Owns its own portal so the caller only has to gate it with `showSearchOptions`.
 */
export const CompactSearchDropdown: React.FC<CompactSearchDropdownProps> = ({
  placement,
  inputBarHeight,
  maxHeight,
  scrollHeight,
  query,
  setQuery,
  selectedIndex,
  setSelectedIndex,
  offsets,
  onAskStuard,
  onWebSearch,
  activeEngineName,
  searchEngines,
  activeEngineId,
  onSelectEngine,
  stuardCommands,
  appResults,
  fileLoading,
  fileIconDataUrls,
  onLaunchApp,
  matchingBookmarks,
  onExecuteBookmark,
  fileResults,
  fileSemanticLoading,
  onAddFileAsContext,
  filteredLocalWorkflows,
  marketplaceResults,
  isMarketplaceSearching,
}) => {
  if (typeof document === 'undefined' || !document.body) return null;

  return (
    <CompactOverlayPortal
      placement={placement}
      inputBarHeight={inputBarHeight}
    >
      <div
        className="overflow-hidden flex flex-col"
        style={{
          maxHeight,
          background: 'rgb(var(--compact-pill-bg))',
          borderRadius: 12,
          boxShadow: 'var(--compact-pill-shadow)',
        }}
      >
        <div
          className="flex flex-col overflow-y-auto custom-scrollbar min-h-0 flex-1"
          style={{ padding: 16, gap: 12, maxHeight: scrollHeight }}
        >
          {/* QUICK ACTIONS */}
          <div className="flex flex-col" style={{ gap: 8 }}>
            <div
              style={{
                fontSize: 10,
                lineHeight: '14px',
                color: 'rgb(var(--compact-pill-fg))',
                fontWeight: 400,
              }}
            >
              Quick Actions
            </div>

            {/* Ask Stuard */}
            {(() => {
              const rowIdx = offsets.askStuard;
              const isSel = selectedIndex === rowIdx;
              return (
                <button
                  onMouseEnter={() => setSelectedIndex(rowIdx)}
                  onClick={onAskStuard}
                  className="w-full flex items-center"
                  style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), gap: 10 }}
                >
                  <div
                    className="flex-1 min-w-0 flex flex-col items-start text-left"
                    style={{ gap: 6 }}
                  >
                    <div
                      className="truncate w-full"
                      style={{
                        fontSize: 12,
                        lineHeight: '16px',
                        color: 'rgb(var(--compact-pill-fg))',
                      }}
                    >
                      &ldquo;{query.trim()}&rdquo;
                    </div>
                    <div
                      className="truncate w-full"
                      style={{
                        fontSize: 10,
                        lineHeight: '14px',
                        color: 'rgb(var(--compact-pill-fg-muted))',
                      }}
                    >
                      Ask Stuard
                    </div>
                  </div>
                  <span
                    className="shrink-0"
                    style={{ ...FIGMA_KBD, fontSize: 10, lineHeight: '14px' }}
                  >
                    Enter
                  </span>
                </button>
              );
            })()}

            {/* Search Engine */}
            {(() => {
              const rowIdx = offsets.webSearch;
              const isSel = selectedIndex === rowIdx;
              return (
                <button
                  onMouseEnter={() => setSelectedIndex(rowIdx)}
                  onClick={onWebSearch}
                  className="w-full flex items-center"
                  style={{ ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE), gap: 10 }}
                >
                  <div
                    className="flex-1 min-w-0 flex flex-col items-start text-left"
                    style={{ gap: 6 }}
                  >
                    <div
                      className="truncate w-full"
                      style={{
                        fontSize: 12,
                        lineHeight: '16px',
                        color: 'rgb(var(--compact-pill-fg))',
                      }}
                    >
                      &ldquo;{query.trim()}&rdquo;
                    </div>
                    <div
                      className="truncate w-full"
                      style={{
                        fontSize: 10,
                        lineHeight: '14px',
                        color: 'rgb(var(--compact-pill-fg-muted))',
                      }}
                    >
                      Search {activeEngineName}
                    </div>
                  </div>
                  <span
                    className="shrink-0"
                    style={{ ...FIGMA_KBD, fontSize: 10, lineHeight: '14px' }}
                  >
                    Ctrl + Enter
                  </span>
                </button>
              );
            })()}

            {/* Engine picker — small icon row so the user can swap which web
                engine "Search …" / Ctrl+Enter targets without leaving the
                dropdown. Selecting one persists via the parent's handler. */}
            {searchEngines.length > 0 && (
              <div
                className="flex items-center"
                style={{ gap: 6, paddingLeft: 8, paddingRight: 8 }}
              >
                {searchEngines.map((engine) => {
                  const isActive = engine.id === activeEngineId;
                  return (
                    <button
                      key={`engine-${engine.id}`}
                      type="button"
                      title={`Use ${engine.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEngine(engine.id);
                      }}
                      className="flex items-center justify-center transition-all hover:scale-105 compact-engine-chip"
                      style={{
                        width: 28,
                        height: 28,
                        padding: 4,
                        borderRadius: 8,
                        background: isActive
                          ? 'rgb(var(--compact-pill-fg) / 0.10)'
                          : 'transparent',
                        border: isActive
                          ? '1px solid rgb(var(--compact-pill-fg) / 0.20)'
                          : '1px solid transparent',
                        opacity: isActive ? 1 : 0.55,
                      }}
                    >
                      {engine.icon}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* STUARD — dashboard & studio navigation */}
          {stuardCommands.length > 0 && (
            <div className="flex flex-col" style={{ gap: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  lineHeight: '14px',
                  color: 'rgb(var(--compact-pill-fg))',
                  fontWeight: 400,
                }}
              >
                Stuard
              </div>

              {stuardCommands.map((c, idx) => {
                const Icon = c.icon;
                const rowIdx = offsets.stuardCommandsStart + idx;
                const isSel = selectedIndex === rowIdx;
                const prevGroup = idx > 0 ? stuardCommands[idx - 1]?.group : undefined;
                const showGroupLabel = c.group && c.group !== prevGroup;
                return (
                  <>
                    {showGroupLabel && (
                      <div
                        style={{
                          fontSize: 9,
                          lineHeight: '12px',
                          color: 'rgb(var(--compact-pill-fg-muted))',
                          paddingLeft: 8,
                          paddingTop: idx === 0 ? 0 : 2,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                        }}
                      >
                        {c.group === 'dashboard' ? 'Dashboard' : 'Studio'}
                      </div>
                    )}
                    <button
                      key={`cmd-${c.id}`}
                      onMouseEnter={() => setSelectedIndex(rowIdx)}
                      onClick={() => {
                        c.run();
                        setQuery('');
                      }}
                      className="w-full flex items-center text-left"
                      style={{
                        ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE),
                        padding: '6px 8px 6px 6px',
                        gap: 6,
                      }}
                    >
                      <div
                        className="flex items-center justify-center shrink-0"
                        style={{ width: 36, height: 36, borderRadius: 4, background: c.tile }}
                      >
                        <Icon className="w-4 h-4" strokeWidth={1.75} />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                        <div
                          className="truncate"
                          style={{
                            fontSize: 12,
                            lineHeight: '16px',
                            color: 'rgb(var(--compact-pill-fg))',
                          }}
                        >
                          <HighlightMatch text={c.title} query={query} />
                        </div>
                        <div
                          className="truncate"
                          style={{
                            fontSize: 10,
                            lineHeight: '14px',
                            color: 'rgb(var(--compact-pill-fg-muted))',
                          }}
                        >
                          {c.subtitle}
                        </div>
                      </div>
                    </button>
                  </>
                );
              })}
            </div>
          )}

          {/* APPLICATIONS */}
          {appResults.length > 0 && (
            <div className="flex flex-col" style={{ gap: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  lineHeight: '14px',
                  color: 'rgb(var(--compact-pill-fg))',
                  fontWeight: 400,
                }}
              >
                Applications
                {fileLoading && (
                  <Loader2 className="inline-block ml-2 w-3 h-3 align-middle text-theme-muted animate-spin" />
                )}
              </div>

              {appResults.map((a: any, idx: number) => {
                const iconUrl =
                  a?.iconDataUrl ||
                  (a?.path ? fileIconDataUrls[String(a.path)] : undefined);
                const name = String(a.name || '');
                const rowIdx = offsets.appsStart + idx;
                const isSel = selectedIndex === rowIdx;
                return (
                  <button
                    key={`app-${a.path || idx}`}
                    onMouseEnter={() => setSelectedIndex(rowIdx)}
                    onClick={() => {
                      onLaunchApp(a.launchTarget || a.path);
                      setQuery('');
                    }}
                    className="w-full flex items-center text-left"
                    style={{
                      ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE),
                      padding: '6px 8px 6px 6px',
                      gap: 6,
                    }}
                  >
                    <div
                      className="flex items-center justify-center shrink-0 overflow-hidden"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 4,
                        background: iconUrl ? 'rgba(64, 64, 64, 0.5)' : '#3B82F6',
                      }}
                    >
                      {iconUrl ? (
                        <img src={iconUrl} alt="" className="w-7 h-7 object-contain" />
                      ) : (
                        <AppWindow className="w-4 h-4 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                      <div
                        className="truncate"
                        style={{
                          fontSize: 12,
                          lineHeight: '16px',
                          color: 'rgb(var(--compact-pill-fg))',
                        }}
                      >
                        <HighlightMatch text={name} query={query} />
                      </div>
                      <div
                        className="truncate"
                        style={{
                          fontSize: 10,
                          lineHeight: '14px',
                          color: 'rgb(var(--compact-pill-fg-muted))',
                        }}
                      >
                        open {name}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* SHORTCUTS — user bookmarks */}
          {matchingBookmarks.length > 0 && (
            <div className="flex flex-col" style={{ gap: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  lineHeight: '14px',
                  color: 'rgb(var(--compact-pill-fg))',
                  fontWeight: 400,
                }}
              >
                Shortcuts
              </div>

              {matchingBookmarks.map((bm, idx) => {
                const cfg = getTypeConfig(bm.type);
                const Icon = cfg.icon;
                const rowIdx = offsets.bookmarksStart + idx;
                const isSel = selectedIndex === rowIdx;
                return (
                  <button
                    key={`bm-${bm.id}`}
                    onMouseEnter={() => setSelectedIndex(rowIdx)}
                    onClick={() => onExecuteBookmark(bm)}
                    className="w-full flex items-center text-left"
                    style={{
                      ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE),
                      padding: '6px 8px 6px 6px',
                      gap: 6,
                    }}
                  >
                    <div
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 4,
                        background: 'rgba(64, 64, 64, 0.5)',
                      }}
                    >
                      <Icon className={clsx('w-4 h-4', cfg.color)} />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                      <div
                        className="truncate"
                        style={{
                          fontSize: 12,
                          lineHeight: '16px',
                          color: 'rgb(var(--compact-pill-fg))',
                        }}
                      >
                        <HighlightMatch text={bm.name} query={query} />
                      </div>
                      <div
                        className="truncate"
                        style={{
                          fontSize: 10,
                          lineHeight: '14px',
                          color: 'rgb(var(--compact-pill-fg-muted))',
                        }}
                      >
                        open {bm.name}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* FILES */}
          {Array.isArray(fileResults) && fileResults.length > 0 && (
            <div className="flex flex-col" style={{ gap: 8 }}>
              <div
                style={{
                  fontSize: 10,
                  lineHeight: '14px',
                  color: 'rgb(var(--compact-pill-fg))',
                  fontWeight: 400,
                }}
              >
                Files
                {fileSemanticLoading && (
                  <Loader2 className="inline-block ml-2 w-3 h-3 align-middle text-theme-muted animate-spin" />
                )}
              </div>

              {fileResults.slice(0, 6).map((f: any, idx: number) => {
                if (!f) return null;
                const kind = String(f.kind || 'other').toLowerCase();
                const cfg = getFileKindConfig(kind);
                const iconUrl = f?.path ? fileIconDataUrls[String(f.path)] : undefined;
                const isThumbnail = String(f.preview_kind || 'icon') === 'thumbnail';
                const fileName =
                  String(f.display_name || f.filename || f.name || '').trim() ||
                  String(f.path || '')
                    .split(/[/\\]/)
                    .pop() ||
                  'Untitled';
                const fullPath = String(f.path || f.target_path || '');
                const showThumbnail = iconUrl && isThumbnail;
                const rowIdx = offsets.filesStart + idx;
                const isSel = selectedIndex === rowIdx;
                return (
                  <button
                    key={String(f.id || f.path || idx)}
                    onMouseEnter={() => setSelectedIndex(rowIdx)}
                    onClick={() => {
                      if (kind === 'application') {
                        (window as any).desktopAPI?.openPath?.(String(f.path));
                        (window as any).desktopAPI?.hide?.();
                        setQuery('');
                      } else {
                        onAddFileAsContext(f);
                      }
                    }}
                    className="w-full flex items-center text-left"
                    style={{
                      ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE),
                      padding: '6px 8px 6px 6px',
                      gap: 6,
                    }}
                  >
                    <div
                      className="flex items-center justify-center shrink-0 overflow-hidden"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 4,
                        background: showThumbnail ? 'rgba(64, 64, 64, 0.5)' : cfg.tile,
                      }}
                    >
                      {showThumbnail ? (
                        <img src={iconUrl} alt="" className="w-full h-full object-cover" />
                      ) : iconUrl ? (
                        <img src={iconUrl} alt="" className="w-7 h-7 object-contain" />
                      ) : kind === 'folder' ? (
                        <Folder className="w-5 h-5 text-white" />
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            lineHeight: '14px',
                            color: 'rgb(var(--compact-pill-fg))',
                            fontWeight: 600,
                          }}
                        >
                          {cfg.label}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                      <div
                        className="truncate"
                        style={{
                          fontSize: 12,
                          lineHeight: '16px',
                          color: 'rgb(var(--compact-pill-fg))',
                        }}
                      >
                        <HighlightMatch text={fileName} query={query} />
                      </div>
                      <div
                        className="truncate"
                        style={{
                          fontSize: 8,
                          lineHeight: '14px',
                          color: 'rgb(var(--compact-pill-fg-muted))',
                        }}
                      >
                        {fullPath}
                      </div>
                    </div>
                    <span
                      className="shrink-0 flex items-center justify-center"
                      style={{ padding: '3px 6px', color: 'rgb(var(--compact-pill-fg-muted))' }}
                      title={kind === 'application' ? 'Open' : 'Attach'}
                    >
                      {kind === 'application' ? (
                        <ExternalLink className="w-4 h-4" strokeWidth={1.75} />
                      ) : (
                        <Paperclip className="w-4 h-4" strokeWidth={1.75} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* WORKFLOWS — header always present (shows "No workflows" when empty) */}
          <div className="flex flex-col" style={{ gap: 8 }}>
            <div
              style={{
                fontSize: 10,
                lineHeight: '14px',
                color: 'rgb(var(--compact-pill-fg))',
                fontWeight: 400,
              }}
            >
              {filteredLocalWorkflows.length === 0 && marketplaceResults.length === 0
                ? 'No workflows'
                : 'Workflows'}
              {isMarketplaceSearching && (
                <Loader2 className="inline-block ml-2 w-3 h-3 align-middle text-theme-muted animate-spin" />
              )}
            </div>

            {filteredLocalWorkflows.map((w, idx) => {
              const rowIdx = offsets.workflowsStart + idx;
              const isSel = selectedIndex === rowIdx;
              const deployed = Boolean(w.deployed);
              const running = Boolean(w.running);
              const tile = deployed ? '#10B981' : '#F59E0B';
              const ActionIcon = deployed ? Play : Pencil;
              const subtitle = deployed
                ? (running ? 'Run deployed workflow · live' : 'Run deployed workflow')
                : 'Open in Stuard Studio';
              return (
                <button
                  key={w.id}
                  onMouseEnter={() => setSelectedIndex(rowIdx)}
                  onClick={async () => {
                    if (deployed) {
                      try {
                        await window.desktopAPI?.workflowsRun?.(w.id);
                        window.desktopAPI?.hide?.();
                        (window as any).desktopAPI?.notify?.(
                          'Workflow Started',
                          `Running ${w.name || 'workflow'}...`,
                        );
                      } catch (e) {
                        console.error(e);
                      }
                    } else {
                      window.desktopAPI?.openWorkflows?.({ workflowId: w.id });
                      window.desktopAPI?.hide?.();
                    }
                    setQuery('');
                  }}
                  className="w-full flex items-center text-left"
                  style={{
                    ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE),
                    padding: '6px 8px 6px 6px',
                    gap: 6,
                  }}
                >
                  <div
                    className="flex items-center justify-center shrink-0"
                    style={{ width: 36, height: 36, borderRadius: 4, background: tile }}
                  >
                    {deployed ? (
                      <Rocket className="w-4 h-4 text-white" strokeWidth={1.75} />
                    ) : (
                      <Zap className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 12,
                        lineHeight: '16px',
                        color: 'rgb(var(--compact-pill-fg))',
                      }}
                    >
                      <HighlightMatch text={w.name || 'Untitled'} query={query} />
                    </div>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 10,
                        lineHeight: '14px',
                        color: 'rgb(var(--compact-pill-fg-muted))',
                      }}
                    >
                      {subtitle}
                    </div>
                  </div>
                  <span
                    className="shrink-0 flex items-center justify-center"
                    style={{ padding: '3px 6px', color: 'rgb(var(--compact-pill-fg-muted))' }}
                    title={deployed ? 'Run' : 'Open in Studio'}
                  >
                    <ActionIcon className="w-4 h-4" strokeWidth={1.75} />
                  </span>
                </button>
              );
            })}

            {marketplaceResults.map((w, idx) => {
              const rowIdx = offsets.marketplaceStart + idx;
              const isSel = selectedIndex === rowIdx;
              return (
                <button
                  key={w.slug}
                  onMouseEnter={() => setSelectedIndex(rowIdx)}
                  onClick={() => {
                    window.desktopAPI?.openWorkflows?.({ marketplaceSlug: w.slug });
                    window.desktopAPI?.hide?.();
                  }}
                  className="w-full flex items-center text-left"
                  style={{
                    ...(isSel ? FIGMA_ROW_PRIMARY : FIGMA_ROW_BASE),
                    padding: '6px 8px 6px 6px',
                    gap: 6,
                  }}
                >
                  <div
                    className="flex items-center justify-center shrink-0"
                    style={{ width: 36, height: 36, borderRadius: 4, background: '#6366F1' }}
                  >
                    <CloudDownload className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 6 }}>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 12,
                        lineHeight: '16px',
                        color: 'rgb(var(--compact-pill-fg))',
                      }}
                    >
                      <HighlightMatch text={w.name} query={query} />
                    </div>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 10,
                        lineHeight: '14px',
                        color: 'rgb(var(--compact-pill-fg-muted))',
                      }}
                    >
                      Marketplace • {w.publisher_name || 'Community'}
                    </div>
                  </div>
                  <span
                    className="shrink-0 flex items-center justify-center"
                    style={{ padding: '3px 6px', color: 'rgb(var(--compact-pill-fg-muted))' }}
                    title="Install"
                  >
                    <Download className="w-4 h-4" strokeWidth={1.75} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </CompactOverlayPortal>
  );
};

export default CompactSearchDropdown;
