/**
 * useSelection Hook
 * Handles selection interactions (click, drag selection box, keyboard shortcuts)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { UIElement, Bounds, Point } from '../types';
import {
  findElementAtPoint,
  findResizeHandle,
  getElementBounds,
  findElementsInRect,
  screenToCanvas,
  ResizeHandlePosition,
} from '../utils/dragDrop';

export interface SelectionState {
  // Drag box selection
  isSelecting: boolean;
  selectionStart: Point | null;
  selectionEnd: Point | null;
  selectionRect: Bounds | null;

  // Resize state
  isResizing: boolean;
  resizeHandle: ResizeHandlePosition | null;
  resizeStartBounds: Bounds | null;
  resizeStartPoint: Point | null;

  // Drag move state
  isDragging: boolean;
  dragStartPoint: Point | null;
  dragStartPositions: Map<string, Point>;
}

interface UseSelectionOptions {
  elements: UIElement[];
  selectedIds: string[];
  zoom: number;
  panX: number;
  panY: number;
  gridSize: number;
  snapToGrid: boolean;
  onSelect: (ids: string[], add?: boolean) => void;
  onMoveElements: (ids: string[], dx: number, dy: number) => void;
  onResizeElement: (id: string, width: number, height: number, x?: number, y?: number) => void;
  onDeleteElements: (ids: string[]) => void;
  onDuplicateElements: (ids: string[]) => void;
  onCopy: () => void;
  onPaste: (x?: number, y?: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function useSelection(options: UseSelectionOptions) {
  const {
    elements,
    selectedIds,
    zoom,
    panX,
    panY,
    gridSize,
    snapToGrid,
    onSelect,
    onMoveElements,
    onResizeElement,
    onDeleteElements,
    onDuplicateElements,
    onCopy,
    onPaste,
    onUndo,
    onRedo,
  } = options;

  const [state, setState] = useState<SelectionState>({
    isSelecting: false,
    selectionStart: null,
    selectionEnd: null,
    selectionRect: null,
    isResizing: false,
    resizeHandle: null,
    resizeStartBounds: null,
    resizeStartPoint: null,
    isDragging: false,
    dragStartPoint: null,
    dragStartPositions: new Map(),
  });

  // Refs for current state during mouse move
  const stateRef = useRef(state);
  stateRef.current = state;

  // === Mouse Down Handler ===

  const handleMouseDown = useCallback((
    e: React.MouseEvent<HTMLElement>,
    canvasRef: HTMLElement | null
  ) => {
    if (!canvasRef) return;

    const rect = canvasRef.getBoundingClientRect();
    const screenPoint: Point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    const canvasPoint = screenToCanvas(screenPoint, zoom, panX, panY);

    // Check if clicking on a resize handle of a selected element
    if (selectedIds.length === 1) {
      const selectedEl = elements.find(el => el.id === selectedIds[0]);
      if (selectedEl) {
        const bounds = getElementBounds(selectedEl);
        const handle = findResizeHandle(canvasPoint, bounds);
        if (handle) {
          setState(prev => ({
            ...prev,
            isResizing: true,
            resizeHandle: handle,
            resizeStartBounds: bounds,
            resizeStartPoint: canvasPoint,
          }));
          e.preventDefault();
          return;
        }
      }
    }

    // Check if clicking on an element
    const hitElement = findElementAtPoint(canvasPoint, elements);

    if (hitElement) {
      const isSelected = selectedIds.includes(hitElement.id);

      if (e.shiftKey) {
        // Shift-click: toggle selection
        if (isSelected) {
          onSelect(selectedIds.filter(id => id !== hitElement.id));
        } else {
          onSelect([...selectedIds, hitElement.id]);
        }
      } else if (!isSelected) {
        // Click on unselected element: select it
        onSelect([hitElement.id]);
      }

      // Start drag (if any elements are selected)
      const idsToMove = isSelected || e.shiftKey ? selectedIds : [hitElement.id];
      const startPositions = new Map<string, Point>();

      for (const id of idsToMove) {
        const el = elements.find(e => e.id === id);
        if (el) {
          startPositions.set(id, { x: el.x, y: el.y });
        }
      }

      setState(prev => ({
        ...prev,
        isDragging: true,
        dragStartPoint: canvasPoint,
        dragStartPositions: startPositions,
      }));
    } else {
      // Click on empty space
      if (!e.shiftKey) {
        onSelect([]);
      }

      // Start selection box
      setState(prev => ({
        ...prev,
        isSelecting: true,
        selectionStart: canvasPoint,
        selectionEnd: canvasPoint,
        selectionRect: null,
      }));
    }
  }, [elements, selectedIds, zoom, panX, panY, onSelect]);

  // === Mouse Move Handler ===

  const handleMouseMove = useCallback((
    e: MouseEvent,
    canvasRef: HTMLElement | null
  ) => {
    if (!canvasRef) return;

    const rect = canvasRef.getBoundingClientRect();
    const screenPoint: Point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    const canvasPoint = screenToCanvas(screenPoint, zoom, panX, panY);

    const currentState = stateRef.current;

    // Handle resize
    if (currentState.isResizing && currentState.resizeHandle && currentState.resizeStartBounds && currentState.resizeStartPoint) {
      const dx = canvasPoint.x - currentState.resizeStartPoint.x;
      const dy = canvasPoint.y - currentState.resizeStartPoint.y;
      const { x, y, width, height } = currentState.resizeStartBounds;
      const handle = currentState.resizeHandle;

      let newX = x;
      let newY = y;
      let newWidth = width;
      let newHeight = height;

      // Adjust based on which handle is being dragged
      if (handle.includes('e')) {
        newWidth = Math.max(20, width + dx);
      }
      if (handle.includes('w')) {
        newWidth = Math.max(20, width - dx);
        newX = x + dx;
        if (newWidth === 20) newX = x + width - 20;
      }
      if (handle.includes('s')) {
        newHeight = Math.max(20, height + dy);
      }
      if (handle.includes('n')) {
        newHeight = Math.max(20, height - dy);
        newY = y + dy;
        if (newHeight === 20) newY = y + height - 20;
      }

      // Snap to grid
      if (snapToGrid) {
        newX = Math.round(newX / gridSize) * gridSize;
        newY = Math.round(newY / gridSize) * gridSize;
        newWidth = Math.round(newWidth / gridSize) * gridSize;
        newHeight = Math.round(newHeight / gridSize) * gridSize;
      }

      if (selectedIds.length === 1) {
        onResizeElement(selectedIds[0], newWidth, newHeight, newX, newY);
      }
      return;
    }

    // Handle drag move
    if (currentState.isDragging && currentState.dragStartPoint) {
      let dx = canvasPoint.x - currentState.dragStartPoint.x;
      let dy = canvasPoint.y - currentState.dragStartPoint.y;

      // Snap to grid
      if (snapToGrid) {
        dx = Math.round(dx / gridSize) * gridSize;
        dy = Math.round(dy / gridSize) * gridSize;
      }

      if (dx !== 0 || dy !== 0) {
        onMoveElements(Array.from(currentState.dragStartPositions.keys()), dx, dy);
        // Update drag start point for incremental moves
        setState(prev => ({
          ...prev,
          dragStartPoint: {
            x: prev.dragStartPoint!.x + dx,
            y: prev.dragStartPoint!.y + dy,
          },
        }));
      }
      return;
    }

    // Handle selection box
    if (currentState.isSelecting && currentState.selectionStart) {
      const start = currentState.selectionStart;
      const selectionRect: Bounds = {
        x: Math.min(start.x, canvasPoint.x),
        y: Math.min(start.y, canvasPoint.y),
        width: Math.abs(canvasPoint.x - start.x),
        height: Math.abs(canvasPoint.y - start.y),
      };

      setState(prev => ({
        ...prev,
        selectionEnd: canvasPoint,
        selectionRect,
      }));

      // Find elements in selection box
      const elementsInRect = findElementsInRect(selectionRect, elements);
      onSelect(elementsInRect.map(el => el.id));
    }
  }, [elements, selectedIds, zoom, panX, panY, gridSize, snapToGrid, onMoveElements, onResizeElement, onSelect]);

  // === Mouse Up Handler ===

  const handleMouseUp = useCallback(() => {
    setState(prev => ({
      ...prev,
      isSelecting: false,
      selectionStart: null,
      selectionEnd: null,
      selectionRect: null,
      isResizing: false,
      resizeHandle: null,
      resizeStartBounds: null,
      resizeStartPoint: null,
      isDragging: false,
      dragStartPoint: null,
      dragStartPositions: new Map(),
    }));
  }, []);

  // === Keyboard Handler ===

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Delete selected elements
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
      e.preventDefault();
      onDeleteElements(selectedIds);
      return;
    }

    // Copy/Paste/Duplicate
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      onCopy();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      onPaste();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedIds.length > 0) {
      e.preventDefault();
      onDuplicateElements(selectedIds);
      return;
    }

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      onUndo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      onRedo();
      return;
    }

    // Select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      onSelect(elements.map(el => el.id));
      return;
    }

    // Arrow key nudge
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedIds.length > 0) {
      e.preventDefault();
      const step = e.shiftKey ? gridSize : 1;
      let dx = 0;
      let dy = 0;

      switch (e.key) {
        case 'ArrowUp': dy = -step; break;
        case 'ArrowDown': dy = step; break;
        case 'ArrowLeft': dx = -step; break;
        case 'ArrowRight': dx = step; break;
      }

      onMoveElements(selectedIds, dx, dy);
      return;
    }

    // Escape to deselect
    if (e.key === 'Escape') {
      onSelect([]);
      return;
    }
  }, [
    elements,
    selectedIds,
    gridSize,
    onDeleteElements,
    onCopy,
    onPaste,
    onDuplicateElements,
    onUndo,
    onRedo,
    onSelect,
    onMoveElements,
  ]);

  // === Get cursor for current state ===

  const getCursor = useCallback((canvasPoint: Point): string => {
    // Check resize handles on selected elements
    if (selectedIds.length === 1) {
      const selectedEl = elements.find(el => el.id === selectedIds[0]);
      if (selectedEl) {
        const bounds = getElementBounds(selectedEl);
        const handle = findResizeHandle(canvasPoint, bounds);
        if (handle) {
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
          return cursors[handle];
        }
      }
    }

    // Check if over an element
    const hitElement = findElementAtPoint(canvasPoint, elements);
    if (hitElement) {
      return 'move';
    }

    return 'default';
  }, [elements, selectedIds]);

  return {
    state,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleKeyDown,
    getCursor,
  };
}

export type SelectionHook = ReturnType<typeof useSelection>;
