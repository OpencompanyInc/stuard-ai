import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { 
  FileTextIcon, 
  HomeIcon, 
  ArrowLeftIcon, 
  Cross2Icon, 
  ChevronRightIcon, 
  PlusCircledIcon,
  MagnifyingGlassIcon
} from "@radix-ui/react-icons";
import {
  Folder,
  File,
  Loader2,
  Search,
  Box,
  Sparkles
} from "lucide-react";
import { clsx } from "clsx";

export interface ContextItem {
  path: string;
  name: string;
  isDirectory: boolean;
  type?: 'file' | 'directory' | 'bot';
  metadata?: any;
}

export interface FileNavProps {
  onSelect: (item: ContextItem) => void;
  onClose: () => void;
  onNavigate?: (path: string) => void;
  filter?: string; // Text after @
  /** Solid compact-pill theme — required on transparent overlay windows. */
  compact?: boolean;
}

export interface FileNavRef {
  moveSelection: (direction: number) => void;
  selectCurrent: () => void;
  /** Add the currently-highlighted item as context, even when it's a directory.
   *  Unlike selectCurrent, this never drills into folders.
   *  Returns true if a real entry was added; false when the listing has no
   *  match for what's typed (caller should leave the textarea text alone). */
  addCurrent: () => boolean;
}

