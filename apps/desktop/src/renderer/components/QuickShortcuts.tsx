import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  Globe,
  AppWindow,
  Folder,
  FileText,
  Zap,
  MessageSquare,
  NotebookPen,
  Terminal,
  Plus,
  X,
  Pencil,
  Trash2,
  Check,
  Settings2,
  ChevronRight,
  Star,
  Sparkles,
  ListTodo,
  Keyboard,
  Brain,
} from 'lucide-react';

export interface Bookmark {
  id: string;
  name: string;
  type: 'url' | 'app' | 'file' | 'folder' | 'workflow' | 'space' | 'canvas' | 'dashboard' | 'tasks' | 'terminal' | 'overlay' | 'semantic-search';
  target: string;
  icon?: string;
  color?: string;
  keybind?: string; // Electron accelerator e.g. "Ctrl+Shift+K"
}

const BOOKMARK_TYPES = [
  { type: 'url', label: 'Website', icon: Globe, color: 'text-blue-500', bg: 'bg-blue-500/10', description: 'Open a URL in browser' },
  { type: 'app', label: 'Application', icon: AppWindow, color: 'text-purple-500', bg: 'bg-purple-500/10', description: 'Launch an app' },
  { type: 'file', label: 'File', icon: FileText, color: 'text-emerald-500', bg: 'bg-emerald-500/10', description: 'Open a file' },
  { type: 'folder', label: 'Folder', icon: Folder, color: 'text-yellow-500', bg: 'bg-yellow-500/10', description: 'Open a folder' },
  { type: 'workflow', label: 'Workflow', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10', description: 'Run a Stuard workflow' },
  { type: 'space', label: 'Space', icon: MessageSquare, color: 'text-cyan-500', bg: 'bg-cyan-500/10', description: 'Open a conversation space' },
  { type: 'canvas', label: 'Quick Note', icon: NotebookPen, color: 'text-pink-500', bg: 'bg-pink-500/10', description: 'Open a note in Quick Notes' },
  { type: 'terminal', label: 'Terminal', icon: Terminal, color: 'text-orange-500', bg: 'bg-orange-500/10', description: 'Open the built-in terminal' },
  { type: 'overlay', label: 'Overlay', icon: Sparkles, color: 'text-violet-500', bg: 'bg-violet-500/10', description: 'Open the Stuard overlay' },
  { type: 'dashboard', label: 'Dashboard', icon: Settings2, color: 'text-indigo-500', bg: 'bg-indigo-500/10', description: 'Open Dashboard tab' },
  { type: 'tasks', label: 'Tasks', icon: ListTodo, color: 'text-emerald-500', bg: 'bg-emerald-500/10', description: 'Open tasks (To-Do or Agent)' },
  { type: 'semantic-search', label: 'Semantic Search', icon: Brain, color: 'text-purple-500', bg: 'bg-purple-500/10', description: 'Search files by meaning using AI embeddings' },
] as const;

// Quick presets for common shortcuts
const QUICK_PRESETS = [
  { name: 'Google', type: 'url' as const, target: 'https://google.com', icon: Globe },
  { name: 'YouTube', type: 'url' as const, target: 'https://youtube.com', icon: Globe },
  { name: 'GitHub', type: 'url' as const, target: 'https://github.com', icon: Globe },
  { name: 'ChatGPT', type: 'url' as const, target: 'https://chat.openai.com', icon: Sparkles },
  { name: 'Quick Note', type: 'canvas' as const, target: '_new', icon: NotebookPen },
  { name: 'Terminal', type: 'terminal' as const, target: 'terminal', icon: Terminal },
  { name: 'Overlay', type: 'overlay' as const, target: 'overlay', icon: Sparkles },
  { name: 'Planner', type: 'dashboard' as const, target: 'planner', icon: Settings2 },
  { name: 'Memories', type: 'dashboard' as const, target: 'memories', icon: Settings2 },
  { name: 'Tasks', type: 'tasks' as const, target: 'todo', icon: ListTodo },
  { name: 'Semantic Search', type: 'semantic-search' as const, target: 'semantic-search', icon: Brain },
];

export const getTypeConfig = (type: string) => {
  return BOOKMARK_TYPES.find(t => t.type === type) || BOOKMARK_TYPES[0];
};

const TYPES_WITH_DEFAULT_TARGET = new Set<Bookmark['type']>(['space', 'canvas', 'tasks', 'terminal', 'overlay', 'semantic-search']);

const getDefaultBookmarkTarget = (type?: Bookmark['type'] | null): string => {
  switch (type) {
    case 'space':
      return 'spaces';
    case 'canvas':
      return '_new';
    case 'tasks':
      return 'todo';
    case 'terminal':
      return 'terminal';
    case 'overlay':
      return 'overlay';
    case 'semantic-search':
      return 'semantic-search';
    default:
      return '';
  }
};

const findKeybindConflict = (keybind: string | undefined, bookmarks: Bookmark[], excludeId?: string): Bookmark | null => {
  const normalized = String(keybind || '').trim().toLowerCase();
  if (!normalized) return null;
  return bookmarks.find((bookmark) => bookmark.id !== excludeId && String(bookmark.keybind || '').trim().toLowerCase() === normalized) || null;
};

const normalizeShortcutSearchText = (value: string): string => String(value || '')
  .toLowerCase()
  .replace(/[/\\]+/g, ' ')
  .replace(/[_\-.]+/g, ' ')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const boundedShortcutDistance = (a: string, b: string, maxDistance = 2): number => {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const m = a.length;
  const n = b.length;
  const row = new Array(n + 1).fill(0).map((_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    row[0] = i;
    let minInRow = row[0];
    for (let j = 1; j <= n; j++) {
      const current = row[j];
      if (a[i - 1] === b[j - 1]) {
        row[j] = prev;
      } else {
        row[j] = 1 + Math.min(prev, row[j], row[j - 1]);
      }
      prev = current;
      if (row[j] < minInRow) minInRow = row[j];
    }
    if (minInRow > maxDistance) return maxDistance + 1;
  }

  return row[n];
};

// =============================================================================
// KEYBIND RECORDER
// =============================================================================

const KEY_DISPLAY: Record<string, string> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
  Cmd: '⌘',
  Space: '␣',
  Return: '↵',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Tab: '⇥',
};

const KEY_TO_ACCEL: Record<string, string> = {
  ' ': 'Space',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  enter: 'Return', escape: 'Escape', backspace: 'Backspace', delete: 'Delete',
  tab: 'Tab', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

function parseAccel(acc: string): string[] {
  if (!acc) return [];
  return acc.split('+').map(s => s.trim()).filter(Boolean);
}

function displayKey(part: string): string {
  return KEY_DISPLAY[part] || part;
}

function KeybindRecorder({
  value,
  onChange,
  onClear,
  compact = false,
}: {
  value?: string;
  onChange: (accelerator: string) => void;
  onClear: () => void;
  compact?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parts = parseAccel(value || '');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.key.toLowerCase();
    const newParts: string[] = [];

    if (e.ctrlKey || e.metaKey) newParts.push('Ctrl');
    if (e.altKey) newParts.push('Alt');
    if (e.shiftKey) newParts.push('Shift');

    if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
      const mapped = KEY_TO_ACCEL[key];
      if (mapped) {
        newParts.push(mapped);
      } else if (/^f\d+$/.test(key)) {
        newParts.push(key.toUpperCase());
      } else if (key.length === 1) {
        newParts.push(key.toUpperCase());
      } else {
        newParts.push(key.charAt(0).toUpperCase() + key.slice(1));
      }
    }

    // Need at least one modifier + one key
    if (newParts.length > 0 && newParts.some(p => !['Ctrl', 'Alt', 'Shift'].includes(p))) {
      onChange(newParts.join('+'));
      setRecording(false);
    }
  };

  useEffect(() => {
    if (recording && inputRef.current) inputRef.current.focus();
  }, [recording]);

  if (recording) {
    return (
      <div className="relative">
        <div className={clsx(
          "flex items-center justify-center gap-2 rounded-lg border-2 border-primary/50 bg-primary/5 transition-all",
          compact ? "px-2.5 py-1.5" : "px-3 py-2.5"
        )}>
          <Keyboard className={clsx("text-primary animate-pulse", compact ? "w-3 h-3" : "w-3.5 h-3.5")} />
          <span className={clsx("font-medium text-primary", compact ? "text-[10px]" : "text-[11px]")}>Press keys...</span>
        </div>
        <input
          ref={inputRef}
          type="text"
          className="sr-only"
          onKeyDown={handleKeyDown}
          onBlur={() => setRecording(false)}
          readOnly
        />
      </div>
    );
  }

  if (parts.length > 0) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setRecording(true)}
          className={clsx(
            "flex items-center gap-1 rounded-lg bg-theme-hover/60 hover:bg-theme-hover border border-theme/10 transition-all group",
            compact ? "px-1.5 py-1" : "px-2 py-1.5"
          )}
          title="Click to re-record"
        >
          {parts.map((p, i) => (
            <React.Fragment key={`${p}-${i}`}>
              <span className={clsx(
                "px-1.5 py-0.5 bg-theme-hover/80 border border-theme/10 rounded font-mono font-semibold text-theme-muted leading-none",
                compact ? "text-[9px]" : "text-[10px]"
              )}>
                {displayKey(p)}
              </span>
              {i < parts.length - 1 && <span className={clsx("text-theme-muted", compact ? "text-[8px]" : "text-[9px]")}>+</span>}
            </React.Fragment>
          ))}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="w-5 h-5 rounded flex items-center justify-center text-theme-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
          title="Remove keybind"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setRecording(true)}
      className={clsx(
        "flex items-center gap-1.5 rounded-lg border border-dashed border-theme/20 hover:border-primary/40 hover:bg-primary/5 text-theme-muted hover:text-primary transition-all",
        compact ? "px-2 py-1 text-[9px]" : "px-2.5 py-1.5 text-[10px]"
      )}
      title="Add keyboard shortcut"
    >
      <Keyboard className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} />
      <span className="font-medium">Add keybind</span>
    </button>
  );
}

