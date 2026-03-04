/**
 * SmartValueEditor - Intelligent value editor that adapts to different data types
 * with autocomplete for template variables like {{step_id.field}}
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { Variable, ChevronRight, Plus } from "lucide-react";
import { RichCodeEditor } from "./RichCodeEditor";

export interface AvailableVariable {
  id: string;
  label: string;
  tool?: string;
  fields: string[];  // Known output fields for this step
}

interface SmartValueEditorProps {
  value: any;
  onChange: (v: any) => void;
  keyName: string;
  availableVariables?: AvailableVariable[];
}

// Common output fields by tool type
const TOOL_OUTPUT_FIELDS: Record<string, string[]> = {
  'get_clipboard_content': ['ok', 'text'],
  'set_clipboard_content': ['ok'],
  'take_screenshot': ['ok', 'path', 'base64'],
  'read_file': ['ok', 'content', 'path'],
  'write_file': ['ok', 'path'],
  'list_directory': ['ok', 'files', 'dirs', 'entries'],
  'run_command': ['ok', 'stdout', 'stderr', 'code'],
  'run_python_script': ['ok', 'stdout', 'stderr', 'result'],
  'run_node_script': ['ok', 'stdout', 'stderr', 'result'],
  'custom_ui': ['ok', 'action', 'data', 'values'],
  'type_text': ['ok'],
  'send_hotkey': ['ok'],
  'click_at_coordinates': ['ok'],
  'get_mouse_position': ['ok', 'x', 'y'],
  'move_cursor': ['ok', 'x', 'y'],
  'wait': ['ok'],
  'log': ['ok', 'logged'],
  'get_variable': ['ok', 'value'],
  'set_variable': ['ok'],
  'list_open_windows': ['ok', 'windows'],
  'bring_window_to_foreground': ['ok'],
  'get_window_info': ['ok', 'bounds'],
  'set_window_bounds': ['ok', 'bounds'],
  'capture_media': ['ok', 'path', 'base64'],
  'launch_application_or_uri': ['ok'],
  'memory_retrieval': ['ok', 'memories', 'facts'],
  'invoke_workflow': ['ok', 'result'],
};

// Variable suggestion dropdown
function VariableSuggestions({
  suggestions,
  selectedIndex,
  onSelect,
  position
}: {
  suggestions: Array<{ text: string; label: string; description?: string }>;
  selectedIndex: number;
  onSelect: (text: string) => void;
  position: { top: number; left: number };
}) {
  if (!suggestions.length) return null;

  return (
    <div
      className="absolute z-50 bg-white/[0.04] border border-white/[0.04] rounded-xl shadow-xl max-h-48 overflow-y-auto min-w-[200px] animate-in fade-in slide-in-from-top-2 duration-150"
      style={{ top: position.top, left: position.left }}
    >
      <div className="px-3 py-2 bg-white/[0.06] border-b border-white/[0.04] text-[10px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1.5 sticky top-0">
        <Variable className="w-3 h-3" />
        Insert Variable
      </div>
      <div className="p-1">
        {suggestions.map((s, i) => (
          <button
            key={s.text}
            onClick={() => onSelect(s.text)}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-all rounded-lg mb-0.5 ${
              i === selectedIndex
                ? 'bg-indigo-50 text-indigo-700 shadow-sm'
                : 'text-white/70 hover:bg-white/[0.06]'
            }`}
          >
            <code className={`px-1.5 py-0.5 rounded text-xs font-mono border ${
              i === selectedIndex ? 'bg-white/[0.04] border-indigo-100 text-indigo-600' : 'bg-white/[0.06] border-white/[0.08] text-white/50'
            }`}>
              {s.label}
            </code>
            {s.description && (
              <span className="text-xs opacity-60 truncate ml-auto">{s.description}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// Text input with variable suggestions
function TextInputWithSuggestions({
  value,
  onChange,
  placeholder,
  availableVariables,
  multiline = false,
  className = ""
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  availableVariables?: AvailableVariable[];
  multiline?: boolean;
  className?: string;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ text: string; label: string; description?: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build suggestions from available variables
  const buildSuggestions = useCallback((searchText: string) => {
    if (!availableVariables?.length) return [];

    const search = searchText.toLowerCase();
    const results: Array<{ text: string; label: string; description?: string }> = [];

    for (const v of availableVariables) {
      // Add the step ID as a suggestion
      if (!search || v.id.toLowerCase().includes(search) || v.label.toLowerCase().includes(search)) {
        results.push({
          text: `{{${v.id}}}`,
          label: v.id,
          description: v.label
        });
      }

      // Get fields for this tool
      const toolFields = v.tool ? TOOL_OUTPUT_FIELDS[v.tool] || ['ok'] : v.fields;
      const allFields = [...new Set([...toolFields, ...v.fields])];

      // Add field-specific suggestions
      for (const field of allFields) {
        const fullPath = `${v.id}.${field}`;
        if (!search || fullPath.toLowerCase().includes(search) || field.toLowerCase().includes(search)) {
          results.push({
            text: `{{${fullPath}}}`,
            label: fullPath,
            description: `${v.label} → ${field}`
          });
        }
      }
    }

    return results.slice(0, 10); // Limit to 10 suggestions
  }, [availableVariables]);

  // Check for {{ trigger and update suggestions
  const checkForTrigger = useCallback((text: string, cursor: number) => {
    // Find the last {{ before cursor
    const beforeCursor = text.slice(0, cursor);
    const lastOpen = beforeCursor.lastIndexOf('{{');
    const lastClose = beforeCursor.lastIndexOf('}}');

    if (lastOpen > lastClose) {
      // We're inside a {{ }} block
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

    const text = value;
    const cursor = cursorPos;

    // Find the {{ to replace
    const beforeCursor = text.slice(0, cursor);
    const lastOpen = beforeCursor.lastIndexOf('{{');

    if (lastOpen >= 0) {
      // Replace from {{ to cursor with the suggestion
      const newText = text.slice(0, lastOpen) + suggestion + text.slice(cursor);
      onChange(newText);

      // Set cursor after the inserted text
      setTimeout(() => {
        const newPos = lastOpen + suggestion.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
      }, 0);
    } else {
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

  const triggerSuggestions = () => {
     const newSuggestions = buildSuggestions('');
     setSuggestions(newSuggestions);
     setShowSuggestions(true);
     setSelectedIndex(0);
     if (!cursorPos && inputRef.current) {
         setCursorPos(inputRef.current.value.length);
     }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const baseInputClass = `w-full px-4 py-2.5 text-sm border border-white/[0.08] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all bg-white/[0.04] shadow-sm placeholder:text-slate-300 ${className}`;

  return (
    <div ref={containerRef} className="relative group">
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={String(value || '')}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={`${baseInputClass} resize-none font-mono scrollbar-minimal`}
          rows={6}
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
            className={`${baseInputClass} pr-10`}
            placeholder={placeholder}
          />
          {availableVariables && availableVariables.length > 0 && (
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

      {showSuggestions && (
        <VariableSuggestions
          suggestions={suggestions}
          selectedIndex={selectedIndex}
          onSelect={insertSuggestion}
          position={{ top: multiline ? 'auto' : 42, left: 0 } as any}
        />
      )}
    </div>
  );
}

export function SmartValueEditor({ value, onChange, keyName, availableVariables }: SmartValueEditorProps) {
  const valType = typeof value;
  const isNumber = valType === 'number' || (valType === 'string' && !isNaN(Number(value)) && keyName.match(/ms|x|y|width|height|duration|timeout|amount|delta/i));
  const isBoolean = valType === 'boolean';
  const isArray = Array.isArray(value);
  const isObject = valType === 'object' && value !== null && !isArray;
  const isMultiline = valType === 'string' && (value.includes('\n') || keyName.match(/code|html|content|body|script|text|message/i));

  if (isBoolean) {
    return (
      <button
        onClick={() => onChange(!value)}
        className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all border ${
          value 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm' 
            : 'bg-white/[0.06] border-white/[0.08] text-white/50 hover:bg-white/[0.1]'
        }`}
      >
        <div className={`w-10 h-6 rounded-full relative transition-colors ${value ? 'bg-emerald-500' : 'bg-slate-300'}`}>
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white/[0.04] shadow-sm transition-transform ${value ? 'left-5' : 'left-1'}`} />
        </div>
        <span className="font-semibold text-sm">{value ? 'Enabled' : 'Disabled'}</span>
      </button>
    );
  }

  if (isNumber) {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => {
          const v = e.target.value;
          if (v === '' || v === '-' || v === '.' || v === '-.') onChange(v);
          else if (!isNaN(Number(v))) onChange(Number(v));
          else onChange(v);
        }}
        onBlur={e => {
          const v = e.target.value;
          if (v !== '' && !isNaN(Number(v))) onChange(Number(v));
        }}
        className="w-full px-4 py-2.5 text-sm border border-white/[0.08] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all shadow-sm"
      />
    );
  }

  if (isArray) {
    return (
      <div className="space-y-2">
        {value.map((item: any, i: number) => (
          <div key={i} className="flex gap-2">
            <TextInputWithSuggestions
              value={typeof item === 'object' ? JSON.stringify(item) : String(item)}
              onChange={v => {
                const newArr = [...value];
                try {
                  newArr[i] = JSON.parse(v);
                } catch {
                  newArr[i] = v;
                }
                onChange(newArr);
              }}
              availableVariables={availableVariables}
              className="flex-1 text-sm"
            />
            <button
              onClick={() => onChange(value.filter((_: any, j: number) => j !== i))}
              className="p-2.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
            >✕</button>
          </div>
        ))}
        <button
          onClick={() => onChange([...value, ''])}
          className="w-full py-2.5 border border-dashed border-white/[0.08] rounded-xl text-xs font-semibold text-white/50 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Item
        </button>
      </div>
    );
  }

  if (isObject) {
    return (
      <div className="h-48 border border-white/[0.08] rounded-xl overflow-hidden shadow-sm">
        <RichCodeEditor
          value={JSON.stringify(value, null, 2)}
          onChange={v => {
            try {
              onChange(JSON.parse(v));
            } catch {}
          }}
          language="json"
          className="h-full border-0 rounded-none shadow-none"
        />
      </div>
    );
  }

  if (isMultiline) {
    return (
      <TextInputWithSuggestions
        value={String(value || '')}
        onChange={onChange}
        placeholder={keyName}
        availableVariables={availableVariables}
        multiline
      />
    );
  }

  // Default text input with variable suggestions
  return (
    <TextInputWithSuggestions
      value={String(value || '')}
      onChange={onChange}
      placeholder={keyName}
      availableVariables={availableVariables}
    />
  );
}

