import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Play, 
  Square, 
  Trash2, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  RefreshCw,
  Search,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  ChevronRight,
  Command,
  PanelLeft,
  ArrowLeft
} from 'lucide-react';
import { clsx } from 'clsx';
import AnsiText from './AnsiText';
import { motion, AnimatePresence } from 'framer-motion';

// Types
interface TerminalSession {
  terminalId: string;
  command?: string;
  shell?: string;
  cwd?: string | null;
  pid?: number;
  done?: boolean;
  exitCode?: number | null;
  updatedAtMs?: number;
  createdAtMs?: number;
  seq?: number;
}

interface TerminalChunk {
  seq: number;
  ts?: number;
  stream?: string;
  text: string;
}

interface TerminalPanelProps {
  onClose?: () => void;
  className?: string;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ onClose, className }) => {
  // State
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [terminalText, setTerminalText] = useState<string>('');
  const [terminalDone, setTerminalDone] = useState<boolean>(false);
  const [terminalExitCode, setTerminalExitCode] = useState<number | null>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  
  const [commandInput, setCommandInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Command History
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const terminalSinceSeqRef = useRef<number>(0);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // --- Actions ---

  const fetchTerminals = async () => {
    setLoading(true);
    try {
      const result = await (window as any).desktopAPI?.execTool?.('list_terminals', {});
      if (result?.ok && Array.isArray(result?.terminals)) {
        setTerminals(result.terminals);
        // If no selection and we have terminals, select the most recent one
        if (!selectedId && result.terminals.length > 0) {
           // list_terminals sorts by updatedAt desc usually, or we can sort
           const mostRecent = result.terminals[0];
           handleSelectTerminal(mostRecent.terminalId, mostRecent, false);
        }
      }
    } catch (e) {
      console.error('Failed to list terminals', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTerminal = (id: string, session?: TerminalSession, shouldCollapse: boolean = true) => {
    if (selectedId === id) {
      if (shouldCollapse) setIsSidebarOpen(false);
      return;
    }
    setSelectedId(id);
    terminalSinceSeqRef.current = 0;
    setTerminalText('');
    setTerminalDone(session ? Boolean(session.done) : false);
    setTerminalExitCode(session?.exitCode ?? null);
    setIsAutoScroll(true);
    if (shouldCollapse) setIsSidebarOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      
      const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setCommandInput(history[newIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      
      const newIndex = historyIndex + 1;
      if (newIndex >= history.length) {
        setHistoryIndex(-1);
        setCommandInput('');
      } else {
        setHistoryIndex(newIndex);
        setCommandInput(history[newIndex]);
      }
    }
  };

  const pollCurrentTerminal = async () => {
    if (!selectedId) return;
    try {
      const res = await (window as any).desktopAPI?.execTool?.('read_terminal', {
        terminalId: selectedId,
        sinceSeq: terminalSinceSeqRef.current,
        maxChars: 8000,
      });

      if (!res?.ok) return;

      // Update Output
      const chunks: TerminalChunk[] = Array.isArray(res?.chunks) ? res.chunks : [];
      if (chunks.length > 0) {
        const joined = chunks.map(c => String(c?.text || '')).join('');
        setTerminalText(prev => prev + joined);
        
        const maxSeq = chunks.reduce((m, c) => Math.max(m, Number(c?.seq || 0)), terminalSinceSeqRef.current);
        terminalSinceSeqRef.current = maxSeq;
      }

      // Update Status
      if (res.done !== undefined) setTerminalDone(res.done);
      if (res.exitCode !== undefined) setTerminalExitCode(res.exitCode);
      if (res.seq && res.seq > terminalSinceSeqRef.current) terminalSinceSeqRef.current = res.seq;

    } catch (e) {
      console.error('Poll error', e);
    }
  };

  const runCommand = async () => {
    if (!commandInput.trim()) return;
    setIsExecuting(true);
    
    // Add to history
    setHistory(prev => {
      const newHistory = [...prev, commandInput];
      // Keep last 50
      if (newHistory.length > 50) return newHistory.slice(newHistory.length - 50);
      return newHistory;
    });
    setHistoryIndex(-1);

    try {
      // We use 'run_command' which starts a background process
      const res = await (window as any).desktopAPI?.execTool?.('run_command', {
        command: commandInput,
        description: 'User terminal command',
        background: true
      });

      if (res?.ok) {
         setCommandInput('');
         // Refresh list to show new terminal
         fetchTerminals();
         // If we got a terminalId back, select it
         // Note: run_command output might vary. Let's assume it might return terminalId if async.
         // If it's the "run_command" tool from system.py:
         // If Blocking=False, it calls _start_terminal_session and returns terminalId.
         if (res.terminalId) {
             handleSelectTerminal(res.terminalId);
         }
      }
    } catch (e) {
      console.error('Failed to run command', e);
    } finally {
      setIsExecuting(false);
    }
  };

  // --- Effects ---

  useEffect(() => {
    fetchTerminals();
    const interval = setInterval(fetchTerminals, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (selectedId) {
       pollCurrentTerminal(); // initial call
       pollingRef.current = setInterval(pollCurrentTerminal, 500);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [selectedId]);

  // Auto-scroll
  useEffect(() => {
    if (isAutoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminalText, isAutoScroll]);

  // Handle manual scroll
  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsAutoScroll(isAtBottom);
  };

  // --- Render ---

  const selectedSession = terminals.find(t => t.terminalId === selectedId);

  return (
    <div className={clsx("flex h-full bg-[#1e1e1e] text-gray-300 font-sans overflow-hidden rounded-r-[20px]", className)}>
      
      {/* Sidebar: Session List */}
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 224, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="flex flex-col border-r border-[#333] bg-[#252526] overflow-hidden flex-shrink-0"
          >
            <div className="p-3 border-b border-[#333] flex items-center justify-between min-w-[224px]">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Sessions</span>
              <div className="flex gap-1">
                <button onClick={fetchTerminals} className="p-1 hover:bg-[#333] rounded text-gray-400" title="Refresh">
                   <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setIsSidebarOpen(false)} className="p-1 hover:bg-[#333] rounded text-gray-400" title="Close Sidebar">
                   <PanelLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1 min-w-[224px]">
              {terminals.map(t => {
                 const isActive = t.terminalId === selectedId;
                 return (
                   <button
                     key={t.terminalId}
                     onClick={() => handleSelectTerminal(t.terminalId, t)}
                     className={clsx(
                       "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-3 group",
                       isActive ? "bg-[#37373d] text-white" : "hover:bg-[#2a2d2e] text-gray-400"
                     )}
                   >
                     <div className={clsx("w-2 h-2 rounded-full flex-shrink-0", t.done ? (t.exitCode === 0 ? "bg-green-500" : "bg-red-500") : "bg-blue-500 animate-pulse")} />
                     <div className="flex-1 min-w-0">
                       <div className="font-medium truncate">{t.command || 'Unknown Command'}</div>
                       <div className="text-[10px] opacity-60 truncate">{t.terminalId}</div>
                     </div>
                   </button>
                 );
              })}
              
              {terminals.length === 0 && (
                 <div className="text-center py-8 text-xs text-gray-600">
                   No active sessions
                 </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Area: Terminal Output */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
        {/* Header */}
        <div className="h-10 border-b border-[#333] flex items-center justify-between px-4 bg-[#252526]">
           <div className="flex items-center gap-3 min-w-0">
              {!isSidebarOpen && (
                <button 
                  onClick={() => setIsSidebarOpen(true)} 
                  className="flex items-center gap-1.5 px-2 py-1 hover:bg-[#333] rounded text-gray-400 mr-1 text-xs font-medium transition-colors"
                  title="Back to Sessions"
                >
                   <ArrowLeft className="w-3.5 h-3.5" />
                   Back
                </button>
              )}
              {selectedSession ? (
                 <>
                   <div className={clsx(
                      "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border flex-shrink-0",
                      selectedSession.done 
                        ? (selectedSession.exitCode === 0 ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-red-500/10 text-red-400 border-red-500/20")
                        : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                   )}>
                      {selectedSession.done ? (selectedSession.exitCode === 0 ? "Success" : "Failed") : "Running"}
                   </div>
                   <span className="text-sm font-mono text-gray-300 truncate max-w-md" title={selectedSession.command}>
                      {selectedSession.command}
                   </span>
                 </>
              ) : (
                <span className="text-sm text-gray-500 truncate">Select a terminal session</span>
              )}
           </div>
           
           <div className="flex items-center gap-2">
             {/* Additional Controls can go here */}
           </div>
        </div>

        {/* Output */}
        <div 
           ref={outputRef}
           onScroll={handleScroll}
           className="flex-1 overflow-y-auto custom-scrollbar p-4 font-mono text-sm leading-relaxed"
        >
           {terminalText ? (
             <AnsiText>{terminalText}</AnsiText>
           ) : (
             <div className="text-gray-600 italic">
                {selectedId ? "Waiting for output..." : "No session selected."}
             </div>
           )}
        </div>

        {/* Input Area */}
        <div className="p-3 border-t border-[#333] bg-[#252526]">
          <form 
            onSubmit={(e) => { e.preventDefault(); runCommand(); }}
            className="flex items-center gap-2 bg-[#1e1e1e] border border-[#333] rounded-lg px-3 py-2 focus-within:border-blue-500/50 transition-colors"
          >
             <ChevronRight className="w-4 h-4 text-blue-500 animate-pulse" />
             <input 
               className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-gray-200 placeholder:text-gray-600"
               placeholder="Run a command..."
               value={commandInput}
               onChange={e => setCommandInput(e.target.value)}
               onKeyDown={handleKeyDown}
             />
             {isExecuting && <RefreshCw className="w-4 h-4 text-gray-500 animate-spin" />}
          </form>
        </div>
      </div>
    </div>
  );
};
