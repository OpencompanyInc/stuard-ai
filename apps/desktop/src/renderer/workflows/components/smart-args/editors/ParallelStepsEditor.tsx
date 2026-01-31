/**
 * ParallelStepsEditor - Visual step builder for run_parallel and run_sequential tools
 */
import React, { useState, useMemo } from 'react';
import { ChevronRight, Trash2, Plus, Zap, Play, Settings2 } from 'lucide-react';
import { getToolSchema } from '../../../constants/tool-schemas';
import { PALETTE_CATEGORIES } from '../../../constants/paletteCategories';
import type { WorkflowVariable } from '../../../types';
import type { UpstreamNode } from './TextInputWithVariables';

interface ParallelStepsEditorProps {
  value: any[];
  onChange: (v: any[]) => void;
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
  isParallel?: boolean;
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

export function ParallelStepsEditor({
  value,
  onChange,
  upstreamNodes,
  workflowVariables,
  isParallel = true,
}: ParallelStepsEditorProps) {
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
    setExpandedIndex(steps.length);
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

  // Import SmartArgEditor dynamically to avoid circular deps
  const SmartArgEditorLazy = React.lazy(() => 
    import('../SmartArgEditor').then(m => ({ default: m.SmartArgEditor }))
  );

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
                  {/* Move Buttons */}
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
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isExpanded ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
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

                  {/* Expand Icon */}
                  <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />

                  {/* Delete Button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeStep(i); }}
                    className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Step Settings */}
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
                        <React.Suspense fallback={<div className="text-xs text-slate-400">Loading...</div>}>
                          {Object.keys(schema.args).map(argKey => (
                            <div key={argKey} className="pl-2 border-l-2 border-slate-100">
                              <SmartArgEditorLazy
                                toolName={toolId}
                                argKey={argKey}
                                value={step.args?.[argKey]}
                                onChange={(v: any) => updateStep(i, { args: { ...step.args, [argKey]: v } })}
                                upstreamNodes={upstreamNodes}
                                workflowVariables={workflowVariables}
                              />
                            </div>
                          ))}
                        </React.Suspense>
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
                            } catch { /* Ignore */ }
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
