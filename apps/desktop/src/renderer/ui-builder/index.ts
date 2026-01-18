/**
 * UI Builder Module
 * Visual UI designer for creating custom_ui tool arguments
 */

// Main components
export { UIBuilderModal } from './UIBuilderModal';
export { UIBuilderCanvas, type UIBuilderCanvasRef } from './UIBuilderCanvas';
export { UIBuilderPalette } from './UIBuilderPalette';
export { UIBuilderProperties } from './UIBuilderProperties';
export { UIBuilderToolbar } from './UIBuilderToolbar';
export { UIBuilderPreview, CodePanel } from './UIBuilderPreview';

// Hooks
export { useUIBuilder, type UIBuilderHook } from './hooks/useUIBuilder';
export { useSelection, type SelectionHook } from './hooks/useSelection';

// Types
export type {
  UIElement,
  UIDesign,
  UIElementType,
  UIElementStyle,
  UIElementProps,
  UIElementBindings,
  UICanvasConfig,
  UIWindowConfig,
  UIBuilderState,
  GeneratedCode,
  PaletteComponentDef,
} from './types';

// Utilities
export {
  generateCode,
  generateCustomUIArgs,
  parseCustomUIArgs,
} from './utils/codeGenerator';

export {
  createEmptyDesign,
  generateId,
  COLORS,
  SHADOWS,
  FONT_SIZES,
  SPACING,
  BORDER_RADIUS,
  DEFAULT_CANVAS,
  DEFAULT_WINDOW_CONFIG,
} from './utils/defaultStyles';

export {
  getComponentDef,
  PALETTE_COMPONENTS,
  PALETTE_BY_CATEGORY,
} from './components';

export {
  createElementFromPalette,
  duplicateElement,
  findElementAtPoint,
  findContainerAtPoint,
  getElementBounds,
  snapToGrid,
  snapPointToGrid,
} from './utils/dragDrop';
