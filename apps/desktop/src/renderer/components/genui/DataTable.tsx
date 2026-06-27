import React, { useState, useMemo, useCallback } from 'react';
import { ChevronUp, ChevronDown, Search, Filter, MoreHorizontal, Maximize2, X } from 'lucide-react';
import clsx from 'clsx';
import { RichText } from './RichText';
import { AnimatePresence, motion } from 'framer-motion';

export interface Column<T = any> {
  key: string;
  header: string;
  width?: number | string;
  render?: (value: any, item: T) => React.ReactNode;
  sortable?: boolean;
  truncate?: boolean; // Default true
}

export interface DataTableProps<T = any> {
  columns: Column<T>[];
  data: T[];
  title?: string;
  onRowClick?: (item: T) => void;
  pageSize?: number;
  expandable?: boolean; // Allow expanding rows to see full details
}

export const DataTable: React.FC<DataTableProps> = ({
  columns,
  data,
  title,
  onRowClick,
  pageSize = 5,
  expandable = true
}) => {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Stop propagation to prevent triggering parent click handlers
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filteredData = useMemo(() => {
    let result = [...data];

    // Filter
    if (filter) {
      const lower = filter.toLowerCase();
      result = result.filter(item => 
        Object.values(item as any).some(val => 
          String(val).toLowerCase().includes(lower)
        )
      );
    }

    // Sort
    if (sortKey) {
      result.sort((a: any, b: any) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [data, filter, sortKey, sortDir]);

  const pagedData = useMemo(() => {
    const start = page * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, page, pageSize]);

  const totalPages = Math.ceil(filteredData.length / pageSize);

  const handleRowClick = (item: any, idx: number) => {
    if (onRowClick) {
      onRowClick(item);
    } else if (expandable) {
      setExpandedRow(expandedRow === idx ? null : idx);
    }
  };

  const toggleExpansion = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    setExpandedRow(expandedRow === idx ? null : idx);
  };

  return (
    <div onClick={handleContainerClick} className="w-full border rounded-xl overflow-hidden bg-theme-card border-theme/20 shadow-sm my-3 flex flex-col max-w-2xl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-theme/10 bg-theme-hover/50 flex items-center justify-between gap-4">
        {title && <h3 className="font-semibold text-sm text-theme-fg shrink-0">{title}</h3>}

        <div className="relative max-w-xs flex-1 ml-auto">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-muted" />
          <input
            type="text"
            placeholder="Search..."
            value={filter}
            onChange={(e) => { e.stopPropagation(); setFilter(e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg bg-theme-input border-theme/20 text-theme-fg placeholder:text-theme-muted focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-shadow"
          />
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto genui-scrollbar">
        <table className="min-w-full text-left text-xs divide-y divide-theme/10">
          <thead className="bg-theme-card">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={(e) => { e.stopPropagation(); col.sortable && handleSort(col.key); }}
                  className={clsx(
                    "px-4 py-2.5 font-medium text-theme-muted whitespace-nowrap",
                    col.sortable && "cursor-pointer hover:bg-theme-hover select-none"
                  )}
                  style={{ width: col.width }}
                >
                  <div className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && sortKey === col.key && (
                      sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
              ))}
              {expandable && <th className="w-8"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-theme/5">
            {pagedData.length > 0 ? (
              pagedData.map((item, idx) => {
                const isExpanded = expandedRow === idx;

                return (
                  <React.Fragment key={idx}>
                    <tr
                      onClick={(e) => { e.stopPropagation(); handleRowClick(item, idx); }}
                      className={clsx(
                        "group transition-colors",
                        onRowClick ? "cursor-pointer hover:bg-primary/5" : (expandable ? "cursor-pointer hover:bg-theme-hover/50" : ""),
                        isExpanded && "bg-primary/5"
                      )}
                    >
                      {columns.map(col => (
                        <td key={col.key} className="px-4 py-2.5 text-theme-fg max-w-[200px]">
                          <div className={clsx(
                            col.truncate !== false && "truncate"
                          )}>
                            {col.render ? col.render((item as any)[col.key], item) : String((item as any)[col.key] ?? '')}
                          </div>
                        </td>
                      ))}
                      {expandable && (
                        <td className="px-2 text-center text-theme-muted">
                          <button
                            onClick={(e) => toggleExpansion(e, idx)}
                            className="p-1 rounded hover:bg-theme-hover text-theme-muted hover:text-theme-fg transition-colors"
                          >
                            {isExpanded ? <X className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                          </button>
                        </td>
                      )}
                    </tr>

                    {/* Expanded Details View */}
                    <AnimatePresence>
                      {isExpanded && (
                        <tr>
                          <td colSpan={columns.length + 1} className="p-0 border-b border-theme/10 bg-theme-hover/30">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="p-4 grid gap-4 grid-cols-1 sm:grid-cols-2">
                                {columns.map(col => {
                                  const val = (item as any)[col.key];
                                  const content = String(val ?? '');
                                  return (
                                    <div key={col.key} className="col-span-1">
                                      <div className="text-[10px] uppercase tracking-wider text-theme-muted font-medium mb-1">
                                        {col.header}
                                      </div>
                                      <div className="text-sm text-theme-fg bg-theme-card rounded border border-theme/10 p-2 break-words">
                                        {content.length > 100 || content.includes('\n')
                                          ? <RichText content={content} compact />
                                          : content
                                        }
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={columns.length + (expandable ? 1 : 0)} className="px-4 py-8 text-center text-theme-muted italic">
                  No results found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer / Pagination */}
      {totalPages > 1 && (
        <div className="px-3 py-2 border-t border-theme/10 bg-theme-hover/30 flex items-center justify-between">
          <span className="text-[10px] text-theme-muted">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filteredData.length)} of {filteredData.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); setPage(p => Math.max(0, p - 1)); }}
              disabled={page === 0}
              className="px-2 py-1 rounded text-xs text-theme-fg hover:bg-theme-card disabled:opacity-50 border border-transparent hover:border-theme/20 transition-colors"
            >
              Prev
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPage(p => Math.min(totalPages - 1, p + 1)); }}
              disabled={page === totalPages - 1}
              className="px-2 py-1 rounded text-xs text-theme-fg hover:bg-theme-card disabled:opacity-50 border border-transparent hover:border-theme/20 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


