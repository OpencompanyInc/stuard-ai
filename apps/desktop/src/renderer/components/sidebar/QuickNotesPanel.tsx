import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Check,
  Clock3,
  Copy,
  LayoutList,
  Link2,
  Loader2,
  MessageSquareQuote,
  NotebookPen,
  Plus,
  Search,
  Sparkles,
  SquareCode,
  Trash2,
} from 'lucide-react';

interface CanvasDocument {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface QuickNotesPanelProps {
  className?: string;
  selectedDocumentId?: string;
  onSelectedDocumentHandled?: () => void;
}

type NoteTemplate = {
  id: string;
  label: string;
  title: string;
  description: string;
  content: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    title: 'Quick Note',
    description: 'Fast freeform capture',
    content: '',
    icon: NotebookPen,
  },
  {
    id: 'tasks',
    label: 'Checklist',
    title: 'Today\'s Tasks',
    description: 'A short task list',
    content: '- [ ] First task\n- [ ] Next step\n',
    icon: LayoutList,
  },
  {
    id: 'meeting',
    label: 'Meeting',
    title: 'Meeting Notes',
    description: 'Agenda and takeaways',
    content: 'Agenda\n- \n\nNotes\n- \n',
    icon: MessageSquareQuote,
  },
  {
    id: 'links',
    label: 'Links',
    title: 'Link Dump',
    description: 'Save links with context',
    content: '- https://\n',
    icon: Link2,
  },
  {
    id: 'code',
    label: 'Code',
    title: 'Snippet',
    description: 'Commands and snippets',
    content: '```\n\n```',
    icon: SquareCode,
  },
];

const QUICK_INSERTS = [
  { label: 'Todo', insert: '- [ ] ' },
  { label: 'Bullet', insert: '- ' },
  { label: 'Date', insert: `${new Date().toLocaleDateString()}\n` },
  { label: 'Divider', insert: '\n---\n' },
];

const NOTE_COLORS = [
  {
    card: 'bg-[#FFF7B3] border-[#E7D36A] text-[#3D3200]',
    muted: 'text-[#6E5B14]',
    dot: 'bg-[#E6C84F]',
    ring: 'ring-[#E4CB68]/50',
  },
  {
    card: 'bg-[#FFDCCF] border-[#E9A88B] text-[#442014]',
    muted: 'text-[#7A4736]',
    dot: 'bg-[#E69167]',
    ring: 'ring-[#E9A88B]/50',
  },
  {
    card: 'bg-[#DBF0FF] border-[#90C5E8] text-[#173246]',
    muted: 'text-[#426984]',
    dot: 'bg-[#6FB2DD]',
    ring: 'ring-[#90C5E8]/50',
  },
  {
    card: 'bg-[#E7DEFF] border-[#B7A0EE] text-[#2B2152]',
    muted: 'text-[#64558F]',
    dot: 'bg-[#9D89E8]',
    ring: 'ring-[#B7A0EE]/50',
  },
  {
    card: 'bg-[#DDF5E4] border-[#95D0A8] text-[#173A24]',
    muted: 'text-[#4A7357]',
    dot: 'bg-[#73BE8A]',
    ring: 'ring-[#95D0A8]/50',
  },
];

