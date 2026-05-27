/**
 * WorkflowSidebar - VS Code-style explorer sidebar
 */
import React, { useState, useMemo, useCallback } from "react";
import { Plus, ChevronLeft, ChevronRight, ChevronDown, Home, Upload, Grid, Trash2, Search, Zap, ArrowUpCircle, Bell, Lock, Globe, FolderPlus, Folder, FolderOpen, Pencil, Play, MoreHorizontal } from "lucide-react";
import type { MarketplaceUpdate } from "../../utils/cloud";

interface WorkflowItem {
  id: string;
  name?: string;
  marketplaceSlug?: string;
  locked?: boolean;
  version?: string;
  folder?: string;
}

interface WorkflowSidebarProps {
  items: WorkflowItem[];
  folders: string[];
  loading: boolean;
  selectedId: string;
  runningIds: Record<string, boolean>;
  sidebarCollapsed: boolean;
  credits: { remaining: number; limit: number; plan: string } | null;
  updates?: Record<string, MarketplaceUpdate>;
  onToggleCollapse: () => void;
  onCreate: () => void;
  onImport: () => void;
  onMarketplace: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onUpdate?: (id: string, update: MarketplaceUpdate) => void;
  onDashboard: () => void;
  onCreateFolder?: () => void;
  onRenameFolder?: (oldName: string, newName: string) => void;
  onDeleteFolder?: (name: string) => void;
  onMoveToFolder?: (id: string, folder: string | null) => void;
}

