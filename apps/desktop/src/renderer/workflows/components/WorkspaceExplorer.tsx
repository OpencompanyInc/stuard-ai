/**
 * WorkspaceExplorer - File tree + reference panel for workflow workspaces
 * Supports CRUD, rename, move (drag-drop), .stuard sub-workflows,
 * export/import references, and folder-level create actions.
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  FolderOpen, FolderClosed, File, Plus, Trash2, ChevronRight, ChevronDown,
  Copy, FolderPlus, FileText, RefreshCw, ExternalLink,
  Variable, Braces, Hash, ToggleLeft, List, Code2, X, Check,
  Pencil, ArrowRight, Workflow, MoreHorizontal, GripVertical,
  Upload, Download, Play, Search, Music, Video, Image
} from "lucide-react";
import type { WorkspaceFileEntry } from "../types";
import type { WorkspaceInfo } from "../hooks/useWorkflowOperations";
import type { WorkflowVariable } from "../types";

interface WorkspaceExplorerProps {
  flowId: string;
  workspaceInfo: WorkspaceInfo | null;
  variables?: WorkflowVariable[];
  onRefresh: () => void;
  onClose: () => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  onOpenStuard?: (subPath: string) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function fileIcon(name: string, isMain?: boolean) {
  if (isMain) return <Workflow className="w-3.5 h-3.5 text-emerald-500" />;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'stuard') return <Workflow className="w-3.5 h-3.5 text-indigo-500" />;
  if (['py'].includes(ext)) return <Code2 className="w-3.5 h-3.5 text-yellow-500" />;
  if (['js', 'ts', 'mjs'].includes(ext)) return <Code2 className="w-3.5 h-3.5 text-blue-400" />;
  if (['json'].includes(ext)) return <Braces className="w-3.5 h-3.5 text-emerald-500" />;
  if (['txt', 'md', 'csv', 'log'].includes(ext)) return <FileText className="w-3.5 h-3.5 text-slate-400" />;
  // Media files with distinct icons
  if (['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus'].includes(ext)) return <Music className="w-3.5 h-3.5 text-purple-400" />;
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'm4v', 'ogv'].includes(ext)) return <Video className="w-3.5 h-3.5 text-pink-500" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'avif'].includes(ext)) return <Image className="w-3.5 h-3.5 text-cyan-400" />;
  return <File className="w-3.5 h-3.5 text-slate-400" />;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function varTypeIcon(type: string) {
  switch (type) {
    case 'string': return <FileText className="w-3 h-3" />;
    case 'number': return <Hash className="w-3 h-3" />;
    case 'boolean': return <ToggleLeft className="w-3 h-3" />;
    case 'list': return <List className="w-3 h-3" />;
    case 'json': return <Braces className="w-3 h-3" />;
    default: return <Variable className="w-3 h-3" />;
  }
}

// ─── Copyable Reference Pill ───────────────────────────────────────────────
function RefPill({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded text-[11px] font-mono text-slate-600 hover:text-indigo-700 transition-all group"
      title={`Click to copy: ${value}`}
    >
      <span className="truncate max-w-[180px]">{label || value}</span>
      <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      {copied && <span className="text-emerald-600 text-[9px] font-sans ml-0.5">✓</span>}
    </button>
  );
}

// ─── Inline Rename Input ───────────────────────────────────────────────────
function InlineRename({ currentName, onConfirm, onCancel }: {
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.select(); }, []);

  return (
    <input
      ref={inputRef}
      autoFocus
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && value.trim() && value.trim() !== currentName) onConfirm(value.trim());
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => {
        if (value.trim() && value.trim() !== currentName) onConfirm(value.trim());
        else onCancel();
      }}
      className="flex-1 px-1 py-0 text-xs bg-white border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 min-w-0"
      onClick={e => e.stopPropagation()}
    />
  );
}

// ─── Context Menu ───────────────────────────────────────────────────────────
interface ContextMenuState {
  x: number;
  y: number;
  entry: WorkspaceFileEntry;
}

function ContextMenu({ state, flowId, onRefresh, onOpenFile, onOpenStuard, onClose, onStartRename, onStartCreateIn }: {
  state: ContextMenuState;
  flowId: string;
  onRefresh: () => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  onOpenStuard?: (subPath: string) => void;
  onClose: () => void;
  onStartRename: (path: string) => void;
  onStartCreateIn: (folderPath: string, type: 'file' | 'folder' | 'stuard') => void;
}) {
  const { entry } = state;
  const isStuard = entry.name.endsWith('.stuard');
  const isMainStuard = entry.name === 'main.stuard';
  const isDir = entry.type === 'directory';

  const handleOpen = useCallback(() => {
    onClose();
    if (isStuard && onOpenStuard) onOpenStuard(entry.path);
    else if (onOpenFile) onOpenFile(entry.path, entry.name);
  }, [entry, isStuard, onOpenFile, onOpenStuard, onClose]);

  const handleRename = useCallback(() => {
    onClose();
    onStartRename(entry.path);
  }, [entry.path, onClose, onStartRename]);

  const handleMoveTo = useCallback(async () => {
    onClose();
    const dest = prompt(`Move "${entry.name}" to folder (empty for root):`, '');
    if (dest === null) return;
    await (window as any).desktopAPI?.workflowsMoveWorkspaceFile?.(flowId, entry.path, dest);
    onRefresh();
  }, [flowId, entry, onRefresh, onClose]);

  const handleDelete = useCallback(async () => {
    onClose();
    if (!confirm(`Delete "${entry.name}"?`)) return;
    await (window as any).desktopAPI?.workflowsDeleteWorkspaceFile?.(flowId, entry.path);
    onRefresh();
  }, [flowId, entry, onRefresh, onClose]);

  const handleCopyRef = useCallback(() => {
    if (isStuard && !isMainStuard) {
      navigator.clipboard.writeText(entry.path);
    } else {
      navigator.clipboard.writeText(`{{$workspace.file.${entry.path.replace(/\//g, '.')}}}`);
    }
    onClose();
  }, [entry.path, isStuard, isMainStuard, onClose]);

  type MenuItem = { label: string; icon: any; action: () => void; danger?: boolean; sep?: boolean; accent?: string };
  const items: MenuItem[] = [];

  // File open actions
  if (entry.type === 'file') {
    if (isMainStuard) {
      items.push({ label: 'Open Main Canvas', icon: Play, action: handleOpen, accent: 'text-emerald-600' });
    } else if (isStuard) {
      items.push({ label: 'Open Sub-Workflow', icon: Workflow, action: handleOpen, accent: 'text-indigo-600' });
    } else {
      items.push({ label: 'Open in Editor', icon: FileText, action: handleOpen });
    }
  }

  // Folder create actions
  if (isDir) {
    items.push({ label: 'New Sub-Workflow', icon: Workflow, action: () => { onClose(); onStartCreateIn(entry.path, 'stuard'); }, accent: 'text-indigo-600' });
    items.push({ label: 'New File', icon: Plus, action: () => { onClose(); onStartCreateIn(entry.path, 'file'); } });
    items.push({ label: 'New Folder', icon: FolderPlus, action: () => { onClose(); onStartCreateIn(entry.path, 'folder'); } });
    items.push({ label: '', icon: null, action: () => {}, sep: true });
  }

  // Common actions
  if (!isMainStuard) {
    items.push({ label: 'Rename', icon: Pencil, action: handleRename });
    items.push({ label: 'Move to...', icon: ArrowRight, action: handleMoveTo });
  }
  if (entry.type === 'file') {
    items.push({ label: isStuard && !isMainStuard ? 'Copy Call Path' : 'Copy Reference', icon: Copy, action: handleCopyRef });
  }
  if (!isMainStuard) {
    items.push({ label: 'Delete', icon: Trash2, action: handleDelete, danger: true, sep: true });
  }

  return (
    <div
      className="fixed z-50 bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: state.x, top: state.y }}
      onClick={e => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.sep && !item.label) return <div key={i} className="my-1 border-t border-slate-100" />;
        return (
          <React.Fragment key={i}>
            {item.sep && item.label && <div className="my-1 border-t border-slate-100" />}
            <button
              onClick={item.action}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
                item.danger
                  ? 'text-red-600 hover:bg-red-50'
                  : item.accent
                    ? `${item.accent} hover:bg-slate-50 font-medium`
                    : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              {item.icon && <item.icon className="w-3.5 h-3.5 shrink-0" />}
              {item.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Inline Create Input (inside a folder) ─────────────────────────────────
function InlineCreate({ type, folderPath, flowId, onDone }: {
  type: 'file' | 'folder' | 'stuard';
  folderPath: string;
  flowId: string;
  onDone: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const placeholder = type === 'stuard' ? 'sub-workflow name' : type === 'folder' ? 'folder name' : 'file name';
  const icon = type === 'stuard' ? <Workflow className="w-3 h-3 text-indigo-500" /> : type === 'folder' ? <FolderPlus className="w-3 h-3 text-amber-500" /> : <Plus className="w-3 h-3 text-slate-400" />;

  const handleConfirm = useCallback(async () => {
    if (!value.trim()) { onDone(); return; }
    const fullPath = folderPath ? `${folderPath}/${value.trim()}` : value.trim();
    if (type === 'stuard') {
      await (window as any).desktopAPI?.workflowsCreateWorkspaceStuard?.(flowId, fullPath);
    } else if (type === 'folder') {
      await (window as any).desktopAPI?.workflowsCreateWorkspaceSubdir?.(flowId, fullPath);
    } else {
      await (window as any).desktopAPI?.workflowsWriteWorkspaceFile?.(flowId, fullPath, '');
    }
    onDone();
  }, [value, folderPath, flowId, type, onDone]);

  return (
    <div className="flex items-center gap-1 px-2 py-0.5">
      {icon}
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); if (e.key === 'Escape') onDone(); }}
        onBlur={handleConfirm}
        placeholder={placeholder}
        className="flex-1 px-1 py-0.5 text-xs bg-white border border-slate-200 rounded focus:border-indigo-400 focus:outline-none min-w-0"
        onClick={e => e.stopPropagation()}
      />
    </div>
  );
}

// ─── File Tree Node ────────────────────────────────────────────────────────
function FileTreeNode({
  entry, files, flowId, onRefresh, onOpenFile, onOpenStuard,
  onContextMenu, dragOverPath, onDragStart, onDragOver, onDrop,
  renamingPath, onStartRename, onConfirmRename, onCancelRename,
  inlineCreate, depth = 0
}: {
  entry: WorkspaceFileEntry;
  files: WorkspaceFileEntry[];
  flowId: string;
  onRefresh: () => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  onOpenStuard?: (subPath: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: WorkspaceFileEntry) => void;
  dragOverPath: string | null;
  onDragStart: (e: React.DragEvent, entry: WorkspaceFileEntry) => void;
  onDragOver: (e: React.DragEvent, entry: WorkspaceFileEntry) => void;
  onDrop: (e: React.DragEvent, targetDir: string) => void;
  renamingPath: string | null;
  onStartRename: (path: string) => void;
  onConfirmRename: (oldPath: string, newName: string) => void;
  onCancelRename: () => void;
  inlineCreate: { folderPath: string; type: 'file' | 'folder' | 'stuard' } | null;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  const children = useMemo(() => {
    if (entry.type !== 'directory') return [];
    const prefix = entry.path + '/';
    return files.filter(f => {
      if (!f.path.startsWith(prefix)) return false;
      const rest = f.path.slice(prefix.length);
      return !rest.includes('/');
    }).sort((a, b) => {
      // Folders first, then files, alphabetical within each
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [entry.path, files]);

  const isStuard = entry.name.endsWith('.stuard') && entry.name !== 'main.stuard';
  const isMainStuard = entry.name === 'main.stuard';
  const isDragOver = dragOverPath === entry.path && entry.type === 'directory';
  const isRenaming = renamingPath === entry.path;
  const showInlineCreate = inlineCreate && inlineCreate.folderPath === entry.path;

  // Auto-expand folder when creating inside it
  useEffect(() => {
    if (showInlineCreate && !expanded) setExpanded(true);
  }, [showInlineCreate]);

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-[3px] cursor-pointer rounded-sm transition-colors group ${
          isDragOver ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'
        } ${isStuard ? 'hover:bg-indigo-50/50' : ''} ${isMainStuard ? 'hover:bg-emerald-50/50' : ''}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        draggable={!isMainStuard && !isRenaming}
        onDragStart={e => onDragStart(e, entry)}
        onDragOver={e => { if (entry.type === 'directory') onDragOver(e, entry); }}
        onDrop={e => { if (entry.type === 'directory') onDrop(e, entry.path); }}
        onContextMenu={e => onContextMenu(e, entry)}
        onClick={() => {
          if (isRenaming) return;
          if (entry.type === 'directory') setExpanded(!expanded);
          else if (isStuard && onOpenStuard) onOpenStuard(entry.path);
          else if (isMainStuard && onOpenStuard) onOpenStuard('main.stuard');
          else if (onOpenFile) onOpenFile(entry.path, entry.name);
        }}
      >
        {/* Expand/collapse or drag handle */}
        {entry.type === 'directory' ? (
          <>
            {expanded ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
            {expanded ? <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <FolderClosed className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
          </>
        ) : (
          <>
            <GripVertical className="w-3 h-3 text-slate-300 shrink-0 opacity-0 group-hover:opacity-100 cursor-grab" />
            {fileIcon(entry.name, isMainStuard)}
          </>
        )}

        {/* Name or inline rename */}
        {isRenaming ? (
          <InlineRename
            currentName={entry.name}
            onConfirm={(newName) => onConfirmRename(entry.path, newName)}
            onCancel={onCancelRename}
          />
        ) : (
          <span className={`text-xs truncate flex-1 ${
            isMainStuard ? 'text-emerald-700 font-semibold' :
            isStuard ? 'text-indigo-700 font-medium' :
            'text-slate-700'
          }`}>
            {entry.name}
            {isStuard && (
              <span className="inline-flex items-center ml-1.5 px-1 py-0 text-[8px] font-bold bg-indigo-100 text-indigo-500 rounded">fn</span>
            )}
            {isMainStuard && (
              <span className="inline-flex items-center ml-1.5 px-1 py-0 text-[8px] font-bold bg-emerald-100 text-emerald-600 rounded">main</span>
            )}
          </span>
        )}

        {/* Size for non-stuard files */}
        {!isRenaming && entry.size !== undefined && !isStuard && !isMainStuard && (
          <span className="text-[10px] text-slate-400 shrink-0">{formatSize(entry.size)}</span>
        )}

        {/* Actions button */}
        {!isRenaming && (
          <button
            onClick={(e) => { e.stopPropagation(); onContextMenu(e, entry); }}
            className="p-0.5 text-slate-300 hover:text-slate-600 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            title="Actions"
          >
            <MoreHorizontal className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Children + inline create */}
      {entry.type === 'directory' && expanded && (
        <>
          {children.map(child => (
            <FileTreeNode
              key={child.path}
              entry={child}
              files={files}
              flowId={flowId}
              onRefresh={onRefresh}
              onOpenFile={onOpenFile}
              onOpenStuard={onOpenStuard}
              onContextMenu={onContextMenu}
              dragOverPath={dragOverPath}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              renamingPath={renamingPath}
              onStartRename={onStartRename}
              onConfirmRename={onConfirmRename}
              onCancelRename={onCancelRename}
              inlineCreate={inlineCreate}
              depth={depth + 1}
            />
          ))}
          {showInlineCreate && (
            <div style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}>
              <InlineCreate
                type={inlineCreate!.type}
                folderPath={entry.path}
                flowId={flowId}
                onDone={() => { onCancelRename(); onRefresh(); }}
              />
            </div>
          )}
          {children.length === 0 && !showInlineCreate && (
            <div style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }} className="text-[10px] text-slate-300 italic py-0.5">
              empty
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export function WorkspaceExplorer({ flowId, workspaceInfo, variables, onRefresh, onClose, onOpenFile, onOpenStuard }: WorkspaceExplorerProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'references'>('files');
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showNewSubdir, setShowNewSubdir] = useState(false);
  const [newSubdir, setNewSubdir] = useState('');
  const [showNewStuard, setShowNewStuard] = useState(false);
  const [newStuardPath, setNewStuardPath] = useState('');

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Inline rename
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  // Inline create inside a folder (from context menu)
  const [inlineCreate, setInlineCreate] = useState<{ folderPath: string; type: 'file' | 'folder' | 'stuard' } | null>(null);

  // Drag & drop
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const dragEntryRef = useRef<WorkspaceFileEntry | null>(null);

  // Workspace functions (loaded async for references tab)
  const [wsFunctions, setWsFunctions] = useState<any[]>([]);
  const loadFunctions = useCallback(async () => {
    if (!flowId) return;
    try {
      const res = await (window as any).desktopAPI?.workflowsListWorkspaceFunctions?.(flowId);
      if (res?.ok) setWsFunctions(res.functions || []);
    } catch {}
  }, [flowId]);

  useEffect(() => { if (activeTab === 'references') loadFunctions(); }, [activeTab, loadFunctions]);

  // Build root-level entries, sorted: main.stuard first, then folders, then files
  const rootEntries = useMemo(() => {
    if (!workspaceInfo?.files) return [];
    return workspaceInfo.files
      .filter(f => !f.path.includes('/'))
      .sort((a, b) => {
        if (a.name === 'main.stuard') return -1;
        if (b.name === 'main.stuard') return 1;
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
  }, [workspaceInfo?.files]);

  const handleCreateFile = useCallback(async () => {
    if (!newFileName.trim()) return;
    await (window as any).desktopAPI?.workflowsWriteWorkspaceFile?.(flowId, newFileName.trim(), '');
    setNewFileName(''); setShowNewFile(false); onRefresh();
  }, [flowId, newFileName, onRefresh]);

  const handleCreateSubdir = useCallback(async () => {
    if (!newSubdir.trim()) return;
    await (window as any).desktopAPI?.workflowsCreateWorkspaceSubdir?.(flowId, newSubdir.trim());
    setNewSubdir(''); setShowNewSubdir(false); onRefresh();
  }, [flowId, newSubdir, onRefresh]);

  const handleCreateStuard = useCallback(async () => {
    if (!newStuardPath.trim()) return;
    const res = await (window as any).desktopAPI?.workflowsCreateWorkspaceStuard?.(flowId, newStuardPath.trim());
    setNewStuardPath(''); setShowNewStuard(false); onRefresh();
    if (res?.ok && res.path && onOpenStuard) {
      setTimeout(() => onOpenStuard(res.path), 200);
    }
  }, [flowId, newStuardPath, onRefresh, onOpenStuard]);

  const handleOpenInExplorer = useCallback(async () => {
    if (workspaceInfo?.workspacePath) {
      await (window as any).desktopAPI?.showItemInFolder?.(workspaceInfo.workspacePath);
    }
  }, [workspaceInfo?.workspacePath]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: WorkspaceFileEntry) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleConfirmRename = useCallback(async (oldPath: string, newName: string) => {
    await (window as any).desktopAPI?.workflowsRenameWorkspaceFile?.(flowId, oldPath, newName);
    setRenamingPath(null); onRefresh();
  }, [flowId, onRefresh]);

  const handleDragStart = useCallback((e: React.DragEvent, entry: WorkspaceFileEntry) => {
    dragEntryRef.current = entry;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', entry.path);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, entry: WorkspaceFileEntry) => {
    if (entry.type !== 'directory') return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverPath(entry.path);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault(); setDragOverPath(null);
    const dragEntry = dragEntryRef.current;
    if (!dragEntry) return;
    dragEntryRef.current = null;
    if (dragEntry.path === targetDir) return;
    const parentDir = dragEntry.path.includes('/') ? dragEntry.path.split('/').slice(0, -1).join('/') : '';
    if (parentDir === targetDir) return;
    await (window as any).desktopAPI?.workflowsMoveWorkspaceFile?.(flowId, dragEntry.path, targetDir);
    onRefresh();
  }, [flowId, onRefresh]);

  const handleRootDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setDragOverPath(null);
    const dragEntry = dragEntryRef.current;
    if (!dragEntry) return;
    dragEntryRef.current = null;
    if (!dragEntry.path.includes('/')) return;
    await (window as any).desktopAPI?.workflowsMoveWorkspaceFile?.(flowId, dragEntry.path, '');
    onRefresh();
  }, [flowId, onRefresh]);

  return (
    <div className="flex flex-col h-full bg-white" onClick={() => { setContextMenu(null); }}>
      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          flowId={flowId}
          onRefresh={onRefresh}
          onOpenFile={onOpenFile}
          onOpenStuard={onOpenStuard}
          onClose={() => setContextMenu(null)}
          onStartRename={(path) => setRenamingPath(path)}
          onStartCreateIn={(folderPath, type) => setInlineCreate({ folderPath, type })}
        />
      )}

      {/* Header */}
      <div className="h-10 px-3 border-b border-slate-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-semibold text-slate-700">Project Files</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={onRefresh} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleOpenInExplorer} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors" title="Open in File Explorer">
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 shrink-0">
        <button
          onClick={() => setActiveTab('files')}
          className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${activeTab === 'files' ? 'text-slate-800 border-b-2 border-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Files
        </button>
        <button
          onClick={() => setActiveTab('references')}
          className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${activeTab === 'references' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Imports & Refs
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'files' && (
          <div
            className="py-1"
            onDragOver={e => { e.preventDefault(); setDragOverPath('__root__'); }}
            onDragLeave={() => setDragOverPath(null)}
            onDrop={handleRootDrop}
          >
            {!workspaceInfo ? (
              <div className="px-3 py-6 text-center">
                <FolderOpen className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">No workspace available</p>
                <p className="text-[10px] text-slate-300 mt-1">Save your workflow to create a workspace</p>
              </div>
            ) : (
              <>
                {rootEntries.map(entry => (
                  <FileTreeNode
                    key={entry.path}
                    entry={entry}
                    files={workspaceInfo.files}
                    flowId={flowId}
                    onRefresh={onRefresh}
                    onOpenFile={onOpenFile}
                    onOpenStuard={onOpenStuard}
                    onContextMenu={handleContextMenu}
                    dragOverPath={dragOverPath}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    renamingPath={renamingPath}
                    onStartRename={setRenamingPath}
                    onConfirmRename={handleConfirmRename}
                    onCancelRename={() => { setRenamingPath(null); setInlineCreate(null); }}
                    inlineCreate={inlineCreate}
                  />
                ))}

                {/* Root-level inline create */}
                {inlineCreate && !inlineCreate.folderPath && (
                  <div className="px-2">
                    <InlineCreate
                      type={inlineCreate.type}
                      folderPath=""
                      flowId={flowId}
                      onDone={() => { setInlineCreate(null); onRefresh(); }}
                    />
                  </div>
                )}

                {rootEntries.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">
                    Empty workspace
                  </div>
                )}

                {/* Quick Actions Bar */}
                <div className="px-2 pt-2 pb-1 space-y-1 border-t border-slate-50 mt-1">
                  {showNewStuard ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={newStuardPath}
                        onChange={e => setNewStuardPath(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateStuard(); if (e.key === 'Escape') setShowNewStuard(false); }}
                        placeholder="e.g. helpers/send-email"
                        className="flex-1 px-2 py-1 text-xs bg-white border border-indigo-200 rounded focus:border-indigo-400 focus:outline-none"
                      />
                      <button onClick={handleCreateStuard} className="px-2 py-1 text-[10px] font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700">
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewStuard(true)}
                      className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors font-medium"
                      title="Create a new sub-workflow that can be called from the main workflow"
                    >
                      <Workflow className="w-3 h-3" />
                      <span>New Sub-Workflow</span>
                    </button>
                  )}

                  {showNewFile ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={newFileName}
                        onChange={e => setNewFileName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateFile(); if (e.key === 'Escape') setShowNewFile(false); }}
                        placeholder="e.g. scripts/helper.py"
                        className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:border-indigo-400 focus:outline-none"
                      />
                      <button onClick={handleCreateFile} className="px-2 py-1 text-[10px] font-medium bg-slate-900 text-white rounded hover:bg-slate-800">
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewFile(true)}
                      className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New File</span>
                    </button>
                  )}

                  {showNewSubdir ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={newSubdir}
                        onChange={e => setNewSubdir(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateSubdir(); if (e.key === 'Escape') setShowNewSubdir(false); }}
                        placeholder="e.g. models"
                        className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:border-indigo-400 focus:outline-none"
                      />
                      <button onClick={handleCreateSubdir} className="px-2 py-1 text-[10px] font-medium bg-slate-900 text-white rounded hover:bg-slate-800">
                        <Check className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewSubdir(true)}
                      className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
                    >
                      <FolderPlus className="w-3 h-3" />
                      <span>New Folder</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'references' && (
          <div className="p-3 space-y-4">
            {/* Exported Functions (from sub-workflows) */}
            {wsFunctions.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-indigo-500" />
                  Exported Functions
                </h4>
                <p className="text-[10px] text-slate-400 mb-2">
                  Sub-workflows you can call from the main workflow. Click to copy the path.
                </p>
                <div className="space-y-2">
                  {wsFunctions.map((fn: any) => (
                    <div key={fn.path} className="bg-indigo-50/60 rounded-lg p-2 border border-indigo-100">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <Workflow className="w-3 h-3 text-indigo-500" />
                          <span className="text-[11px] font-semibold text-indigo-700">{fn.name}</span>
                          {fn.isFunction && <span className="text-[8px] bg-indigo-200 text-indigo-600 px-1 rounded font-bold">fn</span>}
                        </div>
                        <RefPill value={fn.path} label="copy path" />
                      </div>
                      {fn.description && (
                        <p className="text-[10px] text-slate-500 mb-1">{fn.description}</p>
                      )}
                      {fn.inputParams && fn.inputParams.length > 0 && (
                        <div className="mt-1">
                          <span className="text-[9px] font-bold text-slate-400 uppercase">Inputs:</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {fn.inputParams.map((p: any, i: number) => (
                              <span key={i} className="inline-flex items-center px-1.5 py-0 text-[10px] bg-white border border-slate-200 rounded text-slate-600">
                                {p.name}
                                {p.type && <span className="text-slate-400 ml-0.5">:{p.type}</span>}
                                {p.required && <span className="text-red-400 ml-0.5">*</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mt-1.5 flex gap-1">
                        <button
                          onClick={() => onOpenStuard?.(fn.path)}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-0.5"
                        >
                          <FileText className="w-2.5 h-2.5" /> Edit
                        </button>
                        <span className="text-slate-300">|</span>
                        <RefPill
                          value={`call_workspace_function(path="${fn.path}")`}
                          label="copy call"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 px-2 py-1.5 bg-indigo-50/50 rounded text-[10px] text-slate-500 leading-relaxed">
                  Add a <code className="text-indigo-600 font-medium">Call Workspace Function</code> node and set the path to call these.
                </div>
              </div>
            )}

            {/* How to Export */}
            {wsFunctions.length === 0 && (
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <h4 className="text-[11px] font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-indigo-400" />
                  Export Functions
                </h4>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Create sub-workflows to organize reusable logic, like components in React.
                  Each <code className="text-indigo-600">.stuard</code> file with a <strong>function trigger</strong> becomes a callable function.
                </p>
                <button
                  onClick={() => { setActiveTab('files'); setTimeout(() => setShowNewStuard(true), 100); }}
                  className="mt-2 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Create your first sub-workflow
                </button>
              </div>
            )}

            {/* Workspace Path References */}
            <div>
              <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                Import Paths
              </h4>
              <p className="text-[10px] text-slate-400 mb-1.5">Use these in any step to reference workspace paths.</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Root</span>
                  <RefPill value="{{$workspace.path}}" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Data</span>
                  <RefPill value="{{$workspace.data}}" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Scripts</span>
                  <RefPill value="{{$workspace.scripts}}" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Assets</span>
                  <RefPill value="{{$workspace.assets}}" />
                </div>
              </div>
            </div>

            {/* File References */}
            {workspaceInfo && workspaceInfo.files.filter(f => f.type === 'file' && !f.name.endsWith('.stuard')).length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  File References
                </h4>
                <p className="text-[10px] text-slate-400 mb-1.5">Click to copy file path references for use in steps.</p>
                <div className="space-y-1">
                  {workspaceInfo.files
                    .filter(f => f.type === 'file' && !f.name.endsWith('.stuard'))
                    .map(f => (
                      <div key={f.path} className="flex items-center justify-between">
                        <div className="flex items-center gap-1 min-w-0">
                          {fileIcon(f.name)}
                          <span className="text-[10px] text-slate-500 truncate">{f.path}</span>
                        </div>
                        <RefPill value={`{{$workspace.file.${f.path.replace(/\//g, '.')}}}`} label="copy" />
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Workflow Variables */}
            {variables && variables.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                  <Variable className="w-3.5 h-3.5 text-violet-500" />
                  Variables
                </h4>
                <div className="space-y-1.5">
                  {variables.map(v => (
                    <div key={v.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-slate-400 shrink-0">{varTypeIcon(v.type)}</span>
                        <span className="text-[10px] text-slate-600 truncate">{v.name}</span>
                      </div>
                      <RefPill value={`{{$vars.${v.name}}}`} label={v.name} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step Output References */}
            <div>
              <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <Braces className="w-3.5 h-3.5 text-emerald-500" />
                Step Outputs
              </h4>
              <div className="px-2 py-1.5 bg-slate-50 rounded text-[10px] text-slate-500 leading-relaxed space-y-1">
                <p>Reference any previous step's output:</p>
                <code className="block text-indigo-600">{"{{step_id.fieldName}}"}</code>
                <p className="mt-1">Common fields:</p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
                  <code className="text-indigo-600">.ok</code><span>Success boolean</span>
                  <code className="text-indigo-600">.text</code><span>Text output</span>
                  <code className="text-indigo-600">.result</code><span>Full result</span>
                  <code className="text-indigo-600">.stdout</code><span>Script output</span>
                  <code className="text-indigo-600">.filePath</code><span>File path</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
