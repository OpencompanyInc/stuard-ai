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
  Layout, 
  Database, 
  Folder, 
  File, 
  Loader2, 
  Search,
  Box,
  FileText,
  Link2,
  Image as ImageIcon,
  CornerDownLeft,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import { clsx } from "clsx";

export interface ContextItem {
  path: string;
  name: string;
  isDirectory: boolean;
  type?: 'file' | 'directory' | 'space' | 'space-item';
  metadata?: any;
}

export interface FileNavProps {
  onSelect: (item: ContextItem) => void;
  onClose: () => void;
  onNavigate?: (path: string) => void;
  filter?: string; // Text after @
}

export interface FileNavRef {
  moveSelection: (direction: number) => void;
  selectCurrent: () => void;
}

interface Space {
  id: string;
  name: string;
  type: string;
  icon?: string;
  color?: string;
}

interface SpaceItem {
  id: string;
  title: string;
  type: string;
  content?: string;
}

export const FileNavigator = forwardRef<FileNavRef, FileNavProps>(({ onSelect, onClose, onNavigate, filter = "" }, ref) => {
  // We use filter to determine the current "path" or context
  // If filter contains '/', we are exploring a directory or space.
  
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spacesLoaded, setSpacesLoaded] = useState(false);
  const [currentEntries, setCurrentEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Determine effective path and query from filter
  // e.g. "src/" -> path="src/", query=""
  // e.g. "src/co" -> path="src/", query="co"
  // e.g. "SpaceName/" -> path="SpaceName/", query=""
  const { pathContext, queryText, isRoot } = useMemo(() => {
    const lastSlashIndex = filter.lastIndexOf('/');
    if (lastSlashIndex === -1) {
      return { pathContext: "", queryText: filter, isRoot: true };
    }
    return {
      pathContext: filter.substring(0, lastSlashIndex + 1), // includes trailing slash
      queryText: filter.substring(lastSlashIndex + 1),
      isRoot: false
    };
  }, [filter]);

  // Load Spaces on mount
  useEffect(() => {
    const loadSpaces = async () => {
      try {
        const res = await (window as any).desktopAPI?.execTool?.('space_list', { limit: 50 });
        if (res?.ok && Array.isArray(res?.spaces)) {
          setSpaces(res.spaces);
        }
      } catch (e) {
        console.error("Failed to load spaces", e);
      } finally {
        setSpacesLoaded(true);
      }
    };
    loadSpaces();
  }, []);

  // Load content based on pathContext
  useEffect(() => {
    // Wait for spaces to be loaded before trying to match space names
    if (!spacesLoaded && !isRoot) return;
    
    const loadContent = async () => {
      setLoading(true);
      setError("");
      setCurrentEntries([]);
      setSelectedIndex(0);

      try {
        if (isRoot) {
          // At root: List Spaces + Home Directory
          // We already have spaces in state (or they are loading)
          // We need to list home dir
          if ((window as any).desktopAPI?.listDirectory) {
            const res = await (window as any).desktopAPI.listDirectory("~");
            if (res.ok && res.entries) {
              setCurrentEntries(res.entries);
            } else {
              setError(res.error || "Failed to list directory");
            }
          }
        } else {
          // Inside a context
          // Check if pathContext starts with a Space Name
          const pathParts = pathContext.split('/').filter(Boolean);
          const firstPart = pathParts[0];
          
          // Try to match by name (case-insensitive)
          const matchedSpace = spaces.find(s => 
            s.name.toLowerCase() === firstPart.toLowerCase()
          );
          
          if (matchedSpace) {
            // We are in a Space - load its items
            // console.log('[FileNavigator] Loading space items for:', matchedSpace.name, matchedSpace.id);
            const res = await (window as any).desktopAPI?.execTool?.('space_item_list', { space_id: matchedSpace.id, limit: 100 });
            // console.log('[FileNavigator] Space items result:', res);
            
            if (res?.ok && Array.isArray(res?.items)) {
              // Map space items to entries
              const items = res.items.map((item: any) => ({
                name: item.title || item.content?.substring(0, 30) || "Untitled",
                path: `space-item://${matchedSpace.id}/${item.id}`,
                isDirectory: false, // Items are leaves for now
                type: 'space-item',
                metadata: item
              }));
              setCurrentEntries(items);
              
              if (items.length === 0) {
                setError("This space is empty");
              }
            } else {
              setError(res?.error || "Failed to load space items");
            }
          } else {
            // Assume file system path
            // pathContext is something like "src/" or "~/" or "/etc/"
            // If it doesn't start with / or ~, prepend ~?
            let fsPath = pathContext;
            if (!fsPath.startsWith('/') && !fsPath.startsWith('~') && !fsPath.match(/^[a-zA-Z]:/)) {
              fsPath = "~/" + fsPath;
            }
            
            if ((window as any).desktopAPI?.listDirectory) {
              const res = await (window as any).desktopAPI.listDirectory(fsPath);
              if (res.ok && res.entries) {
                setCurrentEntries(res.entries);
              } else {
                setError(res.error || "Failed to list directory");
              }
            }
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
  }, [pathContext, isRoot, spaces, spacesLoaded]); // Re-run when context changes or spaces load

  // Filter entries based on queryText
  const filteredItems = useMemo(() => {
    let items = [...currentEntries];
    
    // If at root, also include spaces in the list
    if (isRoot) {
      const spaceItems = spaces.map(s => ({
        name: s.name,
        path: `space://${s.id}`,
        isDirectory: true, // Treat spaces as folders
        type: 'space',
        metadata: s
      }));
      items = [...spaceItems, ...items];
    }

    if (!queryText) return items;

    const q = queryText.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q));
  }, [currentEntries, spaces, isRoot, queryText]);

  // Sorting
  const sortedItems = useMemo(() => {
    return filteredItems.sort((a, b) => {
      // Spaces first (if root)
      if (a.type === 'space' && b.type !== 'space') return -1;
      if (a.type !== 'space' && b.type === 'space') return 1;
      
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

  return (
    <div 
      className="flex flex-col w-full max-h-[320px] bg-gray-100/95 text-theme-fg rounded-xl border border-gray-300/50 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header / Path */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-200/40 border-b border-gray-200 text-[12px] font-medium select-none">
        <div className="flex items-center gap-1.5 flex-1 truncate">
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center">
            <Search className="w-3 h-3 text-primary" />
          </div>
          <div className="flex flex-col leading-none gap-0.5">
             <div className="flex items-center gap-1">
                <span className="text-theme-muted font-medium">Context</span>
                <span className="text-theme-muted/50">/</span>
                <span className="text-primary font-bold">{pathContext || "~"}</span>
             </div>
             {queryText && <span className="text-theme-muted text-[10px]">Filter: "{queryText}"</span>}
          </div>
        </div>
        {pathContext && (
          <button 
            onClick={handleGoUp}
            className="p-1.5 hover:bg-theme-hover rounded-md text-theme-muted hover:text-theme-fg transition-colors group"
            title="Go up one level"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-1.5 custom-scrollbar relative min-h-[100px]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-theme-card/80 z-10 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <span className="text-[10px] text-theme-muted">Loading contents...</span>
            </div>
          </div>
        )}
        
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-8 text-theme-muted text-[12px] italic">
            <Box className="w-8 h-8 mb-2 opacity-40" />
            <span>{error}</span>
          </div>
        )}
        
        {!loading && !error && sortedItems.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-theme-muted text-[12px]">
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
                  "group flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-all cursor-pointer border border-transparent",
                  isSelected ? "bg-theme-active border-theme shadow-sm" : "hover:bg-theme-hover hover:border-theme/50"
                )}
                onClick={(e) => handleEntryClick(item, e)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {/* Icon */}
                <div className={clsx(
                  "w-6 h-6 flex items-center justify-center shrink-0 rounded-md transition-colors",
                  item.type === 'space' ? (isSelected ? "bg-blue-500 text-white shadow-blue-500/20 shadow-lg" : "bg-blue-500/10 text-blue-400") :
                  item.isDirectory ? (isSelected ? "bg-theme-fg text-theme-bg" : "bg-theme-hover text-theme-muted") :
                  item.type === 'space-item' ? (isSelected ? "bg-blue-500 text-white shadow-blue-500/20 shadow-lg" : "bg-blue-500/10 text-blue-400") :
                  (isSelected ? "bg-primary text-primary-fg shadow-primary/20 shadow-lg" : "bg-primary/10 text-primary")
                )}>
                  {item.type === 'space' ? <Layout className="w-3.5 h-3.5" /> :
                   item.isDirectory ? <Folder className="w-3.5 h-3.5" /> :
                   item.type === 'space-item' ? <FileText className="w-3.5 h-3.5" /> :
                   <File className="w-3.5 h-3.5" />}
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <span className={clsx(
                    "text-[13px] truncate transition-colors",
                    isSelected ? "text-theme-fg font-semibold" : 
                    item.isDirectory ? "text-theme-fg font-medium" : "text-theme-muted"
                  )}>
                    {item.name}
                  </span>
                  {item.type === 'space' && (
                    <span className={clsx("text-[10px] truncate transition-colors", isSelected ? "text-blue-300" : "text-theme-muted")}>
                      Space • {item.metadata?.type}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className={clsx("flex items-center gap-1 transition-opacity", isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                  {/* Add button */}
                  <button
                    onClick={(e) => handleAddContext(item, e)}
                    className={clsx(
                      "p-1.5 rounded-md transition-colors",
                      isSelected ? "bg-theme-bg/20 text-theme-fg hover:bg-theme-bg/30" : "hover:bg-theme-hover text-theme-muted hover:text-theme-fg"
                    )}
                    title={item.isDirectory ? "Add folder as context" : item.type === 'space' ? "Add space as context" : "Add to context"}
                  >
                    <PlusCircledIcon className="w-4 h-4" />
                  </button>
                  
                  {/* Navigate Hint */}
                  {item.isDirectory && (
                    <div className={clsx("px-1.5 py-0.5 rounded text-[10px] font-mono", isSelected ? "text-theme-muted" : "text-theme-muted/70")}>
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
      <div className="px-3 py-2 bg-theme-bg/50 border-t border-theme text-[10px] text-theme-muted flex items-center justify-between font-medium">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="bg-theme-hover px-1 rounded text-theme-fg">↑↓</span> to navigate</span>
          <span className="flex items-center gap-1"><span className="bg-theme-hover px-1 rounded text-theme-fg">↵</span> to select</span>
        </div>
        <div className="flex items-center gap-1">
           <span className="bg-theme-hover px-1 rounded text-theme-fg">@</span> 
           <span>type to filter</span>
        </div>
      </div>
    </div>
  );
});

FileNavigator.displayName = 'FileNavigator';
