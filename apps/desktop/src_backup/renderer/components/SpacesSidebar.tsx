import React, { useState, useEffect, useMemo, useRef } from 'react';
import { XTerminalPanel } from './XTerminalPanel';
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
  Grid,
  List,
  Filter,
  SortAsc,
  Trash2,
  Edit3,
  Settings,
  ChevronRight,
  ChevronDown,
  Layout,
  X,
  ArrowLeft,
  Eye,
  Download,
  FileImage,
  FileVideo,
  FileAudio,
  Terminal
} from 'lucide-react';
import { clsx } from 'clsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Types matching the actual API
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
  type: 'note' | 'source' | 'link' | 'file' | 'fact' | 'snippet';
  title?: string | null;
  content: string;
  added_by?: string;
  pinned?: boolean;
  created_at?: string;
  updated_at?: string;
}

type SidebarTab = 'spaces' | 'terminal' | 'system';

interface SpacesSidebarProps {
  className?: string;
  translucentMode?: boolean;
  onSelectSpace?: (space: Space) => void;
  onClose?: () => void;
  accessToken?: string | null;
}

// --- Icons & Helpers ---

const SpaceTypeIcon: React.FC<{ type: Space['type']; className?: string }> = ({ type, className }) => {
  switch (type) {
    case 'project': return <Briefcase className={className} />;
    case 'topic': return <BookOpen className={className} />;
    case 'research': return <Lightbulb className={className} />;
    case 'reference': return <Archive className={className} />;
    default: return <FolderOpen className={className} />;
  }
};

const getSpaceColor = (type: Space['type']) => {
  switch (type) {
    case 'project': return 'text-blue-600 bg-blue-50 border-blue-100';
    case 'topic': return 'text-purple-600 bg-purple-50 border-purple-100';
    case 'research': return 'text-amber-600 bg-amber-50 border-amber-100';
    case 'reference': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
    default: return 'text-slate-600 bg-slate-50 border-slate-100';
  }
};

const getSpaceColorLight = (type: Space['type']) => {
   switch (type) {
    case 'project': return 'text-blue-500';
    case 'topic': return 'text-purple-500';
    case 'research': return 'text-amber-500';
    case 'reference': return 'text-emerald-500';
    default: return 'text-slate-500';
  }
}

const SpaceItemIcon: React.FC<{ type: SpaceItem['type']; className?: string }> = ({ type, className }) => {
  switch (type) {
    case 'note': return <FileText className={className} />;
    case 'link': return <Link2 className={className} />;
    case 'source': return <Link2 className={className} />;
    case 'snippet': return <Code className={className} />;
    case 'file': return <File className={className} />;
    default: return <FolderOpen className={className} />;
  }
};

const getFileTypeIcon = (filename: string, className?: string) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return <FileImage className={className} />;
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'mkv':
      return <FileVideo className={className} />;
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
      return <FileAudio className={className} />;
    default:
      return <File className={className} />;
  }
};

// --- Sub-Components ---

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/20 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-theme-card rounded-theme-card w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-theme">
        <div className="flex items-center justify-between p-4 border-b border-theme">
          <h3 className="font-semibold text-theme-fg">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-theme-button hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ message, icon: Icon, action }: { message: string; icon: any; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center justify-center h-full text-theme-muted p-8 text-center animate-in fade-in duration-500">
    <div className="w-16 h-16 rounded-full bg-theme-hover flex items-center justify-center mb-4 border border-theme">
      <Icon className="w-8 h-8 opacity-50" />
    </div>
    <p className="text-sm font-medium text-theme-muted mb-4 max-w-xs">{message}</p>
    {action}
  </div>
);

