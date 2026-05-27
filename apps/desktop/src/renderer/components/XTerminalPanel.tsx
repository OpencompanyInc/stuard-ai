import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Terminal, X, ChevronDown, Monitor, Cpu, TerminalSquare, Keyboard, Eye } from 'lucide-react';
import { clsx } from 'clsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { XTerminal, XTerminalRef } from './XTerminal';

interface TerminalSession {
  id: string;
  pid: number;
  shell: string;
  cwd: string;
  title: string;
  createdAt: number;
  lastActivity: number;
  cols: number;
  rows: number;
  status: 'running' | 'exited';
  exitCode?: number;
}

interface CliAgentMeta {
  id: string;
  label: string;
  provider: string;
  cwd: string;
}

interface XTerminalPanelProps {
  className?: string;
  onClose?: () => void;
}

export const XTerminalPanel: React.FC<XTerminalPanelProps> = ({ className, onClose: _onClose }) => {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [cliAgentByTerminalId, setCliAgentByTerminalId] = useState<Record<string, CliAgentMeta>>({});
  const [takenOver, setTakenOver] = useState<Record<string, boolean>>({});
  const terminalRefs = useRef<Map<string, XTerminalRef>>(new Map());

  const mergeCliAgentSessions = useCallback((entries: Array<{ terminalSessionId: string; id: string; label: string; provider: string; cwd: string }>) => {
    if (entries.length === 0) return;
    setCliAgentByTerminalId((prev) => {
      const next = { ...prev };
      for (const entry of entries) {
        next[entry.terminalSessionId] = {
          id: entry.id,
          label: entry.label,
          provider: entry.provider,
          cwd: entry.cwd,
        };
      }
      return next;
    });
  }, []);

  const refreshSessions = useCallback(async (preferredId?: string | null) => {
    const result = await (window as any).desktopAPI?.terminalList?.();
    if (result?.ok && Array.isArray(result.sessions)) {
      setSessions(result.sessions);
      if (preferredId && result.sessions.some((s: TerminalSession) => s.id === preferredId)) {
        setActiveSessionId(preferredId);
      } else if (result.sessions.length > 0) {
        setActiveSessionId((current) => current || result.sessions[0].id);
      }
    }
  }, []);

  // Load existing sessions + active CLI agent sessions on mount
  useEffect(() => {
    void refreshSessions();
    void (async () => {
      const result = await (window as any).desktopAPI?.execTool?.('cli_agent_status', {});
      const entries = Array.isArray(result?.sessions)
        ? result.sessions
        : result?.session
          ? [result.session]
          : [];
      mergeCliAgentSessions(entries);
    })();
  }, [mergeCliAgentSessions, refreshSessions]);

  // Headed CLI-agent sessions: surface in the sidebar terminal instead of a popup
  useEffect(() => {
    const api = (window as any).desktopAPI;
    if (!api) return;

    const unsubStart = api.onCliAgentSessionStarted?.((s: CliAgentMeta & { terminalSessionId: string }) => {
      mergeCliAgentSessions([s]);
      void refreshSessions(s.terminalSessionId);
    });

    const unsubStop = api.onCliAgentSessionStopped?.(({ terminalSessionId }: { terminalSessionId: string }) => {
      setCliAgentByTerminalId((prev) => {
        const removed = prev[terminalSessionId];
        if (removed) {
          setTakenOver((t) => {
            if (!t[removed.id]) return t;
            const next = { ...t };
            delete next[removed.id];
            return next;
          });
        }
        if (!removed) return prev;
        const next = { ...prev };
        delete next[terminalSessionId];
        return next;
      });
    });

    return () => {
      unsubStart?.();
      unsubStop?.();
    };
  }, [mergeCliAgentSessions, refreshSessions]);

  // Subscribe to terminal data events
  useEffect(() => {
    const unsubData = (window as any).desktopAPI?.onTerminalData?.(
      ({ sessionId, data }: { sessionId: string; data: string }) => {
        const termRef = terminalRefs.current.get(sessionId);
        if (termRef) {
          termRef.write(data);
        }
      }
    );

    const unsubExit = (window as any).desktopAPI?.onTerminalExit?.(
      ({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
        setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, status: 'exited' as const, exitCode } : s
        ));
      }
    );

    return () => {
      unsubData?.();
      unsubExit?.();
    };
  }, []);

  // Load buffered output when switching sessions
  useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;

    const loadBuffer = async () => {
      const result = await (window as any).desktopAPI?.terminalGetBuffer?.(activeSessionId);
      if (cancelled) return;
      if (result?.ok && Array.isArray(result.buffer)) {
        const termRef = terminalRefs.current.get(activeSessionId);
        if (termRef) {
          termRef.clear();
          for (const chunk of result.buffer) {
            termRef.write(chunk);
          }
          termRef.fit();
        }
      }
    };

    const timer = window.setTimeout(loadBuffer, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSessionId]);

  const createSession = async (shell?: string) => {
    const result = await (window as any).desktopAPI?.terminalCreate?.({ shell });
    if (result?.ok && result.session) {
      setSessions(prev => [...prev, result.session]);
      setActiveSessionId(result.session.id);
    }
  };

  const destroySession = async (sessionId: string) => {
    await (window as any).desktopAPI?.terminalDestroy?.(sessionId);
    terminalRefs.current.delete(sessionId);
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
      return remaining;
    });
  };

  const handleResize = useCallback((cols: number, rows: number) => {
    if (activeSessionId) {
      (window as any).desktopAPI?.terminalResize?.(activeSessionId, cols, rows);
    }
  }, [activeSessionId]);

  const setTerminalRef = (sessionId: string, ref: XTerminalRef | null) => {
    if (ref) {
      terminalRefs.current.set(sessionId, ref);
    } else {
      terminalRefs.current.delete(sessionId);
    }
  };

  const activeCliAgent = activeSessionId ? cliAgentByTerminalId[activeSessionId] : undefined;
  const isTakenOver = activeCliAgent ? !!takenOver[activeCliAgent.id] : true;

  const sessionTitle = (session: TerminalSession) => {
    const cli = cliAgentByTerminalId[session.id];
    if (cli) return cli.label;
    return session.title || session.shell.split(/[/\\]/).pop();
  };

  const toggleTakeOver = () => {
    if (!activeCliAgent || !activeSessionId) return;
    setTakenOver((prev) => ({ ...prev, [activeCliAgent.id]: !prev[activeCliAgent.id] }));
    if (!isTakenOver) {
      window.setTimeout(() => terminalRefs.current.get(activeSessionId)?.focus(), 0);
    }
  };

  return (
    <div className={clsx("flex flex-col h-full bg-[#1e1e1e] rounded-b-[20px] overflow-hidden", className)}>
      {/* Tab Bar */}
      <div className="flex items-center h-11 bg-[#252526] border-b border-[#333] px-2 gap-1 overflow-x-auto custom-scrollbar">
        {sessions.map(session => (
          <div
            key={session.id}
            onClick={() => setActiveSessionId(session.id)}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-t-lg text-[13px] font-medium cursor-pointer group flex-shrink-0 transition-all",
              session.id === activeSessionId
                ? "bg-[#1e1e1e] text-white"
                : "text-gray-400 hover:text-gray-200 hover:bg-[#2d2d2d]"
            )}
          >
            <Terminal className={clsx(
              "w-3.5 h-3.5 transition-colors",
              session.id === activeSessionId ? "text-blue-400" : "text-gray-500"
            )} />
            <span className="max-w-[120px] truncate">
              {sessionTitle(session)}
            </span>
            {session.status === 'exited' && (
              <span className={clsx(
                "text-[10px] px-1.5 py-0.5 rounded font-bold",
                session.exitCode === 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
              )}>
                {session.exitCode}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); destroySession(session.id); }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#444] rounded-md transition-all ml-1"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* New Terminal Button */}
        <div className="relative flex-shrink-0 ml-1">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-gray-400 hover:text-white hover:bg-[#333] rounded-lg text-xs font-medium transition-colors outline-none"
              >
                <Plus className="w-3.5 h-3.5" />
                <ChevronDown className="w-3 h-3 opacity-50" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
                <DropdownMenu.Content
                  sideOffset={5}
                  align="start"
                  className="z-[1000] bg-[#252526] border border-[#444] rounded-xl min-w-[180px] overflow-hidden p-1.5 animate-in fade-in zoom-in-95 duration-100"
                >
                <DropdownMenu.Item
                  onClick={() => createSession('auto')}
                  className="flex items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-[#333] hover:text-white rounded-lg outline-none cursor-pointer transition-colors"
                >
                  <Terminal className="w-4 h-4 text-gray-500" />
                  Default Shell
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onClick={() => createSession('powershell')}
                  className="flex items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-[#333] hover:text-white rounded-lg outline-none cursor-pointer transition-colors"
                >
                  <Monitor className="w-4 h-4 text-blue-400" />
                  PowerShell
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onClick={() => createSession('cmd')}
                  className="flex items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-[#333] hover:text-white rounded-lg outline-none cursor-pointer transition-colors"
                >
                  <TerminalSquare className="w-4 h-4 text-gray-400" />
                  Command Prompt
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onClick={() => createSession('bash')}
                  className="flex items-center gap-3 px-3 py-2 text-[13px] text-gray-300 hover:bg-[#333] hover:text-white rounded-lg outline-none cursor-pointer transition-colors"
                >
                  <Cpu className="w-4 h-4 text-green-400" />
                  Bash (WSL)
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {activeCliAgent && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#252526] border-b border-[#333] text-[11px]">
          <span className="text-gray-500 truncate flex-1" title={activeCliAgent.cwd}>
            {activeCliAgent.cwd}
          </span>
          <button
            onClick={toggleTakeOver}
            title={isTakenOver ? 'Watching is off — you are typing into the agent. Click to go back to watch-only.' : 'Take over: type into the agent terminal'}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide transition-colors',
              isTakenOver ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25' : 'text-gray-400 hover:bg-[#333]',
            )}
          >
            {isTakenOver ? <Keyboard className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {isTakenOver ? 'Typing' : 'Watching'}
          </button>
        </div>
      )}

      {/* Terminal Area */}
      <div className="flex-1 relative overflow-hidden bg-[#1e1e1e]">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 bg-[#1e1e1e] p-6">
            <div className="w-16 h-16 rounded-2xl bg-[#252526] flex items-center justify-center mb-6 border border-[#333]">
              <Terminal className="w-8 h-8 opacity-50" />
            </div>
            <h3 className="text-lg font-bold text-gray-300 mb-2">No Active Terminals</h3>
            <p className="text-sm text-gray-500 mb-8 max-w-[240px] text-center">Open a new session to start executing commands and scripts.</p>
            <button
              onClick={() => createSession('auto')}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-[13px] font-bold transition-all active:scale-95 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Terminal Session
            </button>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={clsx('absolute inset-0 p-3', session.id === activeSessionId ? 'block' : 'hidden')}
            >
              <div className="w-full h-full rounded-xl overflow-hidden border border-[#333] bg-[#1e1e1e]">
                <XTerminal
                  sessionId={session.id}
                  onResize={session.id === activeSessionId ? handleResize : undefined}
                  readOnly={!!cliAgentByTerminalId[session.id] && !takenOver[cliAgentByTerminalId[session.id].id]}
                  ref={(ref) => setTerminalRef(session.id, ref)}
                  className="h-full"
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default XTerminalPanel;