export const FileNavigator = forwardRef<FileNavRef, FileNavProps>(({ onSelect, onClose, onNavigate, filter = "", compact = false }, ref) => {
  const [bots, setBots] = useState<any[]>([]);
  const [currentEntries, setCurrentEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Determine effective path and query from filter.
  // e.g. "src/" -> path="src/", query=""
  // e.g. "src/co" -> path="src/", query="co"
  const { pathContext, queryText, isRoot } = useMemo(() => {
    const lastSlashIndex = filter.lastIndexOf('/');
    if (lastSlashIndex === -1) {
      return { pathContext: "", queryText: filter, isRoot: true };
    }
    return {
      pathContext: filter.substring(0, lastSlashIndex + 1),
      queryText: filter.substring(lastSlashIndex + 1),
      isRoot: false
    };
  }, [filter]);

  // Load proactive bots so @mentions can address bots from normal chat.
  useEffect(() => {
    const loadBots = async () => {
      try {
        const res = await (window as any).desktopAPI?.botsList?.();
        if (res?.ok && Array.isArray(res?.bots)) {
          setBots(res.bots);
        }
      } catch (e) {
        console.error("Failed to load bots", e);
      }
    };
    loadBots();
  }, []);

  // Load content based on pathContext
  useEffect(() => {
    const loadContent = async () => {
      setLoading(true);
      setError("");
      setCurrentEntries([]);
      setSelectedIndex(0);

      try {
        const fsPath = isRoot
          ? "~"
          : (pathContext.startsWith('/') || pathContext.startsWith('~') || pathContext.match(/^[a-zA-Z]:/)
              ? pathContext
              : "~/" + pathContext);

        if ((window as any).desktopAPI?.listDirectory) {
          const res = await (window as any).desktopAPI.listDirectory(fsPath);
          if (res.ok && res.entries) {
            setCurrentEntries(res.entries);
          } else {
            setError(res.error || "Failed to list directory");
          }
        }
      } catch (e: any) {
        setError(e.message || "Error loading context");
      } finally {
        setLoading(false);
      }
    };

    // Debounce slightly to avoid hammering on rapid typing
    const timer = setTimeout(loadContent, 10);
    return () => clearTimeout(timer);
  }, [pathContext, isRoot]);

  // Filter entries based on queryText
  const filteredItems = useMemo(() => {
    let items = [...currentEntries];

    // At root, also include bots so @mentions can address them.
    if (isRoot) {
      const botItems = bots.map(b => ({
        name: b.name,
        path: `bot://${b.id}`,
        isDirectory: false,
        type: 'bot',
        metadata: {
          id: b.id,
          status: b.status,
          lastRunAt: b.lastRunAt,
          nextRunAt: b.nextRunAt,
          vmDeployedAt: b.vmDeployedAt,
          emoji: b.emoji,
        }
      }));
      items = [...botItems, ...items];
    }

    if (!queryText) return items;

    const q = queryText.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q));
  }, [currentEntries, bots, isRoot, queryText]);

  // Sorting
  const sortedItems = useMemo(() => {
    return filteredItems.sort((a, b) => {
      // Bots first (at root)
      if (a.type === 'bot' && b.type !== 'bot') return -1;
      if (a.type !== 'bot' && b.type === 'bot') return 1;

      // Directories first
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

      return a.name.localeCompare(b.name);
    });
  }, [filteredItems]);

  // Handle Action logic extracted for reuse
  const executeAction = (item: any, mode: 'navigate' | 'select') => {
    if (mode === 'navigate' && item.isDirectory) {
      const newPath = pathContext + item.name + '/';
      onNavigate?.(newPath);
    } else {
      onSelect(item);
    }
  };

  // Expose methods for keyboard navigation
  useImperativeHandle(ref, () => ({
    moveSelection: (direction: number) => {
      setSelectedIndex(prev => {
        const next = prev + direction;
        if (next < 0) return 0;
        if (next >= sortedItems.length) return sortedItems.length - 1;
        
        // Scroll into view
        const el = document.getElementById(`filenav-item-${next}`);
        el?.scrollIntoView({ block: 'nearest' });
        
        return next;
      });
    },
    selectCurrent: () => {
      if (sortedItems[selectedIndex]) {
        // Default to navigate for directories, select for files
        const item = sortedItems[selectedIndex];
        executeAction(item, item.isDirectory ? 'navigate' : 'select');
      }
    },
    addCurrent: () => {
      // Add the highlighted entry only if it resolves to something real in
      // the current listing. If nothing matches, return false so the caller
      // can leave the typed "@<filter>" alone in the textarea.
      const item = sortedItems[selectedIndex];
      if (item) {
        onSelect(item);
        return true;
      }
      return false;
    }
  }));

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [sortedItems.length, pathContext]);

  const handleEntryClick = (entry: any, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (entry.isDirectory) {
      executeAction(entry, 'navigate');
    } else {
      executeAction(entry, 'select');
    }
  };

  const handleAddContext = (entry: any, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(entry);
  };

  const handleGoUp = () => {
    if (!pathContext) return;
    const parts = pathContext.split('/').filter(Boolean);
    parts.pop();
    const newPath = parts.length > 0 ? parts.join('/') + '/' : '';
    onNavigate?.(newPath);
  };

  // Build breadcrumb segments from pathContext for the header.
  const crumbs = useMemo(() => {
    const parts = pathContext.split('/').filter(Boolean);
    return parts.map((part, i) => ({
      name: part,
      path: parts.slice(0, i + 1).join('/') + '/',
    }));
  }, [pathContext]);

  return (
    <div
      className={clsx(
        'flex flex-col w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150',
        compact
          ? 'text-pill-fg rounded-xl'
          : 'max-h-[340px] bg-theme-card/95 text-theme-fg rounded-2xl border border-theme/40 shadow-2xl backdrop-blur-xl',
      )}
      style={compact ? {
        background: 'rgb(var(--compact-pill-bg))',
        boxShadow: 'var(--compact-pill-shadow)',
      } : undefined}
    >
      {/* Search bar — mirrors what the user is typing into the @ picker
          since the textarea below intentionally hides that. */}
      <div className={clsx(
        'flex items-center gap-2 px-3 py-2.5 border-b select-none',
        compact ? 'bg-pill-fg/[0.06] border-pill-fg/10' : 'bg-theme-active/30 border-theme/10',
      )}>
        {pathContext ? (
          <button
            onClick={handleGoUp}
            className={clsx(
              'p-1 rounded-md transition-colors group shrink-0',
              compact
                ? 'text-pill-muted hover:bg-pill-fg/10 hover:text-pill-fg'
                : 'hover:bg-theme-hover text-theme-muted hover:text-theme-fg',
            )}
            title="Go up one level"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          </button>
        ) : (
          <Search className={clsx('w-3.5 h-3.5 shrink-0', compact ? 'text-pill-muted' : 'text-theme-muted')} strokeWidth={2.5} />
        )}
        <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
          {crumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              <button
                onClick={() => onNavigate?.(crumb.path)}
                className={clsx(
                  'px-1.5 py-0.5 rounded-md text-[11px] font-bold truncate max-w-[100px] transition-colors shrink-0',
                  compact
                    ? 'text-pill-muted hover:bg-pill-fg/10 hover:text-pill-fg'
                    : 'text-theme-muted hover:bg-theme-hover hover:text-theme-fg',
                )}
              >
                {crumb.name}
              </button>
              <ChevronRightIcon className={clsx('w-3 h-3 shrink-0', compact ? 'text-pill-muted/50' : 'text-theme-muted/50')} />
            </React.Fragment>
          ))}
          <span className={clsx(
            'text-[14px] font-semibold truncate min-w-0',
            queryText
              ? (compact ? 'text-pill-fg' : 'text-theme-fg')
              : (compact ? 'text-pill-muted/60' : 'text-theme-muted/60'),
          )}>
            {queryText || (crumbs.length === 0 ? "Search files, folders, bots…" : "Filter…")}
          </span>
          {queryText && (
            <span className="inline-block w-[2px] h-4 bg-primary/70 rounded-full animate-pulse shrink-0" />
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-1.5 custom-scrollbar relative min-h-[100px]">
        {loading && (
          <div className={clsx(
            'absolute inset-0 flex items-center justify-center z-10',
            compact ? 'bg-pill-bg' : 'bg-theme-card/80 backdrop-blur-sm',
          )}>
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <span className={clsx('text-[10px]', compact ? 'text-pill-muted' : 'text-theme-muted')}>Loading contents...</span>
            </div>
          </div>
        )}
        
        {!loading && error && (
          <div className={clsx(
            'flex flex-col items-center justify-center py-8 text-[12px] italic',
            compact ? 'text-pill-muted' : 'text-theme-muted',
          )}>
            <Box className="w-8 h-8 mb-2 opacity-40" />
            <span>{error}</span>
          </div>
        )}
        
        {!loading && !error && sortedItems.length === 0 && (
          <div className={clsx(
            'flex flex-col items-center justify-center py-10 text-[12px]',
            compact ? 'text-pill-muted' : 'text-theme-muted',
          )}>
            <Folder className="w-8 h-8 mb-2 opacity-20" />
            <span>No items found</span>
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          {sortedItems.map((item, i) => {
            const isSelected = i === selectedIndex;
            return (
              <div
                key={`${item.path}-${i}`}
                id={`filenav-item-${i}`}
                className={clsx(
                  'group flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-all cursor-pointer border border-transparent',
                  isSelected
                    ? (compact ? 'bg-[var(--compact-pill-hover)] border-pill-fg/10' : 'bg-theme-active border-theme shadow-sm')
                    : (compact ? 'hover:bg-pill-fg/10 hover:border-pill-fg/10' : 'hover:bg-theme-hover hover:border-theme/50'),
                )}
                onClick={(e) => handleEntryClick(item, e)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {/* Icon */}
                <div className={clsx(
                  'w-6 h-6 flex items-center justify-center shrink-0 rounded-md transition-colors',
                  item.type === 'bot'
                    ? (isSelected ? 'bg-amber-500 text-white shadow-amber-500/20 shadow-lg' : 'bg-amber-500/10 text-amber-500')
                    : item.isDirectory
                      ? (isSelected
                        ? (compact ? 'bg-pill-fg text-pill-bg' : 'bg-theme-fg text-theme-bg')
                        : (compact ? 'bg-pill-fg/10 text-pill-muted' : 'bg-theme-hover text-theme-muted'))
                      : (isSelected
                        ? (compact ? 'bg-pill-fg/15 text-pill-fg' : 'bg-theme-active text-theme-fg')
                        : (compact ? 'bg-pill-fg/10 text-pill-muted' : 'bg-theme-hover text-theme-muted')),
                )}>
                  {item.type === 'bot'
                    ? <Sparkles className="w-3.5 h-3.5" />
                    : item.isDirectory
                      ? <Folder className="w-3.5 h-3.5" />
                      : <File className="w-3.5 h-3.5" />}
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <span className={clsx(
                    'text-[13px] truncate transition-colors',
                    isSelected
                      ? (compact ? 'text-pill-fg font-semibold' : 'text-theme-fg font-semibold')
                      : item.isDirectory
                        ? (compact ? 'text-pill-fg font-medium' : 'text-theme-fg font-medium')
                        : (compact ? 'text-pill-muted' : 'text-theme-muted'),
                  )}>
                    {item.name}
                  </span>
                  {item.type === 'bot' && (
                    <span className={clsx(
                      'text-[10px] truncate transition-colors',
                      isSelected ? 'text-amber-200' : (compact ? 'text-pill-muted' : 'text-theme-muted'),
                    )}>
                      Bot - {item.metadata?.status || "paused"}{item.metadata?.vmDeployedAt ? " - VM" : ""}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className={clsx('flex items-center gap-1 transition-opacity', isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
                  {/* Add button */}
                  <button
                    onClick={(e) => handleAddContext(item, e)}
                    className={clsx(
                      'p-1.5 rounded-md transition-colors',
                      isSelected
                        ? (compact ? 'bg-pill-fg/15 text-pill-fg hover:bg-pill-fg/20' : 'bg-theme-bg/20 text-theme-fg hover:bg-theme-bg/30')
                        : (compact ? 'hover:bg-pill-fg/10 text-pill-muted hover:text-pill-fg' : 'hover:bg-theme-hover text-theme-muted hover:text-theme-fg'),
                    )}
                    title={item.isDirectory ? "Add folder as context" : item.type === 'bot' ? "Mention bot" : "Add to context"}
                  >
                    <PlusCircledIcon className="w-4 h-4" />
                  </button>

                  {/* Navigate Hint */}
                  {item.isDirectory && (
                    <div className={clsx(
                      'px-1.5 py-0.5 rounded text-[10px] font-mono',
                      isSelected
                        ? (compact ? 'text-pill-muted' : 'text-theme-muted')
                        : (compact ? 'text-pill-muted/70' : 'text-theme-muted/70'),
                    )}>
                      ↵
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Footer Hint */}
      <div className={clsx(
        'px-3 py-2 border-t text-[10px] flex items-center justify-between font-semibold',
        compact ? 'bg-pill-fg/[0.04] border-pill-fg/10 text-pill-muted' : 'bg-theme-bg/40 border-theme/10 text-theme-muted',
      )}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1">
            <kbd className={clsx(
              'px-1.5 py-0.5 rounded font-mono text-[9px] border',
              compact ? 'bg-pill-fg/10 text-pill-fg border-pill-fg/15' : 'bg-theme-hover text-theme-fg border-theme/20',
            )}>↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className={clsx(
              'px-1.5 py-0.5 rounded font-mono text-[9px] border',
              compact ? 'bg-pill-fg/10 text-pill-fg border-pill-fg/15' : 'bg-theme-hover text-theme-fg border-theme/20',
            )}>↵</kbd>
            open / pick file
          </span>
          <span className="flex items-center gap-1">
            <kbd className={clsx(
              'px-1.5 py-0.5 rounded font-mono text-[9px] border',
              compact ? 'bg-pill-fg/10 text-pill-fg border-pill-fg/15' : 'bg-theme-hover text-theme-fg border-theme/20',
            )}>space</kbd>
            add as context
          </span>
          <span className="flex items-center gap-1">
            <kbd className={clsx(
              'px-1.5 py-0.5 rounded font-mono text-[9px] border',
              compact ? 'bg-pill-fg/10 text-pill-fg border-pill-fg/15' : 'bg-theme-hover text-theme-fg border-theme/20',
            )}>esc</kbd>
            close
          </span>
        </div>
        <span className={clsx('shrink-0 ml-2', compact ? 'text-pill-muted/60' : 'text-theme-muted/60')}>
          {sortedItems.length} item{sortedItems.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
});

FileNavigator.displayName = 'FileNavigator';
