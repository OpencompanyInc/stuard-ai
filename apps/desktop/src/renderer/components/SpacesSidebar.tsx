import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus,
  MoreHorizontal,
  Search,
  Briefcase,
  BookOpen,
  Lightbulb,
  Archive,
  Loader2,
  FolderOpen,
  FileText,
  Link2,
  Code,
  PanelLeftClose,
  Pin,
  File,
  Copy,
  ExternalLink,
  Check,
  Trash2,
  Edit3,
  ChevronRight,
  ChevronDown,
  X,
  ArrowLeft,
  FileImage,
  FileVideo,
  FileAudio,
  Hash,
  Star,
  Clock,
  Sparkles,
  Folder,
  FolderPlus,
  Share2,
  Lock,
  Users,
  MoveRight,
  GripVertical,
  List,
  FolderTree
} from 'lucide-react';
import { clsx } from 'clsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Types
export interface Space {
  id: string;
  name: string;
  type: 'project' | 'topic' | 'research' | 'reference' | 'custom';
  description?: string;
  icon?: string;
  color?: string;
  item_count?: number;
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SpaceItem {
  id: string;
  space_id: string;
  type: 'note' | 'source' | 'link' | 'file' | 'fact' | 'snippet' | 'folder';
  title?: string | null;
  content: string;
  added_by?: string;
  pinned?: boolean;
  parent_id?: string | null;
  position?: number;
  children?: SpaceItem[];
  created_at?: string;
  updated_at?: string;
}

export interface ShareInfo {
  is_shared: boolean;
  shared_with: string[];
  has_password: boolean;
}

type ContentFilter = 'all' | 'notes' | 'links' | 'code';

interface SpacesSidebarProps {
  className?: string;
  translucentMode?: boolean;
  onSelectSpace?: (space: Space) => void;
  onClose?: () => void;
  accessToken?: string | null;
}

// Icon helpers
const SpaceTypeIcon: React.FC<{ type: Space['type']; className?: string }> = ({ type, className }) => {
  const icons = {
    project: Briefcase,
    topic: BookOpen,
    research: Lightbulb,
    reference: Archive,
    custom: FolderOpen
  };
  const Icon = icons[type] || FolderOpen;
  return <Icon className={className} />;
};

const getSpaceAccent = (type: Space['type']) => {
  const accents = {
    project: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20' },
    topic: { bg: 'bg-violet-500/10', text: 'text-violet-500', border: 'border-violet-500/20' },
    research: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20' },
    reference: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20' },
    custom: { bg: 'bg-slate-500/10', text: 'text-slate-500', border: 'border-slate-500/20' }
  };
  return accents[type] || accents.custom;
};

const ItemIcon: React.FC<{ type: SpaceItem['type']; className?: string }> = ({ type, className }) => {
  const icons = {
    note: FileText,
    link: Link2,
    source: Link2,
    snippet: Code,
    file: File,
    fact: Hash,
    folder: Folder
  };
  const Icon = icons[type] || FileText;
  return <Icon className={className} />;
};

const getFileIcon = (filename: string, className?: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
  const videoExts = ['mp4', 'avi', 'mov', 'mkv'];
  const audioExts = ['mp3', 'wav', 'flac', 'aac'];

  if (imageExts.includes(ext || '')) return <FileImage className={className} />;
  if (videoExts.includes(ext || '')) return <FileVideo className={className} />;
  if (audioExts.includes(ext || '')) return <FileAudio className={className} />;
  return <File className={className} />;
};

// Sub-components
const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({
  isOpen, onClose, title, children
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-theme-card rounded-2xl w-full max-w-md overflow-hidden border border-theme shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme">
          <h3 className="font-semibold text-theme-fg text-[15px]">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </div>
  );
};

const EmptyState: React.FC<{ title: string; description: string; icon: React.ElementType; action?: React.ReactNode }> = ({
  title, description, icon: Icon, action
}) => (
  <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
    <div className="w-14 h-14 rounded-2xl bg-theme-hover/80 flex items-center justify-center mb-4">
      <Icon className="w-6 h-6 text-theme-muted" />
    </div>
    <h3 className="text-sm font-medium text-theme-fg mb-1">{title}</h3>
    <p className="text-xs text-theme-muted max-w-[200px] mb-4">{description}</p>
    {action}
  </div>
);

// Tree Item Component
const TreeItem: React.FC<{
  item: SpaceItem;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onClick: () => void;
  onMove?: (itemId: string, newParentId: string | null) => void;
  selectedId?: string | null;
}> = ({ item, depth, expandedIds, onToggle, onClick, onMove, selectedId }) => {
  const isFolder = item.type === 'folder';
  const hasChildren = isFolder && item.children && item.children.length > 0;
  const isExpanded = expandedIds.has(item.id);

  const getTypeColor = () => {
    const colors: Record<string, string> = {
      note: 'bg-blue-500/10 text-blue-500',
      link: 'bg-emerald-500/10 text-emerald-500',
      source: 'bg-emerald-500/10 text-emerald-500',
      snippet: 'bg-amber-500/10 text-amber-500',
      file: 'bg-violet-500/10 text-violet-500',
      fact: 'bg-pink-500/10 text-pink-500',
      folder: 'bg-yellow-500/10 text-yellow-600'
    };
    return colors[item.type] || colors.note;
  };

  return (
    <div>
      <div
        className={clsx(
          "group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all",
          selectedId === item.id
            ? "bg-primary/10 border border-primary/20"
            : "hover:bg-theme-hover/60 border border-transparent"
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={(e) => {
          if (isFolder) {
            onToggle(item.id);
          } else {
            onClick();
          }
        }}
      >
        {/* Expand/collapse for folders */}
        {isFolder ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(item.id); }}
            className="p-0.5 hover:bg-theme-active rounded transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-theme-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-theme-muted" />
            )}
          </button>
        ) : (
          <div className="w-4" />
        )}

        {/* Icon */}
        <div className={clsx("w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0", getTypeColor())}>
          <ItemIcon type={item.type} className="w-3.5 h-3.5" />
        </div>

        {/* Title */}
        <span className="flex-1 text-[13px] text-theme-fg truncate" title={item.title || item.content}>
          {item.title || (
            item.type === 'link' ? item.content :
              item.type === 'file' ? item.content.split(/[/\\]/).pop() :
                'Untitled'
          )}
        </span>

        {/* Pin indicator */}
        {item.pinned && (
          <Star className="w-3 h-3 text-amber-500 fill-amber-500 flex-shrink-0" />
        )}

        {/* Removed item count for folders as requested */}
      </div>

      {/* Children */}
      {isFolder && isExpanded && item.children && (
        <div className="mt-0.5">
          {item.children.map(child => (
            <TreeItem
              key={child.id}
              item={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onClick={onClick}
              onMove={onMove}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Space List Item
const SpaceListItem: React.FC<{
  space: Space;
  isSelected: boolean;
  onSelect: () => void;
  shareInfo?: ShareInfo;
  onShare?: () => void;
}> = ({ space, isSelected, onSelect, shareInfo, onShare }) => {
  const accent = getSpaceAccent(space.type);

  return (
    <div
      onClick={onSelect}
      className={clsx(
        "group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all",
        isSelected
          ? "bg-theme-card border border-theme shadow-sm"
          : "hover:bg-theme-hover/60 border border-transparent"
      )}
    >
      <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center", accent.bg)}>
        <SpaceTypeIcon type={space.type} className={clsx("w-4 h-4", accent.text)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-theme-fg truncate">{space.name}</span>
          {shareInfo?.is_shared && (
            <Users className="w-3 h-3 text-primary flex-shrink-0" />
          )}
        </div>
        {space.description && (
          <div className="text-[11px] text-theme-muted truncate mt-0.5">{space.description}</div>
        )}
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className={clsx(
              "p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity",
              "hover:bg-theme-active text-theme-muted hover:text-theme-fg"
            )}
            onClick={e => e.stopPropagation()}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="z-[10005] min-w-[140px] bg-theme-card rounded-xl border border-theme p-1 shadow-xl" align="end">
            <DropdownMenu.Item
              onClick={(e) => { e.stopPropagation(); onShare?.(); }}
              className="text-[13px] px-2.5 py-1.5 rounded-lg hover:bg-theme-hover outline-none cursor-pointer flex items-center gap-2 text-theme-muted"
            >
              <Share2 className="w-3.5 h-3.5" /> Share
            </DropdownMenu.Item>
            <DropdownMenu.Item className="text-[13px] px-2.5 py-1.5 rounded-lg hover:bg-theme-hover outline-none cursor-pointer flex items-center gap-2 text-theme-muted">
              <Edit3 className="w-3.5 h-3.5" /> Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item className="text-[13px] px-2.5 py-1.5 rounded-lg hover:bg-theme-hover outline-none cursor-pointer flex items-center gap-2 text-theme-muted">
              <Archive className="w-3.5 h-3.5" /> Archive
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="h-px bg-theme my-1" />
            <DropdownMenu.Item className="text-[13px] px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 outline-none cursor-pointer text-red-500 flex items-center gap-2">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
};

// Content Item Card (flat view)
const ContentCard: React.FC<{
  item: SpaceItem;
  onClick: () => void;
  onMoveToFolder?: () => void;
}> = ({ item, onClick, onMoveToFolder }) => {
  const getPreview = () => {
    if (item.type === 'snippet') {
      const code = item.content.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();
      return code.split('\n').slice(0, 3).join('\n');
    }
    if (item.type === 'folder') return `${item.children?.length || 0} items`;
    return item.content.slice(0, 150);
  };

  const getTypeColor = () => {
    const colors: Record<string, string> = {
      note: 'bg-blue-500/10 text-blue-500',
      link: 'bg-emerald-500/10 text-emerald-500',
      source: 'bg-emerald-500/10 text-emerald-500',
      snippet: 'bg-amber-500/10 text-amber-500',
      file: 'bg-violet-500/10 text-violet-500',
      fact: 'bg-pink-500/10 text-pink-500',
      folder: 'bg-yellow-500/10 text-yellow-600'
    };
    return colors[item.type] || colors.note;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={onClick}
      className="group relative bg-theme-card hover:bg-theme-hover/50 border border-theme hover:border-theme-sidebar rounded-xl p-4 cursor-pointer transition-all"
    >
      {item.pinned && (
        <div className="absolute top-3 right-3">
          <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", getTypeColor())}>
          <ItemIcon type={item.type} className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-medium text-theme-fg truncate pr-6">
            {item.title || (item.type === 'link' ? item.content : item.type === 'folder' ? 'Folder' : 'Untitled')}
          </h4>

          {item.type === 'snippet' ? (
            <pre className="mt-2 text-[11px] text-theme-muted font-mono bg-theme-hover/50 rounded-lg p-2 overflow-hidden line-clamp-3">
              {getPreview()}
            </pre>
          ) : item.type === 'folder' ? (
            <p className="mt-1.5 text-[12px] text-theme-muted">
              {item.children?.length || 0} items inside
            </p>
          ) : item.type !== 'link' && (
            <p className="mt-1.5 text-[12px] text-theme-muted line-clamp-2 leading-relaxed">
              {getPreview()}
            </p>
          )}

          <div className="flex items-center gap-2 mt-2.5">
            <span className="text-[10px] text-theme-muted capitalize px-1.5 py-0.5 rounded bg-theme-hover">
              {item.type}
            </span>
            {item.updated_at && (
              <span className="text-[10px] text-theme-muted flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(item.updated_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Move to folder button */}
      {item.type !== 'folder' && onMoveToFolder && (
        <button
          onClick={(e) => { e.stopPropagation(); onMoveToFolder(); }}
          className="absolute bottom-3 right-3 p-1.5 rounded-lg bg-theme-hover opacity-0 group-hover:opacity-100 hover:bg-theme-active text-theme-muted hover:text-theme-fg transition-all"
          title="Move to folder"
        >
          <MoveRight className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
  );
};

// Filter Tab
const FilterTab: React.FC<{
  label: string;
  count?: number;
  isActive: boolean;
  onClick: () => void;
}> = ({ label, count, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={clsx(
      "px-3 py-1.5 text-[12px] font-medium rounded-lg transition-all",
      isActive
        ? "bg-theme-card text-theme-fg shadow-sm"
        : "text-theme-muted hover:text-theme-fg hover:bg-theme-hover/50"
    )}
  >
    {label}
    {count !== undefined && count > 0 && (
      <span className="ml-1.5 text-[10px] opacity-60">({count})</span>
    )}
  </button>
);

// Main Component
export const SpacesSidebar: React.FC<SpacesSidebarProps> = ({
  className,
  translucentMode,
  onSelectSpace,
  onClose,
  accessToken
}) => {
  // State
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);
  const [items, setItems] = useState<SpaceItem[]>([]);
  const [treeItems, setTreeItems] = useState<SpaceItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [viewingItem, setViewingItem] = useState<SpaceItem | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(['project', 'topic', 'research', 'reference', 'custom']));
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('tree');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<SpaceItem[]>([]);

  // Modal states
  const [isCreateSpaceOpen, setIsCreateSpaceOpen] = useState(false);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isMoveItemOpen, setIsMoveItemOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<SpaceItem | null>(null);
  const [isEditItemOpen, setIsEditItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SpaceItem | null>(null);
  const [editItemTitle, setEditItemTitle] = useState("");
  const [editItemContent, setEditItemContent] = useState("");
  const [isUpdatingItem, setIsUpdatingItem] = useState(false);

  const [newSpaceName, setNewSpaceName] = useState("");
  const [newSpaceType, setNewSpaceType] = useState<Space['type']>('topic');
  const [newSpaceDesc, setNewSpaceDesc] = useState("");
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [newItemContent, setNewItemContent] = useState("");
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemType, setNewItemType] = useState<SpaceItem['type']>('note');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Share state
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [shareEmails, setShareEmails] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [isUpdatingShare, setIsUpdatingShare] = useState(false);

  // Toast auto-hide
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Fetch spaces
  const fetchSpaces = async () => {
    setLoading(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_list', { limit: 50 });
      if (result?.ok && Array.isArray(result?.spaces)) {
        setSpaces(result.spaces);
      } else if (result?.error) {
        setError(String(result.error));
      }
    } catch (err) {
      setError('Failed to load spaces');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSpaces(); }, [accessToken]);

  // Load space items (flat)
  const loadSpaceItems = async (space: Space) => {
    setItemsLoading(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_item_list', {
        space_id: space.id,
        limit: 500
      });
      if (result?.ok && Array.isArray(result?.items)) {
        setItems(result.items);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  // Load folder tree
  const loadFolderTree = async (space: Space) => {
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_get_tree', {
        space_id: space.id
      });
      if (result?.ok && Array.isArray(result?.tree)) {
        setTreeItems(result.tree);
      } else {
        setTreeItems([]);
      }
    } catch {
      setTreeItems([]);
    }
  };

  // Load share info
  const loadShareInfo = async (spaceId: string) => {
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_share_info', {
        space_id: spaceId
      });
      if (result?.ok) {
        setShareInfo({
          is_shared: result.is_shared,
          shared_with: result.shared_with || [],
          has_password: result.has_password || false
        });
        setShareEmails(result.shared_with?.join(', ') || '');
      }
    } catch {
      setShareInfo(null);
    }
  };

  const handleSelectSpace = (space: Space) => {
    setSelectedSpace(space);
    setContentFilter('all');
    setViewMode('tree');
    setCurrentFolderId(null);
    setFolderPath([]);
    onSelectSpace?.(space);
    loadSpaceItems(space);
    loadFolderTree(space);
    loadShareInfo(space.id);
  };

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) return;
    setIsCreatingSpace(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_create', {
        name: newSpaceName,
        type: newSpaceType,
        description: newSpaceDesc
      });
      if (result?.ok) {
        setToastMessage('Space created');
        setNewSpaceName("");
        setNewSpaceDesc("");
        setIsCreateSpaceOpen(false);
        fetchSpaces();
      } else {
        setToastMessage('Failed to create space');
      }
    } catch {
      setToastMessage('Error creating space');
    } finally {
      setIsCreatingSpace(false);
    }
  };

  const handleAddItem = async () => {
    if (!selectedSpace || !newItemContent.trim()) return;
    setIsAddingItem(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_item_add', {
        space_id: selectedSpace.id,
        type: newItemType,
        content: newItemContent,
        title: newItemTitle || undefined,
        parent_id: currentFolderId || undefined
      });
      if (result?.ok) {
        setToastMessage('Added to space');
        setNewItemContent("");
        setNewItemTitle("");
        setIsAddItemOpen(false);
        loadSpaceItems(selectedSpace);
        loadFolderTree(selectedSpace);
      } else {
        setToastMessage('Failed to add item');
      }
    } catch {
      setToastMessage('Error adding item');
    } finally {
      setIsAddingItem(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!selectedSpace || !newFolderName.trim()) return;
    setIsCreatingFolder(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_folder_create', {
        space_id: selectedSpace.id,
        name: newFolderName,
        parent_id: currentFolderId || undefined
      });
      if (result?.ok) {
        setToastMessage('Folder created');
        setNewFolderName("");
        setIsCreateFolderOpen(false);
        loadSpaceItems(selectedSpace);
        loadFolderTree(selectedSpace);
      } else {
        setToastMessage('Failed to create folder');
      }
    } catch {
      setToastMessage('Error creating folder');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleShare = async () => {
    if (!selectedSpace) return;
    setIsUpdatingShare(true);
    try {
      const emails = shareEmails.split(',').map(e => e.trim()).filter(e => e);
      const result = await (window as any).desktopAPI?.execTool?.('space_share', {
        space_id: selectedSpace.id,
        shared_with: emails,
        password: sharePassword || undefined
      });
      if (result?.ok) {
        setToastMessage('Sharing updated');
        setIsShareOpen(false);
        loadShareInfo(selectedSpace.id);
      } else {
        setToastMessage('Failed to update sharing');
      }
    } catch {
      setToastMessage('Error updating sharing');
    } finally {
      setIsUpdatingShare(false);
    }
  };

  const handleUnshare = async () => {
    if (!selectedSpace) return;
    setIsUpdatingShare(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_unshare', {
        space_id: selectedSpace.id
      });
      if (result?.ok) {
        setToastMessage('Sharing disabled');
        setShareInfo({ is_shared: false, shared_with: [], has_password: false });
        setShareEmails("");
        setSharePassword("");
      }
    } catch {
      setToastMessage('Error disabling sharing');
    } finally {
      setIsUpdatingShare(false);
    }
  };

  const handleMoveItem = async (targetFolderId: string | null) => {
    if (!selectedSpace || !itemToMove) return;
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_item_move', {
        item_id: itemToMove.id,
        parent_id: targetFolderId === null ? '' : targetFolderId
      });
      if (result?.ok) {
        setToastMessage('Item moved');
        setIsMoveItemOpen(false);
        setItemToMove(null);
        loadSpaceItems(selectedSpace);
        loadFolderTree(selectedSpace);
      } else {
        setToastMessage('Failed to move item');
      }
    } catch {
      setToastMessage('Error moving item');
    }
  };

  const handleFolderClick = (folder: SpaceItem) => {
    setCurrentFolderId(folder.id);
    setFolderPath([...folderPath, folder]);
  };

  const handleNavigateUp = () => {
    if (folderPath.length > 0) {
      const newPath = folderPath.slice(0, -1);
      setFolderPath(newPath);
      setCurrentFolderId(newPath.length > 0 ? newPath[newPath.length - 1].id : null);
    }
  };

  const handleItemClick = async (item: SpaceItem) => {
    if (item.type === 'folder') {
      handleFolderClick(item);
    } else if ((item.type === 'link' || item.type === 'source') && item.content.startsWith('http')) {
      await (window as any).desktopAPI?.openExternal?.(item.content);
      setToastMessage('Opened link');
    } else {
      setViewingItem(item);
    }
  };

  const handleEditItem = async () => {
    if (!selectedSpace || !editingItem) return;
    setIsUpdatingItem(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_item_update', {
        item_id: editingItem.id,
        title: editItemTitle || undefined,
        content: editItemContent
      });
      if (result?.ok) {
        setToastMessage('Item updated');
        setIsEditItemOpen(false);
        setEditingItem(null);
        loadSpaceItems(selectedSpace);
        loadFolderTree(selectedSpace);
        // Update viewing item if it's the same item
        if (viewingItem?.id === editingItem.id) {
          setViewingItem({ ...editingItem, title: editItemTitle, content: editItemContent });
        }
      } else {
        setToastMessage('Failed to update item');
      }
    } catch {
      setToastMessage('Error updating item');
    } finally {
      setIsUpdatingItem(false);
    }
  };

  const openEditModal = (item: SpaceItem) => {
    setEditingItem(item);
    setEditItemTitle(item.title || '');
    setEditItemContent(item.content);
    setIsEditItemOpen(true);
  };

  // Filtered data
  const filteredSpaces = useMemo(() =>
    spaces.filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description?.toLowerCase().includes(searchQuery.toLowerCase())
    ), [spaces, searchQuery]
  );

  const groupedSpaces = useMemo(() =>
    filteredSpaces.reduce((acc, space) => {
      if (!acc[space.type]) acc[space.type] = [];
      acc[space.type].push(space);
      return acc;
    }, {} as Record<string, Space[]>), [filteredSpaces]
  );

  // Items in current folder
  const currentFolderItems = useMemo(() => {
    return items.filter(i => {
      if (currentFolderId === null) {
        return !i.parent_id;
      }
      return i.parent_id === currentFolderId;
    });
  }, [items, currentFolderId]);

  const filteredItems = useMemo(() => {
    let result = currentFolderItems;
    if (contentFilter === 'notes') {
      result = result.filter(i => i.type === 'note' || i.type === 'fact');
    } else if (contentFilter === 'links') {
      result = result.filter(i => i.type === 'link' || i.type === 'source');
    } else if (contentFilter === 'code') {
      result = result.filter(i => i.type === 'snippet');
    }
    // Sort: folders first, pinned, then by position/date
    return result.sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.position !== undefined && b.position !== undefined) {
        return a.position - b.position;
      }
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });
  }, [currentFolderItems, contentFilter]);

  const itemCounts = useMemo(() => ({
    all: currentFolderItems.length,
    notes: currentFolderItems.filter(i => i.type === 'note' || i.type === 'fact').length,
    links: currentFolderItems.filter(i => i.type === 'link' || i.type === 'source').length,
    code: currentFolderItems.filter(i => i.type === 'snippet').length,
  }), [currentFolderItems]);

  const folders = useMemo(() =>
    items.filter(i => i.type === 'folder'),
    [items]
  );

  const typeLabels: Record<string, string> = {
    project: 'Projects', topic: 'Topics', research: 'Research',
    reference: 'Reference', custom: 'Custom'
  };

  const toggleType = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(folderId) ? next.delete(folderId) : next.add(folderId);
      return next;
    });
  };

  // Render
  return (
    <div className={clsx(
      "flex h-full rounded-2xl overflow-hidden transition-all duration-300 border border-theme relative",
      translucentMode ? "bg-theme-card/80 backdrop-blur-2xl" : "bg-theme-bg",
      className
    )}>
      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="bg-theme-fg text-theme-bg text-xs font-medium px-4 py-2 rounded-full flex items-center gap-2 shadow-lg">
              <Check className="w-3.5 h-3.5" />
              {toastMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Space Modal */}
      <AnimatePresence>
        {isCreateSpaceOpen && (
          <Modal isOpen={isCreateSpaceOpen} onClose={() => setIsCreateSpaceOpen(false)} title="Create Space">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Name</label>
                <input
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="e.g. Product Launch 2024"
                  value={newSpaceName}
                  onChange={e => setNewSpaceName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['project', 'topic', 'research'] as const).map(t => {
                    const accent = getSpaceAccent(t);
                    return (
                      <button
                        key={t}
                        onClick={() => setNewSpaceType(t)}
                        className={clsx(
                          "px-3 py-2.5 rounded-xl text-xs font-medium border-2 transition-all flex items-center justify-center gap-2",
                          newSpaceType === t
                            ? `${accent.bg} ${accent.text} ${accent.border}`
                            : "bg-theme-hover border-transparent text-theme-muted hover:border-theme"
                        )}
                      >
                        <SpaceTypeIcon type={t} className="w-3.5 h-3.5" />
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Description <span className="opacity-50">(optional)</span></label>
                <textarea
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none h-20 transition-all"
                  placeholder="What is this space about?"
                  value={newSpaceDesc}
                  onChange={e => setNewSpaceDesc(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsCreateSpaceOpen(false)}
                  className="px-4 py-2.5 text-sm font-medium text-theme-muted hover:bg-theme-hover rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSpace}
                  disabled={!newSpaceName.trim() || isCreatingSpace}
                  className="px-5 py-2.5 text-sm font-medium text-primary-fg bg-primary hover:opacity-90 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isCreatingSpace && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Add Item Modal */}
      <AnimatePresence>
        {isAddItemOpen && (
          <Modal isOpen={isAddItemOpen} onClose={() => setIsAddItemOpen(false)} title="Add to Space">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Type</label>
                <div className="flex gap-2">
                  {[
                    { id: 'note', label: 'Note', icon: FileText },
                    { id: 'link', label: 'Link', icon: Link2 },
                    { id: 'snippet', label: 'Code', icon: Code }
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setNewItemType(t.id as any)}
                      className={clsx(
                        "flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium border-2 transition-all",
                        newItemType === t.id
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : "bg-theme-hover border-transparent text-theme-muted hover:border-theme"
                      )}
                    >
                      <t.icon className="w-4 h-4" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              {currentFolderId && (
                <div className="flex items-center gap-2 text-xs text-theme-muted bg-theme-hover rounded-lg px-3 py-2">
                  <Folder className="w-3.5 h-3.5" />
                  Adding to: {folderPath[folderPath.length - 1]?.title || 'Current folder'}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Title <span className="opacity-50">(optional)</span></label>
                <input
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="Give it a title..."
                  value={newItemTitle}
                  onChange={e => setNewItemTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Content</label>
                <textarea
                  className={clsx(
                    "w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none h-32 transition-all",
                    newItemType === 'snippet' && "font-mono text-xs"
                  )}
                  placeholder={newItemType === 'link' ? "https://..." : newItemType === 'snippet' ? "Paste your code..." : "Write your note..."}
                  value={newItemContent}
                  onChange={e => setNewItemContent(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsAddItemOpen(false)}
                  className="px-4 py-2.5 text-sm font-medium text-theme-muted hover:bg-theme-hover rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddItem}
                  disabled={!newItemContent.trim() || isAddingItem}
                  className="px-5 py-2.5 text-sm font-medium text-primary-fg bg-primary hover:opacity-90 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isAddingItem && <Loader2 className="w-4 h-4 animate-spin" />}
                  Add
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Create Folder Modal */}
      <AnimatePresence>
        {isCreateFolderOpen && (
          <Modal isOpen={isCreateFolderOpen} onClose={() => setIsCreateFolderOpen(false)} title="Create Folder">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Folder Name</label>
                <input
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="e.g. Research Notes"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  autoFocus
                />
              </div>
              {currentFolderId && (
                <div className="flex items-center gap-2 text-xs text-theme-muted bg-theme-hover rounded-lg px-3 py-2">
                  <Folder className="w-3.5 h-3.5" />
                  Creating in: {folderPath[folderPath.length - 1]?.title || 'Current folder'}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsCreateFolderOpen(false)}
                  className="px-4 py-2.5 text-sm font-medium text-theme-muted hover:bg-theme-hover rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim() || isCreatingFolder}
                  className="px-5 py-2.5 text-sm font-medium text-primary-fg bg-primary hover:opacity-90 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isCreatingFolder && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Share Modal */}
      <AnimatePresence>
        {isShareOpen && selectedSpace && (
          <Modal isOpen={isShareOpen} onClose={() => setIsShareOpen(false)} title="Share Space">
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-theme-hover/50 rounded-xl">
                <div className={clsx("w-10 h-10 rounded-lg flex items-center justify-center", getSpaceAccent(selectedSpace.type).bg)}>
                  <SpaceTypeIcon type={selectedSpace.type} className={clsx("w-5 h-5", getSpaceAccent(selectedSpace.type).text)} />
                </div>
                <div>
                  <h4 className="text-sm font-medium text-theme-fg">{selectedSpace.name}</h4>
                  <p className="text-xs text-theme-muted">
                    {shareInfo?.is_shared ? 'Currently shared' : 'Not shared'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Share with (emails)</label>
                <input
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="email1@example.com, email2@example.com"
                  value={shareEmails}
                  onChange={e => setShareEmails(e.target.value)}
                />
                <p className="text-[10px] text-theme-muted mt-1">Separate multiple emails with commas</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">
                  Password protection <span className="opacity-50">(optional)</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted" />
                  <input
                    type="password"
                    className="w-full bg-theme-hover border border-theme rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    placeholder={shareInfo?.has_password ? "Leave blank to keep current" : "Set a password..."}
                    value={sharePassword}
                    onChange={e => setSharePassword(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-between pt-2">
                {shareInfo?.is_shared && (
                  <button
                    onClick={handleUnshare}
                    disabled={isUpdatingShare}
                    className="px-4 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
                  >
                    Stop Sharing
                  </button>
                )}
                <div className="flex gap-2 ml-auto">
                  <button
                    onClick={() => setIsShareOpen(false)}
                    className="px-4 py-2.5 text-sm font-medium text-theme-muted hover:bg-theme-hover rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleShare}
                    disabled={!shareEmails.trim() || isUpdatingShare}
                    className="px-5 py-2.5 text-sm font-medium text-primary-fg bg-primary hover:opacity-90 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isUpdatingShare && <Loader2 className="w-4 h-4 animate-spin" />}
                    {shareInfo?.is_shared ? 'Update' : 'Share'}
                  </button>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Edit Item Modal */}
      <AnimatePresence>
        {isEditItemOpen && editingItem && (
          <Modal isOpen={isEditItemOpen} onClose={() => { setIsEditItemOpen(false); setEditingItem(null); }} title="Edit Item">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Title <span className="opacity-50">(optional)</span></label>
                <input
                  className="w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="Give it a title..."
                  value={editItemTitle}
                  onChange={e => setEditItemTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-muted mb-2">Content</label>
                <textarea
                  className={clsx(
                    "w-full bg-theme-hover border border-theme rounded-xl px-3.5 py-2.5 text-sm text-theme-fg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none h-32 transition-all",
                    editingItem.type === 'snippet' && "font-mono text-xs"
                  )}
                  placeholder={editingItem.type === 'link' ? "https://..." : editingItem.type === 'snippet' ? "Paste your code..." : "Write your note..."}
                  value={editItemContent}
                  onChange={e => setEditItemContent(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => { setIsEditItemOpen(false); setEditingItem(null); }}
                  className="px-4 py-2.5 text-sm font-medium text-theme-muted hover:bg-theme-hover rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditItem}
                  disabled={!editItemContent.trim() || isUpdatingItem}
                  className="px-5 py-2.5 text-sm font-medium text-primary-fg bg-primary hover:opacity-90 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isUpdatingItem && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Move Item Modal */}
      <AnimatePresence>
        {isMoveItemOpen && itemToMove && (
          <Modal isOpen={isMoveItemOpen} onClose={() => { setIsMoveItemOpen(false); setItemToMove(null); }} title="Move to Folder">
            <div className="space-y-4">
              <p className="text-sm text-theme-muted">
                Moving: <span className="text-theme-fg font-medium">{itemToMove.title || 'Untitled'}</span>
              </p>

              <div className="max-h-64 overflow-y-auto border border-theme rounded-xl">
                {/* Root option */}
                <button
                  onClick={() => handleMoveItem(null)}
                  className={clsx(
                    "w-full flex items-center gap-2 px-3 py-2.5 hover:bg-theme-hover transition-colors text-left",
                    itemToMove.parent_id === null && "bg-primary/10"
                  )}
                >
                  <FolderOpen className="w-4 h-4 text-theme-muted" />
                  <span className="text-sm text-theme-fg">Root (no folder)</span>
                </button>

                {/* Folder options */}
                {folders.filter(f => f.id !== itemToMove.id).map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => handleMoveItem(folder.id)}
                    className={clsx(
                      "w-full flex items-center gap-2 px-3 py-2.5 hover:bg-theme-hover transition-colors text-left border-t border-theme",
                      itemToMove.parent_id === folder.id && "bg-primary/10"
                    )}
                  >
                    <Folder className="w-4 h-4 text-yellow-600" />
                    <span className="text-sm text-theme-fg">{folder.title || 'Untitled Folder'}</span>
                  </button>
                ))}

                {folders.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-theme-muted">
                    No folders yet. Create one first.
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => { setIsMoveItemOpen(false); setItemToMove(null); }}
                  className="px-4 py-2.5 text-sm font-medium text-theme-muted hover:bg-theme-hover rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Spaces List View */}
      <div className={clsx(
        "absolute inset-0 w-full flex flex-col transition-transform duration-300 ease-out z-10",
        selectedSpace ? "-translate-x-full" : "translate-x-0"
      )}>
        {/* Header */}
        <div className="px-4 py-4 flex items-center justify-between flex-shrink-0 border-b border-theme">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-fg" />
            </div>
            <span className="font-semibold text-theme-fg text-[15px]">Spaces</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsCreateSpaceOpen(true)}
              className="p-2 hover:bg-primary/10 text-theme-muted hover:text-primary rounded-xl transition-colors"
              title="New Space"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-theme-hover rounded-xl text-theme-muted hover:text-theme-fg transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-muted" />
            <input
              className="w-full bg-theme-hover hover:bg-theme-active border border-transparent focus:bg-theme-card focus:border-theme rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-theme-fg outline-none transition-all placeholder:text-theme-muted"
              placeholder="Search spaces..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Space List */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 slick-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="text-xs text-theme-muted mt-2">Loading...</span>
            </div>
          ) : error ? (
            <EmptyState title="Error" description={error} icon={Archive} />
          ) : filteredSpaces.length === 0 ? (
            <EmptyState
              title={searchQuery ? "No results" : "No spaces yet"}
              description={searchQuery ? "Try a different search" : "Create your first space to get started"}
              icon={searchQuery ? Search : FolderOpen}
              action={!searchQuery && (
                <button
                  onClick={() => setIsCreateSpaceOpen(true)}
                  className="text-xs font-medium text-primary hover:opacity-80 bg-primary/10 px-4 py-2 rounded-xl transition-colors"
                >
                  Create Space
                </button>
              )}
            />
          ) : (
            Object.entries(groupedSpaces).map(([type, typeSpaces]) => (
              <div key={type} className="mb-3">
                <button
                  onClick={() => toggleType(type)}
                  className="flex items-center gap-2 px-2 py-2 w-full text-left text-[11px] font-semibold text-theme-muted uppercase tracking-wider hover:text-theme-fg transition-colors"
                >
                  {expandedTypes.has(type) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  {typeLabels[type] || type}
                  <span className="ml-auto text-[10px] font-medium bg-theme-hover px-1.5 py-0.5 rounded-full">
                    {typeSpaces.length}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {expandedTypes.has(type) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-1">
                        {typeSpaces.map(space => (
                          <SpaceListItem
                            key={space.id}
                            space={space}
                            isSelected={selectedSpace?.id === space.id}
                            onSelect={() => handleSelectSpace(space)}
                            onShare={() => { handleSelectSpace(space); setIsShareOpen(true); }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Space Detail View */}
      <div className={clsx(
        "absolute inset-0 w-full flex flex-col bg-theme-card transition-transform duration-300 ease-out z-20",
        selectedSpace ? "translate-x-0" : "translate-x-full"
      )}>
        {selectedSpace && (
          <>
            {/* Space Header */}
            <div className="px-5 py-4 flex-shrink-0 border-b border-theme">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => { setSelectedSpace(null); setViewingItem(null); setCurrentFolderId(null); setFolderPath([]); }}
                  className="flex items-center gap-2 text-theme-muted hover:text-theme-fg transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-xs font-medium">Back</span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsCreateFolderOpen(true)}
                    className="p-2 hover:bg-theme-hover rounded-xl text-theme-muted hover:text-theme-fg transition-colors"
                    title="New Folder"
                  >
                    <FolderPlus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setIsShareOpen(true)}
                    className={clsx(
                      "p-2 rounded-xl transition-colors",
                      shareInfo?.is_shared
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-theme-hover text-theme-muted hover:text-theme-fg"
                    )}
                    title="Share"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setIsAddItemOpen(true)}
                    className="p-2 bg-primary hover:opacity-90 text-primary-fg rounded-xl transition-all"
                    title="Add Item"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onClose}
                    className="p-2 hover:bg-theme-hover rounded-xl text-theme-muted hover:text-theme-fg transition-colors"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className={clsx("w-11 h-11 rounded-xl flex items-center justify-center", getSpaceAccent(selectedSpace.type).bg)}>
                  <SpaceTypeIcon type={selectedSpace.type} className={clsx("w-5 h-5", getSpaceAccent(selectedSpace.type).text)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="text-lg font-semibold text-theme-fg truncate">{selectedSpace.name}</h1>
                    {shareInfo?.is_shared && (
                      <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">Shared</span>
                    )}
                  </div>
                  <p className="text-xs text-theme-muted mt-0.5">
                    {items.length} item{items.length !== 1 ? 's' : ''}
                    {selectedSpace.description && ` · ${selectedSpace.description}`}
                  </p>
                </div>
              </div>

              {/* Breadcrumb for folder navigation */}
              {folderPath.length > 0 && (
                <div className="flex items-center gap-1 mt-3 text-xs">
                  <button
                    onClick={() => { setCurrentFolderId(null); setFolderPath([]); }}
                    className="text-theme-muted hover:text-theme-fg transition-colors"
                  >
                    Root
                  </button>
                  {folderPath.map((folder, idx) => (
                    <React.Fragment key={folder.id}>
                      <ChevronRight className="w-3 h-3 text-theme-muted" />
                      <button
                        onClick={() => {
                          const newPath = folderPath.slice(0, idx + 1);
                          setFolderPath(newPath);
                          setCurrentFolderId(folder.id);
                        }}
                        className={clsx(
                          "transition-colors",
                          idx === folderPath.length - 1
                            ? "text-theme-fg font-medium"
                            : "text-theme-muted hover:text-theme-fg"
                        )}
                      >
                        {folder.title || 'Folder'}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-1 p-1 bg-theme-hover/50 rounded-xl">
                  <FilterTab label="All" count={itemCounts.all} isActive={contentFilter === 'all'} onClick={() => setContentFilter('all')} />
                  <FilterTab label="Notes" count={itemCounts.notes} isActive={contentFilter === 'notes'} onClick={() => setContentFilter('notes')} />
                  <FilterTab label="Links" count={itemCounts.links} isActive={contentFilter === 'links'} onClick={() => setContentFilter('links')} />
                  <FilterTab label="Code" count={itemCounts.code} isActive={contentFilter === 'code'} onClick={() => setContentFilter('code')} />
                </div>
                <div className="flex items-center gap-1 p-1 bg-theme-hover/50 rounded-xl">
                  <button
                    onClick={() => setViewMode('tree')}
                    className={clsx(
                      "p-1.5 rounded-lg transition-all",
                      viewMode === 'tree' ? "bg-theme-card shadow-sm text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                    )}
                    title="Tree View"
                  >
                    <FolderTree className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={clsx(
                      "p-1.5 rounded-lg transition-all",
                      viewMode === 'list' ? "bg-theme-card shadow-sm text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                    )}
                    title="List View"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 slick-scrollbar">
              {itemsLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              ) : viewMode === 'tree' && treeItems.length > 0 ? (
                <div className="space-y-0.5">
                  {treeItems.map(item => (
                    <TreeItem
                      key={item.id}
                      item={item}
                      depth={0}
                      expandedIds={expandedFolders}
                      onToggle={toggleFolder}
                      onClick={() => handleItemClick(item)}
                      onMove={item.type !== 'folder' ? (itemId, newParentId) => {
                        // Handle drag and drop if implemented, or context menu move
                        setItemToMove(item); setIsMoveItemOpen(true);
                      } : undefined}
                      selectedId={viewingItem?.id}
                    />
                  ))}
                </div>
              ) : filteredItems.length === 0 ? (
                <EmptyState
                  title={contentFilter !== 'all' ? `No ${contentFilter}` : currentFolderId ? "Empty folder" : "Empty space"}
                  description={contentFilter !== 'all' ? `No ${contentFilter} here yet` : "Add your first item to get started"}
                  icon={currentFolderId ? Folder : contentFilter === 'notes' ? FileText : contentFilter === 'links' ? Link2 : contentFilter === 'code' ? Code : Briefcase}
                  action={
                    <button
                      onClick={() => setIsAddItemOpen(true)}
                      className="text-xs font-medium text-primary hover:opacity-80 bg-primary/10 px-4 py-2 rounded-xl transition-colors"
                    >
                      Add {contentFilter === 'all' ? 'Item' : contentFilter.slice(0, -1)}
                    </button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {filteredItems.map(item => (
                    <ContentCard
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item)}
                      onMoveToFolder={item.type !== 'folder' ? () => { setItemToMove(item); setIsMoveItemOpen(true); } : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Item Detail View */}
      <div className={clsx(
        "absolute inset-0 w-full flex flex-col bg-theme-card transition-transform duration-300 ease-out z-30 overflow-hidden",
        viewingItem ? "translate-x-0" : "translate-x-full"
      )}>
        {viewingItem && (
          <>
            <div className="px-5 py-4 flex-shrink-0 border-b border-theme">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setViewingItem(null)}
                  className="flex items-center gap-2 text-theme-muted hover:text-theme-fg transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="text-xs font-medium">Back</span>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditModal(viewingItem)}
                    className="p-2 hover:bg-theme-hover rounded-xl text-theme-muted hover:text-theme-fg transition-colors"
                    title="Edit"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(viewingItem.content);
                      setToastMessage('Copied to clipboard');
                    }}
                    className="p-2 hover:bg-theme-hover rounded-xl text-theme-muted hover:text-theme-fg transition-colors"
                    title="Copy"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  {(viewingItem.type === 'link' || viewingItem.type === 'source') && viewingItem.content.startsWith('http') && (
                    <button
                      onClick={() => (window as any).desktopAPI?.openExternal?.(viewingItem.content)}
                      className="p-2 hover:bg-theme-hover rounded-xl text-theme-muted hover:text-theme-fg transition-colors"
                      title="Open"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-b border-theme">
              <div className="flex items-start gap-3">
                <div className={clsx(
                  "w-10 h-10 rounded-xl flex items-center justify-center",
                  viewingItem.type === 'note' ? "bg-blue-500/10 text-blue-500" :
                    viewingItem.type === 'snippet' ? "bg-amber-500/10 text-amber-500" :
                      "bg-emerald-500/10 text-emerald-500"
                )}>
                  <ItemIcon type={viewingItem.type} className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-lg font-semibold text-theme-fg">
                    {viewingItem.title || 'Untitled'}
                  </h1>
                  <div className="flex items-center gap-2 mt-1 text-xs text-theme-muted">
                    <span className="capitalize px-1.5 py-0.5 rounded bg-theme-hover">{viewingItem.type}</span>
                    {viewingItem.updated_at && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(viewingItem.updated_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {viewingItem.type === 'file' ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4 border border-dashed border-theme rounded-2xl bg-theme-hover/30">
                  {getFileIcon(viewingItem.content, "w-16 h-16 text-theme-muted")}
                  <div className="text-center">
                    <p className="font-medium text-theme-fg mb-1">
                      {viewingItem.title || viewingItem.content.split('/').pop() || 'File'}
                    </p>
                    <p className="text-sm text-theme-muted break-all px-4">{viewingItem.content}</p>
                  </div>
                  <button
                    onClick={() => (window as any).desktopAPI?.openExternal?.(viewingItem.content)}
                    className="px-6 py-2.5 bg-primary hover:opacity-90 text-primary-fg rounded-xl text-sm font-medium transition-colors"
                  >
                    Open File
                  </button>
                </div>
              ) : viewingItem.type === 'snippet' ? (
                <pre className="bg-theme-hover/50 rounded-xl p-4 text-sm font-mono text-theme-fg overflow-x-auto">
                  {viewingItem.content.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim()}
                </pre>
              ) : (
                <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-theme-fg prose-p:text-theme-fg prose-a:text-primary prose-pre:bg-theme-hover prose-pre:text-theme-fg prose-code:text-theme-fg prose-strong:text-theme-fg">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {viewingItem.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SpacesSidebar;
