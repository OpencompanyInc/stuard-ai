/**
 * VariablesPanel - Workflow-scoped variable management
 * Variables defined here are shared across all stuard files within the current workflow.
 * For file-scoped (local) variables, use local.* prefix in set_variable.
 */
import React, { useState } from "react";
import { Plus, Trash2, Variable, ChevronDown, ChevronRight, Copy, Check, Hash, ToggleLeft, Type, Code2, Info, List, Save, RefreshCw } from "lucide-react";
import type { WorkflowVariable } from "../types";

interface VariablesPanelProps {
  variables: WorkflowVariable[];
  onChange: (variables: WorkflowVariable[]) => void;
  disabled?: boolean;
}

const TYPE_OPTIONS = [
  { value: 'string', label: 'Text', icon: Type, description: 'Plain text value' },
  { value: 'number', label: 'Number', icon: Hash, description: 'Numeric value' },
  { value: 'boolean', label: 'Boolean', icon: ToggleLeft, description: 'True/false value' },
  { value: 'list', label: 'List', icon: List, description: 'Array of items' },
  { value: 'json', label: 'JSON', icon: Code2, description: 'Complex object' },
] as const;

function VariableRow({
  variable,
  index,
  onUpdate,
  onDelete,
  disabled,
}: {
  variable: WorkflowVariable;
  index: number;
  onUpdate: (updates: Partial<WorkflowVariable>) => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const typeOption = TYPE_OPTIONS.find(t => t.value === variable.type) || TYPE_OPTIONS[0];
  const TypeIcon = typeOption.icon;

  const copyReference = () => {
    navigator.clipboard.writeText(`{{workflow.${variable.name}}}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderValueEditor = () => {
    switch (variable.type) {
      case 'boolean':
        return (
          <button
            onClick={() => !disabled && onUpdate({ defaultValue: !variable.defaultValue })}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${variable.defaultValue
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-slate-100 text-slate-600 border border-slate-200'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
          >
            {variable.defaultValue ? 'true' : 'false'}
          </button>
        );
      case 'number':
        return (
          <input
            type="number"
            value={variable.defaultValue ?? ''}
            onChange={(e) => onUpdate({ defaultValue: e.target.value === '' ? 0 : Number(e.target.value) })}
            disabled={disabled}
            className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="0"
          />
        );
      case 'list':
        const listValue = Array.isArray(variable.defaultValue) ? variable.defaultValue : [];
        return (
          <div className="space-y-2">
            {listValue.map((item, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={String(item ?? '')}
                  onChange={(e) => {
                    const newList = [...listValue];
                    newList[i] = e.target.value;
                    onUpdate({ defaultValue: newList });
                  }}
                  disabled={disabled}
                  className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 disabled:opacity-50"
                  placeholder={`Item ${i + 1}`}
                />
                {!disabled && (
                  <button
                    onClick={() => {
                      const newList = listValue.filter((_, idx) => idx !== i);
                      onUpdate({ defaultValue: newList });
                    }}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {!disabled && (
              <button
                onClick={() => onUpdate({ defaultValue: [...listValue, ''] })}
                className="w-full py-1.5 border border-dashed border-slate-200 rounded-lg text-xs text-slate-500 hover:text-indigo-600 hover:border-indigo-300 transition-colors flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add Item
              </button>
            )}
          </div>
        );
      case 'json':
        return (
          <textarea
            value={typeof variable.defaultValue === 'string' ? variable.defaultValue : JSON.stringify(variable.defaultValue, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                onUpdate({ defaultValue: parsed });
              } catch {
                onUpdate({ defaultValue: e.target.value });
              }
            }}
            disabled={disabled}
            className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            rows={3}
            placeholder="{}"
          />
        );
      default:
        return (
          <input
            type="text"
            value={String(variable.defaultValue ?? '')}
            onChange={(e) => onUpdate({ defaultValue: e.target.value })}
            disabled={disabled}
            className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Default value..."
          />
        );
    }
  };

  return (
    <div className={`border rounded-xl transition-all ${expanded ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="p-0.5 text-slate-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className={`p-1.5 rounded-lg ${expanded ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
          <TypeIcon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-sm font-medium text-slate-700 font-mono">{variable.name || 'unnamed'}</code>
            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{typeOption.label}</span>
          </div>
          {variable.description && (
            <div className="text-[11px] text-slate-400 truncate">{variable.description}</div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); copyReference(); }}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
            title="Copy reference"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {!disabled && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete variable"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-3">
          {/* Variable name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Variable Name</label>
            <input
              type="text"
              value={variable.name}
              onChange={(e) => onUpdate({ name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
              disabled={disabled}
              className="w-full px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 disabled:opacity-50"
              placeholder="myVariable"
            />
            <div className="text-[10px] text-slate-400">
              Use in steps: <code className="bg-slate-100 px-1 py-0.5 rounded">{`{{workflow.${variable.name || 'name'}}}`}</code>
            </div>
          </div>

          {/* Type selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Type</label>
            <div className="grid grid-cols-5 gap-1">
              {TYPE_OPTIONS.map(opt => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => !disabled && onUpdate({ type: opt.value, defaultValue: opt.value === 'boolean' ? false : opt.value === 'number' ? 0 : opt.value === 'json' ? {} : opt.value === 'list' ? [] : '' })}
                    disabled={disabled}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors text-center ${variable.type === opt.value
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[10px] font-medium">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Default value */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Default Value</label>
            {renderValueEditor()}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Description (optional)</label>
            <input
              type="text"
              value={variable.description || ''}
              onChange={(e) => onUpdate({ description: e.target.value })}
              disabled={disabled}
              className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 disabled:opacity-50"
              placeholder="What is this variable for?"
            />
          </div>

          {/* Persist State Toggle */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex items-center gap-2">
              {variable.persistState ? (
                <Save className="w-4 h-4 text-emerald-600" />
              ) : (
                <RefreshCw className="w-4 h-4 text-slate-500" />
              )}
              <div>
                <div className="text-xs font-medium text-slate-700">
                  {variable.persistState ? 'Persist value' : 'Reset on start'}
                </div>
                <div className="text-[10px] text-slate-500">
                  {variable.persistState
                    ? 'Value survives workflow restarts'
                    : 'Value resets to default when workflow deploys'}
                </div>
              </div>
            </div>
            <button
              onClick={() => !disabled && onUpdate({ persistState: !variable.persistState })}
              disabled={disabled}
              className={`relative w-10 h-5 rounded-full transition-colors ${variable.persistState
                  ? 'bg-emerald-500'
                  : 'bg-slate-300'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${variable.persistState ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function VariablesPanel({ variables, onChange, disabled }: VariablesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const addVariable = () => {
    const newName = `var${variables.length + 1}`;
    onChange([
      ...variables,
      { name: newName, type: 'string', defaultValue: '', description: '' },
    ]);
  };

  const updateVariable = (index: number, updates: Partial<WorkflowVariable>) => {
    const newVars = [...variables];
    newVars[index] = { ...newVars[index], ...updates };
    onChange(newVars);
  };

  const deleteVariable = (index: number) => {
    onChange(variables.filter((_, i) => i !== index));
  };

  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2.5 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div className="p-1.5 rounded-lg bg-violet-100 text-violet-600">
          <Variable className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-700">Workflow Variables</div>
          <div className="text-[11px] text-slate-400">
            {variables.length === 0 ? 'No variables defined' : `${variables.length} variable${variables.length !== 1 ? 's' : ''} — shared across all stuard files in this workflow`}
          </div>
        </div>
        {collapsed ? <ChevronRight className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="p-3 space-y-2">
          {/* Info banner */}
          {variables.length === 0 && (
            <div className="flex items-start gap-2 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
              <div className="text-xs text-indigo-700">
                <p className="font-medium">Define workflow-scoped variables</p>
                <p className="text-indigo-600/70 mt-0.5">
                  These variables are shared across all stuard files in this workflow. Reference with{' '}
                  <code className="bg-indigo-100 px-1 py-0.5 rounded">{`{{workflow.varName}}`}</code>.
                  For file-scoped variables, use <code className="bg-indigo-100 px-1 py-0.5 rounded">local.*</code> in set_variable.
                </p>
              </div>
            </div>
          )}

          {/* Variable list */}
          {variables.map((v, i) => (
            <VariableRow
              key={i}
              variable={v}
              index={i}
              onUpdate={(updates) => updateVariable(i, updates)}
              onDelete={() => deleteVariable(i)}
              disabled={disabled}
            />
          ))}

          {/* Add button */}
          {!disabled && (
            <button
              onClick={addVariable}
              className="w-full py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-xs font-medium text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all flex items-center justify-center gap-2 group"
            >
              <div className="w-6 h-6 rounded-full bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </div>
              Add Variable
            </button>
          )}
        </div>
      )}
    </div>
  );
}
