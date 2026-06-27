/**
 * Drag and Drop Utilities
 * Handles drag-drop logic for the UI Builder canvas
 */

import type { UIElement, Point, Bounds, AlignmentGuide, PaletteComponentDef, DragState } from '../types';
import { generateId } from './defaultStyles';

// === Coordinate Calculations ===

/**
 * Get mouse position relative to an element
 */
export function getRelativeMousePos(event: MouseEvent | React.MouseEvent, element: HTMLElement): Point {
  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

/**
 * Get canvas coordinates accounting for zoom and pan
 */
export function screenToCanvas(
  screenPos: Point,
  zoom: number,
  panX: number,
  panY: number
): Point {
  return {
    x: (screenPos.x - panX) / zoom,
    y: (screenPos.y - panY) / zoom,
  };
}

/**
 * Convert canvas coordinates to screen coordinates
 */
export function canvasToScreen(
  canvasPos: Point,
  zoom: number,
  panX: number,
  panY: number
): Point {
  return {
    x: canvasPos.x * zoom + panX,
    y: canvasPos.y * zoom + panY,
  };
}

// === Snapping ===

/**
 * Snap a value to the nearest grid line
 */
export function snapToGrid(value: number, gridSize: number, enabled: boolean = true): number {
  if (!enabled || gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Snap a point to the grid
 */
export function snapPointToGrid(point: Point, gridSize: number, enabled: boolean = true): Point {
  return {
    x: snapToGrid(point.x, gridSize, enabled),
    y: snapToGrid(point.y, gridSize, enabled),
  };
}

/**
 * Find alignment guides for an element being dragged
 */
export function findAlignmentGuides(
  draggedBounds: Bounds,
  elements: UIElement[],
  canvasWidth: number,
  canvasHeight: number,
  threshold: number = 5
): AlignmentGuide[] {
  const guides: AlignmentGuide[] = [];

  // Dragged element edges and center
  const dragLeft = draggedBounds.x;
  const dragRight = draggedBounds.x + draggedBounds.width;
  const dragTop = draggedBounds.y;
  const dragBottom = draggedBounds.y + draggedBounds.height;
  const dragCenterX = draggedBounds.x + draggedBounds.width / 2;
  const dragCenterY = draggedBounds.y + draggedBounds.height / 2;

  // Canvas center guides
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = canvasHeight / 2;

  // Check canvas center alignment
  if (Math.abs(dragCenterX - canvasCenterX) < threshold) {
    guides.push({ type: 'vertical', position: canvasCenterX, source: 'canvas' });
  }
  if (Math.abs(dragCenterY - canvasCenterY) < threshold) {
    guides.push({ type: 'horizontal', position: canvasCenterY, source: 'canvas' });
  }

  // Check alignment with other elements
  for (const el of elements) {
    const elWidth = typeof el.width === 'number' ? el.width : 100;
    const elHeight = typeof el.height === 'number' ? el.height : 40;

    const elLeft = el.x;
    const elRight = el.x + elWidth;
    const elTop = el.y;
    const elBottom = el.y + elHeight;
    const elCenterX = el.x + elWidth / 2;
    const elCenterY = el.y + elHeight / 2;

    // Vertical alignment (left, center, right edges)
    const verticalChecks = [
      { drag: dragLeft, el: elLeft },
      { drag: dragLeft, el: elRight },
      { drag: dragRight, el: elLeft },
      { drag: dragRight, el: elRight },
      { drag: dragCenterX, el: elCenterX },
    ];

    for (const check of verticalChecks) {
      if (Math.abs(check.drag - check.el) < threshold) {
        guides.push({ type: 'vertical', position: check.el, source: 'element' });
      }
    }

    // Horizontal alignment (top, center, bottom edges)
    const horizontalChecks = [
      { drag: dragTop, el: elTop },
      { drag: dragTop, el: elBottom },
      { drag: dragBottom, el: elTop },
      { drag: dragBottom, el: elBottom },
      { drag: dragCenterY, el: elCenterY },
    ];

    for (const check of horizontalChecks) {
      if (Math.abs(check.drag - check.el) < threshold) {
        guides.push({ type: 'horizontal', position: check.el, source: 'element' });
      }
    }
  }

  // Deduplicate guides
  const uniqueGuides: AlignmentGuide[] = [];
  for (const guide of guides) {
    const exists = uniqueGuides.some(
      g => g.type === guide.type && Math.abs(g.position - guide.position) < 1
    );
    if (!exists) {
      uniqueGuides.push(guide);
    }
  }

  return uniqueGuides;
}

/**
 * Snap bounds to alignment guides
 */
export function snapToGuides(
  bounds: Bounds,
  guides: AlignmentGuide[],
  threshold: number = 5
): Bounds {
  let { x, y, width, height } = bounds;

  for (const guide of guides) {
    if (guide.type === 'vertical') {
      const left = x;
      const right = x + width;
      const center = x + width / 2;

      if (Math.abs(left - guide.position) < threshold) {
        x = guide.position;
      } else if (Math.abs(right - guide.position) < threshold) {
        x = guide.position - width;
      } else if (Math.abs(center - guide.position) < threshold) {
        x = guide.position - width / 2;
      }
    } else {
      const top = y;
      const bottom = y + height;
      const center = y + height / 2;

      if (Math.abs(top - guide.position) < threshold) {
        y = guide.position;
      } else if (Math.abs(bottom - guide.position) < threshold) {
        y = guide.position - height;
      } else if (Math.abs(center - guide.position) < threshold) {
        y = guide.position - height / 2;
      }
    }
  }

  return { x, y, width, height };
}

// === Hit Testing ===

/**
 * Check if a point is inside a bounds rectangle
 */
export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

/**
 * Get the bounds of an element
 */
export function getElementBounds(element: UIElement): Bounds {
  return {
    x: element.x,
    y: element.y,
    width: typeof element.width === 'number' ? element.width : 100,
    height: typeof element.height === 'number' ? element.height : 40,
  };
}

/**
 * Find the element at a given point (topmost first)
 */
export function findElementAtPoint(
  point: Point,
  elements: UIElement[],
  excludeIds: string[] = []
): UIElement | null {
  // Sort by z-index descending (or array order if no z-index)
  const sorted = [...elements].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

  for (const el of sorted) {
    if (excludeIds.includes(el.id)) continue;

    const bounds = getElementBounds(el);
    if (pointInBounds(point, bounds)) {
      return el;
    }

    // Check children for containers
    if (el.children && el.children.length > 0) {
      const childHit = findElementAtPoint(
        { x: point.x - el.x, y: point.y - el.y },
        el.children,
        excludeIds
      );
      if (childHit) return childHit;
    }
  }

  return null;
}

/**
 * Find the container element at a point (for drop targeting)
 */
export function findContainerAtPoint(
  point: Point,
  elements: UIElement[],
  excludeId?: string
): UIElement | null {
  const containers = elements.filter(
    el => el.type === 'container' || el.type === 'row' || el.type === 'column' || el.type === 'grid' || el.type === 'card'
  );

  for (const container of containers) {
    if (container.id === excludeId) continue;

    const bounds = getElementBounds(container);
    if (pointInBounds(point, bounds)) {
      // Check nested containers
      if (container.children) {
        const nested = findContainerAtPoint(
          { x: point.x - container.x, y: point.y - container.y },
          container.children,
          excludeId
        );
        if (nested) return nested;
      }
      return container;
    }
  }

  return null;
}

// === Resize Handle Detection ===

export type ResizeHandlePosition = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export const RESIZE_HANDLE_SIZE = 8;

/**
 * Get the cursor for a resize handle
 */
export function getResizeCursor(handle: ResizeHandlePosition): string {
  const cursors: Record<ResizeHandlePosition, string> = {
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
    nw: 'nwse-resize',
  };
  return cursors[handle];
}

/**
 * Get resize handle bounds for an element
 */
export function getResizeHandles(bounds: Bounds): Array<{ position: ResizeHandlePosition; x: number; y: number }> {
  const { x, y, width, height } = bounds;
  const half = RESIZE_HANDLE_SIZE / 2;

  return [
    { position: 'nw', x: x - half, y: y - half },
    { position: 'n', x: x + width / 2 - half, y: y - half },
    { position: 'ne', x: x + width - half, y: y - half },
    { position: 'e', x: x + width - half, y: y + height / 2 - half },
    { position: 'se', x: x + width - half, y: y + height - half },
    { position: 's', x: x + width / 2 - half, y: y + height - half },
    { position: 'sw', x: x - half, y: y + height - half },
    { position: 'w', x: x - half, y: y + height / 2 - half },
  ];
}

/**
 * Find which resize handle (if any) is at a point
 */
export function findResizeHandle(
  point: Point,
  elementBounds: Bounds
): ResizeHandlePosition | null {
  const handles = getResizeHandles(elementBounds);

  for (const handle of handles) {
    const handleBounds: Bounds = {
      x: handle.x,
      y: handle.y,
      width: RESIZE_HANDLE_SIZE,
      height: RESIZE_HANDLE_SIZE,
    };
    if (pointInBounds(point, handleBounds)) {
      return handle.position;
    }
  }

  return null;
}

// === Element Creation ===

/**
 * Create a new element from a palette component definition
 */
export function createElementFromPalette(
  def: PaletteComponentDef,
  position: Point
): UIElement {
  return {
    id: generateId(),
    type: def.type,
    x: position.x,
    y: position.y,
    width: def.defaultWidth,
    height: def.defaultHeight,
    props: { ...def.defaultProps },
    style: { ...def.defaultStyle },
    bindings: {},
    layout: def.defaultLayout,
    children: def.allowChildren ? [] : undefined,
    name: def.label,
  };
}

/**
 * Duplicate an element with a new ID and offset position
 */
export function duplicateElement(element: UIElement, offset: number = 20): UIElement {
  const duplicate: UIElement = {
    ...element,
    id: generateId(),
    x: element.x + offset,
    y: element.y + offset,
    name: element.name ? `${element.name} copy` : undefined,
  };

  // Recursively duplicate children
  if (element.children) {
    duplicate.children = element.children.map(child => duplicateElement(child, 0));
  }

  return duplicate;
}

// === Selection Rectangle ===

/**
 * Calculate the bounding box that contains all selected elements
 */
export function getSelectionBounds(elements: UIElement[]): Bounds | null {
  if (elements.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const bounds = getElementBounds(el);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Check if two rectangles intersect
 */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

/**
 * Find all elements that intersect with a selection rectangle
 */
export function findElementsInRect(rect: Bounds, elements: UIElement[]): UIElement[] {
  return elements.filter(el => boundsIntersect(rect, getElementBounds(el)));
}
