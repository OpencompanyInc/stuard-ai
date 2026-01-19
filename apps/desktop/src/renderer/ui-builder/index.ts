/**
 * UI Builder Module
 * Visual UI editor that works directly with custom_ui HTML/CSS/JS
 */

// Main components
export { UIBuilderModal } from './UIBuilderModal';
export { UIBuilderCanvas, type UIBuilderCanvasRef, type SelectedElementInfo } from './UIBuilderCanvas';

// Types
export type { UIDesign, GeneratedCode } from './types';

// Utility functions for custom_ui tool integration
export { generateCustomUIArgs, parseCustomUIArgs } from './utils/codeGenerator';
