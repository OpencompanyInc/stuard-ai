/**
 * InspectorPanel - Right panel for editing selected node properties
 * Redesigned for beginner-friendliness and Scratch-like UX
 */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { X, Settings, Trash2, ArrowRight, Sparkles, Info, ChevronDown, ChevronRight, Hash, Activity, GitBranch, GitMerge, FileText, Zap, Power, Paintbrush, Repeat, RotateCw, List, Plus, GripVertical, Package, ArrowRightFromLine } from "lucide-react";
import { ToolArgsEditor, TextInputWithVariables, type UpstreamNode } from "./SmartArgEditor";
import { getToolSchema, getToolOutputs } from "../constants/tool-schemas";
import { getToolIcon, getToolColor, CATEGORY_COLORS } from "../constants/paletteCategories";
import { parseGuard, guardToString } from "../builder/guards";
import { VariablesPanel } from "./VariablesPanel";
import type { DesignerModel, WorkflowVariable, DesignerWire, WorkflowInputParam, WorkflowOutputField } from "../types";
import { UIBuilderModal } from "../../ui-builder";

/**
 * Compute chain indices for all nodes based on the flow of connections.
 * Triggers start at index 0, and each step downstream gets a higher index.
 */
function computeChainIndices(
  triggers: { id: string }[],
  nodes: { id: string }[],
  wires: DesignerWire[]
): Map<string, number> {
  const indices = new Map<string, number>();
  const queue: { id: string; index: number }[] = triggers.map(t => ({ id: t.id, index: 0 }));
  
  while (queue.length > 0) {
    const { id, index } = queue.shift()!;
    const existingIndex = indices.get(id);
    if (existingIndex !== undefined && existingIndex <= index) continue;
    indices.set(id, index);
    
    for (const w of wires) {
      if (w.from === id) {
        const targetIndex = indices.get(w.to);
        if (targetIndex === undefined || targetIndex > index + 1) {
          queue.push({ id: w.to, index: index + 1 });
        }
      }
    }
  }
  
  let maxIndex = Math.max(0, ...indices.values());
  for (const node of nodes) {
    if (!indices.has(node.id)) {
      indices.set(node.id, ++maxIndex);
    }
  }
  return indices;
}

/**
 * Check if a wire is a back edge based on chain indices.
 */
