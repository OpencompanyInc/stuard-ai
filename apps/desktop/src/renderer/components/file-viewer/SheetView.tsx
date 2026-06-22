import React from 'react';
import { clsx } from 'clsx';
import {
  Loader2,
  AlertCircle,
  Table2,
  BarChart3,
  Search,
  ArrowUp,
  ArrowDown,
  Hash,
  Type,
} from 'lucide-react';
import { isBinarySheetExt } from './renderers';

// ─────────────────────────────────────────────────────────────────────────────
// Tabular preview ("data view")
//
// Renders CSV / TSV / XLSX as an interactive, sortable table with a one-click
// Summary view (per-column type + stats). Designed to be readable at a glance:
// large rows, zebra striping, numeric columns right-aligned, sticky header.
// xlsx parsing lazy-loads SheetJS so the workbook parser stays out of the main
// bundle and only loads when someone actually opens a spreadsheet.
// ─────────────────────────────────────────────────────────────────────────────

// Hard caps so a giant export can't lock up the renderer. We parse a generous
// slice for stats and render a (smaller) window of rows.
const PARSE_ROW_CAP = 50_000;
const RENDER_ROW_CAP = 4_000;

interface ParsedSheet {
  /** Workbook sheet names (single entry for CSV/TSV). */
  sheetNames: string[];
  /** name → rows (array of cell arrays, including the header row at [0]). */
  sheets: Record<string, string[][]>;
  truncated: boolean;
}

interface SheetViewProps {
  name: string;
  ext: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

// ── CSV / TSV parser ────────────────────────────────────────────────────────
// Handles quoted fields, escaped quotes ("") and newlines inside quotes.
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      if (rows.length >= PARSE_ROW_CAP) return rows;
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Trailing field/row (file without final newline)
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

async function parseWorkbook(base64: string): Promise<ParsedSheet> {
  // Lazy import — keeps SheetJS out of the main chunk.
  const XLSX: any = await import('xlsx');
  const wb = XLSX.read(base64, { type: 'base64' });
  const sheets: Record<string, string[][]> = {};
  let truncated = false;
  for (const sn of wb.SheetNames as string[]) {
    const ws = wb.Sheets[sn];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    }) as any[][];
    let rows = aoa.map((r) => r.map((c) => (c == null ? '' : String(c))));
    if (rows.length > PARSE_ROW_CAP) {
      rows = rows.slice(0, PARSE_ROW_CAP);
      truncated = true;
    }
    sheets[sn] = rows;
  }
  return { sheetNames: wb.SheetNames, sheets, truncated };
}

// ── numeric helpers ───────────────────────────────────────────────────────────
function toNumber(value: string): number | null {
  if (value == null) return null;
  const cleaned = value.trim().replace(/[$£€,%\s]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 0.001 || abs >= 1e12)) return n.toExponential(2);
  const rounded = Math.round(n * 1000) / 1000;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

interface ColumnStat {
  header: string;
  filled: number;
  total: number;
  distinct: number;
  isNumeric: boolean;
  min?: number;
  max?: number;
  mean?: number;
  sum?: number;
  topValue?: string;
  topCount?: number;
}

function computeStats(headers: string[], body: string[][]): ColumnStat[] {
  return headers.map((header, col) => {
    const values: string[] = [];
    for (const r of body) {
      const v = (r[col] ?? '').trim();
      if (v !== '') values.push(v);
    }
    const distinctSet = new Set(values);
    const nums = values.map(toNumber).filter((x): x is number => x != null);
    const isNumeric = values.length > 0 && nums.length / values.length >= 0.7;

    const stat: ColumnStat = {
      header: header || `Column ${col + 1}`,
      filled: values.length,
      total: body.length,
      distinct: distinctSet.size,
      isNumeric,
    };

    if (isNumeric && nums.length > 0) {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (const x of nums) {
        if (x < min) min = x;
        if (x > max) max = x;
        sum += x;
      }
      stat.min = min;
      stat.max = max;
      stat.sum = sum;
      stat.mean = sum / nums.length;
    } else {
      // Most common value for categorical columns.
      const counts = new Map<string, number>();
      let topValue = '';
      let topCount = 0;
      for (const v of values) {
        const c = (counts.get(v) || 0) + 1;
        counts.set(v, c);
        if (c > topCount) {
          topCount = c;
          topValue = v;
        }
      }
      stat.topValue = topValue;
      stat.topCount = topCount;
    }
    return stat;
  });
}