// Compact keybind badge for the grid tiles
function KeybindBadge({ keybind }: { keybind: string }) {
  const parts = parseAccel(keybind);
  if (parts.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5 mt-1">
      {parts.map((p, i) => (
        <React.Fragment key={`${p}-${i}`}>
          <span className="px-1 py-px bg-theme-hover/80 border border-theme/10 rounded text-[8px] font-mono font-bold text-theme-muted leading-none">
            {displayKey(p)}
          </span>
          {i < parts.length - 1 && <span className="text-[7px] text-theme-muted">+</span>}
        </React.Fragment>
      ))}
    </div>
  );
};

export function QuickShortcutsGrid({ 
  bookmarks, 
  onExecute, 
  onEdit, 
  onAdd,
  isEditing = false,
  maxVisible = 6,
  filter = ""
}: { 
  bookmarks: Bookmark[];
  onExecute: (bookmark: Bookmark) => void;
  onEdit?: () => void;
  onAdd?: () => void;
  isEditing?: boolean;
  maxVisible?: number;
  filter?: string;
}) {
  const visibleBookmarks = React.useMemo(() => {
    if (!filter || !filter.trim()) return bookmarks.slice(0, maxVisible);

    const q = normalizeShortcutSearchText(filter);
    // Filter and score
    const scored = bookmarks.map(b => {
      let score = 0;
      const name = normalizeShortcutSearchText(b.name);
      const target = normalizeShortcutSearchText(b.target);
      const type = normalizeShortcutSearchText(b.type);

      if (name === q) score += 100;
      else if (name.startsWith(q)) score += 50;
      else if (name.includes(q)) score += 20;

      if (target === q) score += 40;
      else if (target.includes(q)) score += 10;

      if (type.includes(q)) score += 5;

      if (score === 0 && q.length >= 4) {
        const tokens = Array.from(new Set([
          ...name.split(' ').filter(Boolean),
          ...target.split(' ').filter(Boolean),
        ]));
        for (const token of tokens) {
          const maxDist = Math.max(q.length, token.length) >= 7 ? 2 : 1;
          const dist = boundedShortcutDistance(q, token, maxDist);
          if (dist <= maxDist) {
            score = Math.max(score, dist === 1 ? 42 : 30);
          }
        }
      }

      return { bookmark: b, score };
    }).filter(item => item.score > 0);

    // Sort by score desc
    return scored.sort((a, b) => b.score - a.score).map(item => item.bookmark);
  }, [bookmarks, filter, maxVisible]);

  const hasMore = (!filter && bookmarks.length > maxVisible);
  const showAdd = !filter && !isEditing;

  if (bookmarks.length === 0 && !isEditing && !filter) {
    return (
      <div className="px-3 py-2">
        <button
          onClick={onAdd}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border-2 border-dashed border-theme/20 hover:border-primary/50 hover:bg-primary/5 transition-all group"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-all">
            <Plus className="w-4 h-4 text-primary" />
          </div>
          <div className="text-left">
            <div className="text-[13px] font-semibold text-theme-fg group-hover:text-primary transition-colors">Add Quick Shortcut</div>
            <div className="text-[10px] text-theme-muted">Pin URLs, apps, workflows & more</div>
          </div>
        </button>
      </div>
    );
  }

  if (filter && visibleBookmarks.length === 0) return null;

  return (
    <div className="space-y-1.5 px-2 py-1.5">
      <div className="flex items-center justify-between px-2 pb-0.5">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">
            {filter ? 'Matching Shortcuts' : 'Quick Actions & Hotkeys'}
          </span>
        </div>
        {!filter && (
          <button
            onClick={onEdit}
            className="text-[10px] font-semibold text-theme-muted hover:text-primary transition-colors flex items-center gap-1"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
      </div>
      
      <div className="grid grid-cols-3 gap-1">
        {visibleBookmarks.map((bookmark) => {
          const cfg = getTypeConfig(bookmark.type);
          const Icon = cfg.icon;
          return (
            <button
              key={bookmark.id}
              onClick={() => onExecute(bookmark)}
              className={clsx(
                "flex flex-col items-center gap-1 p-2 rounded-xl transition-all group relative overflow-hidden",
                "bg-transparent",
                "hover:bg-theme-hover/40",
                "active:scale-[0.97]"
              )}
              title={bookmark.target}
            >
              <div className={clsx(
                "w-8 h-8 rounded-xl flex items-center justify-center transition-all group-hover:scale-110",
                bookmark.color ? `bg-${bookmark.color}-500/10 text-${bookmark.color}-500` : `${cfg.bg} ${cfg.color}`
              )}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-semibold text-theme-fg truncate w-full text-center leading-tight px-0.5">
                {bookmark.name}
              </span>
              <span className="text-[8px] text-theme-muted truncate w-full text-center opacity-80">
                {cfg.label}
              </span>
              {bookmark.keybind && !filter && (
                <KeybindBadge keybind={bookmark.keybind} />
              )}
            </button>
          );
        })}
        
        {/* Add new shortcut button - only show when not filtering */}
        {showAdd && (
          <button
            onClick={onAdd}
            className={clsx(
              "flex flex-col items-center gap-1 p-2 rounded-xl transition-all group",
              "bg-transparent hover:bg-theme-hover/40",
              "active:scale-[0.97]"
            )}
          >
            <div className="w-8 h-8 rounded-xl bg-theme-hover/40 flex items-center justify-center transition-all group-hover:bg-primary/10">
              <Plus className="w-4 h-4 text-theme-muted group-hover:text-primary transition-colors" />
            </div>
            <span className="text-[10px] font-semibold text-theme-muted group-hover:text-primary truncate w-full text-center leading-tight transition-colors">
              Add
            </span>
          </button>
        )}
      </div>
      
      {hasMore && (
        <button
          onClick={onEdit}
          className="w-full py-1 text-[10px] font-semibold text-theme-muted hover:text-primary transition-colors text-center"
        >
          +{bookmarks.length - maxVisible} more &rarr;
        </button>
      )}
    </div>
  );
}

export function BookmarkEditor({
  isOpen,
  onClose,
  bookmarks,
  onSave,
  workflows = [],
  canvasDocuments = []
}: {
  isOpen: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  onSave: (bookmarks: Bookmark[]) => void;
  workflows?: Array<{ id: string; name: string }>;
  canvasDocuments?: Array<{ id: string; title: string }>;
}) {
  const [localBookmarks, setLocalBookmarks] = useState<Bookmark[]>(bookmarks);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'add' | 'type-select'>('list');
  const [selectedType, setSelectedType] = useState<Bookmark['type'] | null>(null);
  const [newBookmark, setNewBookmark] = useState<Partial<Bookmark>>({});
  const newBookmarkConflict = findKeybindConflict(newBookmark.keybind, localBookmarks);

  // Load canvas documents on mount
  const [loadedCanvasDocs, setLoadedCanvasDocs] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    if (isOpen && canvasDocuments.length === 0) {
      (window as any).desktopAPI?.canvasListDocuments?.().then((res: any) => {
        if (res?.ok && Array.isArray(res.documents)) {
          setLoadedCanvasDocs(res.documents.map((d: any) => ({ id: d.id, title: d.title || 'Quick Note' })));
        }
      }).catch(() => {});
    }
  }, [isOpen, canvasDocuments.length]);

  const canvasDocs = canvasDocuments.length > 0 ? canvasDocuments : loadedCanvasDocs;

  useEffect(() => {
    setLocalBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    if (isOpen) {
      setView('list');
      setSelectedType(null);
      setNewBookmark({});
      setEditingId(null);
    }
  }, [isOpen]);

  const handleQuickAdd = (preset: typeof QUICK_PRESETS[0]) => {
    const id = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const bm: Bookmark = { id, name: preset.name, type: preset.type, target: preset.target };
    const updated = [...localBookmarks, bm];
    setLocalBookmarks(updated);
    onSave(updated);
  };

  const handleSelectType = (type: Bookmark['type']) => {
    setSelectedType(type);
    setNewBookmark({ type, name: '', target: getDefaultBookmarkTarget(type) });
    setView('add');
  };

  const handleSaveNew = () => {
    if (newBookmarkConflict) return;
    if (newBookmark.name && (newBookmark.target || TYPES_WITH_DEFAULT_TARGET.has((newBookmark.type || 'url') as Bookmark['type']))) {
      const id = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const target = newBookmark.target || getDefaultBookmarkTarget(newBookmark.type as Bookmark['type']);
      const updated = [...localBookmarks, { ...newBookmark, id, target } as Bookmark];
      setLocalBookmarks(updated);
      onSave(updated);
      setView('list');
      setNewBookmark({});
      setSelectedType(null);
    }
  };

  const handleDelete = (id: string) => {
    const updated = localBookmarks.filter(b => b.id !== id);
    setLocalBookmarks(updated);
    onSave(updated);
  };

  const handleUpdate = (id: string, updates: Partial<Bookmark>) => {
    const updated = localBookmarks.map(b => b.id === id ? { ...b, ...updates } : b);
    setLocalBookmarks(updated);
    onSave(updated);
  };

  const handleBrowseFile = async () => {
    const result = await (window as any).desktopAPI?.selectFiles?.();
    const path = Array.isArray(result) ? result[0]?.path : result?.files?.[0]?.path;
    if (path) {
      const name = path.split(/[/\\]/).pop() || 'File';
      setNewBookmark(prev => ({ ...prev, target: path, name: prev.name || name }));
    }
  };

  const handleBrowseFolder = async () => {
    const result = await (window as any).desktopAPI?.selectFolder?.();
    const path = Array.isArray(result) ? result[0]?.path : result?.folders?.[0]?.path;
    if (path) {
      const name = path.split(/[/\\]/).pop() || 'Folder';
      setNewBookmark(prev => ({ ...prev, target: path, name: prev.name || name }));
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[100001] flex items-center justify-center animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Overlay - simple dark, no blur */}
      <div className="absolute inset-0 bg-black/60" />
      
      <div className="relative w-full max-w-md bg-theme-card rounded-2xl border border-theme/20 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme/10 bg-theme-hover/20">
          <div className="flex items-center gap-3">
            {view !== 'list' && (
              <button
                onClick={() => { setView(view === 'add' ? 'type-select' : 'list'); setNewBookmark({}); }}
                className="w-7 h-7 rounded-lg hover:bg-theme-hover flex items-center justify-center text-theme-muted hover:text-theme-fg transition-all"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
            )}
            <div>
              <h2 className="text-[15px] font-bold text-theme-fg">
                {view === 'list' ? 'Quick Shortcuts' : view === 'type-select' ? 'Add Shortcut' : `New ${getTypeConfig(selectedType || 'url').label}`}
              </h2>
              <p className="text-[11px] text-theme-muted mt-0.5">
                {view === 'list' ? 'Your pinned apps, sites & workflows' : view === 'type-select' ? 'Choose what to pin' : 'Configure your shortcut'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-theme-hover flex items-center justify-center text-theme-muted hover:text-theme-fg transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[450px] overflow-y-auto custom-scrollbar">
          {/* LIST VIEW */}
          {view === 'list' && (
            <>
              {/* Existing bookmarks */}
              {localBookmarks.length > 0 ? (
                <div className="space-y-1.5 mb-4">
                  {localBookmarks.map((bookmark) => {
                    const cfg = getTypeConfig(bookmark.type);
                    const Icon = cfg.icon;
                    const isEditing = editingId === bookmark.id;
                    const keybindConflict = findKeybindConflict(bookmark.keybind, localBookmarks, bookmark.id);

                    return (
                      <div
                        key={bookmark.id}
                        className={clsx(
                          "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                          isEditing ? "bg-primary/10 ring-1 ring-primary/30" : "bg-theme-hover/40 hover:bg-theme-hover/60"
                        )}
                      >
                        <div className={clsx("w-9 h-9 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform", cfg.bg, cfg.color)}>
                          <Icon className="w-4 h-4" />
                        </div>
                        
                        {isEditing ? (
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={bookmark.name}
                              onChange={(e) => handleUpdate(bookmark.id, { name: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-[13px] bg-theme-bg border border-theme/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50 text-theme-fg"
                              placeholder="Name"
                              autoFocus
                            />
                            <div className="flex items-center justify-between">
                              <KeybindRecorder
                                value={bookmark.keybind}
                                onChange={(accel) => handleUpdate(bookmark.id, { keybind: accel })}
                                onClear={() => handleUpdate(bookmark.id, { keybind: undefined })}
                                compact
                              />
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-3 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 rounded-lg transition-colors"
                              >
                                Done
                              </button>
                            </div>
                            {keybindConflict && (
                              <div className="text-[10px] text-amber-500">
                                This hotkey is already used by "{keybindConflict.name}".
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-theme-fg truncate">{bookmark.name}</div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-theme-muted truncate">{cfg.label}</span>
                                {bookmark.keybind && (
                                  <span className="flex items-center gap-0.5 shrink-0">
                                    {parseAccel(bookmark.keybind).map((p, i) => (
                                      <React.Fragment key={`${p}-${i}`}>
                                        <span className="px-1 py-px bg-theme-hover/80 border border-theme/10 rounded text-[9px] font-mono font-semibold text-theme-muted leading-none">
                                          {displayKey(p)}
                                        </span>
                                        {i < parseAccel(bookmark.keybind!).length - 1 && (
                                          <span className="text-[8px] text-theme-muted">+</span>
                                        )}
                                      </React.Fragment>
                                    ))}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setEditingId(bookmark.id)}
                                className="px-2.5 py-1 rounded-lg bg-theme-bg hover:bg-theme-active text-[10px] font-semibold text-theme-muted hover:text-theme-fg transition-all"
                              >
                                {bookmark.keybind ? 'Hotkey' : 'Map Hotkey'}
                              </button>
                              <button
                                onClick={() => setEditingId(bookmark.id)}
                                className="w-7 h-7 rounded-lg hover:bg-theme-active flex items-center justify-center text-theme-muted hover:text-theme-fg transition-all"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(bookmark.id)}
                                className="w-7 h-7 rounded-lg hover:bg-red-500/10 flex items-center justify-center text-theme-muted hover:text-red-500 transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-theme-muted">
                  <Star className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-[13px] font-medium">No shortcuts yet</p>
                  <p className="text-[11px] mt-1">Add your first shortcut below</p>
                </div>
              )}

              {/* Quick presets */}
              {localBookmarks.length < 3 && (
                <div className="mb-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-theme-muted mb-2">Quick Add</div>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_PRESETS.filter(p => !localBookmarks.some(b => b.target === p.target)).slice(0, 4).map((preset) => (
                      <button
                        key={preset.target}
                        onClick={() => handleQuickAdd(preset)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-theme-hover/50 hover:bg-theme-hover text-[11px] font-medium text-theme-fg transition-all"
                      >
                        <Plus className="w-3 h-3 text-theme-muted" />
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Add new button */}
              <button
                onClick={() => setView('type-select')}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary transition-all group"
              >
                <Plus className="w-4 h-4" />
                <span className="text-[13px] font-semibold">Add New Shortcut</span>
              </button>
            </>
          )}

          {/* TYPE SELECT VIEW */}
          {view === 'type-select' && (
            <div className="grid grid-cols-2 gap-2">
              {BOOKMARK_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.type}
                    onClick={() => handleSelectType(type.type)}
                    className="flex items-center gap-3 px-3 py-3.5 rounded-xl bg-theme-hover/40 hover:bg-theme-hover transition-all text-left group"
                  >
                    <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform", type.bg, type.color)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-theme-fg">{type.label}</div>
                      <div className="text-[10px] text-theme-muted leading-tight truncate">{type.description}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-theme-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          )}

          {/* ADD FORM VIEW */}
          {view === 'add' && selectedType && (
            <div className="space-y-4">
              {/* Workflow selector */}
              {selectedType === 'workflow' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Select Workflow</div>
                  {workflows.length > 0 ? (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto custom-scrollbar">
                      {workflows.map(w => (
                        <button
                          key={w.id}
                          onClick={() => setNewBookmark({ ...newBookmark, target: w.id, name: newBookmark.name || w.name })}
                          className={clsx(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                            newBookmark.target === w.id ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                          )}
                        >
                          <Zap className={clsx("w-4 h-4", newBookmark.target === w.id ? "text-primary" : "text-amber-500")} />
                          <span className="text-[13px] font-medium text-theme-fg truncate">{w.name}</span>
                          {newBookmark.target === w.id && <Check className="w-4 h-4 text-primary ml-auto" />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-theme-muted">
                      <p className="text-[12px]">No workflows found</p>
                    </div>
                  )}
                </>
              )}

              {/* Canvas selector */}
              {selectedType === 'canvas' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Select Note</div>
                  <button
                    onClick={() => setNewBookmark({ ...newBookmark, target: '_new', name: newBookmark.name || 'New Quick Note' })}
                    className={clsx(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left mb-2",
                      newBookmark.target === '_new' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                    )}
                  >
                    <Plus className={clsx("w-4 h-4", newBookmark.target === '_new' ? "text-primary" : "text-pink-500")} />
                    <span className="text-[13px] font-medium text-theme-fg">Create Fresh Quick Note</span>
                    {newBookmark.target === '_new' && <Check className="w-4 h-4 text-primary ml-auto" />}
                  </button>
                  {canvasDocs.length > 0 && (
                    <div className="space-y-1.5 max-h-[150px] overflow-y-auto custom-scrollbar">
                      {canvasDocs.map(d => (
                        <button
                          key={d.id}
                          onClick={() => setNewBookmark({ ...newBookmark, target: d.id, name: newBookmark.name || d.title })}
                          className={clsx(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                            newBookmark.target === d.id ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                          )}
                        >
                          <NotebookPen className={clsx("w-4 h-4", newBookmark.target === d.id ? "text-primary" : "text-pink-500")} />
                          <span className="text-[13px] font-medium text-theme-fg truncate">{d.title}</span>
                          {newBookmark.target === d.id && <Check className="w-4 h-4 text-primary ml-auto" />}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Space selector */}
              {selectedType === 'space' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Select Space</div>
                  <button
                    onClick={() => setNewBookmark({ ...newBookmark, target: 'spaces', name: newBookmark.name || 'Open Spaces' })}
                    className={clsx(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                      newBookmark.target === 'spaces' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                    )}
                  >
                    <MessageSquare className={clsx("w-4 h-4", newBookmark.target === 'spaces' ? "text-primary" : "text-cyan-500")} />
                    <span className="text-[13px] font-medium text-theme-fg">Open Spaces Sidebar</span>
                    {newBookmark.target === 'spaces' && <Check className="w-4 h-4 text-primary ml-auto" />}
                  </button>
                </>
              )}

              {/* Dashboard selector */}
              {selectedType === 'dashboard' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Select Tab</div>
                  <div className="space-y-1.5">
                    {[
                      { id: '', label: 'Dashboard Home' },
                      { id: 'planner', label: 'Planner' },
                      { id: 'memories', label: 'Memories' },
                      { id: 'integrations', label: 'Integrations' },
                      { id: 'settings', label: 'Settings' },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setNewBookmark({ ...newBookmark, target: tab.id, name: newBookmark.name || tab.label })}
                        className={clsx(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                          newBookmark.target === tab.id ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                        )}
                      >
                        <Settings2 className={clsx("w-4 h-4", newBookmark.target === tab.id ? "text-primary" : "text-indigo-500")} />
                        <span className="text-[13px] font-medium text-theme-fg">{tab.label}</span>
                        {newBookmark.target === tab.id && <Check className="w-4 h-4 text-primary ml-auto" />}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Tasks selector */}
              {selectedType === 'tasks' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Select Task Type</div>
                  <div className="space-y-1.5">
                    <button
                      onClick={() => setNewBookmark({ ...newBookmark, target: 'todo', name: newBookmark.name || 'To-Do List' })}
                      className={clsx(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                        newBookmark.target === 'todo' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                      )}
                    >
                      <ListTodo className={clsx("w-4 h-4", newBookmark.target === 'todo' ? "text-primary" : "text-emerald-500")} />
                      <div className="flex-1">
                        <span className="text-[13px] font-medium text-theme-fg">To-Do List</span>
                        <p className="text-[10px] text-theme-muted">Your personal tasks</p>
                      </div>
                      {newBookmark.target === 'todo' && <Check className="w-4 h-4 text-primary" />}
                    </button>
                    <button
                      onClick={() => setNewBookmark({ ...newBookmark, target: 'agent', name: newBookmark.name || 'Agent Tasks' })}
                      className={clsx(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                        newBookmark.target === 'agent' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                      )}
                    >
                      <Sparkles className={clsx("w-4 h-4", newBookmark.target === 'agent' ? "text-primary" : "text-amber-500")} />
                      <div className="flex-1">
                        <span className="text-[13px] font-medium text-theme-fg">Agent Tasks</span>
                        <p className="text-[10px] text-theme-muted">AI sub-agent tasks</p>
                      </div>
                      {newBookmark.target === 'agent' && <Check className="w-4 h-4 text-primary" />}
                    </button>
                  </div>
                </>
              )}

              {/* Terminal selector */}
              {selectedType === 'terminal' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Open</div>
                  <button
                    onClick={() => setNewBookmark({ ...newBookmark, target: 'terminal', name: newBookmark.name || 'Terminal' })}
                    className={clsx(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                      newBookmark.target === 'terminal' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                    )}
                  >
                    <Terminal className={clsx("w-4 h-4", newBookmark.target === 'terminal' ? "text-primary" : "text-orange-500")} />
                    <div className="flex-1">
                      <span className="text-[13px] font-medium text-theme-fg">Open Terminal</span>
                      <p className="text-[10px] text-theme-muted">Jump straight into the built-in terminal</p>
                    </div>
                    {newBookmark.target === 'terminal' && <Check className="w-4 h-4 text-primary" />}
                  </button>
                </>
              )}

              {/* Overlay selector */}
              {selectedType === 'overlay' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Open</div>
                  <button
                    onClick={() => setNewBookmark({ ...newBookmark, target: 'overlay', name: newBookmark.name || 'Stuard Overlay' })}
                    className={clsx(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                      newBookmark.target === 'overlay' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                    )}
                  >
                    <Sparkles className={clsx("w-4 h-4", newBookmark.target === 'overlay' ? "text-primary" : "text-violet-500")} />
                    <div className="flex-1">
                      <span className="text-[13px] font-medium text-theme-fg">Open Overlay</span>
                      <p className="text-[10px] text-theme-muted">Bring the main Stuard overlay to the front</p>
                    </div>
                    {newBookmark.target === 'overlay' && <Check className="w-4 h-4 text-primary" />}
                  </button>
                </>
              )}

              {/* Semantic Search selector */}
              {selectedType === 'semantic-search' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Semantic File Search</div>
                  <button
                    onClick={() => setNewBookmark({ ...newBookmark, target: 'semantic-search', name: newBookmark.name || 'Semantic Search' })}
                    className={clsx(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                      newBookmark.target === 'semantic-search' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                    )}
                  >
                    <Brain className={clsx("w-4 h-4", newBookmark.target === 'semantic-search' ? "text-primary" : "text-purple-500")} />
                    <div className="flex-1">
                      <span className="text-[13px] font-medium text-theme-fg">Search Files by Meaning</span>
                      <p className="text-[10px] text-theme-muted">Use AI embeddings to find files by content, not just keywords</p>
                    </div>
                    {newBookmark.target === 'semantic-search' && <Check className="w-4 h-4 text-primary" />}
                  </button>
                </>
              )}

              {/* URL input */}
              {selectedType === 'url' && (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newBookmark.target || ''}
                    onChange={(e) => setNewBookmark({ ...newBookmark, target: e.target.value })}
                    className="w-full px-3 py-2.5 text-[13px] bg-theme-bg border border-theme/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-theme-fg"
                    placeholder="https://example.com"
                    autoFocus
                  />
                </div>
              )}

              {/* File/App browser */}
              {(selectedType === 'file' || selectedType === 'app') && (
                <div className="space-y-3">
                  <button
                    onClick={handleBrowseFile}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-theme-hover hover:bg-theme-active transition-all"
                  >
                    <Folder className="w-4 h-4 text-theme-muted" />
                    <span className="text-[13px] font-medium text-theme-fg">Browse Files</span>
                  </button>
                  {newBookmark.target && (
                    <div className="px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-600 text-[12px] truncate">
                      ✓ {newBookmark.target}
                    </div>
                  )}
                </div>
              )}

              {/* Folder browser */}
              {selectedType === 'folder' && (
                <div className="space-y-3">
                  <button
                    onClick={handleBrowseFolder}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-theme-hover hover:bg-theme-active transition-all"
                  >
                    <Folder className="w-4 h-4 text-theme-muted" />
                    <span className="text-[13px] font-medium text-theme-fg">Browse Folders</span>
                  </button>
                  {newBookmark.target && (
                    <div className="px-3 py-2 rounded-lg bg-yellow-500/10 text-yellow-600 text-[12px] truncate">
                      ✓ {newBookmark.target}
                    </div>
                  )}
                </div>
              )}

              {/* Name input (for all types) */}
              <div className="pt-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Display Name</div>
                <input
                  type="text"
                  value={newBookmark.name || ''}
                  onChange={(e) => setNewBookmark({ ...newBookmark, name: e.target.value })}
                  className="w-full px-3 py-2.5 text-[13px] bg-theme-bg border border-theme/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-theme-fg"
                  placeholder="My Shortcut"
                />
              </div>

              {/* Keybind recorder */}
              <div className="pt-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Keyboard Shortcut <span className="text-theme-muted/50 normal-case font-normal">(optional)</span></div>
                <KeybindRecorder
                  value={newBookmark.keybind}
                  onChange={(accel) => setNewBookmark({ ...newBookmark, keybind: accel })}
                  onClear={() => setNewBookmark({ ...newBookmark, keybind: undefined })}
                />
                <p className="text-[10px] text-theme-muted mt-1.5 px-1">Map a global hotkey so you can launch this shortcut instantly.</p>
                {newBookmarkConflict && (
                  <p className="text-[10px] text-amber-500 mt-1.5 px-1">
                    This hotkey is already used by "{newBookmarkConflict.name}".
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-theme/10 bg-theme-hover/10 flex justify-end gap-2">
          {view === 'add' ? (
            <>
              <button
                onClick={() => { setView('type-select'); setNewBookmark({}); }}
                className="px-4 py-2 text-[12px] font-semibold text-theme-muted hover:text-theme-fg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNew}
                disabled={!newBookmark.name || (!newBookmark.target && !TYPES_WITH_DEFAULT_TARGET.has((selectedType || 'url') as Bookmark['type'])) || !!newBookmarkConflict}
                className="px-4 py-2 text-[12px] font-bold bg-primary text-primary-fg rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                Add Shortcut
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-bold bg-primary text-primary-fg rounded-lg hover:bg-primary/90 transition-all"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBookmarks = useCallback(async () => {
    try {
      const result = await (window as any).desktopAPI?.bookmarksList?.();
      if (result?.ok && Array.isArray(result.bookmarks)) {
        setBookmarks(result.bookmarks);
      }
    } catch (e) {
      console.error('Failed to load bookmarks:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const saveBookmarks = useCallback(async (newBookmarks: Bookmark[]) => {
    try {
      await (window as any).desktopAPI?.bookmarksSave?.(newBookmarks);
      setBookmarks(newBookmarks);
    } catch (e) {
      console.error('Failed to save bookmarks:', e);
    }
  }, []);

  const executeBookmark = useCallback(async (bookmark: Bookmark) => {
    try {
      await (window as any).desktopAPI?.bookmarksExecute?.(bookmark);
      // Hide overlay after executing
      (window as any).desktopAPI?.hide?.();
    } catch (e) {
      console.error('Failed to execute bookmark:', e);
    }
  }, []);

  return { bookmarks, loading, saveBookmarks, executeBookmark, reload: loadBookmarks };
}
