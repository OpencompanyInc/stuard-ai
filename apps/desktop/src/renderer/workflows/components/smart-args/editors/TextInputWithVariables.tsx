/**
 * TextInputWithVariables - Text input with variable autocomplete
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Variable, Plus } from 'lucide-react';
import { getToolOutputs } from '../../../constants/tool-schemas';
import type { WorkflowVariable } from '../../../types';

export interface UpstreamNode {
  id: string;
  label: string;
  tool?: string;
}

interface TextInputWithVariablesProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
  suggestFrom?: string[];
  multiline?: boolean;
}

export function TextInputWithVariables({
  value,
  onChange,
  placeholder,
  upstreamNodes,
  workflowVariables,
  suggestFrom,
  multiline = false,
}: TextInputWithVariablesProps) {
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
            className={`${baseClass} pr-10`}
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