export function WorkflowSidebar({
  items, folders, loading, selectedId, runningIds, sidebarCollapsed, credits, updates,
  onToggleCollapse, onCreate, onImport, onMarketplace, onSelect, onDelete, onUpdate, onDashboard,
  onCreateFolder, onRenameFolder, onDeleteFolder, onMoveToFolder
}: WorkflowSidebarProps) {
  const [search, setSearch] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [folderMenu, setFolderMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  const filteredItems = items.filter(i =>
    (i.name || i.id).toLowerCase().includes(search.toLowerCase())
  );

  const { rootItems, folderItems } = useMemo(() => {
    const root: WorkflowItem[] = [];
    const byFolder: Record<string, WorkflowItem[]> = {};
    for (const item of filteredItems) {
      if (item.folder) {
        if (!byFolder[item.folder]) byFolder[item.folder] = [];
        byFolder[item.folder].push(item);
      } else {
        root.push(item);
      }
    }
    return { rootItems: root, folderItems: byFolder };
  }, [filteredItems]);

  const toggleFolder = useCallback((name: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const updateCount = useMemo(() => {
    if (!updates) return 0;
    return items.filter(i => i.marketplaceSlug && updates[i.marketplaceSlug]).length;
  }, [items, updates]);

  const handleDragStart = useCallback((e: React.DragEvent, itemId: string) => {
    e.dataTransfer.setData('workflow-id', itemId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleFolderDrop = useCallback((e: React.DragEvent, folder: string | null) => {
    e.preventDefault();
    setDragOverFolder(null);
    const wfId = e.dataTransfer.getData('workflow-id');
    if (wfId && onMoveToFolder) onMoveToFolder(wfId, folder);
  }, [onMoveToFolder]);

  const renderWorkflowItem = (i: WorkflowItem, depth: number = 0) => {
    const update = i.marketplaceSlug ? updates?.[i.marketplaceSlug] : undefined;
    const hasUpdate = !!update;
    const isSelected = selectedId === i.id;
    const isRunning = runningIds[i.id];

    return (
      <div
        key={i.id}
        draggable
        onDragStart={(e) => handleDragStart(e, i.id)}
        onClick={() => onSelect(i.id)}
        className={`group flex items-center gap-2 py-[5px] pr-2 cursor-pointer transition-colors relative ${
          isSelected
            ? 'bg-[#04395e] text-white'
            : 'text-slate-600 hover:bg-slate-100/80'
        }`}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
      >
        {/* Running indicator */}
        {isRunning && (
          <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
        )}

        {/* Workflow icon */}
        <Zap className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-blue-300' : hasUpdate ? 'text-blue-500' : 'text-slate-400'}`} />

        {/* Name */}
        <span className={`flex-1 truncate text-[12px] ${isSelected ? 'text-white font-medium' : 'text-slate-700/80'}`}>
          {i.name || i.id}
        </span>

        {/* Badges */}
        {i.locked && <Lock className="w-3 h-3 text-amber-500 shrink-0" />}
        {i.marketplaceSlug && !i.locked && <Globe className="w-3 h-3 shrink-0 opacity-40" />}

        {/* Update badge */}
        {hasUpdate && (
          <button
            onClick={(e) => { e.stopPropagation(); onUpdate?.(i.id, update); }}
            className="p-0.5 rounded text-blue-500 hover:text-blue-600 hover:bg-blue-50 transition-all"
            title={`Update to v${update.latestVersion}`}
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Delete (on hover) */}
        <button
          onClick={async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete "${i.name || i.id}"?`)) return;
            await onDelete(i.id);
          }}
          className={`p-0.5 rounded transition-all shrink-0 ${
            isSelected ? 'text-slate-500 hover:text-slate-900 hover:bg-white/10' : 'text-transparent group-hover:text-slate-400 hover:!text-red-500 hover:!bg-red-50'
          }`}
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    );
  };

  // --- Collapsed state ---
  if (sidebarCollapsed) {
    return (
      <aside className="w-12 bg-white border-r border-theme-sidebar flex flex-col items-center py-3 gap-3 shrink-0 z-20">
        <button onClick={onToggleCollapse} className="p-2 text-slate-400 hover:text-slate-700/80 hover:bg-slate-100 rounded-lg transition-all" title="Expand">
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="w-6 h-px bg-[color:var(--border)]" />
<button onClick={onCreate} className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm transition-all" title="New Flow">
          <Plus className="w-4 h-4" />
        </button>
        <button onClick={onMarketplace} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Store">
          <Grid className="w-4 h-4" />
        </button>
        <div className="flex-1" />
        <button onClick={onDashboard} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" title="Dashboard">
          <Home className="w-4 h-4" />
        </button>
      </aside>
    );
  }

  // --- Expanded state ---
  return (
    <aside className="w-[260px] bg-white border-r border-theme-sidebar flex flex-col h-full shrink-0 z-20" data-onboarding="workflow-sidebar">
      {/* Header */}
      <div className="h-10 px-3 border-b border-theme-sidebar flex items-center justify-between shrink-0">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button onClick={onCreateFolder} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors" title="New Folder">
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button onClick={onCreate} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="New Flow">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button onClick={onToggleCollapse} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors" title="Collapse">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 border border-theme focus:border-blue-400 rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-slate-700/80 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all"
          />
        </div>
      </div>

      {/* Action buttons row */}
      <div className="px-2 pb-2 flex gap-1.5">
        <button onClick={onCreate} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-medium rounded-lg shadow-sm transition-all">
          <Plus className="w-3 h-3" /> New
        </button>
        <button onClick={onImport} className="px-3 py-1.5 bg-slate-50 hover:bg-slate-200 text-slate-600 text-[11px] font-medium rounded-lg transition-colors">
          <Upload className="w-3 h-3" />
        </button>
        <button onClick={onMarketplace} className="px-3 py-1.5 bg-slate-50 hover:bg-blue-100 text-slate-600 hover:text-blue-700 text-[11px] font-medium rounded-lg transition-colors">
          <Grid className="w-3 h-3" />
        </button>
      </div>

      {/* Update banner */}
      {updateCount > 0 && (
<div className="mx-2 mb-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="text-[11px] font-medium text-blue-700">{updateCount} update{updateCount !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Tree section header */}
      <div className="px-3 py-1 flex items-center gap-1.5 border-t border-theme-sidebar">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex-1">Workflows</span>
        <span className="text-[10px] text-slate-400 tabular-nums">{items.length}</span>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto scrollbar-minimal pb-2">
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-5 h-5 border-2 border-theme-sidebar border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : filteredItems.length === 0 && folders.length === 0 ? (
          <div className="py-8 text-center px-4">
            <Search className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-[12px] text-slate-400">No workflows found</p>
          </div>
        ) : (
          <>
            {/* Folders */}
            {folders.map(folderName => {
              const isCollapsed = collapsedFolders.has(folderName);
              const folderWorkflows = folderItems[folderName] || [];
              const isDragOver = dragOverFolder === folderName;
              return (
                <div key={`folder-${folderName}`}>
                  <div
                    className={`flex items-center gap-1.5 py-[5px] px-3 cursor-pointer transition-all select-none ${
                      isDragOver ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => toggleFolder(folderName)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverFolder(folderName); }}
                    onDragLeave={() => setDragOverFolder(null)}
                    onDrop={(e) => handleFolderDrop(e, folderName)}
                    onContextMenu={(e) => { e.preventDefault(); setFolderMenu({ name: folderName, x: e.clientX, y: e.clientY }); }}
                  >
                    <ChevronRight className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`} />
                    {isCollapsed
                      ? <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      : <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    }
                    <span className="text-[12px] font-medium text-slate-700/80 flex-1 truncate">{folderName}</span>
                    <span className="text-[10px] text-slate-400">{folderWorkflows.length}</span>
                  </div>
                  {!isCollapsed && (
                    <div>
                      {folderWorkflows.map(i => renderWorkflowItem(i, 1))}
                      {folderWorkflows.length === 0 && (
                        <div className="py-1 pl-10 text-[11px] text-slate-400 italic">Empty</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Root items */}
            {rootItems.length > 0 && folders.length > 0 && (
              <div
                className={`px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1 transition-all ${
                  dragOverFolder === '__root__' ? 'bg-blue-50' : ''
                }`}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverFolder('__root__'); }}
                onDragLeave={() => setDragOverFolder(null)}
                onDrop={(e) => handleFolderDrop(e, null)}
              >
                Unfiled
              </div>
            )}
            {rootItems.map(i => renderWorkflowItem(i, 0))}
          </>
        )}
      </div>

      {/* Folder Context Menu */}
      {folderMenu && (
        <div className="fixed inset-0 z-[100]" onClick={() => setFolderMenu(null)}>
          <div
            className="absolute bg-white rounded-lg shadow-xl border border-theme py-1 min-w-[150px]"
            style={{ top: Math.min(folderMenu.y, window.innerHeight - 100), left: Math.min(folderMenu.x, window.innerWidth - 170) }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const newName = prompt('Rename folder:', folderMenu.name);
                if (newName && newName.trim() && newName.trim() !== folderMenu.name) onRenameFolder?.(folderMenu.name, newName.trim());
                setFolderMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-slate-700/80 hover:bg-slate-50 flex items-center gap-2"
            >
              <Pencil className="w-3 h-3 text-slate-400" /> Rename
            </button>
            <div className="h-px bg-[color:var(--border)] my-0.5" />
            <button
              onClick={() => {
                if (confirm(`Delete "${folderMenu.name}"? Items will move to root.`)) onDeleteFolder?.(folderMenu.name);
                setFolderMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-theme-sidebar bg-white">
        {credits && (
          <div className="px-3 py-2">
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
              <span className="font-medium">Credits</span>
              <span className={credits.remaining < 10 ? "text-amber-500 font-medium" : ""}>{credits.remaining}/{credits.limit}</span>
            </div>
            <div className="w-full h-1 bg-slate-50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${credits.remaining < 10 ? 'bg-amber-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(100, (credits.remaining / Math.max(1, credits.limit)) * 100)}%` }}
              />
            </div>
          </div>
        )}
        <button
          onClick={onDashboard}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700/80 text-[11px] font-medium transition-colors"
        >
          <Home className="w-3.5 h-3.5" /> Dashboard
        </button>
      </div>
    </aside>
  );
}

