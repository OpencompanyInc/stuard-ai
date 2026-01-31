import React, { useState, useEffect, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { 
  Save, 
  Trash2, 
  Copy, 
  FileText, 
  Plus, 
  ChevronRight,
  ChevronLeft,
  MoreHorizontal,
  Check,
  Loader2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Code,
  Quote,
  Link,
  Minus,
  PanelLeftClose,
  PanelLeft
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface CanvasDocument {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface CanvasPanelProps {
  className?: string;
  selectedDocumentId?: string;
  onSelectedDocumentHandled?: () => void;
}

// Formatting button component
const FormatButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
}> = ({ icon, label, shortcut, onClick, active }) => (
  <button
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
    className={clsx(
      "p-1.5 rounded-md transition-all",
      active 
        ? "bg-primary/20 text-primary" 
        : "hover:bg-theme-hover text-theme-muted hover:text-theme-fg"
    )}
  >
    {icon}
  </button>
);

export const CanvasPanel: React.FC<CanvasPanelProps> = ({ className, selectedDocumentId, onSelectedDocumentHandled }) => {
  const [documents, setDocuments] = useState<CanvasDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  // Handle external document selection (from bookmarks)
  useEffect(() => {
    if (selectedDocumentId && documents.length > 0) {
      const doc = documents.find(d => d.id === selectedDocumentId);
      if (doc) {
        setActiveDocId(doc.id);
        setTitle(doc.title);
        setContent(doc.content);
        onSelectedDocumentHandled?.();
      }
    }
  }, [selectedDocumentId, documents, onSelectedDocumentHandled]);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track active formatting states for toolbar highlighting
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  // Load documents on mount
  useEffect(() => {
    loadDocuments();
  }, []);

  // Listen for AI canvas updates
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onCanvasUpdate?.((data: { 
      documentId?: string; 
      content?: string; 
      title?: string;
      action?: 'append' | 'replace' | 'insert';
      position?: number;
    }) => {
      if (data.documentId && data.documentId === activeDocId) {
        if (data.action === 'append') {
          setContent(prev => prev + (data.content || ''));
        } else if (data.action === 'insert' && typeof data.position === 'number') {
          setContent(prev => {
            const before = prev.slice(0, data.position);
            const after = prev.slice(data.position);
            return before + (data.content || '') + after;
          });
        } else {
          // Replace
          if (data.content !== undefined) setContent(data.content);
        }
        if (data.title !== undefined) setTitle(data.title);
        // Trigger auto-save
        triggerAutoSave();
      }
    });
    return () => { try { (typeof unsub === 'function') && unsub(); } catch { } };
  }, [activeDocId]);

  // Listen for AI requesting canvas content
  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onCanvasRead?.((data: { requestId: string }) => {
      // Respond with current canvas content
      (window as any).desktopAPI?.canvasReadResponse?.({
        requestId: data.requestId,
        documentId: activeDocId,
        title,
        content,
      });
    });
    return () => { try { (typeof unsub === 'function') && unsub(); } catch { } };
  }, [activeDocId, title, content]);

  const loadDocuments = async () => {
    try {
      const result = await (window as any).desktopAPI?.canvasListDocuments?.();
      if (result?.ok && Array.isArray(result.documents)) {
        setDocuments(result.documents);
        // Auto-select most recent if none selected
        if (!activeDocId && result.documents.length > 0) {
          const mostRecent = result.documents[0];
          selectDocument(mostRecent);
        }
      }
    } catch (e) {
      console.error('Failed to load canvas documents', e);
    }
  };

  const selectDocument = (doc: CanvasDocument) => {
    setActiveDocId(doc.id);
    setTitle(doc.title);
    setContent(doc.content);
    setLastSaved(new Date(doc.updatedAt));
  };

  const createNewDocument = async () => {
    const newDoc: CanvasDocument = {
      id: `canvas_${Date.now()}`,
      title: 'Untitled',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    try {
      const result = await (window as any).desktopAPI?.canvasCreateDocument?.(newDoc);
      if (result?.ok) {
        setDocuments(prev => [newDoc, ...prev]);
        selectDocument(newDoc);
      }
    } catch (e) {
      // Still create locally
      setDocuments(prev => [newDoc, ...prev]);
      selectDocument(newDoc);
    }
  };

  const triggerAutoSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveDocument();
    }, 1000);
  }, [activeDocId, title, content]);

  const saveDocument = async () => {
    if (!activeDocId) return;
    setIsSaving(true);
    
    try {
      const updated: CanvasDocument = {
        id: activeDocId,
        title,
        content,
        createdAt: documents.find(d => d.id === activeDocId)?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      await (window as any).desktopAPI?.canvasSaveDocument?.(updated);
      
      setDocuments(prev => prev.map(d => d.id === activeDocId ? updated : d));
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to save canvas document', e);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteDocument = async (docId: string) => {
    try {
      await (window as any).desktopAPI?.canvasDeleteDocument?.(docId);
      setDocuments(prev => prev.filter(d => d.id !== docId));
      
      if (activeDocId === docId) {
        const remaining = documents.filter(d => d.id !== docId);
        if (remaining.length > 0) {
          selectDocument(remaining[0]);
        } else {
          setActiveDocId(null);
          setTitle('');
          setContent('');
        }
      }
    } catch (e) {
      console.error('Failed to delete canvas document', e);
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    triggerAutoSave();
  };

  // Get content from contenteditable
  const getEditorContent = () => {
    return editorRef.current?.innerHTML || '';
  };

  // Get plain text content
  const getPlainTextContent = () => {
    return editorRef.current?.innerText || '';
  };

  // Handle content changes in contenteditable
  const handleEditorInput = () => {
    const htmlContent = getEditorContent();
    setContent(htmlContent);
    triggerAutoSave();
    updateActiveFormats();
  };

  // Update active formatting states based on current selection
  const updateActiveFormats = () => {
    const formats = new Set<string>();
    if (document.queryCommandState('bold')) formats.add('bold');
    if (document.queryCommandState('italic')) formats.add('italic');
    if (document.queryCommandState('underline')) formats.add('underline');
    if (document.queryCommandState('strikeThrough')) formats.add('strikethrough');
    if (document.queryCommandState('insertUnorderedList')) formats.add('ul');
    if (document.queryCommandState('insertOrderedList')) formats.add('ol');
    setActiveFormats(formats);
  };

  const copyContent = () => {
    navigator.clipboard.writeText(getPlainTextContent());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveDocument();
    }
  };

  // Rich text formatting using execCommand
  const execFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleEditorInput();
  };

  const formatBold = () => execFormat('bold');
  const formatItalic = () => execFormat('italic');
  const formatUnderline = () => execFormat('underline');
  const formatStrikethrough = () => execFormat('strikeThrough');
  const formatBulletList = () => execFormat('insertUnorderedList');
  const formatNumberedList = () => execFormat('insertOrderedList');
  
  const formatHeading = (level: 1 | 2) => {
    const tag = level === 1 ? 'h1' : 'h2';
    execFormat('formatBlock', tag);
  };
  
  const formatQuote = () => execFormat('formatBlock', 'blockquote');
  
  const formatCode = () => {
    // Wrap selection in <code> tag
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const code = document.createElement('code');
      code.className = 'bg-theme-hover px-1 rounded font-mono text-sm';
      range.surroundContents(code);
      handleEditorInput();
    }
  };

  const insertLink = () => {
    const url = prompt('Enter URL:');
    if (url) {
      execFormat('createLink', url);
    }
  };

  const insertHorizontalRule = () => {
    execFormat('insertHorizontalRule');
  };

  // Set content in editor when document changes
  useEffect(() => {
    if (editorRef.current && activeDocId) {
      // Only update if content differs to avoid cursor jump
      if (editorRef.current.innerHTML !== content) {
        editorRef.current.innerHTML = content;
      }
    }
  }, [activeDocId]);

  // Handle selection change to update toolbar state
  useEffect(() => {
    const handleSelectionChange = () => {
      if (editorRef.current?.contains(document.activeElement) || 
          editorRef.current === document.activeElement) {
        updateActiveFormats();
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  return (
    <div className={clsx("flex h-full bg-theme-bg", className)}>
      {/* Collapsible Document List Sidebar */}
      <div 
        className={clsx(
          "flex flex-col border-r border-theme/5 bg-theme-card transition-all duration-200",
          sidebarCollapsed ? "w-10" : "w-44"
        )}
      >
        {/* Sidebar Header */}
        <div className={clsx(
          "border-b border-theme/5 flex items-center shrink-0",
          sidebarCollapsed ? "p-2 justify-center" : "p-2 px-3 justify-between"
        )}>
          {!sidebarCollapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-theme-muted">Docs</span>
          )}
          <div className="flex items-center gap-1">
            {!sidebarCollapsed && (
              <button
                onClick={createNewDocument}
                className="p-1 hover:bg-theme-hover rounded-lg text-theme-muted hover:text-theme-fg transition-colors"
                title="New Document"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-1 hover:bg-theme-hover rounded-lg text-theme-muted hover:text-theme-fg transition-colors"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        
        {/* Document List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {sidebarCollapsed ? (
            // Collapsed view - just icons
            <div className="p-1 space-y-1">
              <button
                onClick={createNewDocument}
                className="w-full p-2 hover:bg-theme-hover rounded-lg text-theme-muted hover:text-theme-fg transition-colors"
                title="New Document"
              >
                <Plus className="w-4 h-4 mx-auto" />
              </button>
              {documents.map(doc => (
                <button
                  key={doc.id}
                  onClick={() => selectDocument(doc)}
                  className={clsx(
                    "w-full p-2 rounded-lg transition-all",
                    doc.id === activeDocId
                      ? "bg-primary/15 text-primary"
                      : "text-theme-muted hover:bg-theme-hover hover:text-theme-fg"
                  )}
                  title={doc.title || 'Untitled'}
                >
                  <FileText className="w-4 h-4 mx-auto" />
                </button>
              ))}
            </div>
          ) : (
            // Expanded view - full list
            <div className="p-1.5 space-y-0.5">
              {documents.map(doc => (
                <div
                  key={doc.id}
                  onClick={() => selectDocument(doc)}
                  className={clsx(
                    "group flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] cursor-pointer transition-all",
                    doc.id === activeDocId
                      ? "bg-primary/15 text-primary"
                      : "text-theme-muted hover:bg-theme-hover hover:text-theme-fg"
                  )}
                >
                  <FileText className="w-3 h-3 flex-shrink-0" />
                  <span className="flex-1 truncate">{doc.title || 'Untitled'}</span>
                  
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-theme-hover rounded transition-all"
                      >
                        <MoreHorizontal className="w-3 h-3" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        sideOffset={5}
                        className="z-[1000] bg-theme-card border border-theme/10 rounded-xl min-w-[120px] overflow-hidden p-1 shadow-xl animate-in fade-in zoom-in-95 duration-100"
                      >
                        <DropdownMenu.Item
                          onClick={(e) => { e.stopPropagation(); deleteDocument(doc.id); }}
                          className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-red-400 hover:bg-red-500/10 rounded-lg outline-none cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              ))}
              
              {documents.length === 0 && (
                <div className="flex flex-col items-center justify-center py-6 text-center px-2">
                  <FileText className="w-5 h-5 text-theme-muted mb-2" />
                  <p className="text-[10px] text-theme-muted mb-2">No documents</p>
                  <button
                    onClick={createNewDocument}
                    className="text-[10px] text-primary hover:text-primary/80 font-medium"
                  >
                    Create one
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeDocId ? (
          <>
            {/* Editor Header with Title */}
            <div className="h-10 border-b border-theme/5 flex items-center justify-between px-3 bg-theme-card shrink-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder="Untitled"
                  className="bg-transparent border-none outline-none text-sm font-medium text-theme-fg placeholder:text-theme-muted flex-1 min-w-0"
                />
              </div>
              
              <div className="flex items-center gap-1.5">
                {/* Save status */}
                <div className="flex items-center gap-1 text-[9px] text-theme-muted">
                  {isSaving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : lastSaved ? (
                    <Check className="w-3 h-3 text-green-400" />
                  ) : null}
                </div>

                <button
                  onClick={copyContent}
                  className="p-1 hover:bg-theme-hover rounded text-theme-muted hover:text-theme-fg transition-colors"
                  title="Copy content"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                
                <button
                  onClick={saveDocument}
                  className="p-1 hover:bg-theme-hover rounded text-theme-muted hover:text-theme-fg transition-colors"
                  title="Save (Ctrl+S)"
                >
                  <Save className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Formatting Toolbar */}
            <div className="h-9 border-b border-theme/5 flex items-center gap-0.5 px-2 bg-theme-card/50 shrink-0 overflow-x-auto custom-scrollbar">
              {/* Text formatting */}
              <FormatButton icon={<Bold className="w-3.5 h-3.5" />} label="Bold" shortcut="Ctrl+B" onClick={formatBold} active={activeFormats.has('bold')} />
              <FormatButton icon={<Italic className="w-3.5 h-3.5" />} label="Italic" shortcut="Ctrl+I" onClick={formatItalic} active={activeFormats.has('italic')} />
              <FormatButton icon={<Underline className="w-3.5 h-3.5" />} label="Underline" shortcut="Ctrl+U" onClick={formatUnderline} active={activeFormats.has('underline')} />
              <FormatButton icon={<Strikethrough className="w-3.5 h-3.5" />} label="Strikethrough" onClick={formatStrikethrough} active={activeFormats.has('strikethrough')} />
              
              <div className="w-px h-5 bg-theme/10 mx-1" />
              
              {/* Headings */}
              <FormatButton icon={<Heading1 className="w-3.5 h-3.5" />} label="Heading 1" onClick={() => formatHeading(1)} />
              <FormatButton icon={<Heading2 className="w-3.5 h-3.5" />} label="Heading 2" onClick={() => formatHeading(2)} />
              
              <div className="w-px h-5 bg-theme/10 mx-1" />
              
              {/* Lists */}
              <FormatButton icon={<List className="w-3.5 h-3.5" />} label="Bullet List" onClick={formatBulletList} active={activeFormats.has('ul')} />
              <FormatButton icon={<ListOrdered className="w-3.5 h-3.5" />} label="Numbered List" onClick={formatNumberedList} active={activeFormats.has('ol')} />
              
              <div className="w-px h-5 bg-theme/10 mx-1" />
              
              {/* Block elements */}
              <FormatButton icon={<Quote className="w-3.5 h-3.5" />} label="Quote" onClick={formatQuote} />
              <FormatButton icon={<Code className="w-3.5 h-3.5" />} label="Code" onClick={formatCode} />
              <FormatButton icon={<Link className="w-3.5 h-3.5" />} label="Link" onClick={insertLink} />
              <FormatButton icon={<Minus className="w-3.5 h-3.5" />} label="Divider" onClick={insertHorizontalRule} />
            </div>

            {/* Rich Text Editor (contenteditable) */}
            <div className="flex-1 overflow-auto custom-scrollbar">
              <div
                ref={editorRef}
                contentEditable
                onInput={handleEditorInput}
                onKeyDown={handleKeyDown}
                data-placeholder="Start typing... Use the toolbar above or Ctrl+B for bold, Ctrl+I for italic."
                className="w-full min-h-full bg-transparent border-none outline-none p-4 text-sm text-theme-fg leading-relaxed empty:before:content-[attr(data-placeholder)] empty:before:text-theme-muted empty:before:pointer-events-none prose prose-sm max-w-none
                  [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-4
                  [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3
                  [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-theme-muted
                  [&_code]:bg-theme-hover [&_code]:px-1 [&_code]:rounded [&_code]:font-mono [&_code]:text-sm
                  [&_a]:text-primary [&_a]:underline
                  [&_ul]:list-disc [&_ul]:pl-5
                  [&_ol]:list-decimal [&_ol]:pl-5
                  [&_hr]:border-theme/20 [&_hr]:my-4"
                spellCheck={false}
              />
            </div>

            {/* Footer with stats */}
            <div className="h-6 border-t border-theme/5 flex items-center justify-between px-3 bg-theme-card text-[9px] text-theme-muted shrink-0">
              <span>{getPlainTextContent().length} chars</span>
              <span>{getPlainTextContent().split(/\s+/).filter(Boolean).length} words</span>
              <span>{getPlainTextContent().split('\n').length} lines</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <div className="w-14 h-14 rounded-2xl bg-theme-hover flex items-center justify-center mb-3">
              <FileText className="w-7 h-7 text-theme-muted" />
            </div>
            <h3 className="text-base font-semibold text-theme-fg mb-1">Canvas</h3>
            <p className="text-xs text-theme-muted mb-4 max-w-[200px]">
              Write notes with formatting. AI can read and modify content.
            </p>
            <button
              onClick={createNewDocument}
              className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-medium transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              New Document
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CanvasPanel;
