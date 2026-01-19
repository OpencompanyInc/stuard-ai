/**
 * SmartArgEditor - Schema-aware argument editor with dropdowns, suggestions, and context-aware completions
 * Redesigned for visual clarity and ease of use (Scratch-like UX)
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, Variable, Check, X, Plus, Trash2, Keyboard, FolderOpen, Code2, Info, ToggleLeft, ToggleRight, GripVertical, Zap, Play, ChevronRight, Settings2, Paintbrush } from "lucide-react";
import { getToolSchema, getToolOutputs, type ArgSchema, type ArgOption, type ToolSchema } from "../constants/tool-schemas";
import { PALETTE_CATEGORIES } from "../constants/paletteCategories";
import { RichCodeEditor } from "./RichCodeEditor";
import { CronEditor } from "./CronEditor";
import type { WorkflowVariable } from "../types";
import { UIBuilderModal } from "../../ui-builder";

export interface UpstreamNode {
  id: string;
  label: string;
  tool?: string;
}

interface SmartArgEditorProps {
  toolName: string;
  argKey: string;
  value: any;
  onChange: (value: any) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}

// Visual Toggle for Booleans
function BooleanToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all border ${value
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm'
        : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
        }`}
    >
      <div className={`w-10 h-6 rounded-full relative transition-colors ${value ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'left-5' : 'left-1'}`} />
      </div>
      <span className="font-semibold text-sm">{value ? 'Enabled' : 'Disabled'}</span>
    </button>
  );
}

// Hotkey editor for keyboard shortcuts
function HotkeyEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [keys, setKeys] = useState<string[]>(value || []);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key.toLowerCase();
    const newKeys: string[] = [];

    if (e.ctrlKey) newKeys.push('ctrl');
    if (e.altKey) newKeys.push('alt');
    if (e.shiftKey) newKeys.push('shift');
    if (e.metaKey) newKeys.push('meta');

    if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
      newKeys.push(key === ' ' ? 'space' : key);
    }

    if (newKeys.length > 0) {
      setKeys(newKeys);
      onChange(newKeys);
      setEditing(false);
    }
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const displayKeys = keys.length > 0 ? keys.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(' + ') : 'Click to record keys';

  return (
    <div className="relative">
      {editing ? (
        <div className="w-full px-4 py-3 text-sm border-2 border-indigo-400 rounded-xl bg-indigo-50 flex items-center justify-center animate-pulse">
          <span className="font-semibold text-indigo-700">Press keys now...</span>
          <input
            ref={inputRef}
            type="text"
            className="sr-only"
            onKeyDown={handleKeyDown}
            onBlur={() => setEditing(false)}
            readOnly
          />
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white hover:bg-slate-50 hover:border-slate-300 flex items-center justify-between gap-2 transition-all shadow-sm"
        >
          <span className="font-mono font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{displayKeys}</span>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Keyboard className="w-4 h-4" />
            <span>Edit</span>
          </div>
        </button>
      )}
    </div>
  );
}

// Google Drive Query Builder
function DriveQueryEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'visual' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
        >
          Visual Builder
        </button>
        <button
          onClick={() => setMode('raw')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === 'raw' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
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

// Select dropdown with search
function SelectInput({
  value,
  onChange,
  options,
  placeholder
}: {
  value: any;
  onChange: (v: any) => void;
  options: ArgOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    String(o.value).toLowerCase().includes(search.toLowerCase())
  );

  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white hover:bg-slate-50 hover:border-slate-300 flex items-center justify-between gap-2 transition-all shadow-sm"
      >
        <span className={selectedOption ? 'text-slate-700 font-medium' : 'text-slate-400'}>
          {selectedOption?.label || placeholder || 'Select an option...'}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-xl shadow-xl max-h-72 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {options.length > 5 && (
            <div className="p-2 border-b border-slate-100 bg-slate-50/50">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search options..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                autoFocus
              />
            </div>
          )}
          <div className="overflow-y-auto max-h-60 p-1">
            {filteredOptions.map(opt => (
              <button
                key={String(opt.value)}
                onClick={() => { onChange(opt.value); setOpen(false); setSearch(''); }}
                className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center justify-between gap-2 transition-colors mb-0.5 ${opt.value === value
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <div>
                  <div>{opt.label}</div>
                  {opt.description && (
                    <div className="text-xs text-slate-400 font-normal">{opt.description}</div>
                  )}
                </div>
                {opt.value === value && <Check className="w-4 h-4 text-indigo-600" />}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-8 text-sm text-slate-400 text-center">No matching options</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Workflow-level variable for suggestions */
