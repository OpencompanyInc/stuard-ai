/**
 * DriveQueryEditor - Google Drive query builder
 */
import React, { useState, useEffect, useCallback } from 'react';

interface DriveQueryEditorProps {
  value: string;
  onChange: (v: string) => void;
}

export function DriveQueryEditor({ value, onChange }: DriveQueryEditorProps) {
  const [mode, setMode] = useState<'visual' | 'raw'>(value && !value.includes(':') ? 'raw' : 'visual');
  const [nameContains, setNameContains] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [parentFolder, setParentFolder] = useState('');
  const [trashed, setTrashed] = useState<'any' | 'true' | 'false'>('false');

  // Parse existing query on mount
  useEffect(() => {
    if (!value) return;
    const parts = value.split(' and ');
    for (const part of parts) {
      const nameMatch = part.match(/name contains '([^']+)'/);
      if (nameMatch) setNameContains(nameMatch[1]);
      const mimeMatch = part.match(/mimeType\s*=\s*'([^']+)'/);
      if (mimeMatch) setMimeType(mimeMatch[1]);
      const parentMatch = part.match(/'([^']+)' in parents/);
      if (parentMatch) setParentFolder(parentMatch[1]);
      const trashedMatch = part.match(/trashed\s*=\s*(true|false)/);
      if (trashedMatch) setTrashed(trashedMatch[1] as 'true' | 'false');
    }
  }, []);

  // Build query from visual inputs
  const buildQuery = useCallback(() => {
    const parts: string[] = [];
    if (nameContains.trim()) parts.push(`name contains '${nameContains.trim()}'`);
    if (mimeType) parts.push(`mimeType = '${mimeType}'`);
    if (parentFolder.trim()) parts.push(`'${parentFolder.trim()}' in parents`);
    if (trashed !== 'any') parts.push(`trashed = ${trashed}`);
    return parts.join(' and ');
  }, [nameContains, mimeType, parentFolder, trashed]);

  // Update parent on visual changes
  useEffect(() => {
    if (mode === 'visual') {
      onChange(buildQuery());
    }
  }, [nameContains, mimeType, parentFolder, trashed, mode, buildQuery, onChange]);

  const mimeOptions = [
    { value: '', label: 'Any type' },
    { value: 'application/vnd.google-apps.folder', label: 'Folders' },
    { value: 'application/vnd.google-apps.document', label: 'Google Docs' },
    { value: 'application/vnd.google-apps.spreadsheet', label: 'Google Sheets' },
    { value: 'application/vnd.google-apps.presentation', label: 'Google Slides' },
    { value: 'application/pdf', label: 'PDF files' },
    { value: 'image/', label: 'Images' },
    { value: 'video/', label: 'Videos' },
    { value: 'audio/', label: 'Audio' },
  ];

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-lg w-fit">
        <button
          onClick={() => setMode('visual')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'visual' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Visual Builder
        </button>
        <button
          onClick={() => setMode('raw')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'raw' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Raw Query
        </button>
      </div>

      {mode === 'visual' ? (
        <div className="space-y-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
          {/* Name Contains */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">File name contains</label>
            <input
              type="text"
              value={nameContains}
              onChange={e => setNameContains(e.target.value)}
              placeholder="e.g. report, invoice"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 bg-white"
            />
          </div>

          {/* File Type */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">File type</label>
            <select
              value={mimeType}
              onChange={e => setMimeType(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 bg-white"
            >
              {mimeOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Parent Folder ID */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">In folder ID (optional)</label>
            <input
              type="text"
              value={parentFolder}
              onChange={e => setParentFolder(e.target.value)}
              placeholder="e.g. 1BxiM..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 bg-white font-mono text-xs"
            />
          </div>

          {/* Trashed */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Include trashed</label>
            <div className="flex gap-2">
              {(['false', 'true', 'any'] as const).map(opt => (
                <button
                  key={opt}
                  onClick={() => setTrashed(opt)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${trashed === opt
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  {opt === 'false' ? 'No' : opt === 'true' ? 'Yes' : 'Both'}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {buildQuery() && (
            <div className="pt-2 border-t border-slate-200">
              <label className="text-xs font-medium text-slate-500">Generated query:</label>
              <code className="block mt-1 p-2 bg-white rounded-lg border border-slate-200 text-xs font-mono text-slate-600 break-all">
                {buildQuery()}
              </code>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="e.g. name contains 'report' and mimeType = 'application/pdf'"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 font-mono resize-none"
          />
          <div className="text-xs text-slate-400">
            Use <a href="https://developers.google.com/drive/api/guides/search-files" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Google Drive query syntax</a>
          </div>
        </div>
      )}
    </div>
  );
}
