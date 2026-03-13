/**
 * JsonEditor - User-friendly key-value editor with optional raw JSON mode
 * Supports variable insertion for workflow data binding
 */
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Code2, LayoutList, Check, X, ChevronDown, Variable } from 'lucide-react';
import type { WorkflowVariable } from '../../../types';
import { getToolOutputs } from '../../../constants/tool-schemas';

export interface UpstreamNode {
  id: string;
  label: string;
  tool?: string;
}

interface JsonEditorProps {
  value: any;
  onChange: (v: any) => void;
  label?: string;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}

type ValueType = 'text' | 'number' | 'boolean' | 'json';

interface KeyValuePair {
  key: string;
  value: any;
  type: ValueType;
}

function detectType(value: any): ValueType {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'text';
}

function parseValue(value: string, type: ValueType): any {
  switch (type) {
    case 'number': return value === '' ? 0 : Number(value);
    case 'boolean': return value === 'true';
    case 'json': try { return JSON.parse(value); } catch { return value; }
    default: return value;
  }
}

function stringifyValue(value: any, type: ValueType): string {
  if (type === 'json' && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value ?? '');
}

export function JsonEditor({ value, onChange, label, upstreamNodes, workflowVariables }: JsonEditorProps) {
  const [mode, setMode] = useState<'visual' | 'code'>('visual');
  const [pairs, setPairs] = useState<KeyValuePair[]>([]);
  const [codeText, setCodeText] = useState('{}');
  const [codeError, setCodeError] = useState('');
  const [activeVarPicker, setActiveVarPicker] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build variable suggestions
  const buildSuggestions = () => {
    const results: Array<{ text: string; label: string; description?: string }> = [];

    // Add workflow variables
    if (workflowVariables?.length) {
      for (const v of workflowVariables) {
        results.push({
          text: `{{workflow.${v.name}}}`,
          label: `workflow.${v.name}`,
          description: v.description || `${v.type} variable`,
        });
      }
    }

    // Add upstream node outputs (use trigger.data.X for triggers)
    if (upstreamNodes?.length) {
      for (const node of upstreamNodes) {
        const prefix = (node as any).isTrigger ? 'trigger.data' : node.id;
        const baseSuggestion = (node as any).isTrigger ? '{{trigger.data}}' : `{{${node.id}}}`;
        results.push({
          text: baseSuggestion,
          label: prefix,
          description: (node as any).isTrigger ? 'Trigger data' : node.label,
        });

        const toolOutputs = node.tool ? getToolOutputs(node.tool) : ['ok', 'result'];
        for (const field of toolOutputs) {
          const fullPath = (node as any).isTrigger ? `trigger.data.${field}` : `${node.id}.${field}`;
          results.push({
            text: `{{${fullPath}}}`,
            label: fullPath,
            description: `${node.label} → ${field}`,
          });
        }
      }
    }

    return results.slice(0, 15);
  };

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveVarPicker(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Convert object to pairs
  useEffect(() => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const newPairs = Object.entries(value).map(([key, val]) => ({
        key,
        value: val,
        type: detectType(val)
      }));
      setPairs(newPairs);
      try { setCodeText(JSON.stringify(value, null, 2)); } catch {}
    } else if (Array.isArray(value)) {
      setMode('code');
      try { setCodeText(JSON.stringify(value, null, 2)); } catch {}
    }
  }, []);

  // Sync pairs back to value
  const syncPairsToValue = (newPairs: KeyValuePair[]) => {
    const obj: Record<string, any> = {};
    newPairs.forEach(p => {
      if (p.key.trim()) obj[p.key.trim()] = p.value;
    });
    onChange(obj);
    try { setCodeText(JSON.stringify(obj, null, 2)); } catch {}
  };

  const addPair = () => {
    const newPairs = [...pairs, { key: '', value: '', type: 'text' as ValueType }];
    setPairs(newPairs);
  };

  const removePair = (index: number) => {
    const newPairs = pairs.filter((_, i) => i !== index);
    setPairs(newPairs);
    syncPairsToValue(newPairs);
  };

  const updatePair = (index: number, field: 'key' | 'value' | 'type', newVal: any) => {
    const newPairs = [...pairs];
    if (field === 'type') {
      newPairs[index] = { ...newPairs[index], type: newVal, value: parseValue(stringifyValue(newPairs[index].value, newPairs[index].type), newVal) };
    } else if (field === 'value') {
      newPairs[index] = { ...newPairs[index], value: parseValue(newVal, newPairs[index].type) };
    } else {
      newPairs[index] = { ...newPairs[index], [field]: newVal };
    }
    setPairs(newPairs);
    syncPairsToValue(newPairs);
  };

  const handleCodeChange = (newText: string) => {
    setCodeText(newText);
    try {
      const parsed = JSON.parse(newText);
      onChange(parsed);
      setCodeError('');
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        const newPairs = Object.entries(parsed).map(([key, val]) => ({
          key, value: val, type: detectType(val)
        }));
        setPairs(newPairs);
      }
    } catch (e: any) {
      setCodeError(e.message);
    }
  };

  const typeOptions = [
    { value: 'text', label: 'Text', icon: 'Aa' },
    { value: 'number', label: 'Number', icon: '#' },
    { value: 'boolean', label: 'Yes/No', icon: '◐' },
    { value: 'json', label: 'Object', icon: '{}' },
  ];

  return (
    <div ref={containerRef} className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex items-center gap-1 p-1 wf-bg-overlay rounded-xl w-fit">
        <button
          onClick={() => setMode('visual')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            mode === 'visual' 
              ? 'wf-bg-overlay wf-fg shadow-sm' 
              : 'wf-fg-muted hover:wf-fg'
          }`}
        >
          <LayoutList className="w-3.5 h-3.5" />
          Simple
        </button>
        <button
          onClick={() => setMode('code')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            mode === 'code' 
              ? 'wf-bg-overlay wf-fg shadow-sm' 
              : 'wf-fg-muted hover:wf-fg'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          Code
        </button>
      </div>

      {mode === 'visual' ? (
        <div className="space-y-2">
          {pairs.length === 0 ? (
            <div className="text-center py-6 wf-bg-overlay rounded-xl border border-dashed wf-border-subtle">
              <p className="text-sm wf-fg-muted mb-3">No data yet</p>
              <button
                onClick={addPair}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-indigo-400 bg-indigo-500/10 rounded-lg hover:bg-indigo-500/200/20 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Field
              </button>
            </div>
          ) : (
            <>
              {pairs.map((pair, i) => (
                <div key={i} className="flex items-center gap-2 p-2 wf-bg-overlay rounded-xl border wf-border-subtle group">
                  {/* Key Input */}
                  <input
                    type="text"
                    value={pair.key}
                    onChange={e => updatePair(i, 'key', e.target.value)}
                    placeholder="name"
                    className="w-28 px-3 py-2 text-sm wf-input wf-fg border wf-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 font-medium"
                  />
                  
                  {/* Type Selector */}
                  <div className="relative">
                    <select
                      value={pair.type}
                      onChange={e => updatePair(i, 'type', e.target.value)}
                      className="appearance-none w-24 px-2 py-2 pr-7 text-xs wf-input wf-fg border wf-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 cursor-pointer"
                    >
                      {typeOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.icon} {opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 wf-fg-faint pointer-events-none" />
                  </div>

                  {/* Value Input */}
                  <div className="flex-1 relative">
                    {pair.type === 'boolean' ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => updatePair(i, 'value', 'true')}
                          className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-all ${
                            pair.value === true 
                              ? 'bg-emerald-500/100 text-white' 
                              : 'wf-bg-overlay border wf-border-subtle wf-fg-muted hover:bg-emerald-500/10'
                          }`}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => updatePair(i, 'value', 'false')}
                          className={`flex-1 py-2 px-3 text-xs font-medium rounded-lg transition-all ${
                            pair.value === false 
                              ? 'wf-bg-elevated border wf-border-subtle wf-fg' 
                              : 'wf-bg-overlay border wf-border-subtle wf-fg-muted wf-hover-bg'
                          }`}
                        >
                          No
                        </button>
                      </div>
                    ) : pair.type === 'number' ? (
                      <input
                        type="number"
                        value={pair.value ?? ''}
                        onChange={e => updatePair(i, 'value', e.target.value)}
                        className="w-full px-3 py-2 text-sm wf-input wf-fg border wf-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50"
                      />
                    ) : (
                      <div className="relative group">
                        <input
                          type="text"
                          value={stringifyValue(pair.value, pair.type)}
                          onChange={e => updatePair(i, 'value', e.target.value)}
                          placeholder="value or {{variable}}"
                          className="w-full px-3 py-2 pr-8 text-sm wf-bg-overlay border wf-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50"
                        />
                        {(upstreamNodes?.length || workflowVariables?.length) ? (
                          <button
                            onClick={() => setActiveVarPicker(activeVarPicker === i ? null : i)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded wf-fg-faint hover:text-indigo-400 hover:bg-indigo-500/200/10 transition-colors"
                            title="Insert Variable"
                          >
                            <Variable className="w-3.5 h-3.5" />
                          </button>
                        ) : null}
                        
                        {/* Variable Picker Dropdown */}
                        {activeVarPicker === i && (
                          <div className="absolute z-50 right-0 top-full mt-1 w-64 wf-bg-overlay border wf-border-subtle rounded-xl shadow-2xl shadow-black/50 max-h-48 overflow-y-auto animate-in fade-in slide-in-from-top-2">
                            <div className="px-2 py-1.5 wf-bg-overlay border-b wf-border-subtle text-[10px] font-bold wf-fg-faint uppercase tracking-wider flex items-center gap-1 sticky top-0">
                              <Variable className="w-3 h-3" />
                              Insert Variable
                            </div>
                            <div className="p-1">
                              {buildSuggestions().map(s => (
                                <button
                                  key={s.text}
                                  onClick={() => {
                                    updatePair(i, 'value', s.text);
                                    setActiveVarPicker(null);
                                  }}
                                  className="w-full px-2 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-indigo-500/200/10 rounded-lg transition-colors"
                                >
                                  <code className="px-1.5 py-0.5 rounded wf-bg-overlay border wf-border-subtle wf-fg-muted font-mono text-[10px]">
                                    {s.label}
                                  </code>
                                  {s.description && (
                                    <span className="wf-fg-faint truncate ml-auto text-[10px]">{s.description}</span>
                                  )}
                                </button>
                              ))}
                              {buildSuggestions().length === 0 && (
                                <div className="px-2 py-3 text-xs wf-fg-faint text-center">No variables available</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Remove Button */}
                  <button
                    onClick={() => removePair(i)}
                    className="p-2 wf-fg-faint hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <button
                onClick={addPair}
                className="w-full py-2.5 border border-dashed wf-border-subtle rounded-xl text-xs font-semibold wf-fg-muted hover:text-indigo-400 hover:border-indigo-500/40 hover:bg-indigo-500/200/10 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Field
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={codeText}
            onChange={e => handleCodeChange(e.target.value)}
            className={`w-full px-4 py-3 text-sm font-mono bg-slate-900 text-slate-100 border rounded-xl focus:outline-none focus:ring-2 resize-none min-h-[200px] ${
              codeError 
                ? 'border-red-400 focus:ring-red-200' 
                : 'border-slate-700 focus:ring-indigo-300 focus:border-indigo-400'
            }`}
            spellCheck={false}
          />
          {codeError ? (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <X className="w-3.5 h-3.5" />
              {codeError}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-emerald-500">
              <Check className="w-3.5 h-3.5" />
              Valid JSON
            </div>
          )}
        </div>
      )}
    </div>
  );
}

