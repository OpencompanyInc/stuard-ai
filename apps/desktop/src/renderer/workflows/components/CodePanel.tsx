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
    <div className="flex flex-col h-full wf-bg wf-fg">
      {/* VS Code Title Bar */}
      <div className="flex items-center justify-between shrink-0 border-b wf-border-subtle wf-bg-overlay px-2" style={{ height: 35 }}>
        <div className="flex items-center gap-1 min-w-0">
          {/* File tabs like VS Code */}
          <button
            onClick={() => handleModeChange('json')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[12px] shrink-0 transition-colors ${mode === 'json' ? 'wf-fg wf-bg-elevated border-t-2 border-indigo-500' : 'wf-fg-faint hover:wf-fg hover:wf-bg-sunken border-t-2 border-transparent'}`}
          >
            <Braces className="w-3.5 h-3.5 text-yellow-500" />
            <span>workflow.json</span>
          </button>
          <button
            onClick={() => handleModeChange('debug')}
            className={`flex items-center gap-1.5 px-3 py-1 text-[12px] shrink-0 transition-colors ${mode === 'debug' ? 'wf-fg wf-bg-elevated border-t-2 border-indigo-500' : 'wf-fg-faint hover:wf-fg hover:wf-bg-sunken border-t-2 border-transparent'}`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${errCount > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
            <span>problems</span>
            {errCount > 0 && (
              <span className="px-1 py-px text-[9px] font-bold rounded-sm bg-red-500 text-white">{errCount}</span>
            )}
          </button>
        </div>
        <button onClick={onClose} className="p-1 rounded-sm wf-fg-faint hover:wf-fg hover:wf-bg-sunken transition-colors" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* VS Code Breadcrumb Bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 shrink-0 border-b wf-border-subtle wf-bg-sunken">
        <span className="text-[11px] font-medium wf-fg-muted">{model.name || 'workflow'}</span>
        <ChevronRight className="w-3 h-3 wf-fg-faint" />
        <span className="text-[11px] wf-fg">{mode === 'json' ? 'source' : 'diagnostics'}</span>
        {editing && (
          <>
            <span className="text-[10px] font-bold ml-2 px-1.5 py-0.5 rounded-sm bg-indigo-500/20 text-indigo-500">EDITING</span>
          </>
        )}
        {!editing && mode === 'json' && (
          <button onClick={startEdit} className="ml-auto flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-sm wf-fg-muted hover:wf-fg hover:wf-bg-overlay transition-colors">
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
      </div>

      {/* Parse error banner */}
      {parseError && (
        <div className="px-3 py-1.5 flex items-center gap-2 bg-red-500/10 border-b border-red-500/20">
          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 bg-red-500 text-white font-bold">!</span>
          <span className="text-[12px] truncate text-red-500">{parseError}</span>
        </div>
      )}
      
      {/* Problems panel (when in debug mode or expanded) */}
      {mode === 'debug' && errors.length > 0 && (
        <div className="max-h-40 overflow-auto wf-bg-sunken border-b wf-border-subtle custom-scrollbar">
          {errors.map((e, i) => (
            <div key={i} className={`flex items-center gap-2 px-4 py-1.5 hover:wf-bg-overlay text-[12px] cursor-default ${e.type === 'error' ? 'text-red-500' : 'text-amber-500'}`}>
              {e.type === 'error' ? <X className="w-3 h-3 shrink-0" /> : <AlertTriangle className="w-3 h-3 shrink-0" />}
              <span className="wf-fg-muted">{e.message}</span>
              {e.nodeId && <span className="ml-auto text-[10px] wf-fg-faint">[{e.nodeId}]</span>}
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
        <div className="flex items-center gap-2 px-3 py-2 shrink-0 wf-bg-overlay border-t wf-border-subtle">
          <button onClick={cancelEdit} className="flex-1 py-1.5 text-[12px] font-medium rounded-md transition-colors wf-surface-muted hover:wf-bg-sunken wf-fg">
            Cancel
          </button>
          <button onClick={applyEdit} className="flex-1 py-1.5 text-[12px] font-medium rounded-md transition-colors wf-primary-btn">
            Apply Changes
          </button>
        </div>
      )}
    </div>
  );
}
