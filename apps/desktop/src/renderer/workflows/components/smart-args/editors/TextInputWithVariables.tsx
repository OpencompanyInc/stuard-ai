/**
 * TextInputWithVariables - Text input with variable autocomplete
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calculate dropdown position relative to viewport
  const updateDropdownPos = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = 240; // max-h-60 = 15rem = 240px
    // Show above if not enough space below
    const showAbove = spaceBelow < dropdownHeight && rect.top > spaceBelow;
    setDropdownPos({
      top: showAbove ? rect.top - dropdownHeight : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  // Build suggestions from upstream nodes and workflow variables
  const buildSuggestions = useCallback((searchText: string) => {
    const search = searchText.toLowerCase();
    const results: Array<{ text: string; label: string; description?: string; category?: string }> = [];

    // Add workflow variables first (shared across stuard files in this workflow)
    if (workflowVariables?.length) {
      for (const v of workflowVariables) {
        if (!search || v.name.toLowerCase().includes(search) || 'workflow'.includes(search)) {
          results.push({
            text: `{{workflow.${v.name}}}`,
            label: `workflow.${v.name}`,
            description: v.description || `${v.type} variable`,
            category: 'Workflow Variables (shared)',
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
      if (newSuggestions.length > 0) updateDropdownPos();
    } else {
      setShowSuggestions(false);
    }
  }, [buildSuggestions, updateDropdownPos]);

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
    updateDropdownPos();
    if (!cursorPos && inputRef.current) {
      setCursorPos(inputRef.current.value.length);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inContainer && !inDropdown) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const baseClass = "w-full px-4 py-2.5 text-sm border border-white/[0.08] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all bg-black/20 text-white/80 shadow-sm placeholder:text-white/30";

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
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/40 hover:text-indigo-400 hover:bg-indigo-500/200/10 transition-colors"
              title="Insert Variable"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Suggestions dropdown - rendered via portal to escape overflow clipping */}
      {showSuggestions && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999,
          }}
          className="bg-black/80 backdrop-blur-2xl border border-white/[0.08] rounded-xl shadow-2xl shadow-black/50 max-h-60 overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="px-3 py-2 bg-white/[0.04] border-b border-white/[0.08] text-[10px] font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5 sticky top-0">
            <Variable className="w-3 h-3" />
            Pick a Variable
          </div>
          <div className="p-1">
            {suggestions.map((s, i) => (
              <button
                key={s.text}
                onClick={() => insertSuggestion(s.text)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-all rounded-lg mb-0.5 ${i === selectedIndex ? 'bg-indigo-500/20 text-indigo-400 shadow-sm' : 'text-white/60 hover:bg-white/[0.06]'
                  }`}
              >
                <code className={`px-1.5 py-0.5 rounded text-xs font-mono border ${i === selectedIndex ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300' : 'bg-white/[0.04] border-white/[0.08] text-white/50'
                  }`}>
                  {s.label}
                </code>
                {s.description && (
                  <span className="text-xs opacity-60 truncate ml-auto text-white/40">{s.description}</span>
                )}
              </button>
            ))}
            {suggestions.length === 0 && (
              <div className="px-3 py-4 text-sm text-white/40 text-center">No variables found</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
