import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, ChevronDown, X, Check, Terminal, FolderOpen, Globe, Cpu, FileText, Trash2, Send } from 'lucide-react';
import clsx from 'clsx';

interface PermissionDialogProps {
  isOpen: boolean;
  tool: string;
  args?: Record<string, any>;
  description?: string;
  onAllow: () => void;
  onDeny: () => void;
}

// Map tool names to icons and descriptions
const toolMeta: Record<string, { icon: React.ElementType; description: string; risk: 'low' | 'medium' | 'high' }> = {
  run_command: { icon: Terminal, description: 'Execute a terminal command', risk: 'high' },
  run_python_script: { icon: Cpu, description: 'Run a Python script', risk: 'medium' },
  run_node_script: { icon: Cpu, description: 'Run a Node.js script', risk: 'medium' },
  write_file: { icon: FileText, description: 'Write to a file', risk: 'medium' },
  workspace_write_file: { icon: FileText, description: 'Write to a workspace file', risk: 'medium' },
  workspace_delete_file: { icon: Trash2, description: 'Delete a workspace file', risk: 'high' },
  workspace_create_folder: { icon: FolderOpen, description: 'Create a workspace folder', risk: 'low' },
  delete_file: { icon: Trash2, description: 'Delete a file', risk: 'high' },
  move_file: { icon: FolderOpen, description: 'Move or rename a file', risk: 'medium' },
  copy_file: { icon: FolderOpen, description: 'Copy a file', risk: 'low' },
  create_directory: { icon: FolderOpen, description: 'Create a directory', risk: 'low' },
  send_hotkey: { icon: Cpu, description: 'Send keyboard input', risk: 'medium' },
  web_search: { icon: Globe, description: 'Search the web', risk: 'low' },
  outlook_send_mail: { icon: Send, description: 'Send an email via Outlook', risk: 'high' },
  gmail_send_mail: { icon: Send, description: 'Send an email via Gmail', risk: 'high' },
};

const defaultMeta = { icon: Shield, description: 'Perform an action', risk: 'medium' as const };

// Humanize tool name
function humanizeTool(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// Format args for display
function formatArgs(args: Record<string, any>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

// Get a brief summary of args
function getArgsSummary(args: Record<string, any>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  
  // Show the most important arg value
  const importantKeys = ['command', 'path', 'code', 'query', 'file', 'content', 'to', 'subject'];
  for (const key of importantKeys) {
    if (args[key]) {
      const val = String(args[key]);
      return val.length > 60 ? val.slice(0, 60) + '…' : val;
    }
  }
  
  // Fallback to first key
  const firstVal = String(args[keys[0]]);
  return firstVal.length > 60 ? firstVal.slice(0, 60) + '…' : firstVal;
}

export const PermissionDialog: React.FC<PermissionDialogProps> = ({
  isOpen,
  tool,
  args,
  description,
  onAllow,
  onDeny,
}) => {
  const [showArgs, setShowArgs] = useState(false);
  
  const meta = toolMeta[tool] || defaultMeta;
  const Icon = meta.icon;
  const humanName = humanizeTool(tool);
  const argsSummary = args ? getArgsSummary(args) : '';
  
  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onAllow();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDeny();
      }
    };
    
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onAllow, onDeny]);

  const riskColors = {
    low: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    medium: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
    high: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20',
  };

  const riskBadge = {
    low: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    high: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: "100%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed left-0 right-0 bottom-0 z-[99999] flex justify-center pointer-events-auto"
        >
          <div className="w-full max-w-xl mx-4 mb-4 border border-theme bg-theme-card backdrop-blur-xl rounded-2xl shadow-2xl">
            {/* Header */}
            <div className="px-4 py-3 flex items-center gap-3 bg-theme-hover/50 rounded-t-2xl border-b border-theme/30">
              <div className={clsx(
                "p-2 rounded-lg border flex-shrink-0",
                riskColors[meta.risk]
              )}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex items-center gap-2">
                  <h3 className="text-theme-fg font-medium text-xs tracking-wide">Permission Required</h3>
                  {meta.risk === 'high' && (
                    <span className={clsx(
                      "text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider",
                      riskBadge[meta.risk]
                    )}>
                      High Risk
                    </span>
                  )}
                </div>
                <p className="text-theme-muted text-[11px] truncate mt-0.5">
                  {description || meta.description}
                </p>
              </div>
            </div>

            {/* Tool info */}
            <div className="px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-theme-muted text-[10px] uppercase tracking-wider font-medium w-8">Tool</span>
                <code className="text-theme-fg text-[11px] font-mono bg-theme-hover px-1.5 py-0.5 rounded border border-theme/30">
                  {tool}
                </code>
              </div>
              
              {argsSummary && !showArgs && (
                <div className="flex items-start gap-2">
                   <span className="text-theme-muted text-[10px] uppercase tracking-wider font-medium w-8 mt-1">Args</span>
                   <div className="flex-1 text-theme-fg text-[11px] font-mono bg-theme-hover/50 rounded px-2 py-1 truncate border border-theme/20">
                    {argsSummary}
                   </div>
                </div>
              )}

              {/* Expandable args */}
              {args && Object.keys(args).length > 0 && (
                <div>
                   <button
                    onClick={() => setShowArgs(!showArgs)}
                    className="flex items-center gap-1.5 text-theme-muted hover:text-theme-fg text-[10px] transition-colors mt-1 ml-[40px]"
                  >
                    <ChevronDown className={clsx(
                      "w-3 h-3 transition-transform duration-200",
                      showArgs && "rotate-180"
                    )} />
                    <span>{showArgs ? 'Hide details' : 'Show details'}</span>
                  </button>

                  <AnimatePresence initial={false}>
                    {showArgs && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden ml-[40px]"
                      >
                        <pre className="mt-1 text-theme-fg text-[10px] font-mono bg-theme-hover/50 rounded border border-theme/20 px-2 py-2 overflow-x-auto scrollbar-hidden max-h-40">
                          {formatArgs(args)}
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-3 py-2 border-t border-theme/30 flex items-center justify-between gap-3 bg-theme-hover/50 rounded-b-2xl">
              <div className="text-theme-muted text-[9px] font-medium hidden sm:block">
                Press <span className="text-theme-fg">Enter</span> to allow
              </div>
              <div className="flex gap-2 flex-1 sm:flex-none justify-end">
                <button
                  onClick={onDeny}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-theme-hover hover:bg-theme-active text-theme-muted hover:text-theme-fg text-xs font-medium transition-colors border border-theme/30 w-full sm:w-auto"
                >
                  Deny
                </button>
                <button
                  onClick={onAllow}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-fg hover:opacity-90 text-xs font-semibold transition-colors w-full sm:w-auto"
                >
                  Allow
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default PermissionDialog;
