/**
 * StatePanel - Visual state variable manager for React-like useState in custom UI
 * Allows adding, editing, and deleting state variables without writing code.
 */

import React, { useState, useCallback } from 'react';
import type { UIStateVariable, UIStateVarType } from '../types';

interface StatePanelProps {
  stateVariables: UIStateVariable[];
  onChange: (vars: UIStateVariable[]) => void;
}

const TYPE_OPTIONS: { value: UIStateVarType; label: string; defaultValue: any }[] = [
  { value: 'string', label: 'Text', defaultValue: '' },
  { value: 'number', label: 'Number', defaultValue: 0 },
  { value: 'boolean', label: 'Boolean', defaultValue: false },
  { value: 'array', label: 'List', defaultValue: [] },
  { value: 'object', label: 'Object', defaultValue: {} },
];

function generateId() {
  return 'sv_' + Math.random().toString(36).slice(2, 8);
}

export function StatePanel({ stateVariables, onChange }: StatePanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<UIStateVarType>('string');
  const [newDefault, setNewDefault] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = useCallback(() => {
    if (!newName.trim()) return;
    const name = newName.trim().replace(/\s+/g, '_');
    // Check for duplicate names
    if (stateVariables.some(v => v.name === name)) return;

    const typeOpt = TYPE_OPTIONS.find(t => t.value === newType);
    let defaultValue: any = typeOpt?.defaultValue ?? '';
    // Parse default value based on type
    if (newDefault.trim()) {
      try {
        if (newType === 'number') defaultValue = Number(newDefault) || 0;
        else if (newType === 'boolean') defaultValue = newDefault.toLowerCase() === 'true';
        else if (newType === 'array' || newType === 'object') defaultValue = JSON.parse(newDefault);
        else defaultValue = newDefault;
      } catch {
        defaultValue = typeOpt?.defaultValue ?? '';
      }
    }

    onChange([...stateVariables, {
      id: generateId(),
      name,
      type: newType,
      defaultValue,
    }]);
    setNewName('');
    setNewType('string');
    setNewDefault('');
    setShowAdd(false);
  }, [newName, newType, newDefault, stateVariables, onChange]);

  const handleDelete = useCallback((id: string) => {
    onChange(stateVariables.filter(v => v.id !== id));
  }, [stateVariables, onChange]);

  const handleUpdate = useCallback((id: string, updates: Partial<UIStateVariable>) => {
    onChange(stateVariables.map(v => v.id === id ? { ...v, ...updates } : v));
  }, [stateVariables, onChange]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uib-fg-muted uppercase tracking-wider">State Variables</div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-2 py-0.5 rounded bg-rose-500/10 text-rose-500 hover:bg-rose-500/15 border border-rose-500/30"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <div className="uib-surface-2 rounded-lg p-2.5 border uib-border flex flex-col gap-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Variable name (e.g. count)"
            className="w-full px-2 py-1 text-xs border uib-border rounded uib-surface focus:border-rose-500/50 focus:outline-none"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <div className="flex gap-2">
            <select
              value={newType}
              onChange={e => setNewType(e.target.value as UIStateVarType)}
              className="flex-1 px-2 py-1 text-xs border uib-border rounded uib-surface focus:border-rose-500/50 focus:outline-none"
            >
              {TYPE_OPTIONS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={newDefault}
              onChange={e => setNewDefault(e.target.value)}
              placeholder="Default"
              className="flex-1 px-2 py-1 text-xs border uib-border rounded uib-surface focus:border-rose-500/50 focus:outline-none"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!newName.trim()}
            className="w-full py-1 text-xs rounded bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add Variable
          </button>
        </div>
      )}

      {stateVariables.length === 0 && !showAdd && (
        <div className="text-xs uib-fg-faint text-center py-3">
          No state variables yet. Add one to enable reactive UI.
        </div>
      )}

      <div className="flex flex-col gap-1">
        {stateVariables.map(v => (
          <div
            key={v.id}
            className="group flex items-center gap-2 px-2 py-1.5 rounded-md uib-surface border uib-border hover:border-rose-500/40 transition-colors"
          >
            <div className="flex-1 min-w-0">
              {editingId === v.id ? (
                <input
                  type="text"
                  value={v.name}
                  onChange={e => handleUpdate(v.id, { name: e.target.value.replace(/\s+/g, '_') })}
                  onBlur={() => setEditingId(null)}
                  onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                  className="w-full px-1 py-0 text-xs border border-rose-500/40 rounded uib-surface focus:outline-none"
                  autoFocus
                />
              ) : (
                <div
                  className="text-xs font-mono uib-fg truncate cursor-pointer"
                  onClick={() => setEditingId(v.id)}
                  title={`Click to rename. Type: ${v.type}, Default: ${JSON.stringify(v.defaultValue)}`}
                >
                  <span className="text-rose-500">$</span>{v.name}
                </div>
              )}
            </div>
            <span className="text-[10px] uib-fg-faint font-mono px-1 py-0.5 rounded uib-surface-2 border uib-border-subtle">
              {v.type}
            </span>
            <button
              onClick={() => handleDelete(v.id)}
              className="opacity-0 group-hover:opacity-100 uib-fg-faint hover:text-red-400 text-xs transition-opacity"
              title="Delete variable"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {stateVariables.length > 0 && (
        <div className="text-[10px] uib-fg-faint mt-1">
          Use <code className="uib-surface-2 px-1 rounded">{'$state.varName'}</code> in tool args to reference state.
        </div>
      )}
    </div>
  );
}
