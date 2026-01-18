/**
 * UIBuilderModal - Main modal container for the visual UI designer
 * Integrates all UI builder components into a complete design experience
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, Settings2 } from 'lucide-react';
import type { UIDesign, UIElement, PaletteComponentDef, GeneratedCode, UIWindowConfig } from './types';
import { useUIBuilder } from './hooks/useUIBuilder';
import { useSelection } from './hooks/useSelection';
import { UIBuilderToolbar } from './UIBuilderToolbar';
import { UIBuilderPalette } from './UIBuilderPalette';
import { UIBuilderCanvas, type UIBuilderCanvasRef } from './UIBuilderCanvas';
import { UIBuilderProperties } from './UIBuilderProperties';
import { UIBuilderPreview, CodePanel } from './UIBuilderPreview';
import { createElementFromPalette } from './utils/dragDrop';
import { generateCode, generateCustomUIArgs } from './utils/codeGenerator';
import { createEmptyDesign } from './utils/defaultStyles';

interface UIBuilderModalProps {
  initialDesign?: Partial<UIDesign>;
  onSave: (design: UIDesign, code: GeneratedCode) => void;
  onClose: () => void;
  isOpen?: boolean;
}

// === Settings Panel ===

interface SettingsPanelProps {
  design: UIDesign;
  onUpdateCanvas: (updates: { width?: number; height?: number; backgroundColor?: string }) => void;
  onUpdateWindow: (updates: Partial<UIWindowConfig>) => void;
  onClose: () => void;
}

function SettingsPanel({ design, onUpdateCanvas, onUpdateWindow, onClose }: SettingsPanelProps) {
  const { canvas, windowConfig } = design;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="h-12 px-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-800">Design Settings</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {/* Canvas Settings */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Canvas Size</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Width</label>
                <input
                  type="number"
                  value={canvas.width}
                  onChange={e => onUpdateCanvas({ width: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Height</label>
                <input
                  type="number"
                  value={canvas.height}
                  onChange={e => onUpdateCanvas({ height: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                />
              </div>
            </div>
          </div>

          {/* Background Color */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Background Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={canvas.backgroundColor}
                onChange={e => onUpdateCanvas({ backgroundColor: e.target.value })}
                className="w-10 h-10 rounded border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                value={canvas.backgroundColor}
                onChange={e => onUpdateCanvas({ backgroundColor: e.target.value })}
                className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
              />
            </div>
          </div>

          {/* Window Settings */}
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Window Settings</div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Title</label>
                <input
                  type="text"
                  value={windowConfig.title || ''}
                  onChange={e => onUpdateWindow({ title: e.target.value })}
                  placeholder="Custom UI"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Position</label>
                <select
                  value={windowConfig.position}
                  onChange={e => onUpdateWindow({ position: e.target.value as any })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 bg-white"
                >
                  <option value="center">Center</option>
                  <option value="topleft">Top Left</option>
                  <option value="topright">Top Right</option>
                  <option value="bottomleft">Bottom Left</option>
                  <option value="bottomright">Bottom Right</option>
                  <option value="mouse">At Mouse</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={windowConfig.alwaysOnTop}
                    onChange={e => onUpdateWindow({ alwaysOnTop: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-600">Always on top</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={windowConfig.frameless}
                    onChange={e => onUpdateWindow({ frameless: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  <span className="text-sm text-slate-600">Frameless</span>
                </label>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Border Radius</label>
                <input
                  type="number"
                  value={windowConfig.borderRadius}
                  onChange={e => onUpdateWindow({ borderRadius: Number(e.target.value) })}
                  min={0}
                  max={50}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// === Main Modal ===

export function UIBuilderModal({
  initialDesign,
  onSave,
  onClose,
  isOpen = true,
}: UIBuilderModalProps) {
  const canvasRef = useRef<UIBuilderCanvasRef>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  // State management
  const builder = useUIBuilder(initialDesign);
  const { state, selectedElements } = builder;

  // UI state
  const [showCode, setShowCode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [draggedComponent, setDraggedComponent] = useState<PaletteComponentDef | null>(null);

  // Selection handling
  const selection = useSelection({
    elements: state.design.elements,
    selectedIds: state.selectedIds,
    zoom: state.zoom,
    panX: state.panX,
    panY: state.panY,
    gridSize: state.gridSize,
    snapToGrid: state.snapToGrid,
    onSelect: builder.select,
    onMoveElements: builder.moveElements,
    onResizeElement: builder.resizeElement,
    onDeleteElements: builder.deleteElements,
    onDuplicateElements: builder.duplicateElements,
    onCopy: builder.copy,
    onPaste: builder.paste,
    onUndo: builder.undo,
    onRedo: builder.redo,
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      selection.handleKeyDown(e);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection.handleKeyDown]);

  // Mouse event handlers for canvas
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (canvasWrapperRef.current) {
        selection.handleMouseMove(e, canvasWrapperRef.current);
      }
    };

    const handleMouseUp = () => {
      selection.handleMouseUp();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [selection.handleMouseMove, selection.handleMouseUp]);

  // Palette drag handlers
  const handlePaletteDragStart = useCallback((e: React.DragEvent, component: PaletteComponentDef) => {
    setDraggedComponent(component);
    e.dataTransfer.setData('application/json', JSON.stringify(component));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleCanvasDrop = useCallback((component: PaletteComponentDef, position: { x: number; y: number }) => {
    // Create and add the element at the calculated position
    const element = createElementFromPalette(component, position);
    builder.addElement(element);
    setDraggedComponent(null);
  }, [builder.addElement]);

  const handleCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (canvasWrapperRef.current) {
      selection.handleMouseDown(e, canvasWrapperRef.current);
    }
  }, [selection.handleMouseDown]);

  // Save handler
  const handleSave = useCallback(() => {
    const code = generateCode(state.design);
    onSave(state.design, code);
  }, [state.design, onSave]);

  // Zoom handlers
  const handleZoomIn = () => builder.setZoom(state.zoom + 0.25);
  const handleZoomOut = () => builder.setZoom(state.zoom - 0.25);
  const handleResetZoom = () => builder.setZoom(1);

  if (!isOpen) return null;

  // Get the first selected element for properties panel
  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 flex flex-col">
      {/* Toolbar */}
      <UIBuilderToolbar
        state={state}
        canUndo={builder.canUndo}
        canRedo={builder.canRedo}
        onUndo={builder.undo}
        onRedo={builder.redo}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onToggleGrid={builder.toggleGrid}
        onToggleSnap={builder.toggleSnap}
        onTogglePreview={builder.togglePreview}
        onShowCode={() => setShowCode(true)}
        onShowSettings={() => setShowSettings(true)}
        onSave={handleSave}
        onClose={onClose}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Palette */}
        {!state.previewMode && (
          <UIBuilderPalette onDragStart={handlePaletteDragStart} />
        )}

        {/* Canvas */}
        <div ref={canvasWrapperRef} className="flex-1">
          <UIBuilderCanvas
            ref={canvasRef}
            design={state.design}
            selectedIds={state.selectedIds}
            hoveredId={state.hoveredId}
            zoom={state.zoom}
            showGrid={state.showGrid}
            gridSize={state.gridSize}
            snapToGrid={state.snapToGrid}
            previewMode={state.previewMode}
            onMouseDown={handleCanvasMouseDown}
            onDrop={handleCanvasDrop}
            onDragOver={handleCanvasDragOver}
          />
        </div>

        {/* Right Properties Panel */}
        {!state.previewMode && (
          <UIBuilderProperties
            element={selectedElement}
            onUpdate={(updates) => {
              if (selectedElement) {
                builder.updateElement(selectedElement.id, updates);
              }
            }}
            onDelete={builder.deleteSelected}
            onDuplicate={builder.duplicateSelected}
            onBringForward={() => selectedElement && builder.bringForward(selectedElement.id)}
            onSendBackward={() => selectedElement && builder.sendBackward(selectedElement.id)}
          />
        )}
      </div>

      {/* Code Panel Modal */}
      {showCode && (
        <CodePanel
          design={state.design}
          onClose={() => setShowCode(false)}
        />
      )}

      {/* Settings Panel Modal */}
      {showSettings && (
        <SettingsPanel
          design={state.design}
          onUpdateCanvas={builder.updateCanvas}
          onUpdateWindow={builder.updateWindowConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// Re-export utilities for integration
export { generateCode, generateCustomUIArgs } from './utils/codeGenerator';
export { parseCustomUIArgs } from './utils/codeGenerator';
export { createEmptyDesign } from './utils/defaultStyles';
export type { UIDesign, GeneratedCode } from './types';
