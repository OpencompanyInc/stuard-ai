/**
 * CodePanel - VS Code-style code view panel
 */
import React, { useState, useMemo, useEffect } from "react";
import { X, Check, Copy, Code, Braces, AlertTriangle, ChevronRight, Pencil } from "lucide-react";
import { generateDebugView } from "../utils/debugView";
import { RichCodeEditor } from "./RichCodeEditor";
import type { DesignerModel } from "../types";
import type { ValidationError } from "../builder/compiler";
import { specToDesignerModel } from "../utils/conversions";

interface CodePanelProps {
  model: DesignerModel;
  errors: ValidationError[];
  onClose: () => void;
  onUpdateModel: (m: DesignerModel) => void;
}

export function CodePanel({ model, errors, onClose, onUpdateModel }: CodePanelProps) {
  type CodeMode = 'json' | 'debug';
  const [mode, setMode] = useState<CodeMode>('json');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [parseError, setParseError] = useState('');
  const [showProblems, setShowProblems] = useState(false);
  
  const errCount = errors.filter(e => e.type === 'error').length;
  const warnCount = errors.filter(e => e.type === 'warning').length;
  
  const code = useMemo(() => {
    if (mode === 'debug') return generateDebugView(model, errors);
    return JSON.stringify(model, null, 2);
  }, [model, mode, errors]);
  
  useEffect(() => {
    if (!editing) setEditText(code);
  }, [code, editing]);

  const startEdit = () => { setEditText(code); setEditing(true); setParseError(''); };
  const cancelEdit = () => { setEditing(false); setParseError(''); setEditText(code); };
  
  const applyEdit = () => {
    try {
      const parsed = JSON.parse(editText);
      const newModel: DesignerModel = specToDesignerModel(parsed);
      onUpdateModel(newModel);
      setEditing(false);
      setParseError('');
    } catch (e: any) {
      setParseError(e?.message || 'Parse error');
    }
  };

  const handleModeChange = (newMode: CodeMode) => { setMode(newMode); setEditing(false); setParseError(''); };
  
  return (
    <div className="flex flex-col h-full" style={{ background: '#1e1e1e' }}>
      {/* VS Code Title Bar */}
      <div className="flex items-center justify-between shrink-0 px-2" style={{ height: 35, background: '#252526', borderBottom: '1px solid #3c3c3c' }}>
        <div className="flex items-center gap-1 min-w-0">
          {/* File tabs like VS Code */}
          <button
            onClick={() => handleModeChange('json')}
            className="flex items-center gap-1.5 px-3 py-1 text-[12px] shrink-0 transition-colors"
            style={{
              background: mode === 'json' ? '#1e1e1e' : 'transparent',
              color: mode === 'json' ? '#ffffff' : '#969696',
              borderTop: mode === 'json' ? '1px solid #007acc' : '1px solid transparent',
              borderBottom: mode === 'json' ? 'none' : undefined,
            }}
          >
            <Braces className="w-3.5 h-3.5" style={{ color: '#e8ab53' }} />
            <span>workflow.json</span>
          </button>
          <button
            onClick={() => handleModeChange('debug')}
            className="flex items-center gap-1.5 px-3 py-1 text-[12px] shrink-0 transition-colors"
            style={{
              background: mode === 'debug' ? '#1e1e1e' : 'transparent',
              color: mode === 'debug' ? '#ffffff' : '#969696',
              borderTop: mode === 'debug' ? '1px solid #007acc' : '1px solid transparent',
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: errCount > 0 ? '#f14c4c' : '#6a9955' }} />
            <span>problems</span>
            {errCount > 0 && (
              <span className="px-1 py-px text-[9px] font-bold rounded-sm" style={{ background: '#f14c4c', color: '#ffffff' }}>{errCount}</span>
            )}
          </button>
        </div>
        <button onClick={onClose} className="p-1 rounded-sm hover:bg-[#ffffff15] transition-colors" style={{ color: '#969696' }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* VS Code Breadcrumb Bar */}
      <div className="flex items-center gap-1 px-3 shrink-0" style={{ height: 22, background: '#1e1e1e', borderBottom: '1px solid #2d2d2d' }}>
        <span className="text-[11px]" style={{ color: '#969696' }}>{model.name || 'workflow'}</span>
        <ChevronRight className="w-3 h-3" style={{ color: '#4d4d4d' }} />
        <span className="text-[11px]" style={{ color: '#cccccc' }}>{mode === 'json' ? 'source' : 'diagnostics'}</span>
        {editing && (
          <>
            <span className="text-[11px] ml-2 px-1.5 rounded-sm" style={{ background: '#007acc33', color: '#007acc' }}>EDITING</span>
          </>
        )}
        {!editing && mode === 'json' && (
          <button onClick={startEdit} className="ml-auto flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-sm hover:bg-[#ffffff10] transition-colors" style={{ color: '#969696' }}>
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
      </div>

      {/* Parse error banner */}
      {parseError && (
        <div className="px-3 py-1.5 flex items-center gap-2" style={{ background: '#5a1d1d', borderBottom: '1px solid #6e2a2a' }}>
          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0" style={{ background: '#f14c4c', color: '#1e1e1e', fontWeight: 700 }}>!</span>
          <span className="text-[12px] truncate" style={{ color: '#f48771' }}>{parseError}</span>
        </div>
      )}
      
      {/* Problems panel (when in debug mode or expanded) */}
      {mode === 'debug' && errors.length > 0 && (
        <div className="max-h-40 overflow-auto" style={{ background: '#1e1e1e', borderBottom: '1px solid #3c3c3c' }}>
          {errors.map((e, i) => (
            <div key={i} className="flex items-center gap-2 px-4 py-1 hover:bg-[#2a2d2e] text-[12px] cursor-default" style={{ color: e.type === 'error' ? '#f14c4c' : '#cca700' }}>
              {e.type === 'error' ? <X className="w-3 h-3 shrink-0" /> : <AlertTriangle className="w-3 h-3 shrink-0" />}
              <span style={{ color: '#d4d4d4' }}>{e.message}</span>
              {e.nodeId && <span className="ml-auto text-[10px]" style={{ color: '#858585' }}>[{e.nodeId}]</span>}
            </div>
          ))}
        </div>
      )}
      
      {/* Code editor */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <RichCodeEditor
          value={editing ? editText : code}
          onChange={setEditText}
          readOnly={!editing}
          language={mode === 'json' ? 'json' : 'text'}
          className="flex-1"
        />
      </div>

      {/* Edit action bar */}
      {editing && (
        <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: '#252526', borderTop: '1px solid #3c3c3c' }}>
          <button onClick={cancelEdit} className="flex-1 py-1.5 text-[12px] font-medium rounded-sm transition-colors hover:bg-[#ffffff10]" style={{ color: '#cccccc', border: '1px solid #3c3c3c' }}>
            Cancel
          </button>
          <button onClick={applyEdit} className="flex-1 py-1.5 text-[12px] font-medium rounded-sm transition-colors hover:opacity-90" style={{ background: '#007acc', color: '#ffffff' }}>
            Apply Changes
          </button>
        </div>
      )}
    </div>
  );
}
