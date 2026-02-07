/**
 * CodePanel - Code view panel with JSON and debug modes
 */
import React, { useState, useMemo, useEffect } from "react";
import { X, Check, Copy, Code } from "lucide-react";
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
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [parseError, setParseError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  
  const errCount = errors.filter(e => e.type === 'error').length;
  const warnCount = errors.filter(e => e.type === 'warning').length;
  
  // Generate code for current mode
  const code = useMemo(() => {
    if (mode === 'debug') return generateDebugView(model, errors);
    return JSON.stringify(model, null, 2);
  }, [model, mode, errors]);
  
  // Update edit text when mode changes or model updates externally while not editing
  useEffect(() => {
    if (!editing) {
      setEditText(code);
    }
  }, [code, editing]);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const startEdit = () => {
    setEditText(code);
    setEditing(true);
    setParseError('');
  };
  
  const cancelEdit = () => {
    setEditing(false);
    setParseError('');
    setEditText(code);
  };
  
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

  const handleModeChange = (newMode: CodeMode) => {
    setMode(newMode);
    setEditing(false);
    setParseError('');
  };
  
  return (
    <div className="flex flex-col h-full bg-[#1e1e2e]">
      <div className="h-12 px-4 border-b border-slate-700 flex items-center justify-between shrink-0 bg-[#252538]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Code className="w-4 h-4 text-indigo-400" />
          <span>Code Editor</span>
        </div>
        <div className="flex items-center gap-1">
          {!editing && mode !== 'debug' && (
            <>
              <button onClick={startEdit} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 text-xs transition-colors" title="Edit">✏️ Edit</button>
              <button onClick={copy} className="p-1.5 hover:bg-slate-700 rounded text-slate-400 transition-colors" title="Copy">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </>
          )}
          <button onClick={onClose} className="p-1 hover:bg-slate-700 rounded text-slate-400 transition-colors"><X className="w-4 h-4" /></button>
        </div>
      </div>
      
      {/* Mode tabs */}
      <div className="flex border-b border-slate-700 bg-[#1e1e2e]">
        <button onClick={() => handleModeChange('json')} className={`flex-1 py-2 text-[11px] font-medium transition-colors ${mode === 'json' ? 'text-emerald-400 border-b-2 border-emerald-500 bg-emerald-500/10' : 'text-slate-500 hover:text-slate-300'}`}>
          JSON
        </button>
        <button onClick={() => handleModeChange('debug')} className={`flex-1 py-2 text-[11px] font-medium transition-colors ${mode === 'debug' ? 'text-orange-400 border-b-2 border-orange-500 bg-orange-500/10' : 'text-slate-500 hover:text-slate-300'}`}>
          Debug {errCount > 0 && <span className="ml-1 px-1 bg-red-500 text-white rounded text-[9px]">{errCount}</span>}
        </button>
      </div>
      
      {/* Errors summary (clickable) */}
      {errors.length > 0 && mode !== 'debug' && !editing && (
        <button onClick={() => setShowErrors(!showErrors)} className="w-full px-3 py-1.5 bg-amber-900/30 border-b border-amber-900/50 text-[10px] text-amber-200 text-left hover:bg-amber-900/50 flex justify-between items-center transition-colors">
          <span>{errCount} error{errCount !== 1 ? 's' : ''}, {warnCount} warning{warnCount !== 1 ? 's' : ''}</span>
          <span>{showErrors ? '▲' : '▼'}</span>
        </button>
      )}
      
      {/* Expanded error list */}
      {showErrors && errors.length > 0 && mode !== 'debug' && (
        <div className="max-h-32 overflow-auto bg-amber-900/20 border-b border-amber-900/50 scrollbar-minimal">
          {errors.map((e, i) => (
            <div key={i} className={`px-3 py-1 text-[10px] border-b border-amber-900/30 ${e.type === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
              <span className="font-medium">{e.type === 'error' ? '❌' : '⚠️'}</span> {e.nodeId && <span className="text-slate-400">[{e.nodeId}]</span>} {e.message}
            </div>
          ))}
        </div>
      )}
      
      {/* Parse error */}
      {parseError && (
        <div className="px-3 py-2 bg-red-900/30 border-b border-red-900/50 text-xs text-red-300">❌ {parseError}</div>
      )}
      
      {/* Code view / editor */}
      <div className="flex-1 overflow-hidden flex flex-col p-2">
        <RichCodeEditor
          value={editing ? editText : code}
          onChange={setEditText}
          readOnly={!editing}
          language={mode === 'json' ? 'json' : 'text'}
          className="flex-1"
        />
        
        {editing && (
          <div className="flex gap-2 pt-2">
            <button onClick={cancelEdit} className="flex-1 py-2 text-xs text-slate-400 hover:text-white bg-slate-800 rounded-lg transition-colors border border-slate-700">Cancel</button>
            <button onClick={applyEdit} className="flex-1 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-900/20">Apply Changes</button>
          </div>
        )}
      </div>
      
      {/* Stats footer */}
      <div className="px-3 py-1.5 bg-[#252538] border-t border-slate-700 text-[10px] text-slate-500 flex justify-between">
        <span>{model.nodes?.length || 0} steps • {model.triggers?.length || 0} triggers • {model.wires?.length || 0} wires</span>
        <span>{mode === 'json' ? `${code.length} chars` : `${code.split('\n').length} lines`}</span>
      </div>
    </div>
  );
}
