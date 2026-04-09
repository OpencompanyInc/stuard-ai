'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendVMAgentChat, listFiles } from '@/lib/cloudApi';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useCloudTerminal } from '@/hooks/useCloudTerminal';
import Link from 'next/link';

interface CloudIDELayoutProps {
  engine: any;
  onRefresh: () => void;
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
}

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export function CloudIDELayout({ engine, onRefresh }: CloudIDELayoutProps) {
  const { user, userData } = useAuthContext();

  // ── Layout state ──
  const [filePanelOpen, setFilePanelOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);

  // ── Chat state ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── File tree state ──
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // ── Terminal state ──
  const termContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const { connected, connect, sendData, resize, onData, close } = useCloudTerminal();

  // ── User greeting ──
  const displayName =
    userData?.displayName ||
    (user as any)?.user_metadata?.fullName ||
    user?.email?.split('@')[0] ||
    'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // ── Load root directory on mount ──
  useEffect(() => {
    if (engine.status === 'running') loadDir('.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.status]);

  // ── Auto-scroll chat ──
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // ── Terminal xterm lifecycle ──
  useEffect(() => {
    if (!terminalOpen || !termContainerRef.current || engine.status !== 'running') return;

    let term: any;
    let fitAddon: any;
    let ro: ResizeObserver | null = null;
    let disposeInput: { dispose: () => void } | undefined;
    let disposeWs: (() => void) | undefined;
    let disposed = false;

    const init = async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');
        await import('@xterm/xterm/css/xterm.css');

        if (disposed) return;

        term = new Terminal({
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 13,
          theme: {
            background: 'var(--ide-bg, #0d0f14)',
            foreground: '#c0caf5',
            cursor: '#c0caf5',
            cursorAccent: '#0d0f14',
            selectionBackground: 'rgba(59, 130, 246, 0.3)',
          },
          cursorBlink: true,
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.open(termContainerRef.current!);
        fitAddon.fit();

        xtermRef.current = term;

        disposeInput = term.onData((data: string) => sendData(data));
        onData((data: string) => term.write(data));
        disposeWs = connect({ cols: term.cols, rows: term.rows });

        ro = new ResizeObserver(() => {
          if (!disposed) {
            fitAddon.fit();
            resize(term.cols, term.rows);
          }
        });
        ro.observe(termContainerRef.current!);
      } catch (e) {
        if (!disposed) console.error('Terminal init failed:', e);
      }
    };

    void init();

    return () => {
      disposed = true;
      ro?.disconnect();
      disposeInput?.dispose();
      disposeWs?.();
      xtermRef.current = null;
      term?.dispose();
      close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalOpen, engine.status]);

  // ── File helpers ──
  const loadDir = async (path: string) => {
    setLoadingDirs(prev => new Set(prev).add(path));
    try {
      const data = await listFiles(path);
      if (data.ok) {
        setDirContents(prev => ({ ...prev, [path]: data.entries || [] }));
      }
    } finally {
      setLoadingDirs(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  };

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!dirContents[path]) loadDir(path);
      }
      return next;
    });
  };

  // ── Chat helpers ──
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || chatLoading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setChatLoading(true);

    try {
      const res = await sendVMAgentChat(text, conversationId || undefined);
      if (res.ok && res.text) {
        setMessages(prev => [...prev, { role: 'assistant', content: res.text! }]);
        if (res.conversationId) setConversationId(res.conversationId);
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: res.error || 'Something went wrong.' },
        ]);
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Connection error. Please try again.' },
      ]);
    } finally {
      setChatLoading(false);
      inputRef.current?.focus();
    }
  }, [input, chatLoading, conversationId]);

  // ── Keyboard shortcut: Ctrl/Cmd+B → toggle files, Ctrl+` → toggle terminal ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'b') {
        e.preventDefault();
        setFilePanelOpen(p => !p);
      }
      if (mod && e.key === '`') {
        e.preventDefault();
        setTerminalOpen(p => !p);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── File tree renderer ──
  const renderTree = (entries: FileEntry[], depth: number = 0): React.ReactNode => {
    const sorted = [...entries].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    return sorted.map(entry => {
      const isDir = entry.type === 'directory';
      const isExpanded = expandedDirs.has(entry.path);
      const children = dirContents[entry.path];
      const isLoading = loadingDirs.has(entry.path);

      return (
        <div key={entry.path}>
          <button
            onClick={() => (isDir ? toggleDir(entry.path) : undefined)}
            className="ide-tree-item"
            style={{ paddingLeft: `${8 + depth * 16}px` }}
          >
            {isDir ? (
              <svg
                className={`ide-tree-chevron ${isExpanded ? 'ide-tree-chevron-open' : ''}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M9 6l6 6-6 6z" />
              </svg>
            ) : (
              <span className="ide-tree-spacer" />
            )}
            {isDir ? (
              <FolderIcon />
            ) : (
              <FileIcon name={entry.name} />
            )}
            <span className="truncate">{entry.name}</span>
          </button>
          {isDir && isExpanded && (
            isLoading ? (
              <div
                className="ide-tree-loading"
                style={{ paddingLeft: `${24 + depth * 16}px` }}
              >
                Loading…
              </div>
            ) : children ? (
              renderTree(children, depth + 1)
            ) : null
          )}
        </div>
      );
    });
  };

  // ── Chat input ──
  const renderChatInput = () => (
    <div className="ide-chat-input-wrapper">
      <div className="ide-chat-input-container">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Ask, run, build anything. @ to mention files, prompts, or tools"
          disabled={chatLoading}
          rows={1}
          className="ide-chat-textarea"
        />
        <div className="ide-chat-input-bar">
          <div className="ide-chat-input-meta">
            <span className="ide-chat-agent-badge">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              Agent
            </span>
            {connected && (
              <span className="ide-chat-connected">
                <span className="ide-status-dot ide-status-dot-green" />
                Connected
              </span>
            )}
          </div>
          <button
            onClick={sendMessage}
            disabled={chatLoading || !input.trim()}
            className="ide-send-btn"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Send
          </button>
        </div>
      </div>
    </div>
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RENDER
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="cloud-ide">
      {/* ── Icon Sidebar ── */}
      <div className="ide-icon-sidebar">
        <div className="ide-icon-group">
          <Link
            href="/dashboard"
            className="ide-icon-btn"
            title="Back to Dashboard"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
          </Link>

          <button
            className="ide-icon-btn"
            title="Search"
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </button>

          <button
            className={`ide-icon-btn ${filePanelOpen ? 'ide-icon-active' : ''}`}
            title="Files (Ctrl+B)"
            onClick={() => setFilePanelOpen(p => !p)}
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </button>

          <button
            className={`ide-icon-btn ${terminalOpen ? 'ide-icon-active' : ''}`}
            title="Terminal (Ctrl+`)"
            onClick={() => setTerminalOpen(p => !p)}
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021.75 18V6a2.25 2.25 0 00-2.25-2.25H4.5A2.25 2.25 0 002.25 6v12A2.25 2.25 0 004.5 20.25z" />
            </svg>
          </button>
        </div>

        <div className="ide-icon-spacer" />

        <div className="ide-icon-group">
          <div
            className="ide-icon-btn ide-status-indicator"
            title={`Engine: ${engine.status}`}
          >
            <span className={`ide-status-dot ${engine.status === 'running' ? 'ide-status-dot-green' : ''}`} />
          </div>

          <button
            className="ide-icon-btn"
            title="Settings"
            onClick={onRefresh}
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── File Panel ── */}
      {filePanelOpen && (
        <div className="ide-file-panel">
          <div className="ide-file-panel-header">
            <span className="ide-panel-title">Files</span>
            <button
              onClick={() => loadDir('.')}
              className="ide-panel-action"
              title="Refresh"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            </button>
          </div>
          <div className="ide-file-tree">
            {dirContents['.'] ? (
              renderTree(dirContents['.'])
            ) : (
              <div className="ide-tree-loading" style={{ paddingLeft: '16px' }}>
                Loading files…
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="ide-main">
        {/* Sync notice — website can't sync local memories */}
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 shrink-0">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <span>
            <strong>Memories may be out of sync.</strong> Open the Cloud Engine dashboard in the <strong>Stuard desktop app</strong> to sync your memories and data to the VM.
          </span>
        </div>
        {/* Chat area */}
        <div className="ide-chat-area">
          {messages.length === 0 && !chatLoading ? (
            /* ── Empty state: centered greeting ── */
            <div className="ide-chat-empty">
              <div className="ide-chat-empty-inner">
                <h1 className="ide-greeting">
                  {greeting}, {displayName}. What should we do today?
                </h1>
                {renderChatInput()}
                <div className="ide-quick-actions">
                  <button className="ide-quick-action">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Recents
                  </button>
                  <button className="ide-quick-action">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                    </svg>
                    Prompts
                  </button>
                  <button className="ide-quick-action">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                    </svg>
                    Sites
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ── Chat with messages ── */
            <>
              <div className="ide-chat-messages">
                <div className="ide-chat-messages-inner">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`ide-chat-row ${msg.role === 'user' ? 'ide-chat-row-user' : 'ide-chat-row-assistant'}`}
                    >
                      <div
                        className={`ide-chat-bubble ${
                          msg.role === 'user' ? 'ide-chat-bubble-user' : 'ide-chat-bubble-assistant'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="ide-chat-row ide-chat-row-assistant">
                      <div className="ide-chat-bubble ide-chat-bubble-assistant">
                        <div className="ide-typing-dots">
                          <span style={{ animationDelay: '0ms' }} />
                          <span style={{ animationDelay: '150ms' }} />
                          <span style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              </div>
              {renderChatInput()}
            </>
          )}
        </div>

        {/* ── Terminal Panel ── */}
        {terminalOpen && (
          <div className="ide-terminal-panel">
            <div className="ide-terminal-header">
              <div className="ide-terminal-header-left">
                <span className="ide-panel-title">Terminal</span>
                <span className={`ide-status-dot ${connected ? 'ide-status-dot-green' : ''}`} />
              </div>
              <button
                onClick={() => setTerminalOpen(false)}
                className="ide-panel-action"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div
              ref={termContainerRef}
              className="ide-terminal-body"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tiny icon components ──

function FolderIcon() {
  return (
    <svg className="ide-tree-icon ide-tree-icon-folder" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" />
    </svg>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const colorMap: Record<string, string> = {
    ts: '#3178c6',
    tsx: '#3178c6',
    js: '#f7df1e',
    jsx: '#f7df1e',
    py: '#3776ab',
    json: '#a8b1c2',
    md: '#519aba',
    css: '#264de4',
    html: '#e34c26',
    yml: '#cb171e',
    yaml: '#cb171e',
    sh: '#89e051',
    bash: '#89e051',
  };
  const color = colorMap[ext] || 'var(--ide-text-dim)';

  return (
    <svg className="ide-tree-icon" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