function isBackEdgeByChain(
  chainIndices: Map<string, number>,
  from: string,
  to: string
): boolean {
  const fromIndex = chainIndices.get(from) ?? 0;
  const toIndex = chainIndices.get(to) ?? 0;
  return fromIndex >= toIndex;
}

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
  const [showUIBuilder, setShowUIBuilder] = useState(false);

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
    const nodes = getUpstreamNodes(model, selectedNodeId);
    
    // Check if this node receives a loop wire (explicit config) - add loop variables
    const incomingLoopWire = (model.wires || []).find(
      w => w.to === selectedNodeId && (w as any).loop
    );
    
    // Also check if any incoming wire forms a back edge based on chain index
    const chainIndices = computeChainIndices(model.triggers, model.nodes, model.wires || []);
    const incomingBackEdge = (model.wires || []).find(w => {
      if (w.to !== selectedNodeId) return false;
      return isBackEdgeByChain(chainIndices, w.from, w.to);
    });
    
    if (incomingLoopWire || incomingBackEdge) {
      const loop = incomingLoopWire ? (incomingLoopWire as any).loop : null;
      // Add loop context as a pseudo-node for variable suggestions
      nodes.unshift({
        id: 'loop',
        label: 'Loop Context',
        tool: '__loop__', // Special marker for loop variables
      });
    }
    
    return nodes;
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

          {/* Output Schema - for workflow-as-function */}
          <OutputSchemaEditor
            fields={model.outputSchema || []}
            onChange={(outputSchema) => onUpdate({ ...model, outputSchema })}
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

            {/* Incoming Loop Info - Show when this node receives a loop wire */}
            {!isTrigger && (() => {
              const incomingLoopWires = (model.wires || []).filter(
                w => w.to === selectedNodeId && (w as any).loop
              );
              if (incomingLoopWires.length === 0) return null;

              return (
                <div className="border border-purple-200 rounded-lg overflow-hidden bg-purple-50/30">
                  <div className="px-3 py-2.5 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600">
                      <Repeat className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-slate-700">Loop Execution</div>
                      <div className="text-[10px] text-slate-500">This step will run multiple times</div>
                    </div>
                  </div>
                  <div className="px-3 py-2 border-t border-purple-100 bg-white/50 space-y-2">
                    {incomingLoopWires.map((wire, i) => {
                      const loop = (wire as any).loop;
                      const sourceNode = [...model.triggers, ...model.nodes].find(n => n.id === wire.from);
                      return (
                        <div key={i} className="flex items-start gap-2 text-[10px]">
                          <div className="w-4 h-4 rounded bg-purple-100 flex items-center justify-center text-purple-600 shrink-0 mt-0.5">
                            {loop.type === 'forEach' ? <List className="w-2.5 h-2.5" /> : 
                             loop.type === 'repeat' ? <Repeat className="w-2.5 h-2.5" /> : 
                             <RotateCw className="w-2.5 h-2.5" />}
                          </div>
                          <div className="flex-1">
                            <span className="font-medium text-purple-700">
                              {loop.type === 'forEach' ? 'For Each' : 
                               loop.type === 'repeat' ? `Repeat ${loop.count}x` : 
                               'While'}
                            </span>
                            <span className="text-slate-500"> from </span>
                            <span className="font-medium text-slate-600">{sourceNode?.label || wire.from}</span>
                            {loop.type === 'forEach' && loop.itemVar && (
                              <div className="text-slate-500 mt-0.5">
                                Access item as <code className="bg-purple-100 px-1 rounded text-purple-700">{'{{loop.' + loop.itemVar + '}}'}</code>
                              </div>
                            )}
                            {loop.maxIterations && (
                              <div className="text-slate-400">Max: {loop.maxIterations} iterations</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Quick Action for custom_ui tool */}
          {toolName === 'custom_ui' && (
            <div>
              <button
                onClick={() => setShowUIBuilder(true)}
                className="w-full py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2.5 hover:from-indigo-600 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all group"
              >
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Paintbrush className="w-5 h-5" />
                </div>
                <span>Design UI Visually</span>
              </button>
            </div>
          )}

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

          {/* Input Parameters - for triggers (workflow-as-function) */}
          {isTrigger && (
            <InputParamsEditor
              params={(item as any).inputParams || []}
              onChange={(inputParams) => updateItem({ inputParams })}
              disabled={model.locked}
            />
          )}

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

      {/* UI Builder Modal for custom_ui tool */}
      {showUIBuilder && item && toolName === 'custom_ui' && (
        <UIBuilderModal
          html={item.args?.html || ''}
          css={item.args?.css || ''}
          js={item.args?.js || item.args?.script || ''}
          windowConfig={{
            width: item.args?.width || 800,
            height: item.args?.height || 600,
            title: item.args?.title,
            position: item.args?.position,
            alwaysOnTop: item.args?.alwaysOnTop,
            frameless: item.args?.frameless,
            borderRadius: item.args?.borderRadius,
          }}
          onSave={(result) => {
            // Auto-save updates model without closing modal
            updateItem({
              args: {
                ...item.args,
                html: result.html,
                css: result.css,
                js: result.js,
                script: result.js,
                ...result.window,
              }
            });
          }}
          onClose={() => setShowUIBuilder(false)}
        />
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

/**
 * WireLoopEditor - Configure loop behavior for a wire connection
 * Supports: forEach (iterate items), repeat (N times), while (condition-based)
 */
function WireLoopEditor({
  wire,
  index,
  onUpdate,
  nodesForSuggestions,
  workflowVariables
}: {
  wire: any;
  index: number;
  onUpdate: (i: number, u: any) => void;
  nodesForSuggestions: UpstreamNode[];
  workflowVariables?: any[];
}) {
  const hasLoop = !!wire.loop;
  const loopType = wire.loop?.type || 'forEach';
  
  const [isExpanded, setIsExpanded] = useState(hasLoop);
  
  // Sync expansion state with hasLoop
  useEffect(() => {
    if (hasLoop) setIsExpanded(true);
  }, [hasLoop]);

  const handleLoopTypeChange = (newType: string) => {
    if (newType === 'none') {
      // Remove loop config
      onUpdate(index, { loop: undefined });
      setIsExpanded(false);
    } else {
      // Set up default loop config based on type
      const baseLoop = {
        type: newType as 'forEach' | 'while' | 'repeat',
        maxIterations: 100,
        delayMs: 0,
      };
      
      if (newType === 'forEach') {
        onUpdate(index, { loop: { ...baseLoop, items: '', itemVar: 'item', indexVar: 'index' } });
      } else if (newType === 'repeat') {
        onUpdate(index, { loop: { ...baseLoop, count: 5 } });
      } else if (newType === 'while') {
        onUpdate(index, { loop: { ...baseLoop, condition: { '==': [{ var: '' }, true] } } });
      }
      setIsExpanded(true);
    }
  };

  const updateLoopField = (field: string, value: any) => {
    onUpdate(index, { loop: { ...wire.loop, [field]: value } });
  };

  const loopTypeIcon = loopType === 'forEach' ? List : loopType === 'repeat' ? Repeat : RotateCw;
  const LoopIcon = loopTypeIcon;

  return (
    <div className={`rounded-lg p-2.5 border transition-colors mb-3 ${hasLoop ? 'bg-purple-50/50 border-purple-200' : 'bg-slate-50 border-slate-100'}`}>
      <div className="flex items-center justify-between mb-2">
        <label className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${hasLoop ? 'text-purple-600' : 'text-slate-400'}`}>
          <LoopIcon className="w-3 h-3" />
          Loop
        </label>
        <select
          value={hasLoop ? loopType : 'none'}
          onChange={(e) => handleLoopTypeChange(e.target.value)}
          className={`text-xs border-none bg-transparent font-medium focus:ring-0 cursor-pointer rounded px-1 -mr-1 transition-colors ${hasLoop ? 'text-purple-700 hover:bg-purple-100' : 'text-slate-500 hover:bg-slate-200'}`}
        >
          <option value="none">No Loop</option>
          <option value="forEach">For Each Item</option>
          <option value="repeat">Repeat N Times</option>
          <option value="while">While Condition</option>
        </select>
      </div>

      {hasLoop && isExpanded && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200 space-y-3">
          {/* For Each Loop */}
          {loopType === 'forEach' && (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                  Items to iterate
                </label>
                <TextInputWithVariables
                  value={wire.loop?.items || ''}
                  onChange={(v) => updateLoopField('items', v)}
                  placeholder="{{step.results}} or [1, 2, 3]"
                  upstreamNodes={nodesForSuggestions}
                  workflowVariables={workflowVariables}
                  suggestFrom={['*.*']}
                />
                <p className="text-[10px] text-slate-400 mt-1">Array or list to loop through</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                    Item variable
                  </label>
                  <input
                    type="text"
                    value={wire.loop?.itemVar || 'item'}
                    onChange={(e) => updateLoopField('itemVar', e.target.value)}
                    placeholder="item"
                    className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-300 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                    Index variable
                  </label>
                  <input
                    type="text"
                    value={wire.loop?.indexVar || 'index'}
                    onChange={(e) => updateLoopField('indexVar', e.target.value)}
                    placeholder="index"
                    className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-300 font-mono"
                  />
                </div>
              </div>
              <div className="p-2 bg-purple-50 rounded-lg border border-purple-100">
                <p className="text-[10px] text-purple-600">
                  Access current item as <code className="bg-white px-1 rounded">{'{{loop.' + (wire.loop?.itemVar || 'item') + '}}'}</code> and index as <code className="bg-white px-1 rounded">{'{{loop.' + (wire.loop?.indexVar || 'index') + '}}'}</code>
                </p>
              </div>
            </>
          )}

          {/* Repeat N Times */}
          {loopType === 'repeat' && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                Number of times
              </label>
              <input
                type="number"
                value={wire.loop?.count || 5}
                onChange={(e) => updateLoopField('count', parseInt(e.target.value) || 1)}
                min={1}
                max={10000}
                className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-300"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Access iteration number as <code className="bg-slate-100 px-1 rounded">{'{{loop.index}}'}</code>
              </p>
            </div>
          )}

          {/* While Loop */}
          {loopType === 'while' && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                Continue while
              </label>
              <TextInputWithVariables
                value={wire.loop?.conditionText || ''}
                onChange={(v: string) => updateLoopField('conditionText', v)}
                placeholder="{{workflow.counter}} < 10"
                upstreamNodes={nodesForSuggestions}
                workflowVariables={workflowVariables}
                suggestFrom={['*.*']}
              />
              <p className="text-[10px] text-slate-400 mt-1">Loop continues while this condition is true</p>
            </div>
          )}

          {/* Common Loop Settings */}
          <div className="pt-2 border-t border-slate-200/50 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                  Max iterations
                </label>
                <input
                  type="number"
                  value={wire.loop?.maxIterations || 100}
                  onChange={(e) => updateLoopField('maxIterations', parseInt(e.target.value) || 100)}
                  min={1}
                  max={10000}
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-300"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">
                  Delay (ms)
                </label>
                <input
                  type="number"
                  value={wire.loop?.delayMs || 0}
                  onChange={(e) => updateLoopField('delayMs', parseInt(e.target.value) || 0)}
                  min={0}
                  className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-300"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-400">Safety limit to prevent infinite loops</p>
          </div>
        </div>
      )}
    </div>
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

      {/* Loop Section */}
      <WireLoopEditor
        wire={wire}
        index={index}
        onUpdate={onUpdate}
        nodesForSuggestions={nodesForSuggestions}
        workflowVariables={workflowVariables}
      />

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
                        onChange={(v: string) => handleBuilderChange('rhs', v)}
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

/**
 * InputParamsEditor - Configure input parameters for workflow-as-function
 */
function InputParamsEditor({
  params,
  onChange,
  disabled
}: {
  params: WorkflowInputParam[];
  onChange: (params: WorkflowInputParam[]) => void;
  disabled?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(params.length > 0);

  const addParam = () => {
    onChange([...params, { name: '', type: 'string', required: false }]);
    setIsExpanded(true);
  };

  const updateParam = (index: number, updates: Partial<WorkflowInputParam>) => {
    const newParams = [...params];
    newParams[index] = { ...newParams[index], ...updates };
    onChange(newParams);
  };

  const removeParam = (index: number) => {
    onChange(params.filter((_, i) => i !== index));
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-100 text-blue-600">
            <Package className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-slate-700">Input Parameters</div>
            <div className="text-[10px] text-slate-500">
              {params.length === 0 ? 'Define inputs for this workflow' : `${params.length} parameter${params.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-3 bg-white">
          {params.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-slate-500 mb-3">
                Add input parameters to use this workflow as a reusable function
              </p>
              <button
                onClick={addParam}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Parameter
              </button>
            </div>
          ) : (
            <>
              {params.map((param, i) => (
                <div key={i} className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={param.name}
                        onChange={(e) => updateParam(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                        placeholder="paramName"
                        disabled={disabled}
                        className="px-2 py-1.5 text-xs border border-slate-200 rounded-md font-mono focus:border-blue-300 focus:ring-2 focus:ring-blue-100 outline-none disabled:opacity-50"
                      />
                      <select
                        value={param.type}
                        onChange={(e) => updateParam(i, { type: e.target.value as any })}
                        disabled={disabled}
                        className="px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:border-blue-300 focus:ring-2 focus:ring-blue-100 outline-none disabled:opacity-50"
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="json">JSON Object</option>
                        <option value="array">Array</option>
                      </select>
                    </div>
                    <input
                      type="text"
                      value={param.description || ''}
                      onChange={(e) => updateParam(i, { description: e.target.value })}
                      placeholder="Description (optional)"
                      disabled={disabled}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:border-blue-300 focus:ring-2 focus:ring-blue-100 outline-none disabled:opacity-50"
                    />
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={param.required || false}
                          onChange={(e) => updateParam(i, { required: e.target.checked })}
                          disabled={disabled}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        Required
                      </label>
                      {!param.required && (
                        <input
                          type="text"
                          value={param.defaultValue ?? ''}
                          onChange={(e) => updateParam(i, { defaultValue: e.target.value })}
                          placeholder="Default value"
                          disabled={disabled}
                          className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded-md focus:border-blue-300 focus:ring-2 focus:ring-blue-100 outline-none disabled:opacity-50"
                        />
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeParam(i)}
                    disabled={disabled}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={addParam}
                disabled={disabled}
                className="w-full py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 border border-dashed border-blue-200 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1" />
                Add Parameter
              </button>
            </>
          )}

          {params.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-500">
                Access inputs via <code className="bg-slate-100 px-1 rounded">{'{{input.paramName}}'}</code> or <code className="bg-slate-100 px-1 rounded">{'{{args.paramName}}'}</code>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * OutputSchemaEditor - Configure output schema for workflow return value
 */
function OutputSchemaEditor({
  fields,
  onChange,
  disabled
}: {
  fields: WorkflowOutputField[];
  onChange: (fields: WorkflowOutputField[]) => void;
  disabled?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(fields.length > 0);

  const addField = () => {
    onChange([...fields, { name: '', type: 'string' }]);
    setIsExpanded(true);
  };

  const updateField = (index: number, updates: Partial<WorkflowOutputField>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    onChange(newFields);
  };

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  };

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 hover:from-emerald-100 hover:to-teal-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600">
            <ArrowRightFromLine className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-slate-700">Output Schema</div>
            <div className="text-[10px] text-slate-500">
              {fields.length === 0 ? 'Define what this workflow returns' : `${fields.length} field${fields.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-3 bg-white">
          {fields.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-slate-500 mb-3">
                Define output fields to document what this workflow returns
              </p>
              <button
                onClick={addField}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Output Field
              </button>
            </div>
          ) : (
            <>
              {fields.map((field, i) => (
                <div key={i} className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={field.name}
                        onChange={(e) => updateField(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                        placeholder="fieldName"
                        disabled={disabled}
                        className="px-2 py-1.5 text-xs border border-slate-200 rounded-md font-mono focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none disabled:opacity-50"
                      />
                      <select
                        value={field.type}
                        onChange={(e) => updateField(i, { type: e.target.value as any })}
                        disabled={disabled}
                        className="px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none disabled:opacity-50"
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="json">JSON Object</option>
                        <option value="array">Array</option>
                      </select>
                    </div>
                    <input
                      type="text"
                      value={field.description || ''}
                      onChange={(e) => updateField(i, { description: e.target.value })}
                      placeholder="Description (optional)"
                      disabled={disabled}
                      className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none disabled:opacity-50"
                    />
                  </div>
                  <button
                    onClick={() => removeField(i)}
                    disabled={disabled}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={addField}
                disabled={disabled}
                className="w-full py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 border border-dashed border-emerald-200 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1" />
                Add Output Field
              </button>
            </>
          )}

          {fields.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-500">
                Use the <code className="bg-slate-100 px-1 rounded">return_value</code> node to return data matching this schema
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

