/**
 * WireInspectorPanel - Right panel for editing selected wire properties (conditions, loops)
 */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { X, ArrowRight, GitBranch, Info, Repeat, RotateCw, List, Trash2, LogOut, ChevronDown, Check, Radio } from "lucide-react";
import { TextInputWithVariables, type UpstreamNode } from "./SmartArgEditor";
import { getToolOutputs } from "../constants/tool-schemas";
import type { DesignerModel, DesignerWire, WorkflowVariable } from "../types";
import { parseGuard, guardToString } from "../builder/guards";
import { STREAM_CAPABLE_TOOLS } from "./WorkflowNodeCard";
import { isBackEdge as isBackEdgeCycle } from "../utils/graphUtils";

// Back edge (cycle) detection is in ../utils/graphUtils.ts

/** Styled dropdown to replace native selects */
function StyledSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  size = 'sm',
  searchable = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; group?: string; description?: string }>;
  placeholder?: string;
  size?: 'sm' | 'xs';
  searchable?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const selectedOption = options.find(o => o.value === value);

  // Filter then group options
  const groups = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? options.filter(o =>
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          (o.group || '').toLowerCase().includes(q) ||
          (o.description || '').toLowerCase().includes(q)
        )
      : options;
    const grouped = new Map<string, typeof options>();
    for (const opt of filtered) {
      const g = opt.group || '';
      if (!grouped.has(g)) grouped.set(g, []);
      grouped.get(g)!.push(opt);
    }
    return grouped;
  }, [options, search]);

  // Reset & focus search when opening
  React.useEffect(() => {
    if (open) {
      setSearch('');
      if (searchable) {
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    }
  }, [open, searchable]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sizeClasses = size === 'xs'
    ? 'px-2 py-1.5 text-[11px]'
    : 'px-3 py-2 text-xs';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full ${sizeClasses} border wf-border-subtle rounded-lg wf-bg-overlay wf-hover-bg flex items-center justify-between gap-2 transition-all shadow-sm font-medium`}
      >
        <span className={selectedOption ? 'wf-fg' : 'wf-fg-faint font-normal'}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 wf-fg-faint transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 w-full mt-1 rounded-xl shadow-xl max-h-72 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-150 wf-menu">
          {searchable && (
            <div className="p-1.5 border-b wf-border-subtle wf-bg-overlay sticky top-0 z-10">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search variables…"
                className="w-full px-2 py-1.5 text-[11px] border wf-border-subtle rounded-md wf-input wf-fg focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                onKeyDown={e => {
                  if (e.key === 'Escape') { setOpen(false); }
                }}
              />
            </div>
          )}
          <div className="overflow-y-auto p-1 flex-1">
            {Array.from(groups.entries()).length === 0 ? (
              <div className="px-3 py-4 text-xs wf-fg-faint text-center">No matches</div>
            ) : (
              Array.from(groups.entries()).map(([groupName, groupOpts]) => (
                <div key={groupName || '__ungrouped__'}>
                  {groupName && (
                    <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 bg-transparent wf-menu-header">
                      {groupName}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {groupOpts.map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { onChange(opt.value); setOpen(false); }}
                        className={`w-full px-2.5 py-2 text-left text-xs rounded-lg flex items-center justify-between gap-2 transition-colors mb-0.5 ${
                          opt.value === value
                            ? 'wf-accent-soft font-medium [color:var(--wf-accent)]'
                            : 'wf-menu-item'
                        }`}
                      >
                        <span className="flex flex-col items-start min-w-0">
                          <span className="truncate w-full">{opt.label}</span>
                          {opt.description && (
                            <span className="text-[10px] wf-fg-faint truncate w-full">{opt.description}</span>
                          )}
                        </span>
                        {opt.value === value && <Check className="w-3.5 h-3.5 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface WireInspectorPanelProps {
  model: DesignerModel;
  wireIndex: number;
  onUpdate: (m: DesignerModel) => void;
  onDelete: () => void;
  onClose: () => void;
  onReconnect?: (end: 'from' | 'to') => void;
}

// Find all upstream nodes by tracing wires backwards
function getUpstreamNodes(model: DesignerModel, nodeId: string): UpstreamNode[] {
  const visited = new Set<string>();
  const result: UpstreamNode[] = [];

  function traverse(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const incomingWires = model.wires?.filter(w => w.to === id) || [];
    for (const wire of incomingWires) {
      const sourceId = wire.from;
      const trigger = model.triggers.find(t => t.id === sourceId);
      if (trigger) {
        result.push({
          id: trigger.id,
          label: trigger.label || trigger.type || 'Trigger',
          tool: trigger.type,
          isTrigger: true,
          inputParams: trigger.inputParams || [],
        });
        continue;
      }
      const node = model.nodes.find(n => n.id === sourceId);
      if (node) {
        result.push({ id: node.id, label: node.label || node.tool || 'Step', tool: node.tool });
        traverse(sourceId);
      }
    }
  }

  traverse(nodeId);
  return result;
}

export function WireInspectorPanel({ model, wireIndex, onUpdate, onDelete, onClose, onReconnect }: WireInspectorPanelProps) {
  const safeWires: DesignerWire[] = Array.isArray((model as any)?.wires) ? ((model as any).wires as DesignerWire[]) : [];
  const wire = safeWires[wireIndex];
  
  if (!wire) {
    return (
      <div className="flex flex-col h-full w-full wf-bg-overlay">
        <div className="h-14 px-5 border-b wf-border-subtle flex items-center justify-between shrink-0 wf-bg-overlay">
          <span className="font-semibold wf-fg">Wire Properties</span>
          <button onClick={onClose} className="p-2 wf-hover-bg rounded-full wf-fg-faint hover:wf-fg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center wf-fg-faint">
          Wire not found
        </div>
      </div>
    );
  }

  // Get source and target nodes
  const sourceNode = [...model.triggers, ...model.nodes].find(n => n.id === wire.from);
  const targetNode = [...model.triggers, ...model.nodes].find(n => n.id === wire.to);

  // Detect if this wire creates an actual cycle (x→y→...→x)
  const isBackEdge = useMemo(() => {
    return isBackEdgeCycle(wire.from, wire.to, safeWires);
  }, [safeWires, wire.from, wire.to]);

  // Get upstream nodes for variable suggestions (from source node's perspective)
  const upstreamNodes = useMemo(() => {
    if (!wire.from) return [];
    // Include source node itself
    const source = model.nodes.find(n => n.id === wire.from);
    const trigger = model.triggers.find(t => t.id === wire.from);
    const sourceItem = source || trigger;

    const upstream = getUpstreamNodes(model, wire.from);
    if (sourceItem) {
      const tool = 'tool' in sourceItem ? sourceItem.tool : (trigger ? (trigger as any).type : undefined);
      const isTrigger = !!trigger;
      upstream.unshift({
        id: sourceItem.id,
        label: sourceItem.label || (tool || (sourceItem as any).type) || 'Source',
        tool: tool || (isTrigger ? (trigger as any).type : undefined),
        isTrigger,
        inputParams: isTrigger ? (trigger?.inputParams || []) : undefined,
      });
    }
    return upstream;
  }, [model, wire.from]);

  const updateWire = (updates: Partial<DesignerWire>) => {
    const newWires = [...safeWires];
    newWires[wireIndex] = { ...newWires[wireIndex], ...updates };
    onUpdate({ ...model, wires: newWires });
  };

  return (
    <div className="flex flex-col h-full w-full wf-bg-overlay">
      {/* Header */}
      <div className="h-14 px-5 border-b wf-border-subtle flex items-center justify-between shrink-0 wf-bg-overlay">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg wf-accent-soft [color:var(--wf-accent)]">
            <ArrowRight className="w-4 h-4" />
          </div>
          <span className="font-semibold wf-fg">Connection</span>
        </div>
        <button
          onClick={onClose}
          className="p-2 wf-hover-bg rounded-full wf-fg-faint hover:wf-fg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-minimal p-5 space-y-6">
        {/* Connection Info with Reconnect Buttons */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 wf-bg-overlay rounded-xl border wf-border-subtle">
            <div className="flex-1 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider wf-fg-faint mb-1">From</div>
              <div className="text-sm font-medium wf-fg">{sourceNode?.label || wire.from}</div>
              <div className="text-[10px] wf-fg-faint font-mono">#{wire.from}</div>
            </div>
            <ArrowRight className="w-5 h-5 wf-fg-faint" />
            <div className="flex-1 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider wf-fg-faint mb-1">To</div>
              <div className="text-sm font-medium wf-fg">{targetNode?.label || wire.to}</div>
              <div className="text-[10px] wf-fg-faint font-mono">#{wire.to}</div>
            </div>
          </div>
          
          {/* Quick Reconnect Buttons */}
          {onReconnect && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onReconnect('from')}
                className="py-2.5 px-3 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 hover:border-amber-300 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Change Source
              </button>
              <button
                onClick={() => onReconnect('to')}
                className="py-2.5 px-3 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 hover:border-amber-300 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                Change Target
              </button>
            </div>
          )}
        </div>

        {/* Loop Configuration */}
        <WireLoopSection
          wire={wire}
          onUpdate={updateWire}
          upstreamNodes={upstreamNodes}
          workflowVariables={model.variables}
          isBackEdge={isBackEdge}
          model={model}
        />

        {/* Loop Break - End loop scope */}
        <LoopBreakSection
          wire={wire}
          onUpdate={updateWire}
          model={model}
        />

        {/* Stream Wire Configuration — only shown when source can stream */}
        <StreamWireSection
          wire={wire}
          onUpdate={updateWire}
          model={model}
        />

        {/* Condition Configuration */}
        <WireConditionSection
          wire={wire}
          onUpdate={updateWire}
          upstreamNodes={upstreamNodes}
          workflowVariables={model.variables}
        />

        {/* Delete Button */}
        <div className="pt-4">
          <button
            onClick={onDelete}
            className="w-full py-3 text-sm font-medium text-red-600 hover:bg-red-50 border border-red-100 hover:border-red-200 rounded-xl transition-all flex items-center justify-center gap-2 group"
          >
            <Trash2 className="w-4 h-4 transition-transform group-hover:scale-110" />
            Delete Connection
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * WireLoopSection - Configure loop behavior for a wire
 */
function WireLoopSection({
  wire,
  onUpdate,
  upstreamNodes,
  workflowVariables,
  isBackEdge = false,
  model
}: {
  wire: DesignerWire;
  onUpdate: (updates: Partial<DesignerWire>) => void;
  upstreamNodes: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
  isBackEdge?: boolean;
  model: DesignerModel;
}) {
  const hasLoop = !!(wire as any).loop;
  const loopType = (wire as any).loop?.type || 'repeat'; // Default to repeat for back edges

  // Check if there's a sibling wire from the same source that has a loop
  const hasOutgoingLoopFromSameNode = React.useMemo(() => {
    const wires = model.wires || [];
    return wires.some(w => w.from === wire.from && w.to !== wire.to && (w as any).loop && (w as any).loop.type);
  }, [model.wires, wire.from, wire.to]);

  const fanoutMode = ((wire as any).loopFanoutMode === 'parallel' ? 'parallel' : 'wait') as 'wait' | 'parallel';

  // Auto-configure loop for back edges that don't have a loop yet
  React.useEffect(() => {
    if (isBackEdge && !hasLoop) {
      // Auto-set to repeat loop with default 5 iterations
      onUpdate({ 
        loop: { 
          type: 'repeat', 
          count: 5, 
          maxIterations: 100, 
          delayMs: 0 
        } 
      } as any);
    }
  }, [isBackEdge, hasLoop]);

  const handleLoopTypeChange = (newType: string) => {
    if (newType === 'none') {
      onUpdate({ loop: undefined } as any);
    } else {
      const baseLoop = {
        type: newType as 'forEach' | 'while' | 'repeat',
        maxIterations: 100,
        delayMs: 0,
      };
      
      if (newType === 'forEach') {
        onUpdate({ loop: { ...baseLoop, items: '', itemVar: 'item', indexVar: 'index' } } as any);
      } else if (newType === 'repeat') {
        onUpdate({ loop: { ...baseLoop, count: 5 } } as any);
      } else if (newType === 'while') {
        onUpdate({ loop: { ...baseLoop, conditionText: '' } } as any);
      }
    }
  };

  const updateLoopField = (field: string, value: any) => {
    onUpdate({ loop: { ...(wire as any).loop, [field]: value } } as any);
  };

  const LoopIcon = loopType === 'forEach' ? List : loopType === 'repeat' ? Repeat : RotateCw;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold wf-fg">Loop</span>
        {isBackEdge && (
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 rounded-full">
            Back Edge Detected
          </span>
        )}
        <div className="h-px wf-bg-overlay flex-1" />
      </div>

      {/* Back edge info banner */}
      {isBackEdge && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-2">
            <RotateCw className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-amber-800">This connection creates a loop</p>
              <p className="text-[11px] text-amber-600 mt-0.5">Configure how many times the loop should repeat below.</p>
            </div>
          </div>
        </div>
      )}

      <div className={`rounded-xl p-4 border transition-colors ${hasLoop ? 'bg-blue-50/50 border-blue-200' : isBackEdge ? 'bg-amber-50/50 border-amber-200' : 'wf-bg-overlay wf-border-subtle'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasLoop ? 'bg-blue-100 text-blue-600' : 'wf-bg-overlay wf-fg-faint'}`}>
              <LoopIcon className="w-4 h-4" />
            </div>
            <div>
              <div className={`text-sm font-medium ${hasLoop ? 'text-blue-700' : 'wf-fg-muted'}`}>
                {hasLoop ? (loopType === 'forEach' ? 'For Each Item' : loopType === 'repeat' ? 'Repeat N Times' : 'While Condition') : 'No Loop'}
              </div>
              <div className="text-[10px] wf-fg-faint">
                {hasLoop ? 'Target node runs multiple times' : 'Target node runs once'}
              </div>
            </div>
          </div>
          <div className="w-28">
            <StyledSelect
              value={hasLoop ? loopType : 'none'}
              onChange={handleLoopTypeChange}
              size="xs"
              options={[
                { value: 'none', label: 'No Loop' },
                { value: 'forEach', label: 'For Each' },
                { value: 'repeat', label: 'Repeat N' },
                { value: 'while', label: 'While' },
              ]}
            />
          </div>
        </div>

        {hasLoop && (
          <div className="space-y-3 pt-3 border-t border-blue-100/50">
            {/* For Each Loop */}
            {loopType === 'forEach' && (
              <>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1.5 block">
                    Items to iterate
                  </label>
                  <TextInputWithVariables
                    value={(wire as any).loop?.items || ''}
                    onChange={(v: string) => updateLoopField('items', v)}
                    placeholder="{{step.results}} or [1, 2, 3]"
                    upstreamNodes={upstreamNodes}
                    workflowVariables={workflowVariables}
                    suggestFrom={['*.*']}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1.5 block">
                      Item variable
                    </label>
                    <input
                      type="text"
                      value={(wire as any).loop?.itemVar || 'item'}
                      onChange={(e) => updateLoopField('itemVar', e.target.value)}
                      placeholder="item"
                      className="w-full px-3 py-2 text-sm border wf-border-subtle rounded-lg wf-bg-overlay focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1.5 block">
                      Index variable
                    </label>
                    <input
                      type="text"
                      value={(wire as any).loop?.indexVar || 'index'}
                      onChange={(e) => updateLoopField('indexVar', e.target.value)}
                      placeholder="index"
                      className="w-full px-3 py-2 text-sm border wf-border-subtle rounded-lg wf-bg-overlay focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 font-mono"
                    />
                  </div>
                </div>
                <div className="p-2.5 bg-blue-100/50 rounded-lg">
                  <p className="text-[11px] text-blue-700">
                    Access current item as <code className="wf-bg-overlay px-1.5 py-0.5 rounded font-mono text-blue-600">{'{{loop.' + ((wire as any).loop?.itemVar || 'item') + '}}'}</code>
                  </p>
                </div>
              </>
            )}

            {/* Repeat N Times */}
            {loopType === 'repeat' && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1.5 block">
                  Number of times
                </label>
                <input
                  type="number"
                  value={(wire as any).loop?.count || 5}
                  onChange={(e) => updateLoopField('count', parseInt(e.target.value) || 1)}
                  min={1}
                  max={10000}
                  className="w-full px-3 py-2 text-sm border wf-border-subtle rounded-lg wf-bg-overlay focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                />
                <p className="text-[11px] wf-fg-muted mt-1.5">
                  Access iteration as <code className="wf-bg-overlay px-1.5 py-0.5 rounded font-mono wf-fg-muted">{'{{loop.index}}'}</code>
                </p>
              </div>
            )}

            {/* While Loop */}
            {loopType === 'while' && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1.5 block">
                  Continue while
                </label>
                <TextInputWithVariables
                  value={(wire as any).loop?.conditionText || ''}
                  onChange={(v: string) => updateLoopField('conditionText', v)}
                  placeholder="{{workflow.counter}} < 10"
                  upstreamNodes={upstreamNodes}
                  workflowVariables={workflowVariables}
                  suggestFrom={['*.*']}
                />
                <p className="text-[11px] wf-fg-muted mt-1.5">Loop continues while this condition is true</p>
              </div>
            )}

            {/* Common Loop Settings */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1.5 block">
                  Max iterations
                </label>
                <input
                  type="number"
                  value={(wire as any).loop?.maxIterations || 100}
                  onChange={(e) => updateLoopField('maxIterations', parseInt(e.target.value) || 100)}
                  min={1}
                  max={10000}
                  className="w-full px-3 py-2 text-sm border wf-border-subtle rounded-lg wf-bg-overlay focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1.5 block">
                  Delay (ms)
                </label>
                <input
                  type="number"
                  value={(wire as any).loop?.delayMs || 0}
                  onChange={(e) => updateLoopField('delayMs', parseInt(e.target.value) || 0)}
                  min={0}
                  className="w-full px-3 py-2 text-sm border wf-border-subtle rounded-lg wf-bg-overlay focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                />
              </div>
            </div>
          </div>
        )}

        {/* Loop Fanout Mode - shown for non-loop wires when sibling has loop */}
        {!hasLoop && hasOutgoingLoopFromSameNode && (
          <div className="pt-3 border-t border-slate-200/50">
            <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1.5 block">
              When sibling loop is active
            </label>
            <StyledSelect
              value={fanoutMode}
              onChange={(v) => onUpdate({ loopFanoutMode: v as any })}
              size="xs"
              options={[
                { value: 'wait', label: 'Wait for loop to finish' },
                { value: 'parallel', label: 'Run in parallel with loop' },
              ]}
            />
            <p className="text-[10px] wf-fg-faint mt-1.5">
              {fanoutMode === 'wait' 
                ? 'This connection will execute after the loop completes all iterations'
                : 'This connection will execute immediately, in parallel with the loop'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * WireConditionSection - Configure condition for a wire
 */
function WireConditionSection({
  wire,
  onUpdate,
  upstreamNodes,
  workflowVariables
}: {
  wire: DesignerWire;
  onUpdate: (updates: Partial<DesignerWire>) => void;
  upstreamNodes: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
}) {
  const isConditional = wire.guard && wire.guard !== 'always';
  const [editorMode, setEditorMode] = useState<'builder' | 'advanced'>('builder');

  // Parse guard to extract builder fields
  const parseGuardToBuilder = useCallback((g: any): { lhs: string; op: string; rhs: string } | null => {
    if (!g || g === 'always') return null;
    let raw = (g && typeof g === 'object' && 'if' in g) ? (g as any).if : g;

    // String expression (e.g. "step_1.ok == true") — parse to JSON Logic first
    if (typeof raw === 'string') {
      try {
        const parsed = parseGuard(raw);
        if (!parsed || parsed === 'always') return null;
        // parseGuard may wrap in { if: ... }, unwrap it
        raw = (typeof parsed === 'object' && 'if' in parsed) ? parsed.if : parsed;
      } catch {
        return null;
      }
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const op = Object.keys(raw)[0];

    // Handle unary operators (empty / not_empty) — no RHS
    if (op === 'empty' || op === 'not_empty') {
      const inner = Array.isArray((raw as any)[op]) ? (raw as any)[op][0] : (raw as any)[op];
      if (inner && typeof inner === 'object' && 'var' in inner && typeof inner.var === 'string') {
        return { lhs: inner.var as string, op, rhs: '' };
      }
      return null;
    }

    if (!op || !['==', '!=', '>', '>=', '<', '<=', 'in'].includes(op)) return null;
    const val = (raw as any)[op];
    if (!Array.isArray(val) || val.length < 2) return null;
    const left = val[0];
    const right = val[1];
    if (!left || typeof left !== 'object' || !('var' in left) || typeof left.var !== 'string') return null;
    const lhs = left.var as string;

    if (right && typeof right === 'object' && 'var' in right && typeof (right as any).var === 'string') {
      return { lhs, op, rhs: `{{${(right as any).var}}}` };
    }

    if (typeof right === 'string') return { lhs, op, rhs: right };
    if (typeof right === 'number' || typeof right === 'boolean') return { lhs, op, rhs: String(right) };
    if (right === null) return { lhs, op, rhs: 'null' };
    if (right === undefined) return { lhs, op, rhs: '' };
    // For any other type (array, object without var), try to stringify
    try {
      return { lhs, op, rhs: JSON.stringify(right) };
    } catch {
      return { lhs, op, rhs: '' };
    }
  }, []);

  // Parse guard into builder fields - key is using wire.guard directly, not memoized
  const [builderLhs, setBuilderLhs] = useState<string>('');
  const [builderOp, setBuilderOp] = useState<string>('==');
  const [builderRhs, setBuilderRhs] = useState<string>('');
  const [localText, setLocalText] = useState('');

  // Sync builder state when wire.guard changes - this is the critical fix
  // Using a ref to track the previous guard to detect actual changes
  const prevGuardRef = React.useRef<any>(null);
  
  useEffect(() => {
    // Always sync when guard changes (compare by JSON to handle object guards)
    const currentGuardStr = JSON.stringify(wire.guard);
    const prevGuardStr = JSON.stringify(prevGuardRef.current);
    
    if (currentGuardStr !== prevGuardStr) {
      prevGuardRef.current = wire.guard;
      
      const parsed = parseGuardToBuilder(wire.guard);
      if (parsed) {
        setBuilderLhs(parsed.lhs);
        setBuilderOp(parsed.op);
        setBuilderRhs(parsed.rhs);
        setEditorMode('builder');
      } else if (wire.guard && wire.guard !== 'always') {
        // Complex guard (and/or/etc.) — can't display in builder, use advanced
        setBuilderLhs('');
        setBuilderOp('==');
        setBuilderRhs('');
        setEditorMode('advanced');
      } else {
        setBuilderLhs('');
        setBuilderOp('==');
        setBuilderRhs('');
      }
      
      // Update text for advanced mode
      const guardStr = guardToString(wire.guard);
      setLocalText(guardStr === 'always' ? '' : guardStr);
    }
  }, [wire.guard, parseGuardToBuilder]);
  
  // Also sync on initial mount
  useEffect(() => {
    const parsed = parseGuardToBuilder(wire.guard);
    if (parsed) {
      setBuilderLhs(parsed.lhs);
      setBuilderOp(parsed.op);
      setBuilderRhs(parsed.rhs);
    } else if (wire.guard && wire.guard !== 'always') {
      // Complex guard — auto-switch to advanced mode
      setEditorMode('advanced');
    }
    const guardStr = guardToString(wire.guard);
    setLocalText(guardStr === 'always' ? '' : guardStr);
    prevGuardRef.current = wire.guard;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build operand options
  const operandOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string; group: string; description?: string }> = [];
    if (Array.isArray(workflowVariables) && workflowVariables.length) {
      for (const v of workflowVariables) {
        if (!v?.name) continue;
        opts.push({
          value: `workflow.${v.name}`,
          label: `workflow.${v.name}`,
          group: 'Workflow Variables',
          description: v.description,
        });
      }
    }
    for (const n of upstreamNodes) {
      if (n.isTrigger) {
        // Triggers expose data at ctx.trigger.data.* — not ctx.<triggerId>.*
        opts.push({
          value: 'trigger.data',
          label: 'trigger.data',
          group: `Trigger — ${n.label}`,
          description: 'Full trigger payload',
        });
        // User-defined input params (workflow-as-function)
        for (const p of n.inputParams || []) {
          if (!p?.name) continue;
          opts.push({
            value: `trigger.data.${p.name}`,
            label: `trigger.data.${p.name}`,
            group: `Trigger — ${n.label}`,
            description: p.description || (p.type ? `Input param (${p.type})` : 'Input param'),
          });
        }
        // Static tool outputs (e.g. gmail.new_email → from, subject, …)
        const outputs = n.tool ? getToolOutputs(n.tool) : [];
        for (const f of outputs) {
          opts.push({
            value: `trigger.data.${f}`,
            label: `trigger.data.${f}`,
            group: `Trigger — ${n.label}`,
            description: `Trigger output`,
          });
        }
      } else {
        const outputs = n.tool ? getToolOutputs(n.tool) : ['ok', 'result'];
        opts.push({ value: n.id, label: n.id, group: `Step — ${n.label}` });
        for (const f of outputs) {
          opts.push({ value: `${n.id}.${f}`, label: `${n.id}.${f}`, group: `Step — ${n.label}` });
        }
      }
    }
    return opts;
  }, [workflowVariables, upstreamNodes]);

  const parseRhsValue = useCallback((s: string): any => {
    const t = String(s || '').trim();
    if (t.startsWith('{{') && t.endsWith('}}')) return { var: t.slice(2, -2).trim() };
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (t && !Number.isNaN(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return t;
  }, []);

  const handleModeChange = (mode: string) => {
    if (mode === 'always') {
      onUpdate({ guard: 'always' });
      setBuilderLhs('');
      setBuilderOp('==');
      setBuilderRhs('');
      setLocalText('');
      setEditorMode('builder');
    } else {
      const firstVar = Array.isArray(workflowVariables) && workflowVariables[0]?.name
        ? `workflow.${workflowVariables[0].name}`
        : operandOptions[0]?.value || '';

      setBuilderLhs(firstVar);
      setBuilderOp('==');
      setBuilderRhs('');
      setLocalText('');
      setEditorMode('builder');

      onUpdate({
        guard: {
          if: {
            '==': [{ var: firstVar }, '']
          }
        }
      });
    }
  };

  const handleBuilderChange = useCallback((field: 'lhs' | 'op' | 'rhs', value: string) => {
    const newLhs = field === 'lhs' ? value : builderLhs;
    const newOp = field === 'op' ? value : builderOp;
    const newRhs = field === 'rhs' ? value : builderRhs;

    if (field === 'lhs') setBuilderLhs(value);
    if (field === 'op') setBuilderOp(value);
    if (field === 'rhs') setBuilderRhs(value);

    if (newLhs) {
      // Unary operators (empty/not_empty) don't use RHS
      if (newOp === 'empty' || newOp === 'not_empty') {
        const logic = { if: { [newOp]: [{ var: newLhs }] } };
        onUpdate({ guard: logic });
      } else {
        const logic = { if: { [newOp]: [{ var: newLhs }, parseRhsValue(newRhs)] } };
        onUpdate({ guard: logic });
      }
    }
  }, [builderLhs, builderOp, builderRhs, onUpdate, parseRhsValue]);

  const handleTextChange = useCallback((text: string) => {
    setLocalText(text);
    if (!text.trim()) {
      onUpdate({ guard: 'always' });
    } else {
      const parsed = parseGuard(text);
      if (parsed) onUpdate({ guard: parsed });
    }
  }, [onUpdate]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold wf-fg">Condition</span>
        <div className="h-px wf-bg-overlay flex-1" />
      </div>

      <div className={`rounded-xl p-4 border transition-colors ${isConditional ? 'bg-amber-50/50 border-amber-200' : 'wf-bg-overlay wf-border-subtle'}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isConditional ? 'bg-amber-100 text-amber-600' : 'wf-bg-overlay wf-fg-faint'}`}>
              <GitBranch className="w-4 h-4" />
            </div>
            <div>
              <div className={`text-sm font-medium ${isConditional ? 'text-amber-700' : 'wf-fg-muted'}`}>
                {isConditional ? 'Conditional' : 'Always Run'}
              </div>
              <div className="text-[10px] wf-fg-faint">
                {isConditional ? 'Runs only if condition is met' : 'Always executes this connection'}
              </div>
            </div>
          </div>
          <div className="w-24">
            <StyledSelect
              value={isConditional ? 'conditional' : 'always'}
              onChange={handleModeChange}
              size="xs"
              options={[
                { value: 'always', label: 'Always' },
                { value: 'conditional', label: 'If...' },
              ]}
            />
          </div>
        </div>

        {isConditional && (
          <div className="space-y-3 pt-3 border-t border-amber-100/50">
            {/* Mode Toggle */}
            <div className="flex items-center gap-1 wf-bg-overlay border wf-border-subtle rounded-lg p-1 w-fit">
              <button
                onClick={() => setEditorMode('builder')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${editorMode === 'builder' ? 'bg-amber-500 text-white' : 'wf-fg-muted wf-hover-bg'}`}
              >
                Builder
              </button>
              <button
                onClick={() => { 
                  setEditorMode('advanced'); 
                  const guardStr = guardToString(wire.guard);
                  setLocalText(guardStr === 'always' ? '' : guardStr); 
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${editorMode === 'advanced' ? 'bg-amber-500 text-white' : 'wf-fg-muted wf-hover-bg'}`}
              >
                Advanced
              </button>
            </div>

            {editorMode === 'builder' ? (
              <div className="space-y-3">
                <div className={`grid gap-2 ${builderOp === 'empty' || builderOp === 'not_empty' ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1 block">Left</label>
                    <StyledSelect
                      value={builderLhs}
                      onChange={(v) => handleBuilderChange('lhs', v)}
                      placeholder="Select…"
                      size="xs"
                      searchable
                      options={[
                        // Include current value if not already in options
                        ...(builderLhs && !operandOptions.some(o => o.value === builderLhs)
                          ? [{ value: builderLhs, label: builderLhs, group: 'Current' }]
                          : []),
                        ...operandOptions
                      ]}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1 block">Op</label>
                    <StyledSelect
                      value={builderOp}
                      onChange={(v) => handleBuilderChange('op', v)}
                      size="xs"
                      options={[
                        { value: '==', label: 'Equals' },
                        { value: '!=', label: 'Not equals' },
                        { value: 'empty', label: 'Is empty' },
                        { value: 'not_empty', label: 'Is not empty' },
                        { value: '>', label: 'Greater' },
                        { value: '>=', label: 'Greater or equal' },
                        { value: '<', label: 'Less' },
                        { value: '<=', label: 'Less or equal' },
                      ]}
                    />
                  </div>

                  {/* RHS - hidden for unary operators */}
                  {builderOp !== 'empty' && builderOp !== 'not_empty' && (
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted mb-1 block">Right</label>
                    <TextInputWithVariables
                      value={builderRhs}
                      onChange={(v: string) => handleBuilderChange('rhs', v)}
                      placeholder="value"
                      upstreamNodes={upstreamNodes}
                      workflowVariables={workflowVariables}
                      suggestFrom={['*.*']}
                    />
                  </div>
                  )}
                </div>

                {/* Quick value buttons - hidden for unary operators */}
                {builderOp !== 'empty' && builderOp !== 'not_empty' && (
                <div className="flex gap-1.5">
                  {['true', 'false'].map(val => (
                    <button
                      key={val}
                      onClick={() => handleBuilderChange('rhs', val)}
                      className={`px-2.5 py-1 text-[10px] font-medium rounded-md border transition-colors ${
                        builderRhs === val
                          ? 'bg-amber-50 border-amber-200 text-amber-700'
                          : 'wf-bg-overlay wf-border-subtle wf-fg-muted hover:border-amber-200 hover:bg-amber-50/50'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
                )}

                {/* Preview */}
                <div className="flex items-center gap-2 px-3 py-2 wf-bg-overlay rounded-lg border wf-border-subtle">
                  <code className="text-[11px] font-mono wf-fg-muted">
                    {builderLhs
                      ? (builderOp === 'empty' || builderOp === 'not_empty'
                        ? `${builderLhs} ${builderOp === 'empty' ? 'is empty' : 'is not empty'}`
                        : `${builderLhs} ${builderOp} ${builderRhs || '?'}`)
                      : 'Select a variable...'}
                  </code>
                </div>
              </div>
            ) : (
              <>
                <TextInputWithVariables
                  value={localText}
                  onChange={handleTextChange}
                  placeholder="e.g. step.success == true"
                  upstreamNodes={upstreamNodes}
                  workflowVariables={workflowVariables}
                  suggestFrom={['*.*']}
                />
                <div className="flex items-center gap-1 text-[10px] wf-fg-faint">
                  <Info className="w-3 h-3" />
                  <span>Supports JS-like syntax: <code>==</code>, <code>!=</code>, <code>&gt;</code>, <code>&&</code></span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * LoopBreakSection - Mark this wire as ending a loop scope
 */
function LoopBreakSection({
  wire,
  onUpdate,
  model
}: {
  wire: DesignerWire;
  onUpdate: (updates: Partial<DesignerWire>) => void;
  model: DesignerModel;
}) {
  // Check if source node is inside an OPEN loop scope
  // A loop scope is "open" if there's an upstream loop wire that hasn't been closed by a loopBreak
  const isInsideLoop = useMemo(() => {
    const wires = model.wires || [];
    
    // Walk upstream from nodeId, tracking open loop depth
    // Returns the number of unclosed loop scopes at this node
    function countOpenLoops(nodeId: string, visited: Set<string>): number {
      if (visited.has(nodeId)) return 0;
      visited.add(nodeId);
      
      const incomingWires = wires.filter(w => w.to === nodeId);
      let maxOpenLoops = 0;
      
      for (const w of incomingWires) {
        // Get open loops from further upstream
        let openLoops = countOpenLoops(w.from, new Set(visited));
        
        // If this wire STARTS a loop, increment
        if ((w as any).loop) {
          openLoops++;
        }
        
        // If this wire BREAKS a loop, decrement (but not below 0)
        if ((w as any).loopBreak && openLoops > 0) {
          openLoops--;
        }
        
        maxOpenLoops = Math.max(maxOpenLoops, openLoops);
      }
      
      return maxOpenLoops;
    }
    
    return countOpenLoops(wire.from, new Set()) > 0;
  }, [model, wire.from]);

  const hasLoopBreak = !!(wire as any).loopBreak;

  // Only show this section if source node is inside a loop
  if (!isInsideLoop) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-orange-50 text-orange-500">
          <LogOut className="w-4 h-4" />
        </div>
        <div className="font-medium wf-fg">End Loop</div>
      </div>

      <div className="rounded-xl border wf-border-subtle overflow-hidden">
        <button
          onClick={() => onUpdate({ loopBreak: !hasLoopBreak } as any)}
          className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${
            hasLoopBreak 
              ? 'bg-orange-50 border-orange-200' 
              : 'wf-bg-overlay hover:wf-bg-overlay'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-10 h-5 rounded-full transition-colors relative ${
              hasLoopBreak ? 'bg-orange-500' : 'bg-slate-200'
            }`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full wf-bg-overlay shadow transition-all ${
                hasLoopBreak ? 'left-5' : 'left-0.5'
              }`} />
            </div>
            <span className="text-sm font-medium wf-fg">
              {hasLoopBreak ? 'Exit loop after this connection' : 'Continue in loop'}
            </span>
          </div>
        </button>
        
        {hasLoopBreak && (
          <div className="px-4 py-2.5 bg-orange-50/50 border-t border-orange-100">
            <div className="flex items-start gap-2 text-[11px] text-orange-700">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Nodes after this connection will run <strong>once</strong> after all loop iterations complete, 
                not on each iteration.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * StreamWireSection - Configure stream wire behavior
 */
function StreamWireSection({
  wire,
  onUpdate,
  model,
}: {
  wire: DesignerWire;
  onUpdate: (updates: Partial<DesignerWire>) => void;
  model: DesignerModel;
}) {
  // Find source node and check if it can actually produce a stream
  const sourceNode = [...model.triggers, ...model.nodes].find(n => n.id === wire.from);
  const sourceTool = sourceNode ? ('tool' in sourceNode ? (sourceNode as any).tool || '' : (sourceNode as any).type || '') : '';
  const sourceArgs = sourceNode && 'args' in sourceNode ? (sourceNode as any).args || {} : {};
  const isAlwaysStream = sourceTool === 'stream_create';
  const isStreamEnabled = STREAM_CAPABLE_TOOLS.has(sourceTool) && (sourceArgs.stream === true || sourceArgs.mode === 'stream');
  const canStream = isAlwaysStream || isStreamEnabled;

  const hasStream = !!(wire as any).stream;
  const sourceStepId = wire.from;

  // Don't render stream wire section if source can't stream
  if (!canStream && !hasStream) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-cyan-50 text-cyan-500">
          <Radio className="w-4 h-4" />
        </div>
        <div className="font-medium wf-fg">Stream Wire</div>
      </div>

      <div className="rounded-xl border wf-border-subtle overflow-hidden">
        <button
          onClick={() => {
            if (hasStream) {
              onUpdate({ stream: undefined } as any);
            } else {
              onUpdate({ stream: { sourceField: 'streamId', mode: 'reactive', format: 'ref' } } as any);
            }
          }}
          className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${
            hasStream 
              ? 'bg-cyan-50 border-cyan-200' 
              : 'wf-bg-overlay hover:wf-bg-overlay'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-10 h-5 rounded-full transition-colors relative ${
              hasStream ? 'bg-cyan-500' : 'bg-slate-200'
            }`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full wf-bg-overlay shadow transition-all ${
                hasStream ? 'left-5' : 'left-0.5'
              }`} />
            </div>
            <span className="text-sm font-medium wf-fg">
              {hasStream ? 'Stream wire enabled' : 'Enable stream wire'}
            </span>
          </div>
        </button>
        
        {hasStream && (
          <div className="px-4 py-3 bg-cyan-50/30 border-t border-cyan-100 space-y-3">
            <div className="flex items-start gap-2 text-[11px] text-cyan-700">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                The target step runs <strong>once per chunk</strong> as data streams in real-time from the source.
              </span>
            </div>

            {/* Stream format for video frames */}
            {(sourceTool === 'capture_media' || sourceArgs?.kind === 'video_frames') && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium wf-fg-muted uppercase tracking-wide">Video Frame Format</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    { value: 'base64', label: 'Base64', desc: 'Encodes frames as data URLs — compatible with all tools' },
                    { value: 'ref', label: 'Zero-Copy Ref', desc: 'Passes memory references — much faster for Python tools like MediaPipe' },
                  ] as const).map(opt => {
                    const currentFormat = (wire as any).stream?.format || 'base64';
                    const isSelected = currentFormat === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => {
                          onUpdate({ stream: { ...(wire as any).stream, format: opt.value } } as any);
                        }}
                        className={`px-3 py-2 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'border-cyan-300 bg-cyan-50 ring-1 ring-cyan-200'
                            : 'wf-border-subtle wf-bg-overlay wf-hover-bg hover:border-[var(--wf-border)]'
                        }`}
                      >
                        <div className={`text-[11px] font-semibold ${isSelected ? 'text-cyan-700' : 'wf-fg-muted'}`}>
                          {opt.value === 'ref' && <span className="inline-block mr-1">⚡</span>}
                          {opt.label}
                        </div>
                        <div className="text-[10px] wf-fg-faint mt-0.5 leading-snug">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
                {(wire as any).stream?.format === 'ref' && (
                  <div className="flex items-start gap-1.5 text-[10px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">
                    <span className="mt-0.5">⚠️</span>
                    <span>Zero-copy refs only work with Python tools (MediaPipe, custom scripts). Use Base64 if the target is a UI component.</span>
                  </div>
                )}
              </div>
            )}

            {/* How to access chunks */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium wf-fg-muted uppercase tracking-wide">Access Chunk Data</label>
              <div className="wf-bg-overlay rounded-lg border wf-border-subtle p-2.5 space-y-1.5">
                <div className="flex items-center gap-2 text-[11px]">
                  <code className="px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded font-mono text-[10px]">{`{{${sourceStepId}.text}}`}</code>
                  <span className="wf-fg-faint">Current chunk text</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <code className="px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded font-mono text-[10px]">{`{{${sourceStepId}.fullText}}`}</code>
                  <span className="wf-fg-faint">All text so far</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <code className="px-1.5 py-0.5 bg-cyan-50 text-cyan-700 rounded font-mono text-[10px]">{`{{${sourceStepId}.chunkIndex}}`}</code>
                  <span className="wf-fg-faint">Chunk position (0, 1, 2...)</span>
                </div>
              </div>
              <p className="text-[10px] wf-fg-faint">
                In Python scripts, use <code className="text-[10px] font-mono wf-bg-overlay px-1 rounded">stream_chunk</code> and <code className="text-[10px] font-mono wf-bg-overlay px-1 rounded">stream_chunk_index</code> variables.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

