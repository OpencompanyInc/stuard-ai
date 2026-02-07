/**
 * Tool Palette Sidebar Component for the workflow builder
 */
import React, { useEffect, useState, useMemo } from "react";
import { Search, X, ChevronRight, GripVertical, Box, Lock } from "lucide-react";
import { PALETTE_CATEGORIES, CATEGORY_COLORS } from "../constants/paletteCategories";

interface ToolPaletteProps {
  onDragStart: (e: React.DragEvent, item: any) => void;
  disabled?: boolean;
}

export function ToolPalette({ onDragStart, disabled }: ToolPaletteProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['triggers', 'flow']));

  const [ffmpegConnected, setFfmpegConnected] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('integrations.connected');
      const parsed = raw ? JSON.parse(raw) : null;
      return !!(parsed && (parsed as any).ffmpeg);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const refresh = () => {
      try {
        const raw = localStorage.getItem('integrations.connected');
        const parsed = raw ? JSON.parse(raw) : null;
        setFfmpegConnected(!!(parsed && (parsed as any).ffmpeg));
      } catch {
        setFfmpegConnected(false);
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'integrations.connected') refresh();
    };

    const onConnectedChanged = () => {
      refresh();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('integrations.connected.changed' as any, onConnectedChanged);
    window.addEventListener('focus', refresh);
    refresh();

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('integrations.connected.changed' as any, onConnectedChanged);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const paletteCategories = useMemo(() => {
    if (ffmpegConnected) return PALETTE_CATEGORIES;
    return PALETTE_CATEGORIES.filter((c) => c.id !== 'ffmpeg');
  }, [ffmpegConnected]);

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return paletteCategories;
    const q = searchQuery.toLowerCase();
    return paletteCategories.map(cat => ({
      ...cat,
      items: cat.items.filter(item =>
        item.label.toLowerCase().includes(q) ||
        item.t.toLowerCase().includes(q)
      ),
    })).filter(cat => cat.items.length > 0);
  }, [searchQuery, paletteCategories]);

  return (
    <div className="flex flex-col h-full bg-[#fdfdfd] border-r border-slate-100" data-onboarding="node-palette">
      {/* Header */}
      <div className="h-14 px-4 py-2 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2.5 text-sm font-bold text-slate-800">
          <div className="p-1.5 bg-indigo-50 rounded-lg text-indigo-600">
            <Box className="w-4 h-4" />
          </div>
          <span>Toolbox</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
          <span>{filteredCategories.reduce((acc, cat) => acc + cat.items.length, 0)}</span>
          <span className="text-slate-400">tools</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative group px-4 py-3">
        <input
          type="text"
          placeholder="Search tools..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-indigo-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-indigo-100 transition-all placeholder:text-slate-400 text-slate-700 font-medium"
        />
        <Search className="absolute left-7 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-500 w-3.5 h-3.5 transition-colors" />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200 transition-all"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Locked Banner */}
      {disabled && (
        <div className="mx-3 mb-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-amber-900">Locked Workflow</div>
              <div className="text-[10px] text-amber-700/70 leading-relaxed mt-0.5">
                This workflow can't be modified. Wait for updates from the publisher.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Categories */}
      <div className="flex-1 overflow-y-auto scrollbar-minimal p-3 space-y-2">
        {filteredCategories.map(cat => {
          const isExpanded = expandedCategories.has(cat.id) || !!searchQuery;
          const Icon = cat.icon;
          const styles = CATEGORY_COLORS[cat.color] || CATEGORY_COLORS.slate;

          return (
            <div key={cat.id} className="rounded-xl overflow-hidden transition-all duration-300">
              <button
                onClick={() => toggleCategory(cat.id)}
                className={`w-full px-3 py-2.5 flex items-center justify-between text-left transition-all select-none group border border-transparent ${isExpanded ? 'bg-white shadow-sm border-slate-100 mb-1 rounded-xl' : 'hover:bg-slate-50 rounded-xl'
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg transition-colors ${isExpanded ? `${styles.bg} ${styles.text}` : 'bg-slate-100 text-slate-400 group-hover:text-slate-600'
                    }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-xs font-bold transition-colors ${isExpanded ? 'text-slate-800' : 'text-slate-600 group-hover:text-slate-800'
                    }`}>
                    {cat.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!isExpanded && (
                    <span className="text-[10px] font-medium text-slate-300 bg-slate-50 px-1.5 py-0.5 rounded-md min-w-[1.5em] text-center">
                      {cat.items.length}
                    </span>
                  )}
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="pl-3 pr-1 pb-2 space-y-1 animate-in slide-in-from-top-1 fade-in duration-200">
                  {cat.items.map((item, i) => {
                    const ItemIcon = item.icon;
                    const dragData = { ...item, icon: undefined };

                    return (
                      <div
                        key={`${item.t}-${i}`}
                        draggable={!disabled}
                        onDragStart={e => !disabled && onDragStart(e, dragData)}
                        className={`flex items-center gap-3 px-3 py-2 bg-white border border-slate-100 rounded-lg transition-all group/item relative overflow-hidden ${disabled
                          ? 'opacity-50 cursor-not-allowed'
                          : `cursor-grab hover:border-${cat.color}-200 hover:shadow-sm hover:translate-x-1 active:cursor-grabbing`
                          }`}
                      >
                        {/* Hover accent strip */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${styles.bg} opacity-0 ${!disabled && 'group-hover/item:opacity-100'} transition-opacity`} />

                        <div className={`p-1.5 rounded-md text-slate-400 ${!disabled && `group-hover/item:${styles.text} group-hover/item:${styles.bg}`} transition-colors`}>
                          <ItemIcon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-semibold truncate ${disabled ? 'text-slate-500' : 'text-slate-700 group-hover/item:text-slate-900'}`}>
                            {item.label}
                          </div>
                        </div>
                        {!disabled && (
                          <GripVertical className="w-3 h-3 text-slate-200 group-hover/item:text-slate-400 opacity-0 group-hover/item:opacity-100 transition-all" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {filteredCategories.length === 0 && (
          <div className="py-12 text-center">
            <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-3 text-slate-300 border border-slate-100">
              <Search className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold text-slate-600">No tools found</p>
            <p className="text-[10px] text-slate-400 mt-1">Try searching for something else</p>
          </div>
        )}
      </div>
    </div>
  );
}
