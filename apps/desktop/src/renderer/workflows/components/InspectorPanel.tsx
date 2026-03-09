/**
 * InspectorPanel - Right panel for editing selected node properties
 * Redesigned for beginner-friendliness and Scratch-like UX
 */
import React, { useMemo, useState, useEffect, useCallback } from "react";
import { X, Settings, Trash2, ArrowRight, Sparkles, Info, ChevronDown, ChevronRight, Hash, Activity, GitBranch, GitMerge, FileText, Zap, Power, Repeat, RotateCw, List, Plus, GripVertical, Package, ArrowRightFromLine, Copy, Globe, Check } from "lucide-react";
import { ToolArgsEditor, TextInputWithVariables, type UpstreamNode } from "./SmartArgEditor";
import { getToolSchema, getToolOutputs } from "../constants/tool-schemas";
import { getToolIcon, getToolColor, CATEGORY_COLORS } from "../constants/paletteCategories";
import { parseGuard, guardToString } from "../builder/guards";
import { VariablesPanel } from "./VariablesPanel";
import type { DesignerModel, WorkflowVariable, DesignerWire, WorkflowInputParam, WorkflowOutputField } from "../types";
import { isBackEdge as isBackEdgeCycle } from "../utils/graphUtils";
// UIBuilderModal is now handled inside ToolArgsEditor for custom_ui/update_custom_ui tools

// Back edge (cycle) detection is in ../utils/graphUtils.ts

const CLOUD_AI_HTTP = (window as any).__CLOUD_AI_HTTP__ || (import.meta as any).env?.VITE_CLOUD_AI_URL || 'http://127.0.0.1:8082';