const SidebarGroup = ({
  title,
  spaces,
  expanded,
  onToggle,
  selectedId,
  onSelect
}: {
  title: string;
  spaces: Space[];
  expanded: boolean;
  onToggle: () => void;
  selectedId?: string;
  onSelect: (s: Space) => void;
}) => {
  if (spaces.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 py-2 w-full text-left text-[11px] font-bold text-theme-muted uppercase tracking-wider hover:text-theme-fg transition-colors group"
      >
        <span className="flex items-center gap-1.5">
           {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
           {title}
        </span>
        <span className="ml-auto text-[10px] font-medium bg-theme-hover text-theme-muted px-1.5 py-0.5 rounded-full group-hover:bg-theme-active transition-colors">
          {spaces.length}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 px-2">
              {spaces.map(space => (
                <div
                  key={space.id}
                  onClick={() => onSelect(space)}
                  className={clsx(
                    "group flex items-center gap-3 px-3 py-2 rounded-theme-button cursor-pointer transition-all text-[13px] select-none border border-transparent",
                    selectedId === space.id
                      ? "bg-theme-card text-theme-fg font-medium border-theme"
                      : "hover:bg-theme-hover text-theme-muted hover:text-theme-fg"
                  )}
                >
                  <SpaceTypeIcon
                    type={space.type}
                    className={clsx(
                      "w-4 h-4 flex-shrink-0 transition-opacity",
                      selectedId === space.id ? "opacity-100" : "opacity-70 group-hover:opacity-100",
                      getSpaceColorLight(space.type)
                    )}
                  />
                  <span className="flex-1 truncate">{space.name}</span>

                  {/* Context Menu Trigger */}
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        className={clsx(
                          "p-0.5 rounded opacity-0 transition-all",
                          selectedId === space.id ? "opacity-0 group-hover:opacity-100" : "group-hover:opacity-100",
                          "hover:bg-theme-active text-theme-muted hover:text-theme-fg"
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className="z-[10005] min-w-[160px] bg-theme-card rounded-theme-card border border-theme p-1.5 animate-in fade-in zoom-in-95 duration-100" align="end">
                        <DropdownMenu.Item className="text-[13px] px-2 py-1.5 rounded-theme-button hover:bg-theme-hover outline-none cursor-pointer flex items-center gap-2 text-theme-muted">
                          <Edit3 className="w-3.5 h-3.5" /> Rename
                        </DropdownMenu.Item>
                        <DropdownMenu.Item className="text-[13px] px-2 py-1.5 rounded-theme-button hover:bg-theme-hover outline-none cursor-pointer flex items-center gap-2 text-theme-muted">
                          <Archive className="w-3.5 h-3.5" /> Archive
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="h-px bg-theme-hover my-1" />
                        <DropdownMenu.Item className="text-[13px] px-2 py-1.5 rounded-theme-button hover:bg-red-500/10 outline-none cursor-pointer text-red-500 flex items-center gap-2">
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Main Component ---

export const SpacesSidebar: React.FC<SpacesSidebarProps> = ({
  className,
  translucentMode,
  onSelectSpace,
  onClose,
  accessToken
}) => {
  // State
  const [activeTab, setActiveTab] = useState<SidebarTab>('spaces');
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);
  
  const [items, setItems] = useState<SpaceItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(['project', 'topic', 'research', 'reference', 'custom']));
  
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Modal States
  const [isCreateSpaceOpen, setIsCreateSpaceOpen] = useState(false);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isViewItemOpen, setIsViewItemOpen] = useState(false);
  const [viewingItem, setViewingItem] = useState<SpaceItem | null>(null);
  
  const [newSpaceName, setNewSpaceName] = useState("");
  const [newSpaceType, setNewSpaceType] = useState<Space['type']>('topic');
  const [newSpaceDesc, setNewSpaceDesc] = useState("");
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);

  const [newItemContent, setNewItemContent] = useState("");
  const [newItemTitle, setNewItemTitle] = useState("");
  const [newItemType, setNewItemType] = useState<SpaceItem['type']>('note');
  const [isAddingItem, setIsAddingItem] = useState(false);

  // --- Effects ---

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const fetchSpaces = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_list', { limit: 50 });
      if (result?.ok && Array.isArray(result?.spaces)) {
        setSpaces(result.spaces);
        // If we have a selected space, refresh it to check if it still exists or was updated
        if (selectedId) {
          const updated = result.spaces.find((s: Space) => s.id === selectedId);
          if (updated) setSelectedSpace(updated);
        }
      }
      else if (result?.error) setError(String(result.error));
    } catch (err) {
      console.error('Failed to fetch spaces:', err);
      setError('Failed to load spaces');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSpaces();
  }, [accessToken]);

  // --- Actions ---

  const showToast = (msg: string) => setToastMessage(msg);

  const loadSpaceItems = async (space: Space) => {
    setItemsLoading(true);
    setItemsError(null);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('space_item_list', { space_id: space.id, limit: 200 });
      if (result?.ok && Array.isArray(result?.items)) {
        setItems(result.items);
      } else {
        setItems([]);
        if (result?.error) setItemsError(String(result.error));
      }
    } catch (err) {
      console.error('Failed to load items:', err);
      setItemsError('Failed to load space contents');
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  const handleSelect = (space: Space) => {
    if (selectedId === space.id) return;
    setSelectedId(space.id);
    setSelectedSpace(space);
    onSelectSpace?.(space);
    loadSpaceItems(space);
  };

  const toggleType = (type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) return;
    setIsCreatingSpace(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('create_space', {
        name: newSpaceName,
        type: newSpaceType,
        description: newSpaceDesc
      });

      if (result?.ok) {
        showToast('Space created');
        setNewSpaceName("");
        setNewSpaceDesc("");
        setNewSpaceType('topic');
        setIsCreateSpaceOpen(false);
        fetchSpaces();
      } else {
        showToast('Failed to create space');
      }
    } catch (e) {
      showToast('Error creating space');
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
        title: newItemTitle || undefined
      });

      if (result?.ok) {
        showToast('Item added');
        setNewItemContent("");
        setNewItemTitle("");
        setNewItemType('note');
        setIsAddItemOpen(false);
        loadSpaceItems(selectedSpace);
      } else {
        showToast('Failed to add item');
      }
    } catch (e) {
      showToast('Error adding item');
    } finally {
      setIsAddingItem(false);
    }
  };

  const handleItemClick = async (item: SpaceItem) => {
    try {
      // For links/sources that are URLs, open them externally
      if ((item.type === 'link' || item.type === 'source') && item.content.startsWith('http')) {
        await (window as any).desktopAPI?.openExternal?.(item.content);
        showToast('Opened link');
        return;
      }
      
      // For everything else (notes, files, snippets, facts, non-URL links), open the detail view
      setViewingItem(item);
      setIsViewItemOpen(true);
    } catch {
      showToast('Action failed');
    }
  };

  // --- Computations ---

  const filteredSpaces = useMemo(() => spaces.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
  ), [spaces, searchQuery]);

  const groupedSpaces = useMemo(() => filteredSpaces.reduce((acc, space) => {
    if (!acc[space.type]) acc[space.type] = [];
    acc[space.type].push(space);
    return acc;
  }, {} as Record<string, Space[]>), [filteredSpaces]);

  const typeLabels: Record<string, string> = {
    project: 'Projects',
    topic: 'Topics',
    research: 'Research',
    reference: 'Reference',
    custom: 'Custom'
  };

  // --- Render ---

  return (
    <div
      className={clsx(
        "flex h-full rounded-theme-card overflow-hidden transition-all duration-300 border border-theme relative",
        translucentMode
          ? "bg-theme-card/80 backdrop-blur-2xl supports-[backdrop-filter]:bg-theme-card/50"
          : "bg-theme-bg",
        className
      )}
    >
      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="absolute top-6 left-1/2 z-50 pointer-events-none"
          >
            <div className="bg-theme-card/90 text-theme-fg text-xs font-medium px-4 py-2 rounded-full backdrop-blur-md flex items-center gap-2 border border-theme">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              {toastMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Space Modal */}
      <Modal isOpen={isCreateSpaceOpen} onClose={() => setIsCreateSpaceOpen(false)} title="Create New Space">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-theme-muted mb-1.5">Space Name</label>
            <input
              className="w-full bg-theme-hover border border-theme rounded-theme-button px-3 py-2 text-sm text-theme-fg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none"
              placeholder="e.g. Q4 Marketing Plan"
              value={newSpaceName}
              onChange={e => setNewSpaceName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-muted mb-1.5">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {['project', 'topic', 'research'].map(t => (
                <button
                  key={t}
                  onClick={() => setNewSpaceType(t as any)}
                  className={clsx(
                    "px-2 py-2 rounded-theme-button text-xs font-medium border transition-all",
                    newSpaceType === t
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-theme-card border-theme text-theme-muted hover:border-theme-sidebar"
                  )}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-muted mb-1.5">Description (Optional)</label>
            <textarea
              className="w-full bg-theme-hover border border-theme rounded-theme-button px-3 py-2 text-sm text-theme-fg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none resize-none h-20"
              placeholder="What is this space for?"
              value={newSpaceDesc}
              onChange={e => setNewSpaceDesc(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsCreateSpaceOpen(false)}
              className="px-4 py-2 text-sm font-medium text-theme-muted hover:bg-theme-hover rounded-theme-button transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateSpace}
              disabled={!newSpaceName.trim() || isCreatingSpace}
              className="px-4 py-2 text-sm font-medium text-primary-fg bg-primary hover:opacity-90 rounded-theme-button transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isCreatingSpace && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Create Space
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Item Modal */}
      <Modal isOpen={isAddItemOpen} onClose={() => setIsAddItemOpen(false)} title={`Add to ${selectedSpace?.name || 'Space'}`}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-theme-muted mb-1.5">Type</label>
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
                    "flex-1 flex items-center justify-center gap-2 px-2 py-2 rounded-theme-button text-xs font-medium border transition-all",
                    newItemType === t.id
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-theme-card border-theme text-theme-muted hover:border-theme-sidebar"
                  )}
                >
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-muted mb-1.5">Title (Optional)</label>
            <input
              className="w-full bg-theme-hover border border-theme rounded-theme-button px-3 py-2 text-sm text-theme-fg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none"
              placeholder="Give it a title..."
              value={newItemTitle}
              onChange={e => setNewItemTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-muted mb-1.5">Content</label>
            <textarea
              className="w-full bg-theme-hover border border-theme rounded-theme-button px-3 py-2 text-sm text-theme-fg focus:ring-2 focus:ring-primary/10 focus:border-primary outline-none resize-none h-32 font-mono"
              placeholder={newItemType === 'link' ? "https://..." : "Type your note here..."}
              value={newItemContent}
              onChange={e => setNewItemContent(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setIsAddItemOpen(false)}
              className="px-4 py-2 text-sm font-medium text-theme-muted hover:bg-theme-hover rounded-theme-button transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddItem}
              disabled={!newItemContent.trim() || isAddingItem}
              className="px-4 py-2 text-sm font-medium text-primary-fg bg-primary hover:opacity-90 rounded-theme-button transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isAddingItem && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Add Item
            </button>
          </div>
        </div>
      </Modal>

      {/* View Item (In-Place) */}
      {/* We no longer use a modal for viewing items, it is handled in the main render flow */}
      <Modal 
        isOpen={false} // Disabled in favor of in-place view
        onClose={() => { setIsViewItemOpen(false); setViewingItem(null); }} 
        title=""
      >
        {null}
      </Modal>
      {activeTab === 'spaces' ? (
        <>
          <div className={clsx(
            "absolute inset-0 w-full flex flex-col bg-theme-card/50 transition-transform duration-300 ease-in-out z-10",
            selectedSpace ? "-translate-x-full" : "translate-x-0"
          )}>
            <div className="p-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 text-theme-fg font-bold tracking-tight">
                <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-primary-fg">
                  <Layout className="w-4 h-4" />
                </div>
                <span>Spaces</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-theme-card/50 rounded-xl p-0.5 border border-theme">
                  <button
                    onClick={() => setActiveTab('spaces')}
                    className={clsx(
                      "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                      String(activeTab) === 'spaces' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                    )}
                  >
                    Spaces
                  </button>
                  <button
                    onClick={() => setActiveTab('terminal')}
                    className={clsx(
                      "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                      String(activeTab) === 'terminal' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                    )}
                  >
                    Terminal
                  </button>
                  <button
                    onClick={() => setActiveTab('system')}
                    className={clsx(
                      "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                      String(activeTab) === 'system' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                    )}
                  >
                    System
                  </button>
                </div>
                <button
                  onClick={() => setIsCreateSpaceOpen(true)}
                  className="p-1.5 hover:bg-primary/10 text-theme-muted hover:text-primary rounded-theme-button transition-colors"
                  title="Create Space"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 hover:bg-theme-hover rounded-theme-button text-theme-muted hover:text-theme-fg transition-colors"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-3 pb-2 flex-shrink-0">
              <div className="relative group">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-theme-muted group-focus-within:text-primary transition-colors" />
                <input
                  className="w-full bg-theme-hover hover:bg-theme-active border border-transparent focus:bg-theme-card focus:border-primary/30 focus:ring-2 focus:ring-primary/10 rounded-xl pl-8 pr-3 py-2 text-[13px] text-theme-fg outline-none transition-all placeholder:text-theme-muted"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-1 py-2 scrollbar-hide-show">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  <span className="text-xs text-theme-muted">Loading spaces...</span>
                </div>
              ) : error ? (
                <EmptyState message={error} icon={Archive} />
              ) : filteredSpaces.length === 0 ? (
                <EmptyState
                  message={searchQuery ? "No matches found" : "No spaces yet"}
                  icon={searchQuery ? Search : FolderOpen}
                  action={
                    !searchQuery && (
                      <button
                        onClick={() => setIsCreateSpaceOpen(true)}
                        className="mt-2 text-xs font-medium text-primary hover:opacity-80 bg-primary/10 px-3 py-1.5 rounded-full transition-colors"
                      >
                        Create Space
                      </button>
                    )
                  }
                />
              ) : (
                Object.entries(groupedSpaces).map(([type, typeSpaces]) => (
                  <SidebarGroup
                    key={type}
                    title={typeLabels[type] || type}
                    spaces={typeSpaces}
                    expanded={expandedTypes.has(type)}
                    onToggle={() => toggleType(type)}
                    selectedId={selectedId}
                    onSelect={handleSelect}
                  />
                ))
              )}
            </div>

            <div className="p-3 border-t border-theme flex-shrink-0 bg-theme-card/30 backdrop-blur-sm">
              <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-theme-hover cursor-pointer transition-all border border-transparent hover:border-theme group">
                <div className="w-8 h-8 rounded-full bg-theme-hover flex items-center justify-center text-[10px] font-bold text-theme-muted">
                  ME
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-theme-fg leading-tight">My Workspace</div>
                  <div className="text-[11px] text-theme-muted truncate">Standard Plan</div>
                </div>
                <Settings className="w-4 h-4 text-theme-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          </div>

          <div className={clsx(
            "absolute inset-0 w-full flex flex-col bg-theme-bg/50 transition-transform duration-300 ease-in-out z-20 bg-theme-card overflow-y-auto custom-scrollbar",
            selectedSpace ? "translate-x-0" : "translate-x-full"
          )}>
            {!selectedSpace ? (
              <div />
            ) : (
              <>
            {/* Space Header */}
            <div className="px-6 py-6 pb-4 flex-shrink-0 border-b border-theme">
              {/* Back Button */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <button
                     onClick={() => { setSelectedSpace(null); setSelectedId(undefined); }}
                     className="p-1.5 -ml-2 rounded-theme-button hover:bg-theme-hover text-theme-muted transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <span className="text-xs font-medium text-theme-muted uppercase tracking-wider">Back to Spaces</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-theme-card/70 rounded-xl p-0.5 border border-theme">
                    <button
                      onClick={() => setActiveTab('spaces')}
                      className={clsx(
                        "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                        activeTab === 'spaces' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                      )}
                    >
                      Spaces
                    </button>
                    <button
                      onClick={() => setActiveTab('terminal')}
                      className={clsx(
                        "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                        String(activeTab) === 'terminal' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                      )}
                    >
                      Terminal
                    </button>
                    <button
                      onClick={() => setActiveTab('system')}
                      className={clsx(
                        "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                        String(activeTab) === 'system' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                      )}
                    >
                      System
                    </button>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-1.5 hover:bg-theme-hover rounded-theme-button text-theme-muted hover:text-theme-fg transition-colors"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={selectedSpace.id}
                className="flex flex-col gap-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={clsx("w-12 h-12 rounded-xl flex items-center justify-center border", getSpaceColor(selectedSpace.type))}>
                      <SpaceTypeIcon type={selectedSpace.type} className="w-6 h-6" />
                    </div>
                    <div>
                      <h1 className="text-xl font-bold text-theme-fg tracking-tight leading-tight">{selectedSpace.name}</h1>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-theme-hover text-theme-muted">
                          {selectedSpace.type}
                        </span>
                        <span className="text-[11px] text-theme-muted">
                          {items.length} items
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-1">
                    <button
                      onClick={() => setIsAddItemOpen(true)}
                      className="p-2 bg-primary hover:opacity-90 text-primary-fg rounded-xl transition-all active:scale-95"
                      title="Add Item"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button className="p-2 bg-theme-card border border-theme hover:bg-theme-hover text-theme-muted rounded-xl transition-colors">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {selectedSpace.description && (
                  <p className="text-sm text-theme-muted leading-relaxed bg-theme-card/40 p-2.5 rounded-xl border border-theme">
                    {selectedSpace.description}
                  </p>
                )}
              </motion.div>

              {/* View Controls */}
              <div className="flex items-center justify-between mt-6 pt-2">
                <div className="flex gap-4">
                  <button className="text-sm font-medium text-primary border-b-2 border-primary pb-1 -mb-1">All</button>
                  <button className="text-sm font-medium text-theme-muted hover:text-theme-fg transition-colors pb-1">Notes</button>
                  <button className="text-sm font-medium text-theme-muted hover:text-theme-fg transition-colors pb-1">Files</button>
                </div>
                <div className="flex items-center gap-0.5 bg-theme-hover/50 p-0.5 rounded-theme-button border border-theme">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={clsx("p-1.5 rounded-md transition-all", viewMode === 'grid' ? "bg-theme-card text-primary" : "text-theme-muted hover:text-theme-fg")}
                  >
                    <Grid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={clsx("p-1.5 rounded-md transition-all", viewMode === 'list' ? "bg-theme-card text-primary" : "text-theme-muted hover:text-theme-fg")}
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Items Grid/List */}
            <div className="px-6 pb-6 bg-theme-bg/30">
              {itemsLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  <span className="text-xs text-theme-muted">Loading contents...</span>
                </div>
              ) : itemsError ? (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center text-red-500 text-sm">
                  {itemsError}
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  message="This space is empty"
                  icon={Briefcase}
                  action={
                    <button
                      onClick={() => setIsAddItemOpen(true)}
                      className="mt-4 px-4 py-2 bg-theme-card border border-theme text-theme-muted rounded-theme-button text-sm font-medium hover:bg-theme-hover transition-colors"
                    >
                      Create your first note
                    </button>
                  }
                />
              ) : (
                <div className={clsx(
                  "gap-3",
                  viewMode === 'grid' ? "grid grid-cols-1" : "flex flex-col"
                )}>
                  {items.map((item) => (
                    <motion.div
                      key={item.id}
                      layoutId={item.id}
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={() => handleItemClick(item)}
                      className={clsx(
                        "group relative bg-theme-card border border-theme rounded-xl hover:border-primary/30 transition-all cursor-pointer overflow-hidden",
                        viewMode === 'list' ? "flex items-center gap-3 p-3" : "flex flex-col p-3"
                      )}
                    >
                      {item.pinned && (
                        <div className="absolute top-0 right-0 p-2">
                          <Pin className="w-3 h-3 text-amber-500 fill-current" />
                        </div>
                      )}

                      <div className={clsx(
                        "flex items-center justify-center rounded-theme-button bg-theme-hover text-theme-muted",
                        viewMode === 'list' ? "w-8 h-8 flex-shrink-0" : "w-8 h-8 mb-2"
                      )}>
                        <SpaceItemIcon type={item.type} className="w-4 h-4" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-theme-fg truncate mb-0.5 text-[13px]">
                          {item.title || item.content}
                        </div>
                        <div className={clsx(
                          "text-xs text-theme-muted leading-relaxed",
                          viewMode === 'list' ? "truncate" : "line-clamp-3"
                        )}>
                          {item.content}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </>
            )}
          </div>

          {/* Item Detail View (In-Place) */}
          <div className={clsx(
            "absolute inset-0 w-full flex flex-col bg-theme-card transition-transform duration-300 ease-in-out z-30 overflow-y-auto custom-scrollbar",
            viewingItem ? "translate-x-0" : "translate-x-full"
          )}>
            {viewingItem ? (
              <>
                <div className="px-6 py-6 pb-4 flex-shrink-0 border-b border-theme">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <button
                         onClick={() => setViewingItem(null)}
                         className="p-1.5 -ml-2 rounded-theme-button hover:bg-theme-hover text-theme-muted transition-colors"
                      >
                        <ArrowLeft className="w-5 h-5" />
                      </button>
                      <span className="text-xs font-medium text-theme-muted uppercase tracking-wider">Back to {selectedSpace?.name}</span>
                    </div>

                    <div className="flex gap-1">
                      <button
                        onClick={() => navigator.clipboard.writeText(viewingItem.content)}
                        className="p-2 hover:bg-theme-hover rounded-theme-button text-theme-muted hover:text-theme-fg transition-colors"
                        title="Copy content"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      {(viewingItem.type === 'link' || viewingItem.type === 'source') && viewingItem.content.startsWith('http') && (
                        <button
                          onClick={() => (window as any).desktopAPI?.openExternal?.(viewingItem.content)}
                          className="p-2 hover:bg-theme-hover rounded-theme-button text-theme-muted hover:text-theme-fg transition-colors"
                          title="Open link"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                      )}
                      {viewingItem.type === 'file' && (
                        <button
                          onClick={() => (window as any).desktopAPI?.openExternal?.(viewingItem.content)}
                          className="p-2 hover:bg-theme-hover rounded-theme-button text-theme-muted hover:text-theme-fg transition-colors"
                          title="Open file"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                     <div className={clsx("w-12 h-12 rounded-xl flex items-center justify-center border bg-theme-hover border-theme text-theme-muted")}>
                        <SpaceItemIcon type={viewingItem.type} className="w-6 h-6" />
                     </div>
                     <div className="flex-1 min-w-0">
                       <h1 className="text-xl font-bold text-theme-fg tracking-tight leading-tight break-words">
                         {viewingItem.title || 'Untitled Item'}
                       </h1>
                       <div className="flex items-center gap-2 mt-1 text-xs text-theme-muted">
                         <span className="capitalize px-1.5 py-0.5 rounded-md bg-theme-hover">{viewingItem.type}</span>
                         {viewingItem.updated_at && (
                           <span>• Last updated {new Date(viewingItem.updated_at).toLocaleDateString()}</span>
                         )}
                       </div>
                     </div>
                  </div>
                </div>

                <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                  {viewingItem.type === 'file' ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-4 border border-dashed border-theme rounded-theme-card bg-theme-hover/50">
                      {getFileTypeIcon(viewingItem.content, "w-16 h-16 text-theme-muted")}
                      <div className="text-center max-w-sm">
                        <p className="font-medium text-theme-fg mb-1 truncate px-4">
                          {viewingItem.title || viewingItem.content.split('/').pop() || 'File'}
                        </p>
                        <p className="text-sm text-theme-muted break-all px-4">{viewingItem.content}</p>
                      </div>
                      <button
                        onClick={() => (window as any).desktopAPI?.openExternal?.(viewingItem.content)}
                        className="px-6 py-2 bg-primary hover:opacity-90 text-primary-fg rounded-xl text-sm font-medium transition-colors"
                      >
                        Open File
                      </button>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-theme-fg prose-p:text-theme-fg prose-a:text-primary prose-img:rounded-xl prose-pre:bg-theme-hover prose-pre:text-theme-fg prose-pre:rounded-xl prose-code:text-theme-fg prose-strong:text-theme-fg">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {viewingItem.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </>
            ) : <div />}
          </div>

        </>
      ) : activeTab === 'terminal' ? (
        <div className="absolute inset-0 w-full flex flex-col z-20 bg-theme-card">
          <div className="p-4 flex items-center justify-between flex-shrink-0 border-b border-theme">
            <div className="flex items-center gap-2 text-theme-fg font-bold tracking-tight">
              <div className="w-8 h-8 rounded-xl bg-theme-hover flex items-center justify-center text-theme-fg">
                <Terminal className="w-4 h-4" />
              </div>
              <span>Terminal</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-theme-card/50 rounded-xl p-0.5 border border-theme">
                <button
                  onClick={() => setActiveTab('spaces')}
                  className={clsx(
                    "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                    String(activeTab) === 'spaces' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                  )}
                >
                  Spaces
                </button>
                <button
                  onClick={() => setActiveTab('terminal')}
                  className={clsx(
                    "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                    String(activeTab) === 'terminal' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                  )}
                >
                  Terminal
                </button>
                <button
                  onClick={() => setActiveTab('system')}
                  className={clsx(
                    "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                    String(activeTab) === 'system' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                  )}
                >
                  System
                </button>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-theme-hover rounded-theme-button text-theme-muted hover:text-theme-fg transition-colors"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 relative">
             <XTerminalPanel />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 w-full flex flex-col z-20 bg-theme-card/60">
          <div className="p-4 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2 text-theme-fg font-bold tracking-tight">
              <div className="w-8 h-8 rounded-xl bg-theme-hover flex items-center justify-center text-theme-fg">
                <Settings className="w-4 h-4" />
              </div>
              <span>System</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-theme-card/50 rounded-xl p-0.5 border border-theme">
                <button
                  onClick={() => setActiveTab('spaces')}
                  className={clsx(
                    "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                    String(activeTab) === 'spaces' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                  )}
                >
                  Spaces
                </button>
                <button
                  onClick={() => setActiveTab('terminal')}
                  className={clsx(
                    "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                    String(activeTab) === 'terminal' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                  )}
                >
                  Terminal
                </button>
                <button
                  onClick={() => setActiveTab('system')}
                  className={clsx(
                    "px-2.5 py-1.5 text-[12px] font-medium rounded-theme-button transition-colors",
                    String(activeTab) === 'system' ? "bg-theme-card text-theme-fg" : "text-theme-muted hover:text-theme-fg"
                  )}
                >
                  System
                </button>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-theme-hover rounded-theme-button text-theme-muted hover:text-theme-fg transition-colors"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 p-6">
            <div className="text-theme-muted">No system panels yet.</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpacesSidebar;
