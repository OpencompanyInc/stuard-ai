/**
 * FilesEditor - File attachment picker for email and other tools
 * Allows selecting multiple local files with path and optional filename override
 */
import React, { useState } from 'react';
import { Plus, X, File, FolderOpen, Paperclip } from 'lucide-react';

export interface FileAttachment {
  path: string;
  filename?: string;
}

interface FilesEditorProps {
  value: FileAttachment[];
  onChange: (value: FileAttachment[]) => void;
}

export function FilesEditor({ value, onChange }: FilesEditorProps) {
  const files = Array.isArray(value) ? value : [];
  const [editingFilename, setEditingFilename] = useState<number | null>(null);

  const handleAddFiles = async () => {
    try {
      const api = (window as any).desktopAPI;
      if (!api?.pickFiles) {
        console.error('pickFiles not available');
        return;
      }

      const result = await api.pickFiles({
        title: 'Select Files to Attach',
        multiple: true,
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
          { name: 'Archives', extensions: ['zip', 'rar', '7z', 'tar', 'gz'] },
        ],
      });

      if (result?.ok && result.files?.length > 0) {
        const newFiles: FileAttachment[] = result.files.map((f: any) => ({
          path: typeof f === 'string' ? f : f.path,
        }));
        onChange([...files, ...newFiles]);
      }
    } catch (e) {
      console.error('Failed to pick files:', e);
    }
  };

  const handleRemove = (index: number) => {
    const updated = files.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleUpdateFilename = (index: number, filename: string) => {
    const updated = files.map((f, i) => 
      i === index ? { ...f, filename: filename || undefined } : f
    );
    onChange(updated);
    setEditingFilename(null);
  };

  const getDisplayName = (file: FileAttachment) => {
    if (file.filename) return file.filename;
    const parts = file.path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'unnamed';
  };

  const getFileExtension = (file: FileAttachment) => {
    const name = getDisplayName(file);
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return ext;
  };

  const getFileIcon = (ext: string) => {
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'];
    const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf'];
    const spreadsheetExts = ['xls', 'xlsx', 'csv'];
    const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz'];
    
    if (imageExts.includes(ext)) return '🖼️';
    if (docExts.includes(ext)) return '📄';
    if (spreadsheetExts.includes(ext)) return '📊';
    if (archiveExts.includes(ext)) return '📦';
    return '📎';
  };

  return (
    <div className="space-y-2">
      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((file, index) => {
            const ext = getFileExtension(file);
            const displayName = getDisplayName(file);
            const isEditing = editingFilename === index;

            return (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-2 bg-white/[0.06] border border-white/[0.08] rounded-lg group hover:bg-white/[0.1] transition-colors"
              >
                <span className="text-lg shrink-0">{getFileIcon(ext)}</span>
                
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      type="text"
                      autoFocus
                      defaultValue={file.filename || ''}
                      placeholder={displayName}
                      className="w-full px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      onBlur={(e) => handleUpdateFilename(index, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateFilename(index, e.currentTarget.value);
                        } else if (e.key === 'Escape') {
                          setEditingFilename(null);
                        }
                      }}
                    />
                  ) : (
                    <div
                      className="cursor-pointer"
                      onClick={() => setEditingFilename(index)}
                      title="Click to rename attachment"
                    >
                      <p className="text-sm font-medium text-white/80 truncate">
                        {displayName}
                      </p>
                      <p className="text-[10px] text-white/40 truncate">
                        {file.path}
                      </p>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="p-1 text-white/40 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove attachment"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Files Button */}
      <button
        type="button"
        onClick={handleAddFiles}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-white/[0.12] rounded-xl text-white/50 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all group"
      >
        <Paperclip className="w-4 h-4 group-hover:scale-110 transition-transform" />
        <span className="text-sm font-medium">
          {files.length > 0 ? 'Add More Files' : 'Attach Files'}
        </span>
      </button>

      {/* Help Text */}
      {files.length > 0 && (
        <p className="text-[10px] text-white/40 text-center">
          {files.length} file{files.length !== 1 ? 's' : ''} attached • Click filename to rename
        </p>
      )}
    </div>
  );
}

