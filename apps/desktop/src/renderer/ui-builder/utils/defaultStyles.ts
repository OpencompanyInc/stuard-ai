/**
 * Default Styles and Theme Configuration
 * Provides consistent styling for UI Builder components
 */

import type { UIDesign, UIElement, UICanvasConfig, UIWindowConfig, UIElementStyle } from '../types';

// === Color Palette ===

export const COLORS = {
  // Primary colors
  primary: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
  },
  // Neutral colors
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  // Semantic colors
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  // Badge colors
  badge: {
    gray: { bg: '#f1f5f9', text: '#475569' },
    red: { bg: '#fee2e2', text: '#b91c1c' },
    yellow: { bg: '#fef3c7', text: '#a16207' },
    green: { bg: '#dcfce7', text: '#15803d' },
    blue: { bg: '#dbeafe', text: '#1d4ed8' },
    indigo: { bg: '#e0e7ff', text: '#4338ca' },
    purple: { bg: '#ede9fe', text: '#6d28d9' },
    pink: { bg: '#fce7f3', text: '#be185d' },
  },
};

// === Shadow Presets ===

export const SHADOWS = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
};

// === Font Size Presets ===

export const FONT_SIZES = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
};

// === Heading Sizes ===

export const HEADING_SIZES: Record<number, number> = {
  1: 36,
  2: 30,
  3: 24,
  4: 20,
  5: 18,
  6: 16,
};

// === Spacing Presets ===

export const SPACING = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
};

// === Border Radius Presets ===

export const BORDER_RADIUS = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  full: 9999,
};

// === Default Canvas Configuration ===

export const DEFAULT_CANVAS: UICanvasConfig = {
  width: 400,
  height: 500,
  backgroundColor: '#f8fafc',
  padding: 16,
  gridSize: 8,
  showGrid: true,
  showRulers: false,
};

// === Default Window Configuration ===

export const DEFAULT_WINDOW_CONFIG: UIWindowConfig = {
  width: 400,
  height: 500,
  position: 'center',
  alwaysOnTop: false,
  frameless: false,
  transparent: false,
  borderRadius: 12,
  resizable: false,
  minimizable: false,
  closable: true,
  title: 'Custom UI',
};

// === Create Empty Design ===

