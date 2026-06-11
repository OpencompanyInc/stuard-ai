/**
 * VariablesPanel - Workflow-scoped variable management
 * Variables defined here are shared across all stuard files within the current workflow.
 * For file-scoped (local) variables, use local.* prefix in set_variable.
 */
import React, { useState } from "react";
import { Plus, Trash2, Variable, ChevronDown, ChevronRight, Copy, Check, Hash, ToggleLeft, Type, Code2, Info, List, Save, RefreshCw, Globe, FileText } from "lucide-react";
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

const SCOPE_OPTIONS = [
  { value: 'workflow', label: 'Workflow', icon: Globe, description: 'Global — shared across every stuard file in this project (main + imported)' },
  { value: 'local', label: 'Local', icon: FileText, description: 'Scoped to a single stuard file' },
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
  const scope = variable.scope || 'workflow';
  const scopeOption = SCOPE_OPTIONS.find(s => s.value === scope) || SCOPE_OPTIONS[0];

  const copyReference = () => {
    navigator.clipboard.writeText(`{{${scope}.${variable.name}}}`);
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
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors wf-input ${variable.defaultValue
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'wf-fg-muted'
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
            className="w-full px-3 py-1.5 text-sm border wf-border-subtle rounded-lg focus:outline-none focus:ring-2  disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="flex-1 px-3 py-1.5 text-sm border wf-border-subtle rounded-lg focus:outline-none focus:ring-2  disabled:opacity-50"
                  placeholder={`Item ${i + 1}`}
                />
                {!disabled && (
                  <button
                    onClick={() => {
                      const newList = listValue.filter((_, idx) => idx !== i);
                      onUpdate({ defaultValue: newList });
                    }}
                    className="p-1.5 wf-fg-faint hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            {!disabled && (
              <button
                onClick={() => onUpdate({ defaultValue: [...listValue, ''] })}
                className="w-full py-1.5 border border-dashed wf-border-subtle rounded-lg text-xs wf-fg-muted hover:wf-accent-fg hover:border-[color:color-mix(in_srgb,var(--wf-accent)_40%,transparent)] transition-colors flex items-center justify-center gap-1"
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
            className="w-full px-3 py-2 text-xs font-mono wf-input border wf-border-subtle rounded-lg focus:outline-none focus:ring-2  resize-none disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="w-full px-3 py-1.5 text-sm border wf-border-subtle rounded-lg focus:outline-none focus:ring-2  disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Default value..."
          />
        );
    }
  };

  return (
    <div className={`border rounded-xl transition-all ${expanded ? 'wf-accent-soft-bg/30' : 'wf-border-subtle wf-bg-overlay hover:wf-border-subtle'}`}>
      {/* Header row */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="p-0.5 wf-fg-faint">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className={`p-1.5 rounded-lg ${expanded ? 'wf-accent-chip' : 'wf-bg-overlay wf-fg-muted'}`}>
          <TypeIcon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-sm font-medium wf-fg font-mono">{variable.name || 'unnamed'}</code>
            <span className="text-[10px] wf-fg-faint wf-bg-overlay px-1.5 py-0.5 rounded">{typeOption.label}</span>
            {scope === 'local' && <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">Local</span>}
          </div>
          {variable.description && (
            <div className="text-[11px] wf-fg-faint truncate">{variable.description}</div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); copyReference(); }}
            className="p-1.5 wf-fg-faint hover:wf-accent-fg hover:wf-accent-soft-bg rounded-lg transition-colors"
            title="Copy reference"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {!disabled && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1.5 wf-fg-faint hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Delete variable"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-white/[0.04] space-y-3">
          {/* Variable name */}
          <div className="space-y-1">
            <label className="text-xs font-medium wf-fg-muted">Variable Name</label>
            <input
              type="text"
              value={variable.name}
              onChange={(e) => onUpdate({ name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
              disabled={disabled}
              className="w-full px-3 py-1.5 text-sm font-mono border wf-border-subtle rounded-lg focus:outline-none focus:ring-2  disabled:opacity-50"
              placeholder="myVariable"
            />
            <div className="text-[10px] wf-fg-faint">
              Use in steps: <code className="wf-bg-overlay px-1 py-0.5 rounded">{`{{${scope}.${variable.name || 'name'}}}`}</code>
            </div>
          </div>

          {/* Scope selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium wf-fg-muted">Scope</label>
            <div className="grid grid-cols-2 gap-1">
              {SCOPE_OPTIONS.map(opt => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => !disabled && onUpdate({ scope: opt.value as 'workflow' | 'local' })}
                    disabled={disabled}
                    className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${scope === opt.value
                      ? 'wf-accent-soft-bg wf-accent-fg'
                      : 'wf-border-subtle wf-bg-overlay wf-fg-muted hover:wf-border-subtle'
                      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Icon className="w-4 h-4" />
                    <div className="text-left">
                      <div className="text-[11px] font-medium">{opt.label}</div>
                      <div className="text-[9px] opacity-70">{opt.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type selector */}
          <div className="space-y-1">
            <label className="text-xs font-medium wf-fg-muted">Type</label>
            <div className="grid grid-cols-5 gap-1">
              {TYPE_OPTIONS.map(opt => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => !disabled && onUpdate({ type: opt.value, defaultValue: opt.value === 'boolean' ? false : opt.value === 'number' ? 0 : opt.value === 'json' ? {} : opt.value === 'list' ? [] : '' })}
                    disabled={disabled}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors text-center ${variable.type === opt.value
                      ? 'wf-accent-soft-bg wf-accent-fg'
                      : 'wf-border-subtle wf-bg-overlay wf-fg-muted hover:wf-border-subtle'
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
            <label className="text-xs font-medium wf-fg-muted">Default Value</label>
            {renderValueEditor()}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium wf-fg-muted">Description (optional)</label>
            <input
              type="text"
              value={variable.description || ''}
              onChange={(e) => onUpdate({ description: e.target.value })}
              disabled={disabled}
              className="w-full px-3 py-1.5 text-sm wf-input border wf-border-subtle rounded-lg focus:outline-none focus:ring-2  disabled:opacity-50"
              placeholder="What is this variable for?"
            />
          </div>

          {/* Persist State Toggle */}
          <div className="flex items-center justify-between p-3 wf-bg-overlay rounded-lg border wf-border-subtle">
            <div className="flex items-center gap-2">
              {variable.persistState ? (
                <Save className="w-4 h-4 text-emerald-600" />
              ) : (
                <RefreshCw className="w-4 h-4 wf-fg-muted" />
              )}
              <div>
                <div className="text-xs font-medium wf-fg">
                  {variable.persistState ? 'Persist value' : 'Reset on start'}
                </div>
                <div className="text-[10px] wf-fg-muted">
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
                className={`absolute top-0.5 w-4 h-4 wf-bg-overlay rounded-full shadow transition-transform ${variable.persistState ? 'translate-x-5' : 'translate-x-0.5'
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
    <div className="border wf-border-subtle rounded-xl wf-bg-overlay overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2.5 px-4 py-3 wf-bg-overlay wf-hover-bg transition-colors text-left"
      >
        <div className="p-1.5 rounded-lg wf-accent-chip">
          <Variable className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold wf-fg">Workflow Variables</div>
          <div className="text-[11px] wf-fg-faint">
            {variables.length === 0 ? 'No variables defined' : `${variables.length} variable${variables.length !== 1 ? 's' : ''} — shared across all stuard files in this workflow`}
          </div>
        </div>
        {collapsed ? <ChevronRight className="w-4 h-4 wf-fg-faint" /> : <ChevronDown className="w-4 h-4 wf-fg-faint" />}
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="p-3 space-y-2">
          {/* Info banner */}
          {variables.length === 0 && (
            <div className="flex items-start gap-2 p-3 wf-accent-soft-bg rounded-lg border wf-border-subtle">
              <Info className="w-4 h-4 wf-accent-fg shrink-0 mt-0.5" />
              <div className="text-xs wf-fg">
                <p className="font-medium">Define workflow-scoped variables</p>
                <p className="wf-accent-fg/70 mt-0.5">
                  These variables are shared across all stuard files in this workflow. Reference with{' '}
                  <code className="wf-accent-soft-bg px-1 py-0.5 rounded">{`{{workflow.varName}}`}</code>.
                  For file-scoped variables, use <code className="wf-accent-soft-bg px-1 py-0.5 rounded">local.*</code> in set_variable.
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
              className="w-full py-2.5 border-2 border-dashed wf-border-subtle rounded-xl text-xs font-medium wf-fg-muted hover:wf-accent-fg hover:border-[color:color-mix(in_srgb,var(--wf-accent)_40%,transparent)] hover:wf-accent-soft-bg/30 transition-all flex items-center justify-center gap-2 group"
            >
              <div className="w-6 h-6 rounded-full wf-bg-overlay group-hover:wf-accent-soft-bg flex items-center justify-center transition-colors">
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