function WebhookUrlInfo({ mode, flowId }: { mode: 'cloud' | 'local'; flowId: string }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (mode === 'local') {
      const api = (window as any).desktopAPI;
      if (api?.webhooksLocalUrl) {
        api.webhooksLocalUrl(flowId).then((res: any) => {
          if (res?.url) setUrl(res.url);
          else setUrl(`http://127.0.0.1:18080/webhooks/incoming/${flowId}`);
        }).catch(() => {
          setUrl(`http://127.0.0.1:18080/webhooks/incoming/${flowId}`);
        });
      } else {
        setUrl(`http://127.0.0.1:18080/webhooks/incoming/${flowId}`);
      }
    } else {
      // Cloud webhook URL
      const base = CLOUD_AI_HTTP.replace(/\/+$/, '');
      setUrl(`${base}/webhooks/incoming/${flowId}`);
    }
  }, [mode, flowId]);

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const isCloud = mode === 'cloud';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-white/80">Webhook URL</span>
        <div className="h-px bg-white/[0.08] flex-1" />
      </div>
      <div className={`border rounded-xl overflow-hidden ${isCloud ? 'border-blue-500/30 bg-blue-500/10' : 'border-emerald-500/30 bg-emerald-500/10'}`}>
        <div className="px-3 py-2.5 flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isCloud ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
            <Globe className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-white/90">
              {isCloud ? 'Cloud Endpoint' : 'Local Endpoint'}
            </div>
            <div className="text-[10px] text-white/50">
              {isCloud ? 'External services POST here' : 'Local network POST here'}
            </div>
          </div>
        </div>
        {url && (
          <div className={`px-3 py-2 border-t ${isCloud ? 'border-blue-500/20' : 'border-emerald-500/20'} bg-black/20`}>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] text-white/80 font-mono bg-black/30 px-2 py-1.5 rounded-lg break-all select-all leading-relaxed">
                {url}
              </code>
              <button
                onClick={handleCopy}
                className={`p-1.5 rounded-lg transition-all shrink-0 ${
                  copied
                    ? 'bg-green-500/20 text-green-400'
                    : `${isCloud ? 'hover:bg-blue-500/20 text-blue-400/60 hover:text-blue-400' : 'hover:bg-emerald-500/20 text-emerald-400/60 hover:text-emerald-400'}`
                }`}
                title="Copy URL"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className={`flex items-start gap-1.5 text-[10px] mt-2 ${isCloud ? 'text-blue-400/70' : 'text-emerald-400/70'}`}>
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                {isCloud
                  ? 'Send a POST request with JSON body to this URL to trigger this workflow.'
                  : 'Send a POST request with JSON body from your local network to trigger this workflow.'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
    
    // Also check if any incoming wire forms a back edge (actual cycle)
    const incomingBackEdge = (model.wires || []).find(w => {
      if (w.to !== selectedNodeId) return false;
      return isBackEdgeCycle(w.from, w.to, model.wires || []);
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
    <div className="flex flex-col h-full w-full bg-transparent text-white/90">
      {/* Header */}
      <div className="h-14 px-5 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-transparent">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg ${styles.bg} ${styles.text}`}>
            <Settings className="w-4 h-4" />
          </div>
          <span className="font-semibold text-white/90">Properties</span>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/[0.04] rounded-full text-white/40 hover:text-white/70 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {!item ? (
        // Workflow Settings (shown when nothing is selected)
        <div className="flex-1 overflow-y-auto scrollbar-minimal p-5 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl shrink-0 flex items-center justify-center shadow-sm border border-white/[0.08] bg-gradient-to-br from-indigo-500/20 to-blue-500/20 text-indigo-400">
              <Zap className="w-6 h-6" />
            </div>
            <div className="flex-1 space-y-1">
              <input
                value={model.name || ''}
                onChange={e => onUpdate({ ...model, name: e.target.value })}
                className="w-full px-0 py-1 text-lg font-bold bg-transparent border-none focus:ring-0 focus:outline-none placeholder:text-white/30 text-white/90"
                placeholder="Workflow Name"
              />
              <div className="text-xs text-white/50 font-medium px-0.5">
                Workflow Settings
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-bold text-white/80 flex items-center gap-2">
              <FileText className="w-4 h-4 text-white/40" />
              Description
            </label>
            <textarea
              value={model.description || ''}
              onChange={(e) => onUpdate({ ...model, description: e.target.value })}
              placeholder="What does this workflow do?"
              className="w-full px-3 py-2.5 text-sm border border-white/[0.08] bg-black/20 text-white/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 resize-none"
              rows={3}
            />
          </div>

          {/* Autostart Toggle */}
          <div className="border border-white/[0.08] bg-black/20 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Power className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white/80">Auto-start</div>
                  <div className="text-xs text-white/50">Run when Stuard starts</div>
                </div>
              </div>
              <button
                onClick={() => onUpdate({ ...model, autostart: !model.autostart })}
                className={`relative w-11 h-6 rounded-full transition-colors ${model.autostart ? 'bg-emerald-500' : 'bg-white/20'
                  }`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white/[0.04] shadow-sm transition-transform ${model.autostart ? 'left-6' : 'left-1'
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
          <div className="border border-white/[0.08] rounded-xl overflow-hidden">
            <button
              onClick={() => { }}
              className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.04] text-xs font-medium text-white/60"
            >
              <span>Workflow Info</span>
            </button>
            <div className="p-3 bg-black/20 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/50">ID</span>
                <code className="text-white/80 font-mono bg-white/[0.06] px-2 py-0.5 rounded">{model.id}</code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/50">Version</span>
                <code className="text-white/80 font-mono bg-white/[0.06] px-2 py-0.5 rounded">{model.version || '1.0.0'}</code>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/50">Triggers</span>
                <span className="text-white/80">{model.triggers.length}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-white/50">Steps</span>
                <span className="text-white/80">{model.nodes.length}</span>
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
                  className="w-full px-0 py-1 text-lg font-bold bg-transparent border-none focus:ring-0 focus:outline-none placeholder:text-white/30 text-white/90"
                  placeholder={toolSchema?.label || toolName}
                />
                <div className="text-xs text-white/50 font-medium px-0.5">
                  {toolSchema?.description || (isTrigger ? 'Starts the workflow' : 'Performs an action')}
                </div>
              </div>
            </div>

            {/* Advanced Details Toggle */}
            <div className="border border-white/[0.08] rounded-lg overflow-hidden">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] transition-colors text-xs font-medium text-white/60"
              >
                <span>Advanced Details</span>
                {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>

              {showAdvanced && (
                <div className="p-3 bg-black/20 space-y-3 border-t border-white/[0.08]">
                  <div>
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Hash className="w-3 h-3" /> Step ID
                    </label>
                    <input
                      value={item.id}
                      onChange={e => updateItem({ id: e.target.value })}
                      className="w-full px-2 py-1 text-xs bg-white/[0.04] border border-white/[0.08] rounded-md font-mono text-white/70 focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/30 outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Activity className="w-3 h-3" /> Type
                    </label>
                    <div className="w-full px-2 py-1 text-xs bg-white/[0.04] rounded-md font-mono text-white/60 select-all">
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
                <div className="border border-indigo-500/30 rounded-lg overflow-hidden bg-indigo-500/10">
                  <div className="px-3 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                        <GitMerge className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white/90">Wait For All Branches</div>
                        <div className="text-[10px] text-white/50">{incomingWires.length} incoming connections</div>
                      </div>
                    </div>
                    <button
                      onClick={() => updateItem({ waitForAll: !waitForAll })}
                      className={`relative w-11 h-6 rounded-full transition-colors ${waitForAll ? 'bg-indigo-500' : 'bg-white/20'
                        }`}
                    >
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white/[0.04] shadow-sm transition-transform ${waitForAll ? 'left-6' : 'left-1'
                        }`} />
                    </button>
                  </div>
                  {waitForAll && (
                    <div className="px-3 py-2 border-t border-indigo-500/20 bg-black/20">
                      <div className="flex items-start gap-1.5 text-[10px] text-indigo-400">
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
                <div className="border border-blue-500/30 rounded-lg overflow-hidden bg-blue-500/10">
                  <div className="px-3 py-2.5 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                      <Repeat className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-white/90">Loop Execution</div>
                      <div className="text-[10px] text-white/50">This step will run multiple times</div>
                    </div>
                  </div>
                  <div className="px-3 py-2 border-t border-blue-500/20 bg-black/20 space-y-2">
                    {incomingLoopWires.map((wire, i) => {
                      const loop = (wire as any).loop;
                      const sourceNode = [...model.triggers, ...model.nodes].find(n => n.id === wire.from);
                      return (
                        <div key={i} className="flex items-start gap-2 text-[10px]">
                          <div className="w-4 h-4 rounded bg-blue-500/20 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                            {loop.type === 'forEach' ? <List className="w-2.5 h-2.5" /> : 
                             loop.type === 'repeat' ? <Repeat className="w-2.5 h-2.5" /> : 
                             <RotateCw className="w-2.5 h-2.5" />}
                          </div>
                          <div className="flex-1">
                            <span className="font-medium text-blue-400">
                              {loop.type === 'forEach' ? 'For Each' : 
                               loop.type === 'repeat' ? `Repeat ${loop.count}x` : 
                               'While'}
                            </span>
                            <span className="text-white/40"> from </span>
                            <span className="font-medium text-white/70">{sourceNode?.label || wire.from}</span>
                            {loop.type === 'forEach' && loop.itemVar && (
                              <div className="text-white/40 mt-0.5">
                                Access item as <code className="bg-blue-500/20 px-1 rounded text-blue-300">{'{{loop.' + loop.itemVar + '}}'}</code>
                              </div>
                            )}
                            {loop.maxIterations && (
                              <div className="text-white/30">Max: {loop.maxIterations} iterations</div>
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

          {/* Settings / Arguments */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-white/80">Settings</span>
              <div className="h-px bg-white/[0.08] flex-1" />
            </div>

            <div className="bg-transparent">
              <ToolArgsEditor
                toolName={toolName}
                args={item.args || {}}
                onUpdate={(newArgs) => updateItem({ args: newArgs })}
                upstreamNodes={upstreamNodes}
                workflowVariables={model.variables}
              />
            </div>
          </div>

          {/* Webhook URL Info - show URL for webhook triggers */}
          {isTrigger && (toolName === 'webhook' || toolName === 'webhook.cloud' || toolName === 'webhook.local') && (() => {
            const webhookMode: 'cloud' | 'local' = toolName === 'webhook.local' ? 'local' :
              toolName === 'webhook.cloud' ? 'cloud' :
              (item?.args?.mode === 'local' ? 'local' : 'cloud');
            return <WebhookUrlInfo mode={webhookMode} flowId={model.id} />;
          })()}

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
                <span className="text-sm font-bold text-white/80">Available Data</span>
                <div className="h-px bg-white/[0.08] flex-1" />
              </div>

              <div className="bg-black/20 rounded-xl p-3 border border-white/[0.08]">
                <p className="text-xs text-white/50 mb-3">
                  Click the <VariableIcon className="w-3 h-3 inline mx-1" /> icon in any text field to insert these values:
                </p>
                <div className="flex flex-wrap gap-2">
                  {upstreamNodes.map(v => (
                    <div
                      key={v.id}
                      className="group relative flex items-center bg-white/[0.04] border border-white/[0.08] rounded-full pl-1 pr-3 py-1 shadow-sm hover:shadow-md hover:border-indigo-500/50 transition-all cursor-help"
                    >
                      <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mr-2 text-[10px] font-bold font-mono">
                        {'{'}
                      </div>
                      <span className="text-xs font-medium text-white/80">{v.label}</span>

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
                <span className="text-sm font-bold text-white/80">Next Steps</span>
                <div className="h-px bg-white/[0.08] flex-1" />
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
              className="w-full py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/30 rounded-xl transition-all flex items-center justify-center gap-2 group"
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

/**
 * WireLoopEditor - Configure loop behavior for a wire connection
 * Supports: forEach (iterate items), repeat (N times), while (condition-based)
 */
function WireLoopEditor({
  wire,
  index,
  onUpdate,
  nodesForSuggestions,
  workflowVariables,
  model
}: {
  wire: any;
  index: number;
  onUpdate: (i: number, u: any) => void;
  nodesForSuggestions: UpstreamNode[];
  workflowVariables?: any[];
  model: DesignerModel;
}) {
  const hasLoop = !!wire.loop;
  const loopType = wire.loop?.type || 'forEach';

  // Check if there's a sibling wire from the same source that has a loop
  const hasOutgoingLoopFromSameNode = useMemo(() => {
    const wires = model.wires || [];
    return wires.some((w: any) => w.from === wire.from && w.to !== wire.to && w.loop && w.loop.type);
  }, [model.wires, wire.from, wire.to]);

  const fanoutMode = (wire.loopFanoutMode === 'parallel' ? 'parallel' : 'wait');
  
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
    <div className={`rounded-lg p-2.5 border transition-colors mb-3 ${hasLoop ? 'bg-blue-500/10 border-blue-500/20' : 'bg-black/20 border-white/[0.08]'}`}>
      <div className="flex items-center justify-between mb-2">
        <label className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${hasLoop ? 'text-blue-400' : 'text-white/40'}`}>
          <LoopIcon className="w-3 h-3" />
          Loop
        </label>
        <select
          value={hasLoop ? loopType : 'none'}
          onChange={(e) => handleLoopTypeChange(e.target.value)}
          className={`text-xs border-none bg-transparent font-medium focus:ring-0 cursor-pointer rounded px-1 -mr-1 transition-colors ${hasLoop ? 'text-blue-400 hover:bg-blue-500/20' : 'text-white/50 hover:bg-white/10'}`}
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
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1 block">
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
                <p className="text-[10px] text-white/40 mt-1">Array or list to loop through</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1 block">
                    Item variable
                  </label>
                  <input
                    type="text"
                    value={wire.loop?.itemVar || 'item'}
                    onChange={(e) => updateLoopField('itemVar', e.target.value)}
                    placeholder="item"
                    className="w-full px-2 py-1.5 text-xs border border-white/[0.08] rounded-lg bg-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 font-mono text-white/80"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1 block">
                    Index variable
                  </label>
                  <input
                    type="text"
                    value={wire.loop?.indexVar || 'index'}
                    onChange={(e) => updateLoopField('indexVar', e.target.value)}
                    placeholder="index"
                    className="w-full px-2 py-1.5 text-xs border border-white/[0.08] rounded-lg bg-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 font-mono text-white/80"
                  />
                </div>
              </div>
              <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <p className="text-[10px] text-blue-400">
                  Access current item as <code className="bg-blue-500/20 px-1 rounded">{'{{loop.' + (wire.loop?.itemVar || 'item') + '}}'}</code> and index as <code className="bg-blue-500/20 px-1 rounded">{'{{loop.' + (wire.loop?.indexVar || 'index') + '}}'}</code>
                </p>
              </div>
            </>
          )}

          {/* Repeat N Times */}
          {loopType === 'repeat' && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1 block">
                Number of times
              </label>
              <input
                type="number"
                value={wire.loop?.count || 5}
                onChange={(e) => updateLoopField('count', parseInt(e.target.value) || 1)}
                min={1}
                max={10000}
                className="w-full px-2 py-1.5 text-xs border border-white/[0.08] rounded-lg bg-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 text-white/80"
              />
              <p className="text-[10px] text-white/40 mt-1">
                Access iteration number as <code className="bg-white/[0.04] px-1 rounded">{'{{loop.index}}'}</code>
              </p>
            </div>
          )}

          {/* While Loop */}
          {loopType === 'while' && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1 block">
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
              <p className="text-[10px] text-white/40 mt-1">Loop continues while this condition is true</p>
            </div>
          )}

          {/* Common Loop Settings */}
          <div className="pt-2 border-t border-white/[0.08] space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1 block">
                  Max iterations
                </label>
                <input
                  type="number"
                  value={wire.loop?.maxIterations || 100}
                  onChange={(e) => updateLoopField('maxIterations', parseInt(e.target.value) || 100)}
                  min={1}
                  max={10000}
                  className="w-full px-2 py-1.5 text-xs border border-white/[0.08] rounded-lg bg-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 text-white/80"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1 block">
                  Delay (ms)
                </label>
                <input
                  type="number"
                  value={wire.loop?.delayMs || 0}
                  onChange={(e) => updateLoopField('delayMs', parseInt(e.target.value) || 0)}
                  min={0}
                  className="w-full px-2 py-1.5 text-xs border border-white/[0.08] rounded-lg bg-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 text-white/80"
                />
              </div>
            </div>
            <p className="text-[10px] text-white/40">Safety limit to prevent infinite loops</p>
          </div>
        </div>
      )}

      {/* Loop Fanout Mode - shown for non-loop wires when sibling has loop */}
      {!hasLoop && hasOutgoingLoopFromSameNode && (
        <div className="pt-2 border-t border-white/[0.08]">
          <label className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1 block">
            When sibling loop is active
          </label>
          <select
            value={fanoutMode}
            onChange={(e) => onUpdate(index, { loopFanoutMode: e.target.value })}
            className="w-full px-2 py-1.5 text-xs border border-white/[0.08] rounded-lg bg-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/50 text-white/80"
          >
            <option value="wait">Wait for loop to finish</option>
            <option value="parallel">Run in parallel with loop</option>
          </select>
          <p className="text-[10px] text-white/40 mt-1">
            {fanoutMode === 'wait'
              ? 'This connection executes after the loop completes'
              : 'This connection executes immediately, in parallel with the loop'}
          </p>
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
  const [builderLhs, setBuilderLhs] = useState<string>('');
  const [builderOp, setBuilderOp] = useState<string>('==');
  const [builderRhs, setBuilderRhs] = useState<string>('');
  const [localText, setLocalText] = useState('');

  // Track previous guard to detect actual changes (fixes wire switching issue)
  const prevGuardRef = React.useRef<any>(null);
  const prevWireIdRef = React.useRef<string>('');

  // Sync builder state when wire.guard changes or when switching to a different wire
  useEffect(() => {
    // Create a unique wire identifier
    const wireId = `${wire.from}->${wire.to}`;
    const currentGuardStr = JSON.stringify(wire.guard);
    const prevGuardStr = JSON.stringify(prevGuardRef.current);
    const wireChanged = wireId !== prevWireIdRef.current;
    
    // Only sync if guard actually changed or if we switched wires
    if (currentGuardStr !== prevGuardStr || wireChanged) {
      prevGuardRef.current = wire.guard;
      prevWireIdRef.current = wireId;
      
      const parsed = parseGuardToBuilder(wire.guard);
      if (parsed) {
        setBuilderLhs(parsed.lhs);
        setBuilderOp(parsed.op);
        setBuilderRhs(parsed.rhs);
      } else {
        // Reset to empty when guard is cleared or not parseable
        setBuilderLhs('');
        setBuilderOp('==');
        setBuilderRhs('');
      }
      
      // Update text for advanced mode
      const guardStr = guardToString(wire.guard);
      setLocalText(guardStr === 'always' ? '' : guardStr);
    }
  }, [wire.guard, wire.from, wire.to, parseGuardToBuilder]);
  
  // Also sync on initial mount
  useEffect(() => {
    const parsed = parseGuardToBuilder(wire.guard);
    if (parsed) {
      setBuilderLhs(parsed.lhs);
      setBuilderOp(parsed.op);
      setBuilderRhs(parsed.rhs);
    }
    const guardStr = guardToString(wire.guard);
    setLocalText(guardStr === 'always' ? '' : guardStr);
    prevGuardRef.current = wire.guard;
    prevWireIdRef.current = `${wire.from}->${wire.to}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setBuilderOp('==');
      setBuilderRhs('');
      setLocalText('');
      setEditorMode('builder');
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
      onUpdate(index, { guard: { if: { '==': [{ var: firstVar }, ''] } } });
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
      const rhsValue = parseRhsValue(newRhs);
      const logic = { [newOp]: [{ var: newLhs }, rhsValue] };
      // Update the prevGuardRef to prevent the useEffect from overwriting our change
      prevGuardRef.current = logic;
      onUpdate(index, { guard: logic });
    }
  }, [builderLhs, builderOp, builderRhs, index, onUpdate, parseRhsValue]);

  return (
    <div className="p-3 bg-black/20 border border-white/[0.08] rounded-xl shadow-sm hover:border-indigo-500/50 transition-all group">
      {/* Header: Destination & Actions */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-500/20 flex items-center justify-center text-indigo-400">
            <ArrowRight className="w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-medium text-white/60">To:</span>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.04] border border-white/[0.08] rounded text-xs text-white/80" title={`ID: ${wire.to}`}>
            <span className="font-semibold">{targetNode?.label || wire.to}</span>
            <span className="text-[10px] text-white/40 font-mono">#{wire.to}</span>
          </div>
        </div>
        <button
          onClick={() => onDelete(index)}
          className="p-1.5 text-white/30 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
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
        model={model}
      />

      {/* Condition Section */}
      <div className={`rounded-lg p-2.5 border transition-colors ${isConditional ? 'bg-amber-500/10 border-amber-500/20' : 'bg-black/20 border-white/[0.08]'}`}>
        <div className="flex items-center justify-between mb-2">
          <label className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isConditional ? 'text-amber-400' : 'text-white/40'}`}>
            <GitBranch className="w-3 h-3" />
            Condition
          </label>
          <select
            value={isConditional ? 'conditional' : 'always'}
            onChange={(e) => handleModeChange(e.target.value)}
            className={`text-xs border-none bg-transparent font-medium focus:ring-0 cursor-pointer rounded px-1 -mr-1 transition-colors ${isConditional ? 'text-amber-400 hover:bg-amber-500/20' : 'text-white/50 hover:bg-white/10'
              }`}
          >
            <option value="always">Always Run</option>
            <option value="conditional">Run If...</option>
          </select>
        </div>

        {isConditional && (
          <div className="animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Editor</div>
              <div className="flex items-center gap-1 bg-white/[0.04] border border-white/[0.08] rounded-lg p-1">
                <button
                  onClick={() => setEditorMode('builder')}
                  className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors ${editorMode === 'builder' ? 'bg-indigo-500/20 text-indigo-400' : 'text-white/50 hover:bg-white/10'}`}
                >
                  Builder
                </button>
                <button
                  onClick={() => { 
                    setEditorMode('advanced'); 
                    const guardStr = guardToString(wire.guard);
                    setLocalText(guardStr === 'always' ? '' : guardStr); 
                  }}
                  className={`px-2 py-1 text-xs font-semibold rounded-md transition-colors ${editorMode === 'advanced' ? 'bg-indigo-500/20 text-indigo-400' : 'text-white/50 hover:bg-white/10'}`}
                >
                  Advanced
                </button>
              </div>
            </div>

            {editorMode === 'builder' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1">Left</div>
                    <select
                      value={builderLhs}
                      onChange={(e) => handleBuilderChange('lhs', e.target.value)}
                      className="w-full px-2 py-2 text-xs border border-white/[0.08] rounded-lg bg-black/20 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 text-white/80"
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
                    <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1">Op</div>
                    <select
                      value={builderOp}
                      onChange={(e) => handleBuilderChange('op', e.target.value)}
                      className="w-full px-2 py-2 text-xs border border-white/[0.08] rounded-lg bg-black/20 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 text-white/80"
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
                    <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1">Right</div>
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
                                ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                                : 'bg-black/20 border-white/[0.08] text-white/50 hover:border-indigo-500/30 hover:bg-indigo-500/10'
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
                <div className="flex items-center gap-2 px-2 py-1.5 bg-black/20 rounded-lg border border-white/[0.08]">
                  <code className="text-[11px] font-mono text-white/60 flex-1">
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
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-white/40">
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
    <div className="border border-white/[0.08] rounded-xl overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 hover:from-blue-500/20 hover:to-indigo-500/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
            <Package className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-white/80">Input Parameters</div>
            <div className="text-[10px] text-white/50">
              {params.length === 0 ? 'Define inputs for this workflow' : `${params.length} parameter${params.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
        {isExpanded ? <ChevronDown className="w-4 h-4 text-white/40" /> : <ChevronRight className="w-4 h-4 text-white/40" />}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-3 bg-black/20">
          {params.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-white/50 mb-3">
                Add input parameters to use this workflow as a reusable function
              </p>
              <button
                onClick={addParam}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 bg-blue-500/20 rounded-lg hover:bg-blue-500/30 transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Parameter
              </button>
            </div>
          ) : (
            <>
              {params.map((param, i) => (
                <div key={i} className="flex items-start gap-2 p-3 bg-white/[0.02] rounded-lg border border-white/[0.06]">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={param.name}
                        onChange={(e) => updateParam(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                        placeholder="paramName"
                        disabled={disabled}
                        className="px-2 py-1.5 text-xs border border-white/[0.08] rounded-md font-mono focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/30 bg-black/20 text-white/80 outline-none disabled:opacity-50"
                      />
                      <select
                        value={param.type}
                        onChange={(e) => updateParam(i, { type: e.target.value as any })}
                        disabled={disabled}
                        className="px-2 py-1.5 text-xs border border-white/[0.08] rounded-md focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/30 bg-black/20 text-white/80 outline-none disabled:opacity-50"
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
                      className="w-full px-2 py-1.5 text-xs border border-white/[0.08] rounded-md focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/30 bg-black/20 text-white/80 outline-none disabled:opacity-50"
                    />
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-white/60">
                        <input
                          type="checkbox"
                          checked={param.required || false}
                          onChange={(e) => updateParam(i, { required: e.target.checked })}
                          disabled={disabled}
                          className="rounded border-white/[0.08] text-blue-500 bg-black/20 focus:ring-blue-500"
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
                          className="flex-1 px-2 py-1 text-xs border border-white/[0.08] rounded-md focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/30 bg-black/20 text-white/80 outline-none disabled:opacity-50"
                        />
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeParam(i)}
                    disabled={disabled}
                    className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={addParam}
                disabled={disabled}
                className="w-full py-2 text-xs font-medium text-blue-400 hover:bg-blue-500/10 border border-dashed border-blue-500/30 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1" />
                Add Parameter
              </button>
            </>
          )}

          {params.length > 0 && (
            <div className="pt-2 border-t border-white/[0.06]">
              <p className="text-[10px] text-white/50">
                Access inputs via <code className="bg-white/[0.06] px-1 rounded text-white/70">{'{{input.paramName}}'}</code> or <code className="bg-white/[0.06] px-1 rounded text-white/70">{'{{args.paramName}}'}</code>
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
    <div className="border border-white/[0.08] rounded-xl overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 hover:from-emerald-500/20 hover:to-teal-500/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
            <ArrowRightFromLine className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="text-sm font-semibold text-white/80">Output Schema</div>
            <div className="text-[10px] text-white/50">
              {fields.length === 0 ? 'Define what this workflow returns' : `${fields.length} field${fields.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
        {isExpanded ? <ChevronDown className="w-4 h-4 text-white/40" /> : <ChevronRight className="w-4 h-4 text-white/40" />}
      </button>

      {isExpanded && (
        <div className="p-4 space-y-3 bg-black/20">
          {fields.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-white/50 mb-3">
                Define output fields to document what this workflow returns
              </p>
              <button
                onClick={addField}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/20 rounded-lg hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Output Field
              </button>
            </div>
          ) : (
            <>
              {fields.map((field, i) => (
                <div key={i} className="flex items-start gap-2 p-3 bg-white/[0.02] rounded-lg border border-white/[0.06]">
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={field.name}
                        onChange={(e) => updateField(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                        placeholder="fieldName"
                        disabled={disabled}
                        className="px-2 py-1.5 text-xs border border-white/[0.08] rounded-md font-mono focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30 bg-black/20 text-white/80 outline-none disabled:opacity-50"
                      />
                      <select
                        value={field.type}
                        onChange={(e) => updateField(i, { type: e.target.value as any })}
                        disabled={disabled}
                        className="px-2 py-1.5 text-xs border border-white/[0.08] rounded-md focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30 bg-black/20 text-white/80 outline-none disabled:opacity-50"
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
                      className="w-full px-2 py-1.5 text-xs border border-white/[0.08] rounded-md focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30 bg-black/20 text-white/80 outline-none disabled:opacity-50"
                    />
                  </div>
                  <button
                    onClick={() => removeField(i)}
                    disabled={disabled}
                    className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={addField}
                disabled={disabled}
                className="w-full py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 border border-dashed border-emerald-500/30 rounded-lg transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1" />
                Add Output Field
              </button>
            </>
          )}

          {fields.length > 0 && (
            <div className="pt-2 border-t border-white/[0.06]">
              <p className="text-[10px] text-white/50">
                Use the <code className="bg-white/[0.06] px-1 rounded text-white/70">return_value</code> node to return data matching this schema
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


