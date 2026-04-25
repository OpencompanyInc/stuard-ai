import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  FolderOpen, Folder, File, FileText, Image, Film, Music, Archive, Code, Database,
  Upload, Download, Trash2, RefreshCw, Loader2, CheckCircle2, AlertCircle,
  ChevronRight, ChevronDown, Search, MoreVertical, Plus, X, Grid3X3, List,
  FolderPlus, Edit3, Copy, Move, Eye, ArrowUp, Home, SortAsc, SortDesc,
  HardDrive, Cloud, Clock, FolderInput, LayoutGrid, AlignJustify,
} from 'lucide-react';
import type { CloudFileEntry, UploadProgress, StorageInfo } from '../hooks/useStorage';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FileNode {
  name: string;        // just the segment name: "photo.jpg" or "docs"
  fullPath: string;    // full relative path: "docs/photo.jpg"
  isFolder: boolean;
  size: number;
  updated: string;
  contentType: string;
  children?: FileNode[];
}

type SortField = 'name' | 'size' | 'updated' | 'type';
type SortDir = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';

export interface FileExplorerProps {
  files: CloudFileEntry[];
  loading: boolean;
  fetchFiles: (prefix?: string) => void;
  uploading: boolean;
  uploadQueue: UploadProgress[];
  onUpload: (files: File[], folderPath?: string) => void;
  onDownload: (objectName: string) => void;
  onDelete: (objectName: string) => void;
  onCreateFolder: (path: string) => Promise<any>;
  onRename: (oldName: string, newName: string) => Promise<any>;
  info: StorageInfo | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 2592000_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return d.toLocaleDateString();
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getFileIcon(name: string): React.ComponentType<any> {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff'].includes(ext)) return Image;
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext)) return Film;
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a'].includes(ext)) return Music;
  if (['zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz'].includes(ext)) return Archive;
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'rb', 'sh', 'json', 'yaml', 'toml', 'xml', 'html', 'css', 'scss'].includes(ext)) return Code;
  if (['db', 'sqlite', 'sql'].includes(ext)) return Database;
  if (['md', 'txt', 'log', 'csv', 'pdf', 'doc', 'docx', 'rtf'].includes(ext)) return FileText;
  return File;
}

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'text-pink-400';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'text-purple-400';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return 'text-green-400';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'text-amber-400';
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs'].includes(ext)) return 'text-blue-400';
  if (['json', 'yaml', 'toml', 'xml'].includes(ext)) return 'text-cyan-400';
  if (['md', 'txt', 'log'].includes(ext)) return 'text-theme-muted';
  return 'text-theme-muted/60';
}

function extensionLabel(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase() || '';
  return ext || 'FILE';
}

/**
 * Build a folder-only tree from a flat list of object names.
 * Children are sorted alphabetically. File entries are not included.
 */
interface FolderTreeNode {
  name: string;
  fullPath: string;
  children: FolderTreeNode[];
}

