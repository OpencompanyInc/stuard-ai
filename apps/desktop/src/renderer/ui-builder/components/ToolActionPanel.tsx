/**
 * ToolActionPanel - No-code tool action configurator for custom UI
 * Allows users to configure tool calls visually (pick tool, set args, bind result to state).
 * Tools are dynamically sourced from the workflow palette — not hardcoded.
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { UIToolAction, UIStateVariable } from '../types';
import { LOCAL_TOOL_ITEMS, CLOUD_TOOL_ITEMS } from '../../workflows/constants/paletteItems';

interface ToolActionPanelProps {
  toolActions: UIToolAction[];
  stateVariables: UIStateVariable[];
  onChange: (actions: UIToolAction[]) => void;
  /** Current page HTML — used to discover clickable elements for wiring */
  currentHtml?: string;
}

/** Parse HTML to find elements with IDs (buttons, inputs, etc.) that can be wired to tool actions */
function extractClickableElements(html: string): Array<{ id: string; tag: string; label: string }> {
  if (!html) return [];
  const results: Array<{ id: string; tag: string; label: string }> = [];
  // Match elements that have an id attribute
  const regex = /<(button|a|div|span|input|select|label|img)([^>]*?\bid="([^"]+)"[^>]*)(?:>([\s\S]*?)<\/\1>|\s*\/?>)/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const id = match[3];
    // Try to get text content for a label
    const inner = (match[4] || '').replace(/<[^>]*>/g, '').trim();
    const label = inner ? `${tag}#${id} — "${inner.slice(0, 30)}"` : `${tag}#${id}`;
    results.push({ id, tag, label });
  }
  return results;
}

// Build a deduplicated flat tool list from the workflow palette
interface ToolEntry { name: string; label: string; args: Record<string, any>; kind: 'local' | 'cloud' }

function buildToolList(): ToolEntry[] {
  const seen = new Set<string>();
  const result: ToolEntry[] = [];
  for (const item of LOCAL_TOOL_ITEMS) {
    if (!seen.has(item.t)) {
      seen.add(item.t);
      result.push({ name: item.t, label: item.label, args: item.args ?? {}, kind: 'local' });
    }
  }
  for (const item of CLOUD_TOOL_ITEMS) {
    if (!seen.has(item.t)) {
      seen.add(item.t);
      result.push({ name: item.t, label: item.label, args: item.args ?? {}, kind: 'cloud' });
    }
  }
  return result;
}

const ALL_TOOLS = buildToolList();

function generateId() {
  return 'ta_' + Math.random().toString(36).slice(2, 8);
}

