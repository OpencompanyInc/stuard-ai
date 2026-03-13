/**
 * ArrayEditor - User-friendly list editor with drag hints and clear actions
 * Supports both manual item entry and variable reference mode
 */
import React, { useEffect, useState } from 'react';
import { Plus, Trash2, FolderOpen, GripVertical, FileText, Variable, List } from 'lucide-react';
import { SelectInput } from './SelectInput';
import { TextInputWithVariables, type UpstreamNode } from './TextInputWithVariables';
import type { ArgOption } from '../../../constants/tool-schemas';
import type { WorkflowVariable } from '../../../types';

interface ArrayEditorProps {
  value: any[] | string;
  onChange: (v: any) => void;
  itemType?: string;
  itemOptions?: ArgOption[];
  upstreamNodes?: UpstreamNode[];
  workflowVariables?: WorkflowVariable[];
  itemTemplate?: any;
  argKey?: string;
}

export function ArrayEditor({
  value,
  onChange,
  itemType,
  itemOptions,
  upstreamNodes,
  workflowVariables,
  itemTemplate,
  argKey,
}: ArrayEditorProps) {
  // Detect if value is a variable reference string (e.g. "{{step_id.items}}")
  const isVarRef = typeof value === 'string' && value.includes('{{');
  const [mode, setMode] = useState<'manual' | 'variable'>(isVarRef ? 'variable' : 'manual');

  const rawItems = Array.isArray(value) ? value : [];
  const isSourcesField = argKey === 'sources';

  // Auto-convert string items to {path: string} for sources field
  const items = isSourcesField
    ? rawItems.map(item => typeof item === 'string' ? { path: item } : item)
    : rawItems;

  // If we normalized, update the parent value
  useEffect(() => {
    if (isSourcesField && rawItems.length > 0 && rawItems.some(item => typeof item === 'string')) {
      const normalized = rawItems.map(item => typeof item === 'string' ? { path: item } : item);
      onChange(normalized);
    }
  }, []);

  // Detect if items are objects with a 'path' property
  const isPathArray = isSourcesField ||
    (items.length > 0 && typeof items[0] === 'object' && items[0] !== null && 'path' in items[0]);

  const addItem = () => {
    const template = itemTemplate ||
      (isPathArray ? { path: '' } :
        (items.length > 0 && typeof items[0] === 'object' ? { ...items[0] } : ''));

    const newItem = typeof template === 'object' && template !== null
      ? Object.fromEntries(Object.keys(template).map(k => [k, '']))
      : '';

    onChange([...items, newItem]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, newValue: any) => {
    const newItems = [...items];
    newItems[index] = newValue;
    onChange(newItems);
  };

  const updateItemPath = (index: number, path: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], path };
    onChange(newItems);
  };

  const getItemLabel = () => {
    if (isPathArray) return 'file';
    if (argKey === 'packages') return 'package';
    if (argKey === 'items') return 'item';
    if (argKey === 'events') return 'event';
    return 'item';
  };

  const hasVariables = (upstreamNodes && upstreamNodes.length > 0) || (workflowVariables && workflowVariables.length > 0);

  return (
    <div className="space-y-2">
      {/* Mode toggle - only show when variables are available */}
      {hasVariables && (
        <div className="flex items-center gap-1 p-0.5 wf-bg-overlay rounded-lg border wf-border-subtle w-fit">
          <button
            type="button"
            onClick={() => {
              setMode('manual');
              if (typeof value === 'string') onChange([]);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${mode === 'manual'
              ? 'wf-bg-elevated wf-fg shadow-sm'
              : 'wf-fg-faint hover:wf-fg-muted'
              }`}
          >
            <List className="w-3 h-3" />
            Manual List
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('variable');
              if (Array.isArray(value)) onChange('');
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${mode === 'variable'
              ? 'bg-indigo-500/20 text-indigo-400 shadow-sm'
              : 'wf-fg-faint hover:wf-fg-muted'
              }`}
          >
            <Variable className="w-3 h-3" />
            From Variable
          </button>
        </div>
      )}

      {/* Variable reference mode */}
      {mode === 'variable' ? (
        <div className="space-y-1.5">
          <TextInputWithVariables
            value={String(typeof value === 'string' ? value : '')}
            onChange={onChange}
            placeholder="{{step_id.items}} or {{workflow.myList}}"
            upstreamNodes={upstreamNodes}
            workflowVariables={workflowVariables}
          />
          <p className="text-[10px] wf-fg-faint px-1">
            Reference a list from a previous step or workflow variable. The value will be resolved at runtime.
          </p>
        </div>
      ) : (
        /* Manual list mode */
        <>
          {items.length === 0 ? (
            <div className="text-center py-6 wf-bg-overlay rounded-xl border border-dashed wf-border-subtle">
              <div className="w-10 h-10 mx-auto mb-3 rounded-full wf-bg-overlay flex items-center justify-center">
                {isPathArray ? <FileText className="w-5 h-5 wf-fg-faint" /> : <Plus className="w-5 h-5 wf-fg-faint" />}
              </div>
              <p className="text-sm wf-fg-muted mb-3">No {getItemLabel()}s added yet</p>
              <button
                onClick={addItem}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-indigo-400 bg-indigo-500/10 rounded-lg hover:bg-indigo-500/20 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add {getItemLabel()}
              </button>
            </div>
          ) : (
            <>
              {items.map((item, i) => (
                <div key={i} className="flex gap-2 items-center group p-2 wf-bg-overlay rounded-xl border wf-border-subtle hover:wf-border-subtle transition-colors">
                  {/* Index indicator */}
                  <div className="w-6 h-6 rounded-lg wf-bg-overlay flex items-center justify-center text-xs font-medium wf-fg-muted shrink-0">
                    {i + 1}
                  </div>

                  {/* Item editor */}
                  <div className="flex-1 min-w-0">
                    {itemOptions ? (
                      <SelectInput
                        value={item}
                        onChange={v => updateItem(i, v)}
                        options={itemOptions}
                      />
                    ) : isPathArray && typeof item === 'object' && item !== null ? (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <TextInputWithVariables
                            value={item.path || ''}
                            onChange={v => updateItemPath(i, v)}
                            placeholder="Enter file path..."
                            upstreamNodes={upstreamNodes}
                            workflowVariables={workflowVariables}
                          />
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              const api = (window as any).desktopAPI;
                              if (!api?.pickFiles) return;
                              const result = await api.pickFiles({ title: 'Select File', multiple: false });
                              if (result?.ok && result.files?.length > 0) {
                                const file = result.files[0];
                                updateItemPath(i, typeof file === 'string' ? file : file.path);
                              }
                            } catch {}
                          }}
                          className="px-3 py-2 wf-bg-overlay border wf-border-subtle rounded-lg wf-fg-muted hover:text-indigo-400 hover:border-indigo-500/40 transition-colors shrink-0"
                          title="Browse files"
                        >
                          <FolderOpen className="w-4 h-4" />
                        </button>
                      </div>
                    ) : typeof item === 'object' && item !== null ? (
                      <textarea
                        value={JSON.stringify(item, null, 2)}
                        onChange={e => {
                          try { updateItem(i, JSON.parse(e.target.value)); } catch { /* ignore */ }
                        }}
                        className="w-full px-3 py-2 text-xs font-mono wf-bg-overlay border wf-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 resize-none"
                        rows={3}
                      />
                    ) : (
                      <TextInputWithVariables
                        value={String(item || '')}
                        onChange={v => updateItem(i, v)}
                        placeholder={`Enter ${getItemLabel()}...`}
                        upstreamNodes={upstreamNodes}
                        workflowVariables={workflowVariables}
                      />
                    )}
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={() => removeItem(i)}
                    className="p-2 wf-fg-faint hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <button
                onClick={addItem}
                className="w-full py-2.5 border border-dashed wf-border-subtle rounded-xl text-xs font-semibold wf-fg-muted hover:text-indigo-400 hover:border-indigo-500/40 hover:bg-indigo-500/10 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add {getItemLabel()}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
