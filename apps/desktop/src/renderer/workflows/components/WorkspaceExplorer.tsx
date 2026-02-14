/**
 * WorkspaceExplorer - File tree + variable reference panel for workflow workspaces
 * Shows workspace files/dirs, allows CRUD, and provides a quick-reference for
 * $workspace and $vars template syntax.
 */
import React, { useState, useCallback, useMemo } from "react";
import {
  FolderOpen, File, Plus, Trash2, ChevronRight, ChevronDown,
  Copy, FolderPlus, FileText, RefreshCw, ExternalLink,
  Variable, Braces, Hash, ToggleLeft, List, Code2, X
} from "lucide-react";
import type { WorkspaceFileEntry } from "../types";
import type { WorkspaceInfo } from "../hooks/useWorkflowOperations";
import type { WorkflowVariable } from "../types";

interface WorkspaceExplorerProps {
  flowId: string;
  workspaceInfo: WorkspaceInfo | null;
  variables?: WorkflowVariable[];
  onRefresh: () => void;
  onClose: () => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
}

// ─── File Icon Helper ──────────────────────────────────────────────────────
function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['py'].includes(ext)) return <Code2 className="w-3.5 h-3.5 text-yellow-500" />;
  if (['js', 'ts', 'mjs'].includes(ext)) return <Code2 className="w-3.5 h-3.5 text-blue-400" />;
  if (['json', 'stuard'].includes(ext)) return <Braces className="w-3.5 h-3.5 text-emerald-500" />;
  if (['txt', 'md', 'csv', 'log'].includes(ext)) return <FileText className="w-3.5 h-3.5 text-slate-400" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return <File className="w-3.5 h-3.5 text-pink-400" />;
  return <File className="w-3.5 h-3.5 text-slate-400" />;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Variable Type Icon ────────────────────────────────────────────────────
function varTypeIcon(type: string) {
  switch (type) {
    case 'string': return <FileText className="w-3 h-3" />;
    case 'number': return <Hash className="w-3 h-3" />;
    case 'boolean': return <ToggleLeft className="w-3 h-3" />;
    case 'list': return <List className="w-3 h-3" />;
    case 'json': return <Braces className="w-3 h-3" />;
    default: return <Variable className="w-3 h-3" />;
  }
}

// ─── Copyable Reference Pill ───────────────────────────────────────────────
function RefPill({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded text-[11px] font-mono text-slate-600 hover:text-indigo-700 transition-all group"
      title={`Click to copy: ${value}`}
    >
      <span className="truncate max-w-[180px]">{label || value}</span>
      <Copy className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      {copied && <span className="text-emerald-600 text-[9px] font-sans ml-0.5">✓</span>}
    </button>
  );
}