export const SheetView: React.FC<SheetViewProps> = ({ ext, content, encoding }) => {
  const [parsed, setParsed] = React.useState<ParsedSheet | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [activeSheet, setActiveSheet] = React.useState<string>('');
  const [view, setView] = React.useState<'table' | 'summary'>('table');
  const [filter, setFilter] = React.useState('');
  const [sort, setSort] = React.useState<{ col: number; dir: 'asc' | 'desc' } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setParsed(null);
    setSort(null);
    setFilter('');

    async function run() {
      try {
        let result: ParsedSheet;
        if (isBinarySheetExt(ext)) {
          if (encoding !== 'base64') throw new Error('Unexpected workbook encoding');
          result = await parseWorkbook(content);
        } else {
          const delimiter = ext.toLowerCase() === 'tsv' ? '\t' : ',';
          const rows = parseDelimited(content, delimiter);
          result = {
            sheetNames: ['Sheet 1'],
            sheets: { 'Sheet 1': rows },
            truncated: rows.length >= PARSE_ROW_CAP,
          };
        }
        if (cancelled) return;
        setParsed(result);
        setActiveSheet(result.sheetNames[0] || '');
        setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Could not read this spreadsheet');
        setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [ext, content, encoding]);

  const rows = (parsed && parsed.sheets[activeSheet]) || [];
  const headers = rows.length > 0 ? rows[0] : [];
  const body = rows.length > 1 ? rows.slice(1) : [];

  const stats = React.useMemo(
    () => (view === 'summary' ? computeStats(headers, body) : []),
    [view, headers, body],
  );

  // Filter + sort the body for the table view.
  const visibleRows = React.useMemo(() => {
    let out = body;
    const q = filter.trim().toLowerCase();
    if (q) out = out.filter((r) => r.some((c) => (c ?? '').toLowerCase().includes(q)));
    if (sort) {
      const { col, dir } = sort;
      const factor = dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a[col] ?? '';
        const bv = b[col] ?? '';
        const an = toNumber(av);
        const bn = toNumber(bv);
        if (an != null && bn != null) return (an - bn) * factor;
        return av.localeCompare(bv) * factor;
      });
    }
    return out;
  }, [body, filter, sort]);

  const renderRows = visibleRows.slice(0, RENDER_ROW_CAP);
  const hiddenCount = visibleRows.length - renderRows.length;

  const toggleSort = (col: number) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      return null;
    });
  };

  if (loading) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-theme-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        <div className="text-[12px]">Reading spreadsheet…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-theme-muted p-6">
        <AlertCircle className="w-6 h-6 text-red-500/70" />
        <div className="text-[12px] font-semibold text-theme-fg">Couldn't open spreadsheet</div>
        <div className="text-[11px] text-center max-w-[260px]">{error}</div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col min-h-0 bg-theme-bg/30">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-theme/10 shrink-0">
        {/* Table / Summary switch */}
        <div className="flex items-center rounded-lg border border-theme/15 p-0.5 bg-theme-card/60">
          <SegBtn active={view === 'table'} onClick={() => setView('table')} icon={<Table2 className="w-3.5 h-3.5" />} label="Table" />
          <SegBtn active={view === 'summary'} onClick={() => setView('summary')} icon={<BarChart3 className="w-3.5 h-3.5" />} label="Summary" />
        </div>

        {/* Sheet selector (xlsx workbooks) */}
        {parsed && parsed.sheetNames.length > 1 && (
          <select
            value={activeSheet}
            onChange={(e) => {
              setActiveSheet(e.target.value);
              setSort(null);
            }}
            className="h-7 rounded-lg border border-theme/15 bg-theme-card/60 px-2 text-[12px] font-medium text-theme-fg outline-none"
            title="Choose a sheet"
          >
            {parsed.sheetNames.map((sn) => (
              <option key={sn} value={sn}>{sn}</option>
            ))}
          </select>
        )}

        {/* Row / column count */}
        <span className="text-[11px] font-semibold text-theme-muted">
          {body.length.toLocaleString()} {body.length === 1 ? 'row' : 'rows'} · {headers.length} {headers.length === 1 ? 'column' : 'columns'}
        </span>

        <div className="flex-1" />

        {/* Filter (table view only) */}
        {view === 'table' && (
          <div className="flex items-center gap-1.5 rounded-lg border border-theme/15 bg-theme-card/60 px-2 h-7">
            <Search className="w-3.5 h-3.5 text-theme-muted" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter rows…"
              className="bg-transparent outline-none text-[12px] text-theme-fg placeholder:text-theme-muted w-32"
            />
          </div>
        )}
      </div>

      {/* Body */}
      {body.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-theme-muted text-[12px]">
          This sheet is empty.
        </div>
      ) : view === 'summary' ? (
        <SummaryView stats={stats} />
      ) : (
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
          <table className="border-collapse text-[13px] w-max min-w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-theme-card">
                <th className="sticky left-0 z-20 bg-theme-card border-b border-r border-theme/10 px-2 py-2 text-[11px] font-bold text-theme-muted text-right w-12">
                  #
                </th>
                {headers.map((h, col) => {
                  const isSorted = sort?.col === col;
                  return (
                    <th
                      key={col}
                      onClick={() => toggleSort(col)}
                      className="border-b border-r border-theme/10 px-3 py-2 text-left font-bold text-theme-fg whitespace-nowrap cursor-pointer hover:bg-theme-hover select-none"
                      title="Click to sort"
                    >
                      <span className="inline-flex items-center gap-1">
                        {h || `Column ${col + 1}`}
                        {isSorted && (sort!.dir === 'asc'
                          ? <ArrowUp className="w-3 h-3 text-primary" />
                          : <ArrowDown className="w-3 h-3 text-primary" />)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {renderRows.map((r, ri) => (
                <tr key={ri} className={clsx(ri % 2 === 1 && 'bg-theme-card/40', 'hover:bg-theme-hover/60')}>
                  <td className="sticky left-0 z-[1] bg-inherit border-b border-r border-theme/10 px-2 py-1.5 text-[11px] text-theme-muted text-right tabular-nums">
                    {ri + 1}
                  </td>
                  {headers.map((_, col) => {
                    const cell = r[col] ?? '';
                    const numeric = toNumber(cell) != null && cell.trim() !== '';
                    return (
                      <td
                        key={col}
                        className={clsx(
                          'border-b border-r border-theme/10 px-3 py-1.5 text-theme-fg/90 whitespace-nowrap max-w-[360px] truncate',
                          numeric ? 'text-right tabular-nums' : 'text-left',
                        )}
                        title={cell}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {(hiddenCount > 0 || parsed?.truncated) && (
            <div className="px-3 py-2 text-[11px] text-theme-muted border-t border-theme/10">
              {hiddenCount > 0 && <>Showing first {RENDER_ROW_CAP.toLocaleString()} of {visibleRows.length.toLocaleString()} matching rows. </>}
              {parsed?.truncated && <>This file is very large and was truncated for preview.</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SegBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({
  active, onClick, icon, label,
}) => (
  <button
    onClick={onClick}
    className={clsx(
      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors',
      active ? 'bg-primary/15 text-primary' : 'text-theme-muted hover:text-theme-fg',
    )}
  >
    {icon}
    {label}
  </button>
);

const SummaryView: React.FC<{ stats: ColumnStat[] }> = ({ stats }) => (
  <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-3">
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
      {stats.map((s, i) => {
        const fillPct = s.total > 0 ? Math.round((s.filled / s.total) * 100) : 0;
        return (
          <div key={i} className="rounded-xl border border-theme/10 bg-theme-card/50 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              {s.isNumeric
                ? <Hash className="w-3.5 h-3.5 text-primary shrink-0" />
                : <Type className="w-3.5 h-3.5 text-theme-muted shrink-0" />}
              <span className="text-[13px] font-bold text-theme-fg truncate" title={s.header}>{s.header}</span>
            </div>
            <div className="text-[11px] text-theme-muted mb-2">
              {s.isNumeric ? 'Number' : 'Text'} · {s.filled.toLocaleString()} filled ({fillPct}%) · {s.distinct.toLocaleString()} distinct
            </div>
            {s.isNumeric ? (
              <div className="grid grid-cols-2 gap-1.5 text-[12px]">
                <Stat label="Min" value={formatNum(s.min ?? NaN)} />
                <Stat label="Max" value={formatNum(s.max ?? NaN)} />
                <Stat label="Mean" value={formatNum(s.mean ?? NaN)} />
                <Stat label="Sum" value={formatNum(s.sum ?? NaN)} />
              </div>
            ) : (
              <div className="text-[12px]">
                <Stat label="Most common" value={s.topValue ? `${s.topValue}` : '—'} />
                {s.topValue && (
                  <div className="text-[11px] text-theme-muted mt-0.5">{s.topCount?.toLocaleString()} occurrences</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-theme-muted">{label}</div>
    <div className="text-[12.5px] font-semibold text-theme-fg truncate" title={value}>{value}</div>
  </div>
);