export function createEmptyDesign(name?: string): UIDesign {
  return {
    id: generateId(),
    name: name || 'Untitled Design',
    version: '1.0.0',
    canvas: { ...DEFAULT_CANVAS },
    elements: [],
    windowConfig: { ...DEFAULT_WINDOW_CONFIG },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// === Generate Unique ID ===

export function generateId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

// === Style Conversion Utilities ===

/**
 * Convert padding value to CSS string
 */
export function paddingToCSS(padding?: number | [number, number, number, number]): string {
  if (padding === undefined) return '';
  if (typeof padding === 'number') {
    return `${padding}px`;
  }
  return padding.map(p => `${p}px`).join(' ');
}

/**
 * Convert style object to CSS string
 */
export function styleToCSS(style: UIElementStyle): string {
  const rules: string[] = [];

  if (style.backgroundColor) {
    rules.push(`background-color: ${style.backgroundColor}`);
  }
  if (style.textColor) {
    rules.push(`color: ${style.textColor}`);
  }
  if (style.borderRadius !== undefined) {
    rules.push(`border-radius: ${style.borderRadius}px`);
  }
  if (style.borderColor && style.borderWidth) {
    rules.push(`border: ${style.borderWidth}px solid ${style.borderColor}`);
  } else if (style.borderColor) {
    rules.push(`border-color: ${style.borderColor}`);
  } else if (style.borderWidth) {
    rules.push(`border-width: ${style.borderWidth}px`);
  }
  if (style.padding !== undefined) {
    rules.push(`padding: ${paddingToCSS(style.padding)}`);
  }
  if (style.margin !== undefined) {
    rules.push(`margin: ${paddingToCSS(style.margin)}`);
  }
  if (style.fontSize) {
    rules.push(`font-size: ${style.fontSize}px`);
  }
  if (style.fontWeight) {
    const weights: Record<string, number> = {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    };
    rules.push(`font-weight: ${weights[style.fontWeight] || 400}`);
  }
  if (style.textAlign) {
    rules.push(`text-align: ${style.textAlign}`);
  }
  if (style.shadow && style.shadow !== 'none') {
    rules.push(`box-shadow: ${SHADOWS[style.shadow]}`);
  }
  if (style.opacity !== undefined && style.opacity !== 1) {
    rules.push(`opacity: ${style.opacity}`);
  }
  if (style.minWidth) {
    rules.push(`min-width: ${style.minWidth}px`);
  }
  if (style.minHeight) {
    rules.push(`min-height: ${style.minHeight}px`);
  }
  if (style.maxWidth) {
    rules.push(`max-width: ${style.maxWidth}px`);
  }
  if (style.maxHeight) {
    rules.push(`max-height: ${style.maxHeight}px`);
  }

  return rules.join('; ');
}

// === Button Variant Styles ===

export const BUTTON_VARIANTS: Record<string, { bg: string; text: string; border?: string; hover: string }> = {
  primary: {
    bg: '#4f46e5',
    text: '#ffffff',
    hover: '#4338ca',
  },
  secondary: {
    bg: '#f1f5f9',
    text: '#475569',
    hover: '#e2e8f0',
  },
  danger: {
    bg: '#ef4444',
    text: '#ffffff',
    hover: '#dc2626',
  },
  ghost: {
    bg: 'transparent',
    text: '#475569',
    hover: '#f1f5f9',
  },
  outline: {
    bg: 'transparent',
    text: '#4f46e5',
    border: '#4f46e5',
    hover: '#eef2ff',
  },
};

/**
 * Get CSS for a button variant
 */
export function getButtonVariantCSS(variant: string = 'primary'): string {
  const v = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary;
  let css = `background-color: ${v.bg}; color: ${v.text}`;
  if (v.border) {
    css += `; border: 1px solid ${v.border}`;
  }
  return css;
}

// === Tailwind-like Class Generation ===

/**
 * Generate Tailwind-like classes from style object (for preview/debugging)
 */
export function stylesToClasses(style: UIElementStyle): string[] {
  const classes: string[] = [];

  // Font weight
  if (style.fontWeight) {
    classes.push(`font-${style.fontWeight}`);
  }

  // Text align
  if (style.textAlign) {
    classes.push(`text-${style.textAlign}`);
  }

  // Shadow
  if (style.shadow && style.shadow !== 'none') {
    classes.push(`shadow-${style.shadow}`);
  }

  return classes;
}

// === Preset Templates ===

export const DESIGN_TEMPLATES = {
  blank: createEmptyDesign,

  form: (): UIDesign => ({
    ...createEmptyDesign('Form Template'),
    elements: [
      {
        id: generateId(),
        type: 'heading',
        x: 0, y: 0,
        width: 'full', height: 'auto',
        props: { text: 'Form Title', level: 3 },
        style: { fontWeight: 'bold', margin: [0, 0, 16, 0] },
        bindings: {},
      },
      {
        id: generateId(),
        type: 'input',
        x: 0, y: 50,
        width: 'full', height: 'auto',
        props: { placeholder: 'Enter name...' },
        style: { borderRadius: 8, borderColor: '#e2e8f0', borderWidth: 1, padding: 12, margin: [0, 0, 12, 0] },
        bindings: { dataBind: 'name' },
      },
      {
        id: generateId(),
        type: 'button',
        x: 0, y: 110,
        width: 'full', height: 'auto',
        props: { text: 'Submit', variant: 'primary' },
        style: { borderRadius: 8, padding: [12, 24, 12, 24], fontWeight: 'semibold' },
        bindings: { dataAction: 'submit' },
      },
    ],
  }),

  imageGallery: (): UIDesign => ({
    ...createEmptyDesign('Image Gallery'),
    canvas: { ...DEFAULT_CANVAS, width: 500, height: 400 },
    elements: [
      {
        id: generateId(),
        type: 'thumbnail-grid',
        x: 0, y: 0,
        width: 'full', height: 'auto',
        props: { columns: 4 },
        style: { padding: 8 },
        bindings: { dataBind: 'images' },
      },
    ],
  }),
};