// ─── File Tree Node ────────────────────────────────────────────────────────
function FileTreeNode({
  entry, files, flowId, onRefresh, onOpenFile, depth = 0
}: {
  entry: WorkspaceFileEntry;
  files: WorkspaceFileEntry[];
  flowId: string;
  onRefresh: () => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [hovering, setHovering] = useState(false);

  const children = useMemo(() => {
    if (entry.type !== 'directory') return [];
    const prefix = entry.path + '/';
    return files.filter(f => {
      if (!f.path.startsWith(prefix)) return false;
      const rest = f.path.slice(prefix.length);
      return !rest.includes('/');
    });
  }, [entry.path, files]);

  const handleDelete = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${entry.name}"?`)) return;
    await (window as any).desktopAPI?.workflowsDeleteWorkspaceFile?.(flowId, entry.path);
    onRefresh();
  }, [flowId, entry.path, onRefresh]);

  const templateRef = `{{$workspace.file.${entry.path.replace(/\//g, '.')}}}`;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-slate-50 rounded transition-colors group`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={() => {
          if (entry.type === 'directory') setExpanded(!expanded);
          else if (entry.name.endsWith('.stuard')) { /* .stuard files open as canvas, not code */ }
          else if (onOpenFile) onOpenFile(entry.path, entry.name);
        }}
      >
        {entry.type === 'directory' ? (
          <>
            {expanded ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
            <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            {fileIcon(entry.name)}
          </>
        )}
        <span className="text-xs text-slate-700 truncate flex-1">{entry.name}</span>
        {entry.size !== undefined && (
          <span className="text-[10px] text-slate-400 shrink-0">{formatSize(entry.size)}</span>
        )}
        {hovering && (
          <div className="flex items-center gap-0.5 shrink-0">
            {entry.type === 'file' && (
              <button
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(templateRef); }}
                className="p-0.5 text-slate-400 hover:text-indigo-600 rounded"
                title={`Copy reference: ${templateRef}`}
              >
                <Copy className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={handleDelete}
              className="p-0.5 text-slate-400 hover:text-red-500 rounded"
              title="Delete"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      {entry.type === 'directory' && expanded && children.map(child => (
        <FileTreeNode
          key={child.path}
          entry={child}
          files={files}
          flowId={flowId}
          onRefresh={onRefresh}
          onOpenFile={onOpenFile}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────
export function WorkspaceExplorer({ flowId, workspaceInfo, variables, onRefresh, onClose, onOpenFile }: WorkspaceExplorerProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'references'>('files');
  const [newFileName, setNewFileName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [newSubdir, setNewSubdir] = useState('');
  const [showNewSubdir, setShowNewSubdir] = useState(false);

  // Build root-level entries from flat file list
  const rootEntries = useMemo(() => {
    if (!workspaceInfo?.files) return [];
    return workspaceInfo.files.filter(f => !f.path.includes('/'));
  }, [workspaceInfo?.files]);

  const handleCreateFile = useCallback(async () => {
    if (!newFileName.trim()) return;
    await (window as any).desktopAPI?.workflowsWriteWorkspaceFile?.(flowId, newFileName.trim(), '');
    setNewFileName('');
    setShowNewFile(false);
    onRefresh();
  }, [flowId, newFileName, onRefresh]);

  const handleCreateSubdir = useCallback(async () => {
    if (!newSubdir.trim()) return;
    await (window as any).desktopAPI?.workflowsCreateWorkspaceSubdir?.(flowId, newSubdir.trim());
    setNewSubdir('');
    setShowNewSubdir(false);
    onRefresh();
  }, [flowId, newSubdir, onRefresh]);

  const handleOpenInExplorer = useCallback(async () => {
    if (workspaceInfo?.workspacePath) {
      await (window as any).desktopAPI?.showItemInFolder?.(workspaceInfo.workspacePath);
    }
  }, [workspaceInfo?.workspacePath]);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="h-10 px-3 border-b border-slate-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-semibold text-slate-700">Workspace</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onRefresh} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleOpenInExplorer} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors" title="Open in File Explorer">
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 shrink-0">
        <button
          onClick={() => setActiveTab('files')}
          className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${activeTab === 'files' ? 'text-slate-800 border-b-2 border-slate-800' : 'text-slate-400 hover:text-slate-600'}`}
        >
          Files
        </button>
        <button
          onClick={() => setActiveTab('references')}
          className={`flex-1 py-1.5 text-[11px] font-medium transition-colors ${activeTab === 'references' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
        >
          References
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'files' && (
          <div className="py-1">
            {!workspaceInfo ? (
              <div className="px-3 py-6 text-center">
                <FolderOpen className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400">No workspace available</p>
                <p className="text-[10px] text-slate-300 mt-1">Legacy workflow format</p>
              </div>
            ) : (
              <>
                {/* File Tree */}
                {rootEntries.map(entry => (
                  <FileTreeNode
                    key={entry.path}
                    entry={entry}
                    files={workspaceInfo.files}
                    flowId={flowId}
                    onRefresh={onRefresh}
                    onOpenFile={onOpenFile}
                  />
                ))}

                {rootEntries.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">
                    Empty workspace
                  </div>
                )}

                {/* Action Buttons */}
                <div className="px-2 pt-2 pb-1 space-y-1 border-t border-slate-50 mt-1">
                  {showNewFile ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={newFileName}
                        onChange={e => setNewFileName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateFile(); if (e.key === 'Escape') setShowNewFile(false); }}
                        placeholder="e.g. scripts/helper.py"
                        className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:border-indigo-400 focus:outline-none"
                      />
                      <button onClick={handleCreateFile} className="px-2 py-1 text-[10px] font-medium bg-slate-900 text-white rounded hover:bg-slate-800">Create</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewFile(true)}
                      className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New File</span>
                    </button>
                  )}
                  {showNewSubdir ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={newSubdir}
                        onChange={e => setNewSubdir(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleCreateSubdir(); if (e.key === 'Escape') setShowNewSubdir(false); }}
                        placeholder="e.g. models"
                        className="flex-1 px-2 py-1 text-xs bg-white border border-slate-200 rounded focus:border-indigo-400 focus:outline-none"
                      />
                      <button onClick={handleCreateSubdir} className="px-2 py-1 text-[10px] font-medium bg-slate-900 text-white rounded hover:bg-slate-800">Create</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowNewSubdir(true)}
                      className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded transition-colors"
                    >
                      <FolderPlus className="w-3 h-3" />
                      <span>New Folder</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'references' && (
          <div className="p-3 space-y-4">
            {/* Workspace Path References */}
            <div>
              <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                Workspace Paths
              </h4>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Root</span>
                  <RefPill value="{{$workspace.path}}" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Data</span>
                  <RefPill value="{{$workspace.data}}" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Scripts</span>
                  <RefPill value="{{$workspace.scripts}}" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Assets</span>
                  <RefPill value="{{$workspace.assets}}" />
                </div>
              </div>
              <div className="mt-2 px-2 py-1.5 bg-slate-50 rounded text-[10px] text-slate-500 leading-relaxed">
                Use in any step argument to reference workspace paths.
                <br />Example: <code className="text-indigo-600">{"{{$workspace.scripts}}"}/process.py</code>
              </div>
            </div>

            {/* File References */}
            {workspaceInfo && workspaceInfo.files.filter(f => f.type === 'file').length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                  <File className="w-3.5 h-3.5 text-blue-400" />
                  File Paths
                </h4>
                <div className="space-y-1">
                  {workspaceInfo.files
                    .filter(f => f.type === 'file')
                    .map(f => (
                      <div key={f.path} className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500 truncate max-w-[80px]">{f.name}</span>
                        <RefPill value={`{{$workspace.file.${f.path.replace(/\//g, '.')}}}`} label={f.path} />
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Workflow Variables */}
            {variables && variables.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                  <Variable className="w-3.5 h-3.5 text-violet-500" />
                  Variables
                </h4>
                <div className="space-y-1.5">
                  {variables.map(v => (
                    <div key={v.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-slate-400 shrink-0">{varTypeIcon(v.type)}</span>
                        <span className="text-[10px] text-slate-600 truncate">{v.name}</span>
                      </div>
                      <RefPill value={`{{$vars.${v.name}}}`} label={v.name} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step Output References */}
            <div>
              <h4 className="text-[11px] font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                <Braces className="w-3.5 h-3.5 text-emerald-500" />
                Step Outputs
              </h4>
              <div className="px-2 py-1.5 bg-slate-50 rounded text-[10px] text-slate-500 leading-relaxed space-y-1">
                <p>Reference any previous step's output:</p>
                <code className="block text-indigo-600">{"{{step_id.fieldName}}"}</code>
                <p className="mt-1">Common fields:</p>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-0.5">
                  <code className="text-indigo-600">.ok</code><span>Success boolean</span>
                  <code className="text-indigo-600">.text</code><span>Text output</span>
                  <code className="text-indigo-600">.result</code><span>Full result</span>
                  <code className="text-indigo-600">.stdout</code><span>Script output</span>
                  <code className="text-indigo-600">.filePath</code><span>File path</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
