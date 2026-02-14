/**
 * WorkflowLauncher - Full-screen launcher shown when no workflow is selected.
 * Provides search, recent workflows list, and quick actions to open or create workflows.
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Search, Plus, Zap, Clock, Play, Trash2, Upload, Grid,
  Home, ArrowRight, Sparkles, Lock, Globe, FolderOpen
} from "lucide-react";

interface WorkflowItem {
  id: string;
  name?: string;
  marketplaceSlug?: string;
  locked?: boolean;
  version?: string;
  folder?: string;
}

interface WorkflowLauncherProps {
  items: WorkflowItem[];
  loading: boolean;
  runningIds: Record<string, boolean>;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onMarketplace: () => void;
  onDelete: (id: string) => Promise<void>;
  onDashboard: () => void;
}

export function WorkflowLauncher({
  items, loading, runningIds,
  onSelect, onCreate, onImport, onMarketplace, onDelete, onDashboard
}: WorkflowLauncherProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(i => (i.name || i.id).toLowerCase().includes(q));
  }, [items, search]);

  // Reset selection when filter changes
  useEffect(() => { setSelectedIndex(0); }, [filtered.length]);

  // Auto-focus search on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      onSelect(filtered[selectedIndex].id);
    }
  }, [filtered, selectedIndex, onSelect]);

  return (
    <div className="flex-1 flex flex-col bg-[#f8fafc] min-h-0">
      {/* Top bar */}
      <div className="h-11 bg-white border-b border-slate-200 flex items-center px-4 shrink-0 justify-between drag">
        <div className="flex items-center gap-2 select-none">
          <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-sky-600 rounded-md flex items-center justify-center text-white">
            <Zap className="w-3 h-3 fill-current" />
          </div>
          <span className="text-[13px] font-bold text-slate-800 tracking-tight">Studio</span>
        </div>
        <button
          onClick={onDashboard}
          className="no-drag flex items-center gap-1.5 px-3 py-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg text-[11px] font-medium transition-colors"
        >
          <Home className="w-3.5 h-3.5" /> Dashboard
        </button>
      </div>

      {/* Center content */}
      <div className="flex-1 flex items-start justify-center overflow-auto pt-[10vh]">
        <div className="w-full max-w-lg px-6 pb-16">
          {/* Hero */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-sky-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-blue-200/50">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Workflow Studio</h1>
            <p className="text-sm text-slate-500">Open an existing workflow or create a new one</p>
          </div>

          {/* Search input */}
          <div className="relative mb-4">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search workflows..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-white border border-slate-200 focus:border-blue-400 rounded-xl pl-12 pr-4 py-3.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-100 transition-all shadow-sm"
            />
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={onCreate}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-xl shadow-sm transition-all hover:shadow-md"
            >
              <Plus className="w-4 h-4" /> New Workflow
            </button>
            <button
              onClick={onImport}
              className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 hover:border-slate-300 rounded-xl text-[13px] font-medium transition-all"
              title="Import JSON"
            >
              <Upload className="w-4 h-4" />
            </button>
            <button
              onClick={onMarketplace}
              className="px-4 py-2.5 bg-white hover:bg-blue-50 text-slate-600 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded-xl text-[13px] font-medium transition-all"
              title="Browse Store"
            >
              <Grid className="w-4 h-4" />
            </button>
          </div>

          {/* Workflow list */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                {search ? `Results (${filtered.length})` : `Your Workflows (${items.length})`}
              </span>
            </div>

            <div className="max-h-[340px] overflow-y-auto scrollbar-minimal">
              {loading ? (
                <div className="py-12 flex justify-center">
                  <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-10 text-center">
                  <Search className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">
                    {search ? "No workflows match your search" : "No workflows yet"}
                  </p>
                  {!search && (
                    <button onClick={onCreate} className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium">
                      Create your first workflow
                    </button>
                  )}
                </div>
              ) : (
                filtered.map((item, idx) => {
                  const isRunning = runningIds[item.id];
                  const isHighlighted = idx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelect(item.id)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-slate-50 last:border-b-0 ${
                        isHighlighted ? "bg-blue-50/80" : "hover:bg-slate-50/80"
                      }`}
                    >
                      {/* Icon */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isRunning ? "bg-emerald-100" : "bg-slate-100"
                      }`}>
                        {isRunning ? (
                          <Play className="w-3.5 h-3.5 text-emerald-600 fill-current" />
                        ) : (
                          <Zap className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium text-slate-800 truncate">
                            {item.name || item.id}
                          </span>
                          {item.locked && <Lock className="w-3 h-3 text-amber-500 shrink-0" />}
                          {item.marketplaceSlug && !item.locked && <Globe className="w-3 h-3 text-slate-300 shrink-0" />}
                        </div>
                        {item.folder && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <FolderOpen className="w-3 h-3 text-amber-400" />
                            <span className="text-[10px] text-slate-400">{item.folder}</span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        {isRunning && (
                          <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            Running
                          </span>
                        )}
                        <ArrowRight className={`w-4 h-4 transition-all ${
                          isHighlighted ? "text-blue-500" : "text-transparent group-hover:text-slate-300"
                        }`} />
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Delete "${item.name || item.id}"?`)) return;
                            await onDelete(item.id);
                          }}
                          className="p-1 rounded text-transparent group-hover:text-slate-300 hover:!text-red-500 hover:!bg-red-50 transition-all"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