export function ToolActionPanel({ toolActions, stateVariables, onChange, currentHtml }: ToolActionPanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toolSearch, setToolSearch] = useState('');
  const [newTrigger, setNewTrigger] = useState<'click' | 'load' | 'stateChange'>('click');

  // Discover clickable elements in the current HTML for wiring click triggers
  const clickableElements = useMemo(() => extractClickableElements(currentHtml || ''), [currentHtml]);

  // Find which element IDs are already wired to a tool action
  const wiredElementIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of toolActions) {
      if (a.trigger === 'click' && a.triggerConfig?.elementId) {
        ids.add(a.triggerConfig.elementId);
      }
    }
    return ids;
  }, [toolActions]);

  const filteredTools = useMemo(() => {
    if (!toolSearch.trim()) return ALL_TOOLS.slice(0, 20); // show first 20 by default
    const q = toolSearch.toLowerCase();
    return ALL_TOOLS.filter(t =>
      t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [toolSearch]);

  const addToolAction = useCallback((tool: ToolEntry) => {
    // Build clean default args (only string/number primitives for UI editing)
    const cleanArgs: Record<string, any> = {};
    for (const [k, v] of Object.entries(tool.args)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        cleanArgs[k] = v;
      }
    }
    const action: UIToolAction = {
      id: generateId(),
      name: tool.label,
      toolName: tool.name,
      args: cleanArgs,
      trigger: newTrigger,
    };
    onChange([...toolActions, action]);
    setToolSearch('');
    setNewTrigger('click');
    setShowAdd(false);
    setExpandedId(action.id);
  }, [newTrigger, toolActions, onChange]);

  const handleDelete = useCallback((id: string) => {
    onChange(toolActions.filter(a => a.id !== id));
    if (expandedId === id) setExpandedId(null);
  }, [toolActions, onChange, expandedId]);

  const handleUpdate = useCallback((id: string, updates: Partial<UIToolAction>) => {
    onChange(toolActions.map(a => a.id === id ? { ...a, ...updates } : a));
  }, [toolActions, onChange]);

  const handleArgChange = useCallback((actionId: string, argName: string, value: string) => {
    const action = toolActions.find(a => a.id === actionId);
    if (!action) return;
    handleUpdate(actionId, { args: { ...action.args, [argName]: value } });
  }, [toolActions, handleUpdate]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uib-fg-muted uppercase tracking-wider">Tool Actions</div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15 border border-emerald-500/30"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <div className="uib-surface-2 rounded-lg p-2.5 border uib-border flex flex-col gap-2">
          {/* Trigger selector */}
          <select
            value={newTrigger}
            onChange={e => setNewTrigger(e.target.value as 'click' | 'load' | 'stateChange')}
            className="w-full px-2 py-1 text-xs border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none"
          >
            <option value="click">On Button Click</option>
            <option value="load">On Page Load</option>
            <option value="stateChange">On State Change</option>
          </select>

          {/* Tool search */}
          <input
            type="text"
            value={toolSearch}
            onChange={e => setToolSearch(e.target.value)}
            placeholder="Search tools..."
            className="w-full px-2 py-1.5 text-xs border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none"
            autoFocus
          />

          {/* Tool list */}
          <div className="max-h-48 overflow-y-auto scrollbar-minimal space-y-0.5">
            {filteredTools.length === 0 && (
              <div className="text-[10px] uib-fg-faint text-center py-2">No tools match "{toolSearch}"</div>
            )}
            {filteredTools.map(tool => (
              <button
                key={tool.name}
                onClick={() => addToolAction(tool)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-emerald-500/15 transition-colors group"
              >
                <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                  tool.kind === 'cloud' ? 'bg-sky-50 text-sky-600' : 'uib-surface-2 uib-fg-muted'
                }`}>
                  {tool.kind === 'cloud' ? 'cloud' : 'local'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-medium uib-fg truncate group-hover:text-emerald-400">{tool.label}</div>
                  <div className="text-[9px] uib-fg-faint font-mono truncate">{tool.name}</div>
                </div>
              </button>
            ))}
          </div>

          {!toolSearch && (
            <div className="text-[9px] uib-fg-faint text-center">
              {ALL_TOOLS.length} tools available — type to search
            </div>
          )}
        </div>
      )}

      {toolActions.length === 0 && !showAdd && (
        <div className="text-xs uib-fg-faint text-center py-3">
          No tool actions yet. Add one to call tools from your UI.
        </div>
      )}

      <div className="flex flex-col gap-1">
        {toolActions.map(action => {
          const isExpanded = expandedId === action.id;
          return (
            <div key={action.id} className="uib-surface border uib-border rounded-md overflow-hidden">
              {/* Header */}
              <div
                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer uib-hover transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : action.id)}
              >
                <span className={`text-[9px] font-mono px-1 py-0.5 rounded shrink-0 ${
                  action.trigger === 'click' ? 'bg-emerald-500/15 text-emerald-400'
                  : action.trigger === 'load' ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-blue-500/15 text-blue-400'
                }`}>
                  {action.trigger}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium uib-fg truncate">{action.name}</div>
                  <div className="text-[10px] uib-fg-faint font-mono truncate">{action.toolName}</div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(action.id); }}
                  className="uib-fg-faint hover:text-red-400 text-xs p-0.5 rounded hover:bg-red-500/15 transition-colors"
                  title="Delete action"
                >
                  ✕
                </button>
              </div>

              {/* Expanded config */}
              {isExpanded && (
                <div className="px-2 pb-2 pt-1 border-t uib-border-subtle flex flex-col gap-2">
                  {/* Args */}
                  <div className="text-[10px] font-semibold uib-fg-muted uppercase">Arguments</div>
                  {Object.keys(action.args).length === 0 && (
                    <div className="text-[10px] uib-fg-faint">No arguments needed</div>
                  )}
                  {Object.entries(action.args).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-1">
                      <label className="text-[10px] uib-fg-muted w-16 shrink-0 text-right truncate" title={key}>{key}:</label>
                      <input
                        type="text"
                        value={String(value ?? '')}
                        onChange={e => handleArgChange(action.id, key, e.target.value)}
                        placeholder={`$state.varName or value`}
                        className="flex-1 px-1.5 py-0.5 text-[11px] border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none font-mono"
                      />
                      <button
                        onClick={() => {
                          const newArgs = { ...action.args };
                          delete newArgs[key];
                          handleUpdate(action.id, { args: newArgs });
                        }}
                        className="uib-fg-faint hover:text-red-400 text-[10px] shrink-0"
                        title="Remove arg"
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  {/* Add custom arg */}
                  <AddArgRow onAdd={(key) => handleArgChange(action.id, key, '')} />

                  {/* Result binding */}
                  <div className="text-[10px] font-semibold uib-fg-muted uppercase mt-1">Result Binding</div>
                  <div className="flex items-center gap-1">
                    <label className="text-[10px] uib-fg-muted w-16 shrink-0 text-right">Store in:</label>
                    <select
                      value={action.resultVar || ''}
                      onChange={e => handleUpdate(action.id, { resultVar: e.target.value || undefined })}
                      className="flex-1 px-1.5 py-0.5 text-[11px] border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none"
                    >
                      <option value="">— none —</option>
                      {stateVariables.map(v => (
                        <option key={v.id} value={v.name}>{v.name} ({v.type})</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[10px] uib-fg-muted w-16 shrink-0 text-right">Loading:</label>
                    <select
                      value={action.loadingVar || ''}
                      onChange={e => handleUpdate(action.id, { loadingVar: e.target.value || undefined })}
                      className="flex-1 px-1.5 py-0.5 text-[11px] border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none"
                    >
                      <option value="">— none —</option>
                      {stateVariables.filter(v => v.type === 'boolean').map(v => (
                        <option key={v.id} value={v.name}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-[10px] uib-fg-muted w-16 shrink-0 text-right">Error:</label>
                    <select
                      value={action.errorVar || ''}
                      onChange={e => handleUpdate(action.id, { errorVar: e.target.value || undefined })}
                      className="flex-1 px-1.5 py-0.5 text-[11px] border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none"
                    >
                      <option value="">— none —</option>
                      {stateVariables.filter(v => v.type === 'string').map(v => (
                        <option key={v.id} value={v.name}>{v.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Trigger config for click — select which element triggers this */}
                  {action.trigger === 'click' && (
                    <>
                      <div className="text-[10px] font-semibold uib-fg-muted uppercase mt-1">Trigger Element</div>
                      {clickableElements.length === 0 ? (
                        <div className="text-[10px] text-amber-400 bg-amber-500/15 px-2 py-1.5 rounded border border-amber-500/30">
                          No elements with an <code className="font-mono bg-amber-500/15 px-1 rounded">id</code> found. Give your button an ID in the Actions/Content panel first.
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <label className="text-[10px] uib-fg-muted w-16 shrink-0 text-right">Button:</label>
                          <select
                            value={action.triggerConfig?.elementId || ''}
                            onChange={e => handleUpdate(action.id, {
                              triggerConfig: { ...action.triggerConfig, elementId: e.target.value || undefined }
                            })}
                            className="flex-1 px-1.5 py-0.5 text-[11px] border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none"
                          >
                            <option value="">Select element...</option>
                            {clickableElements.map(el => {
                              const taken = wiredElementIds.has(el.id) && action.triggerConfig?.elementId !== el.id;
                              return (
                                <option key={el.id} value={el.id} disabled={taken}>
                                  {el.label}{taken ? ' (already wired)' : ''}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      )}
                      {action.triggerConfig?.elementId && (
                        <div className="text-[9px] text-emerald-400 bg-emerald-500/15 px-2 py-1 rounded">
                          Clicking <code className="font-mono">#{action.triggerConfig.elementId}</code> will call <code className="font-mono">{action.toolName}</code>
                        </div>
                      )}
                    </>
                  )}

                  {/* Trigger config for stateChange */}
                  {action.trigger === 'stateChange' && (
                    <>
                      <div className="text-[10px] font-semibold uib-fg-muted uppercase mt-1">Trigger Config</div>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] uib-fg-muted w-16 shrink-0 text-right">Watch:</label>
                        <select
                          value={action.triggerConfig?.stateVar || ''}
                          onChange={e => handleUpdate(action.id, {
                            triggerConfig: { ...action.triggerConfig, stateVar: e.target.value || undefined }
                          })}
                          className="flex-1 px-1.5 py-0.5 text-[11px] border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none"
                        >
                          <option value="">Select variable...</option>
                          {stateVariables.map(v => (
                            <option key={v.id} value={v.name}>{v.name}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Inline component for adding a custom arg key */
function AddArgRow({ onAdd }: { onAdd: (key: string) => void }) {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="text-[10px] text-emerald-400 hover:text-emerald-400 self-start"
      >
        + custom arg
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder="arg name"
        className="flex-1 px-1.5 py-0.5 text-[11px] border uib-border rounded uib-surface focus:border-emerald-400 focus:outline-none font-mono"
        autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter' && key.trim()) {
            onAdd(key.trim());
            setKey('');
            setShow(false);
          }
          if (e.key === 'Escape') setShow(false);
        }}
      />
      <button
        onClick={() => { if (key.trim()) { onAdd(key.trim()); setKey(''); setShow(false); } }}
        className="text-[10px] text-emerald-400 hover:text-emerald-400"
      >
        Add
      </button>
    </div>
  );
}