function toPlainText(value: string): string {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function formatRelativeTime(value?: string): string {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : date.toLocaleDateString();
}

function getNoteColor(seed: string) {
  const total = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return NOTE_COLORS[total % NOTE_COLORS.length];
}

export const QuickNotesPanel: React.FC<QuickNotesPanelProps> = ({ className, selectedDocumentId, onSelectedDocumentHandled }) => {
  const [documents, setDocuments] = useState<CanvasDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const titleRef = useRef('');
  const contentRef = useRef('');
  const documentsRef = useRef<CanvasDocument[]>([]);

  const sortDocs = useCallback((items: CanvasDocument[]) => {
    return [...items].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }, []);

  const selectDocument = useCallback((doc: CanvasDocument) => {
    setActiveDocId(doc.id);
    setTitle(doc.title || 'Quick Note');
    setContent(doc.content || '');
    titleRef.current = doc.title || 'Quick Note';
    contentRef.current = doc.content || '';
    setLastSaved(doc.updatedAt ? new Date(doc.updatedAt) : null);
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      const result = await (window as any).desktopAPI?.canvasListDocuments?.();
      if (result?.ok && Array.isArray(result.documents)) {
        const sorted = sortDocs(result.documents);
        setDocuments(sorted);
        documentsRef.current = sorted;
        if (!activeDocId && sorted.length > 0) {
          selectDocument(sorted[0]);
        }
      }
    } catch (e) {
      console.error('Failed to load canvas documents', e);
    }
  }, [activeDocId, selectDocument, sortDocs]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (selectedDocumentId && documents.length > 0) {
      const doc = documents.find((item) => item.id === selectedDocumentId);
      if (doc) {
        selectDocument(doc);
        onSelectedDocumentHandled?.();
      }
    }
  }, [selectedDocumentId, documents, onSelectedDocumentHandled, selectDocument]);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const saveDocument = useCallback(async (nextTitle?: string, nextContent?: string) => {
    if (!activeDocId) return;
    setIsSaving(true);
    try {
      const existing = documentsRef.current.find((doc) => doc.id === activeDocId);
      const updated: CanvasDocument = {
        id: activeDocId,
        title: String(nextTitle ?? titleRef.current).trim() || 'Quick Note',
        content: String(nextContent ?? contentRef.current),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await (window as any).desktopAPI?.canvasSaveDocument?.(updated);
      const nextDocs = sortDocs([updated, ...documentsRef.current.filter((doc) => doc.id !== activeDocId)]);
      setDocuments(nextDocs);
      documentsRef.current = nextDocs;
      setTitle(updated.title);
      setLastSaved(new Date(updated.updatedAt));
    } catch (e) {
      console.error('Failed to save canvas document', e);
    } finally {
      setIsSaving(false);
    }
  }, [activeDocId, sortDocs]);

  const triggerAutoSave = useCallback((nextTitle?: string, nextContent?: string) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void saveDocument(nextTitle, nextContent);
    }, 500);
  }, [saveDocument]);

  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onCanvasUpdate?.((data: {
      documentId?: string;
      content?: string;
      title?: string;
      action?: 'append' | 'replace' | 'insert';
      position?: number;
    }) => {
      if (data.documentId && data.documentId === activeDocId) {
        setContent((prev) => {
          if (data.action === 'append') return prev + (data.content || '');
          if (data.action === 'insert' && typeof data.position === 'number') {
            return `${prev.slice(0, data.position)}${data.content || ''}${prev.slice(data.position)}`;
          }
          return data.content ?? prev;
        });
        if (data.title !== undefined) setTitle(data.title);
        triggerAutoSave(data.title ?? titleRef.current, data.content ?? contentRef.current);
      }
    });
    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {}
    };
  }, [activeDocId, triggerAutoSave]);

  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onCanvasRead?.((data: { requestId: string }) => {
      (window as any).desktopAPI?.canvasReadResponse?.({
        requestId: data.requestId,
        documentId: activeDocId,
        title,
        content,
      });
    });
    return () => {
      try {
        if (typeof unsub === 'function') unsub();
      } catch {}
    };
  }, [activeDocId, title, content]);

  const createNewDocument = useCallback(async (template: NoteTemplate = NOTE_TEMPLATES[0]) => {
    const now = new Date().toISOString();
    const newDoc: CanvasDocument = {
      id: `canvas_${Date.now()}`,
      title: template.title,
      content: template.content,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await (window as any).desktopAPI?.canvasCreateDocument?.(newDoc);
    } catch {}

    const nextDocs = sortDocs([newDoc, ...documentsRef.current.filter((doc) => doc.id !== newDoc.id)]);
    setDocuments(nextDocs);
    documentsRef.current = nextDocs;
    selectDocument(newDoc);
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [selectDocument, sortDocs]);

  const deleteDocument = useCallback(async (docId: string) => {
    try {
      await (window as any).desktopAPI?.canvasDeleteDocument?.(docId);
    } catch (e) {
      console.error('Failed to delete canvas document', e);
    }

    const nextDocs = documentsRef.current.filter((doc) => doc.id !== docId);
    setDocuments(nextDocs);
    documentsRef.current = nextDocs;

    if (activeDocId === docId) {
      if (nextDocs.length > 0) selectDocument(nextDocs[0]);
      else {
        setActiveDocId(null);
        setTitle('');
        setContent('');
        setLastSaved(null);
      }
    }
  }, [activeDocId, selectDocument]);

  const copyContent = useCallback(async () => {
    await navigator.clipboard.writeText(toPlainText(content));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [content]);

  const insertAtCursor = useCallback((snippet: string) => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${contentRef.current.slice(0, start)}${snippet}${contentRef.current.slice(end)}`;
    setContent(next);
    contentRef.current = next;
    triggerAutoSave(titleRef.current, next);
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + snippet.length;
      textarea.setSelectionRange(caret, caret);
    });
  }, [triggerAutoSave]);

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((doc) => `${doc.title} ${toPlainText(doc.content)}`.toLowerCase().includes(query));
  }, [documents, searchQuery]);

  const activeDoc = useMemo(() => documents.find((doc) => doc.id === activeDocId) || null, [documents, activeDocId]);
  const activeStats = useMemo(() => {
    const plain = toPlainText(content);
    return {
      chars: plain.length,
      lines: content ? content.split('\n').length : 0,
    };
  }, [content]);

  return (
    <div className={clsx('h-full overflow-hidden bg-[#f6f1de]', className)}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-black/5 bg-[#f4ebcf]/90 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7a6531]">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Quick Notes</span>
              </div>
              <div className="mt-1 text-[12px] text-[#866f38]">Sticky notes for fast capture, not a mini doc editor.</div>
            </div>
            <button
              onClick={() => void createNewDocument()}
              className="inline-flex items-center gap-2 rounded-full bg-[#2e2718] px-3 py-2 text-[12px] font-semibold text-[#fff7d1] shadow-sm transition-transform hover:scale-[1.02]"
            >
              <Plus className="h-3.5 w-3.5" />
              New note
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {NOTE_TEMPLATES.map((template) => {
              const Icon = template.icon;
              return (
                <button
                  key={template.id}
                  onClick={() => void createNewDocument(template)}
                  className="inline-flex items-center gap-2 rounded-full border border-[#d8c690] bg-white/80 px-3 py-1.5 text-[11px] font-medium text-[#4d3d14] shadow-sm transition-all hover:bg-white"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {template.label}
                </button>
              );
            })}
          </div>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#90764b]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sticky notes"
              className="w-full rounded-2xl border border-[#d8c690] bg-white px-9 py-2.5 text-[12px] text-slate-900 outline-none ring-0 placeholder:text-slate-500 focus:border-[#bea15b]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!activeDoc && (
            <div className="mb-4 rounded-[28px] border border-dashed border-[#c7b27a] bg-[#fff7d6] p-6 text-center shadow-sm">
              <NotebookPen className="mx-auto mb-3 h-8 w-8 text-[#8f7440]" />
              <div className="text-[16px] font-semibold text-[#5c4820]">No sticky notes yet</div>
              <div className="mt-1 text-[12px] text-[#866f38]">Start with a blank note, checklist, link dump, or meeting note.</div>
            </div>
          )}

          {filteredDocuments.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredDocuments.map((doc, index) => {
                const color = getNoteColor(`${doc.id}-${index}`);
                const preview = toPlainText(doc.content).split('\n').filter(Boolean).slice(0, 5).join('\n') || 'Empty note';
                const isActive = doc.id === activeDocId;

                return (
                  <div
                    key={doc.id}
                    className={clsx(
                      'group relative min-h-[180px] rounded-[24px] border p-4 text-left shadow-[0_14px_28px_rgba(64,47,11,0.12)] transition-all hover:-translate-y-1 hover:shadow-[0_18px_36px_rgba(64,47,11,0.18)]',
                      color.card,
                      isActive ? `ring-2 ${color.ring} sm:col-span-2 xl:col-span-2` : 'ring-0'
                    )}
                    style={{ transform: `rotate(${index % 2 === 0 ? '-1.2deg' : '1.1deg'})` }}
                  >
                    <div className={clsx('mb-3 h-1.5 w-12 rounded-full', color.dot)} />
                    {isActive ? (
                      <>
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <input
                              type="text"
                              value={title}
                              onChange={(e) => {
                                const next = e.target.value;
                                setTitle(next);
                                titleRef.current = next;
                                triggerAutoSave(next, contentRef.current);
                              }}
                              placeholder="Untitled note"
                              className="w-full bg-transparent pr-8 text-[20px] font-bold outline-none placeholder:opacity-60"
                            />
                            <div className={clsx('mt-1 flex items-center gap-2 text-[11px]', color.muted)}>
                              <Clock3 className="h-3.5 w-3.5" />
                              <span>{isSaving ? 'Saving…' : formatRelativeTime(lastSaved?.toISOString() || activeDoc?.updatedAt)}</span>
                              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              <span>{activeStats.chars} chars</span>
                              <span>{activeStats.lines} lines</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={copyContent}
                              className="rounded-full border border-black/10 bg-white/70 p-2 transition-colors hover:bg-white"
                              title="Copy note"
                            >
                              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => void deleteDocument(doc.id)}
                              className="rounded-full border border-red-200 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100"
                              title="Delete note"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div className="mb-3 flex flex-wrap gap-2">
                          {QUICK_INSERTS.map((action) => (
                            <button
                              key={action.label}
                              onClick={() => insertAtCursor(action.insert)}
                              className="rounded-full border border-black/10 bg-white/65 px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-white"
                            >
                              + {action.label}
                            </button>
                          ))}
                        </div>

                        <textarea
                          ref={editorRef}
                          value={content}
                          onChange={(e) => {
                            const next = e.target.value;
                            setContent(next);
                            contentRef.current = next;
                            triggerAutoSave(titleRef.current, next);
                          }}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                              e.preventDefault();
                              void saveDocument();
                            }
                          }}
                          placeholder="Jot it down before you lose it…"
                          className="min-h-[220px] w-full resize-none rounded-[24px] border border-black/10 bg-white/45 p-4 text-[14px] leading-6 text-inherit outline-none placeholder:opacity-55"
                          spellCheck
                        />
                      </>
                    ) : (
                      <button className="block w-full text-left" onClick={() => selectDocument(doc)}>
                        <div className="pr-8 text-[15px] font-bold line-clamp-2">{doc.title || 'Quick Note'}</div>
                        <div className="mt-3 whitespace-pre-wrap text-[12px] leading-5 opacity-90 line-clamp-6">{preview}</div>
                        <div className={clsx('mt-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide', color.muted)}>
                          <Clock3 className="h-3 w-3" />
                          <span>{formatRelativeTime(doc.updatedAt)}</span>
                        </div>
                      </button>
                    )}
                    {!isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteDocument(doc.id);
                        }}
                        className="absolute right-3 top-3 rounded-full bg-white/70 p-1.5 opacity-0 transition-opacity hover:bg-white group-hover:opacity-100"
                        title="Delete note"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[24px] border border-dashed border-[#ccb57c] bg-[#fff8dd] p-5 text-center text-[12px] text-[#816c3d]">
              No sticky notes match your search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuickNotesPanel;
