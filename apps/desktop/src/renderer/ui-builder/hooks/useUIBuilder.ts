/**
 * useUIBuilder Hook
 * Main state management for the UI Builder
 */

import { useReducer, useCallback, useMemo } from 'react';
import type { UIDesign, UIElement, UIBuilderState, UIBuilderAction, UICanvasConfig, UIWindowConfig } from '../types';
import { createEmptyDesign, generateId } from '../utils/defaultStyles';
import { duplicateElement } from '../utils/dragDrop';

// === Initial State ===

function createInitialState(initialDesign?: Partial<UIDesign>): UIBuilderState {
  const design = initialDesign
    ? { ...createEmptyDesign(), ...initialDesign }
    : createEmptyDesign();

  return {
    design,
    selectedIds: [],
    hoveredId: null,
    clipboard: [],
    history: [design],
    historyIndex: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    showGrid: true,
    snapToGrid: true,
    gridSize: 8,
    showRulers: false,
    previewMode: false,
  };
}

// === Reducer ===

function findElementById(elements: UIElement[], id: string): UIElement | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.children) {
      const found = findElementById(el.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findElementsByIds(elements: UIElement[], ids: string[]): UIElement[] {
  const result: UIElement[] = [];
  for (const el of elements) {
    if (ids.includes(el.id)) result.push(el);
    if (el.children) {
      result.push(...findElementsByIds(el.children, ids));
    }
  }
  return result;
}

function updateElementInTree(elements: UIElement[], id: string, updates: Partial<UIElement>): UIElement[] {
  return elements.map(el => {
    if (el.id === id) {
      return { ...el, ...updates };
    }
    if (el.children) {
      return { ...el, children: updateElementInTree(el.children, id, updates) };
    }
    return el;
  });
}

function deleteElementsFromTree(elements: UIElement[], ids: string[]): UIElement[] {
  return elements
    .filter(el => !ids.includes(el.id))
    .map(el => {
      if (el.children) {
        return { ...el, children: deleteElementsFromTree(el.children, ids) };
      }
      return el;
    });
}

function addElementToParent(elements: UIElement[], element: UIElement, parentId?: string): UIElement[] {
  if (!parentId) {
    return [...elements, element];
  }

  return elements.map(el => {
    if (el.id === parentId) {
      return { ...el, children: [...(el.children || []), element] };
    }
    if (el.children) {
      return { ...el, children: addElementToParent(el.children, element, parentId) };
    }
    return el;
  });
}

function getAllElementIds(elements: UIElement[]): string[] {
  const ids: string[] = [];
  for (const el of elements) {
    ids.push(el.id);
    if (el.children) {
      ids.push(...getAllElementIds(el.children));
    }
  }
  return ids;
}

function updateZIndex(elements: UIElement[], id: string, change: 'forward' | 'backward' | 'front' | 'back'): UIElement[] {
  const maxZ = Math.max(0, ...elements.map(el => el.zIndex || 0));
  const minZ = Math.min(0, ...elements.map(el => el.zIndex || 0));
  const currentEl = elements.find(el => el.id === id);
  if (!currentEl) return elements;

  const currentZ = currentEl.zIndex || 0;
  let newZ: number;

  switch (change) {
    case 'forward':
      newZ = currentZ + 1;
      break;
    case 'backward':
      newZ = currentZ - 1;
      break;
    case 'front':
      newZ = maxZ + 1;
      break;
    case 'back':
      newZ = minZ - 1;
      break;
  }

  return updateElementInTree(elements, id, { zIndex: newZ });
}

function reducer(state: UIBuilderState, action: UIBuilderAction): UIBuilderState {
  let newDesign: UIDesign;

  switch (action.type) {
    case 'SET_DESIGN':
      return {
        ...state,
        design: action.design,
        history: [action.design],
        historyIndex: 0,
        selectedIds: [],
      };

    case 'SELECT':
      if (action.add) {
        return {
          ...state,
          selectedIds: action.ids.length > 0
            ? [...new Set([...state.selectedIds, ...action.ids])]
            : state.selectedIds,
        };
      }
      return { ...state, selectedIds: action.ids };

    case 'SELECT_ALL':
      return { ...state, selectedIds: getAllElementIds(state.design.elements) };

    case 'DESELECT_ALL':
      return { ...state, selectedIds: [] };

    case 'HOVER':
      return { ...state, hoveredId: action.id };

    case 'ADD_ELEMENT':
      newDesign = {
        ...state.design,
        elements: addElementToParent(state.design.elements, action.element, action.parentId),
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        selectedIds: [action.element.id],
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };

    case 'UPDATE_ELEMENT':
      newDesign = {
        ...state.design,
        elements: updateElementInTree(state.design.elements, action.id, action.updates),
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };

    case 'DELETE_ELEMENTS':
      newDesign = {
        ...state.design,
        elements: deleteElementsFromTree(state.design.elements, action.ids),
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        selectedIds: state.selectedIds.filter(id => !action.ids.includes(id)),
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };

    case 'MOVE_ELEMENTS': {
      let updatedElements = state.design.elements;
      for (const id of action.ids) {
        const el = findElementById(updatedElements, id);
        if (el) {
          updatedElements = updateElementInTree(updatedElements, id, {
            x: el.x + action.dx,
            y: el.y + action.dy,
          });
        }
      }
      newDesign = {
        ...state.design,
        elements: updatedElements,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };
    }

    case 'RESIZE_ELEMENT':
      newDesign = {
        ...state.design,
        elements: updateElementInTree(state.design.elements, action.id, {
          width: action.width,
          height: action.height,
          ...(action.x !== undefined && { x: action.x }),
          ...(action.y !== undefined && { y: action.y }),
        }),
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };

    case 'DUPLICATE_ELEMENTS': {
      const elementsToDuplicate = findElementsByIds(state.design.elements, action.ids);
      const duplicates = elementsToDuplicate.map(el => duplicateElement(el));
      newDesign = {
        ...state.design,
        elements: [...state.design.elements, ...duplicates],
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        selectedIds: duplicates.map(el => el.id),
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };
    }

    case 'COPY': {
      const elementsToCopy = findElementsByIds(state.design.elements, state.selectedIds);
      return { ...state, clipboard: elementsToCopy.map(el => ({ ...el })) };
    }

    case 'PASTE': {
      if (state.clipboard.length === 0) return state;
      const pasted = state.clipboard.map(el => {
        const dup = duplicateElement(el);
        if (action.x !== undefined && action.y !== undefined) {
          dup.x = action.x;
          dup.y = action.y;
        }
        return dup;
      });
      newDesign = {
        ...state.design,
        elements: [...state.design.elements, ...pasted],
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        selectedIds: pasted.map(el => el.id),
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };
    }

    case 'BRING_FORWARD':
      newDesign = {
        ...state.design,
        elements: updateZIndex(state.design.elements, action.id, 'forward'),
      };
      return { ...state, design: newDesign };

    case 'SEND_BACKWARD':
      newDesign = {
        ...state.design,
        elements: updateZIndex(state.design.elements, action.id, 'backward'),
      };
      return { ...state, design: newDesign };

    case 'BRING_TO_FRONT':
      newDesign = {
        ...state.design,
        elements: updateZIndex(state.design.elements, action.id, 'front'),
      };
      return { ...state, design: newDesign };

    case 'SEND_TO_BACK':
      newDesign = {
        ...state.design,
        elements: updateZIndex(state.design.elements, action.id, 'back'),
      };
      return { ...state, design: newDesign };

    case 'UNDO':
      if (state.historyIndex > 0) {
        return {
          ...state,
          design: state.history[state.historyIndex - 1],
          historyIndex: state.historyIndex - 1,
        };
      }
      return state;

    case 'REDO':
      if (state.historyIndex < state.history.length - 1) {
        return {
          ...state,
          design: state.history[state.historyIndex + 1],
          historyIndex: state.historyIndex + 1,
        };
      }
      return state;

    case 'SET_ZOOM':
      return { ...state, zoom: Math.max(0.25, Math.min(4, action.zoom)) };

    case 'SET_PAN':
      return { ...state, panX: action.x, panY: action.y };

    case 'TOGGLE_GRID':
      return { ...state, showGrid: !state.showGrid };

    case 'TOGGLE_SNAP':
      return { ...state, snapToGrid: !state.snapToGrid };

    case 'SET_GRID_SIZE':
      return { ...state, gridSize: action.size };

    case 'TOGGLE_RULERS':
      return { ...state, showRulers: !state.showRulers };

    case 'TOGGLE_PREVIEW':
      return { ...state, previewMode: !state.previewMode };

    case 'UPDATE_CANVAS':
      newDesign = {
        ...state.design,
        canvas: { ...state.design.canvas, ...action.canvas },
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };

    case 'UPDATE_WINDOW_CONFIG':
      newDesign = {
        ...state.design,
        windowConfig: { ...state.design.windowConfig, ...action.config },
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };

    case 'SET_CUSTOM_CSS':
      newDesign = {
        ...state.design,
        customCss: action.css,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };

    case 'SET_CUSTOM_SCRIPT':
      newDesign = {
        ...state.design,
        customScript: action.script,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...state,
        design: newDesign,
        history: [...state.history.slice(0, state.historyIndex + 1), newDesign],
        historyIndex: state.historyIndex + 1,
      };

    default:
      return state;
  }
}

// === Hook ===

export function useUIBuilder(initialDesign?: Partial<UIDesign>) {
  const [state, dispatch] = useReducer(reducer, initialDesign, createInitialState);

  // === Actions ===

  const setDesign = useCallback((design: UIDesign) => {
    dispatch({ type: 'SET_DESIGN', design });
  }, []);

  const select = useCallback((ids: string[], add?: boolean) => {
    dispatch({ type: 'SELECT', ids, add });
  }, []);

  const selectAll = useCallback(() => {
    dispatch({ type: 'SELECT_ALL' });
  }, []);

  const deselectAll = useCallback(() => {
    dispatch({ type: 'DESELECT_ALL' });
  }, []);

  const setHovered = useCallback((id: string | null) => {
    dispatch({ type: 'HOVER', id });
  }, []);

  const addElement = useCallback((element: UIElement, parentId?: string) => {
    dispatch({ type: 'ADD_ELEMENT', element, parentId });
  }, []);

  const updateElement = useCallback((id: string, updates: Partial<UIElement>) => {
    dispatch({ type: 'UPDATE_ELEMENT', id, updates });
  }, []);

  const deleteElements = useCallback((ids: string[]) => {
    dispatch({ type: 'DELETE_ELEMENTS', ids });
  }, []);

  const deleteSelected = useCallback(() => {
    if (state.selectedIds.length > 0) {
      dispatch({ type: 'DELETE_ELEMENTS', ids: state.selectedIds });
    }
  }, [state.selectedIds]);

  const moveElements = useCallback((ids: string[], dx: number, dy: number) => {
    dispatch({ type: 'MOVE_ELEMENTS', ids, dx, dy });
  }, []);

  const resizeElement = useCallback((id: string, width: number, height: number, x?: number, y?: number) => {
    dispatch({ type: 'RESIZE_ELEMENT', id, width, height, x, y });
  }, []);

  const duplicateElements = useCallback((ids: string[]) => {
    dispatch({ type: 'DUPLICATE_ELEMENTS', ids });
  }, []);

  const duplicateSelected = useCallback(() => {
    if (state.selectedIds.length > 0) {
      dispatch({ type: 'DUPLICATE_ELEMENTS', ids: state.selectedIds });
    }
  }, [state.selectedIds]);

  const copy = useCallback(() => {
    dispatch({ type: 'COPY' });
  }, []);

  const paste = useCallback((x?: number, y?: number) => {
    dispatch({ type: 'PASTE', x, y });
  }, []);

  const bringForward = useCallback((id: string) => {
    dispatch({ type: 'BRING_FORWARD', id });
  }, []);

  const sendBackward = useCallback((id: string) => {
    dispatch({ type: 'SEND_BACKWARD', id });
  }, []);

  const bringToFront = useCallback((id: string) => {
    dispatch({ type: 'BRING_TO_FRONT', id });
  }, []);

  const sendToBack = useCallback((id: string) => {
    dispatch({ type: 'SEND_TO_BACK', id });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const setZoom = useCallback((zoom: number) => {
    dispatch({ type: 'SET_ZOOM', zoom });
  }, []);

  const setPan = useCallback((x: number, y: number) => {
    dispatch({ type: 'SET_PAN', x, y });
  }, []);

  const toggleGrid = useCallback(() => {
    dispatch({ type: 'TOGGLE_GRID' });
  }, []);

  const toggleSnap = useCallback(() => {
    dispatch({ type: 'TOGGLE_SNAP' });
  }, []);

  const setGridSize = useCallback((size: number) => {
    dispatch({ type: 'SET_GRID_SIZE', size });
  }, []);

  const toggleRulers = useCallback(() => {
    dispatch({ type: 'TOGGLE_RULERS' });
  }, []);

  const togglePreview = useCallback(() => {
    dispatch({ type: 'TOGGLE_PREVIEW' });
  }, []);

  const updateCanvas = useCallback((canvas: Partial<UICanvasConfig>) => {
    dispatch({ type: 'UPDATE_CANVAS', canvas });
  }, []);

  const updateWindowConfig = useCallback((config: Partial<UIWindowConfig>) => {
    dispatch({ type: 'UPDATE_WINDOW_CONFIG', config });
  }, []);

  const setCustomCSS = useCallback((css: string) => {
    dispatch({ type: 'SET_CUSTOM_CSS', css });
  }, []);

  const setCustomScript = useCallback((script: string) => {
    dispatch({ type: 'SET_CUSTOM_SCRIPT', script });
  }, []);

  // === Computed Values ===

  const selectedElements = useMemo(() => {
    return findElementsByIds(state.design.elements, state.selectedIds);
  }, [state.design.elements, state.selectedIds]);

  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.history.length - 1;

  return {
    state,
    dispatch,

    // Actions
    setDesign,
    select,
    selectAll,
    deselectAll,
    setHovered,
    addElement,
    updateElement,
    deleteElements,
    deleteSelected,
    moveElements,
    resizeElement,
    duplicateElements,
    duplicateSelected,
    copy,
    paste,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    undo,
    redo,
    setZoom,
    setPan,
    toggleGrid,
    toggleSnap,
    setGridSize,
    toggleRulers,
    togglePreview,
    updateCanvas,
    updateWindowConfig,
    setCustomCSS,
    setCustomScript,

    // Computed
    selectedElements,
    canUndo,
    canRedo,
  };
}

export type UIBuilderHook = ReturnType<typeof useUIBuilder>;
