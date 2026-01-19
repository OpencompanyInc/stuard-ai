/**
 * UIBuilderModal - Visual UI editor that works directly with HTML/CSS/JS
 * Seamlessly integrates with the custom_ui system
 */

import React, { useState, useCallback, useRef } from 'react';
import { X, Eye, EyeOff, Grid3x3, ZoomIn, ZoomOut, Code2, Save, Type, Square, MousePointer2, Image, ToggleLeft, List, Minus, LayoutGrid } from 'lucide-react';
import { UIBuilderCanvas, type UIBuilderCanvasRef, type SelectedElementInfo } from './UIBuilderCanvas';

// Helper to convert RGB/RGBA color strings to hex format for color inputs
function rgbToHex(rgb: string | undefined): string {
  if (!rgb) return '#ffffff';

  // Already hex
  if (rgb.startsWith('#')) return rgb;

  // Handle transparent/rgba with 0 alpha
  if (rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return '#ffffff';

  // Parse rgb(r, g, b) or rgba(r, g, b, a)
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  // Return original if can't parse
  return rgb.startsWith('#') ? rgb : '#ffffff';
}

// Helper to convert camelCase to kebab-case for CSS properties
function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

// Component templates for the palette
const COMPONENT_TEMPLATES = [
  {
    id: 'button',
    name: 'Button',
    icon: MousePointer2,
    html: '<button class="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors">Button</button>',
  },
  {
    id: 'text',
    name: 'Text',
    icon: Type,
    html: '<p class="text-slate-700">Text paragraph</p>',
  },
  {
    id: 'heading',
    name: 'Heading',
    icon: Type,
    html: '<h2 class="text-2xl font-bold text-slate-800">Heading</h2>',
  },
  {
    id: 'container',
    name: 'Container',
    icon: Square,
    html: '<div class="p-4 bg-slate-100 rounded-lg border border-slate-200">Container</div>',
  },
  {
    id: 'input',
    name: 'Input',
    icon: Minus,
    html: '<input type="text" class="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200" placeholder="Enter text..." />',
  },
  {
    id: 'image',
    name: 'Image',
    icon: Image,
    html: '<img src="https://via.placeholder.com/200x150" class="rounded-lg" alt="Placeholder" />',
  },
  {
    id: 'card',
    name: 'Card',
    icon: Square,
    html: `<div class="p-4 bg-white rounded-xl shadow-md border border-slate-100">
  <h3 class="font-semibold text-slate-800 mb-2">Card Title</h3>
  <p class="text-sm text-slate-600">Card content goes here.</p>
</div>`,
  },
  {
    id: 'row',
    name: 'Row',
    icon: LayoutGrid,
    html: '<div class="flex gap-4 p-2">Row content</div>',
  },
  {
    id: 'column',
    name: 'Column',
    icon: LayoutGrid,
    html: '<div class="flex flex-col gap-2 p-2">Column content</div>',
  },
  {
    id: 'list',
    name: 'List',
    icon: List,
    html: `<ul class="space-y-2">
  <li class="flex items-center gap-2"><span class="w-2 h-2 bg-indigo-500 rounded-full"></span>Item 1</li>
  <li class="flex items-center gap-2"><span class="w-2 h-2 bg-indigo-500 rounded-full"></span>Item 2</li>
  <li class="flex items-center gap-2"><span class="w-2 h-2 bg-indigo-500 rounded-full"></span>Item 3</li>
</ul>`,
  },
  {
    id: 'checkbox',
    name: 'Checkbox',
    icon: ToggleLeft,
    html: '<label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" class="w-4 h-4 rounded" /><span class="text-slate-700">Checkbox</span></label>',
  },
];

interface UIBuilderModalProps {
  // Current custom_ui args
  html: string;
  css: string;
  js: string;
  windowConfig: {
    width?: number;
    height?: number;
    title?: string;
    position?: string;
    alwaysOnTop?: boolean;
    frameless?: boolean;
    borderRadius?: number;
  };
  onSave: (args: { html: string; css: string; js: string; window: any }) => void;
  onClose: () => void;
}

export function UIBuilderModal({
  html: initialHtml,
  css: initialCss,
  js: initialJs,
  windowConfig,
  onSave,
  onClose,
}: UIBuilderModalProps) {
  const canvasRef = useRef<UIBuilderCanvasRef>(null);
  const pendingSaveRef = useRef<boolean>(false);

  // Editor state
  const [html, setHtml] = useState(initialHtml || '');
  const [css, setCss] = useState(initialCss || '');
  const [js, setJs] = useState(initialJs || '');

  // UI state
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElementInfo | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showCodePanel, setShowCodePanel] = useState(false);
  const [draggedComponent, setDraggedComponent] = useState<string | null>(null);

  // Canvas dimensions from window config
  const canvasWidth = windowConfig.width || 800;
  const canvasHeight = windowConfig.height || 600;

  // Handle element selection
  const handleSelectElement = useCallback((element: SelectedElementInfo | null) => {
    setSelectedElement(element);
    setSelectedPath(element?.path || null);
  }, []);

  // Handle hover
  const handleHoverElement = useCallback((path: string | null) => {
    // Could show hover info in status bar
  }, []);

  // Update element property (text, class, id)
  const updateElementProperty = useCallback((updates: { textContent?: string; className?: string; id?: string }) => {
    if (selectedPath && canvasRef.current) {
      canvasRef.current.updateElement(selectedPath, updates);
    }
  }, [selectedPath]);

  // Update element style property
  const updateElementStyle = useCallback((property: string, value: string) => {
    if (selectedPath && canvasRef.current) {
      // Build style string with the new property
      const currentStyle = selectedElement?.attributes?.style || '';
      const styleObj: Record<string, string> = {};

      // Parse existing inline styles
      currentStyle.split(';').forEach(s => {
        const [key, val] = s.split(':').map(x => x?.trim());
        if (key && val) styleObj[key] = val;
      });

      // Convert camelCase property to kebab-case for CSS
      const cssProperty = camelToKebab(property);
      styleObj[cssProperty] = value;

      // Build new style string
      const newStyle = Object.entries(styleObj)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');

      canvasRef.current.updateElement(selectedPath, { style: newStyle });
    }
  }, [selectedPath, selectedElement]);

  // Handle HTML change from canvas (after element updates)
  const handleHtmlChange = useCallback((newHtml: string) => {
    setHtml(newHtml);
    // If we were waiting to save, do it now
    if (pendingSaveRef.current) {
      pendingSaveRef.current = false;
      onSave({
        html: newHtml,
        css,
        js,
        window: windowConfig,
      });
    }
  }, [css, js, windowConfig, onSave]);

  // Save handler - requests HTML from iframe first
  const handleSave = useCallback(() => {
    if (canvasRef.current) {
      // Request updated HTML from iframe
      pendingSaveRef.current = true;
      canvasRef.current.requestHtml();

      // Set a timeout fallback in case the message doesn't come back
      setTimeout(() => {
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          onSave({
            html,
            css,
            js,
            window: windowConfig,
          });
        }
      }, 500);
    } else {
      // Fallback - save current state directly
      onSave({
        html,
        css,
        js,
        window: windowConfig,
      });
    }
  }, [html, css, js, windowConfig, onSave]);

  // Add component to canvas
  const addComponent = useCallback((componentId: string) => {
    const template = COMPONENT_TEMPLATES.find(c => c.id === componentId);
    if (template) {
      // Add the component HTML to the end of the body
      setHtml(prev => {
        const trimmed = prev.trim();
        if (!trimmed) {
          return template.html;
        }
        return trimmed + '\n' + template.html;
      });
    }
  }, []);

  // Drag handlers for palette
  const handleDragStart = useCallback((e: React.DragEvent, componentId: string) => {
    e.dataTransfer.setData('text/plain', componentId);
    setDraggedComponent(componentId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedComponent(null);
  }, []);

  // Zoom handlers
  const handleZoomIn = () => setZoom(z => Math.min(z + 0.25, 2));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.25, 0.25));
  const handleResetZoom = () => setZoom(1);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/90 flex flex-col">
      {/* Toolbar */}
      <div className="h-12 px-4 bg-white border-b border-slate-200 flex items-center justify-between">
        {/* Left - Title */}
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Grid3x3 className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">UI Designer</div>
            <div className="text-[10px] text-slate-400">Drag components • Click to edit</div>
          </div>
        </div>

        {/* Center - View Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom */}
          <div className="flex items-center gap-1 bg-slate-50 rounded-md border border-slate-200 p-0.5">
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 0.25}
              className="p-1 text-slate-500 hover:text-slate-700 hover:bg-white rounded disabled:opacity-40"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetZoom}
              className="min-w-[50px] px-2 py-1 text-xs font-mono text-slate-600 hover:bg-white rounded"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 2}
              className="p-1 text-slate-500 hover:text-slate-700 hover:bg-white rounded disabled:opacity-40"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          {/* Grid Toggle */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-all ${
              showGrid
                ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                : 'text-slate-600 hover:bg-slate-100 border border-transparent'
            }`}
          >
            <Grid3x3 className="w-4 h-4" />
            Grid
          </button>

          {/* Preview Toggle */}
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-all ${
              previewMode
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : 'text-slate-600 hover:bg-slate-100 border border-transparent'
            }`}
          >
            {previewMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {previewMode ? 'Exit Preview' : 'Preview'}
          </button>
        </div>

        {/* Right - Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCodePanel(!showCodePanel)}
            className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md transition-all ${
              showCodePanel
                ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                : 'text-slate-600 hover:bg-slate-100 border border-transparent'
            }`}
          >
            <Code2 className="w-4 h-4" />
            Code
          </button>

          <div className="w-px h-6 bg-slate-200 mx-1" />

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 rounded-md hover:from-indigo-600 hover:to-purple-700 shadow-sm"
          >
            <Save className="w-4 h-4" />
            Save
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Component Palette */}
        {!previewMode && (
          <div className="w-48 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-slate-200">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Components</div>
            </div>
            <div className="flex-1 overflow-auto p-2">
              <div className="grid grid-cols-2 gap-2">
                {COMPONENT_TEMPLATES.map((component) => {
                  const Icon = component.icon;
                  return (
                    <button
                      key={component.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, component.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => addComponent(component.id)}
                      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border-2 border-dashed transition-all cursor-grab active:cursor-grabbing ${
                        draggedComponent === component.id
                          ? 'border-indigo-400 bg-indigo-50'
                          : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                      }`}
                      title={`Add ${component.name}`}
                    >
                      <Icon className="w-5 h-5 text-slate-500" />
                      <span className="text-[10px] font-medium text-slate-600">{component.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="p-2 border-t border-slate-100">
              <div className="text-[10px] text-slate-400 text-center">Click or drag to add</div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 flex flex-col min-h-0">
          <UIBuilderCanvas
            ref={canvasRef}
            html={html}
            css={css}
            js={js}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            backgroundColor="#ffffff"
            zoom={zoom}
            showGrid={showGrid}
            gridSize={8}
            previewMode={previewMode}
            selectedPath={selectedPath}
            onSelectElement={handleSelectElement}
            onHoverElement={handleHoverElement}
            onHtmlChange={handleHtmlChange}
          />
        </div>

        {/* Right Panel - Properties or Code */}
        {!previewMode && (
          <div className="w-72 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
            {showCodePanel ? (
              // Code Editor Panel
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-slate-200">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Code Editor</div>
                </div>
                <div className="flex-1 overflow-auto p-3 space-y-4">
                  {/* HTML */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">HTML</label>
                    <textarea
                      value={html}
                      onChange={(e) => setHtml(e.target.value)}
                      className="w-full h-32 px-2 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                      placeholder="<div>...</div>"
                    />
                  </div>
                  {/* CSS */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">CSS</label>
                    <textarea
                      value={css}
                      onChange={(e) => setCss(e.target.value)}
                      className="w-full h-24 px-2 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                      placeholder=".class { ... }"
                    />
                  </div>
                  {/* JS */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">JavaScript</label>
                    <textarea
                      value={js}
                      onChange={(e) => setJs(e.target.value)}
                      className="w-full h-24 px-2 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                      placeholder="// code..."
                    />
                  </div>
                </div>
              </div>
            ) : (
              // Properties Panel - User Friendly
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-slate-200">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    {selectedElement ? 'Edit Element' : 'Properties'}
                  </div>
                </div>

                {selectedElement ? (
                  <div className="flex-1 overflow-auto p-3 space-y-5">
                    {/* Element Type Badge */}
                    <div className="flex items-center justify-between">
                      <span className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-semibold rounded-full capitalize">
                        {selectedElement.tagName === 'div' ? 'Container' :
                         selectedElement.tagName === 'button' ? 'Button' :
                         selectedElement.tagName === 'input' ? 'Input' :
                         selectedElement.tagName === 'img' ? 'Image' :
                         selectedElement.tagName === 'span' ? 'Text' :
                         selectedElement.tagName === 'p' ? 'Paragraph' :
                         selectedElement.tagName === 'h1' || selectedElement.tagName === 'h2' || selectedElement.tagName === 'h3' ? 'Heading' :
                         selectedElement.tagName}
                      </span>
                      <span className="text-xs text-slate-400">
                        {Math.round(selectedElement.rect.width)} × {Math.round(selectedElement.rect.height)}
                      </span>
                    </div>

                    {/* Text Content - Most Important */}
                    {selectedElement.textContent && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-2">Text</label>
                        <input
                          type="text"
                          value={selectedElement.textContent}
                          onChange={(e) => updateElementProperty({ textContent: e.target.value })}
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                        />
                      </div>
                    )}

                    {/* Colors Section */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">Colors</label>
                      <div className="space-y-2">
                        {/* Background Color */}
                        <div className="flex items-center gap-2">
                          <div
                            className="w-8 h-8 rounded-lg border-2 border-slate-200 cursor-pointer shadow-inner"
                            style={{ backgroundColor: selectedElement.styles.backgroundColor || 'transparent' }}
                            title="Background Color"
                          />
                          <span className="text-xs text-slate-600 flex-1">Background</span>
                          <input
                            type="color"
                            value={rgbToHex(selectedElement.styles.backgroundColor) || '#ffffff'}
                            onChange={(e) => updateElementStyle('backgroundColor', e.target.value)}
                            className="w-6 h-6 rounded cursor-pointer"
                          />
                        </div>
                        {/* Text Color */}
                        <div className="flex items-center gap-2">
                          <div
                            className="w-8 h-8 rounded-lg border-2 border-slate-200 cursor-pointer flex items-center justify-center text-lg font-bold"
                            style={{ color: selectedElement.styles.color || '#000000' }}
                            title="Text Color"
                          >
                            A
                          </div>
                          <span className="text-xs text-slate-600 flex-1">Text</span>
                          <input
                            type="color"
                            value={rgbToHex(selectedElement.styles.color) || '#000000'}
                            onChange={(e) => updateElementStyle('color', e.target.value)}
                            className="w-6 h-6 rounded cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Size Section */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">Size</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-500 mb-1 block">Width</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={Math.round(selectedElement.rect.width)}
                              onChange={(e) => updateElementStyle('width', e.target.value + 'px')}
                              className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            />
                            <span className="text-xs text-slate-400">px</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 mb-1 block">Height</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={Math.round(selectedElement.rect.height)}
                              onChange={(e) => updateElementStyle('height', e.target.value + 'px')}
                              className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            />
                            <span className="text-xs text-slate-400">px</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Spacing Section */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">Spacing</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-slate-500 mb-1 block">Padding</label>
                          <input
                            type="text"
                            value={selectedElement.styles.padding || '0px'}
                            onChange={(e) => updateElementStyle('padding', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            placeholder="8px"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-500 mb-1 block">Margin</label>
                          <input
                            type="text"
                            value={selectedElement.styles.margin || '0px'}
                            onChange={(e) => updateElementStyle('margin', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            placeholder="0px"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Border Radius */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">Corners</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="0"
                          max="50"
                          value={parseInt(selectedElement.styles.borderRadius) || 0}
                          onChange={(e) => updateElementStyle('borderRadius', e.target.value + 'px')}
                          className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <span className="text-xs text-slate-600 w-12 text-right">
                          {parseInt(selectedElement.styles.borderRadius) || 0}px
                        </span>
                      </div>
                    </div>

                    {/* Font Size */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">Font Size</label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min="8"
                          max="48"
                          value={parseInt(selectedElement.styles.fontSize) || 14}
                          onChange={(e) => updateElementStyle('fontSize', e.target.value + 'px')}
                          className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                        <span className="text-xs text-slate-600 w-12 text-right">
                          {parseInt(selectedElement.styles.fontSize) || 14}px
                        </span>
                      </div>
                    </div>

                    {/* Advanced Section (collapsed by default) */}
                    <details className="pt-2 border-t border-slate-100">
                      <summary className="text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-700">
                        Advanced Settings
                      </summary>
                      <div className="mt-3 space-y-3">
                        {/* ID */}
                        <div>
                          <label className="text-[10px] text-slate-500 mb-1 block">Element ID</label>
                          <input
                            type="text"
                            value={selectedElement.id}
                            onChange={(e) => updateElementProperty({ id: e.target.value })}
                            className="w-full px-2 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            placeholder="element-id"
                          />
                        </div>
                        {/* Classes */}
                        <div>
                          <label className="text-[10px] text-slate-500 mb-1 block">CSS Classes</label>
                          <textarea
                            value={selectedElement.className.replace(' ui-selected', '').replace(' ui-hovered', '')}
                            onChange={(e) => updateElementProperty({ className: e.target.value })}
                            className="w-full h-16 px-2 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            placeholder="class1 class2"
                          />
                        </div>
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center text-slate-400">
                      <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-slate-100 flex items-center justify-center">
                        <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                        </svg>
                      </div>
                      <div className="text-sm font-medium mb-1">Click to Select</div>
                      <div className="text-xs">Click any element in the preview to edit it</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
