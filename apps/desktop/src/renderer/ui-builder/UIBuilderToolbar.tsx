/**
 * UIBuilderToolbar - Top toolbar with actions
 * Includes zoom, grid controls, preview, and save actions
 */

import React from 'react';
import {
  Undo2, Redo2, ZoomIn, ZoomOut, Grid3x3, Magnet, Eye, Code2,
  Save, X, Play, Settings2, Maximize2, Minimize2, RotateCcw
} from 'lucide-react';
import type { UIBuilderState } from './types';

interface UIBuilderToolbarProps {
  state: UIBuilderState;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onTogglePreview: () => void;
  onShowCode: () => void;
  onShowSettings: () => void;
  onSave: () => void;
  onClose: () => void;
}

// Toolbar Button Component
function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  className = '',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-all
        ${active
          ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
          : 'text-slate-600 hover:bg-slate-100 border border-transparent'
        }
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      title={label}
    >
      <Icon className="w-4 h-4" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// Toolbar Divider
function ToolbarDivider() {
  return <div className="w-px h-6 bg-slate-200 mx-1" />;
}

// Zoom Control
function ZoomControl({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}) {
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="flex items-center gap-1 bg-slate-50 rounded-md border border-slate-200 p-0.5">
      <button
        onClick={onZoomOut}
        disabled={zoom <= 0.25}
        className="p-1 text-slate-500 hover:text-slate-700 hover:bg-white rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title="Zoom Out"
      >
        <ZoomOut className="w-4 h-4" />
      </button>
      <button
        onClick={onResetZoom}
        className="min-w-[50px] px-2 py-1 text-xs font-mono text-slate-600 hover:bg-white rounded transition-colors"
        title="Reset Zoom"
      >
        {zoomPercent}%
      </button>
      <button
        onClick={onZoomIn}
        disabled={zoom >= 4}
        className="p-1 text-slate-500 hover:text-slate-700 hover:bg-white rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title="Zoom In"
      >
        <ZoomIn className="w-4 h-4" />
      </button>
    </div>
  );
}

export function UIBuilderToolbar({
  state,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onToggleGrid,
  onToggleSnap,
  onTogglePreview,
  onShowCode,
  onShowSettings,
  onSave,
  onClose,
}: UIBuilderToolbarProps) {
  return (
    <div className="h-12 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
      {/* Left Section - Design Name & Undo/Redo */}
      <div className="flex items-center gap-3">
        {/* Design Name */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Grid3x3 className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">{state.design.name}</div>
            <div className="text-[10px] text-slate-400">UI Builder</div>
          </div>
        </div>

        <ToolbarDivider />

        {/* Undo/Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Center Section - View Controls */}
      <div className="flex items-center gap-2">
        {/* Zoom */}
        <ZoomControl
          zoom={state.zoom}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onResetZoom={onResetZoom}
        />

        <ToolbarDivider />

        {/* Grid & Snap */}
        <ToolbarButton
          icon={Grid3x3}
          label="Grid"
          onClick={onToggleGrid}
          active={state.showGrid}
        />
        <ToolbarButton
          icon={Magnet}
          label="Snap"
          onClick={onToggleSnap}
          active={state.snapToGrid}
        />

        <ToolbarDivider />

        {/* Preview Mode */}
        <ToolbarButton
          icon={state.previewMode ? Eye : Play}
          label={state.previewMode ? 'Exit Preview' : 'Preview'}
          onClick={onTogglePreview}
          active={state.previewMode}
          className={state.previewMode ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : ''}
        />
      </div>

      {/* Right Section - Actions */}
      <div className="flex items-center gap-2">
        {/* View Code */}
        <ToolbarButton
          icon={Code2}
          label="View Code"
          onClick={onShowCode}
        />

        {/* Settings */}
        <ToolbarButton
          icon={Settings2}
          label="Settings"
          onClick={onShowSettings}
        />

        <ToolbarDivider />

        {/* Save */}
        <button
          onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 rounded-md hover:from-indigo-600 hover:to-purple-700 shadow-sm transition-all"
        >
          <Save className="w-4 h-4" />
          Save
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
