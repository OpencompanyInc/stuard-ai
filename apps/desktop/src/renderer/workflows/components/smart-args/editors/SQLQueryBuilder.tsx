/**
 * TableQueryEditor - Visual table query builder for non-technical users
 * Zero SQL terminology. Generates SQL under the hood.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, ChevronDown, Check, Search, PenLine, PlusCircle, Trash, ArrowUpDown } from 'lucide-react';

interface TableQueryEditorProps {
  value: string;
  onChange: (sql: string) => void;
}

type Action = 'find' | 'add' | 'update' | 'remove';

interface Filter {
  field: string;
  op: string;
  value: string;
}

interface FieldValue {
  field: string;
  value: string;
}

const ACTIONS: { value: Action; label: string; description: string; icon: React.ReactNode; color: string }[] = [
  { value: 'find', label: 'Find Rows', description: 'Look up data in a table', icon: <Search className="w-4 h-4" />, color: 'indigo' },
  { value: 'add', label: 'Add Row', description: 'Put new data into a table', icon: <PlusCircle className="w-4 h-4" />, color: 'emerald' },
  { value: 'update', label: 'Edit Rows', description: 'Change existing data', icon: <PenLine className="w-4 h-4" />, color: 'amber' },
  { value: 'remove', label: 'Remove Rows', description: 'Delete data from a table', icon: <Trash className="w-4 h-4" />, color: 'red' },
];

const FILTER_OPS = [
  { value: '=', label: 'is' },
  { value: '!=', label: 'is not' },
  { value: '>', label: 'is more than' },
  { value: '<', label: 'is less than' },
  { value: '>=', label: 'is at least' },
  { value: '<=', label: 'is at most' },
  { value: 'LIKE', label: 'contains' },
  { value: 'IS NULL', label: 'is empty' },
  { value: 'IS NOT NULL', label: 'is not empty' },
];

const SORT_DIRS = [
  { value: '', label: 'No sorting' },
  { value: 'ASC', label: 'A → Z (smallest first)' },
  { value: 'DESC', label: 'Z → A (largest first)' },
];

function detectAction(sql: string): Action {
  const s = sql.trim().toUpperCase();
  if (s.startsWith('INSERT')) return 'add';
  if (s.startsWith('UPDATE')) return 'update';
  if (s.startsWith('DELETE')) return 'remove';
  return 'find';
}

function parseSQL(sql: string): {
  action: Action; table: string; fields: string;
  filters: Filter[]; values: FieldValue[];
  limit: number; sortField: string; sortDir: string;
} | null {
  if (!sql || /CREATE\s+TABLE/i.test(sql)) return null;
  const s = sql.trim();
  const action = detectAction(s);
  let table = '';
  const filters: Filter[] = [];
  const values: FieldValue[] = [];
  let fields = '*';
  let limit = 100;
  let sortField = '';
  let sortDir = '';

  if (action === 'find') {
    const m = s.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)/i);
    if (m) { fields = m[1]; table = m[2]; }
    const lm = s.match(/LIMIT\s+(\d+)/i);
    if (lm) limit = parseInt(lm[1]);
    const om = s.match(/ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
    if (om) { sortField = om[1]; sortDir = (om[2] || '').toUpperCase(); }
  } else if (action === 'add') {
    const m = s.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (m) {
      table = m[1];
      const cols = m[2].split(',').map(c => c.trim());
      const vals = m[3].split(',').map(v => v.trim().replace(/^'|'$/g, '').replace(/^\?$/, ''));
      cols.forEach((col, i) => values.push({ field: col, value: vals[i] || '' }));
    }
  } else if (action === 'update') {
    const m = s.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE|$)/i);
    if (m) {
      table = m[1];
      m[2].split(',').map(p => p.trim()).forEach(p => {
        const [col, ...rest] = p.split('=');
        if (col) values.push({ field: col.trim(), value: rest.join('=').trim().replace(/^'|'$/g, '').replace(/^\?$/, '') });
      });
    }
  } else if (action === 'remove') {
    const m = s.match(/DELETE\s+FROM\s+(\w+)/i);
    if (m) table = m[1];
  }

  const wm = s.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|$)/i);
  if (wm) {
    wm[1].split(/\s+AND\s+/i).forEach(part => {
      const cm = part.match(/(\w+)\s*(=|!=|>=|<=|>|<|LIKE|IS\s+NOT\s+NULL|IS\s+NULL)\s*(.*)$/i);
      if (cm) filters.push({ field: cm[1], op: cm[2].toUpperCase().replace(/\s+/g, ' '), value: (cm[3] || '').trim().replace(/^'|'$/g, '').replace(/^\?$/, '') });
    });
  }

  return { action, table, fields, filters, values, limit, sortField, sortDir };
}

function InlineSelect({ value, onChange, options, className }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1.5 text-xs border border-white/[0.08] rounded-lg bg-white/[0.04] hover:bg-white/[0.06] hover:border-white/[0.12] transition-all cursor-pointer whitespace-nowrap font-medium text-white/70"
      >
        {selected?.label || value}
        <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 left-0 mt-1 min-w-[160px] bg-white/[0.04] border border-white/[0.04] rounded-xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="p-1 max-h-48 overflow-y-auto">
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full px-3 py-1.5 text-left text-xs rounded-lg flex items-center justify-between gap-2 transition-colors mb-0.5 ${
                  opt.value === value ? 'bg-indigo-500/10 text-indigo-400 font-medium' : 'text-white/80 hover:bg-white/[0.06]'
                }`}
              >
                {opt.label}
                {opt.value === value && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SQLQueryBuilder({ value, onChange }: TableQueryEditorProps) {
  const parsed = parseSQL(value);
  const [action, setAction] = useState<Action>(parsed?.action || 'find');
  const [table, setTable] = useState(parsed?.table || '');
  const [fields, setFields] = useState(parsed?.fields || '*');
  const [filters, setFilters] = useState<Filter[]>(parsed?.filters || []);
  const [values, setValues] = useState<FieldValue[]>(parsed?.values || [{ field: '', value: '' }]);
  const [limit, setLimit] = useState(parsed?.limit || 100);
  const [sortField, setSortField] = useState(parsed?.sortField || '');
  const [sortDir, setSortDir] = useState(parsed?.sortDir || '');

  const buildSQL = useCallback((): string => {
    if (!table.trim()) return '';
    const params: string[] = [];

    const buildFilters = () => {
      if (filters.length === 0) return '';
      const clauses = filters.filter(f => f.field.trim()).map(f => {
        if (f.op === 'IS NULL' || f.op === 'IS NOT NULL') return `${f.field} ${f.op}`;
        if (f.op === 'LIKE') return `${f.field} LIKE '%${f.value}%'`;
        return `${f.field} ${f.op} '${f.value}'`;
      });
      return clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    };

    switch (action) {
      case 'find': {
        let sql = `SELECT ${fields || '*'} FROM ${table}`;
        sql += buildFilters();
        if (sortField.trim() && sortDir) sql += ` ORDER BY ${sortField} ${sortDir}`;
        sql += ` LIMIT ${limit}`;
        return sql;
      }
      case 'add': {
        const valid = values.filter(v => v.field.trim());
        if (valid.length === 0) return '';
        const cols = valid.map(v => v.field).join(', ');
        const vals = valid.map(v => `'${v.value}'`).join(', ');
        return `INSERT INTO ${table} (${cols}) VALUES (${vals})`;
      }
      case 'update': {
        const valid = values.filter(v => v.field.trim());
        if (valid.length === 0) return '';
        const sets = valid.map(v => `${v.field} = '${v.value}'`).join(', ');
        return `UPDATE ${table} SET ${sets}${buildFilters()}`;
      }
      case 'remove': {
        return `DELETE FROM ${table}${buildFilters()}`;
      }
    }
  }, [action, table, fields, filters, values, limit, sortField, sortDir]);

  useEffect(() => {
    const sql = buildSQL();
    if (sql) onChange(sql);
  }, [action, table, fields, filters, values, limit, sortField, sortDir, buildSQL, onChange]);

  const addFilter = () => setFilters([...filters, { field: '', op: '=', value: '' }]);
  const removeFilter = (i: number) => setFilters(filters.filter((_, idx) => idx !== i));
  const updateFilter = (i: number, u: Partial<Filter>) => setFilters(filters.map((f, idx) => idx === i ? { ...f, ...u } : f));

  const addValue = () => setValues([...values, { field: '', value: '' }]);
  const removeValue = (i: number) => setValues(values.filter((_, idx) => idx !== i));
  const updateValue = (i: number, u: Partial<FieldValue>) => setValues(values.map((v, idx) => idx === i ? { ...v, ...u } : v));

  const actionColors: Record<Action, string> = {
    find: 'indigo',
    add: 'emerald',
    update: 'amber',
    remove: 'red',
  };
  const c = actionColors[action];

  return (
    <div className="space-y-3">
      {/* Action Cards */}
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map(a => {
          const isActive = action === a.value;
          const colorMap: Record<string, string> = {
            indigo: isActive ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-sm' : '',
            emerald: isActive ? 'bg-emerald-500/10 border-emerald-200 text-emerald-700 shadow-sm' : '',
            amber: isActive ? 'bg-amber-500/10 border-amber-200 text-amber-700 shadow-sm' : '',
            red: isActive ? 'bg-red-500/10 border-red-200 text-red-700 shadow-sm' : '',
          };
          return (
            <button
              key={a.value}
              type="button"
              onClick={() => setAction(a.value)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all text-left ${
                isActive
                  ? colorMap[a.color]
                  : 'bg-white/[0.04] border-white/[0.08] text-white/70 hover:bg-white/[0.06] hover:border-white/[0.12]'
              }`}
            >
              <div className={`shrink-0 ${isActive ? '' : 'text-white/40'}`}>{a.icon}</div>
              <div>
                <div className="text-xs font-semibold leading-tight">{a.label}</div>
                <div className={`text-[10px] leading-tight mt-0.5 ${isActive ? 'opacity-70' : 'text-white/40'}`}>{a.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Main Form */}
      <div className="space-y-3 p-3 bg-white/[0.06] rounded-xl border border-white/[0.08]">
        {/* Table Name */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-white/70">Table name</label>
          <input
            type="text"
            value={table}
            onChange={e => setTable(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            placeholder="e.g. customers, products, orders"
            className="w-full px-3 py-2 text-sm border border-white/[0.08] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 bg-white/[0.04] font-medium"
          />
        </div>

        {/* FIND: Which fields */}
        {action === 'find' && (
          <>
            <div className="space-y-1">
              <label className="text-xs font-medium text-white/70">
                Which fields to show <span className="text-white/40 font-normal">(leave as * for all)</span>
              </label>
              <input
                type="text"
                value={fields}
                onChange={e => setFields(e.target.value)}
                placeholder="* (everything)"
                className="w-full px-3 py-2 text-sm border border-white/[0.08] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 bg-white/[0.04]"
              />
            </div>
          </>
        )}

        {/* ADD / EDIT: Field-Value Pairs */}
        {(action === 'add' || action === 'update') && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/70">
              {action === 'add' ? 'Data to add' : 'Fields to change'}
            </label>
            <div className="space-y-1.5">
              {values.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5 p-2 bg-white/[0.04] rounded-lg border border-white/[0.08]">
                  <input
                    type="text"
                    value={v.field}
                    onChange={e => updateValue(i, { field: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                    placeholder="field name"
                    className="flex-1 min-w-0 px-2 py-1 text-sm border border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 bg-white/[0.06] font-medium"
                  />
                  <span className="text-white/40 text-sm">=</span>
                  <input
                    type="text"
                    value={v.value}
                    onChange={e => updateValue(i, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1 min-w-0 px-2 py-1 text-sm border border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 bg-white/[0.06]"
                  />
                  <button
                    type="button"
                    onClick={() => removeValue(i)}
                    disabled={values.length <= 1}
                    className="p-1 text-white/40 hover:text-red-500 disabled:opacity-30 transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addValue}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white/50 hover:text-indigo-400 bg-white/[0.04] hover:bg-indigo-500/200/10 border border-dashed border-white/[0.12] hover:border-indigo-500/40 rounded-lg transition-all"
              >
                <Plus className="w-3 h-3" />
                Add field
              </button>
            </div>
          </div>
        )}

        {/* Filters (for find, edit, remove) */}
        {(action === 'find' || action === 'update' || action === 'remove') && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-white/70">
              Only where... <span className="text-white/40 font-normal">(optional — narrow down which rows)</span>
            </label>
            {filters.length > 0 && (
              <div className="space-y-1.5">
                {filters.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 p-2 bg-white/[0.04] rounded-lg border border-white/[0.08]">
                    <input
                      type="text"
                      value={f.field}
                      onChange={e => updateFilter(i, { field: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
                      placeholder="field"
                      className="flex-1 min-w-0 px-2 py-1 text-sm border border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 bg-white/[0.06] font-medium"
                    />
                    <InlineSelect
                      value={f.op}
                      onChange={op => updateFilter(i, { op })}
                      options={FILTER_OPS}
                      className="shrink-0"
                    />
                    {f.op !== 'IS NULL' && f.op !== 'IS NOT NULL' && (
                      <input
                        type="text"
                        value={f.value}
                        onChange={e => updateFilter(i, { value: e.target.value })}
                        placeholder="value"
                        className="flex-1 min-w-0 px-2 py-1 text-sm border border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 bg-white/[0.06]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeFilter(i)}
                      className="p-1 text-white/40 hover:text-red-500 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={addFilter}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white/50 hover:text-indigo-400 bg-white/[0.04] hover:bg-indigo-500/200/10 border border-dashed border-white/[0.12] hover:border-indigo-500/40 rounded-lg transition-all"
            >
              <Plus className="w-3 h-3" />
              Add condition
            </button>
          </div>
        )}

        {/* FIND: Sort & Limit */}
        {action === 'find' && (
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-white/70 flex items-center gap-1">
                <ArrowUpDown className="w-3 h-3" />
                Sort by
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={sortField}
                  onChange={e => setSortField(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  placeholder="field name"
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 bg-white/[0.04]"
                />
                {sortField.trim() && (
                  <InlineSelect
                    value={sortDir || 'ASC'}
                    onChange={setSortDir}
                    options={SORT_DIRS.filter(d => d.value)}
                    className="shrink-0"
                  />
                )}
              </div>
            </div>
            <div className="w-20 space-y-1">
              <label className="text-xs font-medium text-white/70">Max rows</label>
              <input
                type="number"
                value={limit}
                onChange={e => setLimit(Math.max(1, parseInt(e.target.value) || 100))}
                min={1}
                className="w-full px-2.5 py-1.5 text-sm border border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 bg-white/[0.04]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

