import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Terminal, X, ChevronDown, Monitor, Cpu, TerminalSquare } from 'lucide-react';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
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

interface XTerminalPanelProps {
  className?: string;
  onClose?: () => void;
}

export const XTerminalPanel: React.FC<XTerminalPanelProps> = ({ className, onClose }) => {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const terminalRefs = useRef<Map<string, XTerminalRef>>(new Map());

  // Load existing sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      const result = await (window as any).desktopAPI?.terminalList?.();
      if (result?.ok && Array.isArray(result.sessions)) {
        setSessions(result.sessions);
        if (result.sessions.length > 0 && !activeSessionId) {
          setActiveSessionId(result.sessions[0].id);
        }
      }
    };
    loadSessions();
  }, []);

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
    const loadBuffer = async () => {
      const result = await (window as any).desktopAPI?.terminalGetBuffer?.(activeSessionId);
      if (result?.ok && Array.isArray(result.buffer)) {
        const termRef = terminalRefs.current.get(activeSessionId);
        if (termRef) {
          for (const chunk of result.buffer) {
            termRef.write(chunk);
          }
        }
      }
    };
    // Small delay to ensure terminal is mounted
    setTimeout(loadBuffer, 50);
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
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    terminalRefs.current.delete(sessionId);
    if (activeSessionId === sessionId) {
      const remaining = sessions.filter(s => s.id !== sessionId);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
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

  const activeSession = sessions.find(s => s.id === activeSessionId);

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
              {session.title || session.shell.split(/[/\\]/).pop()}
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
          sessions.map(session => (
            <div
              key={session.id}
              className={clsx(
                "absolute inset-0 p-3",
                session.id === activeSessionId ? "visible opacity-100 scale-100" : "invisible opacity-0 scale-95",
                "transition-all duration-200"
              )}
            >
              <div className="w-full h-full rounded-xl overflow-hidden border border-[#333] bg-[#1e1e1e]">
                <XTerminal
                  sessionId={session.id}
                  onResize={handleResize}
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