function buildFolderTree(files: CloudFileEntry[]): FolderTreeNode[] {
  const root: FolderTreeNode = { name: '', fullPath: '', children: [] };

  const ensurePath = (segments: string[]): FolderTreeNode => {
    let node = root;
    for (let i = 0; i < segments.length; i++) {
      const part = segments[i];
      let next = node.children.find(c => c.name === part);
      if (!next) {
        next = {
          name: part,
          fullPath: segments.slice(0, i + 1).join('/'),
          children: [],
        };
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };

  for (const f of files) {
    const parts = f.name.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    const isFolderPlaceholder = f.name.endsWith('/') && f.size === 0;
    // Folders are: every parent path of a file, plus folder placeholders themselves.
    const folderDepth = isFolderPlaceholder ? parts.length : parts.length - 1;
    if (folderDepth > 0) ensurePath(parts.slice(0, folderDepth));
  }

  // Recursive sort
  const sortRec = (nodes: FolderTreeNode[]) => {
    nodes.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(root.children);

  return root.children;
}

/** Simpler approach: derive folders from the flat list for a given path. */
function getItemsAtPath(
  files: CloudFileEntry[],
  currentPath: string,
): { folders: FileNode[]; fileNodes: FileNode[] } {
  const prefix = currentPath ? currentPath + '/' : '';
  const folderSet = new Set<string>();
  const fileNodes: FileNode[] = [];

  for (const f of files) {
    // Only consider files that start with our prefix
    if (prefix && !f.name.startsWith(prefix)) continue;
    if (!prefix && f.name === '') continue;

    const remainder = prefix ? f.name.slice(prefix.length) : f.name;
    if (!remainder) continue;

    const slashIdx = remainder.indexOf('/');

    if (slashIdx >= 0) {
      // This file is inside a subfolder
      const folderName = remainder.slice(0, slashIdx);
      if (folderName) folderSet.add(folderName);
    } else {
      // This is a direct file at this level
      // Skip 0-byte folder placeholders
      if (f.size === 0 && f.name.endsWith('/')) continue;

      fileNodes.push({
        name: remainder,
        fullPath: f.name,
        isFolder: false,
        size: f.size,
        updated: f.updated,
        contentType: f.contentType,
      });
    }
  }

  const folders: FileNode[] = Array.from(folderSet).map(name => {
    // Calculate folder stats
    const folderPrefix = prefix + name + '/';
    let totalSize = 0;
    let newestDate = '';
    let childCount = 0;

    for (const f of files) {
      if (f.name.startsWith(folderPrefix)) {
        totalSize += f.size;
        if (f.updated > newestDate) newestDate = f.updated;
        childCount++;
      }
    }

    return {
      name,
      fullPath: prefix + name,
      isFolder: true,
      size: totalSize,
      updated: newestDate,
      contentType: 'folder',
      children: [],
    };
  });

  return { folders, fileNodes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Breadcrumb
// ─────────────────────────────────────────────────────────────────────────────

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const segments = path ? path.split('/').filter(Boolean) : [];

  return (
    <div className="flex items-center gap-1 text-xs min-w-0 overflow-x-auto no-scrollbar">
      <button
        onClick={() => onNavigate('')}
        className={clsx(
          "flex items-center gap-1 px-2 py-1 rounded-md transition-colors shrink-0",
          !path ? "text-theme-fg font-bold bg-theme-hover/50" : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover/30"
        )}
      >
        <Home className="w-3 h-3" />
        <span>My Files</span>
      </button>
      {segments.map((seg, i) => {
        const segPath = segments.slice(0, i + 1).join('/');
        const isLast = i === segments.length - 1;
        return (
          <React.Fragment key={segPath}>
            <ChevronRight className="w-3 h-3 text-theme-muted/40 shrink-0" />
            <button
              onClick={() => onNavigate(segPath)}
              className={clsx(
                "px-2 py-1 rounded-md transition-colors truncate max-w-[120px] shrink-0",
                isLast ? "text-theme-fg font-bold bg-theme-hover/50" : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover/30"
              )}
            >
              {seg}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload Progress Bar
// ─────────────────────────────────────────────────────────────────────────────

function UploadProgressBar({ queue }: { queue: UploadProgress[] }) {
  if (queue.length === 0) return null;

  const active = queue.filter(q => q.status === 'uploading' || q.status === 'pending');
  const done = queue.filter(q => q.status === 'done');
  const errors = queue.filter(q => q.status === 'error');

  if (active.length === 0 && done.length === 0 && errors.length === 0) return null;

  return (
    <div className="rounded-xl border border-theme/10 bg-theme-card overflow-hidden">
      <div className="px-3 py-2 border-b border-theme/5 flex items-center justify-between">
        <span className="text-[11px] font-bold text-theme-fg flex items-center gap-2">
          {active.length > 0 && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
          {active.length > 0 ? `Uploading ${active.length} file${active.length > 1 ? 's' : ''}...` : `${done.length} uploaded`}
          {errors.length > 0 && <span className="text-red-400">· {errors.length} failed</span>}
        </span>
      </div>
      <div className="max-h-[120px] overflow-y-auto custom-scrollbar divide-y divide-theme/5">
        {queue.map((item, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
            {item.status === 'uploading' && <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />}
            {item.status === 'done' && <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
            {item.status === 'error' && <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />}
            {item.status === 'pending' && <div className="w-3 h-3 rounded-full border-2 border-theme-muted/30 shrink-0" />}
            <span className="truncate text-theme-fg flex-1">{item.filename}</span>
            <span className="text-theme-muted shrink-0">
              {item.status === 'uploading' ? `${item.percent}%` : item.status === 'error' ? (item.error || 'Failed') : formatBytes(item.total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Menu
// ─────────────────────────────────────────────────────────────────────────────

interface ContextMenuItem {
  label: string;
  icon: React.ComponentType<any>;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
}

function ContextMenu({
  x, y, items, onClose,
}: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Ensure menu stays in viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 16);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] py-1.5 bg-theme-card border border-theme/15 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {item.divider && <div className="my-1 border-t border-theme/10" />}
          <button
            onClick={() => { item.onClick(); onClose(); }}
            className={clsx(
              "w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left",
              item.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-theme-fg hover:bg-theme-hover"
            )}
          >
            <item.icon className="w-3.5 h-3.5 shrink-0" />
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New Folder Dialog
// ─────────────────────────────────────────────────────────────────────────────

function NewFolderDialog({
  onSubmit, onCancel,
}: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl">
      <FolderPlus className="w-4 h-4 text-primary shrink-0" />
      <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-1">
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New folder name..."
          className="flex-1 bg-transparent text-xs text-theme-fg placeholder:text-theme-muted/50 focus:outline-none"
          onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="px-2.5 py-1 rounded-lg bg-primary text-white text-[10px] font-bold hover:bg-primary-bright transition-colors disabled:opacity-30"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rename Inline
// ─────────────────────────────────────────────────────────────────────────────

function RenameInput({
  currentName, onSubmit, onCancel,
}: { currentName: string; onSubmit: (newName: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(currentName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Select name without extension
    const dotIdx = currentName.lastIndexOf('.');
    if (dotIdx > 0) {
      inputRef.current?.setSelectionRange(0, dotIdx);
    } else {
      inputRef.current?.select();
    }
  }, [currentName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed && trimmed !== currentName) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <form onSubmit={handleSubmit} className="flex-1 min-w-0">
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        className="w-full bg-primary/5 border border-primary/20 rounded-md px-2 py-0.5 text-xs text-theme-fg focus:outline-none focus:border-primary/40"
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        onBlur={handleSubmit}
      />
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Drop Zone (compact for inside explorer)
// ─────────────────────────────────────────────────────────────────────────────

function CompactDropZone({ onFiles, active, currentPath }: { onFiles: (files: File[]) => void; active: boolean; currentPath: string }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const items = Array.from(e.dataTransfer.files);
    if (items.length > 0) onFiles(items);
  }, [onFiles]);

  return (
    <div
      className={clsx(
        "border-2 border-dashed rounded-xl px-4 py-3 text-center transition-all duration-200 cursor-pointer group",
        dragging
          ? "border-primary bg-primary/5 scale-[1.005]"
          : "border-theme/10 hover:border-primary/25 hover:bg-primary/3"
      )}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const items = Array.from(e.target.files || []);
          if (items.length > 0) onFiles(items);
          e.target.value = '';
        }}
      />
      <div className="flex items-center justify-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
          <Upload className="w-4 h-4 text-primary" />
        </div>
        <div className="text-left">
          <p className="text-xs font-bold text-theme-fg">
            {active ? 'Uploading...' : 'Drop files or click to upload'}
          </p>
          <p className="text-[10px] text-theme-muted mt-0.5">
            {currentPath ? `Uploading to /${currentPath}` : 'Upload to root'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid Item
// ─────────────────────────────────────────────────────────────────────────────

function GridItem({
  node, selected, renaming, onSelect, onOpen, onContextMenu, onRenameSubmit, onRenameCancel,
}: {
  node: FileNode;
  selected: boolean;
  renaming: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameSubmit: (newName: string) => void;
  onRenameCancel: () => void;
}) {
  const Icon = node.isFolder ? Folder : getFileIcon(node.name);
  const iconColor = node.isFolder ? 'text-blue-400' : getFileColor(node.name);

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      className={clsx(
        "group relative flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all duration-150 cursor-pointer select-none",
        selected
          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
          : "border-transparent hover:border-theme/15 hover:bg-theme-hover/40"
      )}
    >
      <div className={clsx("w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
        node.isFolder ? "bg-blue-500/10" : "bg-theme-hover/60"
      )}>
        <Icon className={clsx("w-6 h-6", iconColor)} />
      </div>

      <div className="w-full text-center min-w-0">
        {renaming ? (
          <RenameInput
            currentName={node.name}
            onSubmit={onRenameSubmit}
            onCancel={onRenameCancel}
          />
        ) : (
          <p className="text-[11px] font-medium text-theme-fg truncate leading-tight" title={node.name}>
            {node.name}
          </p>
        )}
        <p className="text-[10px] text-theme-muted mt-0.5">
          {node.isFolder ? '' : formatBytes(node.size)}
        </p>
      </div>

      {/* Selection indicator */}
      {selected && (
        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
          <CheckCircle2 className="w-3 h-3 text-white" />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List Item
// ─────────────────────────────────────────────────────────────────────────────

function ListItem({
  node, selected, renaming, onSelect, onOpen, onContextMenu, onRenameSubmit, onRenameCancel,
}: {
  node: FileNode;
  selected: boolean;
  renaming: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameSubmit: (newName: string) => void;
  onRenameCancel: () => void;
}) {
  const Icon = node.isFolder ? Folder : getFileIcon(node.name);
  const iconColor = node.isFolder ? 'text-blue-400' : getFileColor(node.name);

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      className={clsx(
        "group flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-100 cursor-pointer select-none",
        selected
          ? "bg-primary/8 ring-1 ring-primary/15"
          : "hover:bg-theme-hover/40"
      )}
    >
      {/* Checkbox area */}
      <div className={clsx(
        "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0",
        selected ? "border-primary bg-primary" : "border-theme/20 group-hover:border-theme/40"
      )}>
        {selected && <CheckCircle2 className="w-3 h-3 text-white" />}
      </div>

      {/* Icon */}
      <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
        node.isFolder ? "bg-blue-500/10" : "bg-theme-hover/50"
      )}>
        <Icon className={clsx("w-4 h-4", iconColor)} />
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        {renaming ? (
          <RenameInput
            currentName={node.name}
            onSubmit={onRenameSubmit}
            onCancel={onRenameCancel}
          />
        ) : (
          <p className="text-xs font-medium text-theme-fg truncate">{node.name}</p>
        )}
        {node.isFolder && !renaming && (
          <p className="text-[10px] text-theme-muted">{formatBytes(node.size)} total</p>
        )}
      </div>

      {/* Type badge */}
      <span className="text-[10px] text-theme-muted font-medium w-12 text-right shrink-0 hidden sm:block">
        {node.isFolder ? 'Folder' : extensionLabel(node.name)}
      </span>

      {/* Size */}
      <span className="text-[11px] text-theme-muted tabular-nums w-16 text-right shrink-0">
        {node.isFolder ? '—' : formatBytes(node.size)}
      </span>

      {/* Date */}
      <span className="text-[11px] text-theme-muted w-20 text-right shrink-0 hidden md:block">
        {timeAgo(node.updated)}
      </span>

      {/* Actions */}
      <button
        onClick={(e) => { e.stopPropagation(); onContextMenu(e); }}
        className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-all shrink-0"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder Tree Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function FolderTreeRow({
  node, depth, currentPath, expanded, onToggle, onNavigate,
}: {
  node: FolderTreeNode;
  depth: number;
  currentPath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const isOpen = expanded.has(node.fullPath);
  const isActive = currentPath === node.fullPath;
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        onClick={() => onNavigate(node.fullPath)}
        className={clsx(
          "group flex items-center gap-1 pr-2 py-1 rounded-md cursor-pointer text-xs transition-colors",
          isActive
            ? "bg-primary/10 text-primary font-bold"
            : "text-theme-fg hover:bg-theme-hover/50"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.fullPath);
          }}
          className={clsx(
            "shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-theme-hover transition-colors",
            !hasChildren && "invisible"
          )}
        >
          {hasChildren && (
            isOpen
              ? <ChevronDown className="w-3 h-3 text-theme-muted" />
              : <ChevronRight className="w-3 h-3 text-theme-muted" />
          )}
        </button>
        {isOpen && hasChildren ? (
          <FolderOpen className={clsx("w-3.5 h-3.5 shrink-0", isActive ? "text-primary" : "text-blue-400/80")} />
        ) : (
          <Folder className={clsx("w-3.5 h-3.5 shrink-0", isActive ? "text-primary" : "text-blue-400/80")} />
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {isOpen && hasChildren && node.children.map(child => (
        <FolderTreeRow
          key={child.fullPath}
          node={child}
          depth={depth + 1}
          currentPath={currentPath}
          expanded={expanded}
          onToggle={onToggle}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

function FolderTreeSidebar({
  files, currentPath, onNavigate, totalSize, totalFiles,
}: {
  files: CloudFileEntry[];
  currentPath: string;
  onNavigate: (path: string) => void;
  totalSize: number;
  totalFiles: number;
}) {
  const tree = useMemo(() => buildFolderTree(files), [files]);

  // Auto-expand the chain of ancestors of the current path
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!currentPath) return;
    setExpanded(prev => {
      const next = new Set(prev);
      const parts = currentPath.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        next.add(parts.slice(0, i).join('/'));
      }
      return next;
    });
  }, [currentPath]);

  const toggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 rounded-2xl border border-theme/10 bg-theme-card overflow-hidden">
      <div className="px-3 py-2 border-b border-theme/8 flex items-center gap-2">
        <Cloud className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-black uppercase tracking-wider text-theme-muted">Folders</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
        <div
          onClick={() => onNavigate('')}
          className={clsx(
            "flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-xs transition-colors",
            !currentPath
              ? "bg-primary/10 text-primary font-bold"
              : "text-theme-fg hover:bg-theme-hover/50"
          )}
        >
          <Home className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">My Files</span>
        </div>
        {tree.length === 0 ? (
          <div className="px-2 py-3 text-[10px] text-theme-muted/50 italic">
            No folders yet
          </div>
        ) : (
          tree.map(node => (
            <FolderTreeRow
              key={node.fullPath}
              node={node}
              depth={0}
              currentPath={currentPath}
              expanded={expanded}
              onToggle={toggle}
              onNavigate={onNavigate}
            />
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t border-theme/8 text-[10px] text-theme-muted">
        <div className="flex justify-between">
          <span>{totalFiles} file{totalFiles === 1 ? '' : 's'}</span>
          <span className="font-bold text-theme-fg">{formatBytes(totalSize)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main File Explorer
// ─────────────────────────────────────────────────────────────────────────────

export function FileExplorer({
  files, loading, fetchFiles, uploading, uploadQueue, onUpload,
  onDownload, onDelete, onCreateFolder, onRename, info,
}: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [bgContextMenu, setBgContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [confirmDeleteItems, setConfirmDeleteItems] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch files on mount
  useEffect(() => {
    if (!loaded) {
      fetchFiles();
      setLoaded(true);
    }
  }, [loaded, fetchFiles]);

  // Get items at current path
  const { folders, fileNodes } = useMemo(
    () => getItemsAtPath(files, currentPath),
    [files, currentPath]
  );

  // Combine and sort
  const allItems = useMemo(() => {
    let items = [...folders, ...fileNodes];

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(n => n.name.toLowerCase().includes(q));
    }

    // Sort: folders first, then by field
    items.sort((a, b) => {
      // Folders always first
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;

      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'updated':
          cmp = (a.updated || '').localeCompare(b.updated || '');
          break;
        case 'type': {
          const extA = a.isFolder ? '' : (a.name.split('.').pop() || '');
          const extB = b.isFolder ? '' : (b.name.split('.').pop() || '');
          cmp = extA.localeCompare(extB);
          break;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return items;
  }, [folders, fileNodes, searchQuery, sortField, sortDir]);

  // Navigate to path
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setSelectedItems(new Set());
    setSearchQuery('');
    setCreatingFolder(false);
    setRenamingItem(null);
    setConfirmDeleteItems(null);
  }, []);

  // Selection handlers
  const handleSelect = useCallback((node: FileNode, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedItems(prev => {
        const next = new Set(prev);
        if (next.has(node.fullPath)) next.delete(node.fullPath);
        else next.add(node.fullPath);
        return next;
      });
    } else if (e.shiftKey && selectedItems.size > 0) {
      // Range select
      const allPaths = allItems.map(i => i.fullPath);
      const lastSelected = Array.from(selectedItems).pop()!;
      const lastIdx = allPaths.indexOf(lastSelected);
      const currentIdx = allPaths.indexOf(node.fullPath);
      if (lastIdx >= 0 && currentIdx >= 0) {
        const start = Math.min(lastIdx, currentIdx);
        const end = Math.max(lastIdx, currentIdx);
        const range = new Set(allPaths.slice(start, end + 1));
        setSelectedItems(range);
      }
    } else {
      setSelectedItems(new Set([node.fullPath]));
    }
  }, [allItems, selectedItems]);

  // Open folder or preview file
  const handleOpen = useCallback((node: FileNode) => {
    if (node.isFolder) {
      navigateTo(node.fullPath);
    } else {
      onDownload(node.fullPath);
    }
  }, [navigateTo, onDownload]);

  // Context menu for items
  const handleContextMenu = useCallback((e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedItems.has(node.fullPath)) {
      setSelectedItems(new Set([node.fullPath]));
    }
    setContextMenu({ x: e.clientX, y: e.clientY, node });
    setBgContextMenu(null);
  }, [selectedItems]);

  // Context menu for background
  const handleBgContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement)?.dataset?.bgArea) {
      e.preventDefault();
      setBgContextMenu({ x: e.clientX, y: e.clientY });
      setContextMenu(null);
    }
  }, []);

  // Create folder
  const handleCreateFolder = useCallback(async (name: string) => {
    const fullPath = currentPath ? `${currentPath}/${name}` : name;
    const result = await onCreateFolder(fullPath);
    if (result.ok) {
      fetchFiles();
      setCreatingFolder(false);
    }
  }, [currentPath, onCreateFolder, fetchFiles]);

  // Rename
  const handleRename = useCallback(async (node: FileNode, newName: string) => {
    const dir = node.fullPath.includes('/')
      ? node.fullPath.slice(0, node.fullPath.lastIndexOf('/'))
      : '';
    const newPath = dir ? `${dir}/${newName}` : newName;
    const result = await onRename(node.fullPath, newPath);
    if (result.ok) {
      fetchFiles();
      setRenamingItem(null);
    }
  }, [onRename, fetchFiles]);

  // Delete
  const handleDeleteSelected = useCallback(async () => {
    const items = confirmDeleteItems || Array.from(selectedItems);
    for (const path of items) {
      await onDelete(path);
    }
    fetchFiles();
    setSelectedItems(new Set());
    setConfirmDeleteItems(null);
  }, [confirmDeleteItems, selectedItems, onDelete, fetchFiles]);

  // Upload to current folder
  const handleUpload = useCallback((uploadFiles: File[]) => {
    onUpload(uploadFiles, currentPath || undefined);
  }, [onUpload, currentPath]);

  // Sort toggle
  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField]);

  // Deselect on escape / click background
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedItems(new Set());
        setContextMenu(null);
        setBgContextMenu(null);
        setConfirmDeleteItems(null);
        setCreatingFolder(false);
      }
      if (e.key === 'Delete' && selectedItems.size > 0) {
        setConfirmDeleteItems(Array.from(selectedItems));
      }
      if (e.key === 'F2' && selectedItems.size === 1) {
        setRenamingItem(Array.from(selectedItems)[0]);
      }
      if (e.key === 'Backspace' && selectedItems.size === 0 && currentPath) {
        const parent = currentPath.includes('/')
          ? currentPath.slice(0, currentPath.lastIndexOf('/'))
          : '';
        navigateTo(parent);
      }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedItems(new Set(allItems.map(i => i.fullPath)));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedItems, currentPath, allItems, navigateTo]);

  // Context menu items for file/folder
  const getContextMenuItems = useCallback((node: FileNode): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    if (node.isFolder) {
      items.push({ label: 'Open Folder', icon: FolderOpen, onClick: () => navigateTo(node.fullPath) });
    } else {
      items.push({ label: 'Download', icon: Download, onClick: () => onDownload(node.fullPath) });
    }

    items.push({ label: 'Rename', icon: Edit3, onClick: () => setRenamingItem(node.fullPath), divider: !node.isFolder });

    if (!node.isFolder) {
      items.push({
        label: 'Details',
        icon: Eye,
        onClick: () => {
          /* Could open a details panel */
        },
      });
    }

    items.push({
      label: 'Delete',
      icon: Trash2,
      onClick: () => setConfirmDeleteItems([node.fullPath]),
      danger: true,
      divider: true,
    });

    return items;
  }, [navigateTo, onDownload]);

  // Background context menu items
  const bgMenuItems: ContextMenuItem[] = useMemo(() => [
    { label: 'New Folder', icon: FolderPlus, onClick: () => setCreatingFolder(true) },
    { label: 'Upload Files', icon: Upload, onClick: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = () => {
        const items = Array.from(input.files || []);
        if (items.length > 0) handleUpload(items);
      };
      input.click();
    }},
    { label: 'Refresh', icon: RefreshCw, onClick: () => fetchFiles(), divider: true },
    { label: 'Select All', icon: CheckCircle2, onClick: () => setSelectedItems(new Set(allItems.map(i => i.fullPath))) },
  ], [handleUpload, fetchFiles, allItems]);

  // Drag state for area
  const [areaDragging, setAreaDragging] = useState(false);

  // Storage stats
  const totalFiles = fileNodes.length;
  const totalFolders = folders.length;
  const totalSize = fileNodes.reduce((s, f) => s + f.size, 0);

  return (
    <div className="space-y-3">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Back button */}
        {currentPath && (
          <button
            onClick={() => {
              const parent = currentPath.includes('/')
                ? currentPath.slice(0, currentPath.lastIndexOf('/'))
                : '';
              navigateTo(parent);
            }}
            className="p-2 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
            title="Go up"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}

        {/* Breadcrumb */}
        <div className="flex-1 min-w-0">
          <Breadcrumb path={currentPath} onNavigate={navigateTo} />
        </div>

        {/* Search */}
        <div className="relative w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-theme-muted" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full pl-7 pr-2 py-1.5 bg-theme-hover/50 border border-theme/10 rounded-lg text-[11px] text-theme-fg placeholder:text-theme-muted/50 focus:outline-none focus:border-primary/30"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="w-3 h-3 text-theme-muted hover:text-theme-fg" />
            </button>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-theme-hover/50 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('list')}
            className={clsx(
              "p-1.5 rounded-md transition-colors",
              viewMode === 'list' ? "bg-theme-bg text-theme-fg shadow-sm" : "text-theme-muted hover:text-theme-fg"
            )}
            title="List view"
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={clsx(
              "p-1.5 rounded-md transition-colors",
              viewMode === 'grid' ? "bg-theme-bg text-theme-fg shadow-sm" : "text-theme-muted hover:text-theme-fg"
            )}
            title="Grid view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Actions */}
        <button
          onClick={() => setCreatingFolder(true)}
          className="p-2 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
          title="New folder"
        >
          <FolderPlus className="w-4 h-4" />
        </button>
        <button
          onClick={() => fetchFiles()}
          className="p-2 rounded-xl hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ── Bulk Actions Bar ──────────────────────────────────────────────── */}
      {selectedItems.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/15 rounded-xl animate-in slide-in-from-top-1 duration-150">
          <span className="text-[11px] font-bold text-primary">
            {selectedItems.size} selected
          </span>
          <div className="flex items-center gap-1 ml-auto">
            {selectedItems.size === 1 && !Array.from(selectedItems).some(p => folders.some(f => f.fullPath === p)) && (
              <button
                onClick={() => {
                  const path = Array.from(selectedItems)[0];
                  onDownload(path);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold text-theme-fg bg-theme-hover hover:bg-theme-active transition-colors"
              >
                <Download className="w-3 h-3" /> Download
              </button>
            )}
            <button
              onClick={() => setConfirmDeleteItems(Array.from(selectedItems))}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold text-red-400 bg-red-500/10 hover:bg-red-500/15 transition-colors"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
            <button
              onClick={() => setSelectedItems(new Set())}
              className="p-1 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation ───────────────────────────────────────────── */}
      {confirmDeleteItems && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-500/5 border border-red-500/20 rounded-xl animate-in slide-in-from-top-1 duration-150">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-red-300 flex-1">
            Delete {confirmDeleteItems.length} item{confirmDeleteItems.length > 1 ? 's' : ''}? This cannot be undone.
          </span>
          <button
            onClick={handleDeleteSelected}
            className="px-3 py-1 rounded-lg text-[11px] font-bold text-white bg-red-600 hover:bg-red-500 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDeleteItems(null)}
            className="p-1 rounded-lg text-theme-muted hover:text-theme-fg hover:bg-theme-hover transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Upload Progress ───────────────────────────────────────────────── */}
      <UploadProgressBar queue={uploadQueue} />

      {/* ── New Folder Dialog ─────────────────────────────────────────────── */}
      {creatingFolder && (
        <NewFolderDialog
          onSubmit={handleCreateFolder}
          onCancel={() => setCreatingFolder(false)}
        />
      )}

      {/* ── Tree Sidebar + Main Pane ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 items-stretch">
        {/* Folder tree sidebar */}
        <div className="hidden md:block min-h-[480px]">
          <FolderTreeSidebar
            files={files}
            currentPath={currentPath}
            onNavigate={navigateTo}
            totalSize={files.reduce((s, f) => s + f.size, 0)}
            totalFiles={files.filter(f => !(f.size === 0 && f.name.endsWith('/'))).length}
          />
        </div>

        {/* Main pane: drop zone + file area */}
        <div className="space-y-3 min-w-0">
          <CompactDropZone onFiles={handleUpload} active={uploading} currentPath={currentPath} />

          <div
            ref={containerRef}
            data-bg-area="true"
            onContextMenu={handleBgContextMenu}
            onDragOver={(e) => { e.preventDefault(); setAreaDragging(true); }}
            onDragLeave={() => setAreaDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setAreaDragging(false);
              const droppedFiles = Array.from(e.dataTransfer.files);
              if (droppedFiles.length > 0) handleUpload(droppedFiles);
            }}
            className={clsx(
              "rounded-2xl border transition-all min-h-[300px]",
              areaDragging
                ? "border-primary/30 bg-primary/3"
                : "border-theme/10 bg-theme-card"
            )}
          >
        {/* List header (only in list view) */}
        {viewMode === 'list' && allItems.length > 0 && (
          <div className="flex items-center gap-3 px-3 py-2 border-b border-theme/8 text-[10px] font-black text-theme-muted uppercase tracking-wider">
            <div className="w-4 shrink-0" />
            <div className="w-8 shrink-0" />
            <button className="flex-1 flex items-center gap-1 hover:text-theme-fg transition-colors" onClick={() => toggleSort('name')}>
              Name {sortField === 'name' && (sortDir === 'asc' ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />)}
            </button>
            <button className="w-12 text-right hidden sm:flex items-center justify-end gap-1 hover:text-theme-fg transition-colors" onClick={() => toggleSort('type')}>
              Type {sortField === 'type' && (sortDir === 'asc' ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />)}
            </button>
            <button className="w-16 text-right flex items-center justify-end gap-1 hover:text-theme-fg transition-colors" onClick={() => toggleSort('size')}>
              Size {sortField === 'size' && (sortDir === 'asc' ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />)}
            </button>
            <button className="w-20 text-right hidden md:flex items-center justify-end gap-1 hover:text-theme-fg transition-colors" onClick={() => toggleSort('updated')}>
              Modified {sortField === 'updated' && (sortDir === 'asc' ? <SortAsc className="w-3 h-3" /> : <SortDesc className="w-3 h-3" />)}
            </button>
            <div className="w-7 shrink-0" />
          </div>
        )}

        {/* Empty state */}
        {allItems.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 px-4" data-bg-area="true">
            <div className="w-16 h-16 rounded-3xl bg-theme-hover/50 flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-theme-muted/30" />
            </div>
            <p className="text-sm font-bold text-theme-muted mb-1">
              {searchQuery ? 'No matches found' : 'This folder is empty'}
            </p>
            <p className="text-xs text-theme-muted/60 text-center max-w-[260px]">
              {searchQuery
                ? `No files matching "${searchQuery}" in this folder.`
                : 'Drop files here, click the upload area above, or create a new folder.'}
            </p>
            {!searchQuery && (
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setCreatingFolder(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
                >
                  <FolderPlus className="w-3.5 h-3.5" /> New Folder
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && allItems.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        )}

        {/* Grid view */}
        {viewMode === 'grid' && allItems.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1 p-2 max-h-[420px] overflow-y-auto custom-scrollbar">
            {allItems.map(node => (
              <GridItem
                key={node.fullPath}
                node={node}
                selected={selectedItems.has(node.fullPath)}
                renaming={renamingItem === node.fullPath}
                onSelect={(e) => handleSelect(node, e)}
                onOpen={() => handleOpen(node)}
                onContextMenu={(e) => handleContextMenu(e, node)}
                onRenameSubmit={(newName) => handleRename(node, newName)}
                onRenameCancel={() => setRenamingItem(null)}
              />
            ))}
          </div>
        )}

        {/* List view */}
        {viewMode === 'list' && allItems.length > 0 && (
          <div className="p-1 max-h-[420px] overflow-y-auto custom-scrollbar">
            {allItems.map(node => (
              <ListItem
                key={node.fullPath}
                node={node}
                selected={selectedItems.has(node.fullPath)}
                renaming={renamingItem === node.fullPath}
                onSelect={(e) => handleSelect(node, e)}
                onOpen={() => handleOpen(node)}
                onContextMenu={(e) => handleContextMenu(e, node)}
                onRenameSubmit={(newName) => handleRename(node, newName)}
                onRenameCancel={() => setRenamingItem(null)}
              />
            ))}
          </div>
        )}

        {/* Footer stats */}
        {allItems.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-t border-theme/8 text-[10px] text-theme-muted">
            {totalFolders > 0 && <span>{totalFolders} folder{totalFolders > 1 ? 's' : ''}</span>}
            {totalFolders > 0 && totalFiles > 0 && <span>·</span>}
            {totalFiles > 0 && <span>{totalFiles} file{totalFiles > 1 ? 's' : ''}</span>}
            <span>·</span>
            <span>{formatBytes(totalSize)}</span>
          </div>
        )}
          </div>
        </div>
      </div>

      {/* ── Context Menus ─────────────────────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.node)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {bgContextMenu && (
        <ContextMenu
          x={bgContextMenu.x}
          y={bgContextMenu.y}
          items={bgMenuItems}
          onClose={() => setBgContextMenu(null)}
        />
      )}

      {/* ── Keyboard Shortcuts Hint ───────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-[10px] text-theme-muted/40 px-1">
        <span><kbd className="px-1 py-0.5 rounded bg-theme-hover/50 text-theme-muted/60 font-mono text-[9px]">Ctrl+A</kbd> Select all</span>
        <span><kbd className="px-1 py-0.5 rounded bg-theme-hover/50 text-theme-muted/60 font-mono text-[9px]">F2</kbd> Rename</span>
        <span><kbd className="px-1 py-0.5 rounded bg-theme-hover/50 text-theme-muted/60 font-mono text-[9px]">Del</kbd> Delete</span>
        <span><kbd className="px-1 py-0.5 rounded bg-theme-hover/50 text-theme-muted/60 font-mono text-[9px]">Backspace</kbd> Go up</span>
        <span><kbd className="px-1 py-0.5 rounded bg-theme-hover/50 text-theme-muted/60 font-mono text-[9px]">Esc</kbd> Deselect</span>
      </div>
    </div>
  );
}
