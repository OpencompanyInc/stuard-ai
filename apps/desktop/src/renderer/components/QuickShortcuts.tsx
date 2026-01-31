import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  Globe,
  AppWindow,
  Folder,
  FileText,
  Zap,
  MessageSquare,
  Layout,
  Plus,
  X,
  Pencil,
  Trash2,
  Check,
  Settings2,
  ChevronRight,
  Star,
  Sparkles,
  ListTodo
} from 'lucide-react';

export interface Bookmark {
  id: string;
  name: string;
  type: 'url' | 'app' | 'file' | 'folder' | 'workflow' | 'space' | 'canvas' | 'dashboard' | 'tasks';
  target: string;
  icon?: string;
  color?: string;
}

interface QuickShortcutsProps {
  onClose?: () => void;
  compact?: boolean;
}

const BOOKMARK_TYPES = [
  { type: 'url', label: 'Website', icon: Globe, color: 'text-blue-500', bg: 'bg-blue-500/10', description: 'Open a URL in browser' },
  { type: 'app', label: 'Application', icon: AppWindow, color: 'text-purple-500', bg: 'bg-purple-500/10', description: 'Launch an app' },
  { type: 'file', label: 'File', icon: FileText, color: 'text-emerald-500', bg: 'bg-emerald-500/10', description: 'Open a file' },
  { type: 'folder', label: 'Folder', icon: Folder, color: 'text-yellow-500', bg: 'bg-yellow-500/10', description: 'Open a folder' },
  { type: 'workflow', label: 'Workflow', icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10', description: 'Run a Stuard workflow' },
  { type: 'space', label: 'Space', icon: MessageSquare, color: 'text-cyan-500', bg: 'bg-cyan-500/10', description: 'Open a conversation space' },
  { type: 'canvas', label: 'Canvas', icon: Layout, color: 'text-pink-500', bg: 'bg-pink-500/10', description: 'Open a canvas document' },
  { type: 'dashboard', label: 'Dashboard', icon: Settings2, color: 'text-indigo-500', bg: 'bg-indigo-500/10', description: 'Open Dashboard tab' },
  { type: 'tasks', label: 'Tasks', icon: ListTodo, color: 'text-emerald-500', bg: 'bg-emerald-500/10', description: 'Open tasks (To-Do or Agent)' },
] as const;

// Quick presets for common shortcuts
const QUICK_PRESETS = [
  { name: 'Google', type: 'url' as const, target: 'https://google.com', icon: Globe },
  { name: 'YouTube', type: 'url' as const, target: 'https://youtube.com', icon: Globe },
  { name: 'GitHub', type: 'url' as const, target: 'https://github.com', icon: Globe },
  { name: 'ChatGPT', type: 'url' as const, target: 'https://chat.openai.com', icon: Sparkles },
  { name: 'Planner', type: 'dashboard' as const, target: 'planner', icon: Settings2 },
  { name: 'Memories', type: 'dashboard' as const, target: 'memories', icon: Settings2 },
  { name: 'Tasks', type: 'tasks' as const, target: 'todo', icon: ListTodo },
];

const getTypeConfig = (type: string) => {
  return BOOKMARK_TYPES.find(t => t.type === type) || BOOKMARK_TYPES[0];
};

export function QuickShortcutsGrid({ 
  bookmarks, 
  onExecute, 
  onEdit, 
  onAdd,
  isEditing = false,
  maxVisible = 6
}: { 
  bookmarks: Bookmark[];
  onExecute: (bookmark: Bookmark) => void;
  onEdit?: () => void;
  onAdd?: () => void;
  isEditing?: boolean;
  maxVisible?: number;
}) {
  const visibleBookmarks = bookmarks.slice(0, maxVisible);
  const hasMore = bookmarks.length > maxVisible;

  if (bookmarks.length === 0 && !isEditing) {
    return (
      <div className="px-4 py-3">
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

  return (
    <div className="space-y-1 px-2 py-2">
      <div className="flex items-center justify-between px-2 pb-1">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-theme-muted">Quick Shortcuts</span>
        </div>
        <button
          onClick={onEdit}
          className="text-[10px] font-semibold text-theme-muted hover:text-primary transition-colors flex items-center gap-1"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      </div>
      
      <div className="grid grid-cols-3 gap-1.5">
        {visibleBookmarks.map((bookmark) => {
          const cfg = getTypeConfig(bookmark.type);
          const Icon = cfg.icon;
          return (
            <button
              key={bookmark.id}
              onClick={() => onExecute(bookmark)}
              className={clsx(
                "flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl transition-all group",
                "hover:bg-theme-hover border border-transparent hover:border-theme/20",
                "active:scale-95"
              )}
              title={bookmark.target}
            >
              <div className={clsx(
                "w-9 h-9 rounded-xl flex items-center justify-center transition-all group-hover:scale-110",
                bookmark.color ? `bg-${bookmark.color}-500/10 text-${bookmark.color}-500` : `${cfg.bg} ${cfg.color}`
              )}>
                <Icon className="w-4.5 h-4.5" />
              </div>
              <span className="text-[10px] font-semibold text-theme-fg truncate w-full text-center leading-tight">
                {bookmark.name}
              </span>
            </button>
          );
        })}
        
        {/* Add new shortcut button */}
        <button
          onClick={onAdd}
          className={clsx(
            "flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl transition-all group",
            "hover:bg-theme-hover border-2 border-dashed border-theme/10 hover:border-primary/30",
            "active:scale-95"
          )}
        >
          <div className="w-9 h-9 rounded-xl bg-theme-hover/50 flex items-center justify-center transition-all group-hover:bg-primary/10">
            <Plus className="w-4 h-4 text-theme-muted group-hover:text-primary transition-colors" />
          </div>
          <span className="text-[10px] font-semibold text-theme-muted group-hover:text-primary truncate w-full text-center leading-tight transition-colors">
            Add
          </span>
        </button>
      </div>
      
      {hasMore && (
        <button
          onClick={onEdit}
          className="w-full py-1.5 text-[10px] font-semibold text-theme-muted hover:text-primary transition-colors text-center"
        >
          +{bookmarks.length - maxVisible} more →
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
  canvasDocuments = [],
  spaces = []
}: {
  isOpen: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  onSave: (bookmarks: Bookmark[]) => void;
  workflows?: Array<{ id: string; name: string }>;
  canvasDocuments?: Array<{ id: string; title: string }>;
  spaces?: Array<{ id: string; name: string }>;
}) {
  const [localBookmarks, setLocalBookmarks] = useState<Bookmark[]>(bookmarks);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'add' | 'type-select'>('list');
  const [selectedType, setSelectedType] = useState<Bookmark['type'] | null>(null);
  const [newBookmark, setNewBookmark] = useState<Partial<Bookmark>>({});

  // Load canvas documents on mount
  const [loadedCanvasDocs, setLoadedCanvasDocs] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    if (isOpen && canvasDocuments.length === 0) {
      (window as any).desktopAPI?.canvasListDocuments?.().then((res: any) => {
        if (res?.ok && Array.isArray(res.documents)) {
          setLoadedCanvasDocs(res.documents.map((d: any) => ({ id: d.id, title: d.title || 'Untitled' })));
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
    setNewBookmark({ type, name: '', target: '' });
    setView('add');
  };

  const handleSaveNew = () => {
    if (newBookmark.name && (newBookmark.target || newBookmark.type === 'space' || newBookmark.type === 'canvas' || newBookmark.type === 'tasks')) {
      const id = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const target = newBookmark.target || (newBookmark.type === 'space' ? 'spaces' : newBookmark.type === 'tasks' ? 'todo' : 'canvas');
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
    if (result?.paths?.[0]) {
      const path = result.paths[0];
      const name = path.split(/[/\\]/).pop() || 'File';
      setNewBookmark(prev => ({ ...prev, target: path, name: prev.name || name }));
    }
  };

  const handleBrowseFolder = async () => {
    const result = await (window as any).desktopAPI?.selectFolder?.();
    if (result?.paths?.[0]) {
      const path = result.paths[0];
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme/10">
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

                    return (
                      <div
                        key={bookmark.id}
                        className={clsx(
                          "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                          isEditing ? "bg-primary/10 ring-1 ring-primary/30" : "bg-theme-hover/40 hover:bg-theme-hover/60"
                        )}
                      >
                        <div className={clsx("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", cfg.bg, cfg.color)}>
                          <Icon className="w-4 h-4" />
                        </div>
                        
                        {isEditing ? (
                          <div className="flex-1 space-y-2">
                            <input
                              type="text"
                              value={bookmark.name}
                              onChange={(e) => handleUpdate(bookmark.id, { name: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-[13px] bg-theme-bg border border-theme/20 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/50"
                              placeholder="Name"
                              autoFocus
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-3 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 rounded-lg transition-colors"
                              >
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold text-theme-fg truncate">{bookmark.name}</div>
                              <div className="text-[10px] text-theme-muted truncate">{cfg.label}</div>
                            </div>
                            <div className="flex items-center gap-0.5">
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
                  <div className="text-[10px] font-bold uppercase tracking-wider text-theme-muted mb-2 px-1">Quick Add</div>
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
                  <div className="text-[11px] font-bold uppercase tracking-wider text-theme-muted mb-2">Select Canvas</div>
                  <button
                    onClick={() => setNewBookmark({ ...newBookmark, target: '_new', name: newBookmark.name || 'New Canvas' })}
                    className={clsx(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left mb-2",
                      newBookmark.target === '_new' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                    )}
                  >
                    <Plus className={clsx("w-4 h-4", newBookmark.target === '_new' ? "text-primary" : "text-pink-500")} />
                    <span className="text-[13px] font-medium text-theme-fg">Open Canvas (New)</span>
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
                          <Layout className={clsx("w-4 h-4", newBookmark.target === d.id ? "text-primary" : "text-pink-500")} />
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
                    onClick={() => setNewBookmark({ ...newBookmark, target: '_open', name: newBookmark.name || 'Open Spaces' })}
                    className={clsx(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
                      newBookmark.target === '_open' ? "bg-primary/15 ring-1 ring-primary/40" : "bg-theme-hover/40 hover:bg-theme-hover"
                    )}
                  >
                    <MessageSquare className={clsx("w-4 h-4", newBookmark.target === '_open' ? "text-primary" : "text-cyan-500")} />
                    <span className="text-[13px] font-medium text-theme-fg">Open Spaces Sidebar</span>
                    {newBookmark.target === '_open' && <Check className="w-4 h-4 text-primary ml-auto" />}
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

              {/* URL input */}
              {selectedType === 'url' && (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newBookmark.target || ''}
                    onChange={(e) => setNewBookmark({ ...newBookmark, target: e.target.value })}
                    className="w-full px-3 py-2.5 text-[13px] bg-theme-bg border border-theme/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
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
                  className="w-full px-3 py-2.5 text-[13px] bg-theme-bg border border-theme/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="My Shortcut"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-theme/10 flex justify-end gap-2">
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
                disabled={!newBookmark.name || (!newBookmark.target && selectedType !== 'space' && selectedType !== 'canvas')}
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
