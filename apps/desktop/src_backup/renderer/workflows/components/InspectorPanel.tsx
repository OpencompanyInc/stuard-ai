/**
 * InspectorPanel - Right panel for editing selected node properties
 * Redesigned for beginner-friendliness and Scratch-like UX
 */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { X, Settings, Trash2, ArrowRight, Sparkles, Info, ChevronDown, ChevronRight, Hash, Activity, GitBranch, GitMerge, FileText, Zap, Power } from "lucide-react";
import { ToolArgsEditor, TextInputWithVariables, type UpstreamNode } from "./SmartArgEditor";
import { getToolSchema, getToolOutputs } from "../constants/tool-schemas";
import { getToolIcon, getToolColor, CATEGORY_COLORS } from "../constants/paletteCategories";
import { parseGuard, guardToString } from "../builder/guards";
import { VariablesPanel } from "./VariablesPanel";
import type { DesignerModel, WorkflowVariable } from "../types";

interface InspectorPanelProps {
  model: DesignerModel;
  selectedNodeId: string;
  onUpdate: (m: DesignerModel) => void;
  onDelete: () => void;
  onClose: () => void;
}

// Find all upstream nodes by tracing wires backwards
function getUpstreamNodes(model: DesignerModel, nodeId: string): UpstreamNode[] {
  const visited = new Set<string>();
  const result: UpstreamNode[] = [];

  function traverse(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    // Find all wires that point TO this node
    const incomingWires = model.wires?.filter(w => w.to === id) || [];

    for (const wire of incomingWires) {
      const sourceId = wire.from;

      // Check if source is a trigger
      const trigger = model.triggers.find(t => t.id === sourceId);
      if (trigger) {
        result.push({
          id: trigger.id,
          label: trigger.label || trigger.type || 'Trigger',
          tool: undefined,
        });
        continue;
      }

      // Check if source is a node
      const node = model.nodes.find(n => n.id === sourceId);
      if (node) {
        result.push({
          id: node.id,
          label: node.label || node.tool || 'Step',
          tool: node.tool,
        });
        // Continue traversing upstream
        traverse(sourceId);
      }
    }
  }

  traverse(nodeId);
  return result;
}

