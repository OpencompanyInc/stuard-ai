/**
 * UIBuilderPalette - Component library sidebar
 * Shows all available components that can be dragged onto the canvas
 */

import React, { useState } from 'react';
import {
  Square, LayoutList, LayoutGrid, Grid3x3, CreditCard, MoveVertical, Minus,
  MousePointerClick, TextCursor, AlignLeft, CheckSquare, ChevronDown as ChevronDownIcon,
  SlidersHorizontal, Type, Heading, Image, Smile, Tag, Activity,
  Table, FileText, Code2, Search, GripVertical
} from 'lucide-react';
import type { PaletteComponentDef } from './types';
import { PALETTE_BY_CATEGORY } from './components';

interface UIBuilderPaletteProps {
  onDragStart: (e: React.DragEvent, component: PaletteComponentDef) => void;
}

// Icon mapping
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Square,
  LayoutList,
  LayoutGrid: LayoutGrid,
  Grid3x3,
  CreditCard,
  MoveVertical,
  Minus,
  MousePointerClick,
  TextCursor,
  AlignLeft,
  CheckSquare,
  ChevronDown: ChevronDownIcon,
  SlidersHorizontal,
  Type,
  Heading,
  Image,
  Smile,
  Tag,
  Activity,
  Table,
  FileText,
  Code2,
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  layout: { label: 'Layout', color: 'from-blue-500 to-cyan-500' },
  input: { label: 'Input', color: 'from-emerald-500 to-teal-500' },
  display: { label: 'Display', color: 'from-rose-500 to-rose-500' },
  special: { label: 'Special', color: 'from-amber-500 to-orange-500' },
};

export function UIBuilderPalette({ onDragStart }: UIBuilderPaletteProps) {
  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['layout', 'input', 'display', 'special'])
  );

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Filter components by search
  const filterComponents = (components: PaletteComponentDef[]) => {
    if (!search.trim()) return components;
    const q = search.toLowerCase();
    return components.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q)
    );
  };

  return (
    <div className="w-56 uib-surface-2 border-r uib-border flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b uib-border uib-surface">
        <div className="text-xs font-bold uib-fg-muted uppercase tracking-wider mb-2">
          Components
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 uib-fg-faint" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-8 pr-3 py-1.5 text-xs uib-surface-2 border uib-border rounded-md focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500/40"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto scrollbar-minimal p-2 space-y-2">
        {Object.entries(PALETTE_BY_CATEGORY).map(([category, components]) => {
          const filtered = filterComponents(components);
          if (filtered.length === 0 && search.trim()) return null;

          const categoryInfo = CATEGORY_LABELS[category];
          const isExpanded = expandedCategories.has(category);

          return (
            <div key={category} className="uib-surface rounded-lg border uib-border overflow-hidden">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between px-3 py-2 uib-hover transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${categoryInfo.color}`} />
                  <span className="text-xs font-semibold uib-fg">{categoryInfo.label}</span>
                  <span className="text-[10px] uib-fg-faint">({filtered.length})</span>
                </div>
                <ChevronDownIcon
                  className={`w-3.5 h-3.5 uib-fg-faint transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                />
              </button>

              {/* Components Grid */}
              {isExpanded && (
                <div className="px-2 pb-2 grid grid-cols-2 gap-1.5">
                  {filtered.map(component => {
                    const Icon = ICON_MAP[component.icon] || Square;

                    return (
                      <div
                        key={component.type}
                        draggable
                        onDragStart={e => onDragStart(e, component)}
                        className="group flex flex-col items-center gap-1 p-2 rounded-lg border border-transparent hover:border-rose-500/30 hover:bg-rose-500/10 cursor-grab active:cursor-grabbing transition-all"
                        title={component.description}
                      >
                        <div className="relative">
                          <div className="w-8 h-8 rounded-lg uib-surface-2 group-uib-hover flex items-center justify-center uib-fg-muted group-hover:text-rose-500 transition-colors">
                            <Icon className="w-4 h-4" />
                          </div>
                          <GripVertical className="absolute -right-1 -top-1 w-3 h-3 uib-fg-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <span className="text-[10px] font-medium uib-fg-muted group-hover:text-rose-500 text-center leading-tight">
                          {component.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {search.trim() && Object.values(PALETTE_BY_CATEGORY).every(c => filterComponents(c).length === 0) && (
          <div className="p-4 text-center">
            <div className="uib-fg-faint text-xs">No components found</div>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="p-3 border-t uib-border uib-surface">
        <div className="text-[10px] uib-fg-faint text-center">
          Drag components onto the canvas to build your UI
        </div>
      </div>
    </div>
  );
}
