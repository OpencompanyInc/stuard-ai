/**
 * CreateTableEditor - Visual table builder that generates SQL
 * Lets non-technical users define a table with columns, types, and options
 * without writing any SQL.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, GripVertical, ChevronDown, Check } from 'lucide-react';

interface Column {
  name: string;
  type: string;
  primaryKey?: boolean;
  notNull?: boolean;
  defaultValue?: string;
}

interface CreateTableEditorProps {
  value: string; // current SQL query string
  onChange: (sql: string) => void;
}

const COLUMN_TYPES = [
  { value: 'TEXT', label: 'Text', description: 'Names, emails, descriptions' },
  { value: 'INTEGER', label: 'Number (whole)', description: 'Counts, ages, IDs' },
  { value: 'REAL', label: 'Number (decimal)', description: 'Prices, scores, percentages' },
  { value: 'BOOLEAN', label: 'Yes / No', description: 'Flags, toggles, status' },
  { value: 'BLOB', label: 'Binary data', description: 'Files, images (raw bytes)' },
];

const DEFAULT_COLUMNS: Column[] = [
  { name: 'id', type: 'TEXT', primaryKey: true, notNull: true },
  { name: 'name', type: 'TEXT', notNull: false },
  { name: 'value', type: 'TEXT', notNull: false },
];

function parseExistingSQL(sql: string): { tableName: string; columns: Column[] } | null {
  if (!sql) return null;
  const match = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]+)\)/i);
  if (!match) return null;

  const tableName = match[1];
  const colDefs = match[2].split(',').map(s => s.trim()).filter(Boolean);
  const columns: Column[] = [];

  for (const def of colDefs) {
    const parts = def.split(/\s+/);
    if (parts.length < 2) continue;
    const name = parts[0];
    const type = parts[1].toUpperCase();
    const rest = def.toUpperCase();
    columns.push({
      name,
      type: COLUMN_TYPES.find(t => t.value === type)?.value || 'TEXT',
      primaryKey: rest.includes('PRIMARY KEY'),
      notNull: rest.includes('NOT NULL') || rest.includes('PRIMARY KEY'),
      defaultValue: (() => {
        const dm = def.match(/DEFAULT\s+(.+?)(?:,|$)/i);
        return dm ? dm[1].trim() : undefined;
      })(),
    });
  }

  return columns.length > 0 ? { tableName, columns } : null;
}

function buildSQL(tableName: string, columns: Column[]): string {
  if (!tableName.trim() || columns.length === 0) return '';
  const colDefs = columns.map(col => {
    let def = `  ${col.name} ${col.type}`;
    if (col.primaryKey) def += ' PRIMARY KEY';
    if (col.notNull && !col.primaryKey) def += ' NOT NULL';
    if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
    return def;
  });
  return `CREATE TABLE IF NOT EXISTS ${tableName.trim()} (\n${colDefs.join(',\n')}\n)`;
}

function ColumnTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = COLUMN_TYPES.find(t => t.value === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm border wf-border-subtle rounded-lg wf-bg-overlay wf-hover-bg transition-all cursor-pointer"
      >
        <span className="wf-fg font-medium whitespace-nowrap">{selected?.label || 'Text'}</span>
        <ChevronDown className={`w-3.5 h-3.5 wf-fg-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 right-0 mt-1.5 w-56 bg-white/[0.04] border border-white/[0.04] rounded-xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="p-1">
            {COLUMN_TYPES.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full px-3 py-2 text-left text-sm rounded-lg flex items-center justify-between gap-2 transition-colors mb-0.5 ${
                  opt.value === value
                    ? 'wf-accent-chip font-medium'
                    : 'wf-fg wf-hover-bg'
                }`}
              >
                <div>
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-[11px] wf-fg-faint font-normal">{opt.description}</div>
                </div>
                {opt.value === value && <Check className="w-4 h-4 wf-accent-fg shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CreateTableEditor({ value, onChange }: CreateTableEditorProps) {
  const parsed = parseExistingSQL(value);
  const [tableName, setTableName] = useState(parsed?.tableName || 'my_table');
  const [columns, setColumns] = useState<Column[]>(parsed?.columns || DEFAULT_COLUMNS);
  const [showRaw, setShowRaw] = useState(false);

  const updateSQL = useCallback(() => {
    const sql = buildSQL(tableName, columns);
    if (sql) onChange(sql);
  }, [tableName, columns, onChange]);

  useEffect(() => {
    updateSQL();
  }, [tableName, columns, updateSQL]);

  const addColumn = () => {
    setColumns([...columns, { name: '', type: 'TEXT', notNull: false }]);
  };

  const removeColumn = (index: number) => {
    if (columns.length <= 1) return;
    setColumns(columns.filter((_, i) => i !== index));
  };

  const updateColumn = (index: number, updates: Partial<Column>) => {
    setColumns(columns.map((col, i) => i === index ? { ...col, ...updates } : col));
  };

  const setPrimaryKey = (index: number) => {
    setColumns(columns.map((col, i) => ({
      ...col,
      primaryKey: i === index,
      notNull: i === index ? true : col.notNull,
    })));
  };

  return (
    <div className="space-y-4">
      {/* Table Name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium wf-fg-muted">Table Name</label>
        <input
          type="text"
          value={tableName}
          onChange={e => setTableName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
          placeholder="my_table"
          className="w-full px-3 py-2 text-sm border wf-border-subtle rounded-xl focus:outline-none wf-bg-overlay wf-fg font-medium"
        />
      </div>

      {/* Columns */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium wf-fg-muted">Columns</label>
          <span className="text-[10px] wf-fg-faint">{columns.length} column{columns.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="space-y-2">
          {columns.map((col, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-2.5 wf-bg-overlay rounded-xl border wf-border-subtle group wf-hover-bg transition-colors"
            >
              <GripVertical className="w-3.5 h-3.5 wf-fg-faint shrink-0" />

              {/* Column Name */}
              <input
                type="text"
                value={col.name}
                onChange={e => updateColumn(i, { name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                placeholder="column_name"
                className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border wf-border-subtle rounded-lg focus:outline-none wf-bg-overlay wf-fg font-mono"
              />

              {/* Column Type - Custom dropdown */}
              <ColumnTypeSelect
                value={col.type}
                onChange={type => updateColumn(i, { type })}
              />

              {/* Primary Key Badge */}
              <button
                type="button"
                onClick={() => setPrimaryKey(i)}
                title={col.primaryKey ? 'Primary key (unique ID)' : 'Set as primary key'}
                className={`shrink-0 px-2 py-1 text-[10px] font-semibold rounded-md border transition-all ${
                  col.primaryKey
                    ? 'bg-amber-500/10 border-amber-200 text-amber-700'
                    : 'wf-bg-overlay wf-border-subtle wf-fg-faint wf-hover-fg wf-hover-bg'
                }`}
              >
                ID
              </button>

              {/* Required Toggle */}
              <button
                type="button"
                onClick={() => updateColumn(i, { notNull: !col.notNull })}
                title={col.notNull ? 'Required field' : 'Optional field'}
                className={`shrink-0 px-2 py-1 text-[10px] font-semibold rounded-md border transition-all ${
                  col.notNull
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'wf-bg-overlay wf-border-subtle wf-fg-faint wf-hover-fg wf-hover-bg'
                }`}
              >
                {col.notNull ? 'Required' : 'Optional'}
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={() => removeColumn(i)}
                disabled={columns.length <= 1}
                className="shrink-0 p-1 wf-fg-faint hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Remove column"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        {/* Add Column */}
        <button
          type="button"
          onClick={addColumn}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium wf-fg-muted hover:wf-accent-fg wf-bg-overlay hover:wf-accent-soft-bg border border-dashed wf-border-subtle hover:border-[color:color-mix(in_srgb,var(--wf-accent)_40%,transparent)] rounded-xl transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Column
        </button>
      </div>

      {/* Show/Hide SQL Preview */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowRaw(!showRaw)}
          className="text-[11px] wf-fg-faint hover:wf-accent-fg transition-colors"
        >
          {showRaw ? 'Hide' : 'Show'} generated SQL
        </button>
        {showRaw && (
          <code className="block mt-1.5 p-2.5 wf-bg-overlay rounded-xl border wf-border-subtle text-[11px] font-mono wf-fg-muted whitespace-pre leading-relaxed">
            {buildSQL(tableName, columns) || '-- define a table name and at least one column'}
          </code>
        )}
      </div>
    </div>
  );
}