export interface WorkflowVariableSuggestion {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'list';
  defaultValue?: any;
  description?: string;
}

// Text input with variable suggestions
export function TextInputWithVariables({
  value,
  onChange,
  placeholder,
  upstreamNodes,
  workflowVariables,
  suggestFrom,
  multiline = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
  suggestFrom?: string[];
  multiline?: boolean;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ text: string; label: string; description?: string; category?: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build suggestions from upstream nodes and workflow variables
  const buildSuggestions = useCallback((searchText: string) => {
    const search = searchText.toLowerCase();
    const results: Array<{ text: string; label: string; description?: string; category?: string }> = [];

    // Add workflow variables first (they're global)
    if (workflowVariables?.length) {
      for (const v of workflowVariables) {
        if (!search || v.name.toLowerCase().includes(search) || 'workflow'.includes(search)) {
          results.push({
            text: `{{workflow.${v.name}}}`,
            label: `workflow.${v.name}`,
            description: v.description || `${v.type} variable`,
            category: 'Workflow Variables',
          });
        }
      }
    }

    if (!upstreamNodes?.length) return results.slice(0, 12);

    for (const node of upstreamNodes) {
      // Add the step ID as a suggestion
      if (!search || node.id.toLowerCase().includes(search) || node.label.toLowerCase().includes(search)) {
        results.push({
          text: `{{${node.id}}}`,
          label: node.id,
          description: node.label
        });
      }

      // Get fields for this tool
      const toolOutputs = node.tool ? getToolOutputs(node.tool) : ['ok', 'result'];

      // Filter based on suggestFrom if provided
      // Special case: '*.*' means all fields from all tools
      const showAllFields = !suggestFrom || suggestFrom.includes('*.*') || suggestFrom.includes('*');
      const relevantOutputs = showAllFields
        ? toolOutputs
        : toolOutputs.filter(f =>
          suggestFrom.some(s => {
            const [pattern, field] = s.split('.');
            return (pattern === '*' || pattern === node.tool) && (field === f || field === '*');
          })
        );

      // Add field-specific suggestions
      for (const field of relevantOutputs) {
        const fullPath = `${node.id}.${field}`;
        if (!search || fullPath.toLowerCase().includes(search) || field.toLowerCase().includes(search)) {
          results.push({
            text: `{{${fullPath}}}`,
            label: fullPath,
            description: `${node.label} → ${field}`
          });
        }
      }
    }

    return results.slice(0, 12);
  }, [upstreamNodes, workflowVariables, suggestFrom]);

  // Check for {{ trigger
  const checkForTrigger = useCallback((text: string, cursor: number) => {
    const beforeCursor = text.slice(0, cursor);
    const lastOpen = beforeCursor.lastIndexOf('{{');
    const lastClose = beforeCursor.lastIndexOf('}}');

    if (lastOpen > lastClose) {
      const searchText = beforeCursor.slice(lastOpen + 2);
      const newSuggestions = buildSuggestions(searchText);
      setSuggestions(newSuggestions);
      setShowSuggestions(newSuggestions.length > 0);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  }, [buildSuggestions]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursor = e.target.selectionStart || 0;
    setCursorPos(cursor);
    onChange(newValue);
    checkForTrigger(newValue, cursor);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && suggestions[selectedIndex]) {
      e.preventDefault();
      insertSuggestion(suggestions[selectedIndex].text);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    } else if (e.key === 'Tab' && suggestions[selectedIndex]) {
      e.preventDefault();
      insertSuggestion(suggestions[selectedIndex].text);
    }
  };

  const insertSuggestion = (suggestion: string) => {
    const input = inputRef.current;
    if (!input) return;

    const text = String(value || '');
    const cursor = cursorPos;
    const beforeCursor = text.slice(0, cursor);
    const lastOpen = beforeCursor.lastIndexOf('{{');

    if (lastOpen >= 0) {
      const newText = text.slice(0, lastOpen) + suggestion + text.slice(cursor);
      onChange(newText);

      setTimeout(() => {
        const newPos = lastOpen + suggestion.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
      }, 0);
    } else {
      // Append if triggered via button
      const newText = text.slice(0, cursor) + suggestion + text.slice(cursor);
      onChange(newText);
      setTimeout(() => {
        const newPos = cursor + suggestion.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
      }, 0);
    }

    setShowSuggestions(false);
  };

  // Trigger suggestions manually (e.g. from + button)
  const triggerSuggestions = () => {
    const newSuggestions = buildSuggestions('');
    setSuggestions(newSuggestions);
    setShowSuggestions(true);
    setSelectedIndex(0);
    // Set cursor pos to end if not set
    if (!cursorPos && inputRef.current) {
      setCursorPos(inputRef.current.value.length);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const baseClass = "w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-all bg-white shadow-sm placeholder:text-slate-300";

  return (
    <div ref={containerRef} className="relative group">
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={String(value || '')}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={`${baseClass} resize-none font-mono scrollbar-minimal`}
          rows={4}
          spellCheck={false}
          placeholder={placeholder}
        />
      ) : (
        <div className="relative">
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={String(value || '')}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            className={`${baseClass} pr-10`} // Make room for the button
            placeholder={placeholder}
          />
          {((upstreamNodes && upstreamNodes.length > 0) || (workflowVariables && workflowVariables.length > 0)) && (
            <button
              onClick={triggerSuggestions}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              title="Insert Variable"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Suggestions dropdown */}
      {showSuggestions && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-xl shadow-xl max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 sticky top-0">
            <Variable className="w-3 h-3" />
            Pick a Variable
          </div>
          <div className="p-1">
            {suggestions.map((s, i) => (
              <button
                key={s.text}
                onClick={() => insertSuggestion(s.text)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-all rounded-lg mb-0.5 ${i === selectedIndex ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
              >
                <code className={`px-1.5 py-0.5 rounded text-xs font-mono border ${i === selectedIndex ? 'bg-white border-indigo-100 text-indigo-600' : 'bg-slate-100 border-slate-200 text-slate-500'
                  }`}>
                  {s.label}
                </code>
                {s.description && (
                  <span className="text-xs opacity-60 truncate ml-auto">{s.description}</span>
                )}
              </button>
            ))}
            {suggestions.length === 0 && (
              <div className="px-3 py-4 text-sm text-slate-400 text-center">No variables found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Code editor - uses RichCodeEditor for full-featured editing
function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  placeholder?: string;
}) {
  return (
    <div className="rounded-xl overflow-hidden shadow-sm">
      <RichCodeEditor
        value={String(value || '')}
        onChange={onChange}
        language={language || 'text'}
        placeholder={placeholder || `Enter ${language || 'code'} here...`}
        className="min-h-[200px]"
      />
    </div>
  );
}

// Get all available tools for the step builder
function getAllAvailableTools(): Array<{ id: string; label: string; category: string; args: any }> {
  const tools: Array<{ id: string; label: string; category: string; args: any }> = [];
  for (const cat of PALETTE_CATEGORIES) {
    for (const item of cat.items) {
      if (item.k !== 'trigger' && item.t !== 'run_parallel' && item.t !== 'run_sequential') {
        tools.push({
          id: item.t,
          label: item.label,
          category: cat.label,
          args: item.args || {},
        });
      }
    }
  }
  return tools;
}

// Visual step builder for run_parallel and run_sequential tools
function ParallelStepsEditor({
  value,
  onChange,
  upstreamNodes,
  workflowVariables,
  isParallel = true,
}: {
  value: any[];
  onChange: (v: any[]) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariableSuggestion[];
  isParallel?: boolean;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showToolPicker, setShowToolPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const steps = Array.isArray(value) ? value : [];
  const allTools = useMemo(() => getAllAvailableTools(), []);

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return allTools;
    const q = searchQuery.toLowerCase();
    return allTools.filter(t =>
      t.label.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }, [allTools, searchQuery]);

  // Group tools by category
  const groupedTools = useMemo(() => {
    const groups: Record<string, typeof filteredTools> = {};
    for (const tool of filteredTools) {
      if (!groups[tool.category]) groups[tool.category] = [];
      groups[tool.category].push(tool);
    }
    return groups;
  }, [filteredTools]);

  const addStep = (toolId: string, args: any) => {
    const newStep = { tool: toolId, args: { ...args } };
    onChange([...steps, newStep]);
    setShowToolPicker(false);
    setSearchQuery('');
    setExpandedIndex(steps.length); // Expand the new step
  };

  const updateStep = (index: number, updates: Partial<{ tool: string; args: any }>) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], ...updates };
    onChange(newSteps);
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
  };

  const moveStep = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= steps.length) return;
    const newSteps = [...steps];
    const [moved] = newSteps.splice(fromIndex, 1);
    newSteps.splice(toIndex, 0, moved);
    onChange(newSteps);
    setExpandedIndex(toIndex);
  };

  return (
    <div className="space-y-3">
      {/* Steps List */}
      {steps.length > 0 && (
        <div className="space-y-2">
          {steps.map((step, i) => {
            const toolId = step?.tool || '';
            const toolInfo = allTools.find(t => t.id === toolId);
            const schema = getToolSchema(toolId);
            const isExpanded = expandedIndex === i;

            return (
              <div
                key={i}
                className={`border rounded-xl transition-all ${isExpanded
                  ? 'border-indigo-200 bg-indigo-50/30 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
              >
                {/* Step Header */}
                <div
                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                  onClick={() => setExpandedIndex(isExpanded ? null : i)}
                >
                  {/* Drag Handle */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveStep(i, i - 1); }}
                      disabled={i === 0}
                      className={`p-0.5 rounded transition-colors ${i === 0 ? 'text-slate-200' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                    >
                      <ChevronRight className="w-3 h-3 -rotate-90" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveStep(i, i + 1); }}
                      disabled={i === steps.length - 1}
                      className={`p-0.5 rounded transition-colors ${i === steps.length - 1 ? 'text-slate-200' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                    >
                      <ChevronRight className="w-3 h-3 rotate-90" />
                    </button>
                  </div>

                  {/* Step Number */}
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isExpanded ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                    {i + 1}
                  </div>

                  {/* Tool Name */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700 truncate">
                      {toolInfo?.label || toolId || 'Select Tool'}
                    </div>
                    {toolInfo?.category && (
                      <div className="text-[10px] text-slate-400">{toolInfo.category}</div>
                    )}
                  </div>

                  {/* Expand/Collapse Icon */}
                  <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />

                  {/* Delete Button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeStep(i); }}
                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Step Settings (Expanded) */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-4">
                    {/* Tool Selector */}
                    <div>
                      <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Tool</label>
                      <select
                        value={toolId}
                        onChange={(e) => {
                          const newTool = e.target.value;
                          const newToolInfo = allTools.find(t => t.id === newTool);
                          updateStep(i, { tool: newTool, args: newToolInfo?.args || {} });
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                      >
                        <option value="">Select a tool...</option>
                        {Object.entries(groupedTools).map(([category, tools]) => (
                          <optgroup key={category} label={category}>
                            {tools.map(tool => (
                              <option key={tool.id} value={tool.id}>{tool.label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {/* Tool Arguments */}
                    {toolId && schema && (
                      <div className="space-y-3">
                        <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                          <Settings2 className="w-3.5 h-3.5" />
                          Settings
                        </label>
                        {Object.keys(schema.args).map(argKey => (
                          <div key={argKey} className="pl-2 border-l-2 border-slate-100">
                            <SmartArgEditor
                              toolName={toolId}
                              argKey={argKey}
                              value={step.args?.[argKey]}
                              onChange={(v) => updateStep(i, { args: { ...step.args, [argKey]: v } })}
                              upstreamNodes={upstreamNodes}
                              workflowVariables={workflowVariables}
                            />
                          </div>
                        ))}
                        {Object.keys(schema.args).length === 0 && (
                          <div className="text-xs text-slate-400 italic py-2">
                            No configuration needed for this tool
                          </div>
                        )}
                      </div>
                    )}

                    {/* Raw Args for tools without schema */}
                    {toolId && !schema && (
                      <div>
                        <label className="text-xs font-semibold text-slate-600 mb-1.5 block">Arguments (JSON)</label>
                        <textarea
                          value={JSON.stringify(step.args || {}, null, 2)}
                          onChange={(e) => {
                            try {
                              const parsed = JSON.parse(e.target.value);
                              updateStep(i, { args: parsed });
                            } catch { /* Ignore parse errors while typing */ }
                          }}
                          className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-none"
                          rows={4}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Step Button / Tool Picker */}
      {showToolPicker ? (
        <div className="border border-indigo-200 rounded-xl bg-white shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tools..."
              className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
              autoFocus
            />
          </div>

          {/* Tool List */}
          <div className="max-h-64 overflow-y-auto">
            {Object.entries(groupedTools).length > 0 ? (
              Object.entries(groupedTools).map(([category, tools]) => (
                <div key={category}>
                  <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 sticky top-0">
                    {category}
                  </div>
                  {tools.map(tool => (
                    <button
                      key={tool.id}
                      onClick={() => addStep(tool.id, tool.args)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 flex items-center gap-2 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="font-medium text-slate-700">{tool.label}</span>
                      <span className="text-xs text-slate-400 ml-auto">{tool.id}</span>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-sm text-slate-400 text-center">
                No tools found matching "{searchQuery}"
              </div>
            )}
          </div>

          {/* Cancel */}
          <div className="p-2 border-t border-slate-100 bg-slate-50">
            <button
              onClick={() => { setShowToolPicker(false); setSearchQuery(''); }}
              className="w-full py-2 text-sm text-slate-500 hover:text-slate-700 font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowToolPicker(true)}
          className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm font-medium text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all flex items-center justify-center gap-2 group"
        >
          <div className="w-7 h-7 rounded-full bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center transition-colors">
            <Plus className="w-4 h-4" />
          </div>
          Add {isParallel ? 'Parallel' : 'Sequential'} Step
        </button>
      )}

      {/* Info */}
      {steps.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg text-xs text-slate-500">
          <Zap className="w-3.5 h-3.5 text-indigo-400" />
          {isParallel
            ? `${steps.length} step${steps.length !== 1 ? 's' : ''} will run simultaneously`
            : `${steps.length} step${steps.length !== 1 ? 's' : ''} will run in order`
          }
        </div>
      )}
    </div>
  );
}

// Array editor - handles both simple arrays and arrays of objects (like sources: [{path: ''}])
function ArrayEditor({
  value,
  onChange,
  itemType,
  itemOptions,
  upstreamNodes,
  workflowVariables,
  itemTemplate,
  argKey,
}: {
  value: any[];
  onChange: (v: any[]) => void;
  itemType?: string;
  itemOptions?: ArgOption[];
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
  itemTemplate?: any; // Template for new items (e.g., { path: '' })
  argKey?: string; // The argument key name for context
}) {
  // For 'sources' field, normalize string items to {path: string} objects
  const rawItems = Array.isArray(value) ? value : [];
  const isSourcesField = argKey === 'sources';

  // Auto-convert string items to {path: string} for sources field
  const items = isSourcesField
    ? rawItems.map(item =>
      typeof item === 'string' ? { path: item } : item
    )
    : rawItems;

  // If we normalized, update the parent value
  React.useEffect(() => {
    if (isSourcesField && rawItems.length > 0 && rawItems.some(item => typeof item === 'string')) {
      const normalized = rawItems.map(item => typeof item === 'string' ? { path: item } : item);
      onChange(normalized);
    }
  }, []);

  // Detect if items are objects with a 'path' property (common pattern)
  const isPathArray = isSourcesField ||
    (items.length > 0 && typeof items[0] === 'object' && items[0] !== null && 'path' in items[0]);

  const addItem = () => {
    // Use template if provided, otherwise infer from existing items or default
    const template = itemTemplate ||
      (isPathArray ? { path: '' } :
        (items.length > 0 && typeof items[0] === 'object' ? { ...items[0] } : ''));

    // Reset values in template
    const newItem = typeof template === 'object' && template !== null
      ? Object.fromEntries(Object.keys(template).map(k => [k, '']))
      : '';

    onChange([...items, newItem]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, newValue: any) => {
    const newItems = [...items];
    newItems[index] = newValue;
    onChange(newItems);
  };

  // For path arrays, update just the path property
  const updateItemPath = (index: number, path: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], path };
    onChange(newItems);
  };

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-start group">
          <div className="flex-1">
            {itemOptions ? (
              <SelectInput
                value={item}
                onChange={v => updateItem(i, v)}
                options={itemOptions}
              />
            ) : isPathArray && typeof item === 'object' && item !== null ? (
              // Special handling for {path: ''} objects - show path input with file icon
              <div className="relative">
                <TextInputWithVariables
                  value={item.path || ''}
                  onChange={v => updateItemPath(i, v)}
                  placeholder="File path or {{step.filePath}}"
                  upstreamNodes={upstreamNodes}
                  workflowVariables={workflowVariables}
                />
                <div className="absolute right-12 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                  <FolderOpen className="w-4 h-4" />
                </div>
              </div>
            ) : typeof item === 'object' && item !== null ? (
              // For other objects, show a mini JSON editor
              <textarea
                value={JSON.stringify(item, null, 2)}
                onChange={e => {
                  try { updateItem(i, JSON.parse(e.target.value)); } catch { /* ignore parse errors while typing */ }
                }}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-none scrollbar-minimal"
                rows={3}
              />
            ) : (
              <TextInputWithVariables
                value={String(item || '')}
                onChange={v => updateItem(i, v)}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
            )}
          </div>
          <button
            onClick={() => removeItem(i)}
            className="p-2.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
            title="Remove Item"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        onClick={addItem}
        className="w-full py-2.5 border border-dashed border-slate-200 rounded-xl text-xs font-semibold text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all flex items-center justify-center gap-2 group"
      >
        <div className="w-5 h-5 rounded-full bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center transition-colors">
          <Plus className="w-3.5 h-3.5" />
        </div>
        {isPathArray ? 'Add File' : 'Add Item'}
      </button>
    </div>
  );
}

// JSON editor with format/beautify and validation
function JsonEditor({ value, onChange, label }: { value: any; onChange: (v: any) => void; label?: string }) {
  const [text, setText] = useState(() => {
    try { return JSON.stringify(value, null, 2); } catch { return '{}'; }
  });
  const [error, setError] = useState('');
  const [isMinified, setIsMinified] = useState(false);

  // Sync external value changes
  useEffect(() => {
    try {
      const newText = JSON.stringify(value, null, isMinified ? 0 : 2);
      if (newText !== text) {
        setText(newText);
        setError('');
      }
    } catch {
      // Keep current text if value can't be stringified
    }
  }, [value]);

  const handleChange = (newText: string) => {
    setText(newText);
    try {
      const parsed = JSON.parse(newText);
      onChange(parsed);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      setText(formatted);
      setIsMinified(false);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const minifyJson = () => {
    try {
      const parsed = JSON.parse(text);
      const minified = JSON.stringify(parsed);
      setText(minified);
      setIsMinified(true);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-2">
      {/* Quick actions bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <button
            onClick={formatJson}
            className="text-[10px] font-medium text-slate-500 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 px-2 py-1 rounded-md border border-slate-200 hover:border-indigo-200 transition-colors"
          >
            Format
          </button>
          <button
            onClick={minifyJson}
            className="text-[10px] font-medium text-slate-500 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 px-2 py-1 rounded-md border border-slate-200 hover:border-indigo-200 transition-colors"
          >
            Minify
          </button>
        </div>
        {!error && (
          <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
            <Check className="w-3 h-3" />
            Valid JSON
          </span>
        )}
      </div>

      {/* Editor */}
      <div className={`rounded-xl border transition-colors overflow-hidden ${error ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200'
        }`}>
        <RichCodeEditor
          value={text}
          onChange={handleChange}
          language="json"
          className="min-h-[250px] border-0 rounded-none shadow-none"
        />
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-100">
          <X className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div className="text-xs text-red-600">
            <span className="font-semibold">Invalid JSON:</span>{' '}
            <span className="font-mono text-red-500">{error}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main SmartArgEditor component
 */
export function SmartArgEditor({ toolName, argKey, value, onChange, upstreamNodes, workflowVariables }: SmartArgEditorProps) {
  const schema = useMemo(() => getToolSchema(toolName), [toolName]);
  const argSchema = schema?.args[argKey];

  // If no schema, fall back to basic type detection
  if (!argSchema) {
    return (
      <TextInputWithVariables
        value={String(value || '')}
        onChange={onChange}
        upstreamNodes={upstreamNodes}
        workflowVariables={workflowVariables}
        placeholder={argKey}
      />
    );
  }

  const { type, label, description, options, placeholder, itemType, itemOptions, language, suggestFrom, required } = argSchema;

  // Render based on type
  const renderEditor = () => {
    // Special case: Drive query builder
    if (toolName === 'drive_list_files' && argKey === 'query') {
      return <DriveQueryEditor value={String(value || '')} onChange={onChange} />;
    }

    // Special case: Parallel/Sequential steps builder
    if ((toolName === 'run_parallel' || toolName === 'run_sequential') && argKey === 'steps') {
      return (
        <ParallelStepsEditor
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          upstreamNodes={upstreamNodes}
          workflowVariables={workflowVariables}
          isParallel={toolName === 'run_parallel'}
        />
      );
    }

    switch (type) {
      case 'boolean':
        return <BooleanToggle value={Boolean(value)} onChange={onChange} />;

      case 'number':
        return (
          <input
            type="number"
            value={value ?? ''}
            onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder={placeholder || '0'}
            className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 transition-all shadow-sm"
          />
        );

      case 'select':
        return options ? (
          <SelectInput
            value={value}
            onChange={onChange}
            options={options}
            placeholder={placeholder}
          />
        ) : null;

      case 'hotkey':
        return <HotkeyEditor value={Array.isArray(value) ? value : []} onChange={onChange} />;

      case 'cron':
        return <CronEditor value={String(value || '')} onChange={onChange} />;

      case 'code':
        return <CodeEditor value={String(value || '')} onChange={onChange} language={language} />;

      case 'path':
        return (
          <div className="relative flex gap-2">
            <div className="flex-1 relative">
              <TextInputWithVariables
                value={String(value || '')}
                onChange={onChange}
                placeholder={placeholder}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
                suggestFrom={suggestFrom}
              />
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const api = (window as any).desktopAPI;
                  if (!api?.pickFiles && !api?.pickFolder) return;

                  // Determine if this should be a folder or file picker based on the arg key
                  const isFolder = argKey.toLowerCase().includes('folder') ||
                    argKey.toLowerCase().includes('directory') ||
                    argKey.toLowerCase().includes('dir');

                  if (isFolder) {
                    const result = await api.pickFolder({ title: 'Select Folder' });
                    if (result?.ok && result.folders?.length > 0) {
                      onChange(result.folders[0]);
                    }
                  } else {
                    const result = await api.pickFiles({ title: 'Select File', multiple: false });
                    if (result?.ok && result.files?.length > 0) {
                      const file = result.files[0];
                      onChange(typeof file === 'string' ? file : file.path);
                    }
                  }
                } catch (e) {
                  console.error('Failed to pick path:', e);
                }
              }}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-slate-600 hover:text-slate-800 transition-all flex items-center gap-1.5 text-sm font-medium shrink-0"
              title="Browse..."
            >
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
          </div>
        );

      case 'array':
        // Convert string values to single-element arrays for better UX
        const arrayValue = Array.isArray(value)
          ? value
          : (value !== undefined && value !== null && value !== '' ? [value] : []);
        return (
          <ArrayEditor
            value={arrayValue}
            onChange={onChange}
            itemType={itemType}
            itemOptions={itemOptions}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
            argKey={argKey}
          />
        );

      case 'json':
      case 'object':
        return <JsonEditor value={value || {}} onChange={onChange} />;

      case 'string':
      default:
        const isMultiline = !!argKey.match(/code|html|content|body|script|text|message/i) ||
          String(value || '').includes('\n');
        return (
          <TextInputWithVariables
            value={String(value || '')}
            onChange={onChange}
            placeholder={placeholder}
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
            suggestFrom={suggestFrom}
            multiline={isMultiline}
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-0.5 mb-1">
        <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          {label || argKey}
          {required && <span className="text-red-400 text-xs">*</span>}
        </label>
        {description && (
          <p className="text-[11px] text-slate-400 leading-snug">
            {description}
          </p>
        )}
      </div>
      {renderEditor()}
    </div>
  );
}

/**
 * Full arguments editor for a tool - renders all arguments with schema
 */
export function ToolArgsEditor({
  toolName,
  args,
  onUpdate,
  upstreamNodes,
  workflowVariables,
}: {
  toolName: string;
  args: Record<string, any>;
  onUpdate: (args: Record<string, any>) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}) {
  const schema = useMemo(() => getToolSchema(toolName), [toolName]);
  const [showAddArg, setShowAddArg] = useState(false);
  const [newArgKey, setNewArgKey] = useState('');
  const [showUIBuilder, setShowUIBuilder] = useState(false);

  // Special case: custom_ui tool - show visual UI builder
  if (toolName === 'custom_ui') {
    const handleUIBuilderSave = (result: { html: string; css: string; js: string; window: any }) => {
      onUpdate({
        ...args,
        html: result.html,
        css: result.css,
        js: result.js || args.js,
        script: result.js || args.script,
        ...result.window,
      });
    };

    return (
      <div className="space-y-4">
        {/* Design UI Button */}
        <button
          onClick={() => setShowUIBuilder(true)}
          className="w-full py-3.5 text-white rounded-xl font-semibold flex items-center justify-center gap-2.5 shadow-lg hover:shadow-xl transition-all group bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
        >
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Paintbrush className="w-5 h-5" />
          </div>
          <span>Design UI</span>
        </button>

        {/* Preview of current args if any */}
        {args.html && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500">Current UI Configuration</span>
              <span className="text-[10px] text-slate-400">
                {args.width || 400}x{args.height || 500}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="px-2 py-1.5 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Position:</span>{' '}
                <span className="text-slate-700 font-medium">{args.position || 'center'}</span>
              </div>
              <div className="px-2 py-1.5 bg-white rounded border border-slate-200">
                <span className="text-slate-400">Frameless:</span>{' '}
                <span className="text-slate-700 font-medium">{args.frameless ? 'Yes' : 'No'}</span>
              </div>
              <div className="px-2 py-1.5 bg-white rounded border border-slate-200">
                <span className="text-slate-400">On Top:</span>{' '}
                <span className="text-slate-700 font-medium">{args.alwaysOnTop ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Advanced: Edit manually */}
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500 hover:text-indigo-600 font-medium py-2 flex items-center gap-2">
            <Code2 className="w-4 h-4" />
            Advanced: Edit HTML/CSS/JS manually
          </summary>
          <div className="mt-3 space-y-4 pl-6 border-l-2 border-indigo-100">
            <SmartArgEditor
              toolName={toolName}
              argKey="html"
              value={args.html || ''}
              onChange={v => onUpdate({ ...args, html: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
            <SmartArgEditor
              toolName={toolName}
              argKey="css"
              value={args.css || ''}
              onChange={v => onUpdate({ ...args, css: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
            <SmartArgEditor
              toolName={toolName}
              argKey="js"
              value={args.js || ''}
              onChange={v => onUpdate({ ...args, js: v })}
              upstreamNodes={upstreamNodes}
              workflowVariables={workflowVariables}
            />
          </div>
        </details>

        {/* UI Builder Modal */}
        {showUIBuilder && (
          <UIBuilderModal
            html={args.html || ''}
            css={args.css || ''}
            js={args.js || args.script || ''}
            windowConfig={{
              width: args.width || args.window?.width || 800,
              height: args.height || args.window?.height || 600,
              title: args.title || args.window?.title,
              position: args.position || args.window?.position,
              alwaysOnTop: args.alwaysOnTop ?? args.window?.alwaysOnTop,
              frameless: args.frameless ?? args.window?.frameless,
              borderRadius: args.borderRadius || args.window?.borderRadius,
            }}
            onSave={handleUIBuilderSave}
            onClose={() => setShowUIBuilder(false)}
          />
        )}
      </div>
    );
  }

  const updateArg = (key: string, value: any) => {
    onUpdate({ ...args, [key]: value });
  };

  const deleteArg = (key: string) => {
    const newArgs = { ...args };
    delete newArgs[key];
    onUpdate(newArgs);
  };

  const addArg = () => {
    if (!newArgKey.trim()) return;
    onUpdate({ ...args, [newArgKey.trim()]: '' });
    setNewArgKey('');
    setShowAddArg(false);
  };

  // Get keys: schema keys first, then any extra keys in args
  const schemaKeys = schema ? Object.keys(schema.args) : [];
  const extraKeys = Object.keys(args).filter(k => !schemaKeys.includes(k));
  const allKeys = [...schemaKeys, ...extraKeys];

  return (
    <div className="space-y-6">
      {allKeys.length === 0 && !showAddArg ? (
        <div className="py-8 px-4 text-center rounded-xl bg-slate-50 border border-dashed border-slate-200">
          <p className="text-sm text-slate-500 font-medium">No configuration needed</p>
          <p className="text-xs text-slate-400 mt-1">This step doesn't require any settings.</p>
        </div>
      ) : (
        allKeys.map(key => {
          const argSchema = schema?.args[key];
          const isExtra = !schemaKeys.includes(key);

          return (
            <div key={key} className="group relative transition-all">
              <SmartArgEditor
                toolName={toolName}
                argKey={key}
                value={args[key]}
                onChange={v => updateArg(key, v)}
                upstreamNodes={upstreamNodes}
                workflowVariables={workflowVariables}
              />
              {/* Delete button for non-required or extra args */}
              {(isExtra || !argSchema?.required) && (
                <button
                  onClick={() => deleteArg(key)}
                  className="absolute right-0 top-0 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0"
                  title="Remove argument"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })
      )}

      {/* Add custom argument */}
      {showAddArg ? (
        <div className="flex gap-2 items-center p-3 bg-slate-50 rounded-xl border border-indigo-200 shadow-sm animate-in fade-in slide-in-from-bottom-2">
          <input
            value={newArgKey}
            onChange={e => setNewArgKey(e.target.value)}
            placeholder="custom_property_name"
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 font-mono bg-white"
            onKeyDown={e => e.key === 'Enter' && addArg()}
            autoFocus
          />
          <button
            onClick={addArg}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-sm transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => { setShowAddArg(false); setNewArgKey(''); }}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddArg(true)}
          className="w-full py-3 border border-dashed border-slate-200 rounded-xl text-xs font-semibold text-slate-400 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all flex items-center justify-center gap-2 group"
        >
          <div className="w-6 h-6 rounded-full bg-slate-50 group-hover:bg-indigo-50 flex items-center justify-center transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </div>
          Add Custom Property
        </button>
      )}
    </div>
  );
}
