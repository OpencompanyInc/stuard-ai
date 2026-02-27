'use client';

import React, { useState, useEffect } from 'react';
import { listFiles, readFile, writeFile, deleteFile, renameFile, createDirectory } from '@/lib/cloudApi';

interface CloudFileBrowserProps {
  engine: any;
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
}

export function CloudFileBrowser({ engine }: CloudFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('.');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>(['.']);

  const loadDirectory = async (path: string) => {
    setLoading(true);
    try {
      const data = await listFiles(path);
      if (data.ok) {
        setEntries(data.entries || []);
        setCurrentPath(path);
        setBreadcrumbs(path === '.' ? ['.'] : ['.', ...path.split('/').filter(Boolean)]);
      }
    } catch (e) {
      console.error('Failed to list files:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleFileClick = async (entry: FileEntry) => {
    if (entry.type === 'directory') {
      loadDirectory(entry.path);
      setSelectedFile(null);
      setFileContent(null);
    } else {
      setSelectedFile(entry.path);
      if (entry.size < 1024 * 1024) { // Only preview files < 1MB
        const data = await readFile(entry.path);
        if (data.ok) {
          setFileContent(data.content);
        }
      }
    }
  };

  const navigateBreadcrumb = (index: number) => {
    if (index === 0) {
      loadDirectory('.');
    } else {
      const path = breadcrumbs.slice(1, index + 1).join('/');
      loadDirectory(path);
    }
    setSelectedFile(null);
    setFileContent(null);
  };

  const handleDelete = async (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    await deleteFile(path);
    loadDirectory(currentPath);
  };

  const handleCreateDir = async () => {
    const name = prompt('Directory name:');
    if (!name) return;
    const path = currentPath === '.' ? name : `${currentPath}/${name}`;
    await createDirectory(path);
    loadDirectory(currentPath);
  };

  useEffect(() => {
    if (engine.status === 'running') loadDirectory('.');
  }, [engine.status]);

  if (engine.status !== 'running') {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-2xl border border-gray-200">
        <p className="text-gray-500">Start your engine to browse files.</p>
      </div>
    );
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-sm">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-gray-400">/</span>}
            <button
              onClick={() => navigateBreadcrumb(i)}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              {crumb === '.' ? '~' : crumb}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex gap-2">
        <button
          onClick={handleCreateDir}
          className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-all"
        >
          New Folder
        </button>
        <button
          onClick={() => loadDirectory(currentPath)}
          className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-all"
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-4">
        {/* File List */}
        <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Empty directory</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Name</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Size</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Modified</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr
                    key={entry.path}
                    onClick={() => handleFileClick(entry)}
                    className={`border-b border-gray-50 cursor-pointer hover:bg-blue-50 transition-colors ${
                      selectedFile === entry.path ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <span className="mr-2">{entry.type === 'directory' ? '📁' : '📄'}</span>
                      <span className="font-medium text-gray-900">{entry.name}</span>
                    </td>
                    <td className="text-right px-4 py-2.5 text-gray-500">
                      {entry.type === 'file' ? formatSize(entry.size) : '—'}
                    </td>
                    <td className="text-right px-4 py-2.5 text-gray-500">
                      {new Date(entry.modified).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(entry.path); }}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* File Preview */}
        {fileContent !== null && (
          <div className="w-96 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 font-medium">
              {selectedFile}
            </div>
            <pre className="p-4 text-xs font-mono text-gray-800 overflow-auto max-h-[500px] whitespace-pre-wrap">
              {fileContent}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
