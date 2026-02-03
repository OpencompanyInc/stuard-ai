/**
 * WorkflowSidebar - Left sidebar with workflow list and actions
 */
import React, { useState, useMemo } from "react";
import { Plus, ChevronLeft, ChevronRight, Home, Upload, Grid, Trash2, Search, Zap, LayoutGrid, ArrowUpCircle, Bell, Lock, Globe } from "lucide-react";
import type { MarketplaceUpdate } from "../../utils/cloud";

interface WorkflowItem {
  id: string;
  name?: string;
  marketplaceSlug?: string;
  locked?: boolean;
  version?: string;
}

interface WorkflowSidebarProps {
  items: WorkflowItem[];
  loading: boolean;
  selectedId: string;
  runningIds: Record<string, boolean>;
  sidebarCollapsed: boolean;
  credits: { remaining: number; limit: number; plan: string } | null;
  updates?: Record<string, MarketplaceUpdate>;
  onToggleCollapse: () => void;
  onCreate: () => void;
  onImport: () => void;
  onMarketplace: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onUpdate?: (id: string, update: MarketplaceUpdate) => void;
  onDashboard: () => void;
}

export function WorkflowSidebar({
  items, loading, selectedId, runningIds, sidebarCollapsed, credits, updates,
  onToggleCollapse, onCreate, onImport, onMarketplace, onSelect, onDelete, onUpdate, onDashboard
}: WorkflowSidebarProps) {
  const [search, setSearch] = useState("");

  const filteredItems = items.filter(i =>
    (i.name || i.id).toLowerCase().includes(search.toLowerCase())
  );

  // Count available updates
  const updateCount = useMemo(() => {
    if (!updates) return 0;
    return items.filter(i => i.marketplaceSlug && updates[i.marketplaceSlug]).length;
  }, [items, updates]);

  if (sidebarCollapsed) {
    return (
      <aside className="w-18 bg-white border-r border-slate-100 flex flex-col items-center py-4 gap-4 shrink-0 z-20 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.05)]">
        <button
          onClick={onToggleCollapse}
          className="p-3 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-xl transition-all"
          title="Expand sidebar"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        <div className="w-8 h-px bg-slate-100" />

        <button
          onClick={onCreate}
          className="p-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-lg shadow-slate-200 transition-all hover:scale-105 active:scale-95"
          title="New Workflow"
        >
          <Plus className="w-5 h-5" />
        </button>

        <div className="flex-1" />

        <button
          onClick={onDashboard}
          className="p-3 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-xl transition-colors"
          title="Back to Dashboard"
        >
          <Home className="w-5 h-5" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[280px] bg-[#fdfdfd] border-r border-slate-100 flex flex-col h-full shrink-0 z-20" data-onboarding="workflow-sidebar">
      <div className="h-14 px-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2.5 font-bold text-slate-800 text-sm">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center shadow-sm text-white">
            <Zap className="w-4 h-4 fill-current" />
          </div>
          <span>Automations</span>
        </div>
        <button
          onClick={onToggleCollapse}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
          title="Collapse sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Action Buttons */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCreate}
            className="col-span-2 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-sm transition-all hover:shadow hover:scale-[1.01] active:scale-[0.99]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Flow</span>
          </button>
          <button
            onClick={onImport}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-slate-900 text-xs font-medium rounded-xl transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import</span>
          </button>
          <button
            onClick={onMarketplace}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-white border border-slate-200 hover:border-violet-200 text-slate-600 hover:text-violet-600 text-xs font-medium rounded-xl transition-colors group"
          >
            <Grid className="w-3.5 h-3.5 group-hover:text-violet-500 transition-colors" />
            <span>Store</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
          <input
            type="text"
            placeholder="Search workflows..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-indigo-300 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-indigo-50 transition-all font-medium"
          />
        </div>
      </div>

      <div className="h-px bg-slate-100 mx-4 mb-2" />

      {/* List Section */}
      <div className="flex-1 overflow-y-auto scrollbar-minimal px-3 pb-2 space-y-1">
        <div className="px-2 py-1.5 mb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <span>Your Library</span>
          <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md text-[9px]">{items.length}</span>
        </div>

        {/* Updates Banner */}
        {updateCount > 0 && (
          <div className="mx-2 mb-2 p-2.5 bg-gradient-to-r from-indigo-50 to-violet-50 border border-indigo-100 rounded-xl">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                <Bell className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1">
                <div className="text-xs font-semibold text-indigo-900">
                  {updateCount} update{updateCount !== 1 ? 's' : ''} available
                </div>
                <div className="text-[10px] text-indigo-600/70">
                  From Marketplace
                </div>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center space-y-3 opacity-50">
            <div className="w-6 h-6 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin mx-auto" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3 text-slate-300 border border-slate-100">
              <Search className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-slate-500">No workflows found</p>
          </div>
        ) : (
          filteredItems.map(i => {
            const update = i.marketplaceSlug ? updates?.[i.marketplaceSlug] : undefined;
            const hasUpdate = !!update;
            const isFromMarketplace = !!i.marketplaceSlug;
            return (
              <div
                key={i.id}
                onClick={() => onSelect(i.id)}
                className={`group relative w-full text-left px-3 py-3 rounded-xl flex items-center gap-3 transition-all cursor-pointer border ${selectedId === i.id
                  ? 'bg-white border-slate-200 shadow-sm z-10'
                  : hasUpdate
                    ? 'border-indigo-100 bg-indigo-50/30 hover:bg-indigo-50/50'
                    : 'border-transparent hover:bg-slate-50 text-slate-600'
                  }`}
              >
                {/* Status Indicator */}
                <div className={`w-2 h-2 rounded-full shrink-0 transition-all duration-300 ${runningIds[i.id]
                  ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                  : hasUpdate ? 'bg-indigo-500 animate-pulse'
                  : selectedId === i.id ? 'bg-indigo-500 scale-110' : 'bg-slate-200 group-hover:bg-slate-300'
                  }`} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-xs font-medium ${selectedId === i.id ? 'text-slate-900' : 'text-slate-600'}`}>
                      {i.name || i.id}
                    </span>
                    {i.locked && (
                      <span title="Locked workflow"><Lock className="w-3 h-3 text-amber-500 shrink-0" /></span>
                    )}
                    {isFromMarketplace && !i.locked && (
                      <span title="From Marketplace"><Globe className="w-3 h-3 text-slate-400 shrink-0" /></span>
                    )}
                  </div>
                  {hasUpdate && (
                    <div className="text-[10px] text-indigo-600 font-medium mt-0.5">
                      v{update.currentVersion} → v{update.latestVersion}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className={`flex items-center gap-1 ${hasUpdate ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                  {hasUpdate && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdate?.(i.id, update);
                      }}
                      className="p-1.5 rounded-lg text-indigo-600 hover:text-indigo-700 hover:bg-indigo-100 transition-all"
                      title={`Update to v${update.latestVersion}`}
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete "${i.name || i.id}"?`)) return;
                      await onDelete(i.id);
                    }}
                    className={`p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all ${selectedId === i.id && !hasUpdate ? 'opacity-0' : ''
                      }`}
                    title="Delete workflow"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Section */}
      <div className="p-4 mt-auto border-t border-slate-100 bg-white space-y-3">
        {credits && (
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400 mb-2">
              <span>Credits</span>
              <span className={credits.remaining < 10 ? "text-amber-500" : "text-slate-500"}>
                {credits.remaining} / {credits.limit}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-200/50 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${credits.remaining < 10 ? 'bg-amber-500' : 'bg-gradient-to-r from-indigo-500 to-violet-500'
                  }`}
                style={{ width: `${Math.min(100, (credits.remaining / Math.max(1, credits.limit)) * 100)}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={onDashboard}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900 rounded-xl text-xs font-semibold transition-colors"
        >
          <Home className="w-3.5 h-3.5" />
          <span>Dashboard</span>
        </button>
      </div>
    </aside>
  );
}
