/**
 * Tool Palette Sidebar Component for the workflow builder
 */
import React, { useEffect, useState, useMemo, forwardRef, useImperativeHandle, useRef } from "react";
import { Search, X, ChevronRight, GripVertical, Box, Lock, Package, Workflow, Plug } from "lucide-react";
import { IntegrationSearchEmptyState } from "../../components/IntegrationSearchEmptyState";
import { PALETTE_CATEGORIES, CATEGORY_COLORS, PALETTE_GROUPS, type PaletteCategory, type PaletteCategoryItem } from "../constants/paletteCategories";
import { getFunctionNodeIcon } from "../constants/functionNodeStyle";
import { fetchInstalledIntegrations, toToolEntries } from "../../utils/installedIntegrations";

export interface ToolPaletteRef {
  focusSearch: () => void;
}

export const ToolPalette = forwardRef<ToolPaletteRef, {
  onDragStart: (e: React.DragEvent, item: any) => void;
  /** Click-to-add fallback — adds the item to the canvas without dragging
   *  (HTML5 drag is unreliable on trackpads / touch). */
  onItemClick?: (item: any) => void;
  disabled?: boolean;
  workflowId?: string;
  onBuildIntegration?: () => void;
}>(({ onDragStart, onItemClick, disabled, workflowId, onBuildIntegration }, ref) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['installed', 'triggers', 'flow']));
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [installedFunctionItems, setInstalledFunctionItems] = useState<PaletteCategoryItem[]>([]);
  const [integrationItems, setIntegrationItems] = useState<PaletteCategoryItem[]>([]);

  useImperativeHandle(ref, () => ({
    focusSearch: () => searchInputRef.current?.focus(),
  }), []);

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

  useEffect(() => {
    let cancelled = false;

    const buildInputs = (inputParams: any[] | undefined) => {
      if (!Array.isArray(inputParams)) return {};
      return Object.fromEntries(
        inputParams
          .filter((param) => param?.name)
          .map((param) => [String(param.name), param.defaultValue ?? param.default ?? ""])
      );
    };

    const refreshInstalledFunctions = async () => {
      const next: PaletteCategoryItem[] = [];

      try {
        const listRes = await (window as any).desktopAPI?.workflowsList?.();
        const workflows = Array.isArray(listRes?.items) ? listRes.items : [];
        for (const workflow of workflows) {
          const triggers = Array.isArray(workflow?.triggers) ? workflow.triggers : [];
          if (!workflow?.id || workflow.id === workflowId || !triggers.includes('function')) continue;
          // If the publisher designed a custom function node (icon, label, color),
          // surface it in the palette so the function looks like itself instead of
          // a generic "call_workflow" tile.
          const fn = workflow.functionNode;
          const designedLabel = fn && typeof fn.label === 'string' && fn.label.trim() ? fn.label.trim() : '';
          const iconName = fn && typeof fn.icon === 'string' ? fn.icon : undefined;
          const colorKey = fn && typeof fn.color === 'string' ? fn.color : undefined;
          next.push({
            k: 'local.tool',
            // Drop handler will materialize a sub-workflow + emit
            // call_workspace_function. Tool field here is only a hint for the
            // palette tile; it gets overridden on drop.
            t: 'call_workspace_function',
            label: designedLabel || workflow.name || workflow.id,
            icon: iconName ? getFunctionNodeIcon(iconName) : Workflow,
            args: { workflowId: workflow.id, inputs: {} },
            iconName,
            colorKey,
            sourceWorkflowId: workflow.id,
          });
        }
      } catch {
      }

      if (workflowId) {
        try {
          const res = await (window as any).desktopAPI?.workflowsListWorkspaceFunctions?.(workflowId);
          const functions = Array.isArray(res?.functions) ? res.functions : [];
          for (const fn of functions) {
            if (!fn?.isFunction || !fn?.path) continue;
            const designed = fn.functionNode;
            const designedLabel = designed && typeof designed.label === 'string' && designed.label.trim() ? designed.label.trim() : '';
            const iconName = designed && typeof designed.icon === 'string' ? designed.icon : undefined;
            const colorKey = designed && typeof designed.color === 'string' ? designed.color : undefined;
            next.push({
              k: 'local.tool',
              t: 'call_workspace_function',
              label: designedLabel || fn.name || fn.path,
              icon: iconName ? getFunctionNodeIcon(iconName) : Workflow,
              args: { path: fn.path, inputs: buildInputs(fn.inputParams) },
              iconName,
              colorKey,
            });
          }
        } catch {
        }
      }

      if (!cancelled) {
        setInstalledFunctionItems(next);
      }
    };

    refreshInstalledFunctions();
    const timer = window.setInterval(refreshInstalledFunctions, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [workflowId]);

  // Deployed custom integrations → palette nodes. Dropping one creates a
  // cloud.tool node whose tool id is the compiled `${slug}_${tool}` name;
  // execTool routes it to cloud-ai's /v1/integrations/run.
  useEffect(() => {
    let cancelled = false;
    const refreshIntegrations = async () => {
      try {
        const list = await fetchInstalledIntegrations();
        const items: PaletteCategoryItem[] = toToolEntries(list).map((entry) => {
          const props = entry.args?.properties && typeof entry.args.properties === 'object' ? entry.args.properties : {};
          const defaultArgs: Record<string, any> = {};
          for (const key of Object.keys(props)) defaultArgs[key] = '';
          return {
            k: 'cloud.tool' as const,
            t: entry.name,
            label: entry.label,
            icon: Plug,
            args: defaultArgs,
          };
        });
        if (!cancelled) setIntegrationItems(items);
      } catch {
        if (!cancelled) setIntegrationItems([]);
      }
    };
    refreshIntegrations();
    const onChanged = () => refreshIntegrations();
    window.addEventListener('stuard:integrations-changed' as any, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('stuard:integrations-changed' as any, onChanged);
    };
  }, []);

  const paletteCategories = useMemo(() => {
    const installedItems = installedFunctionItems.length > 0
      ? installedFunctionItems
      : [{
          k: 'local.tool' as const,
          t: 'call_workspace_function',
          label: 'No installed functions yet',
          icon: Workflow,
          args: { path: '', inputs: {} },
          disabled: true,
        }];

    const installedCategory: PaletteCategory = {
      id: 'installed',
      label: 'Installed Functions',
      icon: Package,
      color: 'indigo',
      items: installedItems,
    };

    const baseCategories = ffmpegConnected ? PALETTE_CATEGORIES : PALETTE_CATEGORIES.filter((c) => c.id !== 'ffmpeg');
    const cats: PaletteCategory[] = [installedCategory];
    if (integrationItems.length > 0) {
      cats.push({
        id: 'integrations',
        label: 'Integrations',
        icon: Plug,
        color: 'indigo',
        items: integrationItems,
      });
    }
    cats.push(...baseCategories);
    return cats;
  }, [ffmpegConnected, installedFunctionItems, integrationItems]);

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
    return paletteCategories.map(cat => {
      const categoryMatch =
        cat.label.toLowerCase().includes(q) ||
        cat.id.toLowerCase().includes(q);
      // If the user typed a category-level term (e.g. "google", "browser"),
      // surface every tool in that category. Otherwise filter to items that match.
      const items = categoryMatch
        ? cat.items
        : cat.items.filter(item =>
            item.label.toLowerCase().includes(q) ||
            item.t.toLowerCase().includes(q)
          );
      return { ...cat, items };
    }).filter(cat => cat.items.length > 0);
  }, [searchQuery, paletteCategories]);

  /**
   * Visually chunk categories into named groups (Core, AI, Local, …) so the user
   * doesn't have to scan 30+ rows. The "installed" pseudo-category lives at the
   * top of the Core group. Any category without a known group is treated as
   * ungrouped and rendered after the last named group.
   */
  const groupedCategories = useMemo(() => {
    const byId = new Map(filteredCategories.map(c => [c.id, c]));
    const groups: { id: string; label: string; categories: PaletteCategory[] }[] = [];
    const consumed = new Set<string>();

    for (const g of PALETTE_GROUPS) {
      const cats: PaletteCategory[] = [];
      for (const id of g.categoryIds) {
        const cat = byId.get(id);
        if (cat) {
          cats.push(cat);
          consumed.add(id);
        }
      }
      if (cats.length > 0) groups.push({ id: g.id, label: g.label, categories: cats });
    }

    const orphans = filteredCategories.filter(c => !consumed.has(c.id));
    if (orphans.length > 0) {
      groups.push({ id: 'other', label: 'Other', categories: orphans });
    }
    return groups;
  }, [filteredCategories]);

  return (
    <div className="flex flex-col h-full wf-bg-elevated border-r border-theme-sidebar" data-onboarding="node-palette">
      {/* Header */}
      <div className="h-14 px-4 py-2 border-b border-theme-sidebar flex items-center justify-between shrink-0 bg-transparent">
          <div className="flex items-center gap-2.5 text-sm font-bold wf-fg">
          <div className="p-1.5 rounded-lg wf-accent-soft [color:var(--wf-accent)]">
            <Box className="w-4 h-4" />
          </div>
          <span>Toolbox</span>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium wf-fg-muted wf-bg-overlay px-2 py-1 rounded-md border wf-border-subtle">
          <span>{filteredCategories.reduce((acc, cat) => acc + cat.items.length, 0)}</span>
          <span className="wf-fg-muted">tools</span>
        </div>
      </div>

      {/* Search */}
      <div className="p-3 pb-2 shrink-0 relative group">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search tools..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-xs border wf-border-subtle focus:border-indigo-500/50 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all font-medium wf-input wf-hover-bg"
        />
        <Search className="absolute left-7 top-1/2 -translate-y-1/2 wf-fg-muted group-focus-within:[color:var(--wf-accent)] w-3.5 h-3.5 transition-colors" />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-6 top-1/2 -translate-y-1/2 p-0.5 rounded-full transition-all wf-fg-muted wf-hover-fg wf-hover-bg"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Locked Banner */}
      {disabled && (
        <div className="mx-3 mb-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-amber-500">Locked Workflow</div>
              <div className="text-[10px] text-amber-400/70 leading-relaxed mt-0.5">
                This workflow can't be modified. Wait for updates from the publisher.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Categories */}
      <div className="flex-1 overflow-y-auto scrollbar-minimal p-3 space-y-4">
        {groupedCategories.map(group => (
          <div key={group.id} className="space-y-2">
            <div className="flex items-center gap-2 px-1 pt-1 select-none">
              <div className="text-[10px] font-bold uppercase tracking-wider wf-fg-muted">{group.label}</div>
              <div className="flex-1 h-px border-t border-theme-sidebar" />
            </div>
            {group.categories.map(cat => {
          const isExpanded = expandedCategories.has(cat.id) || !!searchQuery;
          const Icon = cat.icon;
          const styles = CATEGORY_COLORS[cat.color] || CATEGORY_COLORS.slate;

          return (
            <div key={cat.id} className="rounded-xl overflow-hidden transition-all duration-300">
              <button
                onClick={() => toggleCategory(cat.id)}
                className={`w-full px-3 py-2.5 flex items-center justify-between text-left transition-all select-none group border border-transparent ${isExpanded ? 'shadow-sm border-current mb-1 rounded-xl wf-bg-overlay' : 'rounded-xl wf-hover-bg'
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'wf-accent-soft [color:var(--wf-accent)]' : 'wf-bg-overlay wf-fg-muted group-hover:wf-fg'
                    }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`text-xs font-bold transition-colors ${isExpanded ? 'wf-fg [color:var(--wf-accent)]' : 'wf-fg-muted group-hover:wf-fg'
                    }`}>
                    {cat.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!isExpanded && (
                    <span className="text-[10px] font-medium wf-fg-muted wf-bg-overlay px-1.5 py-0.5 rounded-md min-w-[1.5em] text-center">
                      {cat.items.length}
                    </span>
                  )}
                  <ChevronRight
                    className={`w-3.5 h-3.5 wf-fg-muted group-hover:wf-fg transition-transform duration-200 ${isExpanded ? 'rotate-90 [color:var(--wf-accent)]' : ''}`}
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="pl-3 pr-1 pb-2 space-y-1 animate-in slide-in-from-top-1 fade-in duration-200">
                  {cat.items.map((item, i) => {
                    const ItemIcon = item.icon;
                    const dragData = { ...item, icon: undefined };
                    const itemDisabled = disabled || !!item.disabled;

                    return (
                      <div
                        key={`${item.t}-${i}`}
                        draggable={!itemDisabled}
                        onDragStart={e => !itemDisabled && onDragStart(e, dragData)}
                        onClick={() => !itemDisabled && onItemClick?.(dragData)}
                        title={itemDisabled ? undefined : 'Drag onto the canvas, or click to add'}
                        className={`flex items-center gap-3 px-3 py-2 bg-transparent border wf-border-subtle rounded-lg transition-all group/item relative overflow-hidden ${itemDisabled
                          ? 'opacity-50 cursor-not-allowed'
                          : `cursor-grab wf-hover-bg hover:border-[var(--wf-border)] hover:shadow-sm hover:translate-x-1 active:cursor-grabbing`
                          }`}
                      >
                        {/* Hover accent strip */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1 opacity-0 ${!itemDisabled && 'group-hover/item:opacity-100'} transition-opacity`} style={{ background: 'var(--wf-accent)' }} />

                        <div className={`p-1.5 rounded-md wf-fg-muted ${!itemDisabled && 'group-hover/item:wf-fg group-hover/item:bg-[var(--wf-hover)]'} transition-colors`}>
                          <ItemIcon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-semibold truncate ${itemDisabled ? 'wf-fg-muted opacity-60' : 'wf-fg group-hover/item:wf-fg'}`}>
                            {item.label}
                          </div>
                        </div>
                        {!itemDisabled && (
                          <GripVertical className="w-3 h-3 wf-fg-muted group-hover/item:wf-fg opacity-0 group-hover/item:opacity-100 transition-all" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
            })}
          </div>
        ))}

        {groupedCategories.length === 0 && searchQuery.trim() ? (
          <IntegrationSearchEmptyState
            variant="compact"
            query={searchQuery}
            onBuildIntegration={onBuildIntegration}
            secondaryAction={{
              label: 'Clear search',
              onClick: () => setSearchQuery(''),
            }}
          />
        ) : groupedCategories.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-12 h-12 wf-bg-overlay rounded-2xl flex items-center justify-center mx-auto mb-3 wf-fg-muted border wf-border-subtle">
              <Search className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold wf-fg">No tools found</p>
            <p className="text-[10px] wf-fg-muted mt-1">Try searching for something else</p>
          </div>
        ) : null}
      </div>
    </div>
  );
});
