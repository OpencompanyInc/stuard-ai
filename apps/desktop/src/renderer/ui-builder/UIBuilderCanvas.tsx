/**
 * UIBuilderCanvas - Visual canvas with drag-drop
 * Renders elements and handles selection, dragging, and resizing
 */

import React, { useRef, useState, forwardRef, useImperativeHandle } from 'react';
import type { UIElement, UIDesign, PaletteComponentDef, Bounds } from './types';
import { getElementBounds, getResizeHandles, RESIZE_HANDLE_SIZE } from './utils/dragDrop';
import { HEADING_SIZES, BUTTON_VARIANTS } from './utils/defaultStyles';

export interface UIBuilderCanvasRef {
  getDropPosition: (e: React.DragEvent) => { x: number; y: number };
}

interface UIBuilderCanvasProps {
  design: UIDesign;
  selectedIds: string[];
  hoveredId: string | null;
  zoom: number;
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
  previewMode: boolean;
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onDrop: (component: PaletteComponentDef, position: { x: number; y: number }) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
}

// === Element Renderer ===

interface ElementRendererProps {
  element: UIElement;
  isSelected: boolean;
  isHovered: boolean;
  previewMode: boolean;
}

function ElementRenderer({
  element,
  isSelected,
  isHovered,
  previewMode,
}: ElementRendererProps) {
  const { type, props, style, layout, children } = element;

  // Build inline styles
  const inlineStyle: React.CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: typeof element.width === 'number' ? element.width : element.width === 'full' ? '100%' : 'auto',
    height: typeof element.height === 'number' ? element.height : element.height === 'full' ? '100%' : 'auto',
    backgroundColor: style.backgroundColor,
    color: style.textColor,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight === 'bold' ? 700 : style.fontWeight === 'semibold' ? 600 : style.fontWeight === 'medium' ? 500 : 400,
    textAlign: style.textAlign,
    borderRadius: style.borderRadius,
    borderWidth: style.borderWidth,
    borderColor: style.borderColor,
    borderStyle: style.borderWidth ? 'solid' : undefined,
    padding: typeof style.padding === 'number' ? style.padding : undefined,
    margin: typeof style.margin === 'number' ? style.margin : undefined,
    opacity: style.opacity,
    zIndex: element.zIndex,
    boxSizing: 'border-box',
    pointerEvents: previewMode ? 'auto' : 'none',
  };

  // Add layout styles for containers
  if (layout) {
    if (layout === 'flex-row') {
      inlineStyle.display = 'flex';
      inlineStyle.flexDirection = 'row';
    } else if (layout === 'flex-col') {
      inlineStyle.display = 'flex';
      inlineStyle.flexDirection = 'column';
    } else if (layout === 'grid') {
      inlineStyle.display = 'grid';
      inlineStyle.gridTemplateColumns = `repeat(${element.gridCols || props.columns || 3}, 1fr)`;
    }
    if (element.gap) {
      inlineStyle.gap = element.gap;
    }
    if (element.alignItems) {
      const alignMap: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
      inlineStyle.alignItems = alignMap[element.alignItems] as any;
    }
    if (element.justifyContent) {
      const justifyMap: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
      inlineStyle.justifyContent = justifyMap[element.justifyContent] as any;
    }
  }

  // Shadow
  if (style.shadow && style.shadow !== 'none') {
    const shadows: Record<string, string> = {
      sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
      xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    };
    inlineStyle.boxShadow = shadows[style.shadow];
  }

  // Selection/hover outline
  const outlineStyle: React.CSSProperties = !previewMode ? {
    outline: isSelected ? '2px solid #6366f1' : isHovered ? '2px solid #a5b4fc' : 'none',
    outlineOffset: '1px',
  } : {};

  const wrapperStyle: React.CSSProperties = {
    ...inlineStyle,
    ...outlineStyle,
    cursor: previewMode ? 'default' : 'move',
  };

  // Render based on type
  switch (type) {
    case 'button': {
      const variant = props.variant || 'primary';
      const variantStyles = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;
      return (
        <button
          style={{
            ...wrapperStyle,
            backgroundColor: variantStyles.bg,
            color: variantStyles.text,
            border: variantStyles.border ? `1px solid ${variantStyles.border}` : 'none',
            cursor: props.disabled ? 'not-allowed' : 'pointer',
            opacity: props.disabled ? 0.5 : 1,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {props.text || 'Button'}
        </button>
      );
    }

    case 'input':
      return (
        <input
          type={props.inputType || 'text'}
          placeholder={props.placeholder}
          disabled={props.disabled}
          readOnly
          style={{
            ...wrapperStyle,
            padding: style.padding || 10,
            border: `1px solid ${style.borderColor || '#e2e8f0'}`,
          }}
        />
      );

    case 'textarea':
      return (
        <textarea
          placeholder={props.placeholder}
          disabled={props.disabled}
          readOnly
          style={{
            ...wrapperStyle,
            padding: style.padding || 12,
            border: `1px solid ${style.borderColor || '#e2e8f0'}`,
            resize: 'none',
          }}
        />
      );

    case 'text':
      return (
        <span style={wrapperStyle}>
          {props.text || 'Text'}
        </span>
      );

    case 'heading': {
      const Tag = `h${props.level || 2}` as keyof JSX.IntrinsicElements;
      const fontSize = HEADING_SIZES[props.level || 2];
      return (
        <Tag style={{ ...wrapperStyle, fontSize, fontWeight: 700, margin: 0 }}>
          {props.text || 'Heading'}
        </Tag>
      );
    }

    case 'image':
      return props.src ? (
        <img
          src={props.src}
          alt={props.alt || ''}
          style={{
            ...wrapperStyle,
            objectFit: props.objectFit || 'cover',
          }}
        />
      ) : (
        <div
          style={{
            ...wrapperStyle,
            backgroundColor: '#f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: 12,
          }}
        >
          Image
        </div>
      );

    case 'checkbox':
      return (
        <label style={{ ...wrapperStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" disabled={props.disabled} style={{ width: 18, height: 18 }} />
          <span>{props.text || 'Checkbox'}</span>
        </label>
      );

    case 'select':
      return (
        <select
          disabled={props.disabled}
          style={{
            ...wrapperStyle,
            padding: style.padding || 10,
            border: `1px solid ${style.borderColor || '#e2e8f0'}`,
            backgroundColor: 'white',
          }}
        >
          {(props.options || []).map((opt: any, i: number) => (
            <option key={i} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );

    case 'slider':
      return (
        <input
          type="range"
          min={props.min ?? 0}
          max={props.max ?? 100}
          step={props.step ?? 1}
          disabled={props.disabled}
          style={wrapperStyle}
        />
      );

    case 'badge': {
      const badgeColors: Record<string, { bg: string; text: string }> = {
        gray: { bg: '#f1f5f9', text: '#475569' },
        red: { bg: '#fee2e2', text: '#b91c1c' },
        yellow: { bg: '#fef3c7', text: '#a16207' },
        green: { bg: '#dcfce7', text: '#15803d' },
        blue: { bg: '#dbeafe', text: '#1d4ed8' },
        indigo: { bg: '#e0e7ff', text: '#4338ca' },
        purple: { bg: '#ede9fe', text: '#6d28d9' },
        pink: { bg: '#fce7f3', text: '#be185d' },
      };
      const colors = badgeColors[props.color || 'blue'];
      return (
        <span
          style={{
            ...wrapperStyle,
            backgroundColor: colors.bg,
            color: colors.text,
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 12px',
            borderRadius: 9999,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {props.text || 'Badge'}
        </span>
      );
    }

    case 'progress':
      return (
        <div
          style={{
            ...wrapperStyle,
            backgroundColor: '#e2e8f0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${props.value || 0}%`,
              height: '100%',
              backgroundColor: '#4f46e5',
              transition: 'width 0.3s',
            }}
          />
        </div>
      );

    case 'divider':
      return (
        <hr
          style={{
            ...wrapperStyle,
            border: 'none',
            borderTop: `1px solid ${style.backgroundColor || '#e2e8f0'}`,
            margin: 0,
          }}
        />
      );

    case 'spacer':
      return (
        <div
          style={{
            ...wrapperStyle,
            backgroundColor: previewMode ? 'transparent' : 'rgba(99, 102, 241, 0.1)',
            border: previewMode ? 'none' : '1px dashed rgba(99, 102, 241, 0.3)',
          }}
        />
      );

    case 'container':
    case 'row':
    case 'column':
    case 'grid':
    case 'card':
      return (
        <div style={wrapperStyle}>
          {children?.map(child => (
            <ElementRenderer
              key={child.id}
              element={child}
              isSelected={false}
              isHovered={false}
              previewMode={previewMode}
            />
          ))}
          {!children?.length && !previewMode && (
            <div
              style={{
                padding: 20,
                color: '#94a3b8',
                fontSize: 12,
                textAlign: 'center',
                border: '1px dashed #e2e8f0',
                borderRadius: 4,
              }}
            >
              Drop components here
            </div>
          )}
        </div>
      );

    case 'code-block':
      return (
        <pre
          style={{
            ...wrapperStyle,
            backgroundColor: '#1e293b',
            color: '#e2e8f0',
            fontFamily: 'Monaco, Menlo, monospace',
            fontSize: 13,
            overflow: 'auto',
            margin: 0,
          }}
        >
          <code>{props.text || '// Code here'}</code>
        </pre>
      );

    default:
      return (
        <div style={wrapperStyle}>
          {type}
        </div>
      );
  }
}

// === Resize Handles ===

function SelectionOverlay({ element }: { element: UIElement }) {
  const bounds = getElementBounds(element);
  const handles = getResizeHandles(bounds);

  return (
    <>
      {handles.map(handle => (
        <div
          key={handle.position}
          style={{
            position: 'absolute',
            left: handle.x,
            top: handle.y,
            width: RESIZE_HANDLE_SIZE,
            height: RESIZE_HANDLE_SIZE,
            backgroundColor: 'white',
            border: '2px solid #6366f1',
            borderRadius: 2,
            cursor: getCursorForHandle(handle.position),
            zIndex: 1000,
          }}
          data-handle={handle.position}
        />
      ))}
    </>
  );
}

function getCursorForHandle(position: string): string {
  const cursors: Record<string, string> = {
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
    nw: 'nwse-resize',
  };
  return cursors[position] || 'default';
}

// === Grid Pattern ===

function GridPattern({ gridSize }: { gridSize: number }) {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.3 }}
    >
      <defs>
        <pattern
          id="grid-pattern"
          width={gridSize}
          height={gridSize}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-pattern)" />
    </svg>
  );
}

// === Main Canvas Component ===

export const UIBuilderCanvas = forwardRef<UIBuilderCanvasRef, UIBuilderCanvasProps>(function UIBuilderCanvas({
  design,
  selectedIds,
  hoveredId,
  zoom,
  showGrid,
  gridSize,
  snapToGrid,
  previewMode,
  onMouseDown,
  onDrop,
  onDragOver,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasInnerRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const { canvas, elements } = design;

  // Expose method to calculate drop position
  useImperativeHandle(ref, () => ({
    getDropPosition: (e: React.DragEvent) => {
      if (!containerRef.current || !canvasInnerRef.current) {
        return { x: 0, y: 0 };
      }

      const containerRect = containerRef.current.getBoundingClientRect();
      const canvasRect = canvasInnerRef.current.getBoundingClientRect();

      // Calculate position relative to the canvas inner element
      let x = (e.clientX - canvasRect.left) / zoom - (canvas.padding || 0);
      let y = (e.clientY - canvasRect.top) / zoom - (canvas.padding || 0);

      // Snap to grid
      if (snapToGrid) {
        x = Math.round(x / gridSize) * gridSize;
        y = Math.round(y / gridSize) * gridSize;
      }

      // Clamp to canvas bounds
      x = Math.max(0, Math.min(x, canvas.width - 50));
      y = Math.max(0, Math.min(y, canvas.height - 50));

      return { x, y };
    },
  }));

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    const componentJson = e.dataTransfer.getData('application/json');
    if (!componentJson) return;

    try {
      const component = JSON.parse(componentJson) as PaletteComponentDef;

      // Calculate drop position
      if (!containerRef.current || !canvasInnerRef.current) return;

      const canvasRect = canvasInnerRef.current.getBoundingClientRect();

      let x = (e.clientX - canvasRect.left) / zoom - (canvas.padding || 0);
      let y = (e.clientY - canvasRect.top) / zoom - (canvas.padding || 0);

      // Snap to grid
      if (snapToGrid) {
        x = Math.round(x / gridSize) * gridSize;
        y = Math.round(y / gridSize) * gridSize;
      }

      // Clamp to canvas bounds
      x = Math.max(0, Math.min(x, canvas.width - 50));
      y = Math.max(0, Math.min(y, canvas.height - 50));

      onDrop(component, { x, y });
    } catch (err) {
      console.error('Failed to parse dropped component:', err);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    onDragOver(e);
  };

  // Find selected elements for overlay
  const selectedElements = elements.filter(el => selectedIds.includes(el.id));

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-slate-200 overflow-hidden relative"
      style={{ minHeight: '100%' }}
      onMouseDown={onMouseDown}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Centered Canvas Container */}
      <div
        className="absolute"
        style={{
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Canvas */}
        <div
          ref={canvasInnerRef}
          className={`relative shadow-2xl transition-shadow ${isDragOver ? 'ring-4 ring-indigo-400' : ''}`}
          style={{
            width: canvas.width,
            height: canvas.height,
            backgroundColor: canvas.backgroundColor,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {/* Grid */}
          {showGrid && !previewMode && (
            <GridPattern gridSize={gridSize} />
          )}

          {/* Canvas Content Area with Padding */}
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ padding: canvas.padding || 0 }}
          >
            {/* Elements */}
            {elements.map(element => (
              <ElementRenderer
                key={element.id}
                element={element}
                isSelected={selectedIds.includes(element.id)}
                isHovered={hoveredId === element.id}
                previewMode={previewMode}
              />
            ))}

            {/* Empty state */}
            {elements.length === 0 && !previewMode && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-slate-400">
                  <div className="text-lg font-medium mb-1">Drop components here</div>
                  <div className="text-sm">Drag from the palette on the left</div>
                </div>
              </div>
            )}
          </div>

          {/* Selection Overlays - positioned relative to canvas, not padding */}
          {!previewMode && selectedElements.map(element => (
            <div
              key={`overlay-${element.id}`}
              style={{
                position: 'absolute',
                left: (canvas.padding || 0),
                top: (canvas.padding || 0),
                width: canvas.width - (canvas.padding || 0) * 2,
                height: canvas.height - (canvas.padding || 0) * 2,
                pointerEvents: 'none',
              }}
            >
              <SelectionOverlay element={element} />
            </div>
          ))}
        </div>
      </div>

      {/* Canvas Size Indicator */}
      <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-white rounded-lg text-xs text-slate-600 border border-slate-200 shadow-sm">
        {canvas.width} x {canvas.height}
      </div>

      {/* Drop Indicator */}
      {isDragOver && (
        <div className="absolute inset-0 bg-indigo-500/10 pointer-events-none flex items-center justify-center">
          <div className="px-6 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl shadow-xl">
            Drop to add component
          </div>
        </div>
      )}

      {/* Preview Mode Indicator */}
      {previewMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-emerald-500 text-white text-xs font-semibold rounded-full shadow-lg">
          Preview Mode - Interactions Enabled
        </div>
      )}
    </div>
  );
});