export function InspectorPanel({ model, selectedNodeId, onUpdate, onDelete, onClose }: InspectorPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const allItems = [...model.triggers, ...model.nodes];
  const item = allItems.find(n => n.id === selectedNodeId);
  const isTrigger = model.triggers.some(t => t.id === selectedNodeId);

  // Get tool name for schema lookup
  const toolName = useMemo((): string => {
    if (!item) return '';
    return String('tool' in item ? item.tool : item.type);
  }, [item]);

  // Get tool schema for smart editing
  const toolSchema = useMemo(() => toolName ? getToolSchema(toolName) : undefined, [toolName]);

  // Get Tool Icon & Color
  const ToolIcon = useMemo(() => getToolIcon(toolName, isTrigger), [toolName, isTrigger]);
  const colorKey = useMemo(() => getToolColor(toolName, isTrigger), [toolName, isTrigger]);
  const styles = CATEGORY_COLORS[colorKey] || CATEGORY_COLORS.slate;

  // Calculate upstream nodes for variable suggestions
  const upstreamNodes = useMemo(() => {
    if (!selectedNodeId || isTrigger) return [];
    return getUpstreamNodes(model, selectedNodeId);
  }, [model, selectedNodeId, isTrigger]);

  // Find outgoing wires for this node
  const outgoingWires = model.wires?.filter(w => w.from === selectedNodeId) || [];

  const updateItem = (updates: any) => {
    if (isTrigger) {
      const newTriggers = model.triggers.map(t => t.id === selectedNodeId ? { ...t, ...updates } : t);
      onUpdate({ ...model, triggers: newTriggers });
    } else {
      const newNodes = model.nodes.map(n => n.id === selectedNodeId ? { ...n, ...updates } : n);
      onUpdate({ ...model, nodes: newNodes });
    }
  };

  const updateWire = (wireIndex: number, updates: any) => {
    // Find the actual index in the global wires array
    let matchCount = 0;
    const globalIndex = model.wires.findIndex(w => {
      if (w.from === selectedNodeId) {
        if (matchCount === wireIndex) return true;
        matchCount++;
      }
      return false;
    });

    if (globalIndex !== -1) {
      const newWires = [...model.wires];
      if (updates._delete) {
        newWires.splice(globalIndex, 1);
      } else {
        newWires[globalIndex] = { ...newWires[globalIndex], ...updates };
      }
      onUpdate({ ...model, wires: newWires });
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 shadow-xl z-20 w-[400px]">
      {/* Header */}
      <div className="h-14 px-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${styles.bg} ${styles.text}`}>
            <Settings className="w-4 h-4" />
          </div>
          <span className="font-semibold text-slate-800">Properties</span>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {!item ? (
        // Workflow Settings (shown when nothing is selected)
        <div className="flex-1 overflow-y-auto scrollbar-minimal p-5 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl shrink-0 flex items-center justify-center shadow-sm border bg-gradient-to-br from-indigo-500 to-violet-600 text-white">
              <Zap className="w-6 h-6" />
            </div>
            <div className="flex-1 space-y-1">
              <input
                value={model.name || ''}
                onChange={e => onUpdate({ ...model, name: e.target.value })}
                className="w-full px-0 py-1 text-lg font-bold bg-transparent border-none focus:ring-0 focus:outline-none placeholder:text-slate-300 text-slate-800"
                placeholder="Workflow Name"
              />
              <div className="text-xs text-slate-500 font-medium px-0.5">
                Workflow Settings
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              Description
            </label>
            <textarea
              value={model.description || ''}
              onChange={(e) => onUpdate({ ...model, description: e.target.value })}
              placeholder="What does this workflow do?"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-none"
              rows={3}
            />
          </div>

          {/* Autostart Toggle */}
          <div className="border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-600">
                  <Power className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-700">Auto-start</div>
                  <div className="text-xs text-slate-500">Run when Stuard starts</div>
                </div>
              </div>
              <button
                onClick={() => onUpdate({ ...model, autostart: !model.autostart })}
                className={`relative w-11 h-6 rounded-full transition-colors ${model.autostart ? 'bg-emerald-500' : 'bg-slate-300'
                  }`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${model.autostart ? 'left-6' : 'left-1'
                  }`} />
              </button>
            </div>
          </div>

          {/* Variables Panel */}
          <VariablesPanel
            variables={model.variables || []}
            onChange={(variables) => onUpdate({ ...model, variables })}
            disabled={model.locked}
          />

          {/* Workflow Info */}
          <div className="border border-slate-100 rounded-xl overflow-hidden">
            <button
              onClick={() => { }}
              className="w-full flex items-center justify-between px-3 py-2 bg-slate-50/50 text-xs font-medium text-slate-500"
            >
              <span>Workflow Info</span>
            </button>
            <div className="p-3 bg-slate-50/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">ID</span>
                <code className="text-slate-600 font-mono bg-slate-100 px-2 py-0.5 rounded">{model.id}</code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Version</span>
                <code className="text-slate-600 font-mono bg-slate-100 px-2 py-0.5 rounded">{model.version || '1.0.0'}</code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Triggers</span>
                <span className="text-slate-600">{model.triggers.length}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Steps</span>
                <span className="text-slate-600">{model.nodes.length}</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-minimal p-5 space-y-8">

          {/* Main Identity Section */}
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl shrink-0 flex items-center justify-center shadow-sm border ${styles.bg} ${styles.border} ${styles.text}`}>
                <ToolIcon className="w-6 h-6" />
              </div>
              <div className="flex-1 space-y-1">
                <input
                  value={item.label || ''}
                  onChange={e => updateItem({ label: e.target.value })}
                  className="w-full px-0 py-1 text-lg font-bold bg-transparent border-none focus:ring-0 focus:outline-none placeholder:text-slate-300 text-slate-800"
                  placeholder={toolSchema?.label || toolName}
                />
                <div className="text-xs text-slate-500 font-medium px-0.5">
                  {toolSchema?.description || (isTrigger ? 'Starts the workflow' : 'Performs an action')}
                </div>
              </div>
            </div>

            {/* Advanced Details Toggle */}
            <div className="border border-slate-100 rounded-lg overflow-hidden">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-3 py-2 bg-slate-50/50 hover:bg-slate-50 transition-colors text-xs font-medium text-slate-500"
              >
                <span>Advanced Details</span>
                {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {showAdvanced && (
                <div className="p-3 bg-slate-50/30 space-y-3 border-t border-slate-100">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Hash className="w-3 h-3" /> Step ID
                    </label>
                    <input
                      value={item.id}
                      onChange={e => updateItem({ id: e.target.value })}
                      className="w-full px-2 py-1 text-xs bg-white border border-slate-200 rounded-md font-mono text-slate-600 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Activity className="w-3 h-3" /> Type
                    </label>
                    <div className="w-full px-2 py-1 text-xs bg-slate-100 rounded-md font-mono text-slate-500 select-all">
                      {String('tool' in item ? item.tool : item.type)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Wait For All (Convergence) - Only for nodes with multiple incoming wires */}
            {!isTrigger && (() => {
              const incomingWires = model.wires?.filter(w => w.to === selectedNodeId) || [];
              if (incomingWires.length <= 1) return null;

              const waitForAll = ('waitForAll' in item) ? (item as any).waitForAll : false;

              return (
                <div className="border border-indigo-100 rounded-lg overflow-hidden bg-indigo-50/30">
                  <div className="px-3 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                        <GitMerge className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-700">Wait For All Branches</div>
                        <div className="text-[10px] text-slate-500">{incomingWires.length} incoming connections</div>
                      </div>
                    </div>
                    <button
                      onClick={() => updateItem({ waitForAll: !waitForAll })}
                      className={`relative w-11 h-6 rounded-full transition-colors ${waitForAll ? 'bg-indigo-500' : 'bg-slate-300'
                        }`}
                    >
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${waitForAll ? 'left-6' : 'left-1'
                        }`} />
                    </button>
                  </div>
                  {waitForAll && (
                    <div className="px-3 py-2 border-t border-indigo-100 bg-white/50">
                      <div className="flex items-start gap-1.5 text-[10px] text-indigo-600">
                        <Info className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>This step will wait until all {incomingWires.length} parallel branches complete before executing.</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Settings / Arguments */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-slate-800">Settings</span>
              <div className="h-px bg-slate-100 flex-1" />
            </div>

            <div className="bg-white">
              <ToolArgsEditor
                toolName={toolName}
                args={item.args || {}}
                onUpdate={(newArgs) => updateItem({ args: newArgs })}
                upstreamNodes={upstreamNodes}
                workflowVariables={model.variables}
              />
            </div>
          </div>

          {/* Available Variables (Scratch-like tokens) */}
          {!isTrigger && upstreamNodes.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold text-slate-800">Available Data</span>
                <div className="h-px bg-slate-100 flex-1" />
              </div>

              <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100">
                <p className="text-xs text-slate-500 mb-3">
                  Click the <VariableIcon className="w-3 h-3 inline mx-1" /> icon in any text field to insert these values:
                </p>
                <div className="flex flex-wrap gap-2">
                  {upstreamNodes.map(v => (
                    <div
                      key={v.id}
                      className="group relative flex items-center bg-white border border-indigo-100 rounded-full pl-1 pr-3 py-1 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-help"
                    >
                      <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mr-2 text-[10px] font-bold font-mono">
                        {'{'}
                      </div>
                      <span className="text-xs font-medium text-slate-700">{v.label}</span>

                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[200px] bg-slate-800 text-white text-[10px] rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                        ID: {v.id}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Connections */}
          {!isTrigger && outgoingWires.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold text-slate-800">Next Steps</span>
                <div className="h-px bg-slate-100 flex-1" />
              </div>

              <div className="space-y-3">
                {outgoingWires.map((wire, i) => (
                  <WireConditionEditor
                    key={i}
                    wire={wire}
                    index={i}
                    onUpdate={updateWire}
                    onDelete={() => updateWire(i, { _delete: true })} // Helper to trigger delete
                    upstreamNodes={upstreamNodes}
                    selectedNodeId={selectedNodeId}
                    model={model}
                    workflowVariables={model.variables}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pt-8 pb-4">
            <button
              onClick={onDelete}
              className="w-full py-3 text-sm font-medium text-red-600 hover:bg-red-50 border border-red-100 hover:border-red-200 rounded-xl transition-all flex items-center justify-center gap-2 group"
            >
              <Trash2 className="w-4 h-4 transition-transform group-hover:scale-110" />
              Delete {isTrigger ? 'Trigger' : 'Block'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VariableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 7C4 5.34315 5.34315 4 7 4H17C18.6569 4 20 5.34315 20 7V17C20 18.6569 18.6569 20 17 20H7C5.34315 20 4 18.6569 4 17V7Z" stroke="currentColor" strokeWidth="2" />
      <path d="M9 12L11 12M15 12L13 12M12 9L12 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function WireConditionEditor({
  wire,
  index,
  onUpdate,
  onDelete,
  upstreamNodes,
  selectedNodeId,
  model,
  workflowVariables
}: {
  wire: any,
  index: number,
  onUpdate: (i: number, u: any) => void,
  onDelete: (i: number) => void,
  upstreamNodes: UpstreamNode[],
  selectedNodeId: string,
  model: DesignerModel,
  workflowVariables?: any[]
}) {
  const isConditional = wire.guard && wire.guard !== 'always';

  const [editorMode, setEditorMode] = useState<'builder' | 'advanced'>('builder');

  // Track if we're currently updating to prevent loops
  const isUpdatingRef = React.useRef(false);

  const currentNode = useMemo(() => {
    return model.nodes.find(n => n.id === selectedNodeId);
  }, [model.nodes, selectedNodeId]);

  const nodesForSuggestions = useMemo(() => {
    const base = Array.isArray(upstreamNodes) ? upstreamNodes : [];
    if (!currentNode) return base;
    return [{ id: currentNode.id, label: currentNode.label || currentNode.tool || currentNode.id, tool: currentNode.tool }, ...base];
  }, [currentNode, upstreamNodes]);

  const operandOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string; group: string }> = [];

    // Add workflow variables first - these are most commonly used for conditions
    if (Array.isArray(workflowVariables) && workflowVariables.length) {
      for (const v of workflowVariables as WorkflowVariable[]) {
        if (!v?.name) continue;
        opts.push({ value: `workflow.${v.name}`, label: `workflow.${v.name}`, group: 'Workflow Variables' });
      }
    }

    const allNodes = nodesForSuggestions;
    for (let i = 0; i < allNodes.length; i++) {
      const n = allNodes[i];
      const group = i === 0 && currentNode && n.id === currentNode.id ? 'This Step Output' : 'Upstream Step Outputs';
      const outputs = n.tool ? getToolOutputs(n.tool) : ['ok', 'result'];
      opts.push({ value: n.id, label: n.id, group });
      for (const f of outputs) {
        opts.push({ value: `${n.id}.${f}`, label: `${n.id}.${f}`, group });
      }
    }

    return opts;
  }, [workflowVariables, nodesForSuggestions, currentNode]);

  // Parse guard to extract builder fields
  const parseGuardToBuilder = useCallback((g: any): { lhs: string; op: string; rhs: string } | null => {
    if (!g || g === 'always') return null;
    const raw = (g && typeof g === 'object' && 'if' in g) ? (g as any).if : g;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const op = Object.keys(raw)[0];
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
    if (right === undefined) return { lhs, op, rhs: 'undefined' };
    try { return { lhs, op, rhs: JSON.stringify(right) }; } catch { }
    return null;
  }, []);

  // Initialize builder state from wire.guard
  const initialBuilder = useMemo(() => parseGuardToBuilder(wire.guard), [wire.guard, parseGuardToBuilder]);

  const [builderLhs, setBuilderLhs] = useState<string>(initialBuilder?.lhs || '');
  const [builderOp, setBuilderOp] = useState<string>(initialBuilder?.op || '==');
  const [builderRhs, setBuilderRhs] = useState<string>(initialBuilder?.rhs || '');

  // Use local state for advanced text editor
  const initialText = useMemo(() => {
    const s = guardToString(wire.guard);
    return s === 'always' ? '' : s;
  }, [wire.guard]);

  const [localText, setLocalText] = useState(initialText);

  // Sync builder state when wire.guard changes externally (not from our own updates)
  useEffect(() => {
    if (isUpdatingRef.current) return;
    const parsed = parseGuardToBuilder(wire.guard);
    if (parsed) {
      setBuilderLhs(parsed.lhs);
      setBuilderOp(parsed.op);
      setBuilderRhs(parsed.rhs);
    }
    setLocalText(initialText);
  }, [wire.guard, parseGuardToBuilder, initialText]);

  // Find target node to get its label
  const targetNode = useMemo(() => {
    return model.nodes.find(n => n.id === wire.to) || model.triggers.find(t => t.id === wire.to);
  }, [model, wire.to]);

  // Helper to parse RHS value
  const parseRhsValue = useCallback((s: string): any => {
    const t = String(s || '').trim();
    // Check for variable reference
    if (t.startsWith('{{') && t.endsWith('}}')) {
      return { var: t.slice(2, -2).trim() };
    }
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (t === 'undefined') return undefined;
    if (t && !Number.isNaN(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
      try { return JSON.parse(t); } catch { }
    }
    return t;
  }, []);

  const handleModeChange = (mode: string) => {
    if (mode === 'always') {
      onUpdate(index, { guard: 'always' });
      setBuilderLhs('');
      setBuilderRhs('');
      setLocalText('');
    } else {
      // Switching to conditional - set up initial state
      const firstVar = Array.isArray(workflowVariables) && workflowVariables[0]?.name
        ? `workflow.${workflowVariables[0].name}`
        : operandOptions[0]?.value || '';
      setBuilderLhs(firstVar);
      setBuilderOp('==');
      setBuilderRhs('');
      setLocalText('');
      setEditorMode('builder');
      // Set initial guard
      if (firstVar) {
        onUpdate(index, { guard: { '==': [{ var: firstVar }, ''] } });
      }
    }
  };

  const handleTextChange = (val: string) => {
    setLocalText(val);
    if (!val.trim()) {
      onUpdate(index, { guard: { '==': [{ var: '' }, ''] } });
    } else {
      try {
        const parsed = parseGuard(val);
        onUpdate(index, { guard: parsed });
      } catch {
        // If it fails to parse, save as raw expression wrapped in 'if'
        onUpdate(index, { guard: { if: val } });
      }
    }
  };

  // Handle builder field changes - only update when values actually change
  const handleBuilderChange = useCallback((field: 'lhs' | 'op' | 'rhs', value: string) => {
    const newLhs = field === 'lhs' ? value : builderLhs;
    const newOp = field === 'op' ? value : builderOp;
    const newRhs = field === 'rhs' ? value : builderRhs;

    // Update local state
    if (field === 'lhs') setBuilderLhs(value);
    if (field === 'op') setBuilderOp(value);
    if (field === 'rhs') setBuilderRhs(value);

    // Build the guard and update
    if (newLhs) {
      isUpdatingRef.current = true;
      const rhsValue = parseRhsValue(newRhs);
      const logic = { [newOp]: [{ var: newLhs }, rhsValue] };
      onUpdate(index, { guard: logic });
      // Reset flag after a tick
      setTimeout(() => { isUpdatingRef.current = false; }, 0);
    }
  }, [builderLhs, builderOp, builderRhs, index, onUpdate, parseRhsValue]);

  return (
    <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-indigo-300 transition-all group">
      {/* Header: Destination & Actions */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-50 flex items-center justify-center text-indigo-500">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-medium text-slate-600">To:</span>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700" title={`ID: ${wire.to}`}>
            <span className="font-semibold">{targetNode?.label || wire.to}</span>
            <span className="text-[10px] text-slate-400 font-mono">#{wire.to}</span>
          </div>
        </div>
        <button
          onClick={() => onDelete(index)}
          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          title="Remove connection"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Condition Section */}
      <div className={`rounded-lg p-2.5 border transition-colors ${isConditional ? 'bg-amber-50/50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}>
        <div className="flex items-center justify-between mb-2">
          <label className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isConditional ? 'text-amber-600' : 'text-slate-400'}`}>
            <GitBranch className="w-3 h-3" />
            Condition
          </label>
          <select
            value={isConditional ? 'conditional' : 'always'}
            onChange={(e) => handleModeChange(e.target.value)}
            className={`text-xs border-none bg-transparent font-medium focus:ring-0 cursor-pointer rounded px-1 -mr-1 transition-colors ${isConditional ? 'text-amber-700 hover:bg-amber-100' : 'text-slate-500 hover:bg-slate-200'
              }`}
          >
            <option value="always">Always Run</option>
            <option value="conditional">Run If...</option>
          </select>
        </div>

        {isConditional && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Editor</div>
              <div className="flex items-center gap-1 bg-white/60 border border-slate-200 rounded-lg p-1">
                <button
                  onClick={() => setEditorMode('builder')}
                  className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors ${editorMode === 'builder' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  Builder
                </button>
                <button
                  onClick={() => { setEditorMode('advanced'); setLocalText(initialText); }}
                  className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors ${editorMode === 'advanced' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  Advanced
                </button>
              </div>
            </div>

            {editorMode === 'builder' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Left</div>
                    <select
                      value={builderLhs}
                      onChange={(e) => handleBuilderChange('lhs', e.target.value)}
                      className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                    >
                      <option value="">Select…</option>
                      {(['Workflow Variables', 'This Step Output', 'Upstream Step Outputs'] as const).map(group => {
                        const groupItems = operandOptions.filter(o => o.group === group);
                        if (!groupItems.length) return null;
                        return (
                          <optgroup key={group} label={group}>
                            {groupItems.map(o => (
                              <option key={`${group}:${o.value}`} value={o.value}>{o.label}</option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>

                  <div className="col-span-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Op</div>
                    <select
                      value={builderOp}
                      onChange={(e) => handleBuilderChange('op', e.target.value)}
                      className="w-full px-2 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                    >
                      <option value="==">Equals</option>
                      <option value="!=">Not equals</option>
                      <option value=">">Greater</option>
                      <option value=">=">Greater or equal</option>
                      <option value="<">Less</option>
                      <option value="<=">Less or equal</option>
                      <option value="in">In</option>
                    </select>
                  </div>

                  <div className="col-span-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Right</div>
                    <div className="space-y-2">
                      <TextInputWithVariables
                        value={builderRhs}
                        onChange={(v) => handleBuilderChange('rhs', v)}
                        placeholder="value or {{ref}}"
                        upstreamNodes={nodesForSuggestions}
                        workflowVariables={workflowVariables}
                        suggestFrom={['*.*']}
                      />
                      {/* Quick value buttons for common comparisons */}
                      <div className="flex gap-1">
                        {['true', 'false'].map(val => (
                          <button
                            key={val}
                            onClick={() => handleBuilderChange('rhs', val)}
                            className={`px-2 py-1 text-[10px] font-medium rounded-md border transition-colors ${
                              builderRhs === val
                                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-200 hover:bg-indigo-50/50'
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Show preview of the condition */}
                <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 rounded-lg border border-slate-100">
                  <code className="text-[11px] font-mono text-slate-600 flex-1">
                    {builderLhs ? `${builderLhs} ${builderOp} ${builderRhs || '?'}` : 'Select a variable...'}
                  </code>
                </div>
              </div>
            ) : (
              <>
                <TextInputWithVariables
                  value={localText}
                  onChange={handleTextChange}
                  placeholder="e.g. step.success == true"
                  upstreamNodes={nodesForSuggestions}
                  workflowVariables={workflowVariables}
                  suggestFrom={['*.*']}
                />
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400">
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

