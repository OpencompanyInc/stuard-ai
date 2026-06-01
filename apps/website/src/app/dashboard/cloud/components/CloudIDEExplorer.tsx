'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  FolderPlus,
  Loader2,
  Paperclip,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useFileViewer } from '@stuardai/cloud-runtime-ui/file-viewer';
import {
  createDirectory,
  deleteFile,
  listFiles,
  uploadFileToVm,
} from '@/lib/cloudApi';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
}

export function CloudIDEExplorer({ isRunning }: { isRunning: boolean }) {
  const { openFile } = useFileViewer();
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  const fileUploadInputRef = React.useRef<HTMLInputElement | null>(null);
  const fileUploadTargetDirRef = React.useRef<string>('.');

  const loadDir = useCallback(async (path: string) => {
    setLoadingDirs((prev) => new Set(prev).add(path));
    try {
      const data = await listFiles(path);
      if (data.ok) setDirContents((prev) => ({ ...prev, [path]: data.entries || [] }));
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (isRunning) void loadDir('.');
  }, [isRunning, loadDir]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!dirContents[path]) void loadDir(path);
      }
      return next;
    });
  }, [dirContents, loadDir]);

  const triggerUploadInto = useCallback((dirPath: string) => {
    fileUploadTargetDirRef.current = dirPath || '.';
    setFileActionError(null);
    fileUploadInputRef.current?.click();
  }, []);

  const handleFileUploadSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    const dir = fileUploadTargetDirRef.current || '.';
    setFileActionError(null);
    for (const file of files) {
      const targetPath = dir === '.' ? file.name : `${dir}/${file.name}`;
      setUploadingFileName(file.name);
      try {
        const res = await uploadFileToVm(targetPath, file);
        if (!res?.ok) setFileActionError(res?.error || `Failed to upload ${file.name}`);
      } catch (err: unknown) {
        setFileActionError(err instanceof Error ? err.message : `Failed to upload ${file.name}`);
      }
    }
    setUploadingFileName(null);
    void loadDir(dir);
  }, [loadDir]);

  const handleCreateDir = useCallback(async (parentDir: string) => {
    const name = typeof window !== 'undefined' ? window.prompt('New folder name:') : null;
    if (!name) return;
    const path = parentDir === '.' ? name : `${parentDir}/${name}`;
    setFileActionError(null);
    try {
      const res = await createDirectory(path);
      if (!res?.ok) setFileActionError(res?.error || 'Failed to create folder');
    } catch (err: unknown) {
      setFileActionError(err instanceof Error ? err.message : 'Failed to create folder');
    }
    void loadDir(parentDir);
  }, [loadDir]);

  const handleDeleteEntry = useCallback(async (entry: FileEntry) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${entry.path}?`)) return;
    setFileActionError(null);
    try {
      const res = await deleteFile(entry.path);
      if (!res?.ok) setFileActionError(res?.error || `Failed to delete ${entry.name}`);
    } catch (err: unknown) {
      setFileActionError(err instanceof Error ? err.message : `Failed to delete ${entry.name}`);
    }
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '.';
    void loadDir(parent || '.');
  }, [loadDir]);

  const attachExistingFile = useCallback((entry: { name: string; path: string; size?: number }) => {
    const fn = (window as { __cloudVmChatAttach?: (e: { path: string; name: string; size?: number }) => void }).__cloudVmChatAttach;
    fn?.({ path: entry.path, name: entry.name, size: entry.size });
  }, []);

  const openFileInViewer = useCallback((entry: { name: string; path: string }) => {
    openFile({ path: entry.path, source: 'vm', name: entry.name });
  }, [openFile]);

  const renderTree = (entries: FileEntry[], depth = 0): React.ReactNode => {
    return [...entries]
      .sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      })
      .map((entry) => {
        const isDir = entry.type === 'directory';
        const isExpanded = expandedDirs.has(entry.path);
        const children = dirContents[entry.path];
        const isLoading = loadingDirs.has(entry.path);
        return (
          <div key={entry.path} className="group/entry">
            <div
              className="ide-tree-item group relative flex items-center"
              style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
              <button
                onClick={() => {
                  if (isDir) toggleDir(entry.path);
                  else openFileInViewer({ name: entry.name, path: entry.path });
                }}
                className="flex flex-1 items-center gap-1 min-w-0 bg-transparent border-none p-0 text-left cursor-pointer"
                title={isDir ? 'Expand/collapse' : 'Open file'}
              >
                {isDir ? (
                  <svg className={`ide-tree-chevron ${isExpanded ? 'ide-tree-chevron-open' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 6l6 6-6 6z" />
                  </svg>
                ) : (
                  <span className="ide-tree-spacer" />
                )}
                {isDir ? <FolderIcon /> : <FileIcon name={entry.name} />}
                <span className="truncate">{entry.name}</span>
              </button>
              <div className="ml-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pr-1.5">
                {isDir && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); triggerUploadInto(entry.path); }}
                      className="rounded p-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60"
                      title="Upload files here"
                    >
                      <Upload className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleCreateDir(entry.path); }}
                      className="rounded p-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60"
                      title="New folder"
                    >
                      <FolderPlus className="h-3 w-3" />
                    </button>
                  </>
                )}
                {!isDir && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); attachExistingFile({ name: entry.name, path: entry.path, size: entry.size }); }}
                    className="rounded p-0.5 text-theme-muted hover:text-theme-fg hover:bg-theme-hover/60"
                    title="Attach to chat"
                  >
                    <Paperclip className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleDeleteEntry(entry); }}
                  className="rounded p-0.5 text-red-400 hover:text-red-500 hover:bg-red-500/10"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            {isDir && isExpanded && (
              isLoading
                ? <div className="ide-tree-loading" style={{ paddingLeft: `${24 + depth * 16}px` }}>Loading...</div>
                : children ? renderTree(children, depth + 1) : null
            )}
          </div>
        );
      });
  };

  return (
    <div className="ide-file-panel">
      <div className="ide-file-panel-header">
        <span className="ide-panel-title">Workspace</span>
        <div className="flex items-center gap-1">
          <button onClick={() => triggerUploadInto('.')} className="ide-panel-action" title="Upload files to workspace">
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => void handleCreateDir('.')} className="ide-panel-action" title="New folder">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => void loadDir('.')} className="ide-panel-action" title="Refresh files">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {(fileActionError || uploadingFileName) && (
        <div className="px-3 py-1.5 text-[10px] border-b border-theme/10 space-y-0.5">
          {uploadingFileName && (
            <div className="flex items-center gap-1.5 text-theme-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="truncate">Uploading {uploadingFileName}…</span>
            </div>
          )}
          {fileActionError && (
            <div className="flex items-start gap-1.5 text-red-400">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
              <span className="truncate">{fileActionError}</span>
              <button className="ml-auto text-theme-muted hover:text-theme-fg" onClick={() => setFileActionError(null)}>
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}
      <div className="ide-file-tree">
        {dirContents['.'] ? renderTree(dirContents['.']) : (
          <div className="ide-tree-loading" style={{ paddingLeft: '16px' }}>Loading files...</div>
        )}
      </div>
      <input
        ref={fileUploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileUploadSelected}
      />
    </div>
  );
}

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
    ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#f7df1e', py: '#3776ab',
    json: '#a8b1c2', md: '#519aba', css: '#264de4', html: '#e34c26',
    yml: '#cb171e', yaml: '#cb171e', sh: '#89e051', bash: '#89e051',
  };
  return (
    <svg className="ide-tree-icon" viewBox="0 0 24 24" fill="none" stroke={colorMap[ext] || 'var(--ide-text-dim)'} strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}
