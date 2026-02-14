/**
 * WorkspaceFileEditor - Code editor for workspace files (.py, .txt, .js, etc.)
 * Uses RichCodeEditor under the hood with auto-save and language detection.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Save, RotateCw, FileText, Code2, Braces } from "lucide-react";
import { RichCodeEditor } from "./RichCodeEditor";

interface WorkspaceFileEditorProps {
  flowId: string;
  filePath: string;
  fileName: string;
}

function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'py': return 'python';
    case 'js': case 'mjs': case 'cjs': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'json': case 'stuard': return 'json';
    case 'html': case 'htm': return 'html';
    case 'css': return 'css';
    case 'md': return 'markdown';
    case 'sh': case 'bash': return 'shell';
    case 'ps1': return 'powershell';
    case 'yaml': case 'yml': return 'yaml';
    case 'xml': return 'xml';
    case 'csv': return 'csv';
    case 'sql': return 'sql';
    default: return 'text';
  }
}

function langIcon(lang: string) {
  switch (lang) {
    case 'python': return <Code2 className="w-3.5 h-3.5 text-yellow-500" />;
    case 'javascript': case 'typescript': return <Code2 className="w-3.5 h-3.5 text-blue-400" />;
    case 'json': return <Braces className="w-3.5 h-3.5 text-emerald-500" />;
    default: return <FileText className="w-3.5 h-3.5 text-slate-400" />;
  }
}

export function WorkspaceFileEditor({ flowId, filePath, fileName }: WorkspaceFileEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = content !== originalContent;
  const language = detectLanguage(fileName);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load file content
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await (window as any).desktopAPI?.workflowsReadWorkspaceFile?.(flowId, filePath);
        if (cancelled) return;
        if (res?.ok) {
          setContent(res.content || '');
          setOriginalContent(res.content || '');
        } else {
          setError(res?.error || 'Failed to load file');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [flowId, filePath]);

  // Save file
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await (window as any).desktopAPI?.workflowsWriteWorkspaceFile?.(flowId, filePath, content);
      if (res?.ok) {
        setOriginalContent(content);
      } else {
        setError(res?.error || 'Save failed');
      }
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    }
    setSaving(false);
  }, [flowId, filePath, content]);

  // Auto-save after 2s of inactivity
  useEffect(() => {
    if (!dirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { save(); }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [content, dirty, save]);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dirty, save]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="w-6 h-6 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error && !content) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center px-6">
          <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-red-500 font-medium">{error}</p>
          <button onClick={() => { setError(null); setLoading(true); }} className="mt-3 text-xs text-indigo-600 hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: '#1e1e1e' }}>
      {/* VS Code-style tab/status bar */}
      <div className="flex items-center justify-between shrink-0 px-2" style={{ height: 35, background: '#252526', borderBottom: '1px solid #3c3c3c' }}>
        <div className="flex items-center gap-2">
          {langIcon(language)}
          <span className="text-[12px] font-medium" style={{ color: '#cccccc' }}>{fileName}</span>
          {dirty && <span className="w-2 h-2 rounded-full bg-white/60 shrink-0" title="Modified" />}
          <span className="text-[11px]" style={{ color: '#858585' }}>{language}</span>
        </div>
        <div className="flex items-center gap-1">
          {saving && <span className="text-[10px]" style={{ color: '#858585' }}>Saving...</span>}
          {error && <span className="text-[10px] max-w-[150px] truncate" style={{ color: '#f48771' }}>{error}</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="p-1 rounded-sm transition-colors hover:bg-[#ffffff15] disabled:opacity-30"
            style={{ color: dirty ? '#cccccc' : '#585858' }}
            title="Save (Ctrl+S)"
          >
            <Save className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { setContent(originalContent); }}
            disabled={!dirty}
            className="p-1 rounded-sm transition-colors hover:bg-[#ffffff15] disabled:opacity-30"
            style={{ color: dirty ? '#cccccc' : '#585858' }}
            title="Revert changes"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <RichCodeEditor
          value={content}
          onChange={setContent}
          language={language}
          minHeight={400}
        />
      </div>
    </div>
  );
}
