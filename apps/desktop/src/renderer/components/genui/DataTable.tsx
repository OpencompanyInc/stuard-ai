import React, { useState, useMemo } from 'react';
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
    <div className="w-full border rounded-xl overflow-hidden bg-white shadow-sm my-3 flex flex-col max-w-2xl">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-neutral-50 flex items-center justify-between gap-4">
        {title && <h3 className="font-semibold text-sm text-neutral-800 shrink-0">{title}</h3>}
        
        <div className="relative max-w-xs flex-1 ml-auto">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border rounded-lg bg-white focus:ring-1 focus:ring-blue-500 outline-none transition-shadow"
          />
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs divide-y divide-neutral-100">
          <thead className="bg-white">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleSort(col.key)}
                  className={clsx(
                    "px-4 py-2.5 font-medium text-neutral-500 whitespace-nowrap",
                    col.sortable && "cursor-pointer hover:bg-neutral-50 select-none"
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
          <tbody className="divide-y divide-neutral-50">
            {pagedData.length > 0 ? (
              pagedData.map((item, idx) => {
                const isExpanded = expandedRow === idx;
                
                return (
                  <React.Fragment key={idx}>
                    <tr 
                      onClick={() => handleRowClick(item, idx)}
                      className={clsx(
                        "group transition-colors",
                        onRowClick ? "cursor-pointer hover:bg-blue-50/50" : (expandable ? "cursor-pointer hover:bg-neutral-50/50" : ""),
                        isExpanded && "bg-blue-50/30"
                      )}
                    >
                      {columns.map(col => (
                        <td key={col.key} className="px-4 py-2.5 text-neutral-700 max-w-[200px]">
                          <div className={clsx(
                            col.truncate !== false && "truncate"
                          )}>
                            {col.render ? col.render((item as any)[col.key], item) : String((item as any)[col.key] ?? '')}
                          </div>
                        </td>
                      ))}
                      {expandable && (
                        <td className="px-2 text-center text-neutral-400">
                          <button
                            onClick={(e) => toggleExpansion(e, idx)}
                            className="p-1 rounded hover:bg-black/5 text-neutral-400 hover:text-neutral-600 transition-colors"
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
                          <td colSpan={columns.length + 1} className="p-0 border-b border-neutral-100 bg-neutral-50/30">
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
                                      <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium mb-1">
                                        {col.header}
                                      </div>
                                      <div className="text-sm text-neutral-700 bg-white rounded border border-neutral-100 p-2 break-words">
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
                <td colSpan={columns.length + (expandable ? 1 : 0)} className="px-4 py-8 text-center text-neutral-400 italic">
                  No results found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer / Pagination */}
      {totalPages > 1 && (
        <div className="px-3 py-2 border-t bg-neutral-50/50 flex items-center justify-between">
          <span className="text-[10px] text-neutral-500">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filteredData.length)} of {filteredData.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded text-xs text-neutral-600 hover:bg-white disabled:opacity-50 border border-transparent hover:border-neutral-200"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="px-2 py-1 rounded text-xs text-neutral-600 hover:bg-white disabled:opacity-50 border border-transparent hover:border-neutral-200"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


